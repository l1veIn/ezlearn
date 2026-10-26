# 平台 HTTP 集成契约（内部）

产品边界见决策 0001。下列是保留的学习核心契约，CLI 和 Web 均从 HTTP 进入；平台是唯一业务与存储拥有者。本地启动与 profile 是管理能力，不构成数据库直连学习路径。MCP 不属于当前接口。

业务统一入口 `LearningService.execute(operation, input)`，位于 `src/core/service.ts`。
构造 `new LearningService(store, { baseUrl, backendId? })`。`store` 实现 `src/storage/types.ts` 的 SnapshotStore。
所有传输层捕获 `AppError`，使用 `{ok:true,data}` / `{ok:false,error:{code,message,details?}}`。
HTTP `POST /api/rpc/:operation` 接收 input 对象；`GET /api/dashboard` 等价 dashboard。
公开学习读取不泄露答案：`get_lesson {id, teacher?:boolean}` 默认 false；HTTP 边界根据真实教师凭证确定权限，不能信任客户端自行传 teacher:true。

平台 GitHub 包入口为 `POST /api/packs/github`，输入 `{repository,ref,validate_only?}`，平台获取并校验后安装或仅校验。Web 上传纯数据包与 CLI 上传共用平台校验。`GET /health` 标识产品及 API 版本；状态与业务读写需完成相应认证。

## 操作与数据

- get_status {} → {version, backend_id, base_url, revision, limits}
- dashboard {} → {goals,packs,lessons,attempts,progress,due_reviews,backend_id,base_url}
- install_pack {pack,source?:{kind,url?,ref?,resolved?}} → 安装版本
- list_packs {} → PackVersion[]；get_pack {id,version?} → PackVersion
- validate_pack {pack} → {valid:true,id,version}
- search_materials {query,pack_id?,limit?} → {material_id,pack_id,version,title,heading,line,snippet,source}[]
- create_goal {title,pack_id,pack_version?,daily_minutes?,exam_date?,level?} → Goal
- list_goals {} → Goal[]；get_goal {id} → Goal；update_goal {id,title?,daily_minutes?,exam_date?,active?} → Goal
- get_progress {goal_id?} → Progress[]；get_due_reviews {goal_id?} → Progress[]
- plan_next_session {goal_id} → {action:'resume'|'review_attempt'|'study',lesson?,attempt?,topic?,reason}
- create_lesson {goal_id,title,objective,explanation,example,context_summary?,topic_ids:string[],question_ids?:string[],generated_questions?:Question[],kind?:'daily'|'diagnostic'|'checkpoint'|'mock',blueprint_id?,minutes?,idempotency_key} → Lesson（草稿）
- publish_lesson {id} → Lesson + url；get_lesson {id,teacher?} → Lesson + url（非教师去除答案/rubric/解析）
- start_attempt {lesson_id,idempotency_key} → Attempt（同课程已有进行中则返回它）
- save_draft {id,expected_version,answers:Record<string,string>} → Attempt
- submit_attempt {id,expected_version,answers:Record<string,string>} → Attempt + handoff_prompt（完全相同重复提交返回原结果）
- list_pending_attempts {goal_id?} → Attempt[]
- get_attempt {id,teacher?} → {attempt,lesson,review?,handoff_prompt}（默认非教师）
- submit_review {attempt_id,idempotency_key,expected_version,grades:{question_id,score,feedback}[],summary,next_steps,revision_reason?} → Review（首次 expected_version=0，修改填当前 review.version 和理由；客观分始终由平台算）
- export_data {} → {format:'ezlearn-export',version:1,exported_at,source_revision,checksum,data:State}
- validate_import {bundle} → {valid:true,counts,...}
- import_data {bundle} → {imported:true,counts,...}（仅空目标）

实体 ID 为字符串，日期 ISO UTC。Lesson 含 id,goal_id,pack_id,pack_version,title,objective,explanation,example,topic_ids,kind,minutes,status,questions,materials,context_summary,created_at,published_at?。Question 见 src/contracts/index.ts。Attempt 含 id,lesson_id,goal_id,status,version,answers,created_at,submitted_at?。Review 含 id,attempt_id,version,grades,total,max_score,summary,next_steps,created_at,revisions。Progress 含 goal_id,topic_id,exposures,attempts,correct,earned,possible,last_practiced_at?,due_at?,mastery:'unknown'|'learning'|'practicing'|'demonstrated'。

## 存储

明确采用单用户有界聚合快照，以 SQLite/D1/libSQL 单条 CAS UPDATE 原子提交整个状态。上限 1,500,000 UTF-8 字节，超限报 CAPACITY_EXCEEDED，不假装通用跨运行时事务。教学文本和材料包含于不可变 pack/lesson 快照，无二进制资产。CAS 冲突重读重算，用户 expected_version 过期报 VERSION_CONFLICT。

包结构：`{manifest:{schema_version:1,id,version,name,language,description,goals:string[],license,source,teaching:{minutes,advice}},topics:[{id,title,prerequisites:string[]}],materials:[{id,title,path,content,source}],questions:Question[],blueprints:[{id,name,kind,sections:[{type,count,points,topic_ids:string[]}]}]}`。Question `{id,type:'single_choice'|'short_answer',prompt,options?:{id,text}[],answer:string,explanation,points,difficulty:1|2|3,topic_ids:string[],material_refs:{material_id,heading?}[],rubric?:{criterion,points}[],source_type?:'pack'|'agent'}`。
