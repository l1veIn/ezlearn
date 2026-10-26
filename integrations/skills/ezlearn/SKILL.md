---
name: ezlearn
description: 使用 ezlearn 平台进行每日短时学习。用户说 /ezlearn、开始或继续 ezlearn、安装学习包，或回传 ezlearn attempt_id 请求阅卷时使用；不用于 ezlearn 项目开发或架构讨论。
---

# ezlearn

平台保存内容、答案和证据；你负责教学。默认中文，每轮一个小知识点、10～20 分钟。使用已有 Agent 能力，不要求模型 API Key。CLI 的 --help 和契约是参数来源，本技能只说明顺序与教学要求。

## 连接

1. 确认可用 CLI：源码运行 `pnpm ezlearn`，或 `node <ezlearn仓库>/dist/cli/index.js`。跨项目固定 --config-dir / profile。先查 `profile show --json`、`status --json`，需要时 `platform doctor --json`。
2. 所有学习命令都通过 HTTP。本机未启动时给出 `pnpm platform:start` 或 `pnpm ezlearn start`；不直接改数据库、不自动切换到另一个实例。端点切换不搬数据。
3. 本地凭证由匹配实例连接文件读取，远端通过 token_env 引用环境。不要输出 token。业务输入写 JSON 文件后用 --input，不拼接用户文字到 shell。完整操作速查见 references/operations.md。

## 开始与备课

1. 查包、目标、pending、progress 和 plan next。优先未完成、待阅卷、到期复习；只补问缺失信息，默认 15 分钟、水平 unknown，可跳过摸底。
2. 安装包时调用 CLI 或平台 Web 管理入口。GitHub 需明确 ref，由平台下载并校验；本地目录是上传源。不能执行包内脚本，不能把占位地址当真实仓库。English Demo 不代表完整考试课程。
3. 使用目标、知识依赖和作答证据选小 topic，检索材料。精简 context_summary 只含当前所需背景；不可见的其他会话用通用例子代替，不扫描历史或提交密钥。
4. 准备本轮目标、短讲解、工作情境例子和 3～5 道练习，可按主题调整。补充题完整保存答案、解释、topic/material refs 和简答 rubric，source_type=agent；正式模拟使用包内 blueprint。
5. lesson create 使用稳定 key `daily:<goal_id>:<用户本地YYYY-MM-DD>`，随后 publish，给平台返回的 URL。同日重试先查已有课程，复用 key 与输入。

## 阅卷与结束

1. 用户交接后用准确 attempt_id 查询 attempt show。只说“做完了”就查 pending；多份仍有歧义时让用户选，不猜。
2. submitted 才阅卷。读取原题、答案、rubric、材料快照和作答；每题给 feedback，简答按标准评分。平台确定客观分，阅读或用户说懂了不能当掌握证据。
3. review submit 首次 expected_version=0、key 为 `review:<attempt_id>:1`。提交总评与一个可执行 next_steps；重试复用内容。修订使用当前版本、新 key 和 revision_reason。
4. 给结果页，读进度和下一计划。用户结束就保持可恢复状态，不自行建立提醒。

VERSION_CONFLICT 时重读版本；IDEMPOTENCY_CONFLICT 时查询原记录；格式错误按 details 修正。平台不可达时保留教师输入，不宣称已发布。容量超限先导出备份，不删除历史腾空间。定时提示词只在用户明确启用宿主任务时使用 references/daily-prompt.md。
