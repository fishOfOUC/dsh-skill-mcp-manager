/** Validation at the manager's file and Remote input boundaries. */
import { z } from 'zod'
import type { CapabilityId, ManagedEntry, ManagerDocument } from './types.ts'

const identity = {
  id: z.uuid().transform(value => value as CapabilityId),
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
}
const stringMap = z.record(z.string(), z.string())
const transport = z.discriminatedUnion('transport', [
  z.object({ transport: z.literal('stdio'), command: z.string().trim().min(1), args: z.array(z.string()), env: stringMap, cwd: z.string() }).strict(),
  z.object({ transport: z.literal('streamable-http'), url: z.url().refine(value => ['http:', 'https:'].includes(new URL(value).protocol), 'Use an http or https MCP endpoint'), headers: stringMap }).strict(),
])

/** Admit one complete entry from JSON or a Remote request. */
export const entrySchema: z.ZodType<ManagedEntry> = z.discriminatedUnion('kind', [
  z.object({ ...identity, kind: z.literal('skill'), directory: z.string().trim().min(1) }).strict(),
  z.object({ ...identity, name: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/), kind: z.literal('mcp'), connection: transport }).strict(),
])

/** Reject unknown file versions, duplicate identities, and duplicate MCP namespaces. */
export const documentSchema: z.ZodType<ManagerDocument> = z.object({
  version: z.literal(1), revision: z.number().int().nonnegative(), entries: z.array(entrySchema),
}).strict().superRefine((document, ctx) => {
  const ids = new Set<string>(), names = new Set<string>()
  for (const entry of document.entries) {
    if (ids.has(entry.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate capability id' })
    ids.add(entry.id)
    if (entry.kind === 'mcp') {
      if (names.has(entry.name)) ctx.addIssue({ code: 'custom', message: `Duplicate MCP namespace: ${entry.name}` })
      names.add(entry.name)
    }
  }
})
