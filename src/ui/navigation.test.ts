import { describe, expect, test } from 'vitest';
import {
  focusPending,
  initialNavigation,
  legacyLocation,
  resolveNavigation,
  type AppNavigation,
  type CollectionLocation,
} from './navigation';

const EGG_LOCATION: CollectionLocation = { kind: 'studs', view: 'eggs' };

const openCollection = (current: AppNavigation, location: CollectionLocation): AppNavigation =>
  resolveNavigation(current, { type: 'open-collection', location });

describe('initialNavigation：旧页签 / 子视图映射', () => {
  test.each([
    ['dashboard', null, 'dashboard'],
    ['home', null, 'home'],
    ['myPets', null, 'collection'],
    ['coverage', null, 'collection'],
    ['swap', 'eggs', 'groups'],
    ['swap', null, 'groups'],
    ['swap', 'sharing', 'groups'],
    ['import', null, 'profile'],
    [null, null, 'profile'],
    ['nope', null, 'profile'],
  ] as const)('lastTab=%s swapView=%s → page=%s', (lastTab, swapView, page) => {
    expect(initialNavigation(lastTab, swapView).page).toBe(page);
  });

  test('旧 myPets 进入精灵库的全部', () => {
    expect(initialNavigation('myPets', null).collection).toEqual({
      kind: 'inventory',
      view: 'all',
    });
  });

  test('旧 coverage 进入种公覆盖矩阵', () => {
    expect(initialNavigation('coverage', null).collection).toEqual({
      kind: 'studs',
      view: 'coverage',
    });
  });

  test('旧 swap + 旧求蛋子视图落到小组 · 个人求种公', () => {
    expect(initialNavigation('swap', 'nonsense').page).toBe('groups');
    expect(initialNavigation('swap', 'nonsense').groupType).toBe('stud');
    expect(initialNavigation('swap', 'eggs').groupType).toBe('stud');
    expect(initialNavigation('swap', 'sharing').groupType).toBeUndefined();
  });

  test('默认（空存储）落在我的 · 游戏数据', () => {
    const nav = initialNavigation(null, null);
    expect(nav.page).toBe('profile');
    expect(nav.profileSection).toBe('data');
  });

  test('初始收集落点为母本未收集', () => {
    expect(initialNavigation('dashboard', null).collection).toEqual({
      kind: 'mothers',
      status: 'missing',
    });
  });
});

describe('resolveNavigation：意图', () => {
  test('从共享恢复后，种公求蛋意图切回小组并带类型', () => {
    const restored = initialNavigation('swap', 'sharing');
    expect(restored.page).toBe('groups');
    const next = resolveNavigation(restored, {
      type: 'open-groups',
      groupType: 'stud',
    });
    expect(next.page).toBe('groups');
    expect(next.groupType).toBe('stud');
  });

  test('切普通主导航只改 page，保留同次会话子视图', () => {
    const inEggs = openCollection(initialNavigation('dashboard', null), EGG_LOCATION);
    const dashboard = resolveNavigation(inEggs, { type: 'tab', page: 'dashboard' });
    expect(dashboard.page).toBe('dashboard');
    expect(dashboard.collection).toEqual(EGG_LOCATION);

    const back = resolveNavigation(dashboard, { type: 'tab', page: 'collection' });
    expect(back.page).toBe('collection');
    expect(back.collection).toEqual(EGG_LOCATION);
  });

  test('重复直达同一目标也递增 focusRevision（聚焦 effect 必须重跑）', () => {
    const first = openCollection(initialNavigation('dashboard', null), EGG_LOCATION);
    const second = openCollection(first, EGG_LOCATION);
    expect(second.focusRevision).toBe(first.focusRevision + 1);
  });

  test('直达切换子视图后不再保留旧蛋组聚焦', () => {
    const focused = openCollection(initialNavigation('dashboard', null), {
      kind: 'studs',
      view: 'coverage',
      groupId: 5,
    });
    expect(focused.collection).toMatchObject({ groupId: 5 });
  });

  test('打开我的可要求「返回小组」，切普通主导航会清掉它', () => {
    const profile = resolveNavigation(initialNavigation('swap', 'sharing'), {
      type: 'open-profile',
      section: 'identity',
      returnToGroups: true,
    });
    expect(profile.page).toBe('profile');
    expect(profile.profileSection).toBe('identity');
    expect(profile.returnToGroups).toBe(true);
    expect(resolveNavigation(profile, { type: 'tab', page: 'dashboard' }).returnToGroups).toBe(false);
  });

  test('打开小组可带蛋组目标，手动切页后清掉', () => {
    const groups = resolveNavigation(initialNavigation('dashboard', null), {
      type: 'open-groups',
      eggGameId: 3200,
    });
    expect(groups.page).toBe('groups');
    expect(groups.groupEggGameId).toBe(3200);
    expect(
      resolveNavigation(groups, { type: 'tab', page: 'groups' }).groupEggGameId,
    ).toBeUndefined();
  });
});

describe('focusRevision 消费', () => {
  test('成功后 consume-focus 关闭待聚焦；旧消费不改状态', () => {
    const nav = openCollection(initialNavigation('dashboard', null), EGG_LOCATION);
    expect(focusPending(nav)).toBe(true);

    const stale = resolveNavigation(nav, { type: 'consume-focus', revision: nav.focusRevision - 1 });
    expect(stale).toBe(nav);
    expect(focusPending(stale)).toBe(true);

    const consumed = resolveNavigation(nav, { type: 'consume-focus', revision: nav.focusRevision });
    expect(focusPending(consumed)).toBe(false);
  });

  test('晚到的旧消费不能清掉后来的新直达', () => {
    const first = openCollection(initialNavigation('dashboard', null), EGG_LOCATION);
    const second = openCollection(first, EGG_LOCATION);
    const late = resolveNavigation(second, {
      type: 'consume-focus',
      revision: first.focusRevision,
    });
    expect(focusPending(late)).toBe(true);
  });
});

describe('legacyLocation：新页面写回旧键', () => {
  const base = initialNavigation('dashboard', null);

  test('小组 → swap/sharing', () => {
    expect(legacyLocation({ ...base, page: 'groups' })).toEqual({
      lastTab: 'swap',
      swapView: 'sharing',
    });
  });

  test('种公组 → swap/eggs；母本组 → swap/sharing', () => {
    expect(legacyLocation({ ...base, page: 'groups', groupType: 'stud' })).toEqual({
      lastTab: 'swap',
      swapView: 'eggs',
    });
    expect(legacyLocation({ ...base, page: 'groups', groupType: 'mother' })).toEqual({
      lastTab: 'swap',
      swapView: 'sharing',
    });
  });

  test('收集页的种公求蛋视图仍可写回 swap/eggs（旧版可理解）', () => {
    expect(legacyLocation({ ...base, page: 'collection', collection: EGG_LOCATION })).toEqual({
      lastTab: 'swap',
      swapView: 'eggs',
    });
  });

  test('覆盖矩阵 → coverage', () => {
    expect(
      legacyLocation({
        ...base,
        page: 'collection',
        collection: { kind: 'studs', view: 'coverage' },
      }).lastTab,
    ).toBe('coverage');
  });

  test('库存 / 母本 → myPets；我的 → import；看板 → dashboard', () => {
    expect(
      legacyLocation({ ...base, page: 'collection', collection: { kind: 'inventory', view: 'all' } })
        .lastTab,
    ).toBe('myPets');
    expect(
      legacyLocation({ ...base, page: 'collection', collection: { kind: 'mothers', status: 'plan' } })
        .lastTab,
    ).toBe('myPets');
    expect(legacyLocation({ ...base, page: 'profile' }).lastTab).toBe('import');
    expect(legacyLocation({ ...base, page: 'dashboard' }).lastTab).toBe('dashboard');
  });

  test('家园 → home', () => {
    expect(legacyLocation({ ...base, page: 'home' })).toEqual({
      lastTab: 'home',
      swapView: 'eggs',
    });
  });

  test('不把新 page 字符串写进旧 lastTab', () => {
    for (const page of ['dashboard', 'collection', 'groups', 'profile'] as const) {
      expect(['dashboard', 'myPets', 'coverage', 'swap', 'import']).toContain(
        legacyLocation({ ...base, page }).lastTab,
      );
    }
  });
});
