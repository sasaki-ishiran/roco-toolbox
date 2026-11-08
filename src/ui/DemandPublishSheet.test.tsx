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

describe('发需求的「要求绿窝」开关', () => {
  const publishBase = {
    ...base,
    mode: 'publish' as const,
    items: [{ eggGameId: 3001, name: '喵喵', natures: ['固执'] }],
  };

  test('默认不要求绿窝，勾选后把 requireGreenNest 透传给父组件', () => {
    const onConfirm = vi.fn();
    render(<DemandPublishSheet {...publishBase} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByTestId('demand-publish-confirm'));
    expect(onConfirm.mock.calls[0][1]).toMatchObject({ requireGreenNest: false });

    fireEvent.click(
      screen.getByTestId('demand-green-nest').querySelector('input') as HTMLInputElement,
    );
    fireEvent.click(screen.getByTestId('demand-publish-confirm'));
    expect(onConfirm.mock.calls[1][1]).toMatchObject({ requireGreenNest: true });
  });

  test('一个性格都没选时不能勾绿窝发布', () => {
    render(<DemandPublishSheet {...publishBase} onConfirm={() => {}} />);
    // 取消默认勾选的性格 → 0 个性格
    fireEvent.click(screen.getByTestId('demand-nature-3001-固执'));
    fireEvent.click(
      screen.getByTestId('demand-green-nest').querySelector('input') as HTMLInputElement,
    );

    expect(screen.getByTestId('demand-green-nest-needs-nature')).toBeTruthy();
    expect(
      (screen.getByTestId('demand-publish-confirm') as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('发需求的草稿不被父组件刷新重置', () => {
  test('父组件轮询换新数组后，已选性别 / 已改性格仍保留', () => {
    const items = [{ eggGameId: 3001, name: '喵喵', natures: ['固执'] }];
    const { rerender } = render(
      <DemandPublishSheet {...base} mode="publish" items={items} />,
    );
    fireEvent.click(screen.getByTestId('demand-gender-公'));
    // 取消默认勾选的性格，模拟用户改口径
    fireEvent.click(screen.getByTestId('demand-nature-3001-固执'));

    // 父组件 30s 轮询刷新：内容相同但是新数组
    rerender(
      <DemandPublishSheet
        {...base}
        mode="publish"
        items={items.map((item) => ({ ...item, natures: [...item.natures] }))}
      />,
    );

    expect(screen.getByTestId('demand-gender-公').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('demand-nature-3001-固执').getAttribute('aria-pressed')).toBe(
      'false',
    );
  });
});

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
