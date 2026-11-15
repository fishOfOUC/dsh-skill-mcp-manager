/** Parse copied MCP client configuration before creating manager registrations. */
import { z } from 'zod'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { entrySchema } from './schema.ts'
import type { ManagedMcp } from './types.ts'

const strings = z.record(z.string(), z.string())
const server = z.union([
  z.object({
    type: z.literal('stdio').optional(), command: z.string().trim().min(1),
    args: z.array(z.string()).default([]), env: strings.default({}), cwd: z.string().default(''),
    disabled: z.boolean().default(false),
  }).strict(),
  z.object({
    type: z.enum(['http', 'streamable-http']).optional(),
    url: z.string(), headers: strings.default({}), disabled: z.boolean().default(false),
  }).strict(),
])
const config = z.object({
  mcpServers: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,32}$/), server)
    .refine(value => Object.keys(value).length > 0),
}).strict()

/**
 * Validate the whole mcpServers object and allocate stable IDs for this import.
 * @param text - strict JSON copied from an MCP client configuration.
 * @returns complete entries suitable for the existing Host save operation.
 * @throws when JSON, a server name, or a connection field is invalid or unsupported.
 */
export function parseMcpJson(text: string): ManagedMcp[] {
  const parsed = config.parse(JSON.parse(text))
  return Object.entries(parsed.mcpServers).map(([name, value]) => {
    const connection = 'command' in value
      ? { transport: 'stdio', command: value.command, args: value.args, env: value.env, cwd: value.cwd }
      : { transport: 'streamable-http', url: value.url, headers: value.headers }
    const entry = entrySchema.parse({ id: randomUUID(), kind: 'mcp', name, enabled: !value.disabled, connection })
    if (entry.kind !== 'mcp') throw new Error('Expected MCP entry')
    return entry
  })
}
