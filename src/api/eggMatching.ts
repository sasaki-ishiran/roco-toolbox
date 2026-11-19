import { authFetch } from './session';
import type { EggWorkflowState } from '../shared/eggWorkflow';
import { isDemandBody, isDemandVoice } from '../shared/collectionGroups';

export interface EggMatchingResponse { version: number; state: EggWorkflowState }
export class EggMatchingError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validLine = (value: unknown): boolean => object(value) && Number.isSafeInteger(value.eggGameId) && Number(value.eggGameId)>0 &&
  typeof value.nature==='string' && (isDemandBody(value.body)||value.body==='unknown') && (isDemandVoice(value.voice)||value.voice==='unknown') &&
  typeof value.gameAccountKey==='string' && typeof value.motherId==='string' && typeof value.fatherId==='string' && value.motherId!==value.fatherId &&
  (value.greenParentId===undefined||typeof value.greenParentId==='string'&&[value.motherId,value.fatherId].includes(value.greenParentId)) &&
  (value.parents===undefined||Array.isArray(value.parents)&&value.parents.length===2&&value.parents.every(p=>object(p)&&
    [value.motherId,value.fatherId].includes(p.id)&&Number.isSafeInteger(p.gameId)&&typeof p.name==='string'&&typeof p.nature==='string'&&typeof p.body==='string'&&typeof p.voice==='string'));
function validState(value: unknown): value is EggWorkflowState {
  if (!object(value) || !Array.isArray(value.demands) || !Array.isArray(value.eggs) || !Array.isArray(value.trades) || !object(value.watermarks) || !object(value.orders)) return false;
  return (value.lines===undefined||Array.isArray(value.lines)&&value.lines.every(l=>object(l)&&typeof l.id==='string'&&typeof l.accountId==='string'&&validLine(l))) &&
    (value.patrol===undefined||Array.isArray(value.patrol)&&value.patrol.every(p=>object(p)&&typeof p.tradeId==='string'&&['give','return'].includes(String(p.side))&&
      (p.checkedAt===null||typeof p.checkedAt==='number')&&['pending','ok','queued','error','quota','placed','produced','ambiguous','quiet'].includes(String(p.status))&&
      (p.notification===null||['pending','leased','sent','failed','unbound'].includes(String(p.notification)))))&&
    (value.legacyHistory===undefined||Array.isArray(value.legacyHistory)&&value.legacyHistory.every(h=>object(h)&&typeof h.id==='string'&&typeof h.groupId==='string'&&typeof h.demanderAccountId==='string'&&
      (h.supplierAccountId===undefined||typeof h.supplierAccountId==='string')&&Number.isInteger(h.eggGroupId)&&Number(h.eggGroupId)>0&&typeof h.nature==='string'&&typeof h.body==='string'&&typeof h.voice==='string'&&
      ['cancelled','done','needs-species'].includes(String(h.status))&&typeof h.createdAt==='number'))&&
    value.demands.every(d => object(d) && typeof d.id === 'string' && typeof d.groupId === 'string' &&
    typeof d.demanderAccountId === 'string' && Number.isSafeInteger(d.eggGameId) && Array.isArray(d.natures) && d.natures.every(n => typeof n === 'string') &&
    isDemandBody(d.body) && isDemandVoice(d.voice) && Number.isInteger(d.quantity) && Number(d.quantity) > 0 &&
    Number.isInteger(d.fulfilled) && Number(d.fulfilled) >= 0 && Number(d.fulfilled) <= Number(d.quantity) && ['open','fulfilled','withdrawn'].includes(String(d.status))) &&
    value.eggs.every(e => object(e) && typeof e.id === 'string' && typeof e.accountId === 'string' && Number.isSafeInteger(e.eggGameId) &&
      typeof e.nature === 'string' && typeof e.listed === 'boolean' && typeof e.gameAccountKey === 'string' &&
      (isDemandBody(e.body) || e.body === 'unknown') && (isDemandVoice(e.voice) || e.voice === 'unknown') &&
      ['available','reserved','transferred'].includes(String(e.status)) && ['ordinary','shiny','special'].includes(String(e.kind ?? 'ordinary'))) &&
    value.trades.every(t => object(t) && typeof t.id === 'string' && typeof t.demandId === 'string' && typeof t.groupId === 'string' &&
      typeof t.supplierAccountId === 'string' && typeof t.demanderAccountId === 'string' && object(t.give) &&
      (t.receive === null || object(t.receive)) && ['spot','custom'].includes(String(t.type)) &&
      ['proposed','accepted','done','cancelled'].includes(String(t.status)) && typeof t.placed === 'boolean' &&
      (t.line===undefined||validLine(t.line)) && (t.returnLine===undefined||validLine(t.returnLine))) &&
    Object.values(value.orders).every(ids => Array.isArray(ids) && ids.every(id => typeof id === 'string')) &&
    Object.values(value.watermarks).every(time => typeof time === 'number' && Number.isFinite(time));
}
async function read(response: Response): Promise<EggMatchingResponse> {
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new EggMatchingError(object(data) && typeof data.error === 'string' ? data.error : '换蛋服务暂不可用', response.status);
  if (!object(data) || !Number.isSafeInteger(data.version) || Number(data.version) < 0 || !validState(data.state)) throw new EggMatchingError('换蛋数据格式不完整，请刷新重试', 502);
  return { version: Number(data.version), state: data.state };
}
export async function getEggMatching(groupId: string, signal?: AbortSignal): Promise<EggMatchingResponse> {
  return read(await authFetch(`/api/collection-groups/${encodeURIComponent(groupId)}/egg-matching`, { signal }));
}
export async function mutateEggMatching(groupId: string, baseVersion: number, action: unknown): Promise<EggMatchingResponse> {
  const next=await read(await authFetch(`/api/collection-groups/${encodeURIComponent(groupId)}/egg-matching`, {
    method: 'POST', body: JSON.stringify({ baseVersion, action }),
  }));
  window.dispatchEvent(new Event('roco:egg-workflow-changed'));
  return next;
}
