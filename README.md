# ezlearn

**一个可自部署、管理学习内容和个人进度、允许外部 Agent 担任老师的 Web 学习平台。**

每次用 10～20 分钟，学一个小知识点、做几道题、得到反馈，再从保存的证据继续。学习目标、前置知识和答题证据决定学什么；Agent 用你熟悉的工作情境解释它。平台不要求 LLM API Key。

源码仓库：[l1veIn/ezlearn](https://github.com/l1veIn/ezlearn)。默认中文、单用户、本地优先，界面采用暖纸色、墨绿与学习札记排版。

## 产品边界

- **平台应用**拥有学习包及版本、目标、课程、作答、评价、学习证据、复习安排和 HTTP API，可独立运行。
- **CLI**负责本地实例启动与诊断、端点配置和切换，并提供平台操作的终端入口。所有学习命令都通过 HTTP 访问选定实例，本机和云端使用同一条路径。
- **Skill**是 CLI 使用说明和简短教学流程，指导已有 Agent 备课、给出课程链接、读取作答并回传评价。
- **学习包**是版本化的学习依据。初期主要从 GitHub 仓库分发，也支持上传纯数据包；下载、校验、保存和版本管理归平台，不建设学习包市场。

当前推进 **v0.2.0 平台化第一阶段**。产品决策见[决策 0001](docs/decisions/0001-platform-first.md)，阶段进展见[路线图](docs/roadmap.md)。MCP 已退出默认产品路径；原始启动提示词与 v0.1 验收仅保留为历史材料。

## 从源码启动

要求 Node.js **24+**、pnpm **11.16.0**。在项目目录执行：

~~~powershell
pnpm install --frozen-lockfile
pnpm build
pnpm platform:start
~~~

平台独立运行在 [http://127.0.0.1:3210](http://127.0.0.1:3210)，保持此终端运行。在另一个终端准备一轮原创演示：

~~~powershell
node examples/prepare-demo.mjs
~~~

也可以用 `pnpm ezlearn start` 启动同一个本地平台，或用 `pnpm ezlearn platform doctor --json` 检查当前连接。数据保存在 `.ezlearn/learning.sqlite`；本地平台生成的连接凭证保存在实例目录，CLI 仅向匹配的端点使用它。程序尚未发布 npm 包或下载版安装器，当前请使用源码构建路径。

**先启动平台，再运行学习命令。** 平台停止时 CLI 会报告连接错误并给出启动提示，不能再离线写入 SQLite。

## 学习包与一轮学习

在 Web 的“我的书架”上传 `pack.json`，或填写公开 GitHub 仓库与明确 ref，由平台解析实际 commit、校验并安装。版本升级会保留旧版本和历史课程快照。CLI 也可发起同样的安装操作：

~~~powershell
pnpm ezlearn pack install ./packs/english-demo --json
pnpm ezlearn pack list --json
~~~

English Demo 有 4 个知识点、16 道原创题、讲义和练习蓝图，**仅用于功能演示，不是官方考纲、真题库或完整备考课程**。

仓库提供 `.agents/skills/ezlearn` 入口。支持的宿主加载技能后，选择 `$ezlearn` 并输入：

~~~text
/ezlearn 我要学英语，每天15分钟，先用English Demo体验。
~~~

Agent 查询目标和进度、检索材料，创建并发布一节短课。你在 Web 阅读、保存草稿并提交后，把页面的“继续学习”提示词复制回来。提示词包含准确的 `attempt_id` 与实例地址，不含密钥。Agent 读取原题、rubric 和作答，写回逐题反馈；平台计算客观分、校验主观分并保存进度。

`/ezlearn` 是学习意图入口，各宿主注册方式不同。Codex 可用 `$ezlearn` 显式选择；未加载技能时可要求 Agent 读取 `integrations/skills/ezlearn/SKILL.md`。完整接入方式见[Agent 接入](docs/agent-integration.md)。

## 切换实例

CLI profile 保存端点和凭证引用，不再以 local/remote 区分学习执行逻辑。以下为云端配置示例，先将真实端点写入 `.ezlearn/cloud-profile.json`：

~~~json
{"endpoint":"https://你的学习平台域名","token_env":"EZLEARN_API_TOKEN"}
~~~

~~~powershell
pnpm ezlearn profile set --name cloud --input .ezlearn/cloud-profile.json --json
pnpm ezlearn profile list --json
pnpm ezlearn profile use cloud --json
pnpm ezlearn status --json
~~~

也可用 `--profile NAME` 为单次命令选择实例。`--endpoint URL` 覆盖成另一端点时，不会携带原 profile 的凭证引用；需要匹配的本地连接文件，或显式传入 `--token-env ENV` / `--connection-file FILE`。**切端点只改变连接位置，不会搬迁学习记录**；延续原进度需先按[迁移文档](docs/migration.md)导出、校验并导入到新实例。

多个本地实例可在 profile 中用 `connection_file` 引用各自的连接文件。CLI 会确认其中 endpoint 与目标完全匹配后才读取凭证，详见接入文档。

## 实现范围与后续工作

本阶段保留目标、课程快照、草稿、提交、阅卷、证据、规则复习、逻辑导入导出，以及 SQLite/D1/libSQL 存储适配，收敛为平台统一 HTTP 路径。Cloudflare/Vercel 是平台部署适配，不是不同的客户端产品模式。

单用户纯文本实例目前上限 **1,500,000 UTF-8 字节**，单包最多 384,000 字节。暂不支持二进制附件、多租户、双向同步或内置模型聊天。应用版本与学习包版本分开管理，升级不能重写历史成绩。

下载安装器、升级检查、升级前备份、数据库迁移、失败回滚和可选自动升级按顺序推进，当前不宣称已经提供在线更新或后台进程监管。提醒由用户明确启用后的宿主任务承担。

验证入口：

~~~powershell
pnpm typecheck
pnpm test
pnpm build
pnpm build:cloudflare
pnpm build:vercel
pnpm test:browser
~~~

当前阶段的实际结果及未验证项见[验收记录](docs/verification.md)。[v0.1 验收](docs/archive/v0.1-verification.md)记录旧架构，不能作为当前 CLI 或接入方式的使用说明。

## 文档

- [产品与范围](docs/product.md)
- [平台架构与数据](docs/architecture.md)
- [学习包格式与版本管理](docs/pack-format.md)
- [CLI、Skill 与 Agent 接入](docs/agent-integration.md)
- [本地与云端部署](docs/deployment.md)
- [数据迁移与端点切换](docs/migration.md)
- [平台生命周期路线图](docs/roadmap.md)
- [当前阶段验收](docs/verification.md)

项目与原创演示内容的正式许可证待作者确认。不要提交真实密钥、数据库、原始对话或导出备份。
