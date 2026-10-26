import { beforeEach, describe, expect, test, vi } from 'vitest';
import { MotherGroupsApiError } from '../api/motherGroups';
import { getCollectionGroup, listCollectionGroups, publishCollectionResources } from '../api/collectionGroups';
import { readAccountId } from '../api/session';
import { defaultMotherTarget, type CollectionGroupDetail, type StudTargetConfig } from '../shared/collectionGroups';
import type { PublishedMotherResource } from '../shared/motherGroups';
import {
  FIXTURE_CATALOG_VERSION,
  catalog,
  mother,
  resourceWith,
  sharedAccount,
  snapshot,
} from '../test/fixtures/motherSharing';
import { autoPublishGroups } from './groupAutoPublish';
import { clearCollectionGroupPrefs, setGroupSharingOff } from './collectionGroupStore';

vi.mock('../api/session', () => ({ readAccountId: vi.fn() }));
vi.mock('../api/collectionGroups', () => ({
  listCollectionGroups: vi.fn(),
  getCollectionGroup: vi.fn(),
  publishCollectionResources: vi.fn(),
}));

const ACCOUNT = 'me';

const summary = (groupType: 'mother' | 'stud' = 'mother') => ({
  id: 'g1',
  name: '组',
  ownerAccountId: ACCOUNT,
  memberCount: 1,
  groupType,
  targetRevision: 0,
  targetReady: true,
});

const motherDetail = (published: PublishedMotherResource | null = null): CollectionGroupDetail => ({
  group: {
    id: 'g1',
    name: '组',
    ownerAccountId: ACCOUNT,
    createdAt: 1,
    groupType: 'mother',
    targetRevision: 0,
    resourceEpoch: 0,
    target: defaultMotherTarget(FIXTURE_CATALOG_VERSION),
  },
  members: [{
    accountId: ACCOUNT,
    displayName: '我',
    joinedAt: 1,
    resourceRevision: published?.revision ?? 0,
    resource: published,
    studResource: null,
  }],
});

const studDetail = (): CollectionGroupDetail => {
  const target: StudTargetConfig = {
    kind: 'stud',
    mode: 'perfect',
    catalogVersion: FIXTURE_CATALOG_VERSION,
    slots: [{ groupId: 2, natureId: 1, natureName: '固执', grade: '大婉' }],
  };
  return {
    group: {
      id: 'g1', name: '组', ownerAccountId: ACCOUNT, createdAt: 1,
      groupType: 'stud', targetRevision: 2, resourceEpoch: 0, target,
    },
    members: [{
      accountId: ACCOUNT, displayName: '我', joinedAt: 1,
      resourceRevision: 0, resource: null, studResource: null,
    }],
  };
};

const localSnapshots = (uids: number[] = [1001]) =>
  uids.map((uid) => snapshot(uid, `账号${uid}`, [mother(101, { account: `账号${uid}` })]));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(readAccountId).mockReturnValue(ACCOUNT);
  vi.mocked(listCollectionGroups).mockResolvedValue([summary()]);
  vi.mocked(getCollectionGroup).mockResolvedValue(motherDetail());
  vi.mocked(publishCollectionResources).mockResolvedValue({ resourceRevision: 1, publishedAt: 1 });
  clearCollectionGroupPrefs(ACCOUNT);
});

describe('导入后自动发布到小组', () => {
  test('没登录 / 没有本机数据时不请求小组', async () => {
    vi.mocked(readAccountId).mockReturnValue(null);
    expect(await autoPublishGroups({ snapshots: localSnapshots(), species: catalog, catalogVersion: FIXTURE_CATALOG_VERSION })).toBe(0);
    expect(listCollectionGroups).not.toHaveBeenCalled();

    vi.mocked(readAccountId).mockReturnValue(ACCOUNT);
    expect(await autoPublishGroups({ snapshots: [], species: catalog, catalogVersion: FIXTURE_CATALOG_VERSION })).toBe(0);
    expect(listCollectionGroups).not.toHaveBeenCalled();
  });

  test('从没发布过：用全部本机账号自动发布', async () => {
    const count = await autoPublishGroups({
      snapshots: localSnapshots([1001, 1002]),
      species: catalog,
      catalogVersion: FIXTURE_CATALOG_VERSION,
    });
    expect(count).toBe(1);
    const [, input] = vi.mocked(publishCollectionResources).mock.calls[0];
    expect(input.baseRevision).toBe(0);
    expect(input.resource).toMatchObject({
      criteriaId: 'female-huge-voice100-v2',
      accounts: [
        { accountKey: 'uid:1001', eggGameIds: [101] },
        { accountKey: 'uid:1002', eggGameIds: [101] },
      ],
    });
  });

  test('内容没变不重复发布', async () => {
    vi.mocked(getCollectionGroup).mockResolvedValue(motherDetail(
      resourceWith([101], {
        catalogVersion: FIXTURE_CATALOG_VERSION,
        accounts: [sharedAccount(1001, [101])],
      }),
    ));
    expect(await autoPublishGroups({
      snapshots: localSnapshots([1001]),
      species: catalog,
      catalogVersion: FIXTURE_CATALOG_VERSION,
    })).toBe(0);
    expect(publishCollectionResources).not.toHaveBeenCalled();
  });

  test('已发布过的账号保留，本次导入的新账号自动并进去', async () => {
    vi.mocked(getCollectionGroup).mockResolvedValue(motherDetail(
      resourceWith([101], {
        catalogVersion: FIXTURE_CATALOG_VERSION,
        accounts: [sharedAccount(1001, [101])],
      }),
    ));
    await autoPublishGroups({
      snapshots: localSnapshots([1001, 1002]),
      species: catalog,
      catalogVersion: FIXTURE_CATALOG_VERSION,
      touchedAccountKeys: ['uid:1002'],
    });
    const [, input] = vi.mocked(publishCollectionResources).mock.calls[0];
    expect((input.resource as { accounts: Array<{ accountKey: string }> }).accounts.map((item) => item.accountKey))
      .toEqual(['uid:1001', 'uid:1002']);
  });

  test('用户主动停止共享过的组不会被自动发回去', async () => {
    setGroupSharingOff(ACCOUNT, 'g1', true);
    expect(await autoPublishGroups({
      snapshots: localSnapshots([1001]),
      species: catalog,
      catalogVersion: FIXTURE_CATALOG_VERSION,
    })).toBe(0);
    expect(getCollectionGroup).not.toHaveBeenCalled();
  });

  test('种公组按目标自动发布', async () => {
    vi.mocked(listCollectionGroups).mockResolvedValue([summary('stud')]);
    vi.mocked(getCollectionGroup).mockResolvedValue(studDetail());
    expect(await autoPublishGroups({
      snapshots: localSnapshots([1001]),
      species: catalog,
      catalogVersion: FIXTURE_CATALOG_VERSION,
    })).toBe(1);
    const [, input] = vi.mocked(publishCollectionResources).mock.calls[0];
    expect(input.resource).toMatchObject({ kind: 'stud', targetRevision: 2 });
  });

  test('另一台设备刚写过（409）：重新拉取后重试一次', async () => {
    vi.mocked(publishCollectionResources)
      .mockRejectedValueOnce(new MotherGroupsApiError(409, 'REVISION_CONFLICT', '冲突'))
      .mockResolvedValueOnce({ resourceRevision: 2, publishedAt: 2 });
    expect(await autoPublishGroups({
      snapshots: localSnapshots([1001]),
      species: catalog,
      catalogVersion: FIXTURE_CATALOG_VERSION,
    })).toBe(1);
    expect(getCollectionGroup).toHaveBeenCalledTimes(2);
    expect(publishCollectionResources).toHaveBeenCalledTimes(2);
  });
});
