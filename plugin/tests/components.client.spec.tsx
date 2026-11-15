// @vitest-environment jsdom
/** User-visible editor validation, filtering, failed saves, and removal confirmation. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {} from '../src/client/index.ts'
import { Editor } from '../src/client/Editor.tsx'
import { ImportMcp } from '../src/client/ImportMcp.tsx'
import { ManagerPage, ManagerToast, type ManagerInjected } from '../src/client/ManagerPage.tsx'
import { en } from '../src/client/locales.ts'
import type { CapabilityId, ManagedMcp, ManagedSkill } from '../src/types.ts'

afterEach(cleanup)
const t: Parameters<typeof Editor>[0]['t'] = makeTranslate(en)
const skill: ManagedSkill = { id: '8e44c641-b38e-4d8e-bfa8-28d63630f928' as CapabilityId, kind: 'skill', name: 'Triage', directory: '/skills/triage', enabled: true }
const server: ManagedMcp = { id: '44001156-46a2-4253-b5a0-b0ce26159dd2' as CapabilityId, kind: 'mcp', name: 'notes', enabled: true, connection: { transport: 'stdio', command: 'node', args: ['server.mjs'], env: {}, cwd: '' } }

describe('capability manager editor', () => {
  it('rejects invalid argument JSON before contacting the Host and preserves failed drafts', async () => {
    const save = vi.fn<Parameters<typeof Editor>[0]['onSave']>().mockResolvedValue(false)
    const close = vi.fn()
    render(<Editor entry={server} busy={false} onSave={save} onClose={close} t={t} />)
    fireEvent.change(screen.getByLabelText(en.args), { target: { value: '{broken}' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect(screen.getByRole('alert').textContent).toBe(en.invalid)
    expect(save).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(en.args), { target: { value: '["edited.mjs"]' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(save).toHaveBeenCalledOnce() })
    expect(save).toHaveBeenCalledWith({ ...server, connection: { ...server.connection, args: ['edited.mjs'] } })
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByLabelText<HTMLTextAreaElement>(en.args).value).toBe('["edited.mjs"]')
  })

  it('switches to HTTP without leaking local-process fields and closes only after success', async () => {
    const save = vi.fn<Parameters<typeof Editor>[0]['onSave']>().mockResolvedValue(true)
    const close = vi.fn()
    render(<Editor entry={server} busy={false} onSave={save} onClose={close} t={t} />)
    fireEvent.change(screen.getByLabelText(en.transport), { target: { value: 'streamable-http' } })
    fireEvent.change(screen.getByLabelText(en.url), { target: { value: 'https://mcp.example.test/mcp' } })
    fireEvent.change(screen.getByLabelText(en.headers), { target: { value: '{"Authorization":"fixture-token"}' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(close).toHaveBeenCalledOnce() })
    expect(save).toHaveBeenCalledWith({ ...server, connection: { transport: 'streamable-http', url: 'https://mcp.example.test/mcp', headers: { Authorization: 'fixture-token' } } })
    expect(screen.queryByLabelText(en.command)).toBeNull()
  })
})

function page() {
  type State = ReturnType<ManagerInjected['hooks']['manager']['getSnapshot']>
  const state = createSnapshotStore<State>({
    status: 'ready', busy: false, loadError: null, notice: null,
    snapshot: { version: 1, revision: 2, entries: [skill, server], statuses: [
      { id: skill.id, status: 'ready', tools: 0, error: null, skills: [{ name: 'triage', description: 'Inspect failures' }] },
      { id: server.id, status: 'failed', tools: 0, error: 'Executable is missing', skills: [] },
    ] },
  })
  const actions = {
    save: vi.fn().mockResolvedValue(true), remove: vi.fn().mockResolvedValue(true), retry: vi.fn().mockResolvedValue(true),
    load: vi.fn().mockResolvedValue(undefined), dismiss: vi.fn(),
  }
  const props = { ...actions, t, useManager: bindSnapshotSelector(state) } as Parameters<typeof ManagerPage>[0]
  return { state, actions, props }
}

describe('capability manager panel', () => {
  it('reveals the list during a new save and restores the draft after rejection', async () => {
    const { props, actions } = page()
    const gate = Promise.withResolvers<boolean>()
    actions.save.mockReturnValueOnce(gate.promise)
    render(<ManagerPage {...props} />)
    fireEvent.click(screen.getByRole('tab', { name: 'MCP (1)' }))
    fireEvent.change(screen.getByLabelText(en.search), { target: { value: 'absent' } })
    fireEvent.click(screen.getByRole('button', { name: en.addMcp }))
    fireEvent.change(screen.getByLabelText(en.name), { target: { value: 'new-server' } })
    fireEvent.change(screen.getByLabelText(en.command), { target: { value: 'node' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(screen.getByLabelText<HTMLInputElement>(en.search).value).toBe('')
    await act(async () => { gate.resolve(false) })
    expect(screen.getByLabelText<HTMLInputElement>(en.name).value).toBe('new-server')
    expect(screen.getByLabelText<HTMLInputElement>(en.command).value).toBe('node')
  })

  it('reveals the MCP list while a JSON registration is pending', async () => {
    const { props, actions } = page()
    const gate = Promise.withResolvers<boolean>()
    actions.save.mockReturnValueOnce(gate.promise)
    render(<ManagerPage {...props} />)
    fireEvent.click(screen.getByRole('tab', { name: 'MCP (1)' }))
    fireEvent.click(screen.getByRole('button', { name: en.importJson }))
    fireEvent.change(screen.getByLabelText(en.jsonConfig), { target: { value: '{"mcpServers":{"pending":{"command":"node"}}}' } })
    fireEvent.click(screen.getByRole('button', { name: en.jsonRegister }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(screen.getByRole('heading', { name: 'notes' })).toBeTruthy()
    await act(async () => { gate.resolve(false) })
    expect(screen.getByLabelText<HTMLTextAreaElement>(en.jsonConfig).value).toContain('pending')
  })

  it('opens JSON import from the MCP tab and submits a complete registration', async () => {
    const { props, actions } = page()
    render(<ManagerPage {...props} />)
    fireEvent.click(screen.getByRole('tab', { name: 'MCP (1)' }))
    fireEvent.click(screen.getByRole('button', { name: en.importJson }))
    fireEvent.change(screen.getByLabelText(en.jsonConfig), { target: { value: JSON.stringify({ mcpServers: { reqable: { command: 'reqable.exe', env: { REQABLE_TOKEN: 'fixture' } } } }) } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.jsonRegister })) })
    expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'reqable', enabled: true, connection: { transport: 'stdio', command: 'reqable.exe', args: [], env: { REQABLE_TOKEN: 'fixture' }, cwd: '' } }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('filters Skills and switches to MCP while retaining visible runtime failures', () => {
    const { props } = page()
    render(<ManagerPage {...props} />)
    expect(screen.getByText('/skills/triage')).toBeTruthy()
    expect(screen.queryByText('Executable is missing')).toBeNull()
    fireEvent.change(screen.getByLabelText(en.search), { target: { value: 'absent' } })
    expect(screen.getByText(en.noMatches)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(en.search), { target: { value: '' } })
    fireEvent.click(screen.getByRole('tab', { name: 'MCP (1)' }))
    expect(screen.getByText(en.failed)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('Executable is missing')
  })

  it('confirms removal, applies toggles, and does not remove before confirmation', async () => {
    const { props, actions } = page()
    render(<ManagerPage {...props} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Enabled Triage' }))
    expect(actions.save).toHaveBeenCalledWith({ ...skill, enabled: false })
    fireEvent.click(screen.getByRole('button', { name: en.remove }))
    expect(actions.remove).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain(en.removeHelp)
    await act(async () => { fireEvent.click(dialog.querySelectorAll('button')[2]!) })
    expect(actions.remove).toHaveBeenCalledWith(skill.id)
  })

  it('disables writes after a failed refresh while preserving the last observed entries', () => {
    const { props, state } = page()
    state.update((value) => { value.status = 'failed'; value.loadError = 'Connection reset' })
    render(<ManagerPage {...props} />)
    expect(screen.getByText('/skills/triage')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.addSkill }).disabled).toBe(true)
    expect(screen.getByText('Connection reset')).toBeTruthy()
  })

  it('keeps operation feedback outside the panel', () => {
    const { props, state } = page()
    state.update((value) => { value.notice = { kind: 'error', detail: 'Refresh before saving', seq: 1 } })
    render(<ManagerToast {...props} />)
    expect(screen.getByText('Operation failed: Refresh before saving')).toBeTruthy()
  })
})

describe('MCP JSON dialog', () => {
  it('rejects malformed JSON and duplicate namespaces without saving', () => {
    const save = vi.fn().mockResolvedValue(true)
    render(<ImportMcp entries={[server]} busy={false} onSave={save} onClose={vi.fn()} onPending={vi.fn()} t={t} />)
    fireEvent.change(screen.getByLabelText(en.jsonConfig), { target: { value: '{broken' } })
    fireEvent.click(screen.getByRole('button', { name: en.jsonRegister }))
    expect(screen.getByRole('alert').textContent).toBe(en.jsonInvalid)
    fireEvent.change(screen.getByLabelText(en.jsonConfig), { target: { value: JSON.stringify({ mcpServers: { notes: { command: 'node' } } }) } })
    fireEvent.click(screen.getByRole('button', { name: en.jsonRegister }))
    expect(screen.getByRole('alert').textContent).toContain('notes')
    expect(save).not.toHaveBeenCalled()
  })

  it('stops after a failed save and retains only the unconfirmed entries', async () => {
    const save = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const close = vi.fn()
    render(<ImportMcp entries={[]} busy={false} onSave={save} onClose={close} onPending={vi.fn()} t={t} />)
    fireEvent.change(screen.getByLabelText(en.jsonConfig), { target: { value: JSON.stringify({ mcpServers: { first: { command: 'node' }, second: { command: 'node' }, third: { command: 'node' } } }) } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.jsonRegister })) })
    expect(save).toHaveBeenCalledTimes(2)
    expect(close).not.toHaveBeenCalled()
    expect(Object.keys(JSON.parse(screen.getByLabelText<HTMLTextAreaElement>(en.jsonConfig).value).mcpServers)).toEqual(['second', 'third'])
    expect(screen.getByRole('alert').textContent).toContain('Saved 1')
  })
})
