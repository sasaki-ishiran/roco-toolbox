import { vi } from 'vitest';
import type { AccountSnapshot } from '../../domain/parseBackup';
import type { ProfilePageContext } from './types';
import type { ProfileTodos } from './useProfileTodos';

/** 区块测试的固定上下文；每个用例只覆盖自己关心的字段。 */
export const sampleSnapshot = (overrides: Partial<AccountSnapshot> = {}): AccountSnapshot => ({
  accountName: '测试甲',
  gameId: 1,
  exportedAt: '2026-11-28T00:00:00.000Z',
  importedAt: '2026-11-28T00:00:00.000Z',
  pets: [],
  eggs: [],
  ...overrides,
});

export const sampleTodos: ProfileTodos = {
  loaded: true,
  known: true,
  claims: 2,
  confirm: 1,
  nearbyTargets: 3,
  syncedAt: Date.UTC(2026, 10, 28, 4, 30),
};

export function makeCtx(overrides: Partial<ProfilePageContext> = {}): ProfilePageContext {
  return {
    loaded: true,
    snapshots: [sampleSnapshot()],
    accountId: 'acc-1',
    accountName: '训练家小明',
    avatar: null,
    avatarNotice: null,
    todos: sampleTodos,
    onOpenAvatar: vi.fn(),
    onCollect: vi.fn(),
    onGoEggStock: vi.fn(),
    onGoGroups: vi.fn(),
    onOpenGroups: vi.fn(),
    onGoIdentity: vi.fn(),
    onGoNearby: vi.fn(),
    onGoDashboard: vi.fn(),
    onStartTour: vi.fn(),
    autoConflict: null,
    onAutoConflictHandled: vi.fn(),
    ...overrides,
  };
}
