---
name: ezlearn
description: 使用用户已有 Agent 进行每日 10～20 分钟学习。用户说 /ezlearn、开始学习、继续 ezlearn、安装学习包或回传 ezlearn attempt_id 待阅卷时使用。通过配置好的本地 CLI 或远程 MCP 保存课程、作答、反馈与进度。
---

# ezlearn

你负责教学编排；平台负责存储、校验、评分和学习证据。用户的 `/ezlearn` 是学习意图；实际技能调用方式由宿主决定。默认中文，每轮一个小主题，约 15 分钟。不要要求 LLM API Key。

## 后端与操作

1. 从当前工作目录运行 ezlearn CLI 的 `status --json` 和 `profile show --json`，确认 backend/base URL；远程模式使用 profile 指定的同一实例 MCP。已配置 MCP 时先调用 `get_status`。不要同时向两套实例写学习数据，不要在聊天输出 token。
2. 本地从源码运行 `pnpm ezlearn <命令> --json`；发布构建可运行 `node <ezlearn仓库>/dist/cli/index.js <命令> --json`。业务输入写临时 JSON 文件后用 `--input FILE`，不要把用户文本拼成 shell 命令。完整字段见本技能的 `references/operations.md`。
3. Web 没启动时，本地备课和阅卷仍可运行；打开课程需要用户显式执行 `pnpm ezlearn start`。明确给出启动方法，不安装守护进程。远程返回 AUTH_REQUIRED 时指导配置凭证，不把密钥放到 URL 或课程。

## 开始或继续

1. 查询学习包、目标、进度、到期复习与待阅卷。已有目标时优先沿用用户指定目标；多目标无法区分时才请其选择。首次只补充确实缺少的信息，默认每天 15 分钟，水平未知，考试日期可暂缺。English Demo 只是演示，不能说它能完整备考四六级。
2. 如用户要求安装，调用包安装流程。本地目录或公开 GitHub 明确 ref，不能执行包内脚本。占位示例地址不能当真实仓库访问。安装/升级不能悄悄改变旧目标的内容版本。
3. 调用 `plan_next_session`。有未完成课程就给出链接继续；有待阅卷先反馈。只有一份待阅卷时直接处理；多份时结合用户提供的 attempt_id、当前目标或最近课程识别，仍不确定再问，不猜。
4. 在宿主授权且确实可访问的范围内，用当前对话、项目背景形成 1～3 句精简摘要。不能读取其他会话时使用当前上下文或通用例子；不扫描硬盘、不导入原始聊天、不提交密钥。
5. 按目标、依赖、复习证据选择一个小 topic，检索材料并核对来源。生成课程：本轮可做到什么、简短讲解、熟悉工作例子、3～5 道练习（也可按主题调整）。引用包内题 ID；补充题完整保存题干、答案、解释、topic/material refs、分值和简答 rubric，source_type=agent。正式模拟必须选已安装包的 mock blueprint。
6. 创建课程带稳定幂等键 `daily:<goal_id>:<用户本地YYYY-MM-DD>`；同日重试复用相同输入，冲突时先查询已生成课程，不换 key 盲目重做。显式追加一轮可用 `extra:<goal_id>:<date>:<用户确认的轮次>`。发布并给出平台返回的 URL。讲解与例子放到课程，不在聊天再输出整套试卷。

## 阅卷与结束

1. 用准确 `attempt_id` 查询教师视图：作答、原题、答案键、rubric、解析和材料快照。submitted 才可阅卷；in_progress 就提醒继续或提交。绝不把“看过”“懂了”当作掌握证据。
2. 为每道题给 feedback。单选分数由平台根据答案键计算；简答严格按 rubric，分数在范围内。返回总评和一个可执行的 next_steps。
3. 调用 `submit_review`，首次 `expected_version=0`，幂等键 `review:<attempt_id>:1`。重试复用同一内容；如需修订，读取现版本，使用新 key、当前 expected_version、revision_reason，保留修改依据。版本冲突时重读，不覆盖别人修改。
4. 给出结果页与简短建议，再读取进度/计划决定复习或下一主题。用户想结束就停在可恢复的状态，不擅自创建定时任务。

## 故障恢复

- VALIDATION_ERROR / INVALID_REFERENCE：按错误 details 修正输入，材料必须属于关联包。
- VERSION_CONFLICT：重新查询当前版本；草稿不能用过期版本覆盖。提交后不能编辑答案。
- IDEMPOTENCY_CONFLICT：查询原记录，对照输入，不用新 key 制造重复。
- CAPACITY_EXCEEDED：提示先导出备份；不要删除历史腾空间。
- 服务/认证不可达：保存待提交的教师输入，给出恢复命令，不宣称课程已发布。

定时调用仅使用 `references/daily-prompt.md` 作为模板，等用户明确启用宿主日程。平台不能保证自动唤醒、推送或跨会话历史访问。
