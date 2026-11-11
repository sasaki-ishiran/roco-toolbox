import { useState } from 'react';
import { Button } from './primitives/Button';

/** 壳注入的服务器地址接口（浏览器里不存在，所以整个入口只在内测壳里可见）。 */
export interface ServerBridge {
  /** `{ current, defaultUrl, productionUrl }` */
  read(): string;
  /** 探活通过才保存；返回 `{ ok, message, baseUrl }`，成功后壳会清缓存并重载页面 */
  apply(url: string): string;
  /** 恢复生产地址，不需要探活 */
  reset(): string;
  /**
   * 一键互切（1.3.3+ 的壳才有）：自家两个地址直接切，不探活、不等网络。
   * 老壳没有这个方法，调用方回退到 `apply`。
   */
  toggle?(): string;
}

declare global {
  interface Window {
    RocoServer?: ServerBridge;
  }
}

type Notice = { kind: 'ok' | 'error'; text: string };

/** 1.3 内测包默认地址：测试站（壳返回缺字段时的兜底）。 */
const DEFAULT_HINT = 'https://test.roco-toolbox.pages.dev';
const PRODUCTION_HINT = 'https://roco-toolbox.pages.dev';

export function serverBridge(): ServerBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.RocoServer;
}

export interface ServerInfo {
  current: string;
  defaultUrl: string;
  productionUrl: string;
}

export function readServerInfo(bridge: ServerBridge): ServerInfo {
  try {
    const parsed = JSON.parse(bridge.read()) as Partial<ServerInfo>;
    return {
      current: parsed.current ?? '',
      defaultUrl: parsed.defaultUrl || DEFAULT_HINT,
      productionUrl: parsed.productionUrl || PRODUCTION_HINT,
    };
  } catch {
    return { current: '', defaultUrl: DEFAULT_HINT, productionUrl: PRODUCTION_HINT };
  }
}

export interface ServerSwitchResult {
  ok: boolean;
  message: string;
  baseUrl: string;
}

function parseResult(raw: string): ServerSwitchResult {
  try {
    const parsed = JSON.parse(raw) as Partial<ServerSwitchResult>;
    return {
      ok: parsed.ok === true,
      message: parsed.message ?? (parsed.ok ? '已切换，正在重新加载。' : '保存失败'),
      baseUrl: parsed.baseUrl ?? '',
    };
  } catch {
    return { ok: false, message: `壳返回的结果看不懂：${raw}`, baseUrl: '' };
  }
}

/**
 * 连点版本号后的快切：当前在默认站（测试站）就切正式站，否则切回默认站。
 *
 * <p>1.3.3 起的壳提供 `toggle()`：自家两个地址直接互切，不探活也不等待网络，
 * 所以不会再因为探活超时弹出地址输入面板。老壳没有 `toggle()` 时退回 `apply`。</p>
 */
export function toggleServer(bridge: ServerBridge): ServerSwitchResult {
  if (typeof bridge.toggle === 'function') {
    return parseResult(bridge.toggle());
  }
  const info = readServerInfo(bridge);
  const target = info.current === info.defaultUrl ? info.productionUrl : info.defaultUrl;
  return parseResult(bridge.apply(target));
}

/**
 * 服务器地址（2026-11-09）：只有壳里连点版本号 5 次才会出现。
 *
 * <p>保存前壳会真的打一次 `{地址}/api/health`，正文里没有 `ok:true` 就不保存，
 * 失败原因原样显示在这里，避免用户把客户端指成白屏却不知道哪一步错了。</p>
 */
export function ServerAddressPanel({ onClose }: { onClose: () => void }) {
  const bridge = serverBridge();
  const [info, setInfo] = useState<ServerInfo>(() =>
    bridge ? readServerInfo(bridge) : { current: '', defaultUrl: DEFAULT_HINT, productionUrl: PRODUCTION_HINT },
  );
  const [value, setValue] = useState(info.current);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  if (!bridge) return null;

  const run = (action: () => string) => {
    setBusy(true);
    setNotice(null);
    // 桥调用是同步阻塞的（探活最多 5 秒），先让「探活中…」画出来再进桥
    window.setTimeout(() => {
      try {
        const result = parseResult(action());
        setNotice({ kind: result.ok ? 'ok' : 'error', text: result.message });
        if (result.ok && result.baseUrl) {
          setInfo((previous) => ({ ...previous, current: result.baseUrl }));
          setValue(result.baseUrl);
        }
      } catch (error) {
        setNotice({ kind: 'error', text: `调用壳失败：${String(error)}` });
      } finally {
        setBusy(false);
      }
    }, 30);
  };

  const save = () => {
    const raw = value.trim();
    if (!raw) {
      setNotice({ kind: 'error', text: '地址不能为空。' });
      return;
    }
    if (!/^https:\/\//i.test(raw)) {
      setNotice({ kind: 'error', text: '只支持 https 地址（http 和 IP 直连都不收）。' });
      return;
    }
    run(() => bridge.apply(raw));
  };

  const currentKind = info.current === info.defaultUrl
    ? '测试服（默认）'
    : info.current === info.productionUrl ? '正式服' : '自定义';

  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      data-testid="server-address-panel"
    >
      <h2 className="text-base font-semibold text-slate-900">服务器地址</h2>
      <p className="mt-1 text-xs text-amber-700" data-testid="server-address-risk">
        仅限自用：填错等于把采集数据交给该站点。
      </p>

      <dl className="mt-3 space-y-1 text-xs" data-testid="server-address-current">
        <div className="flex gap-2">
          <dt className="shrink-0 text-slate-500">当前：</dt>
          <dd className="break-all text-slate-900">
            <span className="mr-1 rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
              {currentKind}
            </span>
            {info.current || '未知'}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-slate-500">默认：</dt>
          <dd className="break-all text-slate-500">
            <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">测试服</span>
            {info.defaultUrl}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-slate-500">正式：</dt>
          <dd className="break-all text-slate-500">
            <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">正式服</span>
            {info.productionUrl}
          </dd>
        </div>
      </dl>

      <label className="mt-3 block text-xs text-slate-500" htmlFor="server-address-input">
        切换到
      </label>
      <input
        id="server-address-input"
        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
        data-testid="server-address-input"
        value={value}
        inputMode="url"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={info.defaultUrl}
        onChange={(event) => setValue(event.target.value)}
      />

      <div className="mt-3 flex gap-2">
        <Button size="sm" busy={busy} onClick={save} data-testid="server-address-save">
          保存并重载
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => run(() => bridge.reset())}
          data-testid="server-address-reset"
        >
          恢复默认
        </Button>
        <Button
          size="sm"
          variant="text"
          disabled={busy}
          onClick={onClose}
          data-testid="server-address-close"
        >
          收起
        </Button>
      </div>

      {notice ? (
        <p
          className={`mt-3 break-all text-xs ${
            notice.kind === 'ok' ? 'text-emerald-700' : 'text-rose-600'
          }`}
          data-testid="server-address-notice"
        >
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}
