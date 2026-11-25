# 学习工作台后端迁移

来源为本次完整换栈需求及 DOVideo-AI 的公开实现（参考版本 `6f3848d`）。现有工作台的展示、导出、示例和学习功能都保留。新模块独立实现。

## 任务
原实现使用 Flask 进程内线程和事件列表，适合本地单进程。Java 21 / Spring Boot 接收异步任务，MyBatis 和 MySQL 保存任务与可回放的 SSE 事件。数据库唯一键限制一个视频同时只有一个活动任务；每个 worker 同时只处理一个视频。媒体计算沿用 Python，实现迁移时沿用结果与时间戳契约。MySQL 会话锁随断连释放，工作区文件锁保护单个共享卷；外部模型调用在进程中断的边界可能重做。

验收：相同视频并发提交得到同一活动任务，服务重启后继续查任务，SSE 用 Last-Event-ID 续读，旧页面仍能读结果。状态：已实现，整套真实模型解析未验证。部署时所有实例必须使用同一工作区与数据库。

## 分片上传
平台模式沿用原上传入口；HTTPS 或 localhost 下按 5 MiB 计算 SHA-256，失败后重选同一文件可续传，支持不超过 2 GiB 的视频。Redis 保存一次性验证令牌；MySQL 保存分片清单；MinIO 保存对象，合并后才发布本地媒体工作副本。完成请求可重放，过期的未完成会话与临时对象由后台清理。旧版 Web 服务仍可独立启动。

## 启动平台
需要 Docker 和 Compose v2.22 或以上。首次运行：

```bash
python3 infra/platform/configure.py
# 在 infra/platform/.env 中设置模型 API 和自己的 UPLOAD_ANSWER
docker compose -f infra/platform/compose.yaml up --build -d
```

打开 http://localhost:8088 。网关为原学习工作台、Java 平台与兼容学习 API 提供同源入口。上传分片、任务和 SSE 由 Spring 提供；学习数据在本部署自己的 MySQL 库，媒体产物在 work 卷，模型缓存可跨容器重用。原本地库与文件不会自动导入。停止运行用同一 compose 文件执行 `down`；卷中保存结果和课程记录。公开部署时配置 HTTPS。使用 `start-all.sh` 可以独立运行原有本地模式。

## 消息投递
平台配置使用 RocketMQ。新任务和待投递记录在同一 MySQL 事务中创建，Broker 确认后才删除待投递记录。重复消息会再次检查数据库任务状态。Broker 暂时不可用时记录保留，worker 定期从数据库补捞可运行任务。
