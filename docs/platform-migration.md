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

浏览器打开 [本机工作台](http://localhost:8088)。本地演示无需域名。默认只监听回环地址；从远程浏览器上传需用 HTTPS，分片校验依赖浏览器 Web Crypto。上传口令和匿名学习标识适用于共享工作台，多用户私有媒体需要账户和访问隔离。

首次构建会拉取基础镜像、Python 和 Maven 依赖，并从固定的上游提交编译 MinIO。停止平台用同样参数执行 `down`。MySQL、MinIO、Qdrant、媒体工作区和模型缓存使用独立持久卷。原本地模式仍可在 `后端/` 用 `python -m app.main` 启动 Flask，在 `前端/workspace/` 用 `pnpm dev` 启动工作台。

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
4. 任务事件存入 MySQL。浏览器通过 SSE 接收进度、按 `Last-Event-ID` 续读。“最近解析”按视频保存本浏览器最近 15 项，重开会回放进度并打开该视频当前结果。
5. 单视频问答检索语音、无声视频的画面笔记和带时间的 OCR，按视频与内容版本过滤 Qdrant，再用 RRF 合并向量与 BM25 排名。证据面板核对逐字引文，用原片段的时间跳转。对话里的画面引用须命中对应画面证据。真实视频还可出题、判分、生成复习计划和修订教案。

## 迁移已有学习数据

先停止旧环境的写入，备份 SQLite 和媒体目录。目标 MySQL 应已运行 Flyway 并且学习表为空。设置指向目标库的 `DATABASE_URL` 后，从 `后端/` 运行下列命令。

```bash
python -m app.migrate_learning /只读快照/videoparse.db
```

工具只读打开 SQLite，保留课程、视频、题目和作答等记录的原 ID，在同一事务内导入。需另行把原 `uploads/`、`frames/`、`audio/` 和 `outputs/` 复制到平台工作卷对应目录。代码回退可继续使用原快照，切换后新增的记录需要单独迁回。

## 验证与边界

- **任务和界面。** 独立环境使用真实 MySQL、Redis、MinIO、RocketMQ 和 Qdrant。8 个并发提交只创建一个活动任务。解析一段 8 秒无声 MP4 期间强制结束 JVM，重启后同一任务复用了阶段检查点。浏览器验证上传、进度、证据检索、答题判分、打开复习和讲授，以及刷新重开；示例八个标签与 PDF/PNG 导出菜单均可访问。在生产构建中，浏览器已逐张验证示例封面、讲义插图及 PPT 的缩略图和放大图。FFmpeg 和存储使用真实实现，讲义与问答使用本地模型替身。
- **字幕检索。** 同一视频的 5 道字面题，Java BM25 和平台混合检索的 Hit@1 均为 5/5。另 7 道换说法题，Java BM25 的 Hit@1、Hit@3 为 4/7、5/7；接入真实本地 BGE 和 Qdrant 后为 5/7、6/7。原 Python 混合检索为 6/7、6/7。题集只覆盖一个短视频，不能据此推断长视频 OCR 或最终答案的准确率。
- **复测入口。** 对已结束任务运行 `python3 platform/checks/replay.py http://localhost:8088/api 任务ID`，可核查事件流 MIME 类型、递增事件 ID 和续读。在独立测试工作区将 `后端/app/tests/eval/golden.json` 放到 `outputs/eval-video_work/transcript.json`，从 `后端/` 运行 `python -m app.tests.eval.retrieval_eval --platform-api http://localhost:8088/api`，可测 Spring 实际检索结果。
- **部署边界。** 已检查 Compose 八个服务配置，正常打包 Java 和前端。整套容器构建在拉取 Docker Hub 基础镜像时网络超时，尚未验证全容器冷启动。商业模型效果、生产并发和最低服务器内存也未实测。
