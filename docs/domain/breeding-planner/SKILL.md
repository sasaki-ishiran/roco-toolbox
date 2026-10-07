---
name: rock-kingdom-breeding-planner
description: "Plan Rock Kingdom World breeding routes for full egg-group large-body male stud networks using a resource-pool workflow. Use when the user asks about 洛克王国世界/洛克王国 breeding, egg groups, 大块头种公, 加速度/加生命/加物攻等目标性格, 孵蛋轮次安排, 补抓优先级, or wants an Excel tracker/template for breeding resources."
---

# Rock Kingdom Breeding Planner

Use this skill to plan a reusable breeding base for Rock Kingdom World. Default objective: cover all 14 egg groups with `大块头 + 公 + target nature` studs for `加速度` and `加生命`. The user may add or replace target natures, for example adding `加物攻`.

## Domain Defaults

- Egg groups: `软体组`, `魔力组`, `天空组`, `巨龙组`, `两栖组`, `海洋组`, `大地组`, `巨灵组`, `机械组`, `拟人组`, `动物组`, `妖精组`, `昆虫组`, `植物组`.
- Default target natures: `加速度`, `加生命`.
- Rock Kingdom World has six beneficial natures for planning purposes. Normalize `加攻击` to `加物攻`.
- A final stud target requires: `大块头 + 公 + target nature + contains the egg group`.
- `接近大块头` is a temporary bridge only unless the user says the game treats it as final.
- Treat every obtained creature as a resource regardless of source: caught, hatched, exchanged, or existing. Do not distinguish hatch results from captures except in notes.
- If a resource is fully duplicated by nature, size, gender, egg groups, and practical role, increment its count instead of treating it as a distinct route input.

## Required Inputs

Ask only for missing details that block planning. Prefer proceeding with assumptions when the user has already given enough.

Minimum useful resource fields:

- `性格`
- `体型`
- `性别`
- `蛋组1`
- `蛋组2` or `无`
- `数量` when duplicates exist

Helpful optional fields:

- source (`已有`, `孵化`, `抓捕`, etc.)
- whether the user wants to prioritize a target nature or egg group
- available simultaneous hatch slots
- confirmed game mechanics if they differ from the default assumptions

## Planning Workflow

1. Normalize resources.
   - Convert `加攻击` to `加物攻`.
   - Combine exact duplicates by count.
   - Mark non-large resources as `临时过桥` unless the user explicitly allows them as final.

2. Compute current coverage.
   - For each target nature and each egg group, mark complete if any counted resource is `大块头 + 公 + target nature` and includes that egg group.
   - Dual-group studs can cover both groups for the same target nature.

3. Identify entry points and bridges.
   - Default breeding assumption: offspring species/group direction usually follows the mother; fathers are mainly used to pass target nature and large-body traits.
   - Mothers are valuable as egg-group entry points even with non-target natures.
   - Dual-group resources are bridge resources.
   - Directly caught target males are often better than breeding, because they immediately add coverage.

4. Plan next hatch round.
   - Use the available hatch slot count, default 5.
   - Rank pairings by expected new final coverage, bridge value, and scarcity.
   - Prefer pairings that produce a new target-nature large male in an uncovered group.
   - Keep target-nature large females as useful resources even if they do not complete stud coverage.
   - If a planned result fails, do not treat the round as wasted; add the actual output to the resource pool and re-plan.

5. Recommend captures/resources.
   - Recommend both male and female options.
   - Best direct captures: `大块头 + 公 + target nature + missing egg group`.
   - Best bridge captures: large dual-group resources connecting completed groups to missing groups.
   - If the user has no entry for an egg group, prioritize any large resource touching that group; prefer dual-group resources connected to a currently covered group.

For detailed output tables and scoring heuristics, read `references/planning.md`.

## Excel Template

When the user asks for a reusable Excel workbook or resource tracker, use `scripts/build_resource_pool_template.mjs`.

Recommended execution:

1. Resolve Codex workspace Node dependencies with `load_workspace_dependencies`.
2. Create or reuse a local `node_modules` junction/symlink to the bundled Node packages so `@oai/artifact-tool` resolves.
3. Run:

```powershell
& '<bundled-node.exe>' '<skill-dir>\scripts\build_resource_pool_template.mjs' --output '<desired-output.xlsx>'
```

The template is intentionally resource-pool driven: users update `资源池`; future planning is recomputed from current resources rather than from per-nest success/failure history.

## Response Style

- Prefer compact Chinese tables when the user writes in Chinese.
- Separate `已完成`, `计划中`, `临时过桥`, and `必须补资源`.
- State assumptions explicitly, especially inheritance and offspring-direction assumptions.
- When new resources are reported, first summarize what changed, then update coverage and next-round recommendations.
