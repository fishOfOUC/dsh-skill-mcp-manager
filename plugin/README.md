---
description: "Import local Skill bundles and configure MCP servers from one sidebar page, with immediate activation and persisted configuration."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-capability-manager

The MCP tab also supports **Add from JSON**. Paste a complete `mcpServers` JSON object and choose **Add and register** to save and connect one or more stdio or Streamable HTTP servers. Existing names, unsupported fields and SSE are rejected. A failed save stops the batch and retains unconfirmed entries; refresh the list before retrying. Connection failures remain visible on saved entries.

English | [中文](README.zh.md)

## Summary

Open **Skills and MCP** in the sidebar to import Skill directories and add stdio or Streamable HTTP MCP servers. Edit, enable, disable, remove, or retry each entry without restarting the Host. The page shows connection failures separately from saved configuration. Removing a Skill preserves its source directory and resources.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Web bundle includes this plugin. Open the sidebar entry, select **Skills** or **MCP**, and add an entry. A Skill directory must contain a valid `SKILL.md`; its scripts and relative resources stay in that directory. MCP executable paths and working directories refer to the Host, and arguments are passed without shell interpolation. The editor accepts JSON arrays for arguments and JSON objects with string values for environment variables and HTTP headers.

The Host saves entries to `$DSH_HOME/capabilities.json`. The file contains MCP environment variables and HTTP headers; keep it private. Global Remote access controls protect reads and mutations. The writer uses private file modes, an atomic replacement, and a cross-process writer lock. A stale browser revision is rejected; refresh before submitting it again. A saved enabled entry can show **Load failed** if its runtime cannot start; edit it or retry the connection.

Entries keep their insertion order when edited or toggled. Adding an MCP closes the editor and displays its row while the Host connects; a rejected save restores the draft. A conflicting revision refreshes the catalog before another submission. The management list uses the available desktop width. The editor opens a wide dialog with paired fields and side-by-side argument and environment editors; paths and HTTP headers use its full width.

Deployments can override persistence and runtime policy through the plugin row:

```yaml
- id: ui-capability-manager
  name: '@deepseek-ai/dsh-client-ui-capability-manager'
  config:
    watchSkills: true
    toolCallTimeoutMs: 60000
```

`dataFile`, when supplied, must be absolute. Imported Skill edits invalidate the Host catalog. Refresh reads current connection states and changes saved by another Host using the same file; file changes are not continuously synchronized between running Hosts.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host owns a versioned desired-state document and a separate set of effect-owned runtime instances. Each imported Skill uses the filesystem provider's parser and lazy resource reads, restricted to that bundle. Each MCP entry uses the existing connection supervisor, including namespaced tools, resources, instructions, and reconnect policy. Activation failures remain visible without discarding the desired configuration. Plugin unload awaits queued mutations, watcher closure, and MCP disposal.

The browser registers a global main panel and its icon in the existing sidebar. One controller supplies the catalog and mutation state to that panel and an independent feedback host. The plugin mounts its own generated Remote contribution rather than adding methods to an API controller.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Skill filesystem provider](../../skill/skill-filesystem/README.md) — frontmatter, invocation policy, and local resources.
- [MCP client](../../mcp/mcp-client/README.md) — transport supervision and tool namespaces.
- [Sidebar](../ui-sidebar/README.md) — global management navigation.

-----

<a id="model-experience"></a>
## Model Experience

Managed MCP tools use discovery by default, assuming the model supports tool search. There is no model-capability fallback to eager exposure. Connections still discover the complete catalog and report its real tool count, but the initial model step receives only `mcp_tool_search` and a compact server/count summary.

Searching returns matching names, descriptions and parameter schemas, and admits those tools in that conversation's next model step. BM25 searches tokenized server names, tool identifiers and descriptions, including Chinese descriptions; it is not cross-language semantic search. `query` is required; `server` optionally restricts the exact namespace. `limit` defaults to 8 and accepts 1–32. `total` and `hasMore` disclose additional matches. Each Agent retains at most 32 recently discovered tools; searching restores an evicted tool.

Discovery is private to each live Agent and is not persisted. Host restarts or Agent recreation require discovery again. Reconnects, catalog resynchronization, disable and removal revoke the previous registrations; old discoveries cannot activate replacements. Server instructions are exposed only after that conversation discovers a tool from that server. Search respects tool restrictions and scoped shadowing. Original definitions execute through the existing permission, argument, cancellation and result pipeline.

Only MCP entries managed by this page participate. Independently configured MCP plugins retain their own exposure behavior. Skill behavior is unchanged.

#### KV Cache effect

Search changes that conversation's next request's tool declarations and server instructions. Enabling, disabling, or editing entries can also change the Skill catalog or MCP source summary. Existing consumers log their model-visible content; the manager does not rewrite Session history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only entries added here are managed. Filesystem auto-discovery and separately configured Skill or MCP plugins remain independent; this plugin does not migrate or disable them.
- Skill import references an existing Host directory. The page does not download repositories, edit Skill bodies, or install MCP executables.
- Runtime status updates when the page refreshes or an operation completes. Other running Hosts reconcile the shared file on their next refresh, rather than through a file watcher.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
