import type { RadarData } from '../pcap/nearbyRadar';

/** 稀有牌子 → 雷达点颜色（与列表牌子保持同一套语义）。 */
const KIND_COLOR: Record<string, string> = {
  pollution: '#7c3aed',
  shiny: '#f59e0b',
  colorful: '#ec4899',
  big: '#0ea5e9',
  small: '#0ea5e9',
  high: '#059669',
  low: '#059669',
};
const KIND_PRIORITY = ['pollution', 'shiny', 'colorful', 'big', 'small', 'high', 'low'];

function colorOf(kinds: readonly string[]): string {
  for (const kind of KIND_PRIORITY) if (kinds.includes(kind)) return KIND_COLOR[kind];
  return '#475569';
}

const KIND_LABEL: Record<string, string> = {
  colorful: '炫彩', shiny: '异色', pollution: '污染',
  big: '大块头', small: '小不点',
};
/** 声音不再输出「婉转声 / 粗嗓门」分类词，直接给分贝值（2026-11-10 用户要求） */
const kindText = (kinds: readonly string[]) => kinds
  .filter((kind) => kind !== 'high' && kind !== 'low')
  .map((kind) => KIND_LABEL[kind] || kind)
  .join('·');

export interface NearbyRadarProps {
  radar: RadarData;
  /** 覆盖 svg 尺寸；默认铺满父容器（正方形由父容器控制） */
  className?: string;
}

/**
 * 附近精灵雷达（2026-11-06）。
 *
 * 中心是估算自身位置（精灵帧间位移里程计），不是玩家真实坐标；
 * 视野半径固定 115 m（见 buildRadar 的 radiusM），靠近时点位会真正向内收。
 */
export function NearbyRadar({ radar, className }: NearbyRadarProps) {
  if (radar.points.length === 0) {
    return (
      <div className={`flex items-center justify-center rounded-xl bg-slate-50 text-xs text-slate-500 ${className ?? 'aspect-square w-full'}`}>
        等待附近精灵进入视野
      </div>
    );
  }
  const center = 150;
  const radius = 120;
  const rings = [0.25, 0.5, 0.75, 1];
  // 稀有名字最多标 6 个，避免互相压住；其它点靠 title 提示。
  const labeled = radar.points.filter((point) => point.rare).slice(0, 6);
  return (
    <svg
      viewBox="0 0 300 300"
      preserveAspectRatio="xMidYMid meet"
      className={className ?? 'block aspect-square h-auto w-full'}
      role="img"
      aria-label="附近精灵雷达"
    >
      <circle cx={center} cy={center} r={radius} fill="#ecfdf5" stroke="#d1fae5" />
      {rings.map((ratio) => (
        <circle
          key={ratio}
          cx={center}
          cy={center}
          r={radius * ratio}
          fill="none"
          stroke="#a7f3d0"
          strokeDasharray={ratio === 1 ? undefined : '3 3'}
        />
      ))}
      <line x1={center} y1={center - radius} x2={center} y2={center + radius} stroke="#d1fae5" />
      <line x1={center - radius} y1={center} x2={center + radius} y2={center} stroke="#d1fae5" />
      {/* 有朝向时正上方是人物面朝方向，不能再标「北」（2026-11-10） */}
      <text x={center} y={16} textAnchor="middle" fontSize="10" fill="#94a3b8">{radar.heading == null ? '北 ↑' : '朝向 ↑'}</text>
      {rings.map((ratio) => (
        <text
          key={`label-${ratio}`}
          x={center + 5}
          y={center - radius * ratio + 4}
          fontSize="9"
          fill="#64748b"
        >
          {`${Math.round(radar.maxDistanceM * ratio)}m`}
        </text>
      ))}
      {radar.points.map((point) => {
        const cx = center + Math.max(-1, Math.min(1, point.nx)) * radius;
        const cy = center + Math.max(-1, Math.min(1, point.ny)) * radius;
        const detail = [
          `${point.name} ${point.level}级`,
          point.gender ? `${point.gender}` : '',
          point.nature ? `性格 ${point.nature}` : '',
          kindText(point.kinds),
          point.voiceDb == null ? '' : `${point.voiceDb > 0 ? '+' : ''}${Math.round(point.voiceDb)}dB`,
          `${point.distanceM.toFixed(1)}m ${point.bearingLabel}`,
        ].filter(Boolean).join(' · ');
        return (
          <g key={point.key}>
            {point.alert ? <circle cx={cx} cy={cy} r={9} fill="none" stroke="#e11d48" strokeWidth={2} /> : null}
            <circle cx={cx} cy={cy} r={6} fill={colorOf(point.kinds)} stroke="#ffffff" strokeWidth={1.5}>
              <title>{detail}</title>
            </circle>
          </g>
        );
      })}
      {labeled.map((point) => (
        <text
          key={`name-${point.key}`}
          x={center + Math.max(-1, Math.min(1, point.nx)) * radius + 8}
          y={center + Math.max(-1, Math.min(1, point.ny)) * radius + 3}
          fontSize="9"
          fill="#0f172a"
        >
          {point.name}
        </text>
      ))}
    </svg>
  );
}
