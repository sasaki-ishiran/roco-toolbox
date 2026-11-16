import { useEffect, useState } from 'react';
import { createEggBotCode, disconnectEggBot, getEggBotStatus, type EggBotCode, type EggBotStatus } from '../../api/eggPatrol';
import { Button } from '../primitives/Button';
import { ModalSurface } from '../primitives/ModalSurface';

export function EggBotConnection({ groupId, isOwner }: { groupId: string; isOwner: boolean }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<EggBotStatus | null>(null);
  const [code, setCode] = useState<EggBotCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!open) return;
    let live = true;
    const read = () => { void getEggBotStatus(groupId).then(value => { if (live) { setData(value); setError(''); } })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : '读取失败'); }); };
    setData(null); setCode(null); setError(''); read();
    const timer = window.setInterval(() => { setNow(Date.now()); read(); }, 15000);
    return () => { live = false; window.clearInterval(timer); };
  }, [groupId, open]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); } finally { setBusy(false); }
  };
  const validCode = code && code.expiresAt > now;
  const row = 'flex items-center justify-between gap-2 border-b border-slate-100 py-3 text-xs';
  return <><Button variant="text" size="sm" onClick={() => setOpen(true)}>机器人接入</Button>
    <ModalSurface open={open} placement="sheet" title="机器人接入" onClose={() => setOpen(false)}>
      <div className="flex flex-col gap-2 p-3">
        {data ? <><div className={row}><strong>换蛋提醒</strong><span className="text-[11px] text-slate-500">{data.binding ? '已接入' : '未接入'}</span></div>
          {data.binding ? <div className={row}><span>QQ群</span><span className="text-[11px] text-slate-500">{data.binding.qqGroupId}</span></div> : null}
          <div className={row}><span>家园巡查</span><span className="text-[11px] text-slate-500">08:00–24:00 · 每半小时</span></div>
          <div className={row}><span>今日查询</span><span className="text-[11px] text-slate-500">{data.quotaUsed} / 100</span></div>
          {validCode && !data.binding ? <><div className="rounded-lg bg-slate-50 p-2 text-center font-mono text-[22px] font-semibold tracking-widest">{code.code}</div>
            <p className="text-xs text-slate-600">10 分钟内由QQ群管理员发送：</p><code className="break-all text-xs text-slate-600">rc换蛋接入 {code.code}</code>
            <Button variant="secondary" size="sm" onClick={() => void run(async () => { await navigator.clipboard.writeText('rc换蛋接入 ' + code.code); })}>复制群命令</Button></> : null}
          {code && !validCode ? <p className="text-xs text-amber-700">接入码已过期</p> : null}
          {isOwner ? data.binding ? <Button variant="danger" busy={busy} onClick={() => setConfirm(true)}>断开群关联</Button> :
            <Button busy={busy} onClick={() => void run(async () => { const next = await createEggBotCode(groupId); setCode(next); setNow(Date.now()); })}>{code ? '重新生成接入码' : '生成接入码'}</Button> : null}
        </> : !error ? <p className="py-4 text-center text-xs text-slate-500">正在读取…</p> : null}
        {error ? <p role="alert" className="text-xs text-rose-600">{error}</p> : null}
      </div>
    </ModalSurface>
    <ModalSurface open={confirm} placement="sheet" title="断开群关联" onClose={() => setConfirm(false)} footer={<Button variant="danger" busy={busy} onClick={() => void run(async () => {
      await disconnectEggBot(groupId); setData(value => value ? { ...value, binding: null } : null); setCode(null); setConfirm(false);
    })}>确认断开</Button>}><p className="p-3 text-sm">断开本小组的QQ群提醒？</p></ModalSurface>
  </>;
}
