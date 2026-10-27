---
name: videoparse-dev
description: VideoParse 本地启动、离线测试、检索评测与常见排错。Use when running, verifying or debugging the VideoParse backend (Flask + Agent) or frontend (React) locally.
---

# VideoParse 本地开发与验证

## 范围

仅覆盖本地运行与验证。不部署、不读取或展示 `后端/.env` 的值、不联网拉取模型，除非用户明确授权。

## 启动

- 全部：`./start-all.sh`（后端 5000，前端 8080；优先使用 `后端/.venv`）。
- 单端：`start-backend.sh` / `start-frontend.sh`（Windows 对应 `.bat`）。
- 后端缺 key 时应仍可 import；真实解析需 `DASHSCOPE_API_KEY` 或 `DEEPSEEK_API_KEY`（`LLM_PROVIDER` 在两者并存时必须显式指定）。启动成功不代表模型可用。

## 验证（按改动选，遵循 `.claude/rules/testing.md`）

| 改动 | 最小验证 |
| --- | --- |
| `agent/` 循环、工具、状态 | `cd 后端 && ./.venv/bin/python -m pytest app/tests/test_agent_offline.py -v` |
| 检索 / 证据 | `test_retrieval.py`、`test_hybrid.py`、`test_evidence.py`；影响排序时跑 `python -m app.tests.eval.retrieval_eval` 对比指标 |
| ASR / 切分 / 静音视频 | `test_asr_split.py`、`test_silent_video.py` |
| 测验 / 复习 / 讲授 | 对应 `test_quiz.py` / `test_review.py` / `test_teach.py` |
| 上传 / 课程 / 接口 | `test_upload_gate.py`、`test_courses.py` |
| 前端 | `cd 前端/my-react-app && npm run build` 能通过；UI 行为需人工或浏览器核对，构建通过不代表交互正确 |

- 评测指标变化必须说明数据集（`golden.json`）与对比基线，不用单次结果下结论。
- `前端/my-react-app/dist/` 是构建产物，已被 `.gitignore` 忽略，可由 `npm run build` 再生，不手改、不提交。

## 排错入口

- Agent 行为异常：先看 SSE 事件流（`GET /tasks/<id>/events`）与工作区落盘的中间产物，再判断是 prompt、工具返回结构还是模型问题；不要先改 prompt。
- 结果结构不一致：核对 `validate_result` 与前端消费字段是否同时更新。
- 只在重复出现且有证据后才考虑写入 `.claude/memory/`。
