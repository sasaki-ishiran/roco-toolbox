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
