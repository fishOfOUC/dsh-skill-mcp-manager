/** Persisted user-managed Skill bundles and MCP servers. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identity retained when an entry is renamed or reconfigured. */
export type CapabilityId = Branded<'CapabilityId'>

/** Shared persisted fields for one managed capability. */
interface EntryBase {
  id: CapabilityId
  name: string
  enabled: boolean
}

/** A local directory containing SKILL.md and its associated resources. */
export interface ManagedSkill extends EntryBase {
  kind: 'skill'
  directory: string
}

/** MCP transport parameters; environment and headers are stored privately on the Host. */
export type McpTransport =
  | { transport: 'stdio'; command: string; args: string[]; env: Record<string, string>; cwd: string }
  | { transport: 'streamable-http'; url: string; headers: Record<string, string> }

/** One MCP namespace and its desired connection configuration. */
export interface ManagedMcp extends EntryBase {
  kind: 'mcp'
  connection: McpTransport
}

/** One independently enabled managed capability. */
export type ManagedEntry = ManagedSkill | ManagedMcp

/** Versioned file owned exclusively by the capability manager. */
export interface ManagerDocument {
  version: 1
  revision: number
  entries: ManagedEntry[]
}

/** Runtime observation, separate from the persisted desired state. */
export interface EntryStatus {
  id: CapabilityId
  status: 'disabled' | 'ready' | 'connecting' | 'connected' | 'disconnected' | 'failed'
  tools: number
  error: string | null
  skills: { name: string; description: string }[]
}

/** Consistent configuration revision with the corresponding local runtime observations. */
export interface ManagerSnapshot extends ManagerDocument {
  statuses: EntryStatus[]
}

/** A rejected mutation leaves the existing configuration intact. */
export type ManagerResult =
  | { ok: true; snapshot: ManagerSnapshot }
  | { ok: false; code: 'conflict' | 'invalid' | 'storage' | 'stopping'; message: string }
