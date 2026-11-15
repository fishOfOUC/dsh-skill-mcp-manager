/** Register the unified manager in the existing sidebar and main-panel slots. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import managerRemote from '@deepseek-ai/dsh-client-ui-capability-manager/remote'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { ManagerController } from './controller.ts'
import { ManagerIcon, ManagerPage, ManagerToast, type ManagerInjected } from './ManagerPage.tsx'
import { en, zh, type ManagerKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Skill and MCP management copy. */
    capabilityManager: ManagerKey
  }
}

/** Required services for navigation, authenticated RPC, slots, and locale ownership. */
export const inject = ['slots', 'locale', 'remote', 'remoteAccess']

/**
 * Mount management only while the calling Peer can read its Host-global configuration.
 * @param ctx - browser plugin context.
 */
export async function apply(ctx: Context): Promise<void> {
  const release = await ctx.remote.$mount(managerRemote)
  ctx.effect(() => release, 'capability-manager.remote')
  ctx.inject(['remote.capabilityManager'], mountManager)
}

function mountManager(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('capabilityManager', { zh, en }), 'capability-manager.copy')
  const controller = new ManagerController(ctx)
  ctx.effect(() => () => controller.dispose(), 'capability-manager.requests')
  const face: ManagerInjected = {
    hooks: { manager: controller.state }, load: controller.load, save: controller.save,
    remove: controller.remove, retry: controller.retry, dismiss: controller.dismiss,
  }
  const t = ctx.locale.bind('capabilityManager')
  const panel = 'capabilities' as MainPanelId
  ctx.remoteAccess.whenAccess('capabilityManager/list', function* () {
    void controller.load()
    yield ctx.on('connection/reset', () => { void controller.load() })
    yield ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: panel, locale: 'capabilityManager', inject: () => face }, ManagerPage))
    yield ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: panel, order: 5, label: () => t('title'), locale: 'capabilityManager' }, ManagerIcon))
    yield ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'capability-manager.feedback', locale: 'capabilityManager', inject: () => face }, ManagerToast))
  })
}
