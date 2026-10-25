# 迁到新的主实例

迁移使用版本化逻辑 JSON，不能把本地 SQLite 文件上传到云数据库。首版只支持空目标实例：目标已有学习包、目标、课程或其他学习数据会返回 `NONEMPTY_TARGET`。不会悄悄合并或覆盖。

## 导出与校验

先停止源 Web，暂停会写课程/评价的 Agent 或宿主任务，确保只有本次迁移操作。一次 export 读取单个 SQL revision 的完整一致快照；导出后到切换期间不要继续在源实例学习。

```powershell
pnpm ezlearn status --data-dir ./.ezlearn --json
pnpm ezlearn export --data-dir ./.ezlearn --output ./learning-backup.json --json
pnpm ezlearn import --validate --data-dir ./.ezlearn-new --input ./learning-backup.json --json
```

迁移包封套为 `format: ezlearn-export`、`version: 1`、`exported_at`、`source_revision`、SHA-256 `checksum` 与 `data`。data 包括准确版本的学习包/材料、目标、课程和生成题快照、作答、评价与修订、知识点进度及学习证据。正文和材料使用稳定 ID/安全相对路径；当前没有二进制附件。

校验会检查格式/版本、checksum、包内容校验、关联 ID、课程材料/题库快照、答题状态、客观成绩、逐题与总成绩，以及重新计算的进度/证据一致性。校验失败不会写入目标。checksum 用于发现数据损坏，不是来源签名；只导入自己信任的备份。

部署 token、会话密钥、数据库凭证与 profile 不进入学习数据导出。目标实例需要独立配置认证和 base URL。备份含用户答案和简短上下文，请按个人学习数据保管；不要提交 Git。

## 本地 A → 全新 B

```powershell
pnpm ezlearn import --data-dir ./.ezlearn-new --base-url http://127.0.0.1:3211 --input ./learning-backup.json --json
pnpm ezlearn status --data-dir ./.ezlearn-new --base-url http://127.0.0.1:3211 --json
pnpm ezlearn call dashboard --data-dir ./.ezlearn-new --base-url http://127.0.0.1:3211 --json
pnpm ezlearn attempt pending --data-dir ./.ezlearn-new --json
pnpm ezlearn start --data-dir ./.ezlearn-new --port 3211 --base-url http://127.0.0.1:3211
```

对照 import 返回的各实体 counts 与源 export.data，抽查历史课程、原成绩、待阅卷与材料引用。课程 URL 在读取时以新 base URL 生成，因此原 lesson ID 仍可打开。

切换前再次读取**源** status；其 revision 必须等于备份 `source_revision`。如果不同，说明有未迁移的写入：停止源写入，重新导出，再导入到另一个空目标。不要继续使用已经过时的目标副本。

确认后让 Agent 固定使用新 `--data-dir` / `EZLEARN_DATA_DIR` 与 base URL。旧实例保留关闭状态的备份，避免误向两边写入。之后继续 `/ezlearn`，先恢复目标实例中的待处理事项。

## 切到远程

先按[部署文档](deployment.md)初始化空 D1/libSQL 实例，并确认认证与 Web 可用。建立单独的 CLI profile 目录，文件 `remote-profile.json` 示例：

```json
{"kind":"remote","url":"https://你的域名","token_env":"EZLEARN_API_TOKEN"}
```

```powershell
pnpm ezlearn profile set --data-dir ./.ezlearn-remote --input ./remote-profile.json --json
pnpm ezlearn status --data-dir ./.ezlearn-remote --json
pnpm ezlearn import --validate --data-dir ./.ezlearn-remote --input ./learning-backup.json --json
pnpm ezlearn import --data-dir ./.ezlearn-remote --input ./learning-backup.json --json
```

`EZLEARN_API_TOKEN` 由安全的进程环境提供。远端相同 RPC 和 MCP 使用同一核心，导入不会经过临时函数磁盘。确认 counts、成绩、待阅卷、链接及源 revision 后，把日常 Agent profile/MCP URL 指向新实例。

## 失败恢复

格式不支持、checksum 不一致、引用断裂或非空冲突时保留备份和源实例，修正原因后用新的空目标重试。导入校验和最终状态 CAS 提交分开，成功写入是一次原子状态替换，不留下半套学习记录。若网络导致结果不确定，先查询目标 counts/历史；不要把空目标约束当作可绕过的错误删除历史。

本项目不提供双向同步。迁移后如需回退，应停止新实例写入，保留其最新导出，再明确选择哪个实例继续作为主实例。
