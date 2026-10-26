# CLI、Skill 与 Agent 接入

平台负责课程、作答、评分校验和学习证据；Agent 负责教学编排。Skill 是 CLI 使用说明和简短工作流，不承担业务规则。所有学习命令通过同一个 HTTP API，包括本机平台。

## 先启动并连接平台

按 README 独立启动平台，或运行 `pnpm ezlearn start`。在操作终端确认：

~~~powershell
pnpm ezlearn --help
pnpm ezlearn profile show --json
pnpm ezlearn status --json
pnpm ezlearn platform doctor --json
~~~

平台未启动时先处理连接问题，不回退到 SQLite。首次运行可用 `node examples/prepare-demo.mjs` 安装原创演示包并发布一课；脚本也通过正式 CLI/HTTP 操作。

CLI 从源码用 `pnpm ezlearn <命令>`，构建后可用 `node C:/path/to/ezlearn/dist/cli/index.js <命令>`。尚未发布 npm 包。输入写 JSON 文件并用 --input，stdout 的 --json 输出为成功或机器错误封套，日志在 stderr。

## 实例与凭证配置

profile 保存 endpoint 及凭证引用；名称只方便切换，不定义另一套学习执行方式。--config-dir 是 CLI 配置目录，默认使用 --data-dir。本机默认实例目录中的 connection.json 由平台生成，CLI 只向完全匹配的 endpoint 使用凭证。

端点优先级为：显式 --endpoint（或兼容的 --base-url）→ 显式 --profile → 环境变量 → 当前默认 profile。显式选择 profile 时不会被全局端点环境变量改写。

配置云端时，将以下内容写入 .ezlearn/cloud-profile.json：

~~~json
{"endpoint":"https://你的平台域名","token_env":"EZLEARN_API_TOKEN"}
~~~

~~~powershell
pnpm ezlearn profile set --name cloud --input .ezlearn/cloud-profile.json --json
pnpm ezlearn profile list --json
pnpm ezlearn status --profile cloud --json
pnpm ezlearn profile use cloud --json
~~~

token_env 保存进程环境变量名，不保存密钥。不要把真实 token 写进命令参数、配置仓库或聊天。--endpoint URL 覆盖成另一端点时会清除原 profile 的凭证引用；可显式使用 --token-env ENV 或 --connection-file FILE，或让 CLI 从指定 --data-dir 中发现端点匹配的 connection.json。仅设置同名全局环境变量不会自动把它发送给其他实例。兼容握手不携带凭证。

多个本地实例可以用 connection_file 引用各自生成的连接文件。例如 profile JSON 中填入 `{"endpoint":"http://127.0.0.1:3211","connection_file":"C:/path/to/instance-b/connection.json"}`，再按上述 set/use 流程保存命名 profile。CLI 将路径绝对化并校验文件 endpoint，避免把 A 的本地凭证发给 B。跨项目使用时固定配置目录或明确指定 profile。

旧 kind:local / kind:remote 配置由 CLI 兼容读取并转换为端点配置；转换后检查 profile show 和 status，学习数据不会随配置转换或端点切换自动迁移。

## Codex 仓库技能入口

仓库的 .agents/skills/ezlearn/SKILL.md 指向完整工作流 integrations/skills/ezlearn/SKILL.md。OpenAI 官方文档说明 Codex 会发现仓库 .agents/skills，并可在 CLI/IDE 中用 /skills 或 $ 选择技能；修改未出现时可重启宿主。[OpenAI 官方技能文档](https://learn.chatgpt.com/docs/build-skills)

加载技能后：

~~~text
$ezlearn
/ezlearn 我要学英语，每天15分钟，先用English Demo体验。
~~~

/ezlearn 是学习意图入口，各宿主的自定义 slash 注册方式不同。没有选择器时可直接要求：“读取 integrations/skills/ezlearn/SKILL.md，按其中流程处理 /ezlearn …”。不要宣称一个文件自动兼容所有宿主。

安装到其他项目时复制完整 integrations/skills/ezlearn 目录，不能只复制本仓库的相对引用入口。先确认目标不存在，已有同名技能需合并：

~~~powershell
$skillTarget = Join-Path 'C:/path/to/your-project' '.agents/skills/ezlearn'
if (Test-Path -LiteralPath $skillTarget) { throw '已有同名技能，请先检查内容' }
New-Item -ItemType Directory -Path (Split-Path -Parent $skillTarget) -Force | Out-Null
Copy-Item -LiteralPath './integrations/skills/ezlearn' -Destination $skillTarget -Recurse
~~~

Claude Code、Hermes、DSH 等宿主通过其授权的 shell 使用同一 CLI，按自己的技能规则加载工作流。这里不提供未经验证的 slash、历史读取或定时注册命令。MCP 已退出默认产品路径。

## 教学与阅卷

1. 查询当前实例、学习包、目标、待阅卷、进度和 plan next。只补充真正缺失的信息；默认每天 15 分钟、水平 unknown，摸底可跳过。
2. 优先恢复未完成课程，处理待阅卷和到期复习，再引入新内容。多目标不明确时才请用户选择。
3. 从宿主实际可见范围形成精简 context_summary。不能读取其他会话就使用当前对话或通用例子，不扫描硬盘或提交原始工作对话。
4. 根据目标、依赖和证据选一个小 topic，检索材料，形成目标、短讲解、熟悉例子和少量练习。调用 lesson create / publish，给出平台返回的学习 URL。
5. 用户在 Web 保存并提交，把准确 attempt_id 的交接提示词带回 Agent。
6. 用 attempt show 读取教师视图，对每题反馈。客观分由平台计算，简答按 rubric 给分。review submit 首次 expected_version=0，写回 summary 和 next_steps。
7. 用户刷新结果；Agent 读下一计划，继续或在可恢复状态结束。

用户只说“做完了”时先查询 pending。只有一份直接处理；多份结合当前目标、最近课程或准确 ID 识别，仍有歧义再让用户选择，不能随意取第一条。

课程使用稳定 key `daily:<goal_id>:<用户本地YYYY-MM-DD>`；同日重试复用输入。首次评价 key `review:<attempt_id>:1`；修订用当前 version、新 key 和 revision_reason。平台校验版本冲突，不盲目覆盖或通过换 key 制造重复。

## 定时学习

模板在 integrations/skills/ezlearn/references/daily-prompt.md。只有用户明确启用后才交给宿主支持的任务系统。没有变化时保持安静，有新课程、结果、失败或需要用户操作时再通知。平台不保证自动唤醒 Agent，不内置跨平台通知；没有宿主定时能力就手动发起学习。
