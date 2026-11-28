import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { OwnedPet, SpeciesEntry } from '../domain/types';
import { PetList } from './PetList';

// 全量并行跑时 jsdom 的 setTimeout(0) 会被拖慢，waitFor 默认 1s 偶发超时；
// 这里把等待上限抬到 3s —— 只放宽等待，不放宽任何断言（2026-11-28）。
configure({ asyncUtilTimeout: 3000 });

// 分批追加拿的是 requestIdleCallback（没有就退回 setTimeout(0)）：全量并行时两者都可能被
// 拖到几百毫秒，500 只 × 20 一批就会把 waitFor 顶掉。测试里让 rIC **同步**执行，
// 追加变成确定性的，测的还是「触底会不会继续加载」这件事本身（2026-11-28）。
beforeEach(() => {
  vi.stubGlobal('requestIdleCallback', (cb: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void) => {
    cb({ didTimeout: false, timeRemaining: () => 50 });
    return 1;
  });
  vi.stubGlobal('cancelIdleCallback', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});


const pets: OwnedPet[] = Array.from({ length: 21 }, (_, index): OwnedPet => ({
  gameId: index + 1,
  name: `精灵${index + 1}`,
  gender: '母',
  nature: '开朗',
  voiceDb: 100,
  medalBody: '大块头',
  isShiny: false,
  account: '账号甲',
}));

const props = {
  pets,
  speciesByGameId: new Map<number, SpeciesEntry>(),
  eggGroupNames: {},
};

const manyPets: OwnedPet[] = Array.from({ length: 500 }, (_, index): OwnedPet => ({
  gameId: index + 1,
  name: `精灵${index + 1}`,
  gender: '母',
  nature: '开朗',
  voiceDb: 100,
  medalBody: '大块头',
  isShiny: false,
  account: '账号甲',
}));

/** 可手动触发的 IntersectionObserver mock（模拟横屏内部容器滚动场景） */
function stubIntersectionObserver() {
  type Pending = { target: Element; notify: (entry: Partial<IntersectionObserverEntry>) => void };
  const pending: Pending[] = [];
  class MockIntersectionObserver {
    private readonly callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback) { this.callback = callback; }
    observe(target: Element) {
      pending.push({
        target,
        notify: (entry) => this.callback(
          [{ ...entry, target } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        ),
      });
    }
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
    root = null;
    rootMargin = '';
    thresholds = [];
  }
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  return pending;
}

describe('PetList（全部展示，不分页）', () => {
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage');

  beforeEach(() => {
    // 部分安卓 WebView（隐私模式 / 关存储）访问 window.localStorage 直接抛 SecurityError
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('SecurityError: storage is disabled');
      },
      configurable: true,
    });
  });

  afterEach(() => {
    if (original) Object.defineProperty(window, 'localStorage', original);
    vi.unstubAllGlobals();
  });

  test('不访问 localStorage，首屏展示首批精灵，其余等空闲追加', () => {
    render(<PetList {...props} />);
    expect(screen.getByTestId('pet-count')).toHaveTextContent('共 21 只');
    expect(screen.getAllByRole('article')).toHaveLength(20);
    expect(screen.queryByText('上一页')).toBeNull();
    expect(screen.queryByText('下一页')).toBeNull();
    expect(screen.queryByText(/每页/)).toBeNull();
  });

  test('收起筛选后可以排到六列以上（卡片宽度不变，只多排几张）', () => {
    render(<PetList {...props} columns={9} />);
    const list = screen.getByTestId('pet-list-items');
    expect(list).toHaveAttribute('data-columns', '9');
    expect(list.style.gridTemplateColumns).toBe('repeat(9, minmax(0, 1fr))');
    expect(screen.getAllByRole('article')).toHaveLength(20);
  });

  test('少于首屏阈值的精灵一次全部展示，不显示「继续加载」', () => {
    const few: OwnedPet[] = pets.slice(0, 10);
    render(<PetList {...props} pets={few} />);
    expect(screen.getAllByRole('article')).toHaveLength(10);
    expect(screen.queryByTestId('pet-list-more')).toBeNull();
  });

  test('500 只：window scroll 兜底路径（无 IntersectionObserver 时）仍可加载更多', async () => {
    // jsdom 默认没有 IntersectionObserver，走 window scroll 兜底
    render(<PetList {...props} pets={manyPets} />);

    expect(screen.getAllByRole('article')).toHaveLength(20);
    expect(screen.getByTestId('pet-list-more')).toHaveTextContent('已显示 20 / 500 只');

    fireEvent.scroll(window);
    await waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(40);
    });
    expect(screen.getByTestId('pet-list-more')).toHaveTextContent('已显示 40 / 500 只');

    fireEvent.scroll(window);
    await waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(60);
    });
    expect(screen.getByTestId('pet-list-more')).toHaveTextContent('已显示 60 / 500 只');
    expect(screen.queryByText('上一页')).toBeNull();
  });

  test('500 只：IntersectionObserver 哨兵触底（横屏内部容器滚动）也能加载更多', async () => {
    const pending = stubIntersectionObserver();
    render(<PetList {...props} pets={manyPets} />);

    expect(screen.getAllByRole('article')).toHaveLength(20);
    expect(screen.getByTestId('pet-list-more')).toHaveTextContent('已显示 20 / 500 只');
    // PetAvatar 也用 IntersectionObserver，哨兵是唯一的 div（aria-hidden），头像都是 img
    const sentinel = pending.find((p) => p.target instanceof HTMLDivElement);
    expect(sentinel).toBeDefined();

    // 模拟横屏：window 不滚，但内部容器滚动让哨兵进入视口
    act(() => sentinel!.notify({ isIntersecting: true }));
    await waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(40);
    });
    expect(screen.getByTestId('pet-list-more')).toHaveTextContent('已显示 40 / 500 只');

    act(() => sentinel!.notify({ isIntersecting: true }));
    await waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(60);
    });
  });
});
