/**
 * UUID v4（2026-11-18）。
 *
 * 浏览器只在安全上下文（HTTPS / localhost）提供 `crypto.randomUUID`；
 * 用局域网 IP + HTTP 打开网页时它是 undefined，会让开号、小组等依赖随机 id 的操作直接抛错。
 * 这里退回 `crypto.getRandomValues`（不受安全上下文限制）自己拼一个 v4。
 */
export function newUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
