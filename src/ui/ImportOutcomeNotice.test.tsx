import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { completeCollectionDemand } from '../api/collectionGroups';
import { ImportOutcomeNotice } from './ImportOutcomeNotice';
import {
  beginImport,
  resetImportOutcomeForTest,
  updateImportOutcome,
} from './importOutcomeStore';
import { readLastGroupId } from './collectionGroupStore';
import type { PendingDemandClaim } from './groupAutoPublish';

vi.mock('../api/collectionGroups', () => ({ completeCollectionDemand: vi.fn() }));

beforeEach(() => {
  resetImportOutcomeForTest();
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(completeCollectionDemand).mockResolvedValue(undefined as never);
});

const claim: PendingDemandClaim = {
  groupId: 'g1',
  groupName: '周末互换',
  accountId: 'acc',
  count: 2,
  claimers: ['阿乙'],
  items: [
    {
      eggGameId: 101,
      eggName: '火花',
      nature: '固执',
      gender: '母',
      body: '大块头',
      voice: '+100',
      claimerAccountId: 'B',
      claimerName: '阿乙',
      version: 1,
    },
    {
      eggGameId: 201,
      eggName: '水蓝蓝',
      nature: '',
      gender: '公',
      body: '',
      voice: '',
      claimerAccountId: 'B',
      claimerName: '阿乙',
      version: 2,
    },
  ],
};

const withClaims = (claims: PendingDemandClaim[]) => {
  act(() => {
    const operationId = beginImport();
    updateImportOutcome(operationId, { local: 'saved', claims });
  });
};

describe('ImportOutcomeNotice 待结单提醒', () => {
  test('有人接了我的需求时列出具体单，并能跳到该组的需求中心', () => {
    const onOpenGroups = vi.fn();
    withClaims([claim]);

    render(<ImportOutcomeNotice onOpenGroups={onOpenGroups} />);
    const notice = screen.getByTestId('import-outcome-claims');
    expect(notice).toHaveTextContent('阿乙接了你 2 单，可以结单了');
    expect(notice).toHaveTextContent('火花 · 固执');
    expect(notice).toHaveTextContent('水蓝蓝');
    expect(notice).toHaveTextContent('阿乙 接的');

    fireEvent.click(screen.getByTestId('import-outcome-open-claims'));
    expect(onOpenGroups).toHaveBeenCalledTimes(1);
    expect(readLastGroupId('acc', 'mother')).toBe('g1');
  });

  test('一键结单：逐条确认完成，成功后提醒消失', async () => {
    withClaims([claim]);
    render(<ImportOutcomeNotice onOpenGroups={vi.fn()} />);

    fireEvent.click(screen.getByTestId('import-outcome-complete-all'));
    await waitFor(() => expect(completeCollectionDemand).toHaveBeenCalledTimes(2));
    expect(completeCollectionDemand).toHaveBeenCalledWith('g1', {
      demanderAccountId: 'acc',
      eggGameId: 101,
      nature: '固执',
      gender: '母',
      body: '大块头',
      voice: '+100',
      version: 1,
    });
    expect(completeCollectionDemand).toHaveBeenCalledWith('g1', {
      demanderAccountId: 'acc',
      eggGameId: 201,
      nature: '',
      gender: '公',
      body: '',
      voice: '',
      version: 2,
    });
    await waitFor(() =>
      expect(screen.getByTestId('import-outcome-claims-done')).toHaveTextContent('已结单 2 单'),
    );
    expect(screen.queryByTestId('import-outcome-claims')).toBeNull();
  });

  test('部分失败时保留没结成功的单', async () => {
    vi.mocked(completeCollectionDemand)
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error('网络失败'));
    withClaims([claim]);
    render(<ImportOutcomeNotice onOpenGroups={vi.fn()} />);

    fireEvent.click(screen.getByTestId('import-outcome-complete-all'));
    await waitFor(() =>
      expect(screen.getByTestId('import-outcome-claims-error')).toHaveTextContent(
        '还有 1 单没结成功',
      ),
    );
    const notice = screen.getByTestId('import-outcome-claims');
    expect(notice).not.toHaveTextContent('火花');
    expect(notice).toHaveTextContent('水蓝蓝');
    expect(screen.getByTestId('import-outcome-claims-done')).toHaveTextContent('已结单 1 单');
  });

  test('没有待结单时不出现提醒', () => {
    withClaims([]);
    render(<ImportOutcomeNotice onOpenGroups={vi.fn()} />);
    expect(screen.queryByTestId('import-outcome-claims')).toBeNull();
  });
});
