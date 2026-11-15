/** Local draft editor with validated submissions and caller-owned save feedback. */
import { useId, useState } from 'react'
import clsx from 'clsx'
import { Button, Input, Modal, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ManagedEntry, McpTransport } from '../types.ts'
import { entrySchema } from '../schema.ts'
import css from './Manager.module.css'

type EditorProps = PropsLocale<'capabilityManager'> & {
  entry: ManagedEntry
  busy: boolean
  onSave: (entry: ManagedEntry) => Promise<boolean>
  onClose: () => void
}

function parseJson(text: string): unknown { return JSON.parse(text) }

/**
 * Edit one Skill directory or MCP server, preserving the draft after any rejected save.
 * @param props - entry, mutation callbacks, and localized copy.
 * @returns the accessible editor dialog.
 */
export function Editor({ entry, busy, onSave, onClose, t }: EditorProps) {
  const prefix = useId()
  const initial = entry.kind === 'mcp' ? entry.connection : undefined
  const [name, setName] = useState(entry.name)
  const [enabled, setEnabled] = useState(entry.enabled)
  const [directory, setDirectory] = useState(entry.kind === 'skill' ? entry.directory : '')
  const [transport, setTransport] = useState<McpTransport['transport']>(initial?.transport ?? 'stdio')
  const [command, setCommand] = useState(initial?.transport === 'stdio' ? initial.command : '')
  const [args, setArgs] = useState(JSON.stringify(initial?.transport === 'stdio' ? initial.args : [], null, 2))
  const [env, setEnv] = useState(JSON.stringify(initial?.transport === 'stdio' ? initial.env : {}, null, 2))
  const [cwd, setCwd] = useState(initial?.transport === 'stdio' ? initial.cwd : '')
  const [url, setUrl] = useState(initial?.transport === 'streamable-http' ? initial.url : '')
  const [headers, setHeaders] = useState(JSON.stringify(initial?.transport === 'streamable-http' ? initial.headers : {}, null, 2))
  const [error, setError] = useState(false)
  const submit = async () => {
    let value: ManagedEntry
    try {
      const base = { id: entry.id, name, enabled }
      value = entrySchema.parse(entry.kind === 'skill' ? { ...base, kind: 'skill', directory } : {
        ...base, kind: 'mcp', connection: transport === 'stdio'
          ? { transport, command, args: parseJson(args), env: parseJson(env), cwd }
          : { transport, url, headers: parseJson(headers) },
      })
    } catch (_invalidDraft) {
      setError(true)
      return
    }
    setError(false)
    if (await onSave(value)) onClose()
  }
  const textField = (key: 'name' | 'directory' | 'command' | 'cwd' | 'url', value: string, change: (value: string) => void) => (
    <div className={css.field}>
      <label htmlFor={`${prefix}-${key}`}>{t(key)}</label>
      <Input id={`${prefix}-${key}`} value={value} onChange={(event) => { change(event.target.value) }} required={key !== 'cwd'} disabled={busy} autoComplete="off" />
    </div>
  )
  const jsonField = (key: 'args' | 'env' | 'headers', value: string, change: (value: string) => void) => (
    <div className={css.field}>
      <label htmlFor={`${prefix}-${key}`}>{t(key)}</label>
      <textarea id={`${prefix}-${key}`} value={value} onChange={(event) => { change(event.target.value) }} spellCheck={false} disabled={busy} rows={8} />
    </div>
  )
  return <Modal open className={clsx(css.editor)} contentClassName={clsx(css.editorContent)} onClose={() => { if (!busy) onClose() }} title={entry.kind === 'skill' ? t('skills') : t('mcp')} closeLabel={t('close')} backdropBlur={false}>
    <form className={css.form} onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <div className={clsx(css.formGrid, entry.kind === 'skill' && css.singleColumn)}>
        {textField('name', name, setName)}
        {entry.kind === 'mcp' && <div className={css.field}><label htmlFor={`${prefix}-transport`}>{t('transport')}</label>
          <select id={`${prefix}-transport`} value={transport} disabled={busy} onChange={(event) => { setTransport(event.target.value as McpTransport['transport']) }}>
            <option value="stdio">{t('stdio')}</option><option value="streamable-http">{t('http')}</option>
          </select>
        </div>}
      </div>
      {entry.kind === 'skill' ? <>
        {textField('directory', directory, setDirectory)}
        <p className={css.hint}>{t('directoryHelp')}</p>
      </> : <>
        <p className={css.hint}>{t('namespaceHelp')}</p>
        {transport === 'stdio' ? <>
          {textField('command', command, setCommand)}
          {textField('cwd', cwd, setCwd)}
          <div className={css.formGrid}>
            {jsonField('args', args, setArgs)}
            {jsonField('env', env, setEnv)}
          </div>
        </> : <>{textField('url', url, setUrl)}{jsonField('headers', headers, setHeaders)}</>}
      </>}
      <div className={css.toggle}><span>{t('enabled')}</span><Switch checked={enabled} onChange={setEnabled} label={t('enabled')} disabled={busy} /></div>
      {error && <p role="alert" className={css.error}>{t('invalid')}</p>}
      <div className={css.footer}><Button disabled={busy} onClick={onClose}>{t('cancel')}</Button><Button type="submit" variant="primary" disabled={busy}>{t(busy ? 'saving' : 'save')}</Button></div>
    </form>
  </Modal>
}
