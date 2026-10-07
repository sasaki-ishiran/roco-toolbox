/**
 * 原生壳 APK（android-shell）分享进来的数据。
 *
 * 系统分享面板 → 壳接住 → 壳把内容挂到 window.__rocoPendingShare 上并派发 'roco-share' 事件；
 * 页面这里把内容取走，交给导入流程。在普通浏览器里这个值永远是空的，什么也不会发生。
 *
 * 两种形态：
 * - 小文件（JSON）：壳直接把文本塞进来
 * - 抓包（PCAP，二进制）：壳拦下对 SHELL_CAPTURE_URL 的请求、把字节原样返回，
 *   页面自己去 fetch。走拦截而不是塞文本，是因为二进制当文本读会被破坏，
 *   而几 MB 的 base64 字符串塞进 evaluateJavascript 又太重。
 *   用独立来源（.invalid 是保留域名，永远解析不到）是为了绕开网页自己的 Service Worker，
 *   否则请求会先被它接管。
 */
export const SHELL_CAPTURE_URL = 'https://roco-share.invalid/capture.pcap';

export type NativeShare =
  | { kind: 'text'; name: string; text: string }
  | { kind: 'capture'; name: string; url: string };

declare global {
  interface Window {
    __rocoPendingShare?: { kind?: string; name?: string; text?: string; url?: string };
    /**
     * 壳注入的「向外分享」桥（1.1.4+）：把备份文本交给壳，壳调起系统分享面板。
     * 普通浏览器里不存在，`shareToNative` 会返回 false。
     */
    RocoShare?: { shareBackup?: (text: string, fileName: string) => void };
  }
}

/** 只看有没有待处理的分享，不取走。用于应用启动时先停在「导入数据」页等它被消费。 */
export function hasPendingNativeShare(): boolean {
  return typeof window !== 'undefined' && window.__rocoPendingShare != null;
}

/** 取出壳注入的分享内容；没有就返回 null。取走后立即清空，避免重复导入。 */
export function takeNativeShare(): NativeShare | null {
  if (typeof window === 'undefined') return null;
  const pending = window.__rocoPendingShare;
  if (!pending) return null;
  window.__rocoPendingShare = undefined;

  if (pending.kind === 'capture') {
    return { kind: 'capture', name: pending.name ?? '', url: pending.url || SHELL_CAPTURE_URL };
  }
  if (typeof pending.text === 'string') {
    return { kind: 'text', name: pending.name ?? '', text: pending.text };
  }
  return null;
}

/** 把壳放在拦截地址上的抓包取回来。取不到时给出可读的提示。 */
export async function fetchShellCapture(url: string): Promise<Uint8Array<ArrayBuffer>> {
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store' });
  } catch {
    throw new Error('没能从应用里取到抓包文件，请重新分享一次');
  }
  if (!response.ok) throw new Error(`没能从应用里取到抓包文件（HTTP ${response.status}）`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * 把备份文本交给壳去分享（1.1.4+）。返回 true 表示壳接住了（已调起分享面板），
 * false 表示当前不是壳环境，调用方应改用 navigator.share 或下载兜底。
 */
export function shareToNative(text: string, fileName: string): boolean {
  if (typeof window === 'undefined' || typeof window.RocoShare?.shareBackup !== 'function') {
    return false;
  }
  try {
    window.RocoShare.shareBackup(text, fileName);
    return true;
  } catch {
    return false;
  }
}
