/** Directory-bundle adapter using the filesystem provider's parser and resource semantics. */
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import type { SkillCandidate, SkillLookupOptions, SkillProvider, SkillProviderControl } from '@deepseek-ai/dsh-skill'
import type { ManagedSkill } from './types.ts'

/**
 * Restrict filesystem discovery to one imported bundle, retaining lazy body reads and file watching.
 * @param ctx - owning plugin context.
 * @param entry - canonical bundle directory and identity.
 * @param control - registry invalidation and lifetime control.
 * @param watch - whether changes to the imported bundle invalidate the catalog.
 * @returns the provider and an awaited watcher cleanup operation.
 */
export function createManagedSkill(ctx: Context, entry: ManagedSkill, control: SkillProviderControl, watch: boolean): Omit<SkillProvider, 'list'> & { list(options: SkillLookupOptions): Promise<SkillCandidate[]>; dispose(): Promise<void> } {
  const filesystem = new FileSystemSkillProvider(ctx, control, {
    providerName: `managed:${entry.id}`, includeDefaultRoots: false,
    customSkillDirs: [dirname(entry.directory)], watch,
  })
  const path = join(entry.directory, 'SKILL.md')
  return {
    name: filesystem.name,
    async list(options) {
      const result = await filesystem.list(options)
      if (!Array.isArray(result) && !result.complete) throw new Error(`Unable to observe Skill directory ${entry.directory}; check filesystem access and retry`)
      const candidates: readonly SkillCandidate[] = Array.isArray(result) ? result : result.candidates
      const selected = candidates.filter(candidate => candidate.path === path)
      if (selected.length === 0) throw new Error(`No valid SKILL.md in ${entry.directory}`)
      return selected
    },
    get: (candidate, options) => filesystem.get(candidate, options),
    dispose: () => filesystem.dispose(),
  }
}
