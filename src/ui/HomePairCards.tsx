import type { HomePair, HomeResident, OwnedPet } from '../domain/types';
import { buildHomePairClusters, type HomePairCluster, type HomePairNode } from './HomePairDiagram';
import { averageVoiceOf, PairingPetCard, type PairCardPet } from './NestPlanCard';
import { pairingColor } from './pairingColors';

/**
 * 家园「配窝卡片」（2026-11-19 用户口径）：复用补全计划那张紧凑精灵卡（蛋组 / 奖牌 /
 * 分贝 / 身高 / 体重 / 名字），家园版 70px、不写盒子；补全计划版 86px，卡底多一行盒子位置。
 *
 * - **一个窝一只精灵**：母本一个窝、种公也一个窝；学院 1:2 = 一公两母三个窝，公本只出现一次；
 * - 普通的一公一母 / 一公两母：卡头贴在母本上方，种公和母本顶边对齐；
 * - 任一边超过 2 只，或 2 母 2 公：少数的一方置顶——1 公 10 母时公本置顶，
 *   10 公 1 母时母本置顶，另一方两列排；不折叠，所有卡片都显示；
 * - 每只母本只按她自己配的种公算性格和声音；多公时标出配了谁；
 * - 学院小窝那只绿框。
 *
 * 性格概率按游戏规则：学院小窝 100% 跟学院那只；普通窝单方 30%、双方同性格 60%。
 * 数据只来自抓包里的实际配对（`layEggCouples`），不重新计算配对。
 */
const natureOf = (node: HomePairNode): string => node.nature || node.pet?.nature || '';

const displayNameOf = (node: HomePairNode): string => node.name.split('_')[0] || node.name;

interface NatureChance {
  nature: string;
  chance: number;
}

/** 只在这只母本和她的种公里找学院小窝；不能用整簇，否则多母本会被别的学院精灵带成 100%。 */
function pairNaturesOf(
  mother: HomePairNode | null,
  males: readonly HomePairNode[],
): NatureChance[] {
  const academy = [mother, ...males].find((node) => node?.academy && natureOf(node));
  if (academy) {
    const nature = natureOf(academy);
    return nature ? [{ nature, chance: 1 }] : [];
  }
  const motherNature = mother ? natureOf(mother) : '';
  const maleNatures = new Set(males.map(natureOf).filter(Boolean));
  const result: NatureChance[] = [];
  if (motherNature) {
    result.push({ nature: motherNature, chance: maleNatures.has(motherNature) ? 0.6 : 0.3 });
  }
  for (const nature of maleNatures) {
    if (nature !== motherNature) result.push({ nature, chance: 0.3 });
  }
  return result;
}

/** 这条母本在游戏配对里实际配的种公（按 `layEggCouples` 的边，不把整簇的种公都算给她）。 */
function partnerMalesOf(cluster: HomePairCluster, female: HomePairNode): HomePairNode[] {
  const femaleIndex = cluster.nodes.indexOf(female);
  const partners = cluster.edges
    .filter(([from]) => from === femaleIndex)
    .map(([, to]) => cluster.nodes[to])
    .filter((node): node is HomePairNode => Boolean(node));
  if (partners.length > 0) return partners;
  if (cluster.edges.length === 0) {
    return cluster.nodes.filter((node) => node.gender !== '母');
  }
  return [];
}

const voiceOfPair = (female: HomePairNode, partners: readonly HomePairNode[]): number | null =>
  averageVoiceOf([
    { gender: female.gender, voiceDb: female.pet?.voiceDb },
    ...partners.map((male) => ({ gender: male.gender, voiceDb: male.pet?.voiceDb })),
  ]);

/** 住在家园、但背包里没有这只：大概率已经放生；放生后不再算后代性格和声音。 */
const releasedOfPair = (
  female: HomePairNode,
  partners: readonly HomePairNode[],
): HomePairNode[] => [female, ...partners].filter((node) => !node.missing && !node.pet);

function petCardOf(node: HomePairNode): PairCardPet {
  const pet = node.pet;
  return {
    key: node.actorId,
    gameId: pet?.gameId ?? (node.baseId ? Number(node.baseId) || null : null),
    name: node.name.split('_')[0] || node.name,
    fullName: node.name,
    gender: node.gender,
    nature: natureOf(node),
    voiceDb: pet?.voiceDb,
    medalBody: pet?.medalBody,
    heightPercent: pet?.heightPercent,
    weightPercent: pet?.weightPercent,
    // 家园卡不写小窝位置（2026-11-19 用户口径）
    box: '',
  };
}

function NatureChips({ natures }: { natures: NatureChance[] }) {
  return (
    <>
      {natures.map(({ nature, chance }) => (
        <span
          key={nature}
          className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] leading-none font-semibold text-amber-700"
          data-testid="home-pair-nature"
        >
          {Math.round(chance * 100)}%{nature}
        </span>
      ))}
    </>
  );
}

function ReleasedNotice({ nodes }: { nodes: readonly HomePairNode[] }) {
  const names = nodes.map(displayNameOf).join('、');
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="home-pair-released">
      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] leading-none font-medium text-amber-800">
        {names} 可能已被放生，不计算后代性格和声音
      </span>
    </div>
  );
}

/**
 * 多用例布局：少数的一方置顶（1 公 10 母 → 公本置顶；10 公 1 母 → 母本置顶），
 * 另一方在下面两列排；不折叠，所有卡片都显示。每只母本只算她自己配的那几只公本。
 */
function SharedStudLayout({
  cluster,
  males,
  females,
  index,
}: {
  cluster: HomePairCluster;
  males: readonly HomePairNode[];
  females: readonly HomePairNode[];
  index: number;
}) {
  const femaleOnTop = females.length < males.length;
  const partnerMap = new Map(
    females.map((female) => [female.actorId, partnerMalesOf(cluster, female)]),
  );
  const maleCount = new Map<string, number>();
  for (const female of females) {
    for (const male of partnerMap.get(female.actorId) ?? []) {
      maleCount.set(male.actorId, (maleCount.get(male.actorId) ?? 0) + 1);
    }
  }
  const topShared = femaleOnTop
    ? females.some((female) => (partnerMap.get(female.actorId)?.length ?? 0) > 1)
    : [...maleCount.values()].some((count) => count > 1);
  const topLabel = femaleOnTop
    ? topShared
      ? '共用母本'
      : '母本'
    : topShared
      ? '共用种公'
      : '种公';
  const bottomLabel = femaleOnTop ? '种公' : '母本';
  const top = femaleOnTop ? females : males;
  const bottom = femaleOnTop ? males : females;

  const motherCard = (female: HomePairNode) => {
    const partners = partnerMap.get(female.actorId) ?? [];
    const released = releasedOfPair(female, partners);
    const voiceDb = released.length > 0 ? null : voiceOfPair(female, partners);
    // 一只母本配超过 3 只种公：后代性格和声音不再显示（2026-11-19 用户口径）
    const manyStuds = partners.length > 3;
    // 标签只写数量，不列名字：极端配对时名字会把半宽的卡头文字挤坏（2026-11-19 用户口径）
    const partnerLabel = males.length > 1 ? `配 ${partners.length} 只种公` : null;
    return (
      <div key={female.actorId} className="flex min-w-0 flex-col gap-1">
        {released.length > 0 ? (
          <ReleasedNotice nodes={released} />
        ) : (
          <div className="flex flex-wrap items-center gap-1" data-testid="home-pair-head">
            {manyStuds ? (
              <span className="text-[10px] leading-none text-slate-500">
                配 {partners.length} 只种公
              </span>
            ) : (
              <>
                <NatureChips natures={pairNaturesOf(female, partners)} />
                {voiceDb !== null ? (
                  <span className="text-[10px] leading-none text-slate-500">{voiceDb}dB</span>
                ) : null}
                {partnerLabel ? (
                  <span className="text-[9px] leading-none text-slate-400">{partnerLabel}</span>
                ) : null}
              </>
            )}
          </div>
        )}
        <PairingPetCard
          pet={petCardOf(female)}
          collectedGroupIds={new Set()}
          academy={female.academy}
          home
        />
      </div>
    );
  };

  // 种公卡片上方不写文案：只保留卡片本身，配了几只母本由页头统一说明
  const maleCard = (male: HomePairNode) => (
    <div key={male.actorId} className="flex min-w-0 flex-col gap-1">
      <PairingPetCard
        pet={petCardOf(male)}
        collectedGroupIds={new Set()}
        academy={male.academy}
        home
      />
    </div>
  );

  return (
    <li
      className="rounded-xl border-l-4 bg-slate-50 px-1.5 py-1"
      style={{ borderLeftColor: pairingColor(index) }}
      data-testid="home-pair-card"
      data-layout="shared"
      data-top={femaleOnTop ? 'female' : 'male'}
    >
      <div data-testid="home-pair-shared">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] font-medium text-slate-500">{topLabel}</span>
          <span className="text-[10px] text-slate-400">
            {top.length} 只 · 配 {bottom.length} 只{bottomLabel}
          </span>
        </div>
        <div className="mt-0.5 grid grid-cols-2 gap-1">
          {top.map((node) => (femaleOnTop ? motherCard(node) : maleCard(node)))}
        </div>
      </div>
      <div
        className="mt-1.5 grid grid-cols-2 items-start gap-1"
        data-testid={femaleOnTop ? 'home-pair-males' : 'home-pair-mothers'}
      >
        {bottom.map((node) => (femaleOnTop ? maleCard(node) : motherCard(node)))}
      </div>
    </li>
  );
}

function HomePairCard({ cluster, index }: { cluster: HomePairCluster; index: number }) {
  // 缺失的公本在数据里是「未知」性别，但名字就是「公本未知」：按公方排到右列
  const females = cluster.nodes.filter((node) => node.gender === '母');
  const males = cluster.nodes.filter((node) => node.gender !== '母');
  /**
   * 任一边超过 2 只、或 2 母 2 公：少数的一方置顶、多数的一方两列，
   * 不再让一堆同侧卡片只对齐第一张（2026-11-19 用户口径）。
   */
  if (
    females.length > 2 ||
    males.length > 2 ||
    (females.length > 1 && males.length > 1)
  ) {
    return <SharedStudLayout cluster={cluster} males={males} females={females} index={index} />;
  }
  /**
   * 住在家园、但背包里没有这只：大概率已经放生。
   * 放生后这条配对不会再有后代，性格概率和平均声音都不该再算（2026-11-19 用户口径）。
   */
  const released = cluster.nodes.filter((node) => !node.missing && !node.pet);
  const hasReleased = released.length > 0;
  const voiceDb = hasReleased
    ? null
    : averageVoiceOf(
        cluster.nodes.map((node) => ({ gender: node.gender, voiceDb: node.pet?.voiceDb })),
      );
  const firstMother = females[0] ?? null;
  return (
    <li
      className="rounded-xl border-l-4 bg-slate-50 px-1.5 py-1"
      style={{ borderLeftColor: pairingColor(index) }}
      data-testid="home-pair-card"
    >
      {/* 有精灵可能已放生：提示放在整组上方，不再显示后代概率和声音 */}
      {hasReleased ? <ReleasedNotice nodes={released} /> : null}
      {/*
       * 两行网格：卡头只占母本这一列的第一行；母本和右侧种公都从第二行开始，
       * 这样种公卡片和母本卡片顶边对齐，卡头又贴在母本正上方（2026-11-19 用户口径）。
       */}
      <div className="mt-0.5 grid grid-cols-2 items-start gap-1">
        {firstMother && !hasReleased ? (
          <div
            className="col-start-1 row-start-1 flex flex-wrap items-center gap-1"
            data-testid="home-pair-head"
          >
            <NatureChips natures={pairNaturesOf(firstMother, males)} />
            {voiceDb !== null ? (
              <span className="text-[10px] leading-none text-slate-500">{voiceDb}dB</span>
            ) : null}
          </div>
        ) : null}
        <div
          className="col-start-1 row-start-2 flex min-w-0 flex-col gap-1"
          data-testid="home-pair-females"
        >
          {firstMother ? (
            <PairingPetCard
              pet={petCardOf(firstMother)}
              collectedGroupIds={new Set()}
              academy={firstMother.academy}
              home
            />
          ) : null}
          {females.slice(1).map((female) => (
            <div key={female.actorId} className="flex min-w-0 flex-col gap-1">
              {hasReleased ? null : (
                <div className="flex flex-wrap items-center gap-1" data-testid="home-pair-head-extra">
                  <NatureChips natures={pairNaturesOf(female, males)} />
                  {voiceDb !== null ? (
                    <span className="text-[10px] leading-none text-slate-500">{voiceDb}dB</span>
                  ) : null}
                </div>
              )}
              <PairingPetCard
                pet={petCardOf(female)}
                collectedGroupIds={new Set()}
                academy={female.academy}
                home
              />
            </div>
          ))}
        </div>
        <div
          className="col-start-2 row-start-2 flex min-w-0 flex-col gap-1"
          data-testid="home-pair-males"
        >
          {males.map((male) => (
            <PairingPetCard
              key={male.actorId}
              pet={petCardOf(male)}
              collectedGroupIds={new Set()}
              academy={male.academy}
              home
            />
          ))}
        </div>
      </div>
    </li>
  );
}

export interface HomePairCardsProps {
  couples: readonly HomePair[];
  residents: readonly HomeResident[];
  pets: ReadonlyMap<string, OwnedPet>;
}

export function HomePairCards({ couples, residents, pets }: HomePairCardsProps) {
  const clusters = buildHomePairClusters(couples, residents, pets);
  if (clusters.length === 0) return null;
  return (
    <ul className="space-y-0.5" data-testid="home-pair-card-list">
      {clusters.map((cluster, index) => (
        <HomePairCard key={cluster.key} cluster={cluster} index={index} />
      ))}
    </ul>
  );
}
