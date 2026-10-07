export interface GenderMarkProps {
  gender: '公' | '母' | '未知';
}

/** 性别符号：♂ 蓝、♀ 粉；未知给个灰问号。各处列表统一用它，避免各写一套颜色。 */
export function GenderMark({ gender }: GenderMarkProps) {
  if (gender === '公') return <span className="text-sky-600" title="公">♂</span>;
  if (gender === '母') return <span className="text-pink-500" title="母">♀</span>;
  return <span className="text-slate-400" title="性别未知">?</span>;
}
