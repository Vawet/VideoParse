# Video_Parse

Spring 平台支持分片续传、任务断点恢复、字幕与 OCR 证据检索，以及真实视频的测验、复习与备课。新增的 Markdown 资料库支持笔记上传、跨文档混合检索、引用行定位和联网资料查询。原工作台的八个标签和导出入口继续可用。[平台启动、模型配置与实测结果](docs/platform-migration.md)

## 2025腾讯犀牛鸟开源人才培养计划—视频生成图文混排讲义工具

***

## 🚀 项目概述

### 这是一个基于大模型的视频解析及生成笔记的项目，支持导出图文混排的pdf讲义和思维导图。

***

## 📋 功能特性

### 📺 音视频处理模块（ffmpeg和调用大模型）
- **提取音频audio**: 使用ffmpeg提取视频的audio部分，
- **ASR**:使用whisper-v3-turbo大模型，获取每句话的开始时间和结束时间
- **图片向量化去重**: 使用CLIP_Large大模型,cosine_similarity 用于计算余弦相似度,设置similarity相似度进行去重，从而生成PPT
- **向量化**: 使用SiliconFlow API进行文本向量化，支持批量处理
- **大模型语义切割**: 基于qwen-vl-plus大模型对语义进行分段和摘要总结

### 🧠 解析制作模块（概览、笔记、思维导图）
- **概览生成**: 结合时间戳和分段生成
- **markdown笔记生成**: 生成markdown的图文混排笔记
- **思维导图**: node节点生成自定义样式的思维导图，可导出为canvas
- **pdf版本**:均能导出pdf版本

### 🤖 解析文件管理模块（文件的分类处理）
- **文件管理**: 可对解析卡片拖拽进行文件分类
- **解析内容存储**: 采用本地存储IndexedDB进行存储

***


## 🤖 Agent 架构（v2）

解析流程不再是写死的流水线：由一个基于千问 function calling 的 **Agent** 自行规划、调用工具、校验并修复结果。

```
后端/app/
├── main.py        # 仅路由
├── config.py      # 路径 / 模型名 / 懒加载客户端
├── tasks.py       # 后台任务 + SSE 事件流
├── agent/
│   ├── loop.py    # Agent 循环（解析 Agent、问答 Agent）
│   ├── tools.py   # 工具注册表（get_video_info / transcribe / extract_keyframes / validate_result ...）
│   ├── state.py   # 每个视频一个工作区，大数据落盘，只把摘要交给 LLM
│   └── prompts.py
└── services/      # ffmpeg / Whisper / 千问 的单步能力
```

| 接口 | 说明 |
|---|---|
| `POST /analyze/start` | 异步启动解析，返回 `task_id` |
| `GET /tasks/<id>/events` | SSE：实时推送 Agent 的思考、工具调用与结果 |
| `GET /result/<video_id>` | 读取解析结果（结构与旧版一致） |
| `POST /chat` | 视频问答：`{video_id, question, history}`，Agent 会检索字幕、按需截图看图 |
| `POST /analyze` | 兼容旧版：默认同步返回；带 `"async": true` 等价于 `/analyze/start` |

Agent 会根据视频类型自适应：PPT/板书类走「截帧 + CLIP 去重」，口播类只取少量均匀帧，无语音视频改为依赖画面；
结束前调用 `validate_result` 自检（摘要/脑图/时间戳/截图是否齐全），发现问题会自行重试修复，最多 `AGENT_MAX_STEPS`(默认 25) 步。

大模型供应商可配置（`后端/.env`）：

```env
# 方案一：阿里云千问（默认）
DASHSCOPE_API_KEY=sk-xxx

# 方案二：DeepSeek（一个 deepseek-flash 同时覆盖 Agent 决策、文本与看图）
DEEPSEEK_API_KEY=sk-xxx
LLM_PROVIDER=deepseek   # 只配了 DeepSeek key 时可省略；两个 key 都配时需显式指定
```

其他可选环境变量：`AGENT_MODEL`、`TEXT_MODEL`、`VISION_MODEL`、`LLM_BASE_URL`、`WHISPER_MODEL`、`PUBLIC_BASE_URL`、`AGENT_MAX_STEPS`、`CHAT_HISTORY_CHAR_BUDGET`。

检索：默认 `RETRIEVER=hybrid`，即 BM25 + 本地向量（`EMBED_MODEL`，默认 `BAAI/bge-small-zh-v1.5`，首次使用自动下载约 100MB）的 RRF 混合检索（设 `RETRIEVER=bm25` 可改回纯 BM25），模型不可用时自动降级为 BM25。对比评测：`cd 后端 && ./.venv/bin/python -m app.tests.eval.retrieval_eval`。

离线测试（不需要 key / ffmpeg / GPU）：

```bash
cd 后端 && python -m pytest app/tests/test_agent_offline.py -v
```

***

## 🛠️ 安装与配置

### 1. 克隆项目
```bash
git clone https://github.com/Vawet/VideoParse.git
前端启动：
npm start
```

### 2. 安装依赖
```bash
pip install -r requirements.txt
```

### 3. 配置环境变量
创建 `.env` 文件：
```env
DASHSCOPE_API_KEY=你的实际API密钥
```
***

## 📖 使用方法


### 运行测试
```bash
# 运行集成测试
python tests/test_video_analysis.py -v
#运行某个测试用例
puthon tests/test_video_analysis.py::test_video_info -v
```
***

## 📁 项目结构

```
VideoParse/
├── app/           # 后端核心源代码
│   ├── actions/   #文档处理模块
│   ├── audio/     # 音频文件
│   ├── frames/    # 视频帧文件
│   ├── outputs/      # 解析输出
│   ├── tests/        # 测试
│   └── uploads/      #上传的mp4文件
├── .env              # 环境变量
├── main.py           # 主程序
├── requirements.txt  # 依赖列表
└── README.md         # 项目说明


my-react-app/
├── dist      
├── node_modules
├── public
├── src
│   ├── components
│   │   ├── GMindMap.jsx   #思维导图
│   │   ├── GNotes.jsx     #ai笔记
│   │   ├── GPPT.jsx       #PPT
│   │   ├── Header.jsx     
│   │   ├── Left.jsx
│   │   ├── NewItemModel.jsx  #新建的表单组件
│   │   └── Video.jsx      #视频解析组件
│   ├── pages
│   │   ├── Home.jsx      #首页
│   │   └── Main.jsx      #主页
│   ├── store
│   │   └── store.js
│   ├── App.css
│   ├── App.js
│   ├── db.js
│   ├── index.css
│   ├── index.js
│   └── routes.js
├── .babelrc
├── package-lock.json
├── package.json
├── postcss.config.js
├── tailwind.config.js
├── webpack.config.js
└── yarn.lock
```

***



## 🎓 教育版功能（学习/备课）

所有结论都必须带证据 `(video_id, 时间戳, 字幕原话)`，并由代码（`app/evidence.py`）在字幕里核对；核对不过的题/要点会被丢弃，而不是交给用户。

| 功能 | 接口 | 说明 |
|---|---|---|
| 带时间戳的视频问答 | `POST /chat` `{video_id}` | 回答必须有有效时间戳，否则追问一次；无依据回答“视频中未提及”；返回 `citations` |
| 整门课问答 | `POST /chat` `{course_id}` | 跨视频 BM25 检索（jieba），引用格式 `[视频标题 mm:ss]` |
| 按需出题 / 判分 | `POST /quiz/generate`、`POST /quiz/<id>/answer` | 每题附已核对的字幕引用；出题时不返回答案，作答后才返回 |
| 纠错与核对 | `POST /verify` | 陈述 → supported / contradicted / not_found + 字幕原话 |
| 课程 | `GET/POST /courses`、`POST /courses/<id>/videos` | 把多个视频组织成一门课 |
| 薄弱点 / 复习计划 | `GET /review/weak`、`POST /review/plan`、`POST /review/done` | 每题只看最近一次作答；计划骨架由代码按考试日期/每日时长排程 |
| 教师备课 | `POST /teach/plan`、`POST /teach/plan/<id>/revise`、`GET /teach/plan/<id>` | 大纲每个要点带证据，环节分钟数之和严格等于课时；多版本；前端用 pptxgenjs 导出 |

公开部署使用 [Spring 平台](docs/platform-migration.md)。访客可观看内置示例，上传、问答和复习需要登录。平台从会话取得账号 ID，并按此 ID 校验资料归属。本机单用户 Flask 开发模式仍使用浏览器的 `client_id`。

### 新增环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DATABASE_URL` | `sqlite:///app/data/videoparse.db` | 生产可用 Postgres（`postgresql+psycopg2://...`）；表结构由 SQLAlchemy 自动创建 |
| `DATA_ROOT` | `后端/app/` | 运行产物（uploads/frames/audio/outputs/data）的根目录；容器部署时指向持久卷，如 `/data` |
| `ANALYZE_MODE` | `pipeline` | `pipeline`：确定性流水线，Agent 仅在出问题时修复；`agent`：完全由 Agent 决策 |
| `CHAT_HISTORY_CHAR_BUDGET` | `12000` | 问答送进模型的历史字符预算；最近一轮超预算时仍整段保留 |
| `DEDUPE_BACKEND` | `auto` | 关键帧去重：`auto`/`clip`/`hash`；CLIP 不可用时自动回退结构哈希 |
| `HASH_SIMILARITY_THRESHOLD` | `0.9` | 结构哈希去重阈值 |
| `CLIP_LOAD_TIMEOUT` | `90` | CLIP 模型加载超时（秒） |

### 测试与评测

```bash
cd 后端
./.venv/bin/python -m pytest app/tests -q --ignore=app/tests/test_video_analysis.py   # 离线，不调用任何模型
./.venv/bin/python -m app.tests.eval.run_eval    # 真实模型评测：引用通过率 / 命中率 / 拒答率 / 出题通过率 / token 成本
```

***

## 个人项目
***

## 📝 开发说明

### Git提交步骤
1. 拉取最新代码: `git pull origin main`
2. 开发完成后: `git status`
3. 添加所有修改: `git add .`
4. 提交: `git commit -m "评论"`
5. 再次拉取: `git pull origin main`
6. 推送: `git push origin main`

***

## 📄 许可证

本项目为2025腾讯犀牛鸟开源人才培养计划项目。

***

## 🤝 贡献

欢迎提交Issue和Pull Request！

---

**最后更新**: 2025-09-09
**版本**: v1.0.0
