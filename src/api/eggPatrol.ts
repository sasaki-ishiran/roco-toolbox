import { authFetch } from './session';

export interface EggBotStatus { binding: { qqGroupId: string; updatedAt: number } | null; quotaUsed: number }
export interface EggBotCode { code: string; expiresAt: number }
async function request(groupId: string, method = 'GET'): Promise<Record<string, unknown>> {
  const response = await authFetch(`/api/collection-groups/${encodeURIComponent(groupId)}/egg-bot`, { method });
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('机器人连接数据不完整');
  const data = value as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : '机器人连接暂不可用');
  return data;
}
export async function getEggBotStatus(groupId: string): Promise<EggBotStatus> {
  const data = await request(groupId);
  if (!Number.isInteger(data.quotaUsed) || Number(data.quotaUsed) < 0 || Number(data.quotaUsed) > 100) throw new Error('巡查预算数据不完整');
  if (data.binding === null) return { binding: null, quotaUsed: Number(data.quotaUsed) };
  if (!data.binding || typeof data.binding !== 'object' || !('qqGroupId' in data.binding) || !('updatedAt' in data.binding) ||
    typeof data.binding.qqGroupId !== 'string' || typeof data.binding.updatedAt !== 'number') throw new Error('群关联数据不完整');
  return { binding: { qqGroupId: data.binding.qqGroupId, updatedAt: data.binding.updatedAt }, quotaUsed: Number(data.quotaUsed) };
}
export async function createEggBotCode(groupId: string): Promise<EggBotCode> {
  const data = await request(groupId, 'POST');
  if (typeof data.code !== 'string' || !/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(data.code) || typeof data.expiresAt !== 'number') throw new Error('接入码数据不完整');
  return { code: data.code, expiresAt: data.expiresAt };
}
export async function disconnectEggBot(groupId: string): Promise<void> { await request(groupId, 'DELETE'); }
