# CLI 操作速查

先运行 --help；输入写 JSON 文件并用 --input，输出选择 --json。平台所有学习操作都经 HTTP，成功封套为 `{ok:true,data}`，失败含 error.code/message/details。完整 schema 以 src/contracts/index.ts 为准。

| 意图 | CLI |
| --- | --- |
| 连接 | status、platform doctor、profile show/list/set/use |
| 学习包 | pack list/show/install/validate |
| 目标 | goal list/create/show/update |
| 进度 | progress、review due |
| 续学 | plan next --goal GOAL_ID |
| 教材 | material search --query QUERY |
| 课程 | lesson create/publish/show |
| 作答 | attempt pending/show |
| 评价 | review submit |
| 迁移 | export、import --validate、import |

create_goal 输入：`{title,pack_id,pack_version?,daily_minutes?:15,exam_date?:"YYYY-MM-DD",level?:"unknown"}`。

create_lesson 输入：`{goal_id,title,objective,explanation,example,context_summary,topic_ids,question_ids?,generated_questions?,kind:"daily",blueprint_id?,minutes:15,idempotency_key}`。蓝图组卷不同时传手选题。publish/show 传 id；CLI 获取课程和作答时使用教师权限。

submit_review 输入：`{attempt_id,idempotency_key,expected_version:0,grades:[{question_id,score,feedback}],summary,next_steps}`。每题一份反馈，修订另传 revision_reason 与当前 review.version。

profile set --name NAME --input FILE 保存 `{endpoint,token_env?,connection_file?}`；token_env 是变量名，connection_file 是匹配端点的本地实例连接文件引用。profile use NAME 改默认实例，--profile NAME / --endpoint URL 只覆盖一次。业务 payload 和学习交接中不放凭证。
