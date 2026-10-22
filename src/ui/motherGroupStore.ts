/**
 * 多人母本共享的本机轻量状态。
 *
 * **只保存**当前组 ID 与组主本机看到的邀请码明文，按 toolbox accountId 隔离；
 * 不保存 token、不保存他人的资源正文（服务器才是真相来源）。
 * 换设备后从 `GET /api/mother-groups` 找回成员资格，不依赖这里。
 */
const KEY_PREFIX = 'roco.motherGroups:';
/** 未登录时输入、登录后仍需用户手动点「加入」的待加入码（设备级，不跟账号走） */
const PENDING_INVITE_KEY = 'roco.motherGroups.pendingInvite';

export interface MotherGroupPrefs {
  currentGroupId: string | null;
  /** groupId → 组主本机看到的邀请码明文；别的设备没有，只能让组主重置 */
  inviteCodes: Record<string, string>;
}

const EMPTY: MotherGroupPrefs = { currentGroupId: null, inviteCodes: {} };

const storageKey = (accountId: string): string => `${KEY_PREFIX}${accountId}`;

export function readMotherGroupPrefs(accountId: string | null): MotherGroupPrefs {
  if (!accountId || typeof window === 'undefined') return { ...EMPTY, inviteCodes: {} };
  try {
    const raw = window.localStorage.getItem(storageKey(accountId));
    if (!raw) return { ...EMPTY, inviteCodes: {} };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const inviteCodes: Record<string, string> = {};
    if (typeof parsed.inviteCodes === 'object' && parsed.inviteCodes !== null) {
      for (const [group, code] of Object.entries(parsed.inviteCodes as Record<string, unknown>)) {
        if (typeof code === 'string') inviteCodes[group] = code;
      }
    }
    return {
      currentGroupId: typeof parsed.currentGroupId === 'string' ? parsed.currentGroupId : null,
      inviteCodes,
    };
  } catch {
    return { ...EMPTY, inviteCodes: {} };
  }
}

function write(accountId: string, prefs: MotherGroupPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(accountId), JSON.stringify(prefs));
  } catch {
    // 隐私模式 / 配额满：只影响本机记住当前组，不影响服务器数据
  }
}

export function readCurrentGroupId(accountId: string | null): string | null {
  return readMotherGroupPrefs(accountId).currentGroupId;
}

export function saveCurrentGroupId(accountId: string | null, groupId: string | null): void {
  if (!accountId) return;
  write(accountId, { ...readMotherGroupPrefs(accountId), currentGroupId: groupId });
}

export function readInviteCode(accountId: string | null, groupId: string): string | null {
  return readMotherGroupPrefs(accountId).inviteCodes[groupId] ?? null;
}

export function saveInviteCode(accountId: string | null, groupId: string, code: string): void {
  if (!accountId) return;
  const prefs = readMotherGroupPrefs(accountId);
  write(accountId, { ...prefs, inviteCodes: { ...prefs.inviteCodes, [groupId]: code } });
}

export function clearMotherGroupPrefs(accountId: string | null): void {
  if (!accountId || typeof window === 'undefined') return;
  window.localStorage.removeItem(storageKey(accountId));
}

/* ---------- 未登录的待加入码（设备级草稿） ---------- */

export function readPendingInviteCode(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(PENDING_INVITE_KEY) ?? '';
}

export function savePendingInviteCode(code: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = code.trim().toUpperCase();
  if (trimmed) window.localStorage.setItem(PENDING_INVITE_KEY, trimmed);
  else window.localStorage.removeItem(PENDING_INVITE_KEY);
}
