# 本地与云端平台部署

ezlearn 平台可以独立运行，统一提供 Web 和 HTTP API。CLI 连接端点，不根据部署位置选择不同学习逻辑。平台不需要模型 API Key；实例配置、学习数据与客户端连接配置各有边界。

## 本机平台

要求 Node.js 24+、pnpm 11.16.0。当前从源码构建，未发布 npm 包或下载版安装器：

~~~powershell
pnpm install --frozen-lockfile
pnpm build
pnpm platform:start
~~~

保留此终端，在另一个终端执行：

~~~powershell
node examples/prepare-demo.mjs
~~~

也可直接运行构建后的独立平台：

~~~powershell
node dist/platform/index.js --data-dir .ezlearn --port 3210 --base-url http://127.0.0.1:3210
~~~

`pnpm ezlearn start` 或 `pnpm ezlearn platform start` 提供同一启动能力。默认只绑定 127.0.0.1，Web 在 http://127.0.0.1:3210，学习数据库在实例目录 learning.sqlite。本地平台生成 connection.json，供匹配端点的 CLI 读取实例凭证，不在状态输出或课程链接显示凭证。

--data-dir / EZLEARN_DATA_DIR 选择实例目录；--port 选择监听端口；--base-url / EZLEARN_BASE_URL 是平台生成链接和检查来源的公开地址。改变端口时应同步 base URL；当前本地地址必须为 http://127.0.0.1:<port>。跨设备访问请部署有认证的远端平台。

同一数据目录只允许一个活跃平台，换端口也不能同时启动第二个。Windows 使用命名管道，Linux 使用抽象 Unix socket，进程退出或异常结束后由系统释放目录锁。其他 Unix 使用普通 socket；异常退出留下锁文件时会保守拒绝启动，确认没有活跃实例后再人工清理报错中指定的锁路径，不会自动删除未知锁。

CLI 的 --config-dir 选择客户端配置目录，默认使用 --data-dir。学习命令的 --endpoint / EZLEARN_ENDPOINT 或命名 profile 选择服务地址。平台停止时不能离线备课、阅卷或导出；保持平台运行，再调用学习操作。

没有常驻守护进程。当前终端退出即停止该本机进程，需要后台运行时由实例所有者选择进程管理器。诊断当前端点：

~~~powershell
pnpm ezlearn platform doctor --json
pnpm ezlearn status --json
~~~

## Cloudflare Workers + D1

入口 deploy/cloudflare/worker.ts，配置 deploy/cloudflare/wrangler.jsonc。DB 是 D1 binding，ASSETS 是同一份构建 Web；纯文本学习包保存在数据库，不需要 R2。

本地模拟：

~~~powershell
pnpm build
pnpm exec wrangler d1 migrations apply ezlearn --local --config deploy/cloudflare/wrangler.jsonc
pnpm exec wrangler types --config deploy/cloudflare/wrangler.jsonc --include-runtime=false --env-interface CloudflareEnv deploy/cloudflare/worker-configuration.d.ts
pnpm build:cloudflare
pnpm exec wrangler dev --local --config deploy/cloudflare/wrangler.jsonc
~~~

在 deploy/cloudflare/.dev.vars 中提供 EZLEARN_API_TOKEN（至少 24 个随机字符）和 EZLEARN_SESSION_SECRET（至少 32 个随机字符），不要提交该文件。默认本地 base URL 为 http://127.0.0.1:8787；本地模拟不要加 --remote。CLI profile 指向该端点，并用 token_env 引用匹配的进程环境变量。

实际部署由实例所有者执行：

1. `pnpm exec wrangler login` 登录预期账号。
2. `pnpm exec wrangler d1 create ezlearn`，将实际 database_id 写入配置替换全零占位值。
3. 将 EZLEARN_BASE_URL 改为实际 HTTPS 域名，设置稳定 EZLEARN_BACKEND_ID。
4. 用 `pnpm exec wrangler secret put EZLEARN_API_TOKEN --config deploy/cloudflare/wrangler.jsonc` 和同样方式设置 EZLEARN_SESSION_SECRET，交互输入，不写入命令参数。
5. `pnpm exec wrangler d1 migrations apply ezlearn --remote --config deploy/cloudflare/wrangler.jsonc`。
6. `pnpm build` 后 `pnpm exec wrangler deploy --config deploy/cloudflare/wrangler.jsonc`。

Web 登录后可管理包和学习；Agent 的 CLI 以同一 HTTP API 访问实例。这里没有默认 MCP 入口。仅构建或本地模拟通过不代表已经实际云部署。

## Vercel Functions + 外部 libSQL/Turso

入口 deploy/vercel/api.ts，构建脚本生成 Vercel Build Output 的静态 Web 与 api.func，使用 Node.js 24。正式数据保存在外部 libSQL，函数 /tmp 或本地 SQLite 不能作为持久学习数据库。

~~~powershell
pnpm build
pnpm build:vercel
~~~

部署环境：

| 变量 | 用途 |
| --- | --- |
| TURSO_DATABASE_URL | libsql://... 外部数据库 URL |
| TURSO_AUTH_TOKEN | 数据库凭证 |
| EZLEARN_BASE_URL | 实际 HTTPS 域名，与浏览器来源一致 |
| EZLEARN_BACKEND_ID | 稳定实例标识 |
| EZLEARN_API_TOKEN | 至少 24 字符，教师 API 与 Web 首次登录凭证 |
| EZLEARN_SESSION_SECRET | 至少 32 字符，Web 会话 HMAC 密钥 |

安全设置数据库环境变量后执行一次 `pnpm exec tsx deploy/vercel/initialize.ts`，幂等初始化 schema。函数不会在每次请求时自动迁移。用户安装并登录 Vercel CLI 后，可执行 `vercel deploy --prebuilt`；项目构建命令为 `pnpm build && pnpm build:vercel`。没有账号或凭证时只生成产物，不创建云资源。

## 认证、数据与更新

远端 Web 登录换取 HttpOnly、SameSite=Strict 会话，HTTPS 下有 Secure 标志；教师 HTTP API 使用 Bearer。本地平台也验证真正的实例教师凭证，不以任意 Authorization 字符串充当教师身份。学习页面不持有教师 token，未评价题目的答案键不通过学习接口暴露。

/health 是服务可达与协议标识，不替代数据库与学习业务检查。诊断后应安装测试包、读写一轮课程并核对持久化。base URL 错误会造成来源拒绝或错误课程链接。

应用版本生命周期归平台与发布系统；CLI 是管理入口。当前源码版本尚无在线更新器，后续先交付发布制品、升级检查、备份/迁移和失败回滚，再提供用户可启用的自动升级。学习逻辑备份使用 export，不含部署密钥，详见[迁移文档](migration.md)和[路线图](roadmap.md)。
