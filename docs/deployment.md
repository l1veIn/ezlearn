# 本地与自部署

平台不需要模型 API Key。云端代码与构建配置已提供；账号、数据库、域名与凭证由用户配置。项目开发过程不执行真实云发布或资源创建。各运行时实际验证状态见 README。

## 本地

要求 Node.js 24+ 与 pnpm。仓库尚未发布 npm 包，请从源码运行：

```powershell
pnpm install --frozen-lockfile
pnpm build
node examples/prepare-demo.mjs
pnpm ezlearn start
```

默认监听 `127.0.0.1:3210`，SQLite 与 profile 在当前目录 `.ezlearn/`。首次打开 `http://127.0.0.1:3210`。数据目录可用 `--data-dir` 或 `EZLEARN_DATA_DIR` 固定；链接 base URL 用 `--base-url` 或 `EZLEARN_BASE_URL`。本地仅接受回环 Host，不提供暴露到公网的开关；跨设备访问请部署有认证的远端模式。

本地没有常驻守护进程，关掉终端就停止 Web。CLI 仍能在 Web 停止时直接备课、阅卷和导出。每次启动会幂等初始化本地 schema；用户数据和构建产物已加入 Git 忽略。

## Cloudflare Workers + D1

入口 `deploy/cloudflare/worker.ts`，配置 `deploy/cloudflare/wrangler.jsonc`。`DB` 是 D1 binding，`ASSETS` 是构建后的 Web；纯文本材料随包保存于数据库，不需要 R2。兼容日期与 Wrangler 类型生成随配置固定。

只做本地模拟：

```powershell
pnpm build
pnpm exec wrangler d1 migrations apply ezlearn --local --config deploy/cloudflare/wrangler.jsonc
pnpm exec wrangler types --config deploy/cloudflare/wrangler.jsonc
pnpm build:cloudflare
pnpm exec wrangler dev --local --config deploy/cloudflare/wrangler.jsonc
```

在 `deploy/cloudflare/.dev.vars` 设置随机的 `EZLEARN_API_TOKEN`（至少 24 字符）与 `EZLEARN_SESSION_SECRET`（至少 32 字符），勿提交文件。配置默认本地 base URL 为 `http://127.0.0.1:8787`，修改 dev 端口也必须同步 base URL。使用本地模拟时不要加 `--remote`。

真正部署需要用户明确决定后执行：

1. 用 `pnpm exec wrangler login` 登录自己的账号。
2. `pnpm exec wrangler d1 create ezlearn` 创建数据库，将返回的 database_id 写入配置，替换全零占位值。确认数据库属于预期账号。
3. 把配置中的 `EZLEARN_BASE_URL` 改成实际 HTTPS 域名，设置稳定 `EZLEARN_BACKEND_ID`。
4. 通过 `pnpm exec wrangler secret put EZLEARN_API_TOKEN --config deploy/cloudflare/wrangler.jsonc` 和同样方式设置 `EZLEARN_SESSION_SECRET`。交互输入凭证，不写到命令参数或仓库。
5. `pnpm exec wrangler d1 migrations apply ezlearn --remote --config deploy/cloudflare/wrangler.jsonc`。
6. `pnpm build` 后执行 `pnpm exec wrangler deploy --config deploy/cloudflare/wrangler.jsonc`。

部署前先安装包或按[迁移文档](migration.md)导入。Web 登录后可答题；Agent 连接 `/mcp` 或有 Bearer 的管理 RPC。D1 schema 文件在 `migrations/0001_state.sql`。

## Vercel Functions + libSQL/Turso

入口 `deploy/vercel/api.ts`，构建脚本生成 Vercel Build Output：静态 Web 与 `api.func`。使用 Node.js 24 runtime，学习状态写到外部 libSQL，不能使用函数本地 SQLite 或 `/tmp` 作为正式数据。

```powershell
pnpm build
pnpm build:vercel
```

在自己的外部 libSQL/Turso 服务创建空数据库，设置部署环境：

| 变量 | 用途 |
| --- | --- |
| `TURSO_DATABASE_URL` | `libsql://...` 外部数据库 URL |
| `TURSO_AUTH_TOKEN` | 数据库访问凭证 |
| `EZLEARN_BASE_URL` | 实际 HTTPS 域名，必须与浏览器来源一致 |
| `EZLEARN_BACKEND_ID` | 稳定实例标识 |
| `EZLEARN_API_TOKEN` | 至少 24 字符，教师与首次 Web 登录凭证 |
| `EZLEARN_SESSION_SECRET` | 至少 32 字符，Web 会话 HMAC 密钥 |

在已安全设置上述数据库环境变量的终端执行一次 `pnpm exec tsx deploy/vercel/initialize.ts`，幂等初始化 schema 与空状态。函数不会在每次请求时自动执行迁移。Build Output 生成后，用户可使用自己安装并登录的 Vercel CLI 执行 `vercel deploy --prebuilt`；项目构建设置使用 `pnpm build && pnpm build:vercel`，并使用仓库的 lockfile。没有账号/凭证时仅本地生成产物，不能声称部署成功。

## 认证与恢复

远端 Web 输入部署访问 token 后，服务器签发 HttpOnly、SameSite=Strict 的会话 cookie，HTTPS 下有 Secure 标志，有效期 7 天；页面不保存教师 token。教师 MCP/管理 API 使用 Bearer，普通学习会话不能访问题目答案键或提交教师评价。修改请求受配置 base URL 的同源检查保护。这个版本为单用户实例，不是多用户登录系统。

`/health` 只显示服务版本，不表示数据库迁移与凭证已经正确。用带认证的 `get_status`、安装/读取一个测试包和实际课程流程验收部署。base URL 错误会产生来源校验或错误链接，请先修配置。密钥轮换、数据库备份和故障恢复由实例所有者负责；学习逻辑备份使用 export，不包含部署密钥。
