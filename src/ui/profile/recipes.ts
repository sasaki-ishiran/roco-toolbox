import { CollectSection } from './sections/CollectSection';
import { EggGroupSection } from './sections/EggGroupSection';
import { IdentitySection } from './sections/IdentitySection';
import { SettingsSection } from './sections/SettingsSection';
import { hasData, type SectionDef } from './types';

/**
 * 「我的」页配方（2026-11-28 UX1 第三版）。
 *
 * 一列卡片：身份 → 采集（附近+导入同一张卡）→ 蛋仓 / 小组两张小卡 → 设置（行列表）。
 * 待办数字折进卡片（蛋仓待认领 / 小组待确认 / 附近卡的蹲守数），不再单独一块三格。
 * 回退一行：`PROFILE_ACTIVE = PROFILE_STABLE_V1`。
 */
const IDENTITY: SectionDef = {
  id: 'identity',
  title: '身份',
  render: IdentitySection,
};

const COLLECT: SectionDef = {
  id: 'collect',
  title: '采集',
  render: CollectSection,
  // 采集卡就是数据入口：新用户也要能开始采集，所以不设 when
};

const EGG_GROUP: SectionDef = {
  id: 'egg-group',
  title: '蛋仓与小组',
  render: EggGroupSection,
  when: hasData,
};

const SETTINGS: SectionDef = {
  id: 'settings',
  title: '设置',
  render: SettingsSection,
};

/** 上一版结构（卡片化之前），留作一行回退。 */
export const PROFILE_STABLE_V1: SectionDef[] = [IDENTITY, COLLECT, EGG_GROUP, SETTINGS];

/** 现行：卡片化（UX1 方案 A）。 */
export const PROFILE_CARDS_V3: SectionDef[] = [IDENTITY, COLLECT, EGG_GROUP, SETTINGS];

/** 线上使用哪份配方。回退一行：改成 PROFILE_STABLE_V1。 */
export const PROFILE_ACTIVE: SectionDef[] = PROFILE_CARDS_V3;

export type SectionId = (typeof PROFILE_ACTIVE)[number]['id'];

/** 调试/测试用：按 id 找区块。 */
export function sectionById(recipe: readonly SectionDef[], id: string): SectionDef | undefined {
  return recipe.find((section) => section.id === id);
}
