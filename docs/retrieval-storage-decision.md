# VideoParse 的检索与存储选型

2026-11-26 核对，已提交平台代码基线为 `649dbc8`。**当前建议是保留 MySQL、Qdrant 和已有视频归档使用的 Neo4j，暂缓引入 Elasticsearch 或额外的文档数据库。** 对全新、低预算实例，Neo4j 可作为独立的部署取舍。

## 三个用户动作，各自用了什么

- **在笔记中提问。** MySQL 保存 Markdown 原文、分片、标题层级、原文行号和归属。文档按标题与行切分，每片上限为 600 个 UTF-16 单元。MySQL 用中文 ngram 全文索引查字词，Qdrant 在当前用户已就绪的文档范围内查相似向量。每路最多取 24 个候选，Java 用 RRF 合并后返回前 5 个。向量候选还要回 MySQL 按用户和文档范围取原文。同一用户的重复问题可以复用问题向量，每次仍重新检索有权访问的资料。[分片实现](../platform/src/main/java/org/videoparse/MarkdownSections.java) · [RRF 与归属校验](../platform/src/main/java/org/videoparse/DocumentSearch.java) · [问题向量缓存](../platform/src/main/java/org/videoparse/VectorIndex.java)
- **从视频答案跳回证据。** Neo4j 用“视频 → 某次解析 → 证据”保留发布快照，MySQL 记录当前发布版本。单视频检索按版本取证据，Java 计算 BM25，再与 Qdrant 排名融合，截取前 6 条。当前排序没有使用概念之间的路径或图分数。相同证据、顺序和排序器下，仅更换保存证据的位置，没有提高召回质量的机制。[图结构](../platform/src/main/java/org/videoparse/AnalysisGraph.java) · [快照读取](../platform/src/main/java/org/videoparse/AnalysisResults.java) · [视频检索](../platform/src/main/java/org/videoparse/EvidenceController.java)
- **根据笔记模拟面试。** 服务按用户、选定文档和练习记录选片段，出题时保存题目与原文采分点，作答时要求每个命中点引用用户的回答。这条路径直接读写 MySQL。若原文已经选对而评分仍然有误，应检查采分点、同义表述和判分模型。B 站热评分析同样有直接提供的评论样本。[面试选题](../platform/src/main/java/org/videoparse/DocumentInterviewController.java) · [判分校验](../后端/app/services/document_interview.py) · [评论分析](../后端/app/bilibili_worker.py)

## 何时值得增加组件

**图数据库。** 现有实例应保留 Neo4j。有 `vp_graph_head` 的视频依赖对应图快照，直接关掉图库会让结果读取返回 503。全新且没有已发布图版本的实例可以走持久工作卷，需同时保留结果和证据目录。若要迁出现有图库，应先导出对应快照，逐项核对结果、原文、时间戳和出处，再切换读取路径。若产品要回答“我在哪些课程学过快排，它依赖哪些概念，哪些题暴露了这些前置知识的缺口”，可以试做带出处的概念、先修和错题关系。优先比较这些关系能否补齐证据，再决定是否扩大图建模；关系抽取、消歧与更新都要计入成本。[发布流程](../platform/src/main/java/org/videoparse/JobService.java) · [Neo4j 路径查询](https://neo4j.com/docs/cypher-manual/current/patterns/variable-length-paths/) · [Microsoft GraphRAG 索引流程](https://microsoft.github.io/graphrag/index/overview/)

**文本存储。** 如果“文本数据库”指保存原文，现有 MySQL 的 `MEDIUMTEXT`、分片表和事务已经覆盖需求，文件夹、用户和删除操作也在同一归属模型内。如果指关键词搜索，现有 `FULLTEXT ... WITH PARSER ngram` 支持中文。若指 MongoDB 一类文档库，当前读写路径没有必须为它维护另一份原文的需求。[Markdown 表和索引](../platform/src/main/resources/db/migration/V8__markdown_library.sql) · [MySQL 8.4 ngram 文档](https://docs.oracle.com/cd/E17952_01/mysql-8.4-en/fulltext-search-ngram.html)

**Elasticsearch。** 如果中文术语、别名、错误拼写的漏召回反复出现，或全库筛选与聚合影响主库负载，值得用 ES 做旁路对照。先用它替换关键词候选，沿用同一套向量候选与 RRF，才能判断中文分析器及字段权重带来的增益。工作区还出现了将归档视频证据写成 MySQL 全文索引的开发中实现，未将它计入上述已提交基线。新增集群还需承担索引写入、删除同步、重建、备份、内存和磁盘成本。所有候选查询继续带用户过滤，返回原文时复核归属。[Elastic SmartCN](https://www.elastic.co/docs/reference/elasticsearch/plugins/analysis-smartcn) · [Elastic RRF](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion) · [Qdrant 多租户过滤](https://qdrant.tech/documentation/manage-data/multitenancy/)

## 现有证据与下一次对照

仓库已有记录中，两篇笔记的 5 道题，全文检索首位命中 4 道，加入本地 BGE 与 Qdrant 后为 5 道。一个短视频的 7 道改写题，Java BM25 首位命中 4 道，混合检索命中 5 道。这里的 Hit@1 只表示首条证据是否命中标注。已有记录没有 ES 对照、多跳图对照或生产 p95，本次调研未测生产负载。[已有评测记录](platform-migration.md) · [Markdown 评测口径](../platform/checks/markdown_rag.py)

1. 固定同一批获准使用的资料、切片和权限，为术语精确匹配、换说法、跨资料多跳、无答案四类问题分别标出可接受的文档行或视频时间段。
2. 对照当前全文加向量、ES 关键词加同一向量、当前方案加带来源的图邻居扩展。固定候选预算、最终 top-k 和生成模型。先测检索即可，不必为每次实验调用大模型。
3. 按类别看 Hit@1、Recall@5、多跳题是否找齐全部必要证据，以及无答案题的错误引用。分开报告冷、热查询的 p95，记录索引构建与增量更新成本、删除可见延迟。另用两个用户的同名笔记、同题不同答案检查跨用户命中必须为零。
4. 扩展组件的依据是它持续解决了哪类真实问题、代价是否可接受。单次小样本命中提高一题，无法估计生产收益或给出统一的数据量门槛。
