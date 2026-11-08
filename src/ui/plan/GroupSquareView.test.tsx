import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { CollectionPlansResponse, CollectionPlanView } from '../../api/collectionGroups';
import type { SpeciesEntry } from '../../domain/types';
import { GroupSquareView } from './GroupSquareView';

const species = [
  { gameId: 3001, eggGameId: 3001, name: '喵喵' },
  { gameId: 3006, eggGameId: 3006, name: '火神' },
  { gameId: 3008, eggGameId: 3008, name: '草头鸭' },
] as unknown as SpeciesEntry[];

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

/** 我自己的想收（火神，较旧）+ 阿乙的想收（草头鸭，较新）+ 阿乙一条待接单的需求。 */
const data = (plans: CollectionPlanView[]): CollectionPlansResponse => ({
  plans,
  members: [
    { accountId: 'me', displayName: '我' },
    { accountId: 'B', displayName: '阿乙' },
  ],
  matchableEggIds: [3008],
  myActiveCount: 0,
});

const backlogMine = plan({ id: 'wish-mine', eggGameId: 3006, createdAt: 1_000 });
const backlogOther = plan({
  id: 'wish-other',
  memberAccountId: 'B',
  eggGameId: 3008,
  createdAt: 2_000,
});
const activeOther = plan({
  id: 'active-other',
  memberAccountId: 'B',
  eggGameId: 3001,
  status: 'active',
  progressStep: 1,
  demands: [
    {
      nature: '固执',
      gender: '母',
      body: '大块头',
      voice: '+100',
      status: 'open',
      claimerAccountId: null,
      placedAt: null,
    },
  ],
});

const renderSquare = (plans: CollectionPlanView[], onAction = vi.fn()) => {
  render(
    <GroupSquareView
      viewerAccountId="me"
      data={data(plans)}
      loading={false}
      error={null}
      busy={false}
      species={species}
      onOpenPlan={() => {}}
      onAction={onAction}
    />,
  );
  return onAction;
};

const cardOf = (container: HTMLElement, name: string) =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-testid="plan-card"]')).find((card) =>
    card.textContent?.includes(name),
  );

describe('组内广场「组员在收」', () => {
  test('想收计划进「组员在收」，不进「你能接的」；按创建时间倒序', () => {
    renderSquare([activeOther, backlogMine, backlogOther]);

    const wish = screen.getByTestId('group-square-wish');
    expect(wish.textContent).toContain('组员在收');
    const cards = wish.querySelectorAll('[data-testid="plan-card"]');
    expect(cards).toHaveLength(2);
    // 阿乙的想收创建更晚，排前面
    expect(cards[0].textContent).toContain('草头鸭');
    expect(cards[1].textContent).toContain('火神');
    // 卡面第二行只写事实
    expect(wish.textContent).toContain('想收 · 还没发需求');

    const canTake = screen.getByTestId('group-square-can-take');
    expect(canTake.textContent).toContain('喵喵');
    expect(canTake.textContent).not.toContain('草头鸭');
    expect(canTake.textContent).not.toContain('火神');
  });

  test('别人的想收动作是「我可提供」并走备注，不是接单；自己的想收不出现可提供', () => {
    const onAction = renderSquare([activeOther, backlogMine, backlogOther]);
    const wish = screen.getByTestId('group-square-wish');

    const otherCard = cardOf(wish, '草头鸭')!;
    const otherAction = otherCard.querySelector<HTMLElement>(
      '[data-testid="plan-card-action"]',
    )!;
    expect(otherAction.textContent).toBe('我可提供');
    expect(otherAction.dataset.action).toBe('offer');

    const mineCard = cardOf(wish, '火神')!;
    const mineAction = mineCard.querySelector<HTMLElement>('[data-testid="plan-card-action"]')!;
    expect(mineAction.textContent).toBe('开始');
    expect(mineAction.dataset.action).not.toBe('offer');

    fireEvent.click(otherAction);
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wish-other' }),
      'offer',
    );
  });

  test('没有想收计划时整块不渲染，不留空标题', () => {
    renderSquare([activeOther]);
    expect(screen.queryByTestId('group-square-wish')).toBeNull();
  });
});
