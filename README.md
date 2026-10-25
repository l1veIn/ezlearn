# ezlearn

私有源码仓库：[l1veIn/ezlearn](https://github.com/l1veIn/ezlearn)。

**让你已有的 Agent，用熟悉的工作情境，带你每天学一点。**

每轮约 15 分钟：读一小段讲解，做几道题，把提交提示词带回 Agent，得到反馈并保存进度。目标、依赖和答题证据决定学什么；最近的工作决定从什么例子讲起。平台不要求 LLM API Key。

界面采用暖纸色、墨色文字与克制的苔绿，像一本每天翻开的学习札记。默认本地运行，也提供 Cloudflare 与 Vercel 自部署入口。

## 最快体验

要求 Node.js **24+**、pnpm，在源码目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm build
node examples/prepare-demo.mjs
pnpm ezlearn start
```

打开 [本地学习页](http://127.0.0.1:3210)。演示脚本通过正式 CLI 安装 English Demo、创建目标并发布一轮条件句课程，重复执行返回同一课。默认学习数据保存在 `.ezlearn/learning.sqlite`，重启后仍在。程序尚未发布到 npm，请使用以上源码路径，不使用虚构的 `npx ezlearn`。

English Demo 有 4 个小知识点、16 道原创题和讲义/组卷蓝图，只用于功能演示，**不是官方考纲、真题库或完整备考课程**。若目标是四级等考试，需要匹配真实考纲与合法内容的学习包。

## 用 Agent 开始

仓库已提供 `.agents/skills/ezlearn` 入口。新开 Codex 会话加载技能后，用 `$ezlearn` 选择技能，再说：

```text
/ezlearn 我要学英语，每天15分钟，先用English Demo体验。
```

`/ezlearn` 是统一的学习意图；各宿主的自定义斜杠注册方式不同，Codex 可用 `$ezlearn` 显式选择。当前会话若尚未加载，可直接要求：“读取 `integrations/skills/ezlearn/SKILL.md` 并执行 `/ezlearn ...`”。完整安装、远程 MCP 与宿主边界见[接入文档](docs/agent-integration.md)。

在 Web 保存草稿、刷新继续，然后提交。页面会显示“已提交，待老师反馈”，复制“继续学习”提示词回 Agent；其中有准确 attempt_id 与 backend，不含密钥。Agent 读取原题与 rubric，逐题反馈并写回评价；刷新结果页即可查看。下次 `/ezlearn` 会先处理未完成事项、待阅卷和复习。

也可以手动查看教师数据并提交 JSON 评价：

```powershell
pnpm ezlearn attempt pending --json
pnpm ezlearn attempt show 你的attempt_id --json
pnpm ezlearn review submit --input ./my-review.json --json
```

`examples/inputs/review.json` 提供格式示例，需替换 ID、实际评分与反馈，不能把示例分数当真实评价。客观题由平台按答案键计算；简答按 rubric 给分。

## v0.1 实现与边界

| 能力 | 实现 |
| --- | --- |
| 学习闭环 | 目标、发布快照、草稿、提交、阅卷、证据、规则复习 |
| 学习包 | 本地目录 / 公开 GitHub 指定 ref，校验、检索、不可变版本 |
| 传输 | 本地 CLI、中文 Web、官方 SDK Streamable HTTP MCP，共享业务核心 |
| 持久化 | 本地 SQLite、Workers D1、Vercel 外部 libSQL 适配 |
| 迁移 | 版本化 JSON、完整性/引用/成绩校验、原子导入空实例、新 base URL |
| 接入 | 薄 Skill、Codex 仓库入口、定时提示词与每日幂等键 |

单用户文本学习实例的状态上限为 **1,500,000 UTF-8 字节**，学习包最多 384,000 字节。v0.1 采用 SQL 单行有界聚合与 revision CAS，保证跨 SQLite/D1/libSQL 的状态原子性；不是无限容量内容平台。暂不支持二进制附件、团队、多租户、双向同步、内置模型或自动手机推送。

## 验证

自动检查入口：

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm build:cloudflare
pnpm build:vercel
```

桌面浏览器完整回归可运行 `pnpm test:browser`，使用隔离实例；Windows 默认用已安装的 Edge，其他系统先安装 Playwright Chromium。详细步骤见验收记录。

已通过类型检查、业务/传输测试、Web/CLI 构建、Cloudflare dry run 与 Vercel Build Output 构建。真实浏览器完成阅读、答题、草稿刷新恢复、提交和准确交接；正式 CLI 阅卷得到 6/8 并发布薄弱点巩固课。官方 HTTP MCP 客户端发现 27 个工具并完成教师闭环；workerd/D1 本地模拟与 libSQL 文件后端实际读写通过，迁移到新实例后历史、成绩和待阅卷保留。

详细证据与未验证项见[验收记录](docs/verification.md)。云端未实际发布，外部 Turso 未连接，宿主新会话 slash 触发未验，用户提醒未启用。固定原创教师输入验证协议与业务，不代表已验证长期教学效果。

## 文档

- [产品与范围](docs/product.md)
- [架构、数据和公开复习规则](docs/architecture.md)
- [学习包格式与版本升级](docs/pack-format.md)
- [Skill、Agent 接入与每日提示词](docs/agent-integration.md)
- [本地 / Cloudflare / Vercel 部署](docs/deployment.md)
- [导出、校验、迁移与切换](docs/migration.md)
- [实际验收记录与未验证项](docs/verification.md)

程序与原创演示内容的正式许可证待作者确认，当前没有自行选用开源许可证或代第三方授权。不要将真实密钥、用户会话原文、学习数据库或导出备份提交仓库。
