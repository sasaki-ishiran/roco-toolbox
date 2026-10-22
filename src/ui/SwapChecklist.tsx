import { useMemo, useState } from 'react';
import { species } from '../data/catalog';
import {
  BIG_WAN_CRITERIA,
  buildMotherChecklist,
  type ChecklistItem,
} from '../domain/swapChecklist';
import { patchChecklistItem, useSwapChecklist } from './swapChecklistStore';
import { useOwnedPets } from './useOwnedPets';
import { useSwapChecklistSync } from './useSwapChecklistSync';

type Tab = 'he' | 'me' | 'none';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'he', label: '他能给我孵' },
  { id: 'me', label: '我能给他孵' },
  { id: 'none', label: '双方都没有' },
];

/**
 * 「互换清单」：按账号阵营算三份大婉母本名单，两个人用分享码共享勾选与归属。
 *
 * 名单里的「我」始终指**发布方**（手里有全部数据的那台设备）；
 * 加入方这边会把「我/他」反着翻译，保证各自看到的都是「对方能给我孵什么」。
 */
export function SwapChecklist() {
  const { owned, accounts } = useOwnedPets();
  const state = useSwapChecklist();
  const sync = useSwapChecklistSync();

  const [tab, setTab] = useState<Tab>('he');
  const [selected, setSelected] = useState<string[]>(state.mineAccounts);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPublisher = state.role === 'publisher';
  const lists = state.lists;

  /** 名单里的 'mine' / 'theirs' 是发布方视角，这里翻译成本机视角 */
  const myOwner = isPublisher ? 'mine' : 'theirs';
  const otherOwner = isPublisher ? 'theirs' : 'mine';

  const visible = useMemo(() => {
    if (!lists) return { he: [], me: [], none: [] };
    return {
      he: isPublisher ? lists.heCanHatch : lists.iCanHatch,
      me: isPublisher ? lists.iCanHatch : lists.heCanHatch,
      none: lists.neither,
    };
  }, [lists, isPublisher]);

  const doPublish = async () => {
    if (selected.length === 0) {
      setError('先选一下你有哪些号');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const computed = buildMotherChecklist({
        species,
        owned,
        mineAccounts: selected,
        criteria: BIG_WAN_CRITERIA,
      });
      await sync.publish(selected, computed);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布失败');
    } finally {
      setBusy(false);
    }
  };

  const doJoin = async () => {
    if (!joinCode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await sync.join(joinCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加入失败');
    } finally {
      setBusy(false);
    }
  };

  /* ---------- 还没共享：先选号 / 输分享码 ---------- */
  if (!state.code) {
    return (
      <section className="space-y-3" data-testid="swap-checklist-setup">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-sm font-medium text-slate-500">互换清单 · 先选你有哪些号</h2>
          <p className="mt-1 text-xs text-slate-400">
            选中的号算「我方」，其余算「对方」。名单由你这边生成，对方用分享码就能看到。
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {accounts.map((account) => {
              const on = selected.includes(account);
              return (
                <button
                  key={account}
                  type="button"
                  onClick={() =>
                    setSelected((prev) =>
                      prev.includes(account)
                        ? prev.filter((item) => item !== account)
                        : [...prev, account],
                    )
                  }
                  aria-pressed={on}
                  className={`min-h-[36px] rounded-full border px-3 text-xs ${
                    on
                      ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
                      : 'border-slate-200 bg-white text-slate-500'
                  }`}
                >
                  {account}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => void doPublish()}
            disabled={busy}
            className="mt-3 min-h-[40px] w-full rounded-xl bg-emerald-600 text-sm font-medium text-white disabled:opacity-60"
            data-testid="swap-checklist-publish"
          >
            {busy ? '正在生成…' : '生成分享码并发布'}
          </button>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-sm font-medium text-slate-500">或者：加入对方的清单</h2>
          <div className="mt-2 flex gap-2">
            <input
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
              placeholder="输入 8 位分享码"
              maxLength={8}
              className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm uppercase tracking-widest"
              data-testid="swap-checklist-code-input"
            />
            <button
              type="button"
              onClick={() => void doJoin()}
              disabled={busy}
              className="min-h-[40px] shrink-0 rounded-xl border border-emerald-500 px-4 text-sm text-emerald-700 disabled:opacity-60"
              data-testid="swap-checklist-join"
            >
              加入
            </button>
          </div>
        </div>

        {error ? <p className="text-xs text-rose-600">{error}</p> : null}
      </section>
    );
  }

  /* ---------- 已共享 ---------- */
  const current = visible[tab];
  const doneOf = (items: ChecklistItem[]) =>
    items.filter((item) => state.items[String(item.eggGameId)]?.done).length;
  const ownerLabel = (owner: string | null | undefined): string =>
    owner === myOwner ? '我方' : owner === otherOwner ? '对方' : '';

  return (
    <section className="space-y-3" data-testid="swap-checklist">
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-slate-500">互换清单</h2>
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(state.code)}
            className="min-h-[32px] rounded-full border border-slate-200 px-3 text-xs text-slate-600"
          >
            复制分享码
          </button>
        </div>
        <p className="mt-1 font-mono text-lg font-semibold tracking-[0.3em] text-slate-800">
          {state.code}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {state.syncError
            ? `未同步：${state.syncError}`
            : state.lastSyncAt
              ? '已同步 · 每 15 秒自动更新'
              : '正在同步…'}
        </p>
        <button
          type="button"
          onClick={sync.leave}
          className="mt-2 text-xs text-slate-400 underline"
        >
          退出共享
        </button>
      </div>

      <div className="flex gap-1 rounded-xl bg-slate-100 p-1" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`min-h-[36px] flex-1 rounded-lg px-1 text-[11px] ${
              tab === item.id ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500'
            }`}
            data-testid={`swap-checklist-tab-${item.id}`}
          >
            {item.label} {doneOf(visible[item.id])}/{visible[item.id].length}
          </button>
        ))}
      </div>

      <div className="rounded-2xl bg-white p-3 shadow-sm">
        {current.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">这一页没有条目</p>
        ) : (
          <ul className="space-y-1">
            {current.map((item) => {
              const key = String(item.eggGameId);
              const entry = state.items[key];
              const done = entry?.done === true;
              return (
                <li
                  key={key}
                  className={`flex items-center gap-2 rounded-lg px-2 py-2 text-sm ${
                    done ? 'bg-emerald-50 text-slate-400 line-through' : 'bg-slate-50 text-slate-700'
                  }`}
                  data-testid="swap-checklist-item"
                >
                  <button
                    type="button"
                    onClick={() => patchChecklistItem(key, { done: !done })}
                    aria-pressed={done}
                    aria-label={`${done ? '取消' : '标记'} ${item.name} 已收到`}
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs ${
                      done
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-slate-300 bg-white text-transparent'
                    }`}
                  >
                    ✓
                  </button>
                  <span className="min-w-0 flex-1">
                    {item.name}
                    {item.accounts.length > 0 ? (
                      <span className="ml-1 text-[11px] text-slate-400">
                        母本在 {item.accounts.join('、')}
                      </span>
                    ) : null}
                  </span>
                  {tab === 'none' ? (
                    <span className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          patchChecklistItem(key, {
                            owner: entry?.owner === myOwner ? null : myOwner,
                          })
                        }
                        aria-pressed={entry?.owner === myOwner}
                        className={`rounded-full border px-2 py-1 text-[10px] ${
                          entry?.owner === myOwner
                            ? 'border-emerald-600 bg-emerald-600 text-white'
                            : 'border-slate-200 bg-white text-slate-500'
                        }`}
                      >
                        我收
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          patchChecklistItem(key, {
                            owner: entry?.owner === otherOwner ? null : otherOwner,
                          })
                        }
                        aria-pressed={entry?.owner === otherOwner}
                        className={`rounded-full border px-2 py-1 text-[10px] ${
                          entry?.owner === otherOwner
                            ? 'border-slate-600 bg-slate-600 text-white'
                            : 'border-slate-200 bg-white text-slate-500'
                        }`}
                      >
                        对方收
                      </button>
                    </span>
                  ) : ownerLabel(entry?.owner) ? (
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-500">
                      {ownerLabel(entry?.owner)}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
