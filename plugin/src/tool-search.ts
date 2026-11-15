/** Session-local discovery of managed MCP tools through the normal tool pipeline. */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'
import { snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

export const TOOL_SEARCH_NAME = 'mcp_tool_search'
const DEFAULT_LIMIT = 8
const MAX_LIMIT = 32
const MAX_ACTIVE = 32

interface Entry {
  server: string
  definition: ToolDefinition
  token: symbol
  terms: Map<string, number>
  length: number
}

/** Split identifiers and retain Chinese words as overlapping bigrams. */
function tokenize(text: string): string[] {
  const words = text.replace(/([a-z\d])([A-Z])/g, '$1 $2').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return words.flatMap(word => {
    if (!/\p{Script=Han}/u.test(word)) return [word]
    const chars = Array.from(word)
    return [word, ...chars, ...chars.slice(1).map((char, index) => chars[index] + char)]
  })
}

function index(server: string, definition: ToolDefinition): Pick<Entry, 'terms' | 'length'> {
  const terms = new Map<string, number>()
  for (const [text, boost] of [[server, 3], [definition.name, 4], [definition.description, 1]] as const) {
    for (const term of tokenize(text)) terms.set(term, (terms.get(term) ?? 0) + boost)
  }
  return { terms, length: [...terms.values()].reduce((sum, value) => sum + value, 0) }
}

/** Owns discovery only; original MCP definitions still execute in the Host pipeline. */
export class ManagedToolSearch {
  private readonly entries = new Map<string, Entry>()
  private selected = new WeakMap<Agent, Map<string, symbol>>()

  constructor(private readonly ctx: Context) {
    ctx.tools.register(defineTool({
      name: TOOL_SEARCH_NAME,
      description: 'Search the deferred MCP tools managed by Skills and MCP. Search by capability, tool name, or server name; refine the query if needed. Only matching tools become callable in your next model step. Invoke returned tools with the documented parameters using your current tool executor. Discovery is private to this conversation. At most 32 recently discovered tools stay active; search again to restore an evicted tool. Use this tool for MCP tool discovery, not list_mcp_resources.',
      parameters: {
        query: { type: 'string', required: true, description: 'Capability, tool name, or server name to search for. Must not be blank.' },
        server: { type: 'string', description: 'Optional exact MCP server namespace to restrict the search.' },
        limit: { type: 'integer', description: 'Maximum matching tools to return and activate, from 1 to 32. Defaults to 8.' },
      },
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: async (args, execution) => this.search(args, execution),
    }))
    ctx.systemPrompt.section({
      name: 'capability-manager:mcp-discovery', order: ctx.systemPrompt.getSectionOrder('MCP_SERVERS'), interpolate: false,
      text: ({ scope }) => {
        const counts = new Map<string, number>()
        for (const entry of this.visible(scope)) counts.set(entry.server, (counts.get(entry.server) ?? 0) + 1)
        if (counts.size === 0) return ''
        const sources = [...counts].map(([server, count]) => `${server} (${count})`).join(', ')
        return `Managed MCP tools are available through ${TOOL_SEARCH_NAME}. Search before calling them. Servers (tool counts): ${sources.slice(0, 2048)}${sources.length > 2048 ? '…' : ''}`
      },
    })
    ctx.effect(() => () => { this.entries.clear(); this.selected = new WeakMap() }, 'managed-mcp.discovery')
  }

  /** Isolate only this bridge's registration service; never patch the shared Host registry. */
  bridgeContext(owner: Context, server: string): Context {
    const tools = owner.tools
    const systemPrompt = owner.systemPrompt
    let bridge = owner.isolate('tools').isolate('systemPrompt')
    // The shipped Desktop MCP bridge uses the older ctx.root alias. Keep it
    // local when running that same bridge on a newer, symbol-based Cordis.
    if (typeof Context.root === 'symbol') bridge = bridge.extend({ root: owner[Context.root] })
    bridge.provide('tools', {
      register: (definition: ToolDefinition) => {
        const entry: Entry = { server, definition, token: Symbol(definition.name), ...index(server, definition) }
        return owner.effect(() => {
          const unregister = tools.register(definition, {
            when: ({ agent }) => this.selected.get(agent)?.get(definition.name) === entry.token,
          })
          this.entries.set(definition.name, entry)
          return () => {
            unregister()
            if (this.entries.get(definition.name) === entry) this.entries.delete(definition.name)
          }
        }, 'managed-mcp.deferred-tool')
      },
    })
    // Server instructions may contain long tool catalogs. Expose them only to
    // conversations that have discovered a tool from that server.
    bridge.provide('systemPrompt', {
      getSectionOrder: systemPrompt.getSectionOrder.bind(systemPrompt),
      section: (section: PromptSection) => systemPrompt.section({
        ...section,
        text: (context) => this.hasSelected(server, context.scope)
          ? typeof section.text === 'function' ? section.text(context) : section.text : '',
      }),
    })
    return bridge
  }

  private visible(scope?: ScopeKey): Entry[] {
    const definitions = new Set(this.ctx.tools.definitions(scope))
    return [...this.entries.values()].filter(entry => definitions.has(entry.definition))
  }

  private hasSelected(server: string, scope?: ScopeKey): boolean {
    if (scope === undefined) return false
    const selected = this.selected.get(scope as Agent)
    return this.visible(scope).some(entry => entry.server === server && selected?.get(entry.definition.name) === entry.token)
  }

  private search(args: { query: string; server?: string; limit?: number }, execution: ToolRunContext) {
    execution.signal.throwIfAborted()
    if (execution.agent === undefined) throw new Error('MCP tool discovery requires a conversation Agent')
    const query = args.query.trim()
    if (query.length === 0 || query.length > 2048) throw new Error('query must contain 1 to 2048 characters')
    const limit = args.limit ?? DEFAULT_LIMIT
    if (limit < 1 || limit > MAX_LIMIT) throw new Error('limit must be between 1 and 32')
    const visible = this.visible(execution.agent)
    const corpus = args.server === undefined ? visible : visible.filter(entry => entry.server === args.server)
    const terms = [...new Set(tokenize(query))]
    const averageLength = corpus.reduce((sum, entry) => sum + entry.length, 0) / (corpus.length || 1)
    const frequency = new Map(terms.map(term => [term, corpus.filter(entry => entry.terms.has(term)).length]))
    const ranked = corpus.map(entry => {
      let score = 0
      for (const term of terms) {
        const tf = entry.terms.get(term) ?? 0
        if (tf === 0) continue
        const df = frequency.get(term) ?? 0
        const idf = Math.log(1 + (corpus.length - df + 0.5) / (df + 0.5))
        score += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * entry.length / (averageLength || 1)))
      }
      return { entry, score }
    }).filter(result => result.score > 0).sort((a, b) => b.score - a.score || a.entry.definition.name.localeCompare(b.entry.definition.name))
    const matches = ranked.slice(0, limit).map(result => result.entry)
    const tools = matches.map(({ server, definition }) => {
      // snapshotJsonValue validates JSON at runtime; its generic signature
      // preserves the wider ToolSchema.parameters type rather than narrowing it.
      const parameters = snapshotJsonValue(definition.parameters) as JsonValue | undefined
      if (parameters === undefined) throw new Error(`MCP tool ${definition.name} has non-JSON parameters`)
      return { server, name: definition.name, description: definition.description, parameters }
    })
    // Commit after validation/ranking. Keep only live, visible registrations;
    // reconnects receive new tokens and cannot resurrect stale discoveries.
    const selected = this.selected.get(execution.agent) ?? new Map<string, symbol>()
    for (const [name, token] of selected) {
      if (!visible.some(entry => entry.definition.name === name && entry.token === token)) selected.delete(name)
    }
    for (const entry of matches) {
      selected.delete(entry.definition.name)
      selected.set(entry.definition.name, entry.token)
    }
    while (selected.size > MAX_ACTIVE) selected.delete(selected.keys().next().value!)
    this.selected.set(execution.agent, selected)
    return {
      tools,
      total: ranked.length, hasMore: ranked.length > limit,
      activeLimit: MAX_ACTIVE,
    }
  }
}
