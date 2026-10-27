# Git 工作规则

- 开始工作时检查实际分支和工作区；工作区已有未提交改动时先确认归属，不 stash、覆盖、重置或自动换分支。
- 提交前检查暂存内容，只纳入本次任务改动；不顺带提交其他改动或来源不明的未跟踪文件。
- 未经用户要求不提交、不推送。获得授权后推送到现有 `origin` 的目标分支；遇到分叉、非快进、保护分支或写入结果未知时停止并报告，不强推、不自动 rebase/reset，不绕过 hooks。
- 凭据（`后端/.env` 等）和运行产物（`uploads/ frames/ audio/ outputs/ data/`）不得提交；`.gitignore` 已覆盖，新增同类目录时同步更新。
- 提交信息使用 conventional commits（feat / fix / refactor / test / docs / chore）。
- 任务结束报告实际验证、提交、推送结果；未完成的步骤明确说明。
