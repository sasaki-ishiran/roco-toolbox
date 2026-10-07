/**
 * 采集器「分享」→「洛克工具箱」的落地暂存。
 *
 * 采集器的分享面板会把数据文件以 multipart/form-data POST 到网页的 /share-target，
 * Service Worker 接住请求、把文件**原样（按字节）**存进 Cache Storage，然后 303 跳回应用首页；
 * 应用启动后从这里把文件取走并走原有的导入流程。
 *
 * 用 Cache Storage 而不是 IndexedDB：Service Worker 与页面都能直接访问，
 * 不需要动现有的 locke-toolbox 数据库版本。
 *
 * 为什么存字节而不是文本：分享进来的可能是**抓包（PCAP，二进制）**，
 * 当文本读会被 UTF-8 解码破坏（安卓壳那边专门走「拦截请求返回字节」也是这个原因）。
 */
export const SHARE_CACHE = 'roco-share-target';
export const SHARE_PAYLOAD_KEY = '/__shared-payload';
/** 文件名放进响应头（header 只能放 latin-1，所以做 URL 编码） */
export const SHARE_NAME_HEADER = 'X-Roco-File-Name';

export type SharedFile = {
  name: string;
  /** 原始字节（JSON 与 PCAP 都用它，由 readCaptureFile 按魔数分流） */
  blob: Blob;
};

/** Service Worker 侧：把分享进来的文件暂存起来，等页面取走。 */
export async function putSharedFile(file: File): Promise<void> {
  const cache = await caches.open(SHARE_CACHE);
  // 取 ArrayBuffer 而不是把 File 直接当 body：字节更明确，也不依赖 Blob 的跨实现兼容
  const bytes = await file.arrayBuffer();
  await cache.put(
    SHARE_PAYLOAD_KEY,
    new Response(bytes, {
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        [SHARE_NAME_HEADER]: encodeURIComponent(file.name),
      },
    }),
  );
}

/**
 * 同一个页面只处理一次：每次分享都会重新加载页面，所以一次加载对应一次分享。
 * 先占位再 await，避免 React StrictMode 在开发模式下把 effect 跑两遍时两次调用交错进来。
 * 读取失败时把标记放回去，这样刷新或重新分享还能再试一次。
 */
let taken = false;

/** 仅供测试：重置"本页面已取过"的标记。 */
export function resetShareTargetForTest(): void {
  taken = false;
}

/** 页面侧：取出分享进来的文件；没有就返回 null。取走后立即删除，避免刷新重复导入。 */
export async function takeSharedFile(): Promise<SharedFile | null> {
  if (taken || typeof caches === 'undefined') return null;
  taken = true;
  try {
    const cache = await caches.open(SHARE_CACHE);
    const response = await cache.match(SHARE_PAYLOAD_KEY);
    if (!response) return null;
    // 先把内容完整取出来、确认成功，**再**删缓存条目：中途失败（body 读不出 / 文件名非法）
    // 会把条目留在缓存里，这次分享不会静默丢掉（catch 里 taken 复位，允许重试）。
    const rawName = response.headers.get(SHARE_NAME_HEADER);
    const name = rawName ? decodeURIComponent(rawName) : '';
    const blob = await response.blob();
    await cache.delete(SHARE_PAYLOAD_KEY);
    return { name, blob };
  } catch {
    // 缓存读不出来就当这次没有分享，并允许重试（否则这一页再也拿不到数据）
    taken = false;
    return null;
  }
}
