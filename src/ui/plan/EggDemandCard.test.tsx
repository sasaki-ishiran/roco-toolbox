import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { createDemand } from '../../shared/eggMatching';
import { EggDemandCard } from './EggDemandCard';

const demand = createDemand({ id: 'd1', groupId: 'g1', demanderAccountId: 'me',
  eggGameId: 3227, natures: ['固执', '保守'], body: '大块头', voice: '婉转声', quantity: 2 });

test('demand card shows species name, all natures, project medals and one primary click', () => {
  const open = vi.fn();
  render(<EggDemandCard demand={demand} name="菊花梨" statusLabel="有匹配" onOpen={open} />);
  const card = screen.getByRole('button');
  expect(screen.getByText('菊花梨')).toBeTruthy();
  expect(screen.queryByText('菊花梨蛋')).toBeNull();
  expect(screen.getByText('固执 / 保守')).toBeTruthy();
  expect(screen.getByText('已收 0/2')).toBeTruthy();
  expect(screen.getByAltText('大块头')).toHaveAttribute('src', expect.stringContaining('1001'));
  expect(screen.getByAltText('婉转声')).toHaveAttribute('src', expect.stringContaining('1026'));
  fireEvent.click(card);
  expect(open).toHaveBeenCalledWith(demand);
  expect(card.querySelector('button')).toBeNull();
});

test('group card names its owner; omitted criteria leave no duplicate explanations', () => {
  render(<EggDemandCard demand={{ ...demand, body: '', voice: '' }} name="菊花梨" ownerLabel="小满" statusLabel="我能提供" onOpen={() => {}} />);
  expect(screen.getByText('小满 · 已收 0/2')).toBeTruthy();
  expect(screen.queryByText(/性别|不作为条件|不挑体型/)).toBeNull();
});
