import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';

// jsdom 的 Blob / File 没有实现 text() 与 arrayBuffer()（真实浏览器有），
// 导入流程要靠它们读文件内容。用 jsdom 自带的 FileReader 补上。
if (typeof Blob !== 'undefined' && typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function text(this: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

// jsdom 没有实现 window.scrollTo（切页签复位滚动位置时会调用它），补一个空实现，
// 否则每次渲染 App 都会打印一条 "Not implemented: window.scrollTo"。
if (typeof window !== 'undefined') {
  window.scrollTo = (() => {}) as typeof window.scrollTo;
}