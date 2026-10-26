---
name: ezlearn
description: 使用 ezlearn 平台开始或继续每日学习、安装学习包，或按 attempt_id 阅卷；不用于 ezlearn 项目开发或架构讨论。
---

# ezlearn 仓库入口

读取仓库 integrations/skills/ezlearn/SKILL.md（相对本目录 ../../../integrations/skills/ezlearn/SKILL.md），按其简短流程使用 CLI。

先确认 profile 与 status。学习操作统一通过选定实例的 HTTP API，平台未启动时提示启动；不直接改数据库，不输出凭证，不把端点切换当数据迁移。Skill 负责教学顺序，平台校验评分、版本和证据。

用户的 /ezlearn 是学习意图。宿主未注册同名 slash 时，可用 $ezlearn 显式选择或要求读取上述文件，不声称已自动注册所有宿主命令。
