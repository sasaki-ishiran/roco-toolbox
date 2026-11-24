import { useState } from 'react';
import type { WorkflowEgg } from '../../shared/eggWorkflow';
import { bodyMedalIconByLabel, voiceMedalIconByLabel } from '../../domain/petIcons';
import eggIconUrls from '../../data/eggIconUrls.json';

export const GREEN_NEST_ICON='/ui/nest/green-nest.png';
export const SPECIAL_CATEGORY_LABELS={shiny:'异色蛋',boss:'首领蛋',activity:'活动蛋',rare:'稀有蛋',special:'特殊蛋'} as const;

export function formatEggNature(value:string):string {
  return eggNatureNames(value).join(' / ');
}
export function eggNatureNames(value:string):string[] {
  return value.split(/[·/、,，]+/)
    .map(part=>part.replace(/^\s*\d+(?:\.\d+)?%\s*/,'').trim())
    .filter(Boolean);
}
export function formatEggHeight(heightCm?:number):string {
  if(typeof heightCm!=='number'||!Number.isFinite(heightCm)||heightCm<=0)return '未采集';
  return `${Number((heightCm/100).toFixed(3))} m`;
}
export function formatEggWeight(weightGrams?:number):string {
  if(typeof weightGrams!=='number'||!Number.isFinite(weightGrams)||weightGrams<=0)return '未采集';
  return `${Number((weightGrams/1000).toFixed(3))} kg`;
}

export function EggArt({ eggGameId, name, size=43, kind='ordinary', itemConfId }: {
  eggGameId:number; name:string; size?:number; kind?:WorkflowEgg['kind']; itemConfId?:number;
}) {
  const [failed,setFailed]=useState<string[]>([]);
  const ordinary=(eggIconUrls as Record<string,string>)[eggGameId];
  const special=kind!=='ordinary'&&itemConfId
    ? `https://wiki.biligame.com/nrc/Special:Redirect/file/Item_${itemConfId}.png`
    : undefined;
  const url=[...new Set([special,ordinary].filter((value):value is string=>!!value))].find(value=>!failed.includes(value));
  const fail=()=>{const current=url;if(current)setFailed(values=>values.includes(current)?values:[...values,current]);};
  return url ? <img src={url} alt={name+'的蛋'} onError={fail} width={size} height={size} className="shrink-0 object-contain"/> : <span role="img" aria-label={name+'的蛋（暂无图片）'} style={{width:size,height:size}} className="inline-flex shrink-0 items-center justify-center text-[10px] text-slate-400">暂无蛋图</span>;
}
export function EggMedals({body,voice}:{body:string;voice:string}) {
  return <span className="inline-flex items-center justify-center gap-0.5">{[[body,bodyMedalIconByLabel(body)],[voice,voiceMedalIconByLabel(voice)]].map(([label,src],i)=>src?<img key={i} src={src} alt={label??''} className="size-4 object-contain"/>:null)}</span>;
}

export const isSpecialEgg=(e:Pick<WorkflowEgg,'kind'>)=>e.kind==='special'||e.kind==='shiny';
export const eggStatus=(e:WorkflowEgg):string=>isSpecialEgg(e)
  ? SPECIAL_CATEGORY_LABELS[e.specialCategory??'special']
  : e.location==='home'?'':e.status==='reserved'?'换蛋中':e.listed?'已挂出':'未挂出';
