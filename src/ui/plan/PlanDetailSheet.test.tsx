import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { CollectionPlanView } from '../../api/collectionGroups';
import type { SpeciesEntry } from '../../domain/types';
import { PlanDetailSheet } from './PlanDetailSheet';

const species = [{ gameId: 3006, eggGameId: 3006, name: '火神' }] as unknown as SpeciesEntry[];

const plan = (over: Partial<CollectionPlanView> = {}): CollectionPlanView => ({
  id: 'p1',
  groupId: 'g1',
  memberAccountId: 'me',
  eggGameId: 3006,
  note: '',
  status: 'backlog',
  version: 1,
  createdAt: 1_000,
  updatedAt: 1_000,
  memberDisplayName: '我',
  progressStep: 0,
  needsConfirm: false,
  demands: [],
  offers: [],
  ...over,
});

function renderSheet() {
  const onDelete = vi.fn();
  render(
    <PlanDetailSheet
      plan={plan()}
      species={species}
      members={[{ accountId: 'me', displayName: '我' }]}
      viewerAccountId="me"
      onClose={vi.fn()}
      onStart={vi.fn()}
      onComplete={vi.fn()}
      onDelete={onDelete}
      onSaveOffer={vi.fn()}
      onWithdrawOffer={vi.fn()}
      onPublishDemand={vi.fn()}
    />,
  );
  return { onDelete };
}

describe('删除计划', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('先出确认：取消不调接口，确认才删', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onDelete } = renderSheet();

    fireEvent.click(screen.getByTestId('plan-detail-more'));
    fireEvent.click(screen.getByTestId('plan-detail-delete'));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // 文案要说清后果，避免用户以为只删这张卡
    expect(String(confirmSpy.mock.calls[0][0])).toContain('认领');
    expect(String(confirmSpy.mock.calls[0][0])).toContain('不能恢复');
    expect(onDelete).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByTestId('plan-detail-more'));
    fireEvent.click(screen.getByTestId('plan-detail-delete'));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete.mock.calls[0][0]).toMatchObject({ id: 'p1' });
  });
});
