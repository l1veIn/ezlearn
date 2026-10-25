# ezlearn 开发约定

- 默认使用中文界面与文档。保持每轮 10～20 分钟、一个小知识点的学习流程。
- CLI、HTTP 和 MCP 都调用 `LearningService`；评分、版本校验和进度更新不能在传输层另写一套。
- 发布内容与历史成绩不可随学习包升级改变；修订评价必须保留依据。
- 存储使用 SQLite / D1 / libSQL 单条 CAS 原子更新，容量边界必须显式报错，不能用进程内状态替代正式记录。
- 不提交密钥、数据库、真实学习备份、原始对话和构建产物。不自行部署、发布包或启用提醒。
- 修改后按影响运行 `pnpm typecheck`、`pnpm test`、`pnpm build`；运行时入口变化还需相应云构建。

<!-- CODEGRAPH_START -->
## CodeGraph

若根目录存在 `.codegraph/`，理解或定位代码前先使用 `codegraph_explore` MCP 或 `codegraph explore "问题或符号"`。没有索引则跳过，不自行创建索引。常规文本搜索优先用 `rg`。
<!-- CODEGRAPH_END -->
