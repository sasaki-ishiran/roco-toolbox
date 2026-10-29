import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { PetCompactCard } from './PetCompactCard';

afterEach(cleanup);

const base = {
  gameId: 2201,
  name: '母本甲',
  gender: '母' as const,
  nature: '固执',
};

describe('紧凑精灵卡', () => {
  test('家园 160×115、需求中心 160×120', () => {
    render(<PetCompactCard {...base} variant="home" />);
    const home = screen.getByTestId('pet-compact-card');
    expect(home.className).toContain('w-[160px]');
    expect(home.className).toContain('h-[115px]');

    cleanup();
    render(<PetCompactCard {...base} variant="demand" />);
    const demand = screen.getByTestId('pet-compact-card');
    expect(demand.className).toContain('w-[160px]');
    expect(demand.className).toContain('h-[120px]');
  });

  test('footer 只在家园之外（需求中心）显示', () => {
    render(<PetCompactCard {...base} footer="测试甲 · 3-2" footerTestId="card-footer" />);
    expect(screen.queryByTestId('card-footer')).toBeNull();

    cleanup();
    render(
      <PetCompactCard
        {...base}
        variant="demand"
        roleLabel="母本"
        footer="测试甲 · 3-2"
        footerTestId="card-footer"
      />,
    );
    const footer = screen.getByTestId('card-footer');
    expect(footer).toHaveTextContent('母本 · 测试甲 · 3-2');
    expect(footer).toHaveAttribute('title', '母本 · 测试甲 · 3-2');
  });

  test('学院小窝整卡变绿并标记 academy', () => {
    render(<PetCompactCard {...base} academy />);
    const card = screen.getByTestId('pet-compact-card');
    expect(card).toHaveAttribute('data-academy', 'true');
    expect(card.className).toContain('border-emerald-300');
    expect(card.className).toContain('bg-emerald-50');
  });

  test('身高 / 体重保留两位小数，缺数据写 —', () => {
    render(<PetCompactCard {...base} heightPercent={50} weightPercent={99.5} />);
    expect(screen.getByText('50.00%')).toBeTruthy();
    expect(screen.getByText('99.50%')).toBeTruthy();

    cleanup();
    render(<PetCompactCard {...base} voiceDb={100} heightPercent={null} weightPercent={undefined} />);
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  test('多形态只显示基础名，完整名字放 title', () => {
    render(<PetCompactCard {...base} name="雪绒鸟_夏天的样子" />);
    const name = screen.getByText('雪绒鸟');
    expect(name).toHaveAttribute('title', '雪绒鸟_夏天的样子');
    expect(name).not.toHaveTextContent('夏天的样子');
  });
});
