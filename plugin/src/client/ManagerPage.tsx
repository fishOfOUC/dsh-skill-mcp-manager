/** Sidebar-accessible management page and the app-wide operation feedback. */
import { useId, useState } from 'react'
import clsx from 'clsx'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import {
  Button, IconSkillOutlineRegular, Input, Modal, SegmentedTabs, Switch, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CapabilityId, ManagedEntry } from '../types.ts'
import type { ManagerController } from './controller.ts'
import { Editor } from './Editor.tsx'
import { ImportMcp } from './ImportMcp.tsx'
import css from './Manager.module.css'

/** Narrow state and action face shared by the registered page and feedback host. */
export interface ManagerInjected {
  hooks: { manager: HostObservable<ReturnType<ManagerController['state']['getSnapshot']>> }
  load: () => Promise<void>
  save: (entry: ManagedEntry) => Promise<boolean>
  remove: (id: CapabilityId) => Promise<boolean>
  retry: (id: CapabilityId) => Promise<boolean>
  dismiss: () => void
}

type ManagerProps = PropsRuntime<'main'> & InjectFace<ManagerInjected> & PropsLocale<'capabilityManager'>

/**
 * Render independently managed Skill bundles and MCP servers with their actual runtime states.
 * @param props - framework state hook, localized copy, and manager operations.
 * @returns the global management panel.
 */
export function ManagerPage({ useManager, load, save, remove, retry, t }: ManagerProps) {
  const state = useManager(value => value)
  const [tab, setTab] = useState<'skill' | 'mcp'>('skill')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<ManagedEntry | null>(null)
  const [removing, setRemoving] = useState<ManagedEntry | null>(null)
  const [importing, setImporting] = useState(false)
  const [importPending, setImportPending] = useState(false)
  const prefix = useId()
  const entries = state.snapshot?.entries ?? []
  const filtered = entries.filter(entry => entry.kind === tab && `${entry.name} ${entry.kind === 'skill' ? entry.directory : entry.connection.transport === 'stdio' ? entry.connection.command : entry.connection.url}`.toLowerCase().includes(query.toLowerCase()))
  const add = () => {
    const id = randomUUID() as CapabilityId
    setEditing(tab === 'skill' ? { id, kind: 'skill', name: '', directory: '', enabled: true } : {
      id, kind: 'mcp', name: '', enabled: true, connection: { transport: 'stdio', command: '', args: [], env: {}, cwd: '' },
    })
  }
  const unavailable = state.busy || importPending || state.snapshot === null || state.status === 'failed'
  const saveEditor = async (entry: ManagedEntry): Promise<boolean> => {
    const creating = !entries.some(existing => existing.id === entry.id)
    const saving = save(entry)
    if (creating) { setQuery(''); setEditing(null) }
    const saved = await saving
    if (!saved && creating) setEditing(entry)
    return saved
  }
  return <section className={css.page}>
    <div className={css.content}>
        <header className={css.heading}><h1>{t('title')}</h1><Button onClick={() => { void load() }} disabled={state.busy || importPending}>{t('refresh')}</Button></header>
      <p className={css.subtitle}>{t('subtitle')}</p>
      <div className={css.toolbar}>
        <SegmentedTabs size="sm" label={t('title')} value={tab} onChange={setTab} items={[
          { value: 'skill', label: `${t('skills')} (${entries.filter(entry => entry.kind === 'skill').length})`, id: `${prefix}-skill`, panelId: `${prefix}-list` },
          { value: 'mcp', label: `${t('mcp')} (${entries.filter(entry => entry.kind === 'mcp').length})`, id: `${prefix}-mcp`, panelId: `${prefix}-list` },
        ]} />
          <div className={css.actions}>
            {tab === 'mcp' && <Button onClick={() => { setImporting(true) }} disabled={unavailable}>{t('importJson')}</Button>}
            <Button variant="primary" onClick={add} disabled={unavailable}>{t(tab === 'skill' ? 'addSkill' : 'addMcp')}</Button>
          </div>
      </div>
      <Input className={clsx(css.search)} aria-label={t('search')} placeholder={t('search')} value={query} onChange={(event) => { setQuery(event.target.value) }} />
      {state.status === 'failed' && <div role="alert" className={css.notice}><p>{t('loadFailed')}</p><p className={css.error}>{state.loadError}</p><Button onClick={() => { void load() }}>{t('retry')}</Button></div>}
      <div role="tabpanel" id={`${prefix}-list`} aria-labelledby={`${prefix}-${tab}`} className={css.list} aria-busy={state.busy || state.status === 'loading'}>
        {state.status === 'loading' && <p className={css.empty}>{t('loading')}</p>}
        {state.status !== 'loading' && filtered.length === 0 && <p className={css.empty}>{t(query ? 'noMatches' : tab === 'skill' ? 'emptySkill' : 'emptyMcp')}</p>}
        {filtered.map((entry) => {
          const status = state.snapshot?.statuses.find(value => value.id === entry.id)
          return <article key={entry.id} className={css.row}>
            <div className={css.identity}>
              <div className={css.rowTitle}><h2>{entry.name}</h2><span className={status?.status === 'failed' || status?.status === 'disconnected' ? css.error : css.status}>{status && t(status.status)}</span></div>
              <p className={css.path}>{entry.kind === 'skill' ? entry.directory : entry.connection.transport === 'stdio' ? `${entry.connection.command} ${entry.connection.args.join(' ')}` : entry.connection.url}</p>
              {entry.kind === 'skill' && status?.skills.map(skill => <p key={skill.name} className={css.description}>{skill.name} · {skill.description}</p>)}
              {entry.kind === 'mcp' && status?.status === 'connected' && <p className={css.description}>{t('tools', { count: status.tools })}</p>}
              {status?.error && <p role="alert" className={css.error}>{status.error}</p>}
            </div>
            <div className={css.actions}>
              <Switch checked={entry.enabled} onChange={(enabled) => { void save({ ...entry, enabled }) }} label={`${t('enabled')} ${entry.name}`} disabled={unavailable} />
              <Button size="sm" onClick={() => { setEditing(entry) }} disabled={unavailable}>{t('edit')}</Button>
              {entry.enabled && <Button size="sm" onClick={() => { void retry(entry.id) }} disabled={unavailable}>{t(entry.kind === 'mcp' ? 'reconnect' : 'retry')}</Button>}
              <Button size="sm" onClick={() => { setRemoving(entry) }} disabled={unavailable}>{t('remove')}</Button>
            </div>
          </article>
        })}
      </div>
      <p className={css.hint}>{t('storageHelp')}</p>
    </div>
    {editing !== null && <Editor
      key={editing.id} entry={editing} busy={state.busy} onSave={saveEditor} onClose={() => { setEditing(null) }} t={t}
    />}
      {importing && <ImportMcp entries={entries} busy={state.busy || state.status === 'failed'} onSave={save} onClose={() => { setImporting(false); setQuery('') }} onPending={(pending) => { setImportPending(pending); if (pending) setQuery('') }} t={t} />}
    {removing !== null && <Modal open title={`${t('removeTitle')} · ${removing.name}`} description={t('removeHelp')} closeLabel={t('close')} backdropBlur={false} onClose={() => { if (!state.busy) setRemoving(null) }} footer={<>
      <Button disabled={state.busy} onClick={() => { setRemoving(null) }}>{t('cancel')}</Button>
      <Button variant="primary" disabled={state.busy} onClick={() => { void remove(removing.id).then((saved) => { if (saved) setRemoving(null) }) }}>{t('remove')}</Button>
    </>} />}
  </section>
}

/**
 * Keep operation feedback mounted independently of the page that requested it.
 * @param props - shared notice hook, dismissal, and localized copy.
 * @returns a transient app-wide toast when an operation settles.
 */
export function ManagerToast({ useManager, dismiss, t }: InjectFace<ManagerInjected> & PropsLocale<'capabilityManager'>) {
  const notice = useManager(state => state.notice)
  if (notice === null) return null
  const failed = notice.kind === 'error' || notice.kind === 'uncertain'
  const text = failed ? t(notice.kind, { detail: notice.detail }) : t(notice.kind)
  return <Toast key={notice.seq} text={text} {...failed ? {} : { tone: 'success' as const }} onDone={dismiss} />
}

/**
 * Supply the existing Skill glyph for the sidebar entry.
 * @param props - sidebar-owned icon size.
 * @returns the standard product icon.
 */
export function ManagerIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <IconSkillOutlineRegular size={size} />
}
