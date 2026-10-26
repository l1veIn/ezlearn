# v0.2 平台化第一阶段验收

日期：2026-10-26。v0.2.0 第一阶段已将 v0.1 的本地直连 / MCP 架构收敛为独立平台与统一 HTTP 客户端。

历史结果保存在 [v0.1 验收记录](archive/v0.1-verification.md)。其中的 MCP 工具数量、离线 CLI 操作和旧启动顺序仅对应历史提交，不能视为当前版本证据。

## 本阶段验收清单

以下为 Windows、Node.js 24 环境中的实际结果；CI 另行验证 Linux。没有实际发布云服务或创建云资源。

| 场景 | 实际结果 |
| --- | --- |
| 独立平台启动 | `dist/platform/index.js` 独立提供 Web 与 HTTP；原目录 1 个目标、2 节课、1 份已评价作答完整保留，重启实例 ID 不变 |
| HTTP 客户端 | 两个真实平台子进程与 CLI 完成业务；客户端目录无 SQLite，停服后为 PLATFORM_UNREACHABLE 并提示启动 |
| 命名端点 | set/list/use、单次 profile/endpoint 与显式凭证引用通过；覆盖端点不携带原凭证，兼容握手不带认证头 |
| 教师认证 | 本地、远端有效 Bearer 才能读取教师数据；伪造凭证拒绝；doctor 能区分可访问与教师凭证可用 |
| 平台包管理 | 真实浏览器上传并校验/安装 English Demo；GitHub 解析和 ref 安装由平台执行，确定性 HTTP 测试验证 commit/大小/格式与无写入校验；未借用占位仓库 |
| 学习闭环 | 独立启动 → Web 装包 → CLI HTTP 备课 → 草稿保存/刷新/提交 → 准确剪贴板交接 → 阅卷 6/8 → 重启恢复 → 打开续课；15 项桌面检查通过 |
| 幂等与快照 | 原有业务回归通过；重复提交/阅卷无重复证据，包升级不改旧题与成绩 |
| 数据迁移 | 真实 CLI 经 HTTP 从运行中 A 导出、空 B 导入，换端点后原成绩/课程/进度保留；core 回归覆盖待阅卷、损坏格式和非空拒绝 |
| 实例生命周期 | 同目录不同端口拒绝且不改连接文件；路径别名识别；端口占用失败释放锁；重复 close 安全；真实 Windows 子进程强杀后可重启 |
| 自动检查 | 29 项测试通过；typecheck、format:check、本地构建、Cloudflare dry run、Vercel Build Output 构建通过 |
| D1 与 libSQL | workerd+D1 独立本地实例经 HTTP 完成 6/6；重复评价后 revision 保持 7；libSQL 文件后端真实闭环与迁移校验通过 |
| 源码启动 | 从全新源码目录 frozen-lockfile 安装、构建、先独立启动平台，再通过 CLI HTTP 准备演示；独立 3213 端口页面 200、1 个目标和 1 节课程，doctor 全项通过 |

新增测试为 `tests/cli-platform.test.ts`、`tests/client-config.test.ts` 和 `tests/platform-lifecycle.test.ts`；HTTP 接入测试在 `tests/transport.test.ts`。浏览器回归使用 Edge/Playwright，1440×1000，无 pageerror；报告与 home/packs/result/continuation 截图保存在忽略目录 `.tmp/browser-acceptance/`。本地 D1 验收使用隔离 8788 端口与独立目录，自建进程和临时凭证已清理，未操作已有 8787 服务。

CLI 会兼容迁移旧 profile.json 到 profiles.json 并保留原文件，坏 remote URL 明确拒绝。学习存储格式没有变更；本次不是从 SQLite 文件复制到云端的迁移。

## 验证命令

~~~powershell
pnpm typecheck
pnpm format:check
pnpm test
pnpm build
pnpm build:cloudflare
pnpm build:vercel
pnpm test:browser
~~~

浏览器回归使用隔离实例与数据目录。Windows 默认使用已安装的 Edge，其他系统先安装 Playwright Chromium；可用 EZLEARN_BROWSER_CHANNEL 选择已安装浏览器。固定原创课程与教师反馈用于协议和业务验收，不代表长期教学效果。

## 未交付或需外部环境的能力

- 下载安装器、线上升级、可选自动升级、升级回滚仍按路线图推进。
- 云端真实部署、外部 Turso 认证连接、域名与生产凭证需在实例所有者环境验证。
- 宿主 slash 注册、技能选择与定时能力依其实际版本和权限验证，不由 HTTP 平台保证。
- 没有启用用户提醒、自动推送或付费资源创建。
- 当前纯文本实例上限 1,500,000 UTF-8 字节，单包最多 384,000 字节，无二进制附件。
