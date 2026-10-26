# 数据迁移与端点切换

切换 profile 或 endpoint 只改变 CLI 连接的实例，不自动复制学习数据。迁移使用版本化逻辑 JSON；本地 SQLite 文件不能作为跨 SQLite/D1/libSQL 的通用迁移包。

当前只接受空目标实例。目标已有学习包、目标、课程或学习记录会返回 NONEMPTY_TARGET，不静默合并或覆盖。迁移模型是换一个主实例，旧实例保留备份，不提供双向实时同步。

## 保留平台运行，暂停学习写入

CLI 现在通过 HTTP 导出，因此源平台需要保持运行。暂停学习提交、备课、阅卷以及可能写入的宿主任务，只保留本次迁移操作。一次 export 读取单个 SQL revision 的完整一致快照；导出后到切换前不要继续向源实例写入。

~~~powershell
pnpm ezlearn status --data-dir .ezlearn --endpoint http://127.0.0.1:3210 --json
pnpm ezlearn export --data-dir .ezlearn --endpoint http://127.0.0.1:3210 --output ./learning-backup.json --json
~~~

封套包含 format=ezlearn-export、version=1、exported_at、source_revision、SHA-256 checksum 与 data。data 包括准确包版本和材料、目标、课程及生成题快照、答案、评价与修订、进度和证据，不包含 profile、实例连接文件或部署密钥。当前没有二进制附件。

平台校验格式/版本、checksum、包内容、关联 ID、题目/材料快照、作答唯一性、成绩与修订，以及重建的进度/证据。checksum 用于发现损坏，不是来源签名。备份含个人答案和上下文摘要，应按学习数据保管，不提交 Git。

## 本地 A → 新 B

在另一个终端启动空 B，使用新的数据目录与端口：

~~~powershell
node dist/platform/index.js --data-dir .ezlearn-new --port 3211 --base-url http://127.0.0.1:3211
~~~

保持 B 运行，在操作终端执行：

~~~powershell
pnpm ezlearn import --validate --data-dir .ezlearn-new --endpoint http://127.0.0.1:3211 --input ./learning-backup.json --json
pnpm ezlearn import --data-dir .ezlearn-new --endpoint http://127.0.0.1:3211 --input ./learning-backup.json --json
pnpm ezlearn status --data-dir .ezlearn-new --endpoint http://127.0.0.1:3211 --json
pnpm ezlearn call dashboard --data-dir .ezlearn-new --endpoint http://127.0.0.1:3211 --json
pnpm ezlearn attempt pending --data-dir .ezlearn-new --endpoint http://127.0.0.1:3211 --json
~~~

这里 --data-dir 让 CLI 找到 B 的本地连接文件，--endpoint 明确 HTTP 目的地，不能通过数据目录直接写库。导入后对照 counts，抽查历史课程、原成绩、待阅卷和材料引用。课程 URL 按 B 的 base URL 重新生成，lesson ID 保持稳定。

切换前再次读取 A 的 status，revision 必须等于备份 source_revision。若不同，说明发生了未迁移写入：先暂停写入、重新导出，再导入另一个空目标。不要继续使用过时副本。

确认 B 正确后，再把日常 CLI 的端点、凭证引用和默认 profile 指向 B。关闭旧主实例，保留其备份。之后继续 /ezlearn，优先恢复迁入的待办。

## 本地 → 云端

按[部署说明](deployment.md)初始化空 D1 或外部 libSQL 平台，确认 HTTPS、认证与 Web 可用。写入 .ezlearn/cloud-profile.json：

~~~json
{"endpoint":"https://你的平台域名","token_env":"EZLEARN_API_TOKEN"}
~~~

~~~powershell
pnpm ezlearn profile set --name cloud --input .ezlearn/cloud-profile.json --json
pnpm ezlearn import --validate --profile cloud --input ./learning-backup.json --json
pnpm ezlearn import --profile cloud --input ./learning-backup.json --json
pnpm ezlearn status --profile cloud --json
~~~

匹配云实例的 EZLEARN_API_TOKEN 由进程环境提供，token_env 仅保存变量名。核对 counts、成绩、待阅卷、课程链接和源 revision 后，再执行 `pnpm ezlearn profile use cloud --json`。上传和导入通过同一 HTTP API，数据不会依赖 CLI 所在机器的目录或函数临时磁盘。

## 失败恢复

格式不支持、checksum 错误、引用断裂或非空冲突在写入前拒绝。导入成功是一次 CAS 原子状态替换，不留下半套数据。网络中断导致结果不确定时，先查询目标状态和历史，不删除目标记录来强行重试。

升级到平台化版本时继续使用原实例目录，旧 SQLite 学习数据保持原格式。旧 profile 的兼容转换由 CLI 处理；转换前后检查 endpoint，确认指向预期实例。应用版本升级与学习数据迁移不是同一操作，发布与升级流程见[路线图](roadmap.md)。
