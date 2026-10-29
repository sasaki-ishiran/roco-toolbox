import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { PetAvatar } from './PetAvatar';

const CDN = 'https://game.gtimg.cn/images/rocom/rocodata/jingling/3001';

describe('PetAvatar', () => {
  test('普通档取 icon.png', () => {
    render(<PetAvatar gameId={3001} name="喵喵" />);
    expect((screen.getByTestId('pet-avatar') as HTMLImageElement).src).toBe(`${CDN}/icon.png`);
  });

  test('异色档取 icon_yise.png', () => {
    render(<PetAvatar gameId={3001} name="喵喵" shiny />);
    expect((screen.getByTestId('pet-avatar') as HTMLImageElement).src).toBe(`${CDN}/icon_yise.png`);
  });

  test('异色图挂了先退回普通图，再挂才用首字占位', () => {
    render(<PetAvatar gameId={3001} name="喵喵" shiny />);
    fireEvent.error(screen.getByTestId('pet-avatar'));
    expect((screen.getByTestId('pet-avatar') as HTMLImageElement).src).toBe(`${CDN}/icon.png`);
    fireEvent.error(screen.getByTestId('pet-avatar'));
    expect(screen.getByTestId('pet-avatar-fallback').textContent).toBe('喵');
  });

  test('缺 gameId 时直接首字占位', () => {
    render(<PetAvatar gameId={null} name="喵喵" />);
    expect(screen.queryByTestId('pet-avatar')).toBeNull();
    expect(screen.getByTestId('pet-avatar-fallback').textContent).toBe('喵');
  });

  test('换成另一只精灵时重置兜底阶段，不沿用上一张的失败结果', () => {
    const view = render(<PetAvatar gameId={3001} name="喵喵" shiny />);
    fireEvent.error(screen.getByTestId('pet-avatar'));
    expect((screen.getByTestId('pet-avatar') as HTMLImageElement).src).toBe(`${CDN}/icon.png`);

    view.rerender(<PetAvatar gameId={3002} name="火花" shiny />);
    expect((screen.getByTestId('pet-avatar') as HTMLImageElement).src).toBe(
      'https://game.gtimg.cn/images/rocom/rocodata/jingling/3002/icon_yise.png',
    );
  });
});
