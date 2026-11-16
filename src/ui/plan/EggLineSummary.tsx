import type { AccountSnapshot } from '../../domain/parseBackup';
import { accountKeyOf } from '../../domain/parseBackup';
import type { EggLine } from '../../shared/eggWorkflow';
import { GREEN_NEST_ICON, petBodyMedalIcon, petVoiceMedalIcon,bodyMedalIconByLabel,voiceMedalIconByLabel } from '../../domain/petIcons';
import { boxLabel } from '../../domain/coverageDetail';
import { PetAvatar } from '../PetAvatar';

/** Resolve accepted instances; never substitute a same-species parent. */
export function EggLineSummary({line,snapshots=[]}:{line:EggLine;snapshots?:readonly AccountSnapshot[]}) {
  const snapshot=snapshots.find(s=>accountKeyOf(s)===line.gameAccountKey);
  return <div className="min-w-0 rounded-lg bg-slate-50 p-2">
    <div className="mb-1 text-[10px] text-slate-500">{snapshot?.accountName??line.gameAccountKey}{line.natureChance!=null?' · 性格 '+Math.round(line.natureChance*100)+'%':''}</div>
    <div className="grid grid-cols-[minmax(0,1fr)_12px_minmax(0,1fr)] items-start gap-1">{[line.motherId,line.fatherId].map((id,i)=>{
      const pet=snapshot?.pets.find(p=>p.captureId===id);
      const shared=line.parents?.find(p=>p.id===id);
      const medals=pet?[petBodyMedalIcon(pet.medalBody,pet.weightPercent),petVoiceMedalIcon(pet.voiceDb)]:shared?[bodyMedalIconByLabel(shared.body),voiceMedalIconByLabel(shared.voice)]:[];
      const green=id===line.greenParentId;
      return <div key={id} className={i?'col-start-3 row-start-1 min-w-0':'col-start-1 row-start-1 min-w-0'}><div className="flex items-center gap-1">
        {pet||shared?<PetAvatar gameId={(pet??shared)!.gameId} name={(pet??shared)!.name} size={24}/>:null}
        <div className="min-w-0"><strong className="block truncate text-[11px]">{pet?.name??shared?.name??(i?'父本':'母本')}</strong><span className="text-[10px] text-slate-500">{pet?.nature??shared?.nature??'亲本待更新'}</span></div>
      </div><div className="mt-0.5 flex items-center gap-0.5">{medals.map((src,j)=>src?<img key={j} src={src} alt={j?'声音奖牌':'体型奖牌'} className="size-4"/>:null)}{green?<img src={GREEN_NEST_ICON} alt="进学院小窝" className="size-4"/>:null}<span className="truncate text-[9px] text-slate-400">{pet?boxLabel(pet):''}</span></div>{green?<span className="text-[9px] text-emerald-700">学院小窝</span>:null}</div>;
    })}<span className="col-start-2 row-start-1 self-center text-center text-xs text-slate-400">＋</span></div>
  </div>;
}
