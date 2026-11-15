/** Copied JSON retains process parameters and rejects incomplete or unsupported configurations. */
import { describe, expect, it } from 'vitest'
import { parseMcpJson } from '../src/mcp-json.ts'

describe('MCP JSON import', () => {
  it('imports the Reqable example without changing the Windows path or token', () => {
    const command = 'E:\\tools\\toolssoft\\Reqable\\Reqable\\mcp-server.exe'
    const [entry] = parseMcpJson(JSON.stringify({ mcpServers: { reqable: { command, args: [], env: { REQABLE_TOKEN: 'fixture-token' } } } }))
    expect(entry).toMatchObject({ name: 'reqable', enabled: true, kind: 'mcp', connection: { transport: 'stdio', command, args: [], env: { REQABLE_TOKEN: 'fixture-token' }, cwd: '' } })
  })

  it('imports multiple local and HTTP servers with optional fields', () => {
    const entries = parseMcpJson(JSON.stringify({ mcpServers: {
      local: { command: 'node', disabled: true }, remote: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'fixture' } },
    } }))
    expect(entries[0]).toMatchObject({ enabled: false, connection: { args: [], env: {}, cwd: '' } })
    expect(entries[1]).toMatchObject({ enabled: true, connection: { transport: 'streamable-http', url: 'https://example.test/mcp', headers: { Authorization: 'fixture' } } })
    expect(entries[0]!.id).not.toBe(entries[1]!.id)
  })

  it.each([
    '{broken', '{}', '{"mcpServers":{}}', '{"mcpServers":[]}',
    JSON.stringify({ mcpServers: { invalid: { command: 'node', args: 'server.js' } } }),
    JSON.stringify({ mcpServers: { invalid: { command: 'node', env: { TOKEN: 1 } } } }),
    JSON.stringify({ mcpServers: { 'bad name': { command: 'node' } } }),
    JSON.stringify({ mcpServers: { invalid: { type: 'sse', url: 'https://example.test/sse' } } }),
    JSON.stringify({ mcpServers: { invalid: { url: 'file:///server' } } }),
    JSON.stringify({ mcpServers: { invalid: { command: 'node', url: 'https://example.test/mcp' } } }),
    JSON.stringify({ mcpServers: { invalid: { command: 'node', timeout: 500 } } }),
  ])('rejects invalid JSON before any registration: %s', (input) => {
    expect(() => parseMcpJson(input)).toThrow()
  })
})
