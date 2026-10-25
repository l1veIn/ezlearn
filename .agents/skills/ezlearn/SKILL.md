---
name: ezlearn
description: 使用已有 Agent 进行每日短时学习。用户说 /ezlearn、开始/继续 ezlearn、安装学习包，或回传 ezlearn attempt_id 请求阅卷时使用。复用本地 CLI 或远程 MCP 保存课程、答案和学习证据。
---

# ezlearn 仓库入口

先读取仓库内 `integrations/skills/ezlearn/SKILL.md`，按其中的初始化、恢复、备课、发布、阅卷与失败恢复步骤执行。该文件相对本目录为 `../../../integrations/skills/ezlearn/SKILL.md`。

从仓库根执行 `pnpm ezlearn status --json` 与 `pnpm ezlearn profile show --json` 确认实例。按 profile 选择本地 CLI 或远程 MCP。所有教学状态与评分通过平台操作；不要直接改数据库，不在聊天输出凭证。平台无需 LLM API Key。

用户输入 `/ezlearn` 表示调用此工作流；宿主若没有自定义斜杠命令，就用 `$ezlearn` 显式选择技能或要求读取上述文件，不声称 slash 已被注册。每轮约 15 分钟，一个小知识点，先处理未完成课程、待阅卷与到期复习。用户提交后必须使用准确 attempt_id，不猜记录。
