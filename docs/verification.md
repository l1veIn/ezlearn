# v0.1 验收记录

日期：2026-10-25 至 2026-10-26。验证环境为 Windows、Node.js 24、本地 SQLite、libSQL 文件后端、Cloudflare workerd/D1 模拟器及真实浏览器。本文区分实际运行结果与尚需账号/凭证的部署步骤。

## 已通过的构建与自动检查

| 检查 | 实际结果 |
| --- | --- |
| `pnpm typecheck` | TypeScript 检查通过 |
| `pnpm test` | 15 项核心业务与传输测试通过 |
| `pnpm test:browser` | 1440×1000 桌面浏览器回归，13 项流程检查通过 |
| `pnpm build` | Node CLI/server 与 React/Vite Web 产物构建通过 |
| `pnpm build:cloudflare` | Wrangler dry run 通过，未发布 |
| `pnpm build:vercel` | Vercel Build Output 生成通过，未发布 |
| English Demo 包校验 | 正式校验器通过；4 个知识点、16 道原创题、4 个可组卷蓝图 |
| 演示入口重复调用 | `prepare-demo.mjs` 连续执行返回相同目标与课程 |

核心测试覆盖了草稿与提交交接、平台客观阅卷、主观分数范围、必填反馈、版本冲突、无效状态、并发与幂等、重做、评价修订与证据重建、未知能力、薄弱点选题、包版本不可变、蓝图数量/分值/覆盖、重启持久化、迁移、错误导入原子拒绝，以及重复 topic 不能制造额外证据。具体断言见 `tests/core.test.ts`。

传输测试用官方 MCP 客户端通过真实 HTTP 连接，不把普通 JSON REST 当作 MCP；同时验证远程登录 cookie、Bearer 教师权限、浏览器隐藏答案和跨站请求拒绝。具体断言见 `tests/transport.test.ts`。

## 实际学习闭环

从正式 CLI 创建 English Demo 目标，检索讲义，发布一轮“如果请求失败，我们就再试一次”的短课。讲解用 API 超时重试作为工作情境，安排 2 道单选和 1 道简答。

真实 IAB 浏览器完成以下操作：

1. 打开课程，阅读目标、讲解、例子与材料引用。
2. 选择两个单选答案并填写简答，保存服务端草稿。
3. 刷新页面，确认选项和简答恢复。
4. 提交后看到“已提交，待老师反馈”，页面交接提示词包含本次准确 attempt_id 与 backend。
5. 通过正式 CLI 读取教师视图并提交逐题评价，平台计算得到 **6/8**，保存反馈与进度。
6. 根据该轮条件句的薄弱证据发布第二轮巩固课程；包含 1 道 Agent 生成的情境题，参考答案、评分标准与来源类型保存在课程快照。

另外通过 Playwright 驱动 Microsoft Edge，以 1440×1000 桌面尺寸，在全新独立实例完成同一闭环，实际核对剪贴板提示词、客观题分数保护、重启后的 6/8 成绩及第二课页面，无浏览器 pageerror。运行 `pnpm build` 后执行 `pnpm test:browser`；Windows 默认使用已安装的 Edge，其他系统先 `pnpm exec playwright install chromium`，也可用 `EZLEARN_BROWSER_CHANNEL` 选择已安装的浏览器。脚本仅使用新建的 `.tmp/browser-acceptance/` 数据目录；报告与截图在该忽略目录内。

这条路径验证了从备课到答题、显式交接、反馈和下一轮续学的业务流程。固定原创课程与教师反馈用于协议与业务验收，没有据此评估长期学习效果或考试提升。

## MCP 与存储适配

官方 Streamable HTTP MCP 客户端实际发现 **27 个工具**，调用安装包、目标、进度、创建/发布课程、待阅卷读取与评价提交，得到与 CLI 相同的状态和评分语义。

Cloudflare 使用真实 workerd 与本地 D1 模拟器完成安装、目标、课程、作答和评价，得到 6/6；重复相同 review 后未重复计分或积累进度。脚本为 `scripts/validate-cloudflare.mjs`；运行前按部署文档初始化本地 D1、配置本地 secrets 并启动 Wrangler。本地模拟不等于部署到 Cloudflare 账号。

libSQL 适配器通过真实文件后端与独立子进程完成学习、评价及导入流程。它验证 SQL 与 CAS 语义；没有连接外部 Turso 服务，不能由此推断网络凭证与云端连接已验证。

Vercel 构建产物可加载；缺少外部 libSQL 配置时返回明确的 503 配置错误。正式函数入口已准备，但尚未在 Vercel 云端运行。

## 持久化与迁移

测试从 SQLite 实例 A 导出一致 revision 快照，再导入全新实例 B；更换 base URL 后仍可读取历史课程、原成绩、待阅卷、材料片段并继续学习。重新打开数据库后这些记录仍在。错误版本、损坏 checksum、悬空引用、进度与成绩不一致、非空目标等情况必须在完整校验后拒绝，不留下部分学习数据。

操作路径及源 revision 的切换前检查见[迁移文档](migration.md)。迁移模型是换一个主实例、旧实例保留备份，未实现双向同步。

## 明确未验证或未启用

- 未执行 Cloudflare 或 Vercel 真实云部署，未创建云资源；需用户配置账号、实际数据库 ID/URL、访问 token、session secret 和 HTTPS base URL 后部署。
- 未连接外部 Turso/libSQL 网络服务；需在用户环境初始化并验证认证读写。
- Codex 仓库技能入口已写入；本轮未验证新会话的技能选择与自定义 slash 注册。Codex 可用 `$ezlearn` 显式选择，`/ezlearn` 是工作流意图兼容入口。其他宿主按其自身规则接入。
- 没有启用用户提醒、定时 Agent 调用或手机推送。只交付宿主提示词模板与每日幂等键约定。
- English Demo 不是四六级官方考纲、真题或完整备考课程。项目与演示内容的正式许可证待作者确认。

v0.1 面向单用户纯文本学习，实例状态上限 **1,500,000 UTF-8 字节**，单个学习包最多 384,000 字节，没有二进制附件。超限明确报错；未来扩容需要新存储版本，当前不会删除历史或承诺无限容量。
