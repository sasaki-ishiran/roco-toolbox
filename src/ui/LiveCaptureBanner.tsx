import type { CaptureAnalysis, LiveNearbyPet } from '../collector/captureProgress';

export interface LiveCaptureBannerProps {
  analysis: CaptureAnalysis | null;
  sourceBytes: number;
}

const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
const KIND_LABEL: Record<string, string> = {
  colorful: '炫彩', shiny: '异色', pollution: '污染',
  big: '大块头', small: '小不点', high: '婉转声', low: '粗嗓门',
};
const kindText = (pet: LiveNearbyPet) => pet.kinds.map((kind) => KIND_LABEL[kind] || kind).join('·');
const natureText = (pet: LiveNearbyPet) => `${pet.gender || ''}${pet.nature ? ` ${pet.nature}` : ''}`.trim();

/** 附近列表只展示前 5 条：稀有优先，其次带提醒原因的。 */
function topNearby(nearby: LiveNearbyPet[] | undefined): LiveNearbyPet[] {
  return [...(nearby || [])]
    .sort((left, right) => Number(Boolean(right.alertReason)) - Number(Boolean(left.alertReason)) || Number(right.rare) - Number(left.rare))
    .slice(0, 5);
}

/**
 * 持续获取模式的实时条（2026-11-05）。
 * 只展示本次已解析到的数量与附近精灵；结果仍以停止后的正式导入为准。
 */
export function LiveCaptureBanner({ analysis, sourceBytes }: LiveCaptureBannerProps) {
  const nearby = topNearby(analysis?.nearby);
  const rareCount = (analysis?.nearby || []).filter((pet) => pet.rare).length;
  return (
    <div className="rounded-xl bg-emerald-50 px-3 py-2" data-testid="live-capture-banner">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-emerald-800">持续获取中 · 实时更新</p>
            <p className="text-xs text-emerald-700">
              精灵 {analysis?.records ?? 0} 只 · 盒子 {analysis?.boxes ?? 0} 个 · 蛋 {analysis?.eggRecords ?? 0} 个
              {(analysis?.nearbyPets ?? 0) > 0 ? ` · 附近 ${analysis!.nearbyPets} 只（稀有 ${rareCount}）` : ''}
            </p>
          </div>
        </div>
        {sourceBytes > 0 ? <p className="text-xs text-emerald-700">{mib(sourceBytes)}</p> : null}
      </div>
      {nearby.length ? <ul className="mt-1.5 space-y-0.5" aria-label="附近精灵">
        {nearby.map((pet) => <li key={pet.key} className="flex items-center justify-between gap-2 text-xs">
          <span className={pet.rare ? 'font-semibold text-emerald-900' : 'text-emerald-800'}>
            {pet.name} {pet.level}级
            <span className="ml-1 text-emerald-600">{natureText(pet) ? `${natureText(pet)} · ` : ''}{kindText(pet)}{pet.voiceDb ? ` ${pet.voiceDb > 0 ? '+' : ''}${pet.voiceDb}dB` : ''}</span>
          </span>
          {pet.alertReason ? <span className="text-rose-600">可提醒</span> : null}
        </li>)}
      </ul> : null}
    </div>
  );
}
