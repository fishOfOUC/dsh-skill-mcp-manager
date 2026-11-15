/** Unified persisted Skill and MCP management with effect-owned runtime registrations. */
import { mkdir, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { expandHomePath, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { Config as McpConfig, connectMcpServer, type ConnectionHandle } from '@deepseek-ai/dsh-mcp-client'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'
import { documentSchema, entrySchema } from './schema.ts'
import { createManagedSkill } from './skill.ts'
import { ManagedToolSearch } from './tool-search.ts'
import type { CapabilityId, EntryStatus, ManagedEntry, ManagerDocument, ManagerResult, ManagerSnapshot } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    capabilityManager: CapabilityManager
  }
}

/** Host-local persistence and runtime policies. */
export interface Config {
  /** Absolute configuration file; omission uses $DSH_HOME/capabilities.json. */
  dataFile?: string
  /** Timeout for managed MCP tool calls and resource requests, in milliseconds. */
  toolCallTimeoutMs: number
  /** Watch imported Skill bundles for edits. */
  watchSkills: boolean
}

interface MountedEntry {
  configuration: string
  read(): Promise<EntryStatus>
  dispose(): Promise<void>
}

/** Owns only entries created through this manager; existing provider and MCP plugins remain independent. */
export default class CapabilityManager extends TypertRemoteService {
  static inject = ['skills', 'tools', 'systemPrompt']
  static Config: z<Partial<Config>, Config> = z.object({
    dataFile: z.string(),
    toolCallTimeoutMs: z.number().min(1).default(60000),
    watchSkills: z.boolean().default(true),
  })

  private readonly filename: string
  private document: ManagerDocument = { version: 1, revision: 0, entries: [] }
  private readonly mounted = new Map<CapabilityId, MountedEntry>()
  private tail: Promise<void> = Promise.resolve()
  private stopping = false
  private readonly toolSearch: ManagedToolSearch

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'capabilityManager')
    if (config.dataFile !== undefined && !isAbsolute(config.dataFile)) throw new Error('capability-manager: dataFile must be absolute')
    this.filename = config.dataFile ?? join(resolveDshHome(), 'capabilities.json')
    this.toolSearch = new ManagedToolSearch(ctx)
    ctx.on('internal/plugin', (fiber) => { if (fiber === ctx.fiber && fiber.uid === null) this.stopping = true }, { global: true })
    ctx.effect(() => async () => {
      this.stopping = true
      await this.tail
      await Promise.all([...this.mounted.values()].map(entry => entry.dispose()))
      this.mounted.clear()
    }, 'capability-manager.runtime')
  }

  async [Service.init](): Promise<void> {
    await this.serial(async () => { await this.reconcile(await this.readDocument()) })
  }

  /**
   * Read desired configuration and current local runtime state; external file revisions are reconciled first.
   * @param signal - optional caller cancellation before work begins; omission does not cancel the read.
   * @returns the current file revision, entries, and runtime observations.
   */
  @Remote
  async list(signal?: AbortSignal): Promise<ManagerSnapshot> {
    return this.serial(async () => {
      signal?.throwIfAborted()
      this.assertRunning()
      const document = await this.readDocument()
      if (document.revision !== this.document.revision) await this.reconcile(document)
      return this.snapshot()
    })
  }

  /**
   * Add or replace one entry after validating its input and the caller's revision.
   * @param entry - complete Skill or MCP entry; its id remains stable across edits.
   * @param revision - last observed configuration revision.
   * @param signal - optional cancellation before the file commit; omission leaves the operation uncancelled.
   * @returns the saved configuration and runtime outcome, or a failure that leaves the file unchanged.
   */
  @Remote
  async save(entry: ManagedEntry, revision: number, signal?: AbortSignal): Promise<ManagerResult> {
    return this.change(revision, async (document) => {
      const parsed = entrySchema.parse(entry)
      if (parsed.kind === 'skill' && parsed.enabled) {
        parsed.directory = await realpath(resolve(expandHomePath(parsed.directory)))
        const controller = new AbortController()
        const probe = createManagedSkill(this.ctx, parsed, { signal: controller.signal, invalidate: () => {} }, false)
        try { await probe.list({}) } finally { controller.abort(); await probe.dispose() }
      }
      const entries = document.entries.some(existing => existing.id === parsed.id)
        ? document.entries.map(existing => existing.id === parsed.id ? parsed : existing)
        : [...document.entries, parsed]
      return { ...document, entries }
    }, signal)
  }

  /**
   * Remove a registration without deleting its Skill directory or any external MCP data.
   * @param id - entry to remove.
   * @param revision - last observed configuration revision.
   * @param signal - optional cancellation before the file commit; omission leaves the operation uncancelled.
   * @returns the committed configuration or a rejected mutation.
   */
  @Remote
  async deleteEntry(id: CapabilityId, revision: number, signal?: AbortSignal): Promise<ManagerResult> {
    return this.change(revision, (document) => {
      if (!document.entries.some(entry => entry.id === id)) throw new Error('Capability no longer exists; refresh the list')
      return { ...document, entries: document.entries.filter(entry => entry.id !== id) }
    }, signal)
  }

  /**
   * Recreate an enabled runtime without changing the saved configuration.
   * @param id - entry whose registration or MCP connection should be retried.
   * @param revision - last observed configuration revision.
   * @param signal - optional cancellation before the retry begins; omission leaves the operation uncancelled.
   * @returns the resulting local runtime state, or a conflict requiring refresh.
   */
  @Remote
  async retry(id: CapabilityId, revision: number, signal?: AbortSignal): Promise<ManagerResult> {
    return this.serial(async () => {
      signal?.throwIfAborted()
      if (this.stopping) return { ok: false, code: 'stopping', message: 'The Host is shutting down' }
      const document = await this.readDocument()
      if (document.revision !== revision) return this.conflict()
      await this.reconcile(document)
      const entry = document.entries.find(value => value.id === id)
      if (entry === undefined || !entry.enabled) return { ok: false, code: 'invalid', message: 'Select an enabled capability to retry' }
      await this.mounted.get(id)?.dispose()
      this.mounted.delete(id)
      await this.mount(entry)
      return { ok: true, snapshot: await this.snapshot() }
    })
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.then(() => {}, () => {})
    return result
  }

  private assertRunning(): void {
    if (this.stopping) throw new Error('capability-manager: Host is shutting down')
  }

  private conflict(): ManagerResult {
    return { ok: false, code: 'conflict', message: 'Configuration changed in another view; refresh before saving' }
  }

  private async readDocument(): Promise<ManagerDocument> {
    let content: string
    try {
      content = await readFile(this.filename, 'utf8')
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return { version: 1, revision: 0, entries: [] }
      throw error
    }
    return documentSchema.parse(JSON.parse(content))
  }

  private change(
    revision: number, update: (document: ManagerDocument) => ManagerDocument | Promise<ManagerDocument>, signal?: AbortSignal,
  ): Promise<ManagerResult> {
    return this.serial(async () => {
      signal?.throwIfAborted()
      if (this.stopping) return { ok: false, code: 'stopping', message: 'The Host is shutting down' }
      if (!Number.isSafeInteger(revision) || revision < 0) return { ok: false, code: 'invalid', message: 'Invalid configuration revision' }
      await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 })
      const outcome = await withFileLock(this.filename, async (): Promise<ManagerDocument | ManagerResult> => {
        const document = await this.readDocument()
        if (document.revision !== revision) return this.conflict()
        let next: ManagerDocument
        try {
          next = documentSchema.parse({ ...await update(document), revision: revision + 1 })
        } catch (error) {
          return { ok: false, code: 'invalid', message: error instanceof Error ? error.message : String(error) }
        }
        this.assertRunning()
        signal?.throwIfAborted()
        try {
          await writeFileAtomic(this.filename, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
        } catch (error) {
          return { ok: false, code: 'storage', message: error instanceof Error ? error.message : String(error) }
        }
        return next
      }, signal === undefined ? undefined : { signal })
      if ('ok' in outcome) return outcome
      await this.reconcile(outcome)
      return { ok: true, snapshot: await this.snapshot() }
    })
  }

  private async reconcile(document: ManagerDocument): Promise<void> {
    for (const [id, mounted] of this.mounted) {
      const entry = document.entries.find(candidate => candidate.id === id)
      if (entry === undefined || !entry.enabled || mounted.configuration !== JSON.stringify(entry)) {
        await mounted.dispose()
        this.mounted.delete(id)
      }
    }
    this.document = document
    for (const entry of document.entries) {
      if (this.stopping) return
      if (entry.enabled && !this.mounted.has(entry.id)) await this.mount(entry)
    }
  }

  private async mount(entry: ManagedEntry): Promise<void> {
    this.assertRunning()
    let connection: ConnectionHandle | undefined
    let skillProvider: ReturnType<typeof createManagedSkill> | undefined
    // Declare the services this fiber consumes. A bare `ctx.plugin(async)` gives
    // the fiber no `inject`, so on remount (the 重连 button disposes the old
    // fiber first) connectMcpServer() → syncTools() → ctx.tools.register() ran
    // before `tools` was available and threw
    // `cannot get property "tools" without inject`, which mcp-client wraps as
    // `initial connection or tool synchronization failed`.
    const fiber = this.ctx.plugin({
      name: `capability-manager.${entry.kind}`,
      inject: ['tools', 'skills', 'systemPrompt'],
      apply: async (inner: Context) => {
        if (entry.kind === 'mcp') {
          connection = await connectMcpServer(this.toolSearch.bridgeContext(inner, entry.name), McpConfig({
            ...entry.connection, serverName: entry.name,
            toolCallTimeoutMs: this.config.toolCallTimeoutMs, failOnStartupError: true,
          }))
        } else {
          let provider!: ReturnType<typeof createManagedSkill>
          inner.skills.registerProvider((control) => {
            provider = createManagedSkill(inner, entry, control, this.config.watchSkills)
            skillProvider = provider
            return provider
          })
          inner.effect(() => async () => { await provider.dispose() }, 'managed-skill.watchers')
          await provider.list({})
        }
      },
    })
    let failure: string | null = null
    try {
      await fiber.await()
    } catch (error) {
      failure = error instanceof Error
        ? `${error.message}${error.cause instanceof Error ? `: ${error.cause.message}` : ''}` : String(error)
      await fiber.dispose()
    }
    this.mounted.set(entry.id, {
      configuration: JSON.stringify(entry), dispose: () => fiber.dispose(),
      read: async () => {
        let skills: EntryStatus['skills'] = []
        let error = failure
        if (error === null && skillProvider !== undefined) {
          try {
            skills = (await skillProvider.list({})).map(({ name, description }) => ({ name, description }))
          } catch (reason) {
            error = reason instanceof Error ? reason.message : String(reason)
          }
        }
        const observation = connection?.snapshot()
        return {
          id: entry.id, status: error !== null ? 'failed' : observation?.status === 'disposed' ? 'disconnected' : observation?.status ?? 'ready',
          tools: observation?.tools ?? 0, error, skills,
        }
      },
    })
  }

  private async snapshot(): Promise<ManagerSnapshot> {
    return {
      ...this.document,
      statuses: await Promise.all(this.document.entries.map(async (entry): Promise<EntryStatus> => {
        const mounted = this.mounted.get(entry.id)
        return mounted === undefined ? {
          id: entry.id, status: 'disabled', tools: 0, error: null, skills: [],
        } : await mounted.read()
      })),
    }
  }
}
