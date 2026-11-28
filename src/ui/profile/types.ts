import type { ComponentType } from 'react';
import type { AccountSnapshot } from '../../domain/parseBackup';
import type { ProfileAvatarPet } from '../../api/profileAvatar';
import type { ProfileTodos } from './useProfileTodos';

/**
 * 「我的」页区块化（2026-11-28）：页面 = 配方（区块数组），区块 = 独立组件 + 元数据。
 *
 * 约束（来自 `docs/方案-页面区块化与可回退-2026-11-28.md`）：
 * - 区块之间**禁止互相 import**；共享数据只从 `ProfilePageContext` 进来；
 * - `when` 返回 false 就完全不渲染（不占高度）；
 * - 每个区块都能单独挂载、断数据不炸（各自有测试）。
 */

/** 首屏的待办数字（2026-11-28 用户口径：待办型，收集进度归看板）。 */
export interface ProfileNotice {
  tone: 'error' | 'info';
  text: string;
}

export interface ProfilePageContext {
  loaded: boolean;
  snapshots: AccountSnapshot[];
  accountId: string | null;
  accountName: string | null;
  avatar: ProfileAvatarPet | null;
  avatarNotice: ProfileNotice | null;
  todos: ProfileTodos;
  /** 头像（2026-11-28）：点头像直接换；未登录时由页面给提示 */
  onOpenAvatar: () => void;
  onCollect: () => void;
  onGoEggStock: () => void;
  onGoGroups: () => void;
  /** 导入结果里的「去小组查看」走导航意图（open-groups），与入口格子的分区跳转不同 */
  onOpenGroups: () => void;
  onGoIdentity: () => void;
  onGoNearby: () => void;
  /** 完成态里的「看看板」 */
  onGoDashboard: () => void;
  onStartTour?: () => void;
  autoConflict: import('../../api/session').CloudMeta | null;
  onAutoConflictHandled: () => void;
}

export interface SectionProps {
  ctx: ProfilePageContext;
}

export interface SectionDef {
  /** 稳定标识，配方与调试都用它 */
  id: string;
  /** 调试面板 / 设置页里的名字 */
  title: string;
  render: ComponentType<SectionProps>;
  /** 什么时候出现；false = 不渲染、不占高度 */
  when?: (ctx: ProfilePageContext) => boolean;
}

/** 有本机数据才显示「三个数字 / 三个入口 / 采集与同步」。 */
export const hasData = (ctx: ProfilePageContext): boolean => ctx.snapshots.length > 0;

/** 新用户：读完了、但一份数据都没有。 */
export const isNewUser = (ctx: ProfilePageContext): boolean => ctx.loaded && ctx.snapshots.length === 0;
