(function () {
  'use strict';
  if (window.top !== window || !window.RocoCaptureBridge) return;
  const pending = new Map();
  let nextId = 0;
  function call(action, id, extra) {
    return new Promise((resolve, reject) => {
      const requestId = String(++nextId);
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('原生采集响应超时，请重试；原始文件仍保留'));
      }, 10000);
      pending.set(requestId, { resolve, reject, timer });
      try { window.RocoCaptureBridge.postMessage(JSON.stringify({ requestId, action, id, ...(extra || {}) })); }
      catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error); }
    });
  }
  window.RocoCaptureBridge.onmessage = function (event) {
    let response;
    try { response = JSON.parse(event.data); } catch (_) { return; }
    const waiting = pending.get(response.requestId);
    if (!waiting) return;
    pending.delete(response.requestId);
    clearTimeout(waiting.timer);
    if (response.error) waiting.reject(new Error(response.error));
    else waiting.resolve(response.result);
  };
  window.RocoCapture = {
    getState: () => call('getState'),
    inspectCapture: () => call('inspectCapture'),
    startCapture: (mode) => call('startCapture', undefined, { mode }),
    stopCapture: () => call('stopCapture'),
    openGame: () => call('openGame'),
    importCapture: (id) => call('importCapture', id),
    uploadCapture: (id) => call('uploadCapture', id),
    shareCapture: (id) => call('shareCapture', id),
    deleteCapture: (id) => call('deleteCapture', id),
    notifyRareAlert: (title, body) => call('notifyRareAlert', undefined, { title, body }),
    // 系统悬浮窗：球画在其它应用上方，网页只推数据（2026-11-08）
    updateBattleOverlay: (payload) => call('updateBattleOverlay', undefined, { overlay: payload }),
    // 展开面板：附近地图 + 列表（含 panels 配置），网页推 JSON 字符串
    updateNearbyOverlay: (payload) => call('updateNearbyOverlay', undefined, { nearby: payload }),
    requestOverlayPermission: () => call('requestOverlayPermission'),
    canDrawOverlay: () => call('canDrawOverlay'),
    // 悬浮球显示 / 隐藏（1.4.0）：长按隐藏后，附近页用这两个方法把球找回来
    readOrbHidden: () => call('readOrbHidden'),
    setOrbHidden: (hidden) => call('setOrbHidden', undefined, { hidden }),
  };
})();
