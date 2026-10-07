import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { reloadWhenUpdated } from './pwa/autoUpdate';

// 部署新版本后自动刷新一次，省得手机用户自己找"刷新"（旧页面跑的是旧 JS）
if ('serviceWorker' in navigator) {
  reloadWhenUpdated({
    controlled: navigator.serviceWorker.controller !== null,
    subscribe: (onChange) => navigator.serviceWorker.addEventListener('controllerchange', onChange),
    reload: () => window.location.reload(),
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
