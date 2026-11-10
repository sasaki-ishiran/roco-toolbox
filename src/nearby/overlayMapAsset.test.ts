import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

/**
 * 悬浮窗地图页（安卓壳 assets）的行为测试。
 *
 * 这个页面没有打包步骤（壳直接 loadUrl file:///android_asset/overlay-map.html），
 * 改完只能靠真机看；用 jsdom 把它跑起来，至少保证：
 * 刷新只改 transform / 点位、不整段重建 DOM（之前每次 update 都 root.innerHTML 全量重写）。
 */
const html = readFileSync(
  resolve(process.cwd(), 'android-shell/app/src/main/assets/overlay-map.html'),
  'utf8',
);
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

interface MapApi {
  init: (json: unknown) => void;
  update: (json: unknown) => void;
}
const api = () => (window as unknown as { RocoOverlayMap: MapApi }).RocoOverlayMap;

const catalog = { coordinate_units_per_meter: 100, maps: {} };

function boot(): void {
  document.body.innerHTML = '<div id="map"></div>';
  new Function(script)();
}

describe('overlay-map.html（悬浮窗地图页）', () => {
  beforeEach(() => {
    boot();
    api().init(catalog);
  });
  afterEach(() => {
    document.body.innerHTML = '';
    delete (window as unknown as { RocoOverlayMap?: MapApi }).RocoOverlayMap;
  });

  test('连续两次 update 复用同一批节点，不整段重建 DOM', () => {
    const pet = { x: 100, y: 0, rare: false, alert: false, kinds: [] as string[] };
    api().update({ scene: 1, self: { x: 0, y: 0 }, heading: 0, pets: [pet] });
    expect(document.querySelectorAll('#map .layer').length).toBe(2);
    const first = Array.from(document.querySelectorAll('#map .pt'));
    expect(first.length).toBe(1);

    api().update({
      scene: 1,
      self: { x: 100, y: 0 },
      heading: 0,
      pets: [pet, { x: 300, y: 0, rare: true, alert: true, kinds: ['shiny'] }],
    });
    const after = Array.from(document.querySelectorAll('#map .pt'));
    expect(after.length).toBe(2);
    // 同一个节点被复用：说明走的是增量更新，不是 innerHTML 全量重建
    expect(after[0]).toBe(first[0]);
  });

  test('自身移动只改两层 transform：1 米 = 0.5px，方向与自身位移相反', () => {
    api().update({ scene: 1, self: { x: 0, y: 0 }, heading: 0, pets: [] });
    const dotLayer = document.querySelectorAll('#map .layer')[1] as HTMLElement;
    expect(dotLayer.style.transform).toBe('translate(0.00px,0.00px)');

    api().update({ scene: 1, self: { x: 100, y: 200 }, heading: 0, pets: [] });
    expect(dotLayer.style.transform).toBe('translate(-0.50px,-1.00px)');
  });

  test('人物朝向按 heading 旋转，缺失时沿用上一次', () => {
    api().update({ scene: 1, self: { x: 0, y: 0 }, heading: 90, pets: [] });
    const me = document.querySelector('#map .me') as HTMLElement;
    expect(me.style.transform).toBe('rotate(90.0deg)');

    api().update({ scene: 1, self: { x: 0, y: 0 }, pets: [] });
    expect(me.style.transform).toBe('rotate(90.0deg)');
  });

  test('切场景重建点池；没有自身坐标时清空地图（与原行为一致）', () => {
    api().update({ scene: 1, self: { x: 0, y: 0 }, pets: [{ x: 100, y: 0, rare: false, alert: false, kinds: [] }] });
    expect(document.querySelectorAll('#map .pt').length).toBe(1);

    api().update({ scene: 2, self: { x: 0, y: 0 }, pets: [] });
    expect(document.querySelectorAll('#map .pt').length).toBe(0);

    api().update({ scene: 2, self: null, pets: [] });
    expect(document.getElementById('map')!.childElementCount).toBe(0);
  });

  test('走离进场锚点后仍画「当前附近」的精灵点，不按旧锚点整批裁掉', () => {
    const dotOf = (x: number) => ({ x, y: 0, rare: false, alert: false, kinds: [] as string[] });
    const visible = () =>
      Array.from(document.querySelectorAll('#map .pt') as unknown as HTMLElement[])
        .filter((node) => node.style.display !== 'none').length;
    // 场景入口（锚点）在 (0,0)
    api().update({ scene: 1, self: { x: 0, y: 0 }, heading: 0, pets: [dotOf(100)] });
    expect(visible()).toBe(1);

    // 走了 300 米：壳只推「离我最近」的精灵，它们离旧锚点已经很远
    api().update({ scene: 1, self: { x: 30000, y: 0 }, heading: 0, pets: [dotOf(30100)] });
    expect(visible()).toBe(1);
    // 点位仍按锚点存（左上方 100 单位 = 0.5px），靠精灵层平移回到视口中心
    const dotLayer = document.querySelectorAll('#map .layer')[1] as HTMLElement;
    expect(dotLayer.style.transform).toBe('translate(-150.00px,0.00px)');
  });
});
