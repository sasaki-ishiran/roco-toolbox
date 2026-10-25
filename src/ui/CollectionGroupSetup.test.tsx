import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { CollectionGroupSetup } from './CollectionGroupSetup';

const preview = {
  name: '种公互助',
  groupType: 'stud' as const,
  targetRevision: 1,
  targetReady: true,
  target: {
    kind: 'stud' as const,
    mode: 'perfect' as const,
    catalogVersion: 'v1',
    slots: [{ groupId: 2, natureId: 11, natureName: '开朗', grade: '大婉' as const }],
  },
};

describe('CollectionGroupSetup（二期）', () => {
  test('新建时先选类型，提交带类型', async () => {
    const onCreate = vi.fn().mockResolvedValue({ groupId: 'g1' });
    render(
      <CollectionGroupSetup onCreate={onCreate} onJoin={vi.fn()} preflightInvite={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('group-type-stud'));
    fireEvent.change(screen.getByTestId('group-setup-nickname'), { target: { value: '阿甲' } });
    fireEvent.change(screen.getByTestId('group-setup-group-name'), { target: { value: '种公组' } });
    fireEvent.click(screen.getByTestId('group-create-submit'));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith('种公组', '阿甲', 'stud', {
        requireRecommendedNatures: false,
      }),
    );
  });

  test('母本组创建时可以要求推荐性格', async () => {
    const onCreate = vi.fn().mockResolvedValue({ groupId: 'g1' });
    render(
      <CollectionGroupSetup onCreate={onCreate} onJoin={vi.fn()} preflightInvite={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('group-create-require-natures'));
    fireEvent.change(screen.getByTestId('group-setup-nickname'), { target: { value: '阿甲' } });
    fireEvent.change(screen.getByTestId('group-setup-group-name'), { target: { value: '母本组' } });
    fireEvent.click(screen.getByTestId('group-create-submit'));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith('母本组', '阿甲', 'mother', {
        requireRecommendedNatures: true,
      }),
    );
  });

  test('加入前先展示组名、类型与目标，确认后才提交', async () => {
    const preflightInvite = vi.fn().mockResolvedValue(preview);
    const onJoin = vi.fn().mockResolvedValue({ groupId: 'g1', groupType: 'stud' });
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
    await waitFor(() => expect(screen.getByTestId('group-join-confirm')).toHaveTextContent('种公互助'));
    expect(screen.getByTestId('group-join-confirm')).toHaveTextContent('种公收集');
    expect(screen.getByTestId('group-join-confirm')).toHaveTextContent('1 个槽位');
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
