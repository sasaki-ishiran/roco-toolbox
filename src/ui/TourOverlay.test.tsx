import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  TOUR_HINT_STEP_ID,
  TOUR_SEGMENT_ORDER,
  TOUR_SEGMENTS,
  TOUR_VERSION,
  markSegmentSeen,
  migrateLegacyTourSeen,
  segmentPending,
  startTourPending,
} from './tour';
import { TourOverlay } from './TourOverlay';

describe('新手引导', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '';
  });

  test('首启只看「先导入一次」；分段已读按版本号记', () => {
    expect(startTourPending()).toBe(true);
    expect(segmentPending('dashboard')).toBe(true);

    markSegmentSeen('start');
    expect(startTourPending()).toBe(false);
    expect(segmentPending('start')).toBe(false);
    expect(segmentPending('dashboard')).toBe(true);

    window.localStorage.setItem('roco.tourSeen.start', '1');
    expect(startTourPending()).toBe(true);
    expect(TOUR_VERSION).not.toBe('1');
  });

  test('老用户迁移：重弹首启主线，分页不再自动弹', () => {
    window.localStorage.setItem('roco.tourSeen', '1');
    migrateLegacyTourSeen();

    expect(startTourPending()).toBe(true);
    for (const segment of TOUR_SEGMENT_ORDER) {
      if (segment === 'start') continue;
      expect(segmentPending(segment)).toBe(false);
    }
  });

  test('分段覆盖：首启讲导入，其余按页签各一段；只有首启带「重看引导」收尾', () => {
    expect(TOUR_SEGMENT_ORDER).toEqual([
      'start',
      'dashboard',
      'collection',
      'nearby',
      'groups',
      'home',
      'profile',
    ]);
    const startTitles = TOUR_SEGMENTS.start.map((step) => step.title).join('|');
    expect(startTitles).toContain('采集');
    expect(startTitles).toContain('开始采集');
    expect(TOUR_SEGMENTS.start.some((step) => step.waitForImport)).toBe(true);

    expect(TOUR_SEGMENTS.dashboard.map((step) => step.title).join('|')).toContain('目标档位');
    expect(TOUR_SEGMENTS.collection.map((step) => step.title).join('|')).toContain('覆盖度');
    expect(TOUR_SEGMENTS.collection.map((step) => step.title).join('|')).toContain('母本全收集');
    expect(TOUR_SEGMENTS.nearby.map((step) => step.title).join('|')).toContain('雷达');
    expect(TOUR_SEGMENTS.groups.map((step) => step.title).join('|')).toContain('需求中心');
    expect(TOUR_SEGMENTS.home.map((step) => step.title).join('|')).toContain('接单上窝');
    expect(TOUR_SEGMENTS.profile.map((step) => step.title).join('|')).toContain('云同步');

    const startSteps = TOUR_SEGMENTS.start;
    expect(startSteps[startSteps.length - 1].id).toBe(TOUR_HINT_STEP_ID);
    expect(startSteps[startSteps.length - 1].anchor).toBe('guide-open');

    // 其余分段：收尾提示只留在一处，避免每页重复「随时点顶部教程」
    for (const segment of TOUR_SEGMENT_ORDER) {
      if (segment === 'start') continue;
      expect(TOUR_SEGMENTS[segment].some((step) => step.hint === true)).toBe(false);
    }
  });

  test('下一步 / 上一步 / 最后一步收尾', () => {
    const steps = TOUR_SEGMENTS.start;
    const onClose = vi.fn();
    render(<TourOverlay steps={steps} onClose={onClose} importReady />);

    expect(screen.getByTestId('tour-progress')).toHaveTextContent(`1 / ${steps.length}`);
    fireEvent.click(screen.getByTestId('tour-next'));
    expect(screen.getByTestId('tour-progress')).toHaveTextContent('2 /');
    fireEvent.click(screen.getByTestId('tour-prev'));
    expect(screen.getByTestId('tour-progress')).toHaveTextContent('1 /');

    for (let guard = 0; guard < steps.length && !screen.queryByTestId('tour-done'); guard += 1) {
      fireEvent.click(screen.getByTestId('tour-next'));
    }
    expect(screen.getByTestId('tour-done')).toHaveTextContent('知道了');
    fireEvent.click(screen.getByTestId('tour-done'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('带收尾提示的分段：点「跳过」先给出「教程」入口提示，再点一次才关闭', () => {
    const onClose = vi.fn();
    render(<TourOverlay steps={TOUR_SEGMENTS.start} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('tour-skip'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('tour-title')).toHaveTextContent('随时能重看引导');

    fireEvent.click(screen.getByTestId('tour-skip'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('没有收尾提示的分段：点「跳过」直接关闭', () => {
    const onClose = vi.fn();
    render(<TourOverlay steps={TOUR_SEGMENTS.dashboard} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('tour-skip'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('等导入那步：没数据不能下一步，导入成功后自动继续', async () => {
    const steps = [
      { id: 'import', title: '先导入一次', body: '导入后自动继续', waitForImport: true },
      { id: TOUR_HINT_STEP_ID, title: '随时能重看引导', body: '点教程重看', hint: true },
    ];
    const onClose = vi.fn();
    const { rerender } = render(<TourOverlay steps={steps} onClose={onClose} importReady={false} />);

    expect(screen.getByTestId('tour-next')).toBeDisabled();
    expect(screen.getByTestId('tour-wait')).toBeTruthy();

    rerender(<TourOverlay steps={steps} onClose={onClose} importReady />);
    await waitFor(
      () => expect(screen.getByTestId('tour-title')).toHaveTextContent('随时能重看引导'),
      { timeout: 3000 },
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  test('本来就有数据时重看：不抢跳，等用户点下一步', () => {
    const steps = [
      { id: 'import', title: '先导入一次', body: '已经有数据', waitForImport: true },
      { id: TOUR_HINT_STEP_ID, title: '随时能重看引导', body: '点教程重看', hint: true },
    ];
    render(<TourOverlay steps={steps} onClose={() => {}} importReady />);

    expect(screen.getByTestId('tour-next')).toBeEnabled();
    expect(screen.getByTestId('tour-title')).toHaveTextContent('先导入一次');
  });

  test('找到锚点时画聚光方框；找不到时退化成居中说明卡', async () => {
    const anchor = document.createElement('div');
    anchor.setAttribute('data-tour', 'known-anchor');
    document.body.appendChild(anchor);

    const steps = [
      { id: 'a', title: '有锚点', body: '高亮真实控件', anchor: 'known-anchor' },
      { id: 'b', title: '没锚点', body: '退化成居中卡', anchor: 'missing-anchor' },
    ];
    render(<TourOverlay steps={steps} onClose={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('tour-spotlight')).toBeTruthy());
    expect(screen.getByTestId('tour-title')).toHaveTextContent('有锚点');

    fireEvent.click(screen.getByTestId('tour-next'));
    await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('没锚点'));
    expect(screen.queryByTestId('tour-spotlight')).toBeNull();
    expect(screen.getByTestId('tour-card')).toBeTruthy();
  });

  test('目标中途被移除后退回居中卡，不再画到空位置', async () => {
    const anchor = document.createElement('div');
    anchor.setAttribute('data-tour', 'vanish-anchor');
    document.body.appendChild(anchor);

    render(
      <TourOverlay steps={[{ id: 'a', title: '有锚点', body: '高亮真实控件', anchor: 'vanish-anchor' }]} onClose={() => {}} />,
    );
    await waitFor(() => expect(screen.getByTestId('tour-spotlight')).toBeTruthy());

    anchor.remove();
    await waitFor(() => expect(screen.queryByTestId('tour-spotlight')).toBeNull(), { timeout: 2000 });
    expect(screen.getByTestId('tour-card')).toBeTruthy();
  });

  test('目标滑到屏幕外时，说明卡仍留在屏幕内', async () => {
    const anchor = document.createElement('div');
    anchor.setAttribute('data-tour', 'offscreen-anchor');
    anchor.getBoundingClientRect = () =>
      ({ top: -220, bottom: -170, left: 0, right: 100, width: 100, height: 50, x: 0, y: -220 }) as DOMRect;
    document.body.appendChild(anchor);

    render(
      <TourOverlay steps={[{ id: 'a', title: '离屏', body: '目标已经滑出屏幕', anchor: 'offscreen-anchor' }]} onClose={() => {}} />,
    );
    await waitFor(() => expect(screen.getByTestId('tour-spotlight')).toBeTruthy());

    const card = screen.getByTestId('tour-card');
    expect(Number.parseFloat(card.style.top)).toBeGreaterThanOrEqual(12);
  });

  test('打开时焦点落在卡片上，Esc 可关闭', () => {
    const onClose = vi.fn();
    render(<TourOverlay steps={TOUR_SEGMENTS.dashboard} onClose={onClose} />);

    expect(document.activeElement).toBe(screen.getByTestId('tour-card'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('进入每一步都会通知 App 切页面', () => {
    const onEnter = vi.fn();
    const steps = TOUR_SEGMENTS.dashboard;
    render(<TourOverlay steps={steps} onClose={() => {}} onEnter={onEnter} />);
    expect(onEnter).toHaveBeenCalledWith(steps[0]);
    fireEvent.click(screen.getByTestId('tour-next'));
    expect(onEnter).toHaveBeenCalledWith(steps[1]);
  });
});
