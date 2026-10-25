# 业务输入速查

传输层的成功输出为 `{ok:true,data}`。CLI 的 group/verb 与 MCP 工具操作一一对应，完整 schema 以仓库 `src/contracts/index.ts` 为准。

| 意图 | CLI | MCP |
| --- | --- | --- |
| 后端 | `status` | `get_status {}` |
| 学习包 | `pack list/show/install/validate` | `list_packs/get_pack/install_pack/validate_pack` |
| 目标 | `goal list/create/show/update` | `list_goals/create_goal/get_goal/update_goal` |
| 进度 | `progress`、`review due` | `get_progress/get_due_reviews {goal_id?}` |
| 续学 | `plan next` | `plan_next_session {goal_id}` |
| 教材 | `material search` | `search_materials {query,pack_id?,limit?}` |
| 课程 | `lesson create/publish/show` | `create_lesson/publish_lesson/get_lesson` |
| 作答 | `attempt pending/show` | `list_pending_attempts {goal_id?}`、`get_attempt {id,teacher:true}` |
| 阅卷 | `review submit` | `submit_review` |

`create_goal`：`{title,pack_id,pack_version?,daily_minutes?:15,exam_date?:"YYYY-MM-DD",level?:"unknown"}`。

`create_lesson`：`{goal_id,title,objective,explanation,example,context_summary,topic_ids,question_ids?,generated_questions?,kind:"daily",blueprint_id?,minutes:15,idempotency_key}`。蓝图组卷不同时传手选题。`publish_lesson/get_lesson`：`{id}`，教师读取加 `teacher:true`。

`submit_review`：`{attempt_id,idempotency_key,expected_version:0,grades:[{question_id,score,feedback}],summary,next_steps}`。每道题恰好一份反馈。修订时另加 `revision_reason` 并使用当前 review.version。

公开 Web 的学习请求与教师请求权限不同。不要把教师 Bearer token 写进学习页面交接提示词。提示词只携带 backend 标识和 attempt_id。
