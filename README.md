# DSH Skills 与 MCP 管理器

DeepSeek Harness 的统一 Skills 与 MCP 管理插件源码。

## 功能

- 在侧栏导入、编辑、启停和移除本地 Skill 目录。
- 配置 stdio / Streamable HTTP MCP，支持 `mcpServers` JSON 批量导入。
- 配置持久化、连接状态、失败重试和稳定的列表排序。
- MCP 默认按需发现，假定模型支持工具搜索：初始只提供 `mcp_tool_search` 和简短服务器摘要，匹配工具从下一模型步骤起可用。
- 搜索默认返回 8 项，每次最多 32 项；每个运行中的会话 Agent 保留最多 32 个最近发现的工具。
- 搜索遵守作用域限制；原始工具继续通过宿主执行器的权限、参数、取消和结果处理路径。
- 重连、工具目录重建、停用、移除与卸载撤销旧注册；服务器说明也按发现状态延迟提供。

## 源码范围与集成

`plugin/` 保留 Harness 工作区包的源码布局、包声明、语言文件、构建配置和必要测试。它依赖 Harness 的 Cordis、Typert、Skill、Tools、SystemPrompt 和 MCP 连接监督器，不是可以单独 `npm install` 运行的应用。

接入 Harness 工作区时，包路径为 `packages/client/ui-capability-manager`，需要宿主提供 `connectMcpServer`、条件工具注册及模型步骤的工具准入接口，并完成工作区依赖、类型引用和插件加载配置。不同桌面发布版的宿主接口和模块加载方式可能不同。

本仓库只提交生产源码、配置、说明和必要测试，不发布开发者本机的安装脚本、绝对模块路径兼容层、构建输出、配置数据、备份、日志或会话快照。现有本机桌面版本已完成用户验收；尚未将该环境专用安装流程制作为通用安装包。

详细行为见 [中文包说明](plugin/README.zh.md) 和 [English package reference](plugin/README.md)。包说明中的 Harness 相对链接指向宿主工作区中的相关模块。

## 验证

本次交付在开发者配套 Harness 工作区中通过 50 项测试。覆盖 JSON 导入、界面和控制器、配置持久化、真实 HTTP / stdio MCP 调用、按需工具发现、会话隔离、权限与取消、注册代际失效及发现数量上限。

另使用桌面版 Electron 44.7.0 的实际打包宿主模块连接本地 HTTP MCP：120 个工具初始仅提供 1 个搜索入口；搜索后增加 1 个命中工具并成功调用；验证了会话隔离与重连、停用和卸载后的撤销。该自动验证没有调用在线大模型；随后用户完成 DSH 中的实际验收。

必要测试位于 `plugin/tests/`，部分集成测试依赖配套 Harness 的测试夹具，需在对应宿主工作区中配置路径后运行。

## 来源与许可

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 MIT 许可代码及本地插件开发。保留原始版权声明，见 [LICENSE](LICENSE)。
