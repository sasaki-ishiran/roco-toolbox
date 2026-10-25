# 洛克王国工具箱 — 项目工作约定

本项目采用 Superpowers 工作流。开始任何任务前，先检查是否有可用技能，有就先按技能执行，
再动手；流程技能优先于实现技能。

- 要做新功能 / "帮我做 X" → 先用 `brainstorming`，再 `writing-plans`，然后实施
- 遇到 bug、测试失败、行为异常 → 先用 `systematic-debugging`
- 写实现代码前 → `test-driven-development`（红-绿-重构，先写失败测试）
- 声称"完成/修好了"之前 → `verification-before-completion`（必须给出命令与真实输出）
- 写前端界面 → `frontend-app-builder`、`react-best-practices`、`shadcn-best-practices`
- 需要真实浏览器验证界面 → `playwright`
- 孵蛋领域规则（蛋组、大块头、目标性格、覆盖度、配种排序）→ `rock-kingdom-breeding-planner`，
  领域模型的完整版在 `docs/domain/breeding-planner/`

用户的直接指令优先于技能，技能优先于默认习惯。

## 不确定就问，不要猜（用户约定，2026-10-25）

- 需求、口径、数据对不上时，**先向用户确认**（附上已查到的证据和候选方案），不要靠猜直接改代码。
- 尤其是「用户说某只精灵/某个数据不对」这类反馈：先查线上数据与本地图鉴，把结论和疑点摆出来，
  再问清是哪种情况，得到确认后再动手。

## 不要随便跑全量测试（用户约定，2026-10-25）

- 日常改动只跑**相关**测试文件（`npx vitest run <file>`），不要每改一点就跑 `npx vitest run` 全量。
- 全量单测 / Playwright / 完整构建只在**收尾验证或准备发布**时各跑一次。
- 已经跑过全量之后，没有新增代码改动就不要重复跑。

## 子代理模型选择（用户约定，2026-09-26）

- **派发子代理默认用 `deepseek-v4-flash`**，不要默认开 pro。
- 只有在你判断该任务确实需要更强推理时才用 `deepseek-v4-pro`（例如：架构级设计决策、
  复杂 bug 调试、跨多文件的接口重构、整支分支的最终评审），并在派发说明里写一句
  为什么这个任务值得用 pro。
- 修复轮与限定范围的复审一律用 flash（改动小、有明确的发现清单）。

## 协作消息载荷失效时的兜底（2026-09-26 实测）

本环境下，发给子代理的协作消息**正文无法解密**：消息里只有信封（`Message Type: NEW_TASK /
Task name / Sender`）和 `encrypted_content` 占位符，看不到实际任务内容。原因是本项目使用第三方
模型提供方（`deepseek`）+ `disable_response_storage = true`，`encrypted_content` 需要服务端存储才能解密。

**子代理遇到这种情况不要停在原地问"任务是什么"**，改为读文件自取任务：

1. 读 `.superpowers/ACTIVE_TASK.md`（相对当前工作目录）；若它指向某个 worktree，就去那个路径读同名文件。
2. 按其中的指示执行（任务、任务简报、报告路径、验收命令都写在那份文件里），并把报告写到它指定的路径。
3. 该文件不存在时，才回复"没有收到任务"，并说明已检查过 `.superpowers/ACTIVE_TASK.md`。
