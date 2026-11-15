/** One plugin-owned catalog and mutation lifetime shared by the page and its feedback host. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-capability-manager/remote'
import type { CapabilityId, ManagedEntry, ManagerResult, ManagerSnapshot } from '../types.ts'

interface ManagerState {
  status: 'loading' | 'ready' | 'failed'
  snapshot: ManagerSnapshot | null
  loadError: string | null
  busy: boolean
  notice: { kind: 'saved' | 'removed' | 'retried' | 'error' | 'uncertain'; detail: string; seq: number } | null
}

/** Catalog state owner; all writes publish through its single observable. */
export class ManagerController {
  /** Observable catalog, in-flight mutation, and transient operation feedback. */
  readonly state = createSnapshotStore<ManagerState>({ status: 'loading', snapshot: null, loadError: null, busy: false, notice: null })
  private readonly lifetime = new AbortController()
  private generation = 0
  private sequence = 0
  private readonly pending = new Set<Promise<unknown>>()

  constructor(private readonly ctx: Context) {}

  /** Refresh without erasing the last successful catalog. */
  load = async (): Promise<void> => {
    if (this.state.getSnapshot().busy) return
    const generation = ++this.generation
    const work = Promise.resolve().then(() => this.ctx.remote.capabilityManager.list(this.lifetime.signal))
    this.pending.add(work)
    try {
      const result = await work
      if (this.lifetime.signal.aborted || generation !== this.generation) return
      if (!result.ok) throw new Error(result.error.message)
      this.state.update((state) => { state.snapshot = result.value; state.status = 'ready'; state.loadError = null })
    } catch (error) {
      if (this.lifetime.signal.aborted || generation !== this.generation) return
      this.state.update((state) => { state.status = 'failed'; state.loadError = error instanceof Error ? error.message : String(error) })
    } finally { this.pending.delete(work) }
  }

  /** Save one complete entry against the catalog's revision. */
  save = (entry: ManagedEntry): Promise<boolean> => this.mutate('saved', revision => this.ctx.remote.capabilityManager.save(entry, revision, this.lifetime.signal), entry)

  /** Remove only the selected manager entry. */
  remove = (id: CapabilityId): Promise<boolean> => this.mutate('removed', revision => this.ctx.remote.capabilityManager.deleteEntry(id, revision, this.lifetime.signal))

  /** Recreate an enabled runtime and read its resulting status. */
  retry = (id: CapabilityId): Promise<boolean> => this.mutate('retried', revision => this.ctx.remote.capabilityManager.retry(id, revision, this.lifetime.signal))

  /** Clear the transient operation outcome. */
  dismiss = (): void => { this.state.update((state) => { state.notice = null }) }

  /** Abort and await all observable client work when the plugin unloads. */
  async dispose(): Promise<void> {
    this.lifetime.abort()
    await Promise.allSettled([...this.pending])
  }

  private isDisposed(): boolean { return this.lifetime.signal.aborted }

  private async mutate(kind: 'saved' | 'removed' | 'retried', invoke: (revision: number) => Promise<{ ok: true; value: ManagerResult } | { ok: false; error: { message: string } }>, pendingEntry?: ManagedEntry): Promise<boolean> {
    const current = this.state.getSnapshot()
    if (current.busy || current.snapshot === null || this.isDisposed()) return false
    const revision = current.snapshot.revision
    const previous = current.snapshot
    ++this.generation
    this.state.update((state) => {
      state.busy = true; state.notice = null
      if (pendingEntry !== undefined && !previous.entries.some(entry => entry.id === pendingEntry.id)) {
        state.snapshot = {
          ...previous,
          entries: [...previous.entries, pendingEntry],
          statuses: [...previous.statuses.filter(status => status.id !== pendingEntry.id), {
            id: pendingEntry.id, status: pendingEntry.enabled ? 'connecting' : 'disabled', tools: 0, error: null, skills: [],
          }],
        }
      }
    })
    const work = Promise.resolve().then(() => invoke(revision))
    this.pending.add(work)
    let rejected = false
    let refreshed = false
    try {
      const response = await work
      if (this.isDisposed()) return false
      if (!response.ok) throw new Error(response.error.message)
      const result = response.value
      if (!result.ok) {
        rejected = true
        if (result.code === 'conflict') {
          const refresh = Promise.resolve().then(() => this.ctx.remote.capabilityManager.list(this.lifetime.signal))
          this.pending.add(refresh)
          try {
            const latest = await refresh
            if (!this.isDisposed() && latest.ok) {
              refreshed = true
              this.state.update((state) => { state.snapshot = latest.value })
            }
          } finally { this.pending.delete(refresh) }
        }
        throw new Error(result.message)
      }
      this.state.update((state) => {
        state.snapshot = result.snapshot; state.status = 'ready'; state.loadError = null
        state.notice = { kind, detail: '', seq: ++this.sequence }
      })
      return true
    } catch (error) {
      if (!this.isDisposed()) this.state.update((state) => {
        if (!refreshed) state.snapshot = previous
        state.notice = { kind: rejected ? 'error' : 'uncertain', detail: error instanceof Error ? error.message : String(error), seq: ++this.sequence }
      })
      return false
    } finally {
      this.pending.delete(work)
      if (!this.isDisposed()) this.state.update((state) => { state.busy = false })
    }
  }
}
