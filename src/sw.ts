import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { putSharedFile } from './share/shareTarget';

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// 静态资源（含图鉴 json）预缓存，断网也能打开
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// 新版本装好就立刻接管，配合 autoUpdate 让手机用户不用自己找"刷新"
self.addEventListener('install', () => {
  void self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/** 与 manifest.share_target.action 末尾对应的路径后缀 */
const SHARE_PATH_SUFFIX = '/share-target';

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'POST') return;
  const url = new URL(event.request.url);
  if (!url.pathname.endsWith(SHARE_PATH_SUFFIX)) return;
  event.respondWith(handleShareTarget(event.request));
});

/**
 * 采集器「分享」→「洛克工具箱」的入口。
 * 把分享过来的数据 JSON 暂存进 Cache Storage，然后跳回首页；
 * 首页启动时会把它取走并走原有的导入流程（见 src/share/shareTarget.ts）。
 */
async function handleShareTarget(request: Request): Promise<Response> {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (file instanceof File) await putSharedFile(file);
  } catch {
    // 分享内容读不出来也照常跳回首页，别让用户卡在一片空白上
  }
  const target = new URL(request.url);
  const basePath = target.pathname.slice(0, -SHARE_PATH_SUFFIX.length);
  target.pathname = basePath.endsWith('/') ? basePath : `${basePath}/`;
  target.search = '';
  return Response.redirect(target.toString(), 303);
}