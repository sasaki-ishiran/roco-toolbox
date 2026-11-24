import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CATALOG_VERSION, species } from '../../data/catalog';
import type { AccountSnapshot } from '../../domain/parseBackup';
import { saveCurrentGroupId } from '../motherGroupStore';
import { Button } from '../primitives/Button';
import { CARD } from '../primitives/styles';
import { useMotherGroups } from '../useMotherGroups';
import { EggCharacterSelect } from './EggCharacterSelect';
import { EggStockPanel } from './EggStockPanel';
import { eggCharactersOf } from './eggCharacter';
import { useEggMatching } from './useEggMatching';
import { useEggStockSync } from './useEggStockSync';
import { useLandscape } from '../useWideLandscape';

/**
 * 家园页记住的页内分页（与 Home.tsx 的 HOME_VIEW_KEY 同一个键）。
 * 蛋仓屏渲染不出来时（未登录 / 未入组）把这个记忆抹掉：横屏顶栏整块隐藏，
 * 用户没有别的出口，若还把「上次停在蛋仓」记进下次启动，会一直困在空态。
 * 有账号有小组时不动它，保留「上次在哪就在哪」；**加载中 / 读失败也不算空态**。
 */
const HOME_VIEW_KEY = 'roco.homeView';

function forgetEggStockView(): void {
  try {
    window.localStorage.removeItem(HOME_VIEW_KEY);
  } catch {
    // 隐私模式 / 配额满：本次仍有空态里的返回出口，不影响离开。
  }
}

/** 空态在横屏下复用蛋仓的纵向标题栏（竖屏顶栏有「返回家园」，不重复给）。 */
function EmptyStockState({ testId, reason, action, onBack, hideReason = false }: {
  testId: string;
  reason: string;
  action?: { label: string; onClick: () => void };
  onBack?: () => void;
  /** 横屏只留动作（未登录这种一句话说得清的空态，不再占两行说明） */
  hideReason?: boolean;
}) {
  const landscape = useLandscape();
  /** 横屏说明只占 16rem、按钮 1/3 宽；hideReason 的空态把按钮居中。 */
  const hideText = landscape && hideReason;
  const body = (
    <div
      className={`flex flex-col gap-2${landscape ? (hideText ? ' items-center' : ' items-start') : ''}`}
      data-testid={testId}
    >
      {hideText ? null : (
        <p className={`text-xs text-slate-600${landscape ? ' max-w-[16rem]' : ''}`}>{reason}</p>
      )}
      {action ? (
        <Button
          size="sm"
          className={landscape ? `w-1/3${hideText ? ' mx-auto' : ''}` : undefined}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  );
  if (!landscape || !onBack) return body;
  return (
    <div className="egg-stock-layout" data-collapsed="true">
      {/* 横屏空态（未登录 / 未入组 / 读失败）：卡片在整个内容区正中，不贴着左上角 */}
      <div className="egg-stock-main stock-empty-center flex min-w-0 flex-col gap-2">{body}</div>
      <aside className="egg-stock-rail" data-testid="egg-stock-rail" aria-label="蛋仓标题栏">
        <button
          type="button"
          onClick={onBack}
          title="返回家园"
          className="egg-stock-rail-back"
          data-testid="egg-stock-rail-back"
        >返回家园</button>
        <h2 className="egg-stock-rail-title" data-testid="egg-stock-rail-title">我的蛋仓</h2>
      </aside>
    </div>
  );
}

/**
 * 家园页的「蛋仓」屏（2026-11-22 用户口径）。
 *
 * 和「组内广场 → 蛋仓」是同一份数据、同一个面板：进来时按当前小组把本机采集的
 * 背包蛋 / 家园蛋补同步一次，标注改完也同步回去。所以这里不另存一份本机蛋仓。
 * **是页内的一屏，不是悬浮窗**：由家园页的 view 切换进来，靠顶栏「返回家园」出去。
 * 没登录 / 没加入小组时说明原因并给出口，不让用户对着空列表猜。
 */
export interface EggStockViewProps {
  snapshots: readonly AccountSnapshot[];
  onGoGroups?: () => void;
  onGoAccount?: () => void;
  /** 回家园页（横屏标题栏里的「返回家园」） */
  onBack?: () => void;
  /**
   * 「我的蛋仓」标题行里放角色筛选的位置（Home 提供）。
   * 竖屏时把选择器挂进去，横屏标题在右侧栏、改由面板筛选栏出选择器。
   */
  headerSlot?: HTMLElement | null;
}

function StockBody({ groupId, me, snapshots, onBack, headerSlot }: {
  groupId: string;
  me: string;
  snapshots: readonly AccountSnapshot[];
  onBack?: () => void;
  headerSlot?: HTMLElement | null;
}) {
  const api = useEggMatching(groupId, me);
  const sync = useEggStockSync({ api, groupId, me, snapshots });
  const landscape = useLandscape();
  /** '' = 全部角色；同一账号下多个游戏号时才有意义（2026-11-23 用户口径）。 */
  const [character, setCharacter] = useState('');
  const myEggs = useMemo(
    () => (api.data?.state.eggs ?? []).filter((egg) => egg.accountId === me && egg.status !== 'transferred'),
    [api.data, me],
  );
  const characters = useMemo(() => eggCharactersOf(myEggs, snapshots), [myEggs, snapshots]);
  useEffect(() => {
    // 换组 / 蛋换走了：选中的角色不在蛋仓里了就回到「全部角色」，别让屏幕空着。
    if (character && !characters.some((item) => item.key === character)) setCharacter('');
  }, [character, characters]);
  const characterSelect = characters.length > 1
    ? <EggCharacterSelect value={character} characters={characters} onChange={setCharacter} />
    : null;
  return (
    <div className="flex flex-col gap-2" data-testid="egg-stock-body">
      {headerSlot && !landscape && characterSelect ? createPortal(characterSelect, headerSlot) : null}
      {sync.syncError ? (
        <div role="alert" className="flex items-center justify-between rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
          <span>蛋仓同步失败：{sync.syncError}</span>
          <Button size="sm" variant="text" disabled={api.busy} onClick={() => sync.retrySync()}>重试同步</Button>
        </div>
      ) : null}
      {api.error ? (
        <div role="alert" className="flex items-center justify-between rounded-lg bg-rose-50 p-2 text-xs text-rose-700">
          <span>{api.error}</span>
          <Button size="sm" variant="text" onClick={() => void api.refresh()}>重试</Button>
        </div>
      ) : null}
      {!api.data ? (
        <p className="py-6 text-center text-xs text-slate-500">{api.loading ? '正在读取蛋仓…' : '蛋仓还没读出来，点上面的重试'}</p>
      ) : (
        <EggStockPanel
          eggs={myEggs}
          species={species}
          busy={api.busy}
          mutate={api.mutate}
          collapsibleFilterRail
          railBack={onBack?{onClick:onBack}:undefined}
          character={character}
          characters={characters}
          onCharacterChange={setCharacter}
        />
      )}
    </div>
  );
}

export function EggStockView({ snapshots, onGoGroups, onGoAccount, onBack, headerSlot }: EggStockViewProps) {
  /**
   * 成员资格以**服务端返回的组列表**为准（2026-11-23 F2 线上 bug）。
   *
   * 以前用 `readCurrentGroupId()` 判空——那只是「上次在组内广场选了哪个组」的本机偏好：
   * 账号在组里、但这台设备从没进过组内广场时本地没有记录，整屏会被误拦成「先加入一个小组」。
   * 组内广场用的是这份 hook，`groups` 才是权威来源。
   */
  const mothers = useMotherGroups({
    snapshots: useMemo(() => [...snapshots], [snapshots]),
    species,
    catalogVersion: CATALOG_VERSION,
  });
  const { accountId, groups, groupsLoaded, currentGroupId, loading, error } = mothers;

  /**
   * 有小组：取当前组；本机记住的组不在列表里（退出 / 解散 / 换号）就回落到第一个，
   * 绝不拿一个服务端不认的组去拉蛋仓。列表没回来之前先不认组，等它回来再定。
   */
  const groupId = useMemo(() => {
    if (!groupsLoaded) return null;
    return groups.find((group) => group.id === currentGroupId)?.id ?? groups[0]?.id ?? null;
  }, [currentGroupId, groups, groupsLoaded]);

  // 有小组但本机没记住（或记的不是列表里的）：把回落的组记下来，下次进来不用再等列表。
  useEffect(() => {
    if (!accountId || !groupId || groupId === currentGroupId) return;
    saveCurrentGroupId(accountId, groupId);
  }, [accountId, currentGroupId, groupId]);

  /**
   * 只有「未登录」和「服务端确实一个组都没有」才算空态：加载中、列表读失败都不抹分页记忆，
   * 否则网络慢一次就把用户「上次停在蛋仓」冲掉（E1 的约束，别回退）。
   */
  const empty = !accountId || (groupsLoaded && !groupId);
  useEffect(() => {
    if (empty) forgetEggStockView();
  }, [empty]);

  return (
    <section className={CARD} data-testid="home-egg-stock-view">
      {!accountId ? (
        <EmptyStockState
          testId="egg-stock-need-account"
          reason="蛋仓跟着账号走：先登录，蛋仓才会和组内广场那边对得上。"
          action={onGoAccount ? { label: '去登录', onClick: onGoAccount } : undefined}
          onBack={onBack}
          hideReason
        />
      ) : groupId ? (
        <StockBody
          key={`${groupId}:${accountId}`}
          groupId={groupId}
          me={accountId}
          snapshots={snapshots}
          onBack={onBack}
          headerSlot={headerSlot}
        />
      ) : groupsLoaded ? (
        <EmptyStockState
          testId="egg-stock-need-group"
          reason="蛋仓按小组同步：先加入一个小组，蛋仓才能收集和换出去。"
          action={onGoGroups ? { label: '去组内广场', onClick: onGoGroups } : undefined}
          onBack={onBack}
        />
      ) : error ? (
        <EmptyStockState
          testId="egg-stock-group-error"
          reason={`小组信息没读出来：${error}`}
          action={{ label: '重试', onClick: () => void mothers.refresh() }}
          onBack={onBack}
        />
      ) : (
        // 组列表还在路上：只说读取中，不先闪「先加入一个小组」。
        <p className="text-xs text-slate-600" data-testid="egg-stock-loading-groups">
          {loading ? '正在读取你的小组…' : '小组列表还没读出来，稍等一下'}
        </p>
      )}
    </section>
  );
}
