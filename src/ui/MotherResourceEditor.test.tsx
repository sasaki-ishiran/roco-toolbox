import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { MotherResourceEditor } from './MotherResourceEditor';
import type { MotherGroupsHook } from './useMotherGroups';
import type { MotherResourceDraft } from '../shared/motherGroups';
import {
  FIXTURE_CATALOG_VERSION,
  catalog,
  member,
  mother,
  resourceWith,
  sharedAccount,
  snapshot,
} from '../test/fixtures/motherSharing';
import { MOTHER_CRITERIA_ID } from '../shared/motherGroups';
import { diffMotherResources } from '../domain/motherResource';

const resource: MotherResourceDraft = {
  schemaVersion: 1,
  criteriaId: MOTHER_CRITERIA_ID,
  catalogVersion: FIXTURE_CATALOG_VERSION,
  accounts: [sharedAccount(1001, [101])],
};

const hookOf = (overrides: Partial<MotherGroupsHook> = {}): MotherGroupsHook => ({
  accountId: 'A',
  groups: [],
  groupsLoaded: true,
  currentGroupId: 'g1',
  currentGroup: null,
  loading: false,
  error: '',
  offline: false,
  nextPollAt: null,
  draftSelection: ['uid:1001'],
  draftDirty: false,
  publishPreview: {
    resource,
    diff: {
      addedEggGameIds: [101],
      removedEggGameIds: [],
      addedAccounts: [],
      removedAccounts: [],
      changedAccounts: [],
      unchanged: false,
    },
    missingAccountKeys: [],
    error: '',
  },
  myMember: member('A', resourceWith([101], { accounts: [sharedAccount(1001, [101])] })),
  selectGroup: vi.fn(),
  setDraftSelection: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined),
  createGroup: vi.fn(),
  joinGroup: vi.fn(),
  publish: vi.fn().mockResolvedValue(undefined),
  stopSharing: vi.fn().mockResolvedValue(undefined),
  updateProfile: vi.fn(),
  resetInvite: vi.fn(),
  leave: vi.fn(),
  dissolve: vi.fn(),
  clearError: vi.fn(),
  ...overrides,
});

const snapshots = [snapshot(1001, '甲', [mother(101)])];

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('MotherResourceEditor', () => {
  test('旧小组面板卸载后，发布失败不得触发新小组的刷新', async () => {
    let reject!: (error: Error) => void;
    const publish = vi.fn(() => new Promise<void>((_resolve, rej) => { reject = rej; }));
    const hook = hookOf({ publish });
    const { unmount } = render(<MotherResourceEditor hook={hook} snapshots={snapshots} species={catalog} />);
    fireEvent.click(screen.getByTestId('mother-publish'));
    unmount();
    reject(new Error('旧组发布失败'));
    await waitFor(() => expect(publish).toHaveBeenCalledOnce());
    expect(hook.refresh).not.toHaveBeenCalled();
  });

  test('覆盖不变但图鉴版本升级时仍可更新资源', async () => {
    const published = resourceWith([101], { catalogVersion: 'old', accounts: resource.accounts });
    const hook = hookOf({ myMember: member('A', published), publishPreview: {
      resource, diff: diffMotherResources(published, resource), missingAccountKeys: [], error: '',
    } });
    render(<MotherResourceEditor hook={hook} snapshots={snapshots} species={catalog} />);
    expect(screen.getByTestId('mother-publish')).toBeEnabled();
    expect(screen.queryByText('当前选号与线上一致，无需更新。')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mother-publish'));
    await waitFor(() => expect(hook.publish).toHaveBeenCalledOnce());
  });

  test('覆盖及版本都未变时仍不重复发布', () => {
    const published = resourceWith([101], { accounts: resource.accounts });
    render(<MotherResourceEditor hook={hookOf({ myMember: member('A', published), publishPreview: {
      resource, diff: diffMotherResources(published, resource), missingAccountKeys: [], error: '',
    } })} snapshots={snapshots} species={catalog} />);
    expect(screen.getByTestId('mother-publish')).toBeDisabled();
  });

  test('缺本地快照的已共享账号可以取消，也可以在发布前重新选回', () => {
    const published = resourceWith([101], { accounts: [sharedAccount(1001, [101]), sharedAccount(2002, [201])] });
    const hook = hookOf({ myMember: member('A', published), draftSelection: ['uid:1001', 'uid:2002'], publishPreview: {
      resource: null, diff: null, missingAccountKeys: ['uid:2002'], error: '缺少本地数据',
    } });
    const { rerender } = render(<MotherResourceEditor hook={hook} snapshots={snapshots} species={catalog} />);
    const missing = screen.getByTestId('mother-account-uid:2002');
    expect(missing).toHaveTextContent('本机无数据');
    fireEvent.click(missing);
    expect(hook.setDraftSelection).toHaveBeenLastCalledWith(['uid:1001']);
    rerender(<MotherResourceEditor hook={{ ...hook, draftSelection: ['uid:1001'] }} snapshots={snapshots} species={catalog} />);
    fireEvent.click(screen.getByTestId('mother-account-uid:2002'));
    expect(hook.setDraftSelection).toHaveBeenLastCalledWith(['uid:1001', 'uid:2002']);
  });

  test('本机完全无数据时仍能明确撤回所有已共享账号', () => {
    const hook = hookOf({ draftSelection: ['uid:1001'] });
    render(<MotherResourceEditor hook={hook} snapshots={[]} species={catalog} />);
    fireEvent.click(screen.getByTestId('mother-account-uid:1001'));
    expect(hook.setDraftSelection).toHaveBeenCalledWith([]);
  });

  test('勾选账号只改本地草稿；预览显示新增/移除', () => {
    const hook = hookOf({ draftSelection: [], publishPreview: { resource: null, diff: null, missingAccountKeys: [], error: '' } });
    render(<MotherResourceEditor hook={hook} snapshots={snapshots} species={catalog} />);

    fireEvent.click(screen.getByTestId('mother-account-uid:1001'));
    expect(hook.setDraftSelection).toHaveBeenCalledWith(['uid:1001']);
  });

  test('发布调用 hook.publish，成功后给出提示', async () => {
    const hook = hookOf();
    render(<MotherResourceEditor hook={hook} snapshots={snapshots} species={catalog} />);

    fireEvent.click(screen.getByTestId('mother-publish'));
    await waitFor(() => expect(hook.publish).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('mother-editor-message')).toHaveTextContent('已更新');
  });

  test('选号清空且已发布时，二次确认后停止共享', async () => {
    const hook = hookOf({ draftSelection: [], publishPreview: { resource: null, diff: null, missingAccountKeys: [], error: '' } });
    render(<MotherResourceEditor hook={hook} snapshots={snapshots} species={catalog} />);

    fireEvent.click(screen.getByTestId('mother-stop-sharing'));
    await waitFor(() => expect(hook.stopSharing).toHaveBeenCalledTimes(1));
    expect(window.confirm).toHaveBeenCalled();
  });

  test('本机缺少服务器记录的账号时禁止发布', () => {
    const hook = hookOf({
      draftSelection: ['uid:2002'],
      publishPreview: {
        resource: null,
        diff: null,
        missingAccountKeys: ['uid:2002'],
        error: '本机缺少这些账号的数据：先导入或云同步，或在选号里撤回',
      },
    });
    render(<MotherResourceEditor hook={hook} snapshots={snapshots} species={catalog} />);

    expect(screen.getByTestId('mother-missing-accounts')).toHaveTextContent('uid:2002');
    expect(screen.getByTestId('mother-publish')).toBeDisabled();
  });

  test('本地数据变化但选号未改时提示更新', () => {
    render(<MotherResourceEditor hook={hookOf()} snapshots={snapshots} species={catalog} />);
    expect(screen.getByTestId('mother-local-changed')).toHaveTextContent('本地数据有变化');
    expect(screen.getByTestId('mother-preview-diff')).toHaveTextContent('新增 1 种');
  });
});
