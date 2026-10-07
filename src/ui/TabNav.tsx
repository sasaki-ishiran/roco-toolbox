export type TabId = 'dashboard' | 'import' | 'myPets' | 'coverage' | 'swap';

export interface TabNavProps {
  active: TabId;
  onChange: (tab: TabId) => void;
}

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'dashboard', label: '看板' },
  { id: 'myPets', label: '我的精灵' },
  { id: 'coverage', label: '覆盖度' },
  { id: 'swap', label: '换什么' },
  { id: 'import', label: '导入数据' },
];

export function TabNav({ active, onChange }: TabNavProps) {
  return (
    <nav className="flex border-b border-slate-100 bg-white px-2">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`min-h-[44px] flex-1 border-b-2 px-2 text-sm font-medium ${
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
