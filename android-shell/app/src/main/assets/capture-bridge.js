(function () {
  'use strict';
  if (window.top !== window || !window.RocoCaptureBridge) return;
  const pending = new Map();
  let nextId = 0;
  function call(action, id) {
    return new Promise((resolve, reject) => {
      const requestId = String(++nextId);
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('原生采集响应超时，请重试；原始文件仍保留'));
      }, 10000);
      pending.set(requestId, { resolve, reject, timer });
      try { window.RocoCaptureBridge.postMessage(JSON.stringify({ requestId, action, id })); }
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
    startCapture: () => call('startCapture'),
    stopCapture: () => call('stopCapture'),
    openGame: () => call('openGame'),
    importCapture: (id) => call('importCapture', id),
    shareCapture: (id) => call('shareCapture', id),
    deleteCapture: (id) => call('deleteCapture', id),
  };
})();
