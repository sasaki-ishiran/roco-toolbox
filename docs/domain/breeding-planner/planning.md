# Planning Reference

## Resource Pool Schema

Use these columns when creating or asking for a resource table:

| 字段 | 说明 |
|---|---|
| 来源 | `已有`, `孵化`, `抓捕`, `交换`, `其他`; optional for planning |
| 性格 | Normalize `加攻击` to `加物攻` |
| 体型 | `大块头`, `接近大块头`, `普通`, `未知` |
| 性别 | `公`, `母`, `未知` |
| 蛋组1 | One of the 14 egg groups |
| 蛋组2 | Another egg group, or `无` |
| 数量 | Increment for exact duplicates |
| 主要用途 | Direct target stud, mother entry, bridge, temporary bridge, reserve |
| 备注 | Uncertainty, inheritance notes, or user corrections |

## Coverage Status

For each target nature and egg group:

- `已完成`: at least one resource is `大块头 + 公 + target nature` and includes the group.
- `计划中`: current resources can reasonably breed toward this target.
- `临时过桥`: route depends on `接近大块头`, unknown mechanics, or non-final resources.
- `未开始`: no clear current route.
- `需补资源`: no entry point or no realistic bridge.

## Route Scoring

Rank route candidates by:

1. Number of new final coverage items if successful.
2. Whether the pairing creates a bridge male for multiple future groups.
3. Whether the target group currently has no other route.
4. Whether both parents share the target nature, if the user assumes this improves odds.
5. Whether the route depends on temporary/non-large resources.

Use this practical order:

- Direct target male already in resource pool: mark coverage immediately.
- Target male capture for missing group: highest capture value.
- Target nature father + dual-group mother into a missing group: strong breeding route.
- Target nature mother + compatible father to turn into a male: useful when no target father exists.
- Non-target bridge only: lower priority unless it unlocks no-entry groups.

## Output Tables

When re-planning, provide these tables when useful:

### 1. Resource Delta

| 新增/变化 | 归一化后 | 计数处理 | 用途 |
|---|---|---|---|

### 2. Coverage Summary

| 蛋组 | 加速度 | 加生命 | 其他目标性格 |
|---|---|---|---|

For custom targets, add columns dynamically.

### 3. Next Hatch Round

| 窝 | 公本 | 母本 | 目标 | 成功判定 | 失败也要保留什么 |
|---|---|---|---|---|---|

Success判定 should mention exact final target, e.g. `大块头 + 加生命 + 公 + 动物/拟人`.

### 4. Capture Priorities

| 优先级 | 建议资源 | 公母要求 | 为什么 |
|---|---|---|---|

Do not restrict captures to females. A directly caught large target male can instantly complete coverage.

## Default Clarifications

Ask the user to clarify only when it changes the route materially:

- Is offspring group/species direction confirmed to follow mother?
- Does `接近大块头` count for any final purpose?
- How many hatch slots are available?
- Are target natures still `加速度` and `加生命`, or should additional natures be tracked?

If unanswered, use defaults and label them as assumptions.
