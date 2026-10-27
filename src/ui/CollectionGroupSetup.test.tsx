import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { CollectionGroupSetup } from './CollectionGroupSetup';

const preview = {
  name: '周末互换',
  groupType: 'mother' as const,
  targetRevision: 1,
  targetReady: true,
  target: {
    kind: 'mother' as const,
    mode: 'perfect' as const,
    bodies: ['大块头'],
    voices: ['+100'],
    catalogVersion: 'v1',
    criteriaId: 'female-huge-voice100-v2',
  },
};

describe('CollectionGroupSetup（二期）', () => {
  test('新建时不再选类型，固定创建收集小组', async () => {
    const onCreate = vi.fn().mockResolvedValue({ groupId: 'g1' });
    render(
      <CollectionGroupSetup onCreate={onCreate} onJoin={vi.fn()} preflightInvite={vi.fn()} />,
    );
    expect(screen.queryByTestId('group-type-options')).toBeNull();
    fireEvent.change(screen.getByTestId('group-setup-nickname'), { target: { value: '阿甲' } });
    fireEvent.change(screen.getByTestId('group-setup-group-name'), { target: { value: '周末互换' } });
    fireEvent.click(screen.getByTestId('group-create-submit'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('周末互换', '阿甲', 'mother'));
  });

  test('加入前先展示组名与本地筛选说明，确认后才提交', async () => {
    const preflightInvite = vi.fn().mockResolvedValue(preview);
    const onJoin = vi.fn().mockResolvedValue({ groupId: 'g1', groupType: 'mother' });
    render(
      <CollectionGroupSetup
        onCreate={vi.fn()}
        onJoin={onJoin}
        preflightInvite={preflightInvite}
        initialInviteCode="ABCD2345"
      />,
    );
    fireEvent.change(screen.getByTestId('group-setup-nickname'), { target: { value: '阿乙' } });
    fireEvent.click(screen.getByTestId('group-join-preview'));
    await waitFor(() => expect(screen.getByTestId('group-join-confirm')).toHaveTextContent('周末互换'));
    expect(screen.getByTestId('group-join-confirm')).toHaveTextContent('本地筛选');
    expect(onJoin).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('group-join-submit'));
    await waitFor(() => expect(onJoin).toHaveBeenCalledWith('ABCD2345', '阿乙'));
  });

  test('邀请码无效时展示错误，不进入确认态', async () => {
    const preflightInvite = vi.fn().mockRejectedValue(new Error('邀请码不对或小组已解散'));
    render(
      <CollectionGroupSetup
        onCreate={vi.fn()}
        onJoin={vi.fn()}
        preflightInvite={preflightInvite}
        initialInviteCode="ZZZZZZZZ"
      />,
    );
    fireEvent.change(screen.getByTestId('group-setup-nickname'), { target: { value: '阿乙' } });
    fireEvent.click(screen.getByTestId('group-join-preview'));
    await waitFor(() =>
      expect(screen.getByTestId('group-setup-error')).toHaveTextContent('邀请码不对'),
    );
    expect(screen.queryByTestId('group-join-confirm')).toBeNull();
  });
});
