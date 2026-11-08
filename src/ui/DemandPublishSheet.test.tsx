import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { DemandPublishSheet, type WishEggOption } from './DemandPublishSheet';

/** 选蛋弹层的全图鉴（含我没有的蛋）。 */
const catalog: WishEggOption[] = [
  { eggGameId: 3001, name: '喵喵', keywords: '喵喵 3001' },
  { eggGameId: 3008, name: '草头鸭', keywords: '草头鸭 3008' },
  { eggGameId: 3011, name: '恶魔狼', keywords: '恶魔狼 3011' },
];

const base = {
  open: true,
  items: [],
  catalog,
  gapEggIds: [3008],
  onClose: () => {},
  onConfirm: () => {},
};

describe('添加想收（wish 模式）', () => {
  test('只看缺口默认开，关掉能看全图鉴（含我已有的蛋）', () => {
    render(<DemandPublishSheet {...base} mode="wish" onAddWish={() => {}} />);
    expect(screen.getByTestId('wish-only-gaps').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('wish-egg-3008')).toBeTruthy();
    expect(screen.queryByTestId('wish-egg-3001')).toBeNull();

    fireEvent.click(screen.getByTestId('wish-only-gaps'));
    expect(screen.getByTestId('wish-egg-3001')).toBeTruthy();
    expect(screen.getByTestId('wish-egg-3011')).toBeTruthy();
  });

  test('多选后主按钮是「添加 N 条想收」，父组件重渲染不清空已选', () => {
    const onAddWish = vi.fn();
    const { rerender } = render(
      <DemandPublishSheet {...base} mode="wish" onAddWish={onAddWish} />,
    );
    fireEvent.click(screen.getByTestId('wish-only-gaps'));
    fireEvent.click(screen.getByTestId('wish-egg-3001'));
    fireEvent.click(screen.getByTestId('wish-egg-3011'));

    // 父组件刷新时 items 常是新的空数组，不能把已经勾好的蛋清掉
    rerender(<DemandPublishSheet {...base} items={[]} mode="wish" onAddWish={onAddWish} />);
    const confirm = screen.getByTestId('demand-publish-confirm');
    expect(confirm.textContent).toContain('添加 2 条想收');

    fireEvent.click(confirm);
    expect(onAddWish).toHaveBeenCalledWith([3001, 3011]);
  });

  test('快捷按钮「按你的口径算的全部缺口」把缺口一次选中', () => {
    const onAddWish = vi.fn();
    render(<DemandPublishSheet {...base} mode="wish" onAddWish={onAddWish} />);
    fireEvent.click(screen.getByTestId('wish-fill-gaps'));
    const confirm = screen.getByTestId('demand-publish-confirm');
    expect(confirm.textContent).toContain('添加 1 条想收');
    fireEvent.click(confirm);
    expect(onAddWish).toHaveBeenCalledWith([3008]);
  });

  test('搜索按蛋名 / 蛋搜索索引命中', () => {
    render(<DemandPublishSheet {...base} mode="wish" onAddWish={() => {}} />);
    fireEvent.click(screen.getByTestId('wish-only-gaps'));
    fireEvent.change(screen.getByTestId('wish-search'), { target: { value: '恶魔' } });
    expect(screen.getByTestId('wish-egg-3011')).toBeTruthy();
    expect(screen.queryByTestId('wish-egg-3001')).toBeNull();
  });
});
