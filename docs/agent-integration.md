# Agent、Skill 与每日学习

ezlearn 不内置模型。宿主 Agent 负责选取合法可见的上下文、讲解与主观题反馈，平台负责快照、答案、客观评分和进度。CLI/MCP 接入已与同一个核心契约连接，具体运行验收见 README。

## 本仓库的 Codex 接入

仓库已包含 `.agents/skills/ezlearn/SKILL.md`，它把工作流指向 `integrations/skills/ezlearn/SKILL.md`。在此仓库启动一个新的 Codex 会话，让宿主加载技能列表；没有出现时重启会话并检查本地技能是否被禁用。官方说明列出 `.agents/skills` 的仓库发现路径，并说明 CLI/IDE 可用 `$` 显式选择技能；这与自定义斜杠命令是两种能力。[OpenAI 官方技能文档](https://learn.chatgpt.com/docs/build-skills)

运行本地服务后，可以在 Agent 里说：

```text
$ezlearn
/ezlearn 我要学英语，每天15分钟。先用English Demo体验。
```

`/ezlearn` 是项目约定的学习意图入口。Codex 中用 `$ezlearn` 选择已加载技能；其他宿主若未注册同名 slash，把完整 `/ezlearn ...` 当普通消息，要求其使用此技能即可。不要假定放置 SKILL.md 就自动注册所有宿主的 `/ezlearn`。

如果技能尚未加载，当前会话的可用接法：

```text
请读取 integrations/skills/ezlearn/SKILL.md，并按该工作流执行：
/ezlearn 我要学英语，每天15分钟。先用English Demo体验。
```

项目开发环境已检查 Codex CLI 的 `--help` 和 `mcp add --help`。本轮业务验收通过正式 CLI/MCP 客户端完成；没有据此宣称所有 Codex 版本的 slash 选择器、其他会话历史或宿主自动定时已经完成端到端验证。

## 安装到其他工作目录

从项目根把完整技能复制到目标仓库的 `.agents/skills/ezlearn`。先确认目标不存在，已有同名技能请人工合并，勿覆盖。不要只复制仓库入口文件，它的相对引用依赖本仓库结构。

```powershell
$skillTarget = Join-Path 'C:\path\to\your-project' '.agents\skills\ezlearn'
if (Test-Path -LiteralPath $skillTarget) { throw '目标已有 ezlearn 技能，请先检查内容' }
New-Item -ItemType Directory -Path (Split-Path -Parent $skillTarget) -Force | Out-Null
Copy-Item -LiteralPath './integrations/skills/ezlearn' -Destination $skillTarget -Recurse
```

在 ezlearn 仓库中 `pnpm build` 后，可使用绝对路径 `node C:\path\to\ezlearn\dist\cli\index.js`。跨仓库学习要设置相同的绝对 data-dir 或 profile，避免每个当前目录各建一个实例。也可以在本地从源码链接 bin，但 npm 上没有发布可安装的 ezlearn 包。

## CLI、profile 与远程 MCP

CLI `--json` 返回机器可读封套，输入内容写 JSON 文件。通用入口让任何宿主使用同一数据契约：

```powershell
pnpm ezlearn status --json
pnpm ezlearn profile show --json
pnpm ezlearn call list_goals --json
pnpm ezlearn call create_lesson --input ./examples/inputs/lesson.json --json
```

profile 保存于 data-dir 的 `profile.json`。本地 profile 使用 `{"kind":"local"}`；通过 `--data-dir` 或 `EZLEARN_DATA_DIR` 固定数据目录，通过 `--base-url` 或 `EZLEARN_BASE_URL` 设置课程链接。远程使用 `kind: remote`、实例 `url` 和保存 token 的环境变量名 `token_env`。profile 不保存 token 本身，也不会改变原实例数据。确切字段参见 CLI `profile show` 结果和[迁移步骤](migration.md)。

远程 MCP 的地址是 `https://你的域名/mcp`，传输为 Streamable HTTP。部署后可显式配置 Codex：

```powershell
codex mcp add ezlearn --url https://你的域名/mcp --bearer-token-env-var EZLEARN_API_TOKEN
```

先通过系统安全方式为进程设置 `EZLEARN_API_TOKEN`，不要把 token 粘进命令参数、配置仓库或课程 URL。本地开发服务器也提供回环 MCP，可在可信本机环境调用。远程 Web 登录使用相同部署的登录凭证换取会话，不把 Bearer 放入浏览器 localStorage。

Claude Code、Hermes、DSH 等宿主提供通用适配：配置有权限的 shell 调用本地 CLI，或在支持 Streamable HTTP 的 MCP 设置中填 URL 与 Bearer，再把 Skill 工作流按宿主自己的规则注册。此处没有验证它们的技能目录、slash 语法、跨会话权限或定时工具，不提供虚构的一键安装命令。

## 一轮真实交接

1. Agent 查 status、pack/goal、pending/progress，再调用 plan next。
2. 首次创建目标，关联准确包版本；水平未知就保持 unknown，可跳过摸底。
3. 查询材料，把一小段实际可见的项目背景写入 context_summary。不能读取其他会话时明确使用当前会话或通用例子。
4. 调用 create_lesson，再 publish_lesson；把返回 URL 给用户。
5. 用户 Web 阅读、保存草稿、提交，得到“已提交，待老师反馈”。
6. 用户复制页面提示词回 Agent；提示词含 backend 与准确 attempt_id，不含密钥。
7. Agent 用 get_attempt 教师视图读取快照，按 rubric 提交逐题评分、feedback、summary、next_steps。
8. 平台计算客观分并保存评价、进度；用户刷新结果页，Agent 用 plan next 安排续学。

用户只说“做完了”时，查询待阅卷。只有一份就处理；多份先结合当前目标/最近课程识别，仍不清楚再请其选择。不可随意取第一条。

首次评价 `expected_version=0`，稳定 key `review:<attempt_id>:1`；修改评价要读取当前 version，提供新 key 和 revision_reason。客观分不能被教师覆盖。参考输入文件的分数只是格式示例，必须按实际答案替换。

## 定时学习

模板在 `integrations/skills/ezlearn/references/daily-prompt.md`。仅当用户明确启用时，把它放进宿主支持的定时任务。每日课程使用 `daily:<goal_id>:<用户本地YYYY-MM-DD>` 幂等键；同日重试返回原课，内容冲突要先查询。

平台不保存 LLM Key，不主动唤醒 Agent，不声称已推送。提醒应只在有新课程、结果、错误或需要用户行动时通知；没有变化时保持安静。宿主不支持定时，就由用户手动 `/ezlearn`。
