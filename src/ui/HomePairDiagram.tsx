import { NEST_SIZE } from '../domain/nestGeometry';
import type { HomePair, HomeResident, OwnedPet } from '../domain/types';
import { NestLayoutSvg, type NestSvgLine, type NestSvgSlot } from './NestLayoutSvg';
import { pairingColor, pairingDashed } from './pairingColors';

/**
 * 家园现状的「配窝卡片」（2026-11-01 用户口径：用看板「配窝建议」里那张摆位图的画法）。
 *
 * 和配窝建议的区别：那边画的是**建议**排位（`buildNestPlans` 算出来的坐标），
 * 这边画的是**游戏里实际成立的配对**（`layEggCouples`）。抓包里的窝坐标大多为空，
 * 所以两边都不按真实坐标、只按配对关系紧凑排：同一簇内的窝按公母分布排开（`layoutPairNodes`），
 * 簇与簇之间留空隙、各用一种线色。
 *
 * 方块里只写名字（最多 4 字，完整名放 title）+ 性别；学院小窝那只是绿底白字。
 */

/** 配窝卡片四周留白（地板单元）：1/4 窝，只够描边不被裁，剩下的都留给方块。 */
const HOME_PAIR_PADDING = 2;

interface PairPosition {
  x: number;
  y: number;
}

/**
 * 按公母分布排卡；坐标用家园地板单元（1 窝 = 8 单元），保证卡片间距与摆位图一致。
 * 母在左、公在右；多母时母本居中纵向排列、公本分居两侧；三公八母用倒三角围成一片。
 */
function layoutPairNodes(nodes: readonly HomePairNode[]): PairPosition[] {
  const males: number[] = [];
  const females: number[] = [];
  const unknown: number[] = [];
  nodes.forEach((node, index) => {
    if (node.gender === '公') males.push(index);
    else if (node.gender === '母') females.push(index);
    else unknown.push(index);
  });

  const positions = new Array<PairPosition>(nodes.length);
  const place = (index: number, column: number, row: number) => {
    positions[index] = { x: column * NEST_SIZE, y: row * NEST_SIZE };
  };
  const placeColumn = (indices: number[], column: number, totalRows = indices.length) => {
    indices.forEach((index, row) => place(index, column, row + (totalRows - indices.length) / 2));
  };

  if (males.length === 3 && females.length === 8 && unknown.length === 0) {
    const femaleCells = [
      [0, 0],
      [2, 0],
      [4, 0],
      [0, 1],
      [2, 1],
      [4, 1],
      [0, 2],
      [4, 2],
    ];
    females.forEach((index, order) => place(index, femaleCells[order][0], femaleCells[order][1]));
    place(males[0], 1, 1);
    place(males[1], 3, 1);
    place(males[2], 2, 2);
    return positions;
  }

  if (males.length === 2 && females.length === 1 && unknown.length === 0) {
    place(males[0], 0, 0);
    place(females[0], 1, 0);
    place(males[1], 2, 0);
    return positions;
  }

  if (males.length === 1 && females.length === 2 && unknown.length === 0) {
    place(females[0], 0, 0);
    place(males[0], 1, 0);
    place(females[1], 2, 0);
    return positions;
  }

  if (males.length === 2 && females.length > 1 && unknown.length === 0) {
    placeColumn(females, 1);
    const middleRow = (females.length - 1) / 2;
    place(males[0], 0, middleRow);
    place(males[1], 2, middleRow);
    return positions;
  }

  // 兜底：母在左列、公（含未知）在右列，保证同一对里母本永远在左边
  if (males.length > 0 && females.length > 0) {
    const rightColumn = [...males, ...unknown];
    const rowCount = Math.max(rightColumn.length, females.length);
    placeColumn(females, 0, rowCount);
    placeColumn(rightColumn, 1, rowCount);
    return positions;
  }

  if (unknown.length > 0 && females.length > 0) {
    const rowCount = Math.max(unknown.length, females.length);
    placeColumn(females, 0, rowCount);
    placeColumn(unknown, 1, rowCount);
    return positions;
  }

  placeColumn(nodes.map((_, index) => index), 0);
  return positions;
}

export interface HomePairNode {
  actorId: string;
  /** 完整名字（title 用） */
  name: string;
  gender: '公' | '母' | '未知';
  /** 住在学院小窝：绿底白字 */
  academy: boolean;
  /** 配对里提到、但这次快照里找不到住户 */
  missing: boolean;
  /** 住户所在小窝的显示名（大卡的卡底小字） */
  nest?: string;
  /** 住户自己的性格：背包里没找到这只时也能显示 */
  nature?: string;
  /** 实例基础 id：背包里没找到时用它取头像 */
  baseId?: string;
  /** 背包里对应的那只：有就带分贝 / 身高 / 体重 / 奖牌 */
  pet?: OwnedPet;
}

export interface HomePairCluster {
  key: string;
  nodes: HomePairNode[];
  /** 连线：nodes 下标对 */
  edges: Array<[number, number]>;
}

/**
 * 把实际配对拆成「簇」：共享同一只精灵的两条配对画在一个簇里
 * （学院小窝那只 1:2 时，绿块只画一次、两条线连两只）。
 */
export function buildHomePairClusters(
  couples: readonly HomePair[],
  residents: readonly HomeResident[],
  pets: ReadonlyMap<string, OwnedPet>,
): HomePairCluster[] {
  const residentByActor = new Map(residents.map((resident) => [resident.actorId, resident]));
  // 实例 id 对不上时（重新抓包 / 背包里没这只）退一步按名字找，且只在「同名唯一」时采用
  const petsByName = new Map<string, OwnedPet[]>();
  for (const pet of pets.values()) {
    const list = petsByName.get(pet.name) ?? [];
    list.push(pet);
    petsByName.set(pet.name, list);
  }
  const petOf = (resident: HomeResident): OwnedPet | undefined => {
    const exact = pets.get(resident.instanceId);
    if (exact) return exact;
    const sameName = petsByName.get(resident.name);
    return sameName?.length === 1 ? sameName[0] : undefined;
  };

  const nodeOf = (actorId: string): HomePairNode => {
    const resident = residentByActor.get(actorId);
    if (!resident) {
      return { actorId, name: '公本未知', gender: '未知', academy: false, missing: true };
    }
    const pet = petOf(resident);
    const nestName = resident.nest
      ? resident.nest.nestName || (resident.nest.nestType === 'academy' ? '学院小窝' : '普通小窝')
      : '';
    return {
      actorId,
      name: resident.name || pet?.name || `精灵 ${actorId}`,
      gender:
        resident.gender === '公' || resident.gender === '母'
          ? resident.gender
          : pet?.gender === '公' || pet?.gender === '母'
            ? pet.gender
            : '未知',
      academy: resident.nest?.nestType === 'academy',
      missing: false,
      nest: resident.nest?.roomName ? `${nestName} · ${resident.nest.roomName}` : nestName,
      nature: resident.nature || pet?.nature,
      baseId: resident.baseId,
      pet,
    };
  };

  // 并查集：共享精灵的配对归到同一簇
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let current = id;
    while (parent.get(current) !== current) current = parent.get(current) ?? current;
    return current;
  };
  const union = (a: string, b: string): void => {
    for (const id of [a, b]) if (!parent.has(id)) parent.set(id, id);
    const [left, right] = [find(a), find(b)];
    if (left !== right) parent.set(right, left);
  };
  for (const couple of couples) {
    for (const maleActorId of couple.maleActorIds) union(couple.femaleActorId, maleActorId);
  }

  const clusters = new Map<string, HomePairCluster>();
  const indexOf = (cluster: HomePairCluster, actorId: string, asMother = false): number => {
    let index = cluster.nodes.findIndex((node) => node.actorId === actorId);
    if (index < 0) {
      cluster.nodes.push(nodeOf(actorId));
      index = cluster.nodes.length - 1;
    }
    // 游戏配对里的 `femaleActorId` 本身就是母本：背包里没有这只（或没有性别）时，
    // 也要按母本排到左列，不能当成种公（2026-11-19 莱茵家园反馈）。
    const node = cluster.nodes[index];
    if (asMother && node.gender === '未知') node.gender = '母';
    return index;
  };

  for (const couple of couples) {
    const maleActorIds = couple.maleActorIds.filter(Boolean);
    if (!couple.femaleActorId || maleActorIds.length === 0) continue;
    const root = find(couple.femaleActorId);
    const cluster = clusters.get(root) ?? { key: root, nodes: [], edges: [] };
    clusters.set(root, cluster);
    const femaleIndex = indexOf(cluster, couple.femaleActorId, true);
    for (const maleActorId of maleActorIds) {
      const maleIndex = indexOf(cluster, maleActorId);
      if (!cluster.edges.some(([a, b]) => a === femaleIndex && b === maleIndex)) {
        cluster.edges.push([femaleIndex, maleIndex]);
      }
    }
  }

  return [...clusters.values()].filter((cluster) => cluster.nodes.length > 0);
}

export interface HomePairDiagramProps {
  couples: readonly HomePair[];
  residents: readonly HomeResident[];
  pets: ReadonlyMap<string, OwnedPet>;
}

export function HomePairDiagram({ couples, residents, pets }: HomePairDiagramProps) {
  const clusters = buildHomePairClusters(couples, residents, pets);
  if (clusters.length === 0) return null;
  // 一公一母的配对优先显示（最好认），其余保持原顺序
  const orderedClusters = clusters
    .map((cluster, index) => ({
      cluster,
      index,
      oneToOne:
        cluster.nodes.filter((node) => node.gender === '公').length === 1 &&
        cluster.nodes.filter((node) => node.gender === '母').length === 1 &&
        cluster.nodes.every((node) => node.gender !== '未知'),
    }))
    .sort((left, right) => Number(right.oneToOne) - Number(left.oneToOne) || left.index - right.index)
    .map(({ cluster }) => cluster);

  return (
    <div className="flex flex-wrap items-start gap-3" data-testid="home-pair-diagram">
      {orderedClusters.map((cluster, index) => {
        const color = pairingColor(index);
        const dashed = pairingDashed(index);
        // 同一簇内按公母分布紧凑排位（与摆位图同一套几何：1 窝 = 8 单元）
        const positions = layoutPairNodes(cluster.nodes);
        const slots: NestSvgSlot[] = cluster.nodes.map((node, nodeIndex) => ({
          key: node.actorId,
          name: node.name,
          gender: node.gender,
          academy: node.academy,
          missing: node.missing,
          position: positions[nodeIndex],
        }));
        const lines: NestSvgLine[] = cluster.edges.map(([from, to], edgeIndex) => ({
          key: `${from}-${to}-${edgeIndex}`,
          from: positions[from],
          to: positions[to],
          color,
          dashed,
        }));
        return (
          <div
            key={cluster.key}
            className="flex w-[calc(50%-4px)] items-center justify-center"
            data-testid="home-pair-cluster"
          >
            <NestLayoutSvg
              slots={slots}
              lines={lines}
              label="家园实际配对"
              testId="home-pair-cluster-map"
              slotTestId="home-pair-node"
              className="mx-auto block w-[58%]"
              padding={HOME_PAIR_PADDING}
            />
          </div>
        );
      })}
    </div>
  );
}