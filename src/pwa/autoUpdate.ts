/**
 * Service Worker 自动更新。
 *
 * 部署新版本后，浏览器会在页面加载时去检查 sw.js；新 Service Worker 装好并接管后，
 * 当前页面里跑的**仍然是旧 JS** —— 表现就是"新功能没生效，得手动刷新一次"。
 * 这里在"新版本接管"时自动刷新一次，用户就不用自己动手了。
 *
 * 首次访问时页面本来就没有旧版本在跑（页面还没被任何 Service Worker 控制），
 * 所以不订阅、也不会刷新 —— 否则第一次打开就会白白闪一下。
 */
export interface AutoUpdateDeps {
  /** 页面加载时是否已经有 Service Worker 在控制（navigator.serviceWorker.controller 非空） */
  controlled: boolean;
  /** 订阅 controllerchange 事件 */
  subscribe: (onChange: () => void) => void;
  reload: () => void;
}

/** 返回是否真的挂上了自动刷新（便于测试与排查）。 */
export function reloadWhenUpdated(deps: AutoUpdateDeps): boolean {
  if (!deps.controlled) return false;

  let reloading = false;
  deps.subscribe(() => {
    // controllerchange 可能连续触发多次；只认第一次，避免刷新循环
    if (reloading) return;
    reloading = true;
    deps.reload();
  });
  return true;
}
