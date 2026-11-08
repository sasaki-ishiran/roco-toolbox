import { useEffect, useMemo, useState } from 'react';
import { allNatureNames, targetNaturePool } from '../data/catalog';
import {
  DEFAULT_DEMAND_BODY,
  DEFAULT_DEMAND_GENDER,
  DEFAULT_DEMAND_VOICE,
  DEMAND_BODIES,
  DEMAND_GENDERS,
  DEMAND_NATURE_MAX,
  DEMAND_VOICES,
  type DemandBody,
  type DemandGender,
  type DemandVoice,
} from '../shared/collectionGroups';
import { ModalSurface } from './primitives/ModalSurface';
import { PetAvatar } from './PetAvatar';
import { SearchField } from './primitives/SearchField';
import { GREEN_NEST_ICON } from '../domain/petIcons';

/** 八大性格放前面，其余收进「更多性格」（2026-10-26 用户口径）。 */
const PRIMARY_NATURES = targetNaturePool.map((nature) => nature.name);
const EXTRA_NATURES = allNatureNames.filter((nature) => !PRIMARY_NATURES.includes(nature));

export const GENDER_LABELS: Record<DemandGender, string> = { 母: '母', 公: '公', '': '不挑' };
export const BODY_LABELS: Record<DemandBody, string> = {
  大块头: '大块头',
  小不点: '小不点',
  满体重: '满体重',
  零体重: '零体重',
  '': '不限',
};
export const VOICE_LABELS: Record<DemandVoice, string> = {
  '+100': '+100',
  '-100': '-100',
  婉转声: '婉转声',
  粗嗓门: '粗嗓门',
  '': '不限',
};
/** 体型 / 声音必须二选一：发需求不再提供「不限」（2026-10-30 用户口径）。 */
export const PICKABLE_BODIES = DEMAND_BODIES.filter((body) => body !== '');
export const PICKABLE_VOICES = DEMAND_VOICES.filter((voice) => voice !== '');

export interface DemandPublishItem {
  eggGameId: number;
  name: string;
  /** 默认性格（本地推荐），进来时可被改。 */
  natures: string[];
}

export interface DemandCriteriaDraft {
  gender: DemandGender;
  body: DemandBody;
  voice: DemandVoice;
  /** 要求这对亲本进学院小窝（绿窝，性格 100%）；默认不要求（2026-11-01）。 */
  requireGreenNest?: boolean;
}

export interface DemandPublishSheetProps {
  open: boolean;
  items: DemandPublishItem[];
  busy?: boolean;
  error?: string;
  /** 数据不全 / 组内暂时无法确认时的提示；不阻断发布。 */
  warning?: string;
  defaultCriteria?: DemandCriteriaDraft;
  /**
   * 'publish'（默认）= 发需求：挑性格 + 性别 / 体型 / 声音；
   * 'wish' = 添加想收：只选蛋，多选落「想收」，不填五字段。
   */
  mode?: 'publish' | 'wish';
  /** wish 模式的全图鉴蛋列表（含我已有的蛋）；publish 模式忽略。 */
  catalog?: readonly WishEggOption[];
  /** wish 模式的缺口蛋 id：「只看缺口」默认筛它，快捷按钮也用它。 */
  gapEggIds?: readonly number[];
  onClose: () => void;
  onConfirm: (items: Array<{ eggGameId: number; natures: string[] }>, criteria: DemandCriteriaDraft) => void;
  /** wish 模式确认：多选结果一次落库为想收。 */
  onAddWish?: (eggGameIds: number[]) => void;
}

/** wish 模式的一颗蛋：名字 + 蛋搜索索引（形态名 / 图鉴号，搜「火神」能命中「火花」那颗蛋）。 */
export interface WishEggOption {
  eggGameId: number;
  name: string;
  keywords?: string;
}

/** 一次最多铺多少颗蛋：全图鉴上千颗，先给一屏多，剩下的靠搜索找。 */
const WISH_GRID_MAX = 60;

/**
 * 发需求确认弹层：先挑性格，再挑性别 / 体型 / 声音。
 *
 * 一条需求 = 一颗蛋 + 一个性格 + 性别 + 体型 + 声音；
 * 勾 2 个性格就是 2 条。空值表示不挑 / 不限，服务端按「跳过该字段」处理。
 */
export function DemandPublishSheet({
  open,
  items,
  busy = false,
  error = '',
  warning = '',
  defaultCriteria,
  mode = 'publish',
  catalog = [],
  gapEggIds = [],
  onClose,
  onConfirm,
  onAddWish,
}: DemandPublishSheetProps) {
  const wish = mode === 'wish';
  const [draft, setDraft] = useState<Record<number, string[]>>({});
  /** 展开「更多性格」的精灵（按蛋 id）：只展开点的那一只，不连带其他精灵。 */
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [gender, setGender] = useState<DemandGender>(defaultCriteria?.gender ?? DEFAULT_DEMAND_GENDER);
  const [body, setBody] = useState<DemandBody>(defaultCriteria?.body || DEFAULT_DEMAND_BODY);
  const [voice, setVoice] = useState<DemandVoice>(defaultCriteria?.voice || DEFAULT_DEMAND_VOICE);
  const [requireGreenNest, setRequireGreenNest] = useState(defaultCriteria?.requireGreenNest === true);
  /** wish 模式：已选的蛋、搜索词、「只看缺口」（默认开）。 */
  const [pickedEggs, setPickedEggs] = useState<number[]>([]);
  const [query, setQuery] = useState('');
  const [onlyGaps, setOnlyGaps] = useState(true);

  // 发需求：每次打开按 items 的默认性格与当前目标口径重置草稿，避免带上一次的选择。
  // 依赖按字段拆开：父组件每次渲染都会新建 defaultCriteria 对象，用对象当依赖会把草稿重置掉。
  // items 同理只取「蛋 id 串」当依赖：收集页 30s 轮询换新数组时，不能把用户刚改的性别/性格重置回默认。
  const eggIdsKey = items.map((item) => item.eggGameId).join(',');
  useEffect(() => {
    if (!open || wish) return;
    setExpanded(new Set());
    setDraft(Object.fromEntries(items.map((item) => [item.eggGameId, [...item.natures]])));
    setGender(defaultCriteria?.gender ?? DEFAULT_DEMAND_GENDER);
    setBody(defaultCriteria?.body || DEFAULT_DEMAND_BODY);
    setVoice(defaultCriteria?.voice || DEFAULT_DEMAND_VOICE);
    setRequireGreenNest(defaultCriteria?.requireGreenNest === true);
  }, [
    open,
    wish,
    eggIdsKey,
    defaultCriteria?.gender,
    defaultCriteria?.body,
    defaultCriteria?.voice,
    defaultCriteria?.requireGreenNest,
  ]);

  // 添加想收：只跟「打开 / 模式」走，不跟父组件传进来的 items 走。
  // 否则父组件刷新一次（items 是新数组）就会把已经勾好的蛋全部清空。
  useEffect(() => {
    if (!open || !wish) return;
    setPickedEggs([]);
    setQuery('');
    setOnlyGaps(true);
  }, [open, wish]);

  /** wish 模式可见的蛋：只看缺口 / 搜索（蛋名、形态名、图鉴号）。 */
  const wishPool = useMemo(() => {
    if (!wish) return [];
    const gaps = new Set(gapEggIds);
    const keyword = query.trim().toLowerCase();
    return catalog.filter(
      (item) =>
        (!onlyGaps || gaps.has(item.eggGameId)) &&
        (!keyword ||
          item.name.toLowerCase().includes(keyword) ||
          (item.keywords ?? '').includes(keyword)),
    );
  }, [wish, catalog, gapEggIds, onlyGaps, query]);
  const wishVisible = wishPool.slice(0, WISH_GRID_MAX);

  const toggleEgg = (eggGameId: number) => {
    setPickedEggs((current) =>
      current.includes(eggGameId)
        ? current.filter((id) => id !== eggGameId)
        : [...current, eggGameId],
    );
  };

  const toggle = (eggGameId: number, nature: string) => {
    setDraft((current) => {
      const picked = current[eggGameId] ?? [];
      if (picked.includes(nature)) {
        return { ...current, [eggGameId]: picked.filter((item) => item !== nature) };
      }
      if (picked.length >= DEMAND_NATURE_MAX) return current;
      return { ...current, [eggGameId]: [...picked, nature] };
    });
  };

  const totalCount = items.reduce(
    (sum, item) => sum + Math.max(1, (draft[item.eggGameId] ?? item.natures).length),
    0,
  );
  /** 绿窝靠自带目标性格的母本 100% 遗传，一个性格都没选时不能发。 */
  const pickedNatureCount = items.reduce(
    (sum, item) => sum + (draft[item.eggGameId] ?? item.natures).length,
    0,
  );
  const greenNestNeedsNature = requireGreenNest && pickedNatureCount === 0;

  const optionRow = <T extends string>(
    label: string,
    values: readonly T[],
    current: T,
    labels: Record<T, string>,
    onPick: (value: T) => void,
    testPrefix: string,
  ) => (
    <div className="flex items-center gap-1">
      <span className="w-8 shrink-0 text-[11px] text-slate-400">{label}</span>
      {values.map((value) => (
        <button
          key={`${testPrefix}:${value || 'any'}`}
          type="button"
          aria-pressed={current === value}
          onClick={() => onPick(value)}
          data-testid={`${testPrefix}-${value || 'any'}`}
          className={`min-h-[26px] rounded-md border px-1.5 text-xs ${
            current === value
              ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
              : 'border-slate-200 bg-white text-slate-500'
          }`}
        >
          {labels[value]}
        </button>
      ))}
    </div>
  );

  return (
    <ModalSurface
      open={open}
      title={wish ? '添加想收' : '发需求'}
      placement="sheet"
      onClose={onClose}
      testId="demand-publish"
      closeTestId="demand-publish-close"
      backdropTestId="demand-publish-backdrop"
      footer={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            data-testid="demand-publish-cancel"
            className="min-h-[36px] flex-1 rounded-lg border border-slate-200 text-sm text-slate-500"
          >
            取消
          </button>
          {wish ? (
            <button
              type="button"
              disabled={busy || pickedEggs.length === 0}
              onClick={() => onAddWish?.(pickedEggs)}
              data-testid="demand-publish-confirm"
              className="min-h-[36px] flex-[2] rounded-lg bg-emerald-600 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? '添加中…' : `添加 ${pickedEggs.length} 条想收`}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || greenNestNeedsNature}
              onClick={() =>
                onConfirm(
                  items.map((item) => ({
                    eggGameId: item.eggGameId,
                    natures: draft[item.eggGameId] ?? item.natures,
                  })),
                  { gender, body, voice, requireGreenNest },
                )
              }
              data-testid="demand-publish-confirm"
              className="min-h-[36px] flex-[2] rounded-lg bg-emerald-600 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? '发布中…' : `发布 ${totalCount} 条需求`}
            </button>
          )}
        </div>
      }
    >
      {wish ? (
        <div className="space-y-2 p-3" data-testid="demand-publish-body">
          <SearchField
            label="搜索精灵"
            value={query}
            onValueChange={setQuery}
            placeholder="搜精灵名 / 图鉴号"
            testId="wish-search"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-pressed={onlyGaps}
              onClick={() => setOnlyGaps((value) => !value)}
              data-testid="wish-only-gaps"
              className={`min-h-[26px] rounded-md border px-2 text-xs ${
                onlyGaps
                  ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-500'
              }`}
            >
              只看缺口
            </button>
            <span className="text-[11px] text-slate-400" data-testid="wish-count">
              {wishPool.length} 颗
            </span>
            <button
              type="button"
              disabled={gapEggIds.length === 0}
              onClick={() => setPickedEggs([...gapEggIds])}
              data-testid="wish-fill-gaps"
              className="ml-auto min-h-[26px] rounded-md border border-emerald-200 px-2 text-[11px] font-semibold text-emerald-700 disabled:opacity-50"
            >
              {/* copy-lint-ignore 用户定稿要求写明「按你的口径算的全部缺口」 */}
              按你的口径算的全部缺口（{gapEggIds.length}）
            </button>
          </div>
          {wishVisible.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-2 py-3 text-center text-[11px] text-slate-400">
              没有符合条件的蛋，换个词试试
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-1.5" data-testid="wish-grid">
              {wishVisible.map((item) => {
                const on = pickedEggs.includes(item.eggGameId);
                return (
                  <button
                    key={item.eggGameId}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleEgg(item.eggGameId)}
                    data-testid={`wish-egg-${item.eggGameId}`}
                    className={`flex min-w-0 flex-col items-center rounded-lg px-1 py-1.5 ${
                      on ? 'bg-emerald-50 ring-1 ring-emerald-500' : 'bg-slate-50'
                    }`}
                  >
                    <PetAvatar gameId={item.eggGameId} name={item.name} size={32} />
                    <p
                      className={`mt-0.5 line-clamp-2 h-[26px] w-full break-words text-center text-[10px] leading-tight ${
                        on ? 'font-semibold text-emerald-700' : 'font-medium text-slate-700'
                      }`}
                      title={item.name}
                    >
                      {item.name}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
          {wishPool.length > WISH_GRID_MAX ? (
            <p className="text-[11px] text-slate-400">
              还有 {wishPool.length - WISH_GRID_MAX} 颗，搜名字更快找到
            </p>
          ) : null}
          {error ? (
            <p className="text-[11px] text-rose-600" data-testid="demand-publish-error">{error}</p>
          ) : null}
        </div>
      ) : (
      <div className="space-y-2 p-3" data-testid="demand-publish-body">
        <p className="text-[11px] leading-snug text-slate-400">
          一个性格算一条需求；性别 / 体型 / 声音对选中的蛋统一生效。
        </p>
        <div className="space-y-1 rounded-lg bg-slate-50 px-2 py-1.5" data-testid="demand-publish-criteria">
          {optionRow('性别', DEMAND_GENDERS, gender, GENDER_LABELS, setGender, 'demand-gender')}
          {optionRow('体型', PICKABLE_BODIES, body, BODY_LABELS, setBody, 'demand-body')}
          {optionRow('声音', PICKABLE_VOICES, voice, VOICE_LABELS, setVoice, 'demand-voice')}
          <label
            className="flex min-h-[26px] items-center gap-1.5 text-[11px] text-slate-500"
            data-testid="demand-green-nest"
          >
            <input
              type="checkbox"
              checked={requireGreenNest}
              onChange={(event) => setRequireGreenNest(event.target.checked)}
              className="h-3.5 w-3.5 shrink-0 accent-emerald-600"
            />
            是否要求绿窝
            <img src={GREEN_NEST_ICON} alt="" className="h-[15px] w-auto" />
          </label>
        </div>
        {greenNestNeedsNature ? (
          <p
            className="rounded-lg bg-amber-50 px-2 py-1 text-[10px] leading-snug text-amber-800"
            data-testid="demand-green-nest-needs-nature"
          >
            要求绿窝需要先选一个性格：学院小窝靠那只自带目标性格 100% 遗传，不挑性格发不了绿窝。
          </p>
        ) : null}
        {warning ? (
          <p className="rounded-lg bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-800" data-testid="demand-publish-warning">
            {warning}
          </p>
        ) : null}
        {/* 2026-10-28：一行放 3 只精灵；每只带头像，常用性格按 3 列 × 3 行排。 */}
        <div className="grid grid-cols-3 gap-1.5">
        {items.map((item) => {
          const picked = draft[item.eggGameId] ?? item.natures;
          const itemExpanded = expanded.has(item.eggGameId);
          const visible = itemExpanded
            ? [...PRIMARY_NATURES, ...EXTRA_NATURES]
            : PRIMARY_NATURES;
          return (
            <div
              key={item.eggGameId}
              className="flex min-w-0 flex-col rounded-lg bg-slate-50 px-1 py-1.5"
              data-testid="demand-publish-item"
            >
              <div className="flex flex-col items-center">
                <PetAvatar gameId={item.eggGameId} name={item.name} size={32} />
                <p
                  className="mt-0.5 line-clamp-2 h-[26px] w-full break-words text-center text-[10px] font-medium leading-tight text-slate-700"
                  title={item.name}
                >
                  {item.name}
                </p>
              </div>
              <div
                className="mt-1 grid grid-cols-3 gap-1"
                data-testid="demand-publish-natures"
              >
                {visible.map((nature) => {
                  const on = picked.includes(nature);
                  return (
                    <button
                      key={nature}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(item.eggGameId, nature)}
                      data-testid={`demand-nature-${item.eggGameId}-${nature}`}
                      className={`min-h-[26px] rounded-md border px-0.5 text-[10px] leading-tight ${
                        on
                          ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
                          : 'border-slate-200 bg-white text-slate-500'
                      }`}
                    >
                      {nature}
                    </button>
                  );
                })}
              </div>
              {EXTRA_NATURES.length > 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((current) => {
                      const next = new Set(current);
                      if (next.has(item.eggGameId)) next.delete(item.eggGameId);
                      else next.add(item.eggGameId);
                      return next;
                    })
                  }
                  data-testid={`demand-nature-toggle-${item.eggGameId}`}
                  className="mt-1 min-h-[26px] rounded-md border border-dashed border-slate-300 px-0.5 text-[10px] text-slate-500"
                >
                  {itemExpanded ? '收起 ▴' : `更多 +${EXTRA_NATURES.length} ▾`}
                </button>
              ) : null}
            </div>
          );
        })}
        </div>
        {error ? (
          <p className="text-[11px] text-rose-600" data-testid="demand-publish-error">{error}</p>
        ) : null}
      </div>
      )}
    </ModalSurface>
  );
}
