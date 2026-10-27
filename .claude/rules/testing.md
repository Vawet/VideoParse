# 本地验证范围

- 只运行与改动模块及直接消费者/契约相关的测试，不默认跑全量。
- 影响范围无法界定、或确有必要扩大回归时，说明原因并取得用户明确授权再跑全量。
- 默认离线：测试不得依赖 API key、ffmpeg、GPU 或联网（见 `后端/app/tests/test_agent_offline.py`）。需要真实模型的检查属于评测，需用户授权后单独运行。
- 评测（`后端/app/tests/eval/`）与单元测试分开：改检索/切分/prompt 时用评测对比指标；纯重构跑相关单测即可。
- 常用入口（在 `后端/` 下，优先使用 `.venv`）：
  - `./.venv/bin/python -m pytest app/tests/test_xxx.py -v`
  - `./.venv/bin/python -m app.tests.eval.retrieval_eval`
- 不重复运行未改变的检查，不把成功日志整段塞进上下文。
- 不删除测试、不在选定范围内削弱检查、不声称运行过未运行的检查；如实报告测试范围、结果和未验证部分。局部通过不等于全量通过。
