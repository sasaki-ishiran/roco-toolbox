import { useMemo } from 'react';
import { species } from '../data/catalog';
import type { AccountSnapshot } from '../domain/parseBackup';
import type { HomeResident, HomeSnapshot } from '../domain/types';
import { useAccountFilter } from './accountFilterStore';
import { AccountFilterBar } from './AccountFilterBar';
import { EmptyState } from './EmptyState';
import { GenderMark } from './GenderMark';
import { PetAvatar } from './PetAvatar';
import { PetCompactCard } from './PetCompactCard';
import { BODY, CARD, HINT, INSET, PAGE, TITLE } from './primitives/styles';
import { useSnapshots } from './useSnapshots';

/**
 * 家园页（2026-10-27）。
 *
 * 数据只来自抓包里的家园场景（不是实时查询）：
 * - 家园里有哪些精灵（住户）
 * - 游戏给出的实际配对（layEggCouples）
 * - 家园地上有没有蛋（sceneEggs）
 *
 * 不做摆位图。没有采集过家园时，明确告诉用户采集时要进家园走一圈。
 */
export interface HomeLandProps {
  onGoImport?: () => void;
}

const labelerFor =
  (snapshots: AccountSnapshot[]) =>
  (snapshot: AccountSnapshot): string => {
    const sameName = snapshots.filter((item) => item.accountName === snapshot.accountName).length;
    return sameName > 1 ? `${snapshot.accountName}(${snapshot.gameId})` : snapshot.accountName;
  };

function formatCapturedAt(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '时间未知';
  return new Date(time).toLocaleString('zh-CN', { hour12: false });
}

const GENDER_OF = (value: string | undefined): '公' | '母' | '未知' =>
  value === '公' || value === '母' ? value : '未知';

const speciesByGameId = new Map(species.map((entry) => [entry.gameId, entry]));

function petOf(snapshot: AccountSnapshot, resident: HomeResident) {
  const suffix = `_${resident.instanceId}`;
  return snapshot.pets.find((pet) => pet.captureId && pet.captureId.endsWith(suffix));
}

function nestLabel(home: HomeSnapshot, furnitureGuid: string): string {
  const nest = home.nests.find((item) => item.furnitureGuid === furnitureGuid);
  if (!nest) return furnitureGuid ? `小窝 ${furnitureGuid}` : '未知位置';
  const name = nest.nestName || (nest.nestType === 'academy' ? '学院小窝' : '普通小窝');
  return nest.roomName ? `${name} · ${nest.roomName}` : name;
}

/**
 * 家园精灵卡（2026-10-29 用户口径）：直接复用紧凑精灵卡，
 * 头像 + 名称 + 性别 + 奖牌 + 蛋组 + 性格，底部一行声音 / 身高 / 体重。
 */
function HomePetCard({ snapshot, resident }: { snapshot: AccountSnapshot; resident: HomeResident }) {
  const pet = petOf(snapshot, resident);
  const name = resident.name || pet?.name || `精灵 ${resident.instanceId}`;
  const gender = GENDER_OF(resident.gender || pet?.gender);
  const nature = resident.nature || pet?.nature || '';
  const nest = resident.nest;
  const avatarGameId = pet?.gameId ?? (Number(resident.baseId) || null);
  const entry = avatarGameId != null ? speciesByGameId.get(avatarGameId) : undefined;

  return (
    <PetCompactCard
      gameId={avatarGameId}
      name={name}
      gender={gender}
      nature={nature}
      medalBody={pet?.medalBody}
      voiceDb={pet?.voiceDb}
      heightPercent={pet?.heightPercent}
      weightPercent={pet?.weightPercent}
      eggGroups={entry?.eggGroups ?? []}
      isShiny={pet?.isShiny}
      isColorful={pet?.isColorful}
      academy={nest?.nestType === 'academy'}
      testId="home-pet-card"
    />
  );
}

/** 配窝卡片里的一只精灵：小头像 + 名字 + 性别。 */
function HomePairChip({ snapshot, resident }: { snapshot: AccountSnapshot; resident: HomeResident }) {
  const pet = petOf(snapshot, resident);
  const name = resident.name || pet?.name || `精灵 ${resident.instanceId}`;
  const gender = GENDER_OF(resident.gender || pet?.gender);
  return (
    <span className="flex min-w-0 items-center gap-0.5 rounded-md bg-white/80 px-1 py-0.5">
      <PetAvatar
        gameId={pet?.gameId ?? (Number(resident.baseId) || null)}
        name={name}
        size={24}
      />
      <span className="max-w-[4.5rem] truncate text-[10px] text-slate-700">{name}</span>
      <GenderMark gender={gender} />
    </span>
  );
}

function AccountHome({ snapshot, label }: { snapshot: AccountSnapshot; label: string }) {
  const home = snapshot.home;
  if (!home) return null;
  const ordinary = home.nests.filter((nest) => nest.nestType === 'ordinary').length;
  const academy = home.nests.filter((nest) => nest.nestType === 'academy').length;
  const byActor = new Map(home.residents.map((resident) => [resident.actorId, resident]));
  const eggCount = home.sceneEggs.length;

  return (
    <section className="rounded-2xl bg-white p-1.5 shadow-sm" data-testid={`home-account-${snapshot.gameId}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className={TITLE}>{label} 的家园</h2>
          <p className={HINT}>
            采集时间 {formatCapturedAt(home.capturedAt)}
            {home.homeLevel ? ` · 家园 ${home.homeLevel} 级` : ''}
            {home.roomLevel ? ` · 房间 ${home.roomLevel} 级` : ''}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${
            eggCount > 0 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'
          }`}
          data-testid="home-egg-count"
        >
          {eggCount > 0 ? `有 ${eggCount} 枚蛋` : '没有蛋'}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className={INSET}>
          <div className={TITLE}>{home.residents.length}</div>
          <div className={HINT}>家园精灵</div>
        </div>
        <div className={INSET}>
          <div className={TITLE}>{ordinary + academy}</div>
          <div className={HINT}>小窝（学院 {academy}）</div>
        </div>
        <div className={INSET}>
          <div className={TITLE}>{home.layEggCouples.length}</div>
          <div className={HINT}>实际配对</div>
        </div>
      </div>

      {home.couplesStale ? (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="home-stale">
          采集期间有精灵进出，游戏配对可能已经过期；重新采集一次家园会更准。
        </p>
      ) : null}
      {home.snapshotKind === 'delta' ? (
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          这份是增量快照，可能不包含全部住户；建议重新采集一次完整的家园场景。
        </p>
      ) : null}

      <div className="mt-3" data-testid="home-pair-cards">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-xs font-medium text-slate-500">配窝卡片</div>
          <div className="text-[10px] text-slate-400">按游戏实际配对模拟</div>
        </div>
        {home.layEggCouples.length === 0 ? (
          <p className={HINT} data-testid="home-no-pairs">
            游戏数据里没有当前配对（可能没有可配对的精灵，或采集时家园还没加载完）。
          </p>
        ) : (
          <div className="mt-1.5 space-y-1.5">
            {home.layEggCouples.map((pair) => {
              const female = byActor.get(pair.femaleActorId);
              const males = pair.maleActorIds
                .map((actorId) => byActor.get(actorId))
                .filter((resident): resident is HomeResident => resident != null);
              return (
                <div
                  key={pair.femaleActorId}
                  className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-2"
                  data-testid="home-pair-card"
                >
                  <div className="flex flex-wrap items-center gap-1 text-[11px] font-medium">
                    <span className="text-pink-600">
                      ♀ {female?.name ?? `精灵 ${pair.femaleActorId}`}
                    </span>
                    <span className="text-slate-400">×</span>
                    <span className="text-sky-600">
                      ♂ {males.map((resident) => resident.name).join('、') || '公本未知'}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {female ? <HomePairChip snapshot={snapshot} resident={female} /> : null}
                    {males.map((resident) => (
                      <HomePairChip
                        key={resident.instanceId}
                        snapshot={snapshot}
                        resident={resident}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-xs font-medium text-slate-500">家园精灵</div>
          <div className="text-[10px] text-slate-400">声音、身高与体重</div>
        </div>
        {home.residents.length === 0 ? (
          <p className={HINT}>当前家园没有精灵。</p>
        ) : (
          <div className="mt-1.5 flex flex-wrap gap-2" data-testid="home-residents">
            {home.residents.map((resident) => (
              <HomePetCard key={resident.instanceId} snapshot={snapshot} resident={resident} />
            ))}
          </div>
        )}
      </div>

      <div className={`${INSET} mt-3`}>
        <div className="text-xs font-medium text-slate-500">地上的蛋</div>
        {eggCount === 0 ? (
          <p className={HINT} data-testid="home-no-eggs">
            当前家园没有蛋。
          </p>
        ) : (
          <ul className="mt-1 space-y-1" data-testid="home-eggs">
            {home.sceneEggs.map((egg, index) => (
              <li key={`${egg.actorId}-${index}`} className={BODY}>
                第 {index + 1} 枚 · {nestLabel(home, egg.furnitureGuid)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function HomeLand({ onGoImport }: HomeLandProps = {}) {
  const { snapshots, loaded } = useSnapshots();
  const { excluded } = useAccountFilter();
  const labelOf = useMemo(() => labelerFor(snapshots), [snapshots]);
  const accounts = snapshots.map(labelOf);
  const visible = snapshots.filter((snapshot) => !excluded.has(labelOf(snapshot)));
  const withHome = visible.filter((snapshot) => snapshot.home);

  if (!loaded) {
    return <p className={`${PAGE} ${HINT}`}>正在读取本地数据…</p>;
  }

  return (
    <div className={PAGE}>
      <AccountFilterBar accounts={accounts} />
      {snapshots.length === 0 ? (
        <EmptyState onGoImport={onGoImport} />
      ) : visible.length === 0 ? (
        <p className={`${HINT}`}>未选择游戏账号：上面点「全选」可恢复。</p>
      ) : withHome.length === 0 ? (
        <section className={CARD} data-testid="home-no-capture">
          <h2 className={TITLE}>这份数据里没有家园记录</h2>
          <p className={`${HINT} mt-1`}>
            家园数据来自抓包里的家园场景。采集时要进入家园走一圈（最好切一次楼层、打开一次小窝），
            再退出并结束采集；否则抓包里没有家园。
          </p>
        </section>
      ) : (
        withHome.map((snapshot) => (
          <AccountHome
            key={snapshot.accountKey || snapshot.gameId}
            snapshot={snapshot}
            label={labelOf(snapshot)}
          />
        ))
      )}
    </div>
  );
}
