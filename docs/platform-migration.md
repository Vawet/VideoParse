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

## 问答来源

问答根据提问选源。询问讲者、字幕、幻灯片和时间点时使用视频证据。询问官方文档、新进展、延伸阅读或明确要求联网时，用当前问题提取搜索词。搜索请求只发给公共搜索服务，历史对话和媒体内容留在原处理流程。网页回答附原站链接和搜索摘要。有文本模型时可从摘要生成带编号的结论，服务端核对其逐字引文。默认使用 DuckDuckGo 公共 HTML 搜索，可能受限流影响。配置 `BRAVE_SEARCH_API_KEY` 可改用 Brave Search API，费用按供应商套餐计算。

## 学习资料库

工作台左侧「资料库」按列表显示「视频」和「文档」两个文件夹。文件夹和资料归属存储在 MySQL，列表通过当前访客的 Cookie 读取。上传的 Markdown 自动进入文档文件夹；视频在成功任务写入终态时归档，同一视频重跑保留一条。打开视频会读取已发布的 Neo4j 或工作卷解析结果，并加载当前访客可访问的原片。

点击列表中的文档可直接阅读，点击视频可打开解析结果。窄屏使用左上角的资料库按钮展开列表；搜索框按文件名筛选。

V10 升级会补登已有成功任务的视频，以及平台任务出现前已标记为 analyzed 的视频。失败或进行中的首次解析不会归档。旧资源缺少 owner_id 时，需先确认归属；浏览器清除 Cookie 后会进入新的工作区。

本机桌面平台还能按所选视频迁入旧工作区。在「视频 → 迁入本机旧版视频」选择旧版 `后端/app/outputs/*_result.json`，从项目根目录运行页面生成的命令。工具从旧 SQLite 读取标题、时长和字幕（只有完整解析文件的记录会用导图标题），复制原片、已有帧和工作区 JSON，迁入字幕，按当前访客创建视频并通过现有图发布队列写入 Neo4j。迁移需要正在运行的本机 MySQL、图发布 worker 和 Neo4j。同一访客重复运行会复用任务或已发布结果。其他部署可在后端环境设置 `DATABASE_URL` 和 `DATA_ROOT`，运行 `python -m app.import_archived_video --source 旧工作目录 --workspace 目标访客编号 -- 视频编号`。

### Markdown 文档

从左侧进入「资料问答与复习」（平台路径 `/library`），可多选上传 UTF-8 编码的 `.md` 或 `.markdown`，每份最大 512 KiB。重传相同内容会复用当前访客的文档。同一浏览器通过访客 Cookie 找回资料，清除 Cookie 或换浏览器会进入不同的工作区。

MySQL 保存规范化换行后的原文、标题路径、起止行和中文 ngram 全文索引。后台按批次将文段嵌入写入 Qdrant，逐批保存进度。向量暂不可用时仍可按原文字词查找，连续失败五次后可在页面重试。更换嵌入模型会触发重建。使用远程嵌入时，供应商会收到索引所需的文段和检索所需的问题。

多个索引实例应配置相同的嵌入模型。V11 迁移后，每个实例用短事务领取一份文档，跳过其他事务锁定的行，提交租约后再计算向量。实例中断后，其他实例可在三分钟租约到期后从已确认的分段继续。切换模型时，后台逐份从第一段重建。在启用索引的独立测试库上，可设置 `MARKDOWN_EVAL_DATABASE_URL` 并运行 `后端/.venv/bin/python platform/checks/document_index_queue.py http://localhost:8088/api` 检查锁定队首时后续文档能否完成。

在「检索范围」选择单篇或全部文档，输入问题即可。系统以 RRF 合并全文和向量检索结果，在当前访客范围内读取原文。点击答案下方的出处可定位并高亮对应行。生成的每条结论附带逐字引文。点击引文可查看原文并高亮对应行；同一段内有多处完全相同的引文时定位到第一处。单篇笔记的引文地址可直接收藏，刷新后恢复对应页与高亮。全库问答或复习时，在原文上方点击「新标签页打开引文」可保留当前答题位置。链接使用当前访客的文档权限。完整的检索段落仍可查看或加入复习。文档检索完成后，生成服务繁忙、离线或缺少有效引文时，页面直接显示命中的原文和行号。默认自动选源，请求延伸阅读或官方文档时可走联网搜索。提问时写“只根据我的笔记”会优先使用自己的材料。勾选「仅用我的文档回答，关闭网页搜索」后，即使问题包含“联网搜索”，服务端也会跳过公共搜索，继续从选定范围找依据。API 调用可在 `POST /v2/documents/ask` 的 JSON 内设置 `documentsOnly: true`；嵌入与答案生成仍使用部署配置的模型。视频问答仍在视频工作台中，引用可跳到原片时间点。

在独立实例使用 `后端/.venv/bin/python platform/checks/markdown_rag.py http://localhost:8088/api` 复测。脚本创建两个访客、三份文档，校验引用行、单篇范围和访客隔离。测试服务使用本地嵌入并关闭生成模型即可。在 worker 无法启动的独立实例加 `--worker-offline`，可验证仅用文档提问时的原文回退。若将 `MARKDOWN_EVAL_DATABASE_URL` 配为该测试实例的 SQLAlchemy MySQL 连接串，可同时测纯全文基线。两篇自有笔记上的 5 道小样本题中，全文检索 Hit@1 和 Hit@3 均为 4/5，加入本地 BGE 和 Qdrant 后两项均为 5/5。

### 从文档引用开始复习

在资料问答的引用下点击「加入复习」。卡片记录当时的问题，答案和行号指向原文段落。同一段重复保存会保留原问题和复习日期。从侧栏打开某篇笔记，「本篇复习」显示这篇笔记的待复习数、总数和最早到期的卡片。进入「资料问答与复习」可按到期时间复习全部笔记。先回忆、再点「显示答案」，也可以点击行号核对原文。「还没记住」安排在 10 分钟后，「记住了」按连续记住次数分别安排在 1、3、7、14、30 天后。所有时间由服务器记录，跨标签页重复提交反馈只会生效一次。卡片按访客隔离，保存与复习均无需调用模型。

在独立实例运行 `后端/.venv/bin/python platform/checks/document_review.py http://localhost:8088/api` 可验证保存、并发反馈、复习时间、原文定位、单篇与全库计数和访客隔离。脚本会创建测试访客和两份 Markdown。

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

进度连接建立时，Spring 在同一次 MySQL 查询中校验访客归属并读取任务状态和最新事件 ID。连接追上最新事件后，每个实例每隔约 400 毫秒合并查询仍有订阅的活动任务，每批最多 128 个任务。最近一页事件按任务共享，每个连接独立保存游标，落后的连接按索引补读。最后一个连接退出时释放该任务的内存页。跨实例重连续读使用同一个数据库游标。查询 `GET /tasks/{id}` 时，任务状态与事件总数在同一条带归属检查的 SQL 中读取，返回同一个已提交快照。

在独立且关闭图发布的测试实例上，设置 `FANOUT_TEST_DATABASE_URL` 为该实例的 SQLAlchemy MySQL 连接串，运行 `后端/.venv/bin/python platform/checks/event_fanout.py http://localhost:8088/api`。默认用 64 个连接订阅同一任务，追加 `--tasks 64` 可验证两个访客的 64 个任务，`--tasks 129` 可验证跨批次订阅。检查包含空闲数据库读取、跨页事件、终态、续读和访客隔离。数据库查询计数覆盖整个实例，各场景应单独运行。

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
