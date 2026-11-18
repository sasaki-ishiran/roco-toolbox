import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import type { HomePair, HomeResident, OwnedPet } from '../domain/types';
import { buildHomePairClusters, HomePairDiagram } from './HomePairDiagram';

afterEach(cleanup);

/** 取某个方块名字文字的坐标（SVG 坐标：x 越小越靠左、y 越小越靠上）。 */
const xyOf = (name: string): { x: number; y: number } => {
  const node = screen
    .getAllByTestId('home-pair-node')
    .find((item) => item.getAttribute('data-name') === name);
  const text = node?.querySelector('text');
  return { x: Number(text?.getAttribute('x')), y: Number(text?.getAttribute('y')) };
};

const resident = (over: Partial<HomeResident> & Pick<HomeResident, 'actorId' | 'name'>): HomeResident => ({
  instanceId: `ins_${over.actorId}`,
  baseId: '3001',
  furnitureGuid: `nest_${over.actorId}`,
  ...over,
});

const ACADEMY = resident({
  actorId: 'm1',
  name: '多西',
  gender: '公',
  nest: { furnitureGuid: 'nest_m1', configId: 1001072, nestType: 'academy', nestName: '学院小窝' },
});

describe('家园配窝图（摆位图画法）', () => {
  test('共享同一只精灵的两条配对并成一簇：绿块画一次、两条线连两只', () => {
    const residents = [
      resident({ actorId: 'f1', name: '火花', gender: '母' }),
      resident({ actorId: 'f2', name: '叮叮卯', gender: '母' }),
      ACADEMY,
    ];
    const couples: HomePair[] = [
      { femaleActorId: 'f1', maleActorIds: ['m1'] },
      { femaleActorId: 'f2', maleActorIds: ['m1'] },
    ];

    const clusters = buildHomePairClusters(couples, residents, new Map());
    expect(clusters).toHaveLength(1);
    expect(clusters[0].nodes.map((node) => node.name)).toEqual(['火花', '多西', '叮叮卯']);
    expect(clusters[0].edges).toEqual([
      [0, 1],
      [2, 1],
    ]);
    expect(clusters[0].nodes[1].academy).toBe(true);
  });

  test('互不相干的两对拆成两块，学院小窝那只绿底', () => {
    const residents = [
      resident({ actorId: 'f1', name: '火花', gender: '母' }),
      ACADEMY,
      resident({ actorId: 'f2', name: '冰钻布鲁', gender: '母' }),
      resident({ actorId: 'm2', name: '伊贝儿', gender: '公' }),
    ];
    const couples: HomePair[] = [
      { femaleActorId: 'f1', maleActorIds: ['m1'] },
      { femaleActorId: 'f2', maleActorIds: ['m2'] },
    ];

    render(<HomePairDiagram couples={couples} residents={residents} pets={new Map()} />);
    expect(screen.getByTestId('home-pair-diagram')).toBeTruthy();
    expect(screen.getAllByTestId('home-pair-node')).toHaveLength(4);

    const academyNode = screen
      .getAllByTestId('home-pair-node')
      .find((node) => node.getAttribute('data-name') === '多西');
    expect(academyNode?.getAttribute('data-academy')).toBe('true');
  });

  test('一对里母在左、公在右（和「配窝建议」的配对行、下面的家园精灵卡一致）', () => {
    const residents = [
      resident({ actorId: 'f1', name: '可立鸡', gender: '母' }),
      resident({ actorId: 'm1', name: '锤头鹅', gender: '公' }),
    ];

    render(
      <HomePairDiagram
        couples={[{ femaleActorId: 'f1', maleActorIds: ['m1'] }]}
        residents={residents}
        pets={new Map()}
      />,
    );

    const xOf = (name: string): number => {
      const node = screen
        .getAllByTestId('home-pair-node')
        .find((item) => item.getAttribute('data-name') === name);
      return Number(node?.querySelector('text')?.getAttribute('x'));
    };
    expect(xOf('可立鸡')).toBeLessThan(xOf('锤头鹅'));
  });

  test('一公一母的配对簇优先显示，其他簇保持原顺序', () => {
    const residents = [
      resident({ actorId: 'f2', name: '复杂母', gender: '母' }),
      resident({ actorId: 'm2a', name: '复杂公甲', gender: '公' }),
      resident({ actorId: 'm2b', name: '复杂公乙', gender: '公' }),
      resident({ actorId: 'f1', name: '单配母', gender: '母' }),
      resident({ actorId: 'm1', name: '单配公', gender: '公' }),
    ];
    const couples: HomePair[] = [
      { femaleActorId: 'f2', maleActorIds: ['m2a', 'm2b'] },
      { femaleActorId: 'f1', maleActorIds: ['m1'] },
    ];
    render(<HomePairDiagram couples={couples} residents={residents} pets={new Map()} />);

    const clusters = screen.getAllByTestId('home-pair-cluster');
    const clusterNames = clusters.map((cluster) =>
      Array.from(cluster.querySelectorAll('[data-testid="home-pair-node"]')).map((node) =>
        node.getAttribute('data-name'),
      ),
    );
    expect(clusterNames).toEqual([
      ['单配母', '单配公'],
      ['复杂母', '复杂公甲', '复杂公乙'],
    ]);
  });

  test('二公一母按公-母-公横向排列', () => {
    const residents = [
      resident({ actorId: 'f1', name: '母本', gender: '母' }),
      resident({ actorId: 'm1', name: '公本甲', gender: '公' }),
      resident({ actorId: 'm2', name: '公本乙', gender: '公' }),
    ];
    render(
      <HomePairDiagram
        couples={[{ femaleActorId: 'f1', maleActorIds: ['m1', 'm2'] }]}
        residents={residents}
        pets={new Map()}
      />,
    );

    expect(xyOf('公本甲').x).toBeLessThan(xyOf('母本').x);
    expect(xyOf('母本').x).toBeLessThan(xyOf('公本乙').x);
    expect(xyOf('公本甲').y).toBe(xyOf('母本').y);
    expect(xyOf('公本乙').y).toBe(xyOf('母本').y);
  });

  test('一公二母按母-公-母横向排列', () => {
    const residents = [
      resident({ actorId: 'f1', name: '母本甲', gender: '母' }),
      resident({ actorId: 'm1', name: '公本', gender: '公' }),
      resident({ actorId: 'f2', name: '母本乙', gender: '母' }),
    ];
    const couples: HomePair[] = [
      { femaleActorId: 'f1', maleActorIds: ['m1'] },
      { femaleActorId: 'f2', maleActorIds: ['m1'] },
    ];
    render(<HomePairDiagram couples={couples} residents={residents} pets={new Map()} />);

    expect(xyOf('母本甲').x).toBeLessThan(xyOf('公本').x);
    expect(xyOf('公本').x).toBeLessThan(xyOf('母本乙').x);
    expect(xyOf('母本甲').y).toBe(xyOf('公本').y);
    expect(xyOf('公本').y).toBe(xyOf('母本乙').y);
  });

  test('二公三母：两公分居两侧，三母居中纵向排列', () => {
    const femaleActorIds = ['f1', 'f2', 'f3'];
    const maleActorIds = ['m1', 'm2'];
    const residents = [
      ...femaleActorIds.map((actorId, index) =>
        resident({ actorId, name: `母本${index + 1}`, gender: '母' }),
      ),
      ...maleActorIds.map((actorId, index) =>
        resident({ actorId, name: `公本${index + 1}`, gender: '公' }),
      ),
    ];
    const couples = femaleActorIds.map((femaleActorId) => ({ femaleActorId, maleActorIds }));
    render(<HomePairDiagram couples={couples} residents={residents} pets={new Map()} />);

    const females = ['母本1', '母本2', '母本3'].map(xyOf);
    // 三母同一列、从上到下排
    expect(females[0].x).toBe(females[1].x);
    expect(females[1].x).toBe(females[2].x);
    expect(females[0].y).toBeLessThan(females[1].y);
    expect(females[1].y).toBeLessThan(females[2].y);
    // 两公分居两侧，与中间那只母本同一行
    expect(xyOf('公本1').x).toBeLessThan(females[1].x);
    expect(females[1].x).toBeLessThan(xyOf('公本2').x);
    expect(xyOf('公本1').y).toBe(females[1].y);
    expect(xyOf('公本2').y).toBe(females[1].y);
  });

  test('三公八母：三公倒三角，八母围在周围', () => {
    const femaleActorIds = Array.from({ length: 8 }, (_, index) => `f${index + 1}`);
    const maleActorIds = ['m1', 'm2', 'm3'];
    const residents = [
      ...femaleActorIds.map((actorId, index) =>
        resident({ actorId, name: `母本${index + 1}`, gender: '母' }),
      ),
      ...maleActorIds.map((actorId, index) =>
        resident({ actorId, name: `公本${index + 1}`, gender: '公' }),
      ),
    ];
    const couples = femaleActorIds.map((femaleActorId) => ({ femaleActorId, maleActorIds }));
    render(<HomePairDiagram couples={couples} residents={residents} pets={new Map()} />);

    const males = ['公本1', '公本2', '公本3'].map(xyOf);
    // 两只公本并排在上，第三只落在下一行中间（倒三角）
    expect(males[0].y).toBe(males[1].y);
    expect(males[0].x).toBeLessThan(males[1].x);
    expect(males[2].y).toBeGreaterThan(males[0].y);
    expect(males[2].x).toBe((males[0].x + males[1].x) / 2);

    const females = femaleActorIds.map((_, index) => xyOf(`母本${index + 1}`));
    // 八母围在四周：左列 1/4/7、右列 3/6/8 各自对齐，中列 2/5 对齐
    expect(females[0].x).toBe(females[3].x);
    expect(females[3].x).toBe(females[6].x);
    expect(females[2].x).toBe(females[5].x);
    expect(females[5].x).toBe(females[7].x);
    expect(females[1].x).toBe(females[4].x);
    // 母本不会摆在公本那一格上
    for (const female of females) {
      expect(males.some((male) => male.x === female.x && male.y === female.y)).toBe(false);
    }
  });

  test('配对里的公本不在快照里时，用虚线占位块写「公本未知」', () => {
    const residents = [resident({ actorId: 'f1', name: '火花', gender: '母' })];

    render(
      <HomePairDiagram
        couples={[{ femaleActorId: 'f1', maleActorIds: ['ghost'] }]}
        residents={residents}
        pets={new Map()}
      />,
    );

    const nodes = screen.getAllByTestId('home-pair-node');
    expect(nodes).toHaveLength(2);
    const missing = nodes.find((node) => node.getAttribute('data-name') === '公本未知');
    expect(missing?.getAttribute('data-missing')).toBe('true');
    expect(missing).toHaveTextContent('公本未知');
  });

  test('没有配对时不渲染画布', () => {
    render(<HomePairDiagram couples={[]} residents={[]} pets={new Map()} />);
    expect(screen.queryByTestId('home-pair-diagram')).toBeNull();
  });

  test('住户实例 id 对不上时，按同名唯一精灵兜底性别（不再显示未知）', () => {
    const female = resident({ actorId: 'f1', name: '兽花蕾', instanceId: 'new-id' });
    const male = resident({ actorId: 'm1', name: '恶魔叮', gender: '公' });
    const pets = new Map<string, OwnedPet>([
      [
        'old-id',
        {
          gameId: 3001,
          name: '兽花蕾',
          gender: '母',
          nature: '',
          voiceDb: 100,
          medalBody: '大块头',
          weightPercent: 90,
          heightPercent: 90,
          isShiny: false,
          account: 'A',
          captureId: 'cap_old-id',
        },
      ],
    ]);

    render(
      <HomePairDiagram
        couples={[{ femaleActorId: 'f1', maleActorIds: ['m1'] }]}
        residents={[female, male]}
        pets={pets}
      />,
    );

    const node = screen
      .getAllByTestId('home-pair-node')
      .find((item) => item.getAttribute('data-name') === '兽花蕾');
    expect(node).toHaveTextContent('♀');
  });
});
