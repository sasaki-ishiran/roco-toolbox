import { useState } from 'react';
import { Button } from './primitives/Button';

/** 壳注入的服务器地址接口（浏览器里不存在，所以整个入口只在内测壳里可见）。 */
export interface ServerBridge {
  /** `{ current, defaultUrl }` */
  read(): string;
  /** 探活通过才保存；返回 `{ ok, message, baseUrl }`，成功后壳会清缓存并重载页面 */
  apply(url: string): string;
  /** 恢复生产地址，不需要探活 */
  reset(): string;
}

declare global {
  interface Window {
    RocoServer?: ServerBridge;
  }
}

type Notice = { kind: 'ok' | 'error'; text: string };

const DEFAULT_HINT = 'https://roco-toolbox.pages.dev';

export function serverBridge(): ServerBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.RocoServer;
}

function readInfo(bridge: ServerBridge): { current: string; defaultUrl: string } {
  try {
    const parsed = JSON.parse(bridge.read()) as Partial<{ current: string; defaultUrl: string }>;
    return {
      current: parsed.current ?? '',
      defaultUrl: parsed.defaultUrl || DEFAULT_HINT,
    };
  } catch {
    return { current: '', defaultUrl: DEFAULT_HINT };
  }
}

function parseResult(raw: string): { ok: boolean; message: string; baseUrl: string } {
  try {
    const parsed = JSON.parse(raw) as Partial<{ ok: boolean; message: string; baseUrl: string }>;
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
 * 服务器地址（2026-11-09）：只有壳里连点版本号 5 次才会出现。
 *
 * <p>保存前壳会真的打一次 `{地址}/api/health`，正文里没有 `ok:true` 就不保存，
 * 失败原因原样显示在这里，避免用户把客户端指成白屏却不知道哪一步错了。</p>
 */
export function ServerAddressPanel({ onClose }: { onClose: () => void }) {
  const bridge = serverBridge();
  const [info, setInfo] = useState(() =>
    bridge ? readInfo(bridge) : { current: '', defaultUrl: DEFAULT_HINT },
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

  const currentKind = info.current === info.defaultUrl ? '生产' : '内测';

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
            <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">生产</span>
            {info.defaultUrl}
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
