import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type {
  CollectionGroupDetail,
  CollectionGroupMember,
  PublishedStudResource,
  StudSlotCoverage,
  StudTargetConfig,
} from '../shared/collectionGroups';
import { studSlotSetIdOf } from '../shared/collectionGroups';
import { resetListViews } from './listViewStore';
import { StudGroupResources } from './StudGroupResources';

const target: StudTargetConfig = {
  kind: 'stud',
  mode: 'perfect',
  catalogVersion: 'v1',
  slots: [
    { groupId: 2, natureId: 11, natureName: '开朗', grade: '大婉' },
    { groupId: 3, natureId: 12, natureName: '固执', grade: '大婉' },
  ],
};

const slot = (groupId: number, natureId: number): StudSlotCoverage => ({
  groupId,
  natureId,
  grade: '大婉',
  gameId: 102,
});

const studResource = (
  covered: StudSlotCoverage[],
  breedable: StudSlotCoverage[] = [],
): PublishedStudResource => ({
  schemaVersion: 1,
  kind: 'stud',
  mode: 'perfect',
  catalogVersion: 'v1',
  targetId: studSlotSetIdOf(target),
  targetRevision: 0,
  accounts: [
    {
      accountKey: 'uid:1001',
      accountName: '甲的大号',
      sourceExportedAt: '2026-10-23T00:00:00.000Z',
      covered,
      breedable,
    },
  ],
  revision: 1,
  publishedAt: 1,
});

const member = (
  accountId: string,
  resource: PublishedStudResource | null,
): CollectionGroupMember => ({
  accountId,
  displayName: `成员${accountId}`,
  joinedAt: 1,
  resourceRevision: resource?.revision ?? 0,
  resource: null,
  studResource: resource,
});

const group: CollectionGroupDetail = {
  group: {
    id: 'g1',
    name: '种公组',
    ownerAccountId: 'A',
    createdAt: 1,
    groupType: 'stud',
    targetRevision: 0,
    resourceEpoch: 1,
    target,
  },
  members: [
    member('A', studResource([slot(2, 11)])),
    member('B', studResource([], [slot(2, 11)])),
    member('C', null),
  ],
};

beforeEach(() => {
  resetListViews();
});

describe('StudGroupResources', () => {
  test('有覆盖 / 可迭代 / 未知分开显示，未知不算缺', () => {
    // 再加一个「什么都没覆盖」的可比成员 D：这样 A 覆盖的「开朗」才是「我能补的」
    const withD: CollectionGroupDetail = {
      ...group,
      members: [...group.members, member('D', studResource([]))],
    };
    render(<StudGroupResources group={withD} viewerAccountId="A" catalogVersion="v1" />);
    // 我能补的：A 已覆盖、D 缺的「开朗」
    fireEvent.click(screen.getByTestId('stud-slot-view-mine'));

    const fire = screen
      .getAllByTestId('stud-slot-row')
      .find((row) => row.textContent?.includes('开朗'));
    expect(fire).toBeTruthy();
    expect(fire).toHaveTextContent('开朗 · 大婉');
    expect(screen.getByTestId('stud-slot-holders')).toHaveTextContent('成员A');
    expect(screen.getByTestId('stud-slot-breedable')).toHaveTextContent('成员B');
    expect(screen.queryByTestId('stud-slot-none')).toBeNull();

    // 共同寻找：没人有、且有人待确认的「固执」
    fireEvent.click(screen.getByTestId('stud-slot-view-seeking'));
    expect(screen.getByTestId('stud-slot-none')).toHaveTextContent('已发布成员均无，另 1 人待发布/更新');
  });

  test('搜索按蛋组 / 性格过滤', () => {
    render(<StudGroupResources group={group} viewerAccountId="A" catalogVersion="v1" />);
    fireEvent.change(screen.getByTestId('stud-slot-search'), { target: { value: '固执' } });
    expect(screen.getAllByTestId('stud-slot-row')).toHaveLength(1);
    expect(screen.getByTestId('stud-slot-row')).toHaveTextContent('固执');
  });

  test('共同寻找：无人覆盖的槽位可认领，未全员确认时只提示待确认', () => {
    const { rerender } = render(
      <StudGroupResources
        group={group}
        viewerAccountId="A"
        catalogVersion="v1"
        tasksConfirmed
        onClaimTask={vi.fn()}
        onReleaseTask={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('stud-slot-view-seeking'));
    expect(screen.getAllByTestId('stud-task-claim').length).toBeGreaterThan(0);

    rerender(
      <StudGroupResources
        group={group}
        viewerAccountId="A"
        catalogVersion="v1"
        tasksConfirmed={false}
        tasksPendingMemberIds={['C']}
        onClaimTask={vi.fn()}
        onReleaseTask={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('stud-slot-view-seeking'));
    expect(screen.queryAllByTestId('stud-task-claim')).toHaveLength(0);
    expect(screen.getAllByText(/待确认/).length).toBeGreaterThan(0);
  });

  test('目标未确认时给出明确提示', () => {
    render(
      <StudGroupResources
        group={{
          ...group,
          group: { ...group.group, target: { ...target, slots: [] } },
        }}
        viewerAccountId="A"
        catalogVersion="v1"
      />,
    );
    expect(screen.getByTestId('stud-resources-pending')).toBeTruthy();
  });
});
