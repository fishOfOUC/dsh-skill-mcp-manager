/** Real filesystem registration, persistence, and MCP transport acceptance. */
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished } from 'vitest'
import Skills from '@deepseek-ai/dsh-skill'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { TOOL_SEARCH_NAME } from '../src/tool-search.ts'
import CapabilityManager from '../src/index.ts'
import type { CapabilityId, ManagedMcp, ManagedSkill, ManagerResult } from '../src/types.ts'
import { startHttpMcpFixture } from '../../../../openSourceSoft/deepseek-harness/packages/mcp/mcp-client/tests/http-fixture.ts'

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-capabilities-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  return root
}

async function mount(filename: string) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(Tools).await()
  await ctx.plugin(NativeToolExecutor).await()
  await ctx.plugin(Skills).await()
  const fiber = ctx.plugin(CapabilityManager, CapabilityManager.Config({ dataFile: filename, watchSkills: false }))
  await fiber.await()
  return { ctx, fiber, manager: ctx.capabilityManager }
}

function accepted(result: ManagerResult) {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.message)
  return result.snapshot
}

async function discover(ctx: Context, name: string) {
  const agent = { id: randomUUID() } as Agent
  const signal = new AbortController().signal
  const modelSelection = { provider: 'fixture', model: 'fixture' }
  const initial = await ctx.tools.resolve({ agent, signal, modelSelection })
  expect(ctx.tools.schemas(agent, initial).map(tool => tool.name)).toEqual([TOOL_SEARCH_NAME])
  const result = await executeToolFixture(ctx, {
    agent, signal, toolSet: initial, name: TOOL_SEARCH_NAME, arguments: { query: name, limit: 1 }, callId: ToolCallId('discover'),
  })
  initial.dispose()
  expect(result.isError).toBe(false)
  expect(result.value).toMatchObject({ tools: [{ name }] })
  const toolSet = await ctx.tools.resolve({ agent, signal, modelSelection })
  onTestFinished(() => toolSet.dispose())
  return { agent, signal, toolSet }
}

async function skill(root: string): Promise<ManagedSkill> {
  const directory = join(root, 'skill-bundles', 'triage')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), '---\nname: triage\ndescription: Inspect a failure before editing.\n---\nRead ./references/check.md first.\n')
  return { id: randomUUID() as CapabilityId, kind: 'skill', name: 'Triage', directory, enabled: true }
}

describe('unified capability management', () => {
  it('keeps insertion order when an earlier MCP is disabled, enabled, or renamed', async () => {
    const root = await workspace()
    const { manager } = await mount(join(root, 'manager.json'))
    const first: ManagedMcp = { id: randomUUID() as CapabilityId, kind: 'mcp', name: 'first', enabled: false,
      connection: { transport: 'stdio', command: join(root, 'missing'), args: [], env: {}, cwd: '' } }
    const second = { ...first, id: randomUUID() as CapabilityId, name: 'second' }
    accepted(await manager.save(first, 0))
    accepted(await manager.save(second, 1))
    expect(accepted(await manager.save({ ...first, enabled: true }, 2)).entries.map(entry => entry.id)).toEqual([first.id, second.id])
    expect(accepted(await manager.save({ ...first, name: 'renamed' }, 3)).entries.map(entry => entry.id)).toEqual([first.id, second.id])
    expect((await manager.list()).entries.map(entry => entry.name)).toEqual(['renamed', 'second'])
  })

  it('imports, disables, restores, and removes a Skill without deleting its source', async () => {
    const root = await workspace()
    const { ctx, manager, fiber } = await mount(join(root, 'capabilities.json'))
    const entry = await skill(root)
    const saved = accepted(await manager.save(entry, 0))
    expect(saved.statuses).toMatchObject([{ status: 'ready', skills: [{ name: 'triage' }] }])
    const loaded = await ctx.skills.get('triage')
    expect(loaded?.content).toContain('Read ./references/check.md first.')
    expect(loaded?.resourceBase).toEqual({ kind: 'directory', path: await realpath(entry.directory) })
    accepted(await manager.save({ ...entry, enabled: false }, 1))
    expect(await ctx.skills.get('triage')).toBeUndefined()
    accepted(await manager.save(entry, 2))
    expect(await ctx.skills.get('triage')).toBeDefined()
    accepted(await manager.deleteEntry(entry.id, 3))
    expect(await ctx.skills.get('triage')).toBeUndefined()
    expect(await readFile(join(entry.directory, 'SKILL.md'), 'utf8')).toContain('name: triage')
    await fiber.dispose()
  })

  it('retains disabled entries across service reload and rejects stale writers', async () => {
    const root = await workspace()
    const file = join(root, 'manager.json')
    const first = await mount(file)
    const entry = { ...await skill(root), enabled: false }
    accepted(await first.manager.save(entry, 0))
    await first.fiber.dispose()
    const second = await mount(file)
    expect((await second.manager.list()).entries).toEqual([entry])
    expect(await second.manager.deleteEntry(entry.id, 0)).toMatchObject({ ok: false, code: 'conflict' })
    expect((await second.manager.list()).revision).toBe(1)
  })

  it('rejects invalid bundles and duplicate MCP namespaces before committing', async () => {
    const root = await workspace()
    const { manager } = await mount(join(root, 'manager.json'))
    const entry = await skill(root)
    expect(await manager.save({ ...entry, directory: root }, 0)).toMatchObject({ ok: false, code: 'invalid' })
    const server: ManagedMcp = { id: randomUUID() as CapabilityId, kind: 'mcp', name: 'shared', enabled: false, connection: { transport: 'stdio', command: 'unused', args: [], env: {}, cwd: '' } }
    accepted(await manager.save(server, 0))
    expect(await manager.save({ ...server, id: randomUUID() as CapabilityId }, 1)).toMatchObject({ ok: false, code: 'invalid' })
    expect((await manager.list()).entries).toHaveLength(1)
  })

  it('allows disabling a Skill whose source was removed and serializes competing writes', async () => {
    const root = await workspace()
    const { ctx, manager } = await mount(join(root, 'manager.json'))
    const entry = await skill(root)
    accepted(await manager.save(entry, 0))
    await rm(join(entry.directory, 'SKILL.md'))
    const results = await Promise.all([manager.save({ ...entry, enabled: false }, 1), manager.deleteEntry(entry.id, 1)])
    expect(results.map(result => result.ok)).toEqual([true, false])
    expect(results[1]).toMatchObject({ code: 'conflict' })
    expect(await ctx.skills.get('triage')).toBeUndefined()
  })

  it('connects, discovers real MCP tools, reconnects, and releases all registrations on disable and unload', async () => {
    const root = await workspace()
    const fixture = await startHttpMcpFixture()
    onTestFinished(() => fixture.close())
    const { ctx, manager, fiber } = await mount(join(root, 'manager.json'))
    const entry: ManagedMcp = { id: randomUUID() as CapabilityId, kind: 'mcp', name: 'managed', enabled: true, connection: { transport: 'streamable-http', url: fixture.url, headers: { Authorization: 'fixture-only' } } }
    const saved = accepted(await manager.save(entry, 0))
    expect(saved.statuses, JSON.stringify(saved.statuses)).toMatchObject([{ status: 'connected', tools: 1 }])
    expect(ctx.tools.schemas().map(tool => tool.name)).toContain('mcp__managed__ping')
    expect(fixture.authorization).toContain('fixture-only')
    const called = await executeToolFixture(ctx, {
      ...await discover(ctx, 'mcp__managed__ping'),
      name: 'mcp__managed__ping', arguments: {}, callId: ToolCallId('managed-ping'), signal: new AbortController().signal,
    })
    expect(called.isError, JSON.stringify(called)).toBe(false)
    expect(called).toMatchObject({ isError: false, value: { content: [{ type: 'text', text: 'pong' }] } })
    expect(fixture.calls).toEqual(['ping'])
    expect(accepted(await manager.retry(entry.id, 1)).statuses[0]?.status).toBe('connected')
    accepted(await manager.save({ ...entry, enabled: false }, 1))
    expect(ctx.tools.schemas().map(tool => tool.name)).toEqual([TOOL_SEARCH_NAME])
    accepted(await manager.save(entry, 2))
    await fiber.dispose()
    expect(ctx.tools.schemas()).toEqual([])
  })

  it('retains failed MCP configuration for correction instead of reporting it connected', async () => {
    const root = await workspace()
    const { manager } = await mount(join(root, 'manager.json'))
    const entry: ManagedMcp = { id: randomUUID() as CapabilityId, kind: 'mcp', name: 'broken', enabled: true, connection: { transport: 'stdio', command: join(root, 'does-not-exist'), args: [], env: {}, cwd: '' } }
    const result = accepted(await manager.save(entry, 0))
    expect(result.entries).toEqual([entry])
    expect(result.statuses[0]).toMatchObject({ status: 'failed', tools: 0 })
    expect(result.statuses[0]?.error).toBeTruthy()
    accepted(await manager.deleteEntry(entry.id, 1))
  })

  it('runs a managed stdio server and unregisters its executable tools on removal', async () => {
    const root = await workspace()
    const { ctx, manager } = await mount(join(root, 'manager.json'))
    const entry: ManagedMcp = {
      id: randomUUID() as CapabilityId, kind: 'mcp', name: 'local', enabled: true,
      connection: {
        transport: 'stdio', command: process.execPath,
        args: ['--import', pathToFileURL(createRequire(new URL('../../../../openSourceSoft/deepseek-harness/package.json', import.meta.url)).resolve('tsx/esm')).href, fileURLToPath(new URL('../../../../openSourceSoft/deepseek-harness/packages/mcp/mcp-client/tests/fixture-server.ts', import.meta.url))],
        env: {}, cwd: process.cwd(),
      },
    }
    const saved = accepted(await manager.save(entry, 0))
    expect(saved.statuses[0], JSON.stringify(saved.statuses)).toMatchObject({ status: 'connected', tools: 6 })
    const result = await executeToolFixture(ctx, {
      ...await discover(ctx, 'mcp__local__add'),
      name: 'mcp__local__add', arguments: { a: 2, b: 3 }, callId: ToolCallId('managed-stdio-add'), signal: new AbortController().signal,
    })
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(result).toMatchObject({ isError: false, value: { content: [{ type: 'text', text: '5' }] } })
    accepted(await manager.deleteEntry(entry.id, 1))
    expect(ctx.tools.schemas().map(tool => tool.name)).toEqual([TOOL_SEARCH_NAME])
  })

  it('refuses unknown persisted versions instead of replacing user data', async () => {
    const root = await workspace()
    const file = join(root, 'manager.json')
    await writeFile(file, '{"version":99,"revision":0,"entries":[]}\n')
    await expect(mount(file)).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toContain('"version":99')
  })
})
