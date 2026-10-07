import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // 顶部显示的构建时间（本地时间，形如 2026-09-26 17:40）：
  // 手机上打开的到底是哪一版，一眼可查。不用 toISOString，那是 UTC，会对不上你的表。
  define: {
    __APP_BUILD__: JSON.stringify(new Date().toLocaleString('sv-SE').slice(0, 16)),
  },
  // 部署到子路径（例如 GitHub Pages 的 /repo/）时用 VITE_BASE=/repo/ 构建；
  // 部署在域名根目录（Netlify / Cloudflare Pages 默认）时不用设。
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      // 用自定义 Service Worker（src/sw.ts）：除了预缓存，还要接采集器「分享」过来的数据文件
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      manifest: {
        name: '洛克工具箱',
        short_name: '洛克工具箱',
        description: '洛克王国：世界 孵蛋规划工具箱（数据只存在本机，不上传）',
        lang: 'zh-CN',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#f8fafc',
        theme_color: '#059669',
        // 必须给 PNG 位图：安卓 Chrome 要 192/512 的位图才会做成「真安装」（WebAPK），
        // 只有 SVG 时会退化成快捷方式，而快捷方式拿不到分享目标 —— 「洛克工具箱」就不会出现在分享面板里。
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // 采集器里点「分享」→ 选「洛克工具箱」，数据 JSON 直接进来自动导入，不用再手动选文件。
        // 采集器分享时用的是宽泛的 */* 类型，Chrome 会拿它来和 accept 逐条比对，
        // 只写 application/json 会导致「洛克工具箱」压根不出现在分享面板里，所以必须带上 */*。
        share_target: {
          action: 'share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [{ name: 'file', accept: ['application/json', '.json', '*/*'] }],
          },
        },
      },
      injectManifest: {
        // 应用外壳（含图鉴 json 与图标）全部缓存，断网也能打开
        globPatterns: ['**/*.{js,css,html,svg,json,png}'],
      },
    }),
  ],
  build: {
    commonjsOptions: {
      // 内置的抓包解析器（src/pcap-decoder/）来自上游采集器，其中一部分文件是 CommonJS
      // （require / module.exports）。它们不在 node_modules 里，默认不会被 rollup 的
      // commonjs 插件处理，打包时会报「没有 default 导出」。这里显式把它们纳进来。
      include: [/node_modules/, /src[\\/]pcap-decoder[\\/]/],
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/tools/**', '**/dist/**', 'e2e/**'],
  },
});
