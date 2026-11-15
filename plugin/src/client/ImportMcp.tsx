/** JSON import uses the same persistence and connection operation as the form editor. */
import { useId, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { parseMcpJson } from '../mcp-json.ts'
import type { ManagedEntry } from '../types.ts'
import css from './Manager.module.css'

type ImportMcpProps = PropsLocale<'capabilityManager'> & {
  entries: ManagedEntry[]
  busy: boolean
  onSave: (entry: ManagedEntry) => Promise<boolean>
  onClose: () => void
  onPending: (pending: boolean) => void
}

const example = JSON.stringify({ mcpServers: { reqable: {
  command: 'E:\\tools\\toolssoft\\Reqable\\Reqable\\mcp-server.exe', args: [], env: { REQABLE_TOKEN: '<token>' },
} } }, null, 2)

/**
 * Preview and register pasted servers; stop on a failed save and retain the remaining JSON.
 * @param props - current entries, serialized save operation, locale and dialog lifecycle.
 * @returns a desktop-width JSON import dialog.
 */
export function ImportMcp({ entries, busy, onSave, onClose, onPending, t }: ImportMcpProps) {
  const id = useId()
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const submitting = useRef(false)
  const parsed = useMemo(() => {
    try { return parseMcpJson(text) } catch (_invalidJson) { return null }
  }, [text])
  const locked = busy || pending
  const submit = async () => {
    if (locked || submitting.current) return
    if (!parsed) { setError(t('jsonInvalid')); return }
    const names = new Set(entries.filter(entry => entry.kind === 'mcp').map(entry => entry.name))
    const duplicates = parsed.filter(entry => names.has(entry.name)).map(entry => entry.name)
    if (duplicates.length) { setError(t('jsonDuplicate', { names: duplicates.join(', ') })); return }
    submitting.current = true
    setPending(true)
    onPending(true)
    setError('')
    try {
      for (let index = 0; index < parsed.length; index++) {
        if (!await onSave(parsed[index]!)) {
          const remaining = Object.fromEntries(Object.entries(JSON.parse(text).mcpServers).slice(index))
          setText(JSON.stringify({ mcpServers: remaining }, null, 2))
          setError(t('jsonStopped', { count: index }))
          return
        }
      }
      onClose()
    } finally {
      submitting.current = false
      setPending(false)
      onPending(false)
    }
  }
  return <Modal open={!pending} className={clsx(css.editor)} contentClassName={clsx(css.editorContent)} title={t('importJson')} closeLabel={t('close')} backdropBlur={false} onClose={() => { if (!locked) onClose() }}>
    <form className={css.form} onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <p className={css.hint}>{t('jsonHelp')}</p>
      <div className={css.field}>
        <label htmlFor={id}>{t('jsonConfig')}</label>
        <textarea id={id} value={text} onChange={(event) => { setText(event.target.value); setError('') }} placeholder={example} spellCheck={false} disabled={locked} rows={15} autoComplete="off" aria-invalid={!!error} />
      </div>
      {parsed && <p className={css.hint} role="status">{t('jsonReady', { count: parsed.length, names: parsed.map(entry => entry.name).join(', ') })}</p>}
      {error && <p role="alert" className={css.error}>{error}</p>}
      <div className={css.footer}>
        <Button disabled={locked} onClick={onClose}>{t('cancel')}</Button>
        <Button type="submit" variant="primary" disabled={locked || !text.trim()}>{t(pending ? 'saving' : 'jsonRegister')}</Button>
      </div>
    </form>
  </Modal>
}
