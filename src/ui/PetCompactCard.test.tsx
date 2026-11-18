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
  test('家园与需求中心复用统一的 160×98 卡片和 44px 居中头像', () => {
    render(<PetCompactCard {...base} variant="home" />);
    const home = screen.getByTestId('pet-compact-card');
    expect(home.className).toContain('w-[160px]');
    expect(home.className).toContain('h-[98px]');
    expect(screen.getByTestId('pet-card-avatar')).toHaveClass('left-1/2', 'top-1/2');
    expect(screen.getByTestId('pet-avatar').className).toContain('h-11');
    expect(screen.getByTestId('pet-avatar').parentElement).toHaveClass('items-center', 'justify-center');
    expect(screen.getByRole('heading', { level: 3 })).toHaveClass('text-[6px]');

    cleanup();
    render(<PetCompactCard {...base} variant="demand" />);
    const demand = screen.getByTestId('pet-compact-card');
    expect(demand.className).toContain('w-[160px]');
    expect(demand.className).toContain('h-[98px]');
    expect(screen.getByTestId('pet-avatar').className).toContain('h-11');
  });

  test('编号与蛋组纵向显示在左上角，性格纵向显示在右上角', () => {
    render(
      <PetCompactCard
        {...base}
        number="123"
        eggGroups={[6, 9]}
      />,
    );
    expect(screen.getByText('No.123')).toBeInTheDocument();
    expect(screen.getByTestId('pet-card-egg-groups')).toHaveClass('flex-col');
    expect(screen.getByTestId('pet-card-natures')).toHaveClass('flex-col', 'items-end');
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

  test('身高 / 体重去掉多余的末尾零，缺数据写 —', () => {
    render(<PetCompactCard {...base} heightPercent={50} weightPercent={99.5} />);
    expect(screen.getByTestId('pet-compact-card')).toHaveTextContent('50%');
    expect(screen.getByTestId('pet-compact-card')).toHaveTextContent('99.5%');

    cleanup();
    render(<PetCompactCard {...base} voiceDb={100} heightPercent={null} weightPercent={undefined} />);
    expect(screen.getByTestId('pet-compact-card')).toHaveTextContent('100dB · — · —');
  });

  test('统一布局可完整显示六字名字，性格位于右上角', () => {
    render(<PetCompactCard {...base} name="睡铃雪影娃娃" />);
    const name = screen.getByText('睡铃雪影娃娃');
    expect(name).toHaveAttribute('title', '睡铃雪影娃娃');
    expect(name.tagName.toLowerCase()).toBe('h3');
    expect(screen.getByTestId('pet-card-natures')).toHaveClass('items-end');
  });

  test('多形态只显示基础名，完整名字放 title', () => {
    render(<PetCompactCard {...base} name="雪绒鸟_夏天的样子" />);
    const name = screen.getByText('雪绒鸟');
    expect(name).toHaveAttribute('title', '雪绒鸟_夏天的样子');
    expect(name).not.toHaveTextContent('夏天的样子');
  });
});
