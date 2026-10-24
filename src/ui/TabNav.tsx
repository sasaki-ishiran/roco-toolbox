import type { AppPage } from './navigation';

export type TabId = AppPage;

export interface TabNavProps {
  active: TabId;
  onChange: (tab: TabId) => void;
}

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'dashboard', label: '看板' },
  { id: 'collection', label: '收集' },
  { id: 'groups', label: '小组' },
  { id: 'profile', label: '我的' },
];

/** 四入口主导航（2026-10-24 重构任务 9）：看板 / 收集 / 小组 / 我的。 */
export function TabNav({ active, onChange }: TabNavProps) {
  return (
    <nav className="flex border-b border-slate-100 bg-white px-2">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          aria-current={active === tab.id ? 'page' : undefined}
          className={`min-h-[40px] flex-1 border-b-2 px-2 text-sm font-medium ${
            active === tab.id
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-500'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
