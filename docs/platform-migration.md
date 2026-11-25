# VideoParse 平台部署与迁移

平台使用 Java 21、Spring Boot 3.5、MyBatis-Plus 和 MySQL 8 管理视频、课程、解析任务和进度。Nginx 在同一地址提供学习工作台和 Spring API。原 React 工作台保留八个标签、示例和导出；Vue 3 用于新增的证据检索和真实视频学习面板。技术对照使用 [DOVideo-AI 的固定版本](https://github.com/Xiaoc7r/DOVideo-AI/tree/6f3848dfc821902a2c2c9943befa93264eaf2850)。

## 本机启动

需要 Docker、BuildKit 和 Docker Compose v2.22 或以上。以下命令从仓库根目录执行。

```bash
python3 infra/platform/configure.py
```

首次生成的 `infra/platform/.env` 包含数据库、缓存、对象存储、向量库凭据和上传口令。本地工作台如需直接上传，可将该文件中的一行设为 `UPLOAD_ANSWER=`。修改后重新启动平台使配置生效。按需在该文件加入模型配置。

```bash
docker compose --env-file infra/platform/.env -f infra/platform/compose.yaml up --build -d
```

浏览器打开 [本机工作台](http://localhost:8088)。本地演示无需域名。默认只监听回环地址；从远程浏览器上传需用 HTTPS，分片校验依赖浏览器 Web Crypto。平台按浏览器访客隔离私人视频和学习数据。

首次构建会拉取基础镜像、Python 和 Maven 依赖，并从固定的上游提交编译 MinIO。停止平台用同样参数执行 `down`。MySQL、MinIO、Neo4j、Qdrant、媒体工作区和模型缓存使用独立持久卷。原本地模式仍可在 `后端/` 用 `python -m app.main` 启动 Flask，在 `前端/workspace/` 用 `pnpm dev` 启动工作台。

## 匿名访客工作区

工作台通过同源的 `/api/v2/session` 建立匿名工作区。服务端签发有效期 365 天的随机 Cookie，设置 HttpOnly、SameSite=Strict 和 Secure，MySQL 保存凭据摘要。公开部署需使用 HTTPS。仅在独立的本地 HTTP 测试环境可设 `SESSION_COOKIE_SECURE=false`。同一浏览器配置中的标签页共用身份，隐私窗口、其他浏览器和设备各自独立。清除 Cookie 或到期后将进入新工作区。

上传会话、视频和课程在创建时绑定访客。任务进度、媒体、图快照、检索、测验和教案沿所属资源检查权限。个人作答和复习记录使用服务端访客身份。平台问答首次返回 `conversation_id`，后续请求带回该 ID，由后端载入同一访客、同一视频或课程的最近 16 条消息。清空聊天开启新对话。内置静态演示仍可直接打开。

V7 迁移保留旧数据，将缺少归属的资源设为私有待分配。管理员有独立归属证明时，可先备份，在同一 MySQL 事务中将对应的课程、视频、上传会话的 `owner_id` 设置为目标访客的 `workspace_id`，同时核对课程下所有视频。旧学习记录的 `client_id` 需另行确认后映射。原 Flask 开发入口仅用于本地，公开入口使用本平台的 Spring API。

在关闭上传口令的独立测试实例运行 `python3 platform/checks/ownership.py http://localhost:8088/api`，可用两个新访客回归上传和课程归属。该检查会在目标实例创建测试资源。

## 模型和费用

- **媒体和学习工具**使用原 Python 实现。Whisper、FFmpeg、CLIP 和 Tesseract 在本机运行。讲义、视觉分析和出题等使用 `DASHSCOPE_API_KEY` 或 `DEEPSEEK_API_KEY`，可用 `LLM_PROVIDER` 选提供方。
- **Java 问答和工具修复**使用 `PLATFORM_AI_KEY`、`PLATFORM_AI_URL` 和 `PLATFORM_AI_MODEL`。没有这组配置时仍可检索证据和运行规则编排。
- **向量检索**默认用缓存中的 `EMBED_MODEL`（默认 BAAI/bge-small-zh-v1.5）。可在启动后运行下列命令下载到模型卷；检索请求只读取缓存。配置 `EMBEDDING_API_KEY`、`EMBEDDING_BASE_URL` 和 `PLATFORM_EMBED_MODEL` 会改用远程嵌入。远程模式下建立索引和每次查询都会调用供应商。模型或 Qdrant 不可用时继续返回 BM25 结果。

```bash
docker compose --env-file infra/platform/.env -f infra/platform/compose.yaml exec platform \
  python -c 'import os; from huggingface_hub import snapshot_download; snapshot_download(os.environ["EMBED_MODEL"])'
```

## 从上传到学习

1. 浏览器按 5 MiB 分片并计算 SHA-256。设置了上传口令时，Redis 管一次性上传凭据。MySQL 记清单，MinIO 存分片和合并对象。中断后重选同一文件可续传；大小上限为 2 GiB。
2. Spring 在同一事务创建任务和待发送消息，RocketMQ 分发任务。MySQL 唯一键保证同一视频至多有一个活动任务，重复消息检查任务状态。消息服务短时不可用时，worker 从数据库补捞。
3. Java 根据是否有语音编排工具，通过私有 Python 进程执行媒体计算。关键帧、转写和分析产物落在共享工作卷。每轮执行最多选择两个不同的工具修复校验问题；模型通过 LangChain4j Tool Calling 提议动作，Java 控制参数并重新校验。重启时可复用同一任务已完成的步骤。中断发生在外部调用和写入检查点之间时，该调用可能重做。`PARSE_ENGINE=python` 可切回原解析循环。
4. 任务事件存入 MySQL。浏览器通过 SSE 接收进度、按 `Last-Event-ID` 续读。平台事件流长时间静默时，页面会查询任务状态，后端重启后也能显示完成结果。“最近解析”按视频保存本浏览器最近 15 项，重开会回放进度并打开该视频当前结果。
5. 单视频问答检索语音、无声视频的画面笔记和带时间的 OCR，按视频与内容版本过滤 Qdrant，再用 RRF 合并向量与 BM25 排名。证据面板核对逐字引文，用原片段的时间跳转。对话里的画面引用须命中对应画面证据。真实视频还可出题、判分、生成复习计划和修订教案。

## 解析结果与图存储

平台将成功的解析结果写入 Neo4j 5.26。一个视频可关联多次分析，每次分析保存完整结果，并关联按顺序编号的语音、画面笔记和 OCR 证据节点。节点保留原文、时间范围及来源帧。结果页和单视频证据检索通过已发布的任务编号读取同一份图快照。Qdrant 继续提供向量排名，视频文件和关键帧保存在原媒体存储。

升级已有 Compose 配置时先运行 `python3 infra/platform/configure.py --add-graph`，再启动平台。独立运行 Spring 时设置 `NEO4J_URL`（例如 `http://127.0.0.1:7474`）、`NEO4J_USER` 和 `NEO4J_PASSWORD`。图记录与证据在同一 Neo4j 事务内创建，MySQL 在完成任务的事务中切换当前版本。旧工作区仍可读取。备份应一并保留 MySQL、Neo4j 和媒体卷。

## 消息队列与图发布恢复

解析使用 RocketMQ 的 `VideoParseAnalysis` 主题和 `vp-analysis` 消费组。媒体产物保存后，Spring 在一个 MySQL 事务中把任务置为 `publishing` 并登记待发送的图发布消息。`VideoParseResults` 主题由 `vp-results` 消费组独立处理，消息体均为任务 ID。图库慢时，其他视频仍可解析。同一视频在发布期间提交会返回当前任务 ID。所有实例应共用工作卷、数据库及相同的图配置。

图库写入失败后，任务分别等待 2、4、8、16 秒再尝试，连续 5 次失败后进入 `error` 并保留磁盘产物。退避时间记录在 MySQL。消费者重启或消息重复时检查持久化阶段，图提交回执丢失时可重投。两阶段也会从 MySQL 扫描待办。`WORKER_POLL_MS` 控制解析补捞间隔，`PUBLISH_POLL_MS` 默认与其相同。SSE 的 `progress` 事件报告写图进度，发布成功后才发送 `end/done`。

已有结果或发布失败的视频可按视频 ID 从工作卷补发。平台须已配置 Neo4j、执行 V6 迁移，且 `DATA_ROOT/outputs/<视频ID>_result.json` 存在。在 Compose 环境从仓库根目录执行以下命令。

```bash
docker compose --env-file infra/platform/.env -f infra/platform/compose.yaml exec platform \
  python -m app.publish_results 视频ID
```

命令返回任务 ID，可用 `GET /api/tasks/<任务ID>` 查看进度。有活动任务时复用该任务。新建的补发任务仅读取已有结果及证据。早期工作区仅有结果 JSON 时保存没有证据节点的版本。升级前先暂停新提交，等活动任务结束再替换所有 worker。旧版 worker 无法识别发布阶段。回退时同样先排空任务，并保留 MySQL、Neo4j 和媒体卷备份。

## 迁移已有学习数据

先停止旧环境的写入，备份 SQLite 和媒体目录。目标 MySQL 应已运行 Flyway 并且学习表为空。设置指向目标库的 `DATABASE_URL` 后，从 `后端/` 运行下列命令。

```bash
python -m app.migrate_learning /只读快照/videoparse.db
```

工具只读打开 SQLite，保留课程、视频、题目和作答等记录的原 ID，在同一事务内导入。需另行把原 `uploads/`、`frames/`、`audio/` 和 `outputs/` 复制到平台工作卷对应目录。代码回退可继续使用原快照，切换后新增的记录需要单独迁回。

## 验证与边界

- **任务和界面。** 独立环境使用真实 MySQL、Redis、MinIO、RocketMQ 和 Qdrant。8 个并发提交只创建一个活动任务。解析一段 8 秒无声 MP4 期间强制结束 JVM，重启后同一任务复用了阶段检查点。浏览器验证上传、进度、证据检索、答题判分、打开复习和讲授，以及刷新重开；示例八个标签与 PDF/PNG 导出菜单均可访问。在生产构建中，浏览器已逐张验证示例封面、讲义插图及 PPT 的缩略图和放大图。FFmpeg 和存储使用真实实现，讲义与问答使用本地模型替身。
- **字幕检索。** 同一视频的 5 道字面题，Java BM25 和平台混合检索的 Hit@1 均为 5/5。另 7 道换说法题，Java BM25 的 Hit@1、Hit@3 为 4/7、5/7；接入真实本地 BGE 和 Qdrant 后为 5/7、6/7。原 Python 混合检索为 6/7、6/7。题集只覆盖一个短视频，不能据此推断长视频 OCR 或最终答案的准确率。
- **复测入口。** 对已结束任务运行 `python3 platform/checks/replay.py http://localhost:8088/api 任务ID`，配合 `--cookie-jar 私有测试Cookie文件` 可核查事件流 MIME 类型、递增事件 ID 和续读。在独立测试工作区将 `后端/app/tests/eval/golden.json` 放到测试访客已上传视频的 `outputs/<视频ID>_work/transcript.json`，从 `后端/` 运行 `python -m app.tests.eval.retrieval_eval --platform-api http://localhost:8088/api --video-id 视频ID --cookie-jar 私有测试Cookie文件`，可测 Spring 实际检索结果。
- **图发布。** 隔离工作区使用真实 RocketMQ、MySQL 和 Neo4j，媒体进程使用固定测试数据。在图库短时故障、提交后丢回执、重复消息和服务重启场景中，同一任务只执行一次媒体解析，图里保留一组证据。连续五次写入失败后成功从工作区补发。单独关闭 RocketMQ 消费后，MySQL 补捞也能完成发布。
- **部署边界。** 已用 Compose v2 验证含 Neo4j 的九个服务配置，正常打包 Java 和前端。整套容器构建在拉取 Docker Hub 基础镜像时网络超时，尚未验证全容器冷启动。商业模型效果、生产并发和最低服务器内存也未实测。
