# ezlearn 开发约定

- 默认使用中文界面与文档。保持每轮 10～20 分钟、一个小知识点的学习流程。
- 项目动机与设计原则见 `docs/attention-theory.md` 的“剩余注意力理论”：以用户已经投入的注意力与上下文为起点，减少额外切换和学习组织负担；目标和证据决定学什么，情境帮助决定怎样教。
- 平台独立运行并拥有学习数据与学习包。CLI 学习命令统一调用平台 HTTP API；实例启动/配置/诊断属于 CLI 管理职责。评分、版本校验和进度更新在平台 `LearningService` 内执行。
- 当前产品边界见 `docs/decisions/0001-platform-first.md`；MCP 不属于默认接入路径。Skill 只提供 CLI 操作说明和教学流程。
- 发布内容与历史成绩不可随学习包升级改变；修订评价必须保留依据。
- 存储使用 SQLite / D1 / libSQL 单条 CAS 原子更新，容量边界必须显式报错，不能用进程内状态替代正式记录。
- 不提交密钥、数据库、真实学习备份、原始对话和构建产物。不自行部署、发布包或启用提醒。
- 修改后按影响运行 `pnpm typecheck`、`pnpm test`、`pnpm build`；运行时入口变化还需相应云构建。

<!-- CODEGRAPH_START -->
## CodeGraph

若根目录存在 `.codegraph/`，理解或定位代码前先使用 `codegraph_explore` MCP 或 `codegraph explore "问题或符号"`。没有索引则跳过，不自行创建索引。常规文本搜索优先用 `rg`。
<!-- CODEGRAPH_END -->
