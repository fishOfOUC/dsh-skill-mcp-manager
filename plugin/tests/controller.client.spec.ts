/** Catalog races, rejected writes, and request lifetime ownership. */
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-capability-manager/remote'
import { expect, it, onTestFinished, vi } from 'vitest'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { ManagerController } from '../src/client/controller.ts'
import type { ManagedSkill, CapabilityId, ManagerSnapshot } from '../src/types.ts'

const snapshot: ManagerSnapshot = { version: 1, revision: 0, entries: [], statuses: [] }
const entry: ManagedSkill = { id: '591c82cb-467d-4095-8328-66d38f4e4088' as CapabilityId, name: 'Review', kind: 'skill', directory: '/skills/review', enabled: true }
type Api = Context['remote']['capabilityManager']

it('shows a new MCP immediately while the Host is still connecting', async () => {
  const b = bench()
  await b.controller.load()
  const gate = Promise.withResolvers<Awaited<ReturnType<Api['save']>>>()
  b.save.mockReturnValueOnce(gate.promise)
  const server = { id: entry.id, kind: 'mcp' as const, name: 'pending', enabled: true,
    connection: { transport: 'stdio' as const, command: 'node', args: [], env: {}, cwd: '' } }
  const saving = b.controller.save(server)
  expect(b.controller.state.getSnapshot().snapshot?.entries).toEqual([server])
  expect(b.controller.state.getSnapshot().snapshot?.statuses[0]?.status).toBe('connecting')
  gate.resolve({ ok: true, value: { ok: true, snapshot: { ...snapshot, revision: 1, entries: [server],
    statuses: [{ id: server.id, status: 'connected', tools: 1, skills: [], error: null }] } } })
  expect(await saving).toBe(true)
  expect(b.controller.state.getSnapshot().snapshot?.statuses[0]?.status).toBe('connected')
})

it('restores the previous rows when a pending add is rejected', async () => {
  const b = bench()
  await b.controller.load()
  b.save.mockResolvedValueOnce({ ok: true, value: { ok: false, code: 'invalid', message: 'Invalid directory' } })
  expect(await b.controller.save(entry)).toBe(false)
  expect(b.controller.state.getSnapshot().snapshot).toEqual(snapshot)
})

it('refreshes a conflicting revision before the next submission', async () => {
  const b = bench()
  await b.controller.load()
  const latest = { ...snapshot, revision: 4 }
  b.save.mockResolvedValueOnce({ ok: true, value: { ok: false, code: 'conflict', message: 'Refresh before saving' } })
  b.list.mockResolvedValueOnce({ ok: true, value: latest })
  expect(await b.controller.save(entry)).toBe(false)
  expect(b.controller.state.getSnapshot().snapshot).toEqual(latest)
  await b.controller.save(entry)
  expect(b.save).toHaveBeenLastCalledWith(entry, 4, expect.any(AbortSignal))
})

function bench() {
  const ctx = new Context()
  const list = vi.fn<Api['list']>().mockResolvedValue({ ok: true, value: snapshot })
  const save = vi.fn<Api['save']>().mockResolvedValue({ ok: true, value: { ok: true, snapshot: { ...snapshot, revision: 1, entries: [entry] } } })
  const deleteEntry = vi.fn<Api['deleteEntry']>().mockResolvedValue({ ok: true, value: { ok: true, snapshot: { ...snapshot, revision: 2 } } })
  const retry = vi.fn<Api['retry']>().mockResolvedValue({ ok: true, value: { ok: true, snapshot } })
  new TestRemote(ctx, { capabilityManager: { list, save, deleteEntry, retry } })
  const controller = new ManagerController(ctx)
  onTestFinished(async () => { await controller.dispose(); await ctx.fiber.dispose() })
  return { ctx, list, save, deleteEntry, retry, controller }
}

it('keeps the last good catalog after a failed refresh and recovers on retry', async () => {
  const b = bench()
  await b.controller.load()
  b.list.mockRejectedValueOnce(new Error('Host unavailable'))
  await b.controller.load()
  expect(b.controller.state.getSnapshot()).toMatchObject({ status: 'failed', snapshot, loadError: 'Host unavailable' })
  await b.controller.load()
  expect(b.controller.state.getSnapshot()).toMatchObject({ status: 'ready', loadError: null })
})

it('does not publish an older read over a successful save', async () => {
  const b = bench()
  await b.controller.load()
  const old = Promise.withResolvers<Awaited<ReturnType<Api['list']>>>()
  b.list.mockReturnValueOnce(old.promise)
  const reading = b.controller.load()
  await b.controller.save(entry)
  old.resolve({ ok: true, value: snapshot })
  await reading
  expect(b.controller.state.getSnapshot().snapshot?.revision).toBe(1)
  expect(b.controller.state.getSnapshot().notice?.kind).toBe('saved')
})

it('preserves the revision and reports rejected writes without pretending they were committed', async () => {
  const b = bench()
  await b.controller.load()
  b.save.mockResolvedValueOnce({ ok: true, value: { ok: false, code: 'conflict', message: 'Refresh before saving' } })
  expect(await b.controller.save(entry)).toBe(false)
  expect(b.controller.state.getSnapshot()).toMatchObject({ busy: false, snapshot, notice: { kind: 'error', detail: 'Refresh before saving' } })
  b.controller.dismiss()
  expect(b.controller.state.getSnapshot().notice).toBeNull()
  expect(await b.controller.save(entry)).toBe(true)
  expect(await b.controller.retry(entry.id)).toBe(true)
  expect(await b.controller.remove(entry.id)).toBe(true)
  expect(b.controller.state.getSnapshot().notice?.kind).toBe('removed')
})

it('ignores duplicate mutations and awaits an aborted request without publishing its late answer', async () => {
  const b = bench()
  await b.controller.load()
  const response = Promise.withResolvers<Awaited<ReturnType<Api['save']>>>()
  b.save.mockReturnValueOnce(response.promise)
  const saving = b.controller.save(entry)
  await vi.waitFor(() => { expect(b.save).toHaveBeenCalledOnce() })
  expect(await b.controller.save(entry)).toBe(false)
  const stopping = b.controller.dispose()
  const before = b.controller.state.getSnapshot()
  response.resolve({ ok: true, value: { ok: true, snapshot: { ...snapshot, revision: 1 } } })
  await stopping
  expect(await saving).toBe(false)
  expect(b.controller.state.getSnapshot()).toBe(before)
})

it('contains synchronous transport failures during both refresh and mutation', async () => {
  const b = bench()
  b.list.mockImplementationOnce(() => { throw new Error('Namespace unavailable') })
  await b.controller.load()
  expect(b.controller.state.getSnapshot().status).toBe('failed')
  await b.controller.load()
  b.save.mockImplementationOnce(() => { throw new Error('Connection lost before dispatch') })
  expect(await b.controller.save(entry)).toBe(false)
  expect(b.controller.state.getSnapshot()).toMatchObject({ busy: false, notice: { kind: 'uncertain', detail: 'Connection lost before dispatch' } })
})
