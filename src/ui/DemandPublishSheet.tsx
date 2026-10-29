import { useEffect, useState } from 'react';
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

/** 八大性格放前面，其余收进「更多性格」（2026-10-26 用户口径）。 */
const PRIMARY_NATURES = targetNaturePool.map((nature) => nature.name);
const EXTRA_NATURES = allNatureNames.filter((nature) => !PRIMARY_NATURES.includes(nature));

const GENDER_LABELS: Record<DemandGender, string> = { 母: '母', 公: '公', '': '不挑' };
const BODY_LABELS: Record<DemandBody, string> = { 大块头: '大块头', 小不点: '小不点', '': '不限' };
const VOICE_LABELS: Record<DemandVoice, string> = {
  '+100': '+100',
  '-100': '-100',
  婉转声: '婉转声',
  粗嗓门: '粗嗓门',
  '': '不限',
};

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
}

export interface DemandPublishSheetProps {
  open: boolean;
  items: DemandPublishItem[];
  busy?: boolean;
  error?: string;
  /** 数据不全 / 组内暂时无法确认时的提示；不阻断发布。 */
  warning?: string;
  defaultCriteria?: DemandCriteriaDraft;
  onClose: () => void;
  onConfirm: (items: Array<{ eggGameId: number; natures: string[] }>, criteria: DemandCriteriaDraft) => void;
}

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
  onClose,
  onConfirm,
}: DemandPublishSheetProps) {
  const [draft, setDraft] = useState<Record<number, string[]>>({});
  /** 展开「更多性格」的精灵（按蛋 id）：只展开点的那一只，不连带其他精灵。 */
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [gender, setGender] = useState<DemandGender>(defaultCriteria?.gender ?? DEFAULT_DEMAND_GENDER);
  const [body, setBody] = useState<DemandBody>(defaultCriteria?.body ?? DEFAULT_DEMAND_BODY);
  const [voice, setVoice] = useState<DemandVoice>(defaultCriteria?.voice ?? DEFAULT_DEMAND_VOICE);

  // 每次打开按 items 的默认性格与当前目标口径重置草稿，避免带上一次的选择。
  // 依赖按字段拆开：父组件每次渲染都会新建 defaultCriteria 对象，用对象当依赖会把草稿重置掉。
  useEffect(() => {
    if (!open) return;
    setExpanded(new Set());
    setDraft(Object.fromEntries(items.map((item) => [item.eggGameId, [...item.natures]])));
    setGender(defaultCriteria?.gender ?? DEFAULT_DEMAND_GENDER);
    setBody(defaultCriteria?.body ?? DEFAULT_DEMAND_BODY);
    setVoice(defaultCriteria?.voice ?? DEFAULT_DEMAND_VOICE);
  }, [open, items, defaultCriteria?.gender, defaultCriteria?.body, defaultCriteria?.voice]);

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
      title="发需求"
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
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              onConfirm(
                items.map((item) => ({
                  eggGameId: item.eggGameId,
                  natures: draft[item.eggGameId] ?? item.natures,
                })),
                { gender, body, voice },
              )
            }
            data-testid="demand-publish-confirm"
            className="min-h-[36px] flex-[2] rounded-lg bg-emerald-600 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? '发布中…' : `发布 ${totalCount} 条需求`}
          </button>
        </div>
      }
    >
      <div className="space-y-2 p-3" data-testid="demand-publish-body">
        <p className="text-[11px] leading-snug text-slate-400">
          给每颗蛋选性格，一个性格算一条需求；性别 / 体型 / 声音对本次选中的蛋统一生效。
          不选表示不挑 / 不限，只会校验你选了的字段。
        </p>
        <div className="space-y-1 rounded-lg bg-slate-50 px-2 py-1.5" data-testid="demand-publish-criteria">
          {optionRow('性别', DEMAND_GENDERS, gender, GENDER_LABELS, setGender, 'demand-gender')}
          {optionRow('体型', DEMAND_BODIES, body, BODY_LABELS, setBody, 'demand-body')}
          {optionRow('声音', DEMAND_VOICES, voice, VOICE_LABELS, setVoice, 'demand-voice')}
        </div>
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
    </ModalSurface>
  );
}
