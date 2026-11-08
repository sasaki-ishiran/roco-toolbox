import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { saveLastGroupId } from '../collectionGroupStore';
import { usePlanBadge } from './usePlanBadge';

const getCollectionPlans = vi.hoisted(() => vi.fn());

vi.mock('../../api/collectionGroups', () => ({ getCollectionPlans }));
vi.mock('../../api/session', () => ({
  readAccountId: () => 'acc1',
  subscribeSession: () => () => {},
}));

function Harness() {
  usePlanBadge();
  return null;
}

describe('页签红点跟随当前小组', () => {
  beforeEach(() => {
    window.localStorage.clear();
    getCollectionPlans.mockReset();
    getCollectionPlans.mockResolvedValue({ plans: [] });
  });

  afterEach(() => cleanup());

  test('切组后按新组重新拉取，不再按旧组算', async () => {
    saveLastGroupId('acc1', 'mother', 'g1');
    render(<Harness />);
    await waitFor(() => expect(getCollectionPlans).toHaveBeenCalledWith('g1', expect.anything()));

    act(() => {
      saveLastGroupId('acc1', 'mother', 'g2');
    });

    await waitFor(() => expect(getCollectionPlans).toHaveBeenCalledWith('g2', expect.anything()));
  });
});
