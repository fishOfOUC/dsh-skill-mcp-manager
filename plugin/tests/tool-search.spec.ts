/** Real registry, model-step admission, scoped discovery, and ordinary execution. */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { executeModelToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, onTestFinished } from 'vitest'
import { ManagedToolSearch, TOOL_SEARCH_NAME } from '../src/tool-search.ts'

const selection = { provider: 'fixture', model: 'fixture' }
const agent = (id: string) => ({ id } as Agent)

async function setup() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(Tools).await()
  await ctx.plugin(NativeToolExecutor).await()
  let search!: ManagedToolSearch
  await ctx.plugin({ inject: ['tools', 'systemPrompt'], apply(inner: Context) { search = new ManagedToolSearch(inner) } }).await()
  const resolve = (owner: Agent) => ctx.tools.resolve({ agent: owner, modelSelection: selection, signal: new AbortController().signal })
  const call = async (owner: Agent, name: string, args: unknown) => {
    const toolSet = await resolve(owner)
    try {
      return await executeModelToolFixture(ctx, {
        name, arguments: args, agent: owner, toolSet, callId: ToolCallId(`${name}-${Math.random()}`), signal: new AbortController().signal,
      })
    } finally { toolSet.dispose() }
  }
  const mount = async (server: string, definitions: ToolDefinition[], instructions = '') => {
    const unregister: (() => void)[] = []
    const fiber = ctx.plugin({ inject: ['tools', 'systemPrompt'], apply(inner: Context) {
      const bridge = search.bridgeContext(inner, server)
      for (const definition of definitions) unregister.push(bridge.tools.register(definition))
      bridge.systemPrompt.section({ name: `mcp:${server}`, order: 3100, text: instructions, interpolate: false })
    } })
    await fiber.await()
    return { fiber, unregister }
  }
  const schemas = async (owner: Agent) => {
    const toolSet = await resolve(owner)
    try { return (await ctx.systemPrompt.assemble({ scope: owner, toolSet })).tools } finally { toolSet.dispose() }
  }
  return { ctx, resolve, call, mount, schemas }
}

function tool(name: string, description: string, execute = async () => 'done') {
  return defineTool({
    name, description, parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute,
  })
}

describe('managed MCP tool discovery', () => {
  it('keeps 120 full schemas out of the initial model request and admits only matches next step', async () => {
    const h = await setup()
    const owner = agent('large')
    const definitions = Array.from({ length: 120 }, (_, i) => tool(`mcp__files__operation_${i}`, `File operation ${i}. ${'Details '.repeat(100)}`))
    await h.mount('files', definitions, 'Long literal MCP instructions')
    const initial = await h.schemas(owner)
    expect(initial.map(schema => schema.name)).toEqual([TOOL_SEARCH_NAME])
    const admission = await h.resolve(owner)
    const discovery = await h.call(owner, TOOL_SEARCH_NAME, { query: 'operation_42', limit: 1 })
    expect(discovery.isError).toBe(false)
    expect(discovery.value).toMatchObject({ tools: [{ name: 'mcp__files__operation_42' }], hasMore: true })
    expect(h.ctx.tools.schemas(owner, admission).map(schema => schema.name)).toEqual([TOOL_SEARCH_NAME])
    admission.dispose()
    expect((await h.schemas(owner)).map(schema => schema.name).sort()).toEqual([TOOL_SEARCH_NAME, 'mcp__files__operation_42'].sort())
    expect(JSON.stringify(initial).length).toBeLessThan(JSON.stringify(definitions).length / 20)
  })

  it('isolates discoveries and server instructions between conversations', async () => {
    const h = await setup()
    const first = agent('first'), second = agent('second')
    await h.mount('weather', [tool('mcp__weather__forecast', 'Weather forecast')], 'Weather server private usage instructions')
    await h.call(first, TOOL_SEARCH_NAME, { query: 'forecast' })
    expect((await h.schemas(first)).map(schema => schema.name)).toContain('mcp__weather__forecast')
    expect((await h.schemas(second)).map(schema => schema.name)).toEqual([TOOL_SEARCH_NAME])
    for (const [owner, expected] of [[first, true], [second, false]] as const) {
      const toolSet = await h.resolve(owner)
      const assembled = await h.ctx.systemPrompt.assemble({ scope: owner, toolSet })
      expect(assembled.sections.some(section => section.text.includes('Weather server private'))).toBe(expected)
      toolSet.dispose()
    }
    expect((await h.call(second, 'mcp__weather__forecast', {})).error?.info?.code).toBe('UNKNOWN_TOOL')
  })

  it('keeps the normal guard, argument validation, cancellation and result pipeline', async () => {
    const h = await setup()
    const owner = agent('guarded')
    let calls = 0
    const definition = defineTool({
      name: 'mcp__calc__add', description: 'Add two numbers', parameters: { a: { type: 'number', required: true } },
      output: { schema: { type: 'number' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      async execute(args, exec) { exec.signal.throwIfAborted(); calls++; return args.a + 1 },
    })
    await h.mount('calc', [definition])
    await h.call(owner, TOOL_SEARCH_NAME, { query: 'add' })
    expect((await h.call(owner, definition.name, {})).isError).toBe(true)
    const unguard = h.ctx.tools.guard(exec => exec.name === definition.name ? 'fixture denied' : undefined)
    expect((await h.call(owner, definition.name, { a: 2 })).isError).toBe(true)
    expect(calls).toBe(0)
    unguard()
    expect(await h.call(owner, definition.name, { a: 2 })).toMatchObject({ isError: false, value: 3, content: [{ type: 'text', text: '3' }] })
    const toolSet = await h.resolve(owner)
    const abort = new AbortController(); abort.abort()
    const cancelled = await executeModelToolFixture(h.ctx, { agent: owner, toolSet, name: definition.name, arguments: { a: 2 }, callId: ToolCallId('cancelled'), signal: abort.signal })
    toolSet.dispose()
    expect(cancelled.isError).toBe(true)
    expect(calls).toBe(1)
  })

  it('does not disclose or activate restricted tools and respects scoped shadows', async () => {
    const h = await setup()
    const owner = agent('restricted')
    const definition = tool('mcp__secret__lookup', 'Secret lookup')
    await h.mount('secret', [definition])
    let scope!: ReturnType<typeof createScope>
    await h.ctx.plugin({ inject: ['tools'], apply(inner: Context) { scope = createScope(inner, owner) } }).await()
    const lift = scope.ctx.tools.restrict({ deny: [definition.name] })
    expect((await h.call(owner, TOOL_SEARCH_NAME, { query: 'secret' })).value).toMatchObject({ tools: [], total: 0 })
    lift()
    const unshadow = scope.ctx.tools.register(tool(definition.name, 'Different scoped operation'))
    expect((await h.call(owner, TOOL_SEARCH_NAME, { query: 'secret' })).value).toMatchObject({ tools: [] })
    unshadow()
    expect((await h.call(owner, TOOL_SEARCH_NAME, { query: 'secret' })).value).toMatchObject({ tools: [{ name: definition.name }] })
  })

  it('revokes removed generations immediately and requires discovery after reconnect', async () => {
    const h = await setup()
    const owner = agent('reconnect')
    const definition = tool('mcp__server__ping', 'Ping')
    const first = await h.mount('server', [definition])
    await h.call(owner, TOOL_SEARCH_NAME, { query: 'ping' })
    const stale = await h.resolve(owner)
    await first.fiber.dispose()
    expect(h.ctx.tools.schemas(owner, stale).map(schema => schema.name)).toEqual([TOOL_SEARCH_NAME])
    stale.dispose()
    await h.mount('server', [definition])
    expect((await h.schemas(owner)).map(schema => schema.name)).toEqual([TOOL_SEARCH_NAME])
    expect((await h.call(owner, definition.name, {})).error?.info?.code).toBe('UNKNOWN_TOOL')
    await h.call(owner, TOOL_SEARCH_NAME, { query: 'ping' })
    expect((await h.call(owner, definition.name, {})).isError).toBe(false)
  })

  it('validates discovery arguments without activating anything and supports no matches', async () => {
    const h = await setup()
    const owner = agent('invalid')
    await h.mount('server', [tool('mcp__server__ping', 'Ping')])
    for (const args of [{ query: '' }, { query: '   ' }, { query: 'x'.repeat(2049) }, { query: 'ping', limit: 0 }, { query: 'ping', limit: 33 }, { query: 'ping', limit: 1.5 }]) {
      expect((await h.call(owner, TOOL_SEARCH_NAME, args)).isError).toBe(true)
    }
    expect((await h.call(owner, TOOL_SEARCH_NAME, { query: 'no_such_capability' })).value).toMatchObject({ tools: [], total: 0, hasMore: false })
    expect((await h.schemas(owner)).map(schema => schema.name)).toEqual([TOOL_SEARCH_NAME])
  })

  it('searches identifiers and Chinese descriptions with an exact server filter', async () => {
    const h = await setup()
    const owner = agent('languages')
    await h.mount('files', [tool('mcp__files__searchFiles', '查找本地文件')])
    await h.mount('other', [tool('mcp__other__searchFiles', 'Search files')])
    expect((await h.call(owner, TOOL_SEARCH_NAME, { query: '查找文件', server: 'files' })).value).toMatchObject({ tools: [{ name: 'mcp__files__searchFiles' }] })
    expect((await h.call(owner, TOOL_SEARCH_NAME, { query: 'search files', server: 'other' })).value).toMatchObject({ tools: [{ name: 'mcp__other__searchFiles' }] })
  })

  it('does not commit discovery if an upstream schema is not lossless JSON', async () => {
    const h = await setup()
    const owner = agent('malformed')
    await h.mount('broken', [{ ...tool('mcp__broken__schema', 'Broken schema'), parameters: { impossible: () => {} } }])
    expect((await h.call(owner, TOOL_SEARCH_NAME, { query: 'broken' })).isError).toBe(true)
    expect((await h.schemas(owner)).map(schema => schema.name)).toEqual([TOOL_SEARCH_NAME])
  })

  it('caps active schemas at 32 and can rediscover evicted tools', async () => {
    const h = await setup()
    const owner = agent('bounded')
    await h.mount('server', Array.from({ length: 40 }, (_, i) => tool(`mcp__server__task_${i}`, `Task ${i}`)))
    await h.call(owner, TOOL_SEARCH_NAME, { query: 'task', limit: 32 })
    const first = (await h.schemas(owner)).find(schema => schema.name !== TOOL_SEARCH_NAME)!
    await h.call(owner, TOOL_SEARCH_NAME, { query: 'task_39', limit: 1 })
    const schemas = await h.schemas(owner)
    expect(schemas).toHaveLength(33)
    expect(schemas.some(schema => schema.name === first.name)).toBe(false)
    await h.call(owner, TOOL_SEARCH_NAME, { query: first.name, limit: 1 })
    expect((await h.schemas(owner)).some(schema => schema.name === first.name)).toBe(true)
  })
})
