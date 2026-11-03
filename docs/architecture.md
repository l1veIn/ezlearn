# 平台架构与数据

产品边界由[决策 0001](decisions/0001-platform-first.md)确定。平台拥有学习业务与持久化，Web 和终端操作都进入同一个 HTTP 边界。

~~~mermaid
flowchart LR
  Skill[Skill 操作指南] -.指导.-> Agent[外部 Agent]
  Agent --> CLI[实例管理与操作 CLI]
  User[学习者] --> Web[Web 学习界面]
  CLI --> HTTP[平台 HTTP API]
  Web --> HTTP
  HTTP --> Core[LearningService + Zod]
  Core --> Storage[SnapshotStore CAS]
  Storage --> SQLite[本地 SQLite]
  Storage --> D1[Cloudflare D1]
  Storage --> LibSQL[外部 libSQL]
~~~

## 模块与依赖方向

- `src/contracts` 定义输入 schema、实体、版本与机器错误。
- `src/core` 负责包引用、选题、快照、状态、评分、证据、复习和逻辑迁移，不依赖 Node 文件系统。
- `src/storage` 适配 SQLite、D1 和 libSQL 的实际原子更新。
- 平台启动入口组合运行时、存储、HTTP 和静态 Web。`src/platform` 可独立启动本机平台，CLI 的 start 是它的便捷管理入口。
- `src/server` 负责认证、同源保护、HTTP 路由、GitHub 包获取和资源呈现。所有学习操作调用 `LearningService.execute`。
- `src/cli` 负责参数、命名 profile、端点、凭证引用、结构化输入输出和 HTTP 调用。学习命令不访问数据库，也不在连接失败时切换存储路径。
- `web` 呈现学习、答题和包管理。Skill 引用 CLI 帮助与简短流程；MCP 不属于当前默认依赖或发布接口。

CLI 的本地文件读取只是上传/下载边界：它可以把一个本地 pack.json 传给平台、将导出保存到文件。格式与引用校验、包版本安装和评分由平台执行。GitHub 仓库由平台按明确 ref 获取，云实例的包不存放在 CLI 私有目录。

## 连接与认证

客户端只理解 endpoint 与凭证引用。命名 profile 方便管理实例，没有 local/remote 两套学习逻辑；`--profile` 或 `--endpoint` 可以覆盖单次选择。端点是平台实例地址，课程 URL 由平台返回。

本地平台只监听回环地址，并在实例目录生成连接凭证。CLI 仅在端点匹配时读取该实例的 connection.json，凭证不出现在 JSON 输出、课程链接和交接文本中。远端凭证通过 profile 的 token_env 从进程环境读取。

Web 学习读取返回安全视图，完成评价前不暴露答案键、rubric 和解析。教师操作验证 Bearer；远端 Web 登录换取 HttpOnly、SameSite 会话。来源校验、请求大小限制和纯文本呈现由 HTTP 边界处理。单用户认证不代表团队权限系统。

## 有界聚合与原子性

当前 SQL 以一个带 revision 的聚合状态保存实体映射。状态上限 **1,500,000 UTF-8 字节**，超限返回 `CAPACITY_EXCEEDED`，不会删除历史。单包最多 384,000 字节。材料正文内联于包，课程保存题目和材料快照；当前无二进制资产或独立附件服务。

一次变更读取 revision 与状态，在副本校验计算，再执行单条 `UPDATE ... WHERE revision = ?`。写入冲突有限重读重算，用户 expected_version 过期明确拒绝。SQLite、D1、libSQL 都执行真实 CAS SQL，不把 D1 不支持的交互式事务包装成通用接口。迁移见 migrations，主键定位唯一实例行；实体列表与关联检索在有界快照内完成。

这是保留现有数据的一次边界重构。后续分表扩容有独立存储版本和迁移，不与 HTTP 客户端改造混做。

## 实体与历史

PackVersion 保存准确版本、内容、checksum、来源及解析的 GitHub commit；Goal 固定关联包版本。升级安装为新版本，旧版本保留，已有目标不会静默换内容。

Lesson 保存讲解、情境摘要、topic、kind 和题目/材料快照。Attempt 保存答案、版本和 `in_progress → submitted → reviewed` 状态；同课可以重做。Review 保存逐题成绩与反馈，修改需要当前版本和修订依据。Evidence 将题目得分关联目标、topic、作答及评价版本；Progress 区分曝光与练习证据。ID 稳定，时间存 ISO UTC，Web 按浏览器时区呈现。

重复发布、相同答案提交、相同阅卷幂等键不重复累积证据；相同 key 配不同内容拒绝。修订重建对应证据，不能把一次作答算成多次。发布内容不随学习包更新改变。

## 多媒体课程与资源（待实现）

2026-11-03 补充核心要求：每轮 Agent 教学可包含图片、音频和视频，课程与题目均可引用媒体。以下为下一阶段设计方向，尚未对应可用 schema、命令或接口。当前 Web 只分段呈现文本，不会将 Markdown 图片语法或 HTML 标签渲染为媒体。

目标存储分为结构化记录和媒体文件，两者都属于平台实例：

| 数据 | 保存内容 | 设计方向 |
| --- | --- | --- |
| 数据库 | 目标、课程内容块、资源元数据与引用、作答、评价、进度 | 保留版本和原子状态更新；当前有界聚合容量限制仍有效 |
| 媒体存储 | 图片、音频、视频、封面、字幕等文件 | 本地使用实例数据目录下的资源目录；云端使用持久对象存储，由平台适配 |

课程使用有序内容块组合文本、图片、音频、视频与练习引用。原有文本课程需兼容迁移。数据库保存稳定的 asset_id、类型、大小、内容校验和与来源等元数据，文件通过平台解析和授权访问；课程不绑定机器绝对路径、某个对象存储地址或有时效的下载链接。媒体文件通过独立 HTTP 上传路径接收，不以内联 Base64 进入现有 JSON 聚合。

Agent 可上传本轮生成的文件，再引用平台返回的资源 ID 编排课程。CLI 承担文件上传入口，平台负责校验、保存和生命周期。学习包安装也需解析资源清单、获取文件并记录内容版本；现有 GitHub 安装只下载根 pack.json，尚不处理仓库媒体。

发布前确认引用资源已完整保存并可用，再提交课程快照；发布后固定内容及媒体版本，包升级或 Agent 清理临时文件不能改变历史课程。未完成上传与未被引用的资源需有独立清理规则，不能误删已发布课程、题目或备份使用的资源。资源读取权限继承其所属内容的可见性，不能通过媒体接口提前暴露答案或评价依据。

Web 提供图片查看、音视频播放，以及替代文本、说明和字幕的呈现。内容编排遵循[剩余注意力理论](attention-theory.md)，让媒介服务理解和练习，减少额外的进入与操作负担。外部链接应明确标识为未归档引用，不能承诺与平台保存的文件相同的历史可用性。导出与迁移需携带资源清单及文件并校验完整性；当前 v1 JSON 导出只覆盖现有文本状态，不能充当未来多媒体实例的完整备份。

首轮验收应覆盖 Agent 上传并发布图文/音视频课、题目媒体可见性、重启后重看、包升级后历史不变，以及含媒体的导出恢复。媒体文件独立保存后，课程与资源元数据仍会增长，现有聚合的分表扩容需另有版本迁移，不能靠移出二进制文件宣称已消除容量边界。

## 公开复习规则

本轮某知识点得分率低于 60%，在提交后 1 天复习；60%～不足 85% 为 3 天；85% 及以上为 7 天。累计得分率至少 85% 且有至少 2 道题证据标记 demonstrated，至少 60% 为 practicing，其余已评价为 learning，没有评价为 unknown。

correct 是满分题数，earned/possible 保留部分分；发布课程只增加 exposures。选题先处理待办、到期与薄弱点，再检查未证明掌握的前置主题。这些指标表达已观察证据，不推断考试通过概率。

## HTTP 与 CLI

学习 RPC 接口为 `POST /api/rpc/:operation`，输入为 JSON 对象；结果封套统一为 `{ok:true,data}` 或 `{ok:false,error:{code,message,details?}}`。CLI --json 的 stdout 仅输出封套，日志写 stderr。

| CLI | 平台业务操作 |
| --- | --- |
| status | get_status |
| profile show/list/set/use | 客户端配置，不修改学习记录 |
| platform start/doctor | 本地启动 / 当前端点诊断 |
| pack install/list/show/validate | 平台包安装、查询与校验；GitHub 获取在平台执行 |
| material search | search_materials |
| goal create/list/show/update | create_goal/list_goals/get_goal/update_goal |
| progress / review due | get_progress/get_due_reviews |
| plan next | plan_next_session |
| lesson create/publish/show | create_lesson/publish_lesson/get_lesson |
| attempt start/draft/submit/pending/show | 作答状态操作 |
| review submit | submit_review |
| export / import | export_data/validate_import/import_data |

## 部署与平台生命周期

本机平台使用 SQLite 与本地实例目录；Workers 通过 D1 binding，Vercel 使用外部 libSQL。平台部署差异封装在服务端，CLI 只换端点与凭证。Vercel 临时文件系统不保存正式学习数据库。

安装器与自动升级尚未交付。平台与发布系统将负责版本元信息、升级检查、备份、数据迁移、失败恢复和回滚，CLI 提供操作入口。学习包升级、应用升级与用户数据迁移各有版本语义，均不能改写历史依据。具体阶段见路线图。
