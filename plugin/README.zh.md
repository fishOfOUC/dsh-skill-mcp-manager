---
description: "在同一个侧栏页面中导入本地 Skill 目录并配置 MCP 服务器，配置持久化保存并立即生效。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-capability-manager

[English](README.md) | 中文

## 概述

在侧栏打开 **Skills 与 MCP**，导入 Skill 目录并添加 stdio 或 Streamable HTTP MCP 服务器。每个条目都支持编辑、启用、停用、移除和重试，无需重启 Host。页面分别显示配置保存结果和连接失败状态。移除 Skill 会保留其源目录和资源文件。

## 目录

- [使用本包](#use-this-package)
- [实现原理](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发笔记](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Web bundle 已包含此插件。打开侧栏入口，选择 **Skills** 或 **MCP** 并添加条目。Skill 目录必须包含有效的 `SKILL.md`，脚本与相对资源继续保存在原目录。MCP 可执行文件路径与工作目录均指向 Host，参数直接传递，不经过 shell 插值。编辑器中的参数使用 JSON 数组，环境变量与 HTTP 请求头使用值为字符串的 JSON 对象。

Host 将条目保存到 `$DSH_HOME/capabilities.json`。该文件包含 MCP 环境变量和 HTTP 请求头，应保持私密。全局 Remote 访问控制保护读取与修改操作。写入使用私有文件权限、原子替换和跨进程写锁。浏览器持有旧版本时保存会被拒绝，需要刷新后再次提交。已保存的启用条目在运行实例启动失败时会显示 **加载失败**，可编辑配置或重试连接。

条目按添加顺序排列，编辑或启停不会改变位置。添加 MCP 后先收起编辑器并显示连接中的条目；保存被拒绝时恢复草稿。发生版本冲突时自动刷新列表，供再次提交。管理列表使用桌面窗口的可用宽度。编辑器打开宽弹窗，相关字段及参数、环境变量编辑区并排显示；路径与 HTTP 请求头使用完整宽度。

在 MCP 标签中点击「通过 JSON 添加」，粘贴完整的 `{"mcpServers":{...}}` 后点击「添加并注册」，可一次添加多个服务器。本地进程支持 `command`、`args`、`env`、`cwd`，HTTP 支持 `url`、`headers` 和可选的 `type: "http"` 或 `"streamable-http"`；`disabled: true` 可保存为停用。同名条目会拒绝导入；SSE 和未知字段会报错，整段配置通过校验后才开始保存。批量保存中途失败时保留未确认的配置，刷新核对后再试。连接失败的配置仍会保存在列表中。

部署可以通过插件配置覆盖存储与运行策略：

```yaml
- id: ui-capability-manager
  name: '@deepseek-ai/dsh-client-ui-capability-manager'
  config:
    watchSkills: true
    toolCallTimeoutMs: 60000
```

若提供 `dataFile`，其值必须是绝对路径。导入的 Skill 文件发生编辑时会使 Host 技能目录缓存失效。刷新会读取当前连接状态，以及使用同一文件的其他 Host 保存的更改；多个运行中的 Host 不会持续同步文件变化。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

Host 分别维护带版本的期望配置文档与由 effect 管理的运行实例。每个导入的 Skill 使用文件系统提供者的解析器和按需资源读取，并将发现范围限定为该目录。每个 MCP 条目使用已有的连接监督器，包括命名空间工具、资源、服务器说明和重连策略。启动失败会保留期望配置并显示错误。插件卸载会等待已排队的修改、文件监听器关闭和 MCP 清理完成。

浏览器在现有侧栏中注册图标，并在主区域注册全局管理页面。一个控制器向页面与独立的操作反馈容器提供目录和修改状态。插件自行挂载生成的 Remote 描述，不向其他 API 控制器添加方法。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [Skill 文件系统提供者](../../skill/skill-filesystem/README.zh.md) — frontmatter、调用策略与本地资源。
- [MCP 客户端](../../mcp/mcp-client/README.zh.md) — 连接监督与工具命名空间。
- [侧栏](../ui-sidebar/README.zh.md) — 全局管理导航。

-----

<a id="model-experience"></a>
## 模型体验

MCP 默认使用按需工具发现，默认模型支持工具搜索，不再根据模型能力回退到全量暴露。连接时仍获取完整工具目录并显示真实工具数量，但首个模型步骤只提供 `mcp_tool_search` 和简短的服务器名称、工具数量摘要；完整工具描述和参数不进入初始请求。

模型调用 `mcp_tool_search({"query":"文件搜索","limit":8})` 后，搜索结果返回匹配工具的名称、描述和参数结构，并从该会话的下一个模型步骤起提供这些工具。可指定 `server` 精确限定服务器。检索采用 BM25，对工具名、服务器名和描述分词，支持标识符及中文描述；它不是跨语言语义搜索。默认返回 8 项，`limit` 范围为 1–32，`total` 和 `hasMore` 说明是否还有匹配项。每个会话最多保持 32 个最近发现的工具，超出后可重新搜索恢复。

发现状态按运行中的 Agent 隔离，不写入配置或历史；另一个会话不会获得同样的工具。Host 重启或会话运行实例重建后需要重新搜索。重连、重新同步工具列表、停用或移除条目会撤销对应注册，旧发现状态不能激活新一代工具。服务器说明只提供给已经发现该服务器工具的会话。搜索遵守宿主的工具限制和同名作用域覆盖；实际调用继续经过原执行器的权限、参数、取消和结果处理路径。

本功能只管理本页添加的 MCP；独立配置的 MCP 插件继续由它们自己的注册逻辑决定是否全量暴露。Skill 行为不变。

#### KV Cache effect

搜索会改变该会话下一次请求中的 MCP 工具定义和服务器说明。启用、停用或编辑条目也可能改变 Skill 目录或 MCP 服务器摘要。已有使用方会记录模型可见内容；管理器不会改写 Session 历史。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 仅管理从此页面添加的条目。文件系统自动发现与独立配置的 Skill 或 MCP 插件保持独立；本插件不会迁移或停用它们。
- Skill 导入引用 Host 上已有的目录。页面不下载仓库、不编辑 Skill 正文，也不安装 MCP 可执行程序。
- 运行状态在刷新页面或操作完成时更新。其他运行中的 Host 在下次刷新时读取共享文件，不通过文件监听持续同步。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
