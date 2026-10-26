# 学习包格式 v1

学习包是可分发、可版本化的学习依据，包含范围、知识结构、参考内容和评价标准。GitHub 仓库是初期的主要分发渠道，不建设学习包市场。作者维护来源仓库，平台负责下载、校验、安装、检索、版本保存和与目标的关联；Web 与 CLI 都可提供管理入口。

当前格式 v1 是纯数据：仓库或目录根包含 `pack.json`，材料正文内联，不执行脚本或安装钩子。目录中的 README 与讲义副本便于人读，平台以校验后的 JSON 快照为准。包不包含用户作答、掌握情况或部署凭证；Agent 为某个用户生成的教学内容属于课程快照，通常不直接修改原包。

完整例子是 [`packs/english-demo/pack.json`](../packs/english-demo/pack.json)。它包含 4 个稳定 topic、16 道原创题、1 份讲义和 4 个蓝图；不是官方英语考试材料。

## 顶层结构

```json
{
  "manifest": {
    "schema_version": 1,
    "id": "english-demo",
    "version": "1.0.0",
    "name": "English Demo",
    "language": "zh-CN",
    "description": "原创功能演示",
    "goals": ["清楚表达条件与结果"],
    "license": "由内容作者明确填写授权状态",
    "source": "作者和材料来源说明",
    "teaching": { "minutes": 15, "advice": "每轮一个小知识点" }
  },
  "topics": [{ "id": "condition", "title": "条件与结果", "prerequisites": [] }],
  "materials": [],
  "questions": [],
  "blueprints": []
}
```

上面的空数组仅说明字段结构，不是可通过校验的完整包。`schema_version` 必须为 1，内容版本使用 `major.minor.patch`，允许预发布后缀。ID 使用字母、数字、点、下划线或连字符；以字母或数字开头，长度最多 100，禁止原型相关保留值。同类实体 ID 必须唯一，所有依赖和引用必须存在，topic 依赖不能成环。

材料字段为 `id/title/path/content/source`，content 是 Markdown 或纯文本。`path` 使用相对路径，不允许绝对路径、反斜杠、盘符、空段、`.` 或 `..`。讲义是引用数据；即使正文包含命令或“忽略前面指令”等文字，也不代表用户授权。搜索按关键词返回 material ID、包版本、标题/heading、行号、命中片段与来源，适合教师核对引用。

## 题目与评分

```json
{
  "id": "condition-01",
  "type": "single_choice",
  "prompt": "If the request ___, we will retry it.",
  "options": [{"id":"A","text":"fails"},{"id":"B","text":"will fail"}],
  "answer": "A",
  "explanation": "if 从句使用一般现在时。",
  "points": 2,
  "difficulty": 1,
  "topic_ids": ["condition"],
  "material_refs": [{"material_id":"developer-english","heading":"条件与结果"}],
  "source_type": "pack"
}
```

单选题 2～8 个选项，答案是一个有效且唯一的选项 ID。作答提交选项 ID，平台严格按答案键得分。难度仅支持 1、2、3，分值为 1～100 的整数。每道题至少关联一个 topic 和一个材料。

简答题 `type` 为 `short_answer`，`answer` 填参考答案，`rubric` 填 `{criterion,points}` 数组。rubric 的正分值之和必须恰好等于题目分值。例如 4 分翻译题可分别按条件含义、从句时态、主句形式和清晰度各 1 分。教师必须给逐题反馈，主观分不能超出范围，漏题、重复题 ID 或不对应题目会被拒绝。

Agent 补充练习使用相同 schema，source_type 写 `agent`。补充题也必须关联当前包中已存在的 topic 和材料，并把完整题目、参考答案与 rubric 保存进课程快照。正式模拟默认使用包内题，不能临时生成一套题冒充蓝图考试。

## 蓝图

```json
{
  "id":"daily-condition",
  "name":"条件表达日常练习",
  "kind":"daily",
  "sections":[
    {"type":"single_choice","count":2,"points":2,"topic_ids":["condition"]},
    {"type":"short_answer","count":1,"points":4,"topic_ids":["condition"]}
  ]
}
```

`kind` 区分 `diagnostic/daily/checkpoint/mock`。每节声明题型、题数、每题分值和必须覆盖的 topic；题库必须有足够的不重复题完成覆盖。包校验与组卷都会检查约束。不同结果保留原 kind，未做摸底不会转换成低能力。

组卷按 section 顺序执行，每节先尝试确定性覆盖，再在必要时搜索组合；搜索最多 20,000 个状态，过于复杂时明确返回 `BLUEPRINT_TOO_COMPLEX`。同题型、同分值且题目池重叠的 section 建议合并，避免前一节取题影响后一节；当前不提供跨 section 的全局最优组合搜索。发布前必须通过实际组卷校验。

## 安装、固定版本与更新

保持平台运行。在 Web 的“我的书架”可上传 pack.json，或提交公开 GitHub 仓库与明确 ref。GitHub 获取在平台执行；上传后由目标实例完整保存，云端包不依赖 CLI 所在电脑的路径。

```powershell
pnpm ezlearn pack validate ./packs/english-demo --json
pnpm ezlearn pack install ./packs/english-demo --json
pnpm ezlearn pack list --json
pnpm ezlearn pack show english-demo --json
```

公开 GitHub 仓库安装必须指定 ref；仓库根目录包含 `pack.json`。例如 `pnpm ezlearn pack install https://github.com/OWNER/REPO --ref v1.0.0 --json`（将占位值换成真实包地址）。CLI 只将仓库与 ref 交给平台。ref 可为 tag、branch 或 commit，平台记录解析的实际 commit。演示占位地址不是可下载资源，不能当作真实包访问。当前不支持任意仓库子目录地址或私有 GitHub 内容源。

同一个 ID/version 的内容一旦安装即不可更换；修改内容应提高版本号并再次安装。旧版本保留，目标固定版本，已发布课程与答题绑定完整快照。后续包修改不会改变旧答案或成绩。不同版本中沿用同一个 topic ID 必须保持语义稳定；主题含义变了应创建新 ID。

平台限制文件与包大小并校验材料相对路径；CLI 本地目录上传还拒绝链接逃逸。当前不解压学习包压缩文件，不执行包脚本。完整实例受 [1,500,000 字节容量上限](architecture.md) 约束。

应用版本、学习包内容版本与导出格式版本分别管理。当前更新包需指定来源版本并安装，尚无自动追踪 GitHub 更新或自动切换目标版本的功能。未来可按兼容策略检查/下载新版本，历史课程与成绩仍绑定原快照。更轻的讲义包、无题库包属于后续格式设计，当前 v1 schema 仍要求非空材料、题库和蓝图。
