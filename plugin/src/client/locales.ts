/** Typed copy for the unified capability manager. */
export const zh = {
  title: 'Skills 与 MCP', subtitle: '管理此 Host 上的技能目录与 MCP 服务器。更改保存后立即生效。',
  skills: 'Skills', mcp: 'MCP', addSkill: '导入 Skill', addMcp: '添加 MCP', refresh: '刷新',
  search: '搜索名称、路径或地址', emptySkill: '尚未导入 Skill。选择一个包含 SKILL.md 的本地目录。', emptyMcp: '尚未添加 MCP 服务器。连接本地进程或 HTTP 服务。', noMatches: '没有匹配的配置。',
  name: '名称', directory: 'Skill 目录', directoryHelp: '填写 Host 上包含 SKILL.md 的目录，相关脚本和资源保留在原目录中。',
  transport: '连接方式', stdio: '本地进程 · stdio', http: 'HTTP · Streamable HTTP', command: '可执行文件', args: '参数（JSON 数组）', env: '环境变量（JSON 对象）', cwd: '工作目录（可选）', url: 'MCP 地址', headers: '请求头（JSON 对象）',
  enabled: '启用', edit: '编辑', remove: '移除', retry: '重新加载', reconnect: '重连', save: '保存', cancel: '取消', close: '关闭',
  removeTitle: '移除配置', removeHelp: '仅取消此管理器的注册并断开连接，不会删除 Skill 源文件或 MCP 服务器的数据。',
  loading: '正在读取配置…', saving: '正在应用…', loadFailed: '无法读取配置', saved: '配置已保存', removed: '配置已移除', retried: '已重新加载，请查看运行状态', error: '操作失败：{detail}',
  invalid: '请检查必填字段。参数必须是字符串数组，环境变量和请求头必须是字符串值的 JSON 对象。',
  disabled: '已停用', ready: '已加载', connecting: '连接中', connected: '已连接', disconnected: '已断开', failed: '加载失败', tools: '{count} 个工具',
  namespaceHelp: 'MCP 名称是工具命名空间：1–32 个英文字母、数字、下划线或连字符。',
  storageHelp: '配置保存在 Host 本地。仅管理从此页面添加的条目。',
  uncertain: '结果尚未确认，请刷新配置后核对：{detail}',
  importJson: '通过 JSON 添加', jsonConfig: 'MCP 配置（JSON）', jsonRegister: '添加并注册',
  jsonHelp: '粘贴包含 mcpServers 的完整 JSON，可一次添加多个 MCP。保存后立即尝试连接，列表显示连接状态和工具数量。请先替换令牌等占位内容。',
  jsonReady: '将添加 {count} 个 MCP：{names}',
  jsonInvalid: '请填写有效的 mcpServers JSON。名称需为 1–32 个英文字母、数字、下划线或连字符；本地进程填写 command、args（字符串数组）、env（字符串值对象），HTTP 填写 url 和 headers。不支持 SSE 或其他额外字段。',
  jsonDuplicate: '这些 MCP 名称已存在：{names}。请改名，或关闭此窗口并编辑已有配置。',
  jsonStopped: '已保存 {count} 个 MCP，后续添加已停止。输入框保留未确认的配置；请刷新列表核对结果后再重试。',
} satisfies Record<string, string>

/** Dictionary key set shared by both supplied locales. */
export type ManagerKey = keyof typeof zh

/** English copy; other locales use the locale service fallback. */
export const en = {
  title: 'Skills and MCP', subtitle: 'Manage Skill directories and MCP servers on this Host. Saved changes take effect immediately.',
  skills: 'Skills', mcp: 'MCP', addSkill: 'Import Skill', addMcp: 'Add MCP', refresh: 'Refresh',
  search: 'Search names, paths or endpoints', emptySkill: 'No Skills imported. Add a local directory containing SKILL.md.', emptyMcp: 'No MCP servers added. Connect a local process or an HTTP service.', noMatches: 'No matching configurations.',
  name: 'Name', directory: 'Skill directory', directoryHelp: 'Enter a directory on the Host containing SKILL.md. Scripts and resources stay in that directory.',
  transport: 'Transport', stdio: 'Local process · stdio', http: 'HTTP · Streamable HTTP', command: 'Executable', args: 'Arguments (JSON array)', env: 'Environment (JSON object)', cwd: 'Working directory (optional)', url: 'MCP endpoint', headers: 'Headers (JSON object)',
  enabled: 'Enabled', edit: 'Edit', remove: 'Remove', retry: 'Reload', reconnect: 'Reconnect', save: 'Save', cancel: 'Cancel', close: 'Close',
  removeTitle: 'Remove configuration', removeHelp: 'Removes this manager’s registration and closes its connection. Skill source files and MCP server data are preserved.',
  loading: 'Loading configuration…', saving: 'Applying…', loadFailed: 'Could not load configuration', saved: 'Configuration saved', removed: 'Configuration removed', retried: 'Reload finished; check the runtime status', error: 'Operation failed: {detail}',
  invalid: 'Check required fields. Arguments must be a JSON array of strings; environment and headers must be JSON objects with string values.',
  disabled: 'Disabled', ready: 'Loaded', connecting: 'Connecting', connected: 'Connected', disconnected: 'Disconnected', failed: 'Load failed', tools: '{count} tools',
  namespaceHelp: 'MCP names are tool namespaces: 1–32 letters, digits, underscores or hyphens.',
  storageHelp: 'Configuration is stored on the Host. This page manages entries added here.',
  uncertain: 'Outcome unconfirmed; refresh the configuration to check: {detail}',
  importJson: 'Add from JSON', jsonConfig: 'MCP configuration (JSON)', jsonRegister: 'Add and register',
  jsonHelp: 'Paste a complete JSON object containing mcpServers to add one or more servers. Saving immediately attempts a connection; the list shows connection status and tool counts. Replace token placeholders first.',
  jsonReady: 'Add {count} MCP servers: {names}',
  jsonInvalid: 'Enter valid mcpServers JSON. Names need 1–32 letters, digits, underscores or hyphens. Use command, args (string array) and env (string values) for local processes, or url and headers for HTTP. SSE and extra fields are unsupported.',
  jsonDuplicate: 'MCP names already exist: {names}. Rename them, or close this dialog and edit the existing configuration.',
  jsonStopped: 'Saved {count} MCP servers and stopped. The editor retains unconfirmed entries; refresh the list to check the outcome before retrying.',
} satisfies Record<ManagerKey, string>
