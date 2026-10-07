import { useEffect, useMemo, useRef, useState } from 'react';
import { analyticsEnabled, setAnalyticsEnabled, track } from '../api/analytics';
import { readAccountId } from '../api/session';
import { syncNow } from '../api/sync';
import { AccountPanel } from './AccountPanel';
import { analyzeImport } from '../domain/importDiff';
import { accountKeyOf, parseBackup, type AccountSnapshot } from '../domain/parseBackup';
import { groupMothersByEgg, plannedAchievements } from '../domain/petFilters';
import { eggGroupNames, species } from '../data/catalog';
import { clearAllSnapshots, saveSnapshot, writeSnapshots } from '../storage/snapshots';
import {
  backupFileName,
  buildBackup,
  isToolboxBackup,
  mergeSnapshots,
  parseToolboxBackup,
  type MergeResult,
  type ToolboxBackup,
} from '../domain/backup';
import { CATALOG_VERSION } from '../data/catalog';
import { refreshSnapshots } from '../storage/snapshotStore';
import {
  clearLastImportResult,
  clearLastImportHistory,
  setLastImportResult,
} from '../storage/lastImportStore';
import { ImportResultCard } from './ImportResultCard';
import { SourceNotice } from './SourceNotice';
import { useSnapshots } from './useSnapshots';
import { useLastImportHistory } from './useLastImportResult';
import { takeSharedFile } from '../share/shareTarget';
import { fetchShellCapture, shareToNative, takeNativeShare } from '../share/nativeShare';
import { readCaptureFile } from '../pcap/readCaptureFile';
import {
  adoptBackupTargetMode,
  getTargetMode,
  useTargetMode,
} from './targetModeStore';
import { getMotherPlan, mergeMotherPlan } from './motherPlanStore';
import { setImportMessage, useImportMessage } from './importMessageStore';
import { clearSyncFeedback, setSyncConflict, setSyncNotice, useSyncFeedback } from './syncNoticeStore';
import { recordSyncedPets } from './syncAdditions';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface ImportPanelProps {
  /** 分享进来的数据导入完成后通知上层（App 据此跳一次看板，让用户直接看到「本次新增」） */
  onShareImported?: () => void;
}

/** 「导入数据」页：抓包导入 / 合并导入 / 导出全部 / 重置，以及导入结果汇报。 */
export function ImportPanel({ onShareImported }: ImportPanelProps = {}) {
  const { snapshots, loaded } = useSnapshots();
  // 历史入口常驻：只要有导入历史，卡片就渲染（重启后入口仍在，2026-10-05 用户拍板）
  const importHistory = useLastImportHistory();
  // 全局目标模式：追满分 / 追双牌，「本次新增」的分类口径读它
  const mode = useTargetMode();
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const dataMessage = useImportMessage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [analyticsOn, setAnalyticsOn] = useState(() => analyticsEnabled());
  // 导入后自动云同步的反馈（409 冲突 / 设置已跟随云端）放模块级 store：
  // 分享导入后本组件会被卸载，放 useState 里这两条提示会永久丢失（见 syncNoticeStore）
  const { conflict: autoConflict, notice: syncNotice } = useSyncFeedback();
  // 「第一次用？3 步上手」折叠指引：没数据时默认展开（新用户最需要），有数据时收起
  const [guideOpen, setGuideOpen] = useState(false);
  useEffect(() => {
    if (loaded && snapshots.length === 0) setGuideOpen(true);
  }, [loaded, snapshots.length]);
  // 底部「更多」折叠区（导出 / 合并导入 / 重置）：低频操作收起来，默认收起
  const [moreOpen, setMoreOpen] = useState(false);

  const speciesByGameId = useMemo(() => new Map(species.map((entry) => [entry.gameId, entry])), []);

  const lastImportedAt = useMemo(() => {
    if (snapshots.length === 0) return null;
    return snapshots.reduce((latest, s) => (s.importedAt > latest ? s.importedAt : latest), '');
  }, [snapshots]);

  const stale = useMemo(() => {
    if (!lastImportedAt) return false;
    const ts = Date.parse(lastImportedAt);
    return Number.isFinite(ts) && Date.now() - ts > SEVEN_DAYS_MS;
  }, [lastImportedAt]);

  /** 导入后把"本次新增里符合看板分类的"记下来，给顶部那张卡片用 */
  const reportNewPets = (previous: AccountSnapshot[], imported: AccountSnapshot[]) => {
    setLastImportResult(
      analyzeImport({
        previous,
        imported,
        species,
        eggGroupNames,
        mode,
      }),
    );
    // 埋点：只报规模，不报内容（账号数 / 精灵数）
    track('import_success', {
      accounts: imported.length,
      pets: imported.reduce((sum, snapshot) => sum + snapshot.pets.length, 0),
    });
    // 开了云同步的话，导入成功后直接做一次「云同步」（拉云端 → 与本机合并 → 推回云端，
    // 2026-10-07）：分享导入是跨设备的主路径，顺手对齐就不必让用户再去「云同步」点一次。
    // 尽力而为：失败不影响本地，也不打断用户操作。
    // 2026-10-06 修：遇 409 是**正常返回 `{ok:false}` 而不是抛异常**，
    // 原来的 `.catch(() => {})` 因此永远不触发 → 冲突被静默吞掉，用户以为同步好了。
    // 现在把冲突交给「云同步」面板展示（用户在那里二选一），并在顶部给一条提示。
    if (readAccountId()) {
      void syncNow()
        .then((result) => {
          if (!result.ok) {
            setSyncConflict(result.conflict);
            return;
          }
          // 从云端补上了本机没有的设置键：这些键是模块级 store 启动时读的，刷新才生效。
          // 这里**不刷新**——分享导入后还要跳看板看「本次新增」，刷新会把它冲掉；
          // 所以只给一条提示，用户想立刻生效就自己刷新。
          if (result.prefsAdopted.length > 0) {
            setSyncNotice('设置已按云端更新，刷新页面后生效。');
          }
          // 同步带进来的精灵也算进「本次新增」：比的是**这次导入前**的本机快照，
          // 所以导入 + 同步合并起来一起展示（覆盖掉上面只按导入内容写的卡片）
          if (result.added.length > 0 || result.updated.length > 0) {
            void recordSyncedPets(previous);
          }
        })
        // 网络/服务端异常也要留一条提示：这是导入后自动触发的，用户没主动点过任何按钮
        .catch(() => {
          setSyncNotice('自动同步没成功（网络异常），到下面「云同步」点一次「立即同步」重试。');
        });
    }
  };

  /** 合并结果的反馈文案，两个入口（手选 / 分享）共用 */
  const mergeMessage = (name: string, merged: MergeResult): string =>
    `已合并导入「${name}」：新增 ${merged.added.length} 个账号 · 更新 ${merged.updated.length} 个 · 保留本地较新的 ${merged.kept.length} 个`;

  /**
   * 备份里的「规划数据」：目标模式（本地优先，本机没选过才采用备份的值）+ 计划收集（并集）。
   * 返回给用户的说明文案。
   */
  const applyBackupPlanning = (backup: ToolboxBackup): string[] => {
    adoptBackupTargetMode(backup.targetMode);
    const addedCount = mergeMotherPlan(backup.motherPlan ?? []);
    return addedCount > 0 ? [`计划收集新增 ${addedCount} 条`] : [];
  };

  /** 计划收集的达成提示：只报这次导入「从不合格变合格」的链 */
  const achievementMessages = (
    previous: AccountSnapshot[],
    next: AccountSnapshot[],
    planBefore: readonly string[],
  ): string[] => {
    if (planBefore.length === 0) return [];
    const modeNow = getTargetMode();
    const groupsOf = (list: AccountSnapshot[]) =>
      groupMothersByEgg(list.flatMap((item) => item.pets), speciesByGameId, species, modeNow);
    const beforeKeys = new Set(
      plannedAchievements(groupsOf(previous), planBefore).map((group) => group.chainKey),
    );
    const achieved = plannedAchievements(groupsOf(next), planBefore).filter(
      (group) => !beforeKeys.has(group.chainKey),
    );
    if (achieved.length === 0) return [];
    const names = achieved.slice(0, 3).map((group) => group.formLabel || '未知精灵');
    return [
      `计划收集达成 ${achieved.length} 个：${names.join('、')}${achieved.length > 3 ? ' 等' : ''}`,
    ];
  };

  /**
   * 导入入口。一个入口认两种文件：
   * - 采集器抓包（.pcap / 抓包 JSON）→ 按账号替换该账号的快照（「重新抓了一次」的正确语义）
   * - 工具箱备份（自己导出的）→ **合并**，多设备同步靠它
   *
   * 之所以不分成两个按钮：微信收到备份后「分享给洛克工具箱」时走的就是这条入口，
   * 那时用户没机会选按钮，只能靠内容自己认。
   */
  const handleImport = async (
    files: File[],
    sourceLabel?: string,
  ): Promise<AccountSnapshot[] | null> => {
    setImporting(true);
    setImportError(null);
    try {
      // 先记住导入前的数据，"本次新增"才有得比
      const previous = snapshots;
      // 计划收集的达成判定要用「导入前」的计划（备份带进来的新计划不参与本次判定）
      const planBefore = [...getMotherPlan()];
      // 合并以「当前写进去的状态」为准，多文件时后一个能看见前一个的结果
      let working = [...snapshots];
      const imported: AccountSnapshot[] = [];
      const messages: string[] = [];

      for (const file of files) {
        // 抓包文件（.pcap）会自动交给采集器那套解析器解成 JSON，其余按 JSON 读
        const raw = await readCaptureFile(file);

        if (isToolboxBackup(raw)) {
          const backup = parseToolboxBackup(raw);
          const merged = mergeSnapshots(working, backup.accounts);
          working = merged.snapshots;
          await writeSnapshots(working);
          messages.push(mergeMessage(file.name, merged));
          messages.push(...applyBackupPlanning(backup));
          continue;
        }

        const snapshot = parseBackup(raw, new Date().toISOString());
        await saveSnapshot(snapshot);
        // 按**账号身份（游戏 UID）**替换：重名但不同 UID 的两个账号是两个账号，互不顶掉
        const key = accountKeyOf(snapshot);
        working = [...working.filter((item) => accountKeyOf(item) !== key), snapshot];
        imported.push(snapshot);
      }

      await refreshSnapshots();
      reportNewPets(previous, working);
      // 抓包导入也可能让计划里的链达标
      messages.push(...achievementMessages(previous, working, planBefore));
      // 分享进来的来源说明放最前面，后面接合并/计划的说明（合并结果不在「本次新增」卡片里）
      const parts = sourceLabel ? [sourceLabel, ...messages] : messages;
      if (parts.length > 0) setImportMessage(parts.join('；'));
      return imported;
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '导入失败');
      return null;
    } finally {
      setImporting(false);
    }
  };

  // 晚到的分享要用最新的 handleImport，否则「本次新增」是拿旧快照在比
  const importRef = useRef(handleImport);
  importRef.current = handleImport;

  /**
   * 分享进来的数据有三个来源：
   * 1. 浏览器里走系统分享（Web Share Target）→ Service Worker 存进缓存，见 shareTarget.ts
   * 2. 原生壳接住分享的 JSON → 壳直接注入文本，见 nativeShare.ts
   * 3. 原生壳接住分享的抓包（采集器的「分享文件」）→ 壳拦下请求返回字节，页面自己去取
   * 等本机数据读完（loaded）再导，否则「本次新增」是在和空数据比。
   */
  useEffect(() => {
    if (!loaded) return;

    const consume = async () => {
      // 来源说明交给 handleImport 一起拼：这里再 setImportMessage 会把
      // 「已合并导入…新增/更新/保留」这句覆盖掉，用户就看不到这次到底动了什么
      const importOne = async (file: File, done: string) => {
        return importRef.current([file], done);
      };

      const fromBrowser = await takeSharedFile();
      if (fromBrowser) {
        const name = fromBrowser.name || 'shared.json';
        // 原始字节交给 readCaptureFile 按魔数分流：JSON 走解析、PCAP 走采集器解析器
        const result = await importOne(
          new File([fromBrowser.blob], name),
          `已导入分享进来的采集数据（${name}）`,
        );
        // 只有真导入成功才通知（失败时留在本页让用户看到错误）
        if (result !== null) onShareImported?.();
        return;
      }

      const fromShell = takeNativeShare();
      if (!fromShell) return;
      try {
        if (fromShell.kind === 'capture') {
          const bytes = await fetchShellCapture(fromShell.url);
          const name = fromShell.name || 'capture.pcap';
          const result = await importOne(
            new File([bytes], name, { type: 'application/octet-stream' }),
            `已解析并导入分享进来的抓包数据（${name}）`,
          );
          if (result !== null) onShareImported?.();
        } else {
          const name = fromShell.name || 'shared.json';
          const result = await importOne(
            new File([fromShell.text], name, { type: 'application/json' }),
            `已导入分享进来的采集数据（${name}）`,
          );
          if (result !== null) onShareImported?.();
        }
      } catch (error) {
        setImportError(error instanceof Error ? error.message : '导入分享的数据失败');
      }
    };

    // 消费分享数据；失败也要给提示，不能让它变成未处理的 rejection（数据会静默丢掉）
    const runConsume = () => {
      void consume().catch((error) => {
        setImportError(error instanceof Error ? error.message : '处理分享进来的数据失败');
      });
    };
    runConsume();
    // 应用已经开着的时候分享进来，壳会派发这个事件
    window.addEventListener('roco-share', runConsume);
    return () => window.removeEventListener('roco-share', runConsume);
  }, [loaded]);

  const handleReset = async () => {
    const confirmed = window.confirm('确定清空已导入的所有账号数据吗？此操作不可撤销（规划设置会保留）。');
    if (!confirmed) return;
    await clearAllSnapshots();
    await refreshSnapshots();
    clearLastImportResult();
    // 历史也一并清掉：它是「导入过的数据」的一部分，留着会让「清空所有账号数据」名不副实
    clearLastImportHistory();
    // 同步反馈指向的正是刚被清掉的那批数据，留着会自相矛盾
    clearSyncFeedback();
  };

  /** 导出：把本机全部账号数据打包，优先「分享」出去（网页 navigator.share / 壳 JS Bridge），
   *  不支持时兜底下载文件。2026-10-04 用户拍板：APK 里 blob 下载被 WebView 忽略，
   *  改为直接分享到 QQ/微信等，另一台设备再「用其他应用打开」分享回工具箱导入。 */
  const handleExport = async () => {
    const backup = buildBackup(snapshots, {
      exportedAt: new Date().toISOString(),
      catalogVersion: CATALOG_VERSION,
      targetMode: getTargetMode(),
      motherPlan: getMotherPlan(),
    });
    const text = JSON.stringify(backup, null, 1);
    const fileName = backupFileName(backup.exportedAt);

    try {
      // 1) 壳 JS Bridge：调起系统分享面板（QQ/微信等）
      if (shareToNative(text, fileName)) {
        setImportError(null);
        setImportMessage(`已发起分享 ${snapshots.length} 个账号的数据`);
        return;
      }
      // 2) 网页 Web Share API（手机浏览器）
      if (typeof navigator !== 'undefined' && navigator.share) {
        const file = new File([text], fileName, { type: 'application/json' });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: '洛克工具箱数据备份' });
          setImportError(null);
          setImportMessage(`已分享 ${snapshots.length} 个账号的数据`);
          return;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setImportError(null);
        return; // 用户取消分享，什么都不提示
      }
      // 分享失败（如权限）不打断，继续走下载兜底
    }

    // 3) 兜底：下载文件（桌面浏览器 / 不支持分享的环境）
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    setImportError(null);
    setImportMessage(`已导出 ${snapshots.length} 个账号的数据`);
  };

  /** 合并导入：把另一台设备的备份合并进本地（本地独有的账号不会被清掉） */
  const handleImportBackup = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text()) as unknown;
      const backup = parseToolboxBackup(raw);
      const previous = snapshots;
      const planBefore = [...getMotherPlan()];
      const merged = mergeSnapshots(snapshots, backup.accounts);
      const confirmed = window.confirm(
        `合并导入：本地独有的账号会保留；两边都有的账号取导入时间较新的那份。\n\n` +
          `备份里 ${backup.accounts.length} 个账号 → 新增 ${merged.added.length} · ` +
          `更新 ${merged.updated.length} · 保留本地较新 ${merged.kept.length}\n\n确定继续吗？`,
      );
      if (!confirmed) return;

      await writeSnapshots(merged.snapshots);
      await refreshSnapshots();
      reportNewPets(previous, merged.snapshots);
      setImportError(null);
      setImportMessage(
        [
          mergeMessage(file.name, merged),
          ...applyBackupPlanning(backup),
          ...achievementMessages(previous, merged.snapshots, planBefore),
        ].join('；'),
      );
    } catch (error) {
      // JSON.parse 的 SyntaxError 是英文原文（"Unexpected token..."），换成用户能看懂的提示
      setImportError(
        error instanceof SyntaxError
          ? '备份文件不是有效的 JSON：请确认选的是工具箱导出的备份'
          : error instanceof Error
            ? error.message
            : '合并导入失败',
      );
    }
  };

  return (
    <main className="mx-auto max-w-md space-y-3 p-4">
      {/* 用真正的 button 触发隐藏 input：部分手机内置浏览器对 label 包裹 hidden input 支持不佳 */}
      <button
        type="button"
        data-testid="import-button"
        onClick={() => fileInputRef.current?.click()}
        className="flex min-h-[52px] w-full items-center justify-center rounded-xl bg-emerald-600 px-4 text-base font-medium text-white"
      >
        {importing ? '导入中…' : '导入游戏数据'}
      </button>
      <p className="-mt-1 text-center text-xs text-slate-400">
        采集器里点「分享」选「洛克工具箱」会自动导入；也可以在这里手选文件（抓包 .pcap / 备份 .json，可多选）
      </p>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json,.pcap,application/vnd.tcpdump.pcap"
        multiple
        className="hidden"
        data-testid="import-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) void handleImport(files);
          event.target.value = '';
        }}
      />

      {/* 导入结果 / 错误紧跟主按钮：导入失败、合并结果都在这里第一时间看到 */}
      {importError ? (
        <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{importError}</div>
      ) : null}
      {dataMessage ? (
        <p className="-mt-1 text-xs text-emerald-700" data-testid="data-message">
          {dataMessage}
        </p>
      ) : null}

      {!loaded ? (
        <p className="text-sm text-slate-400">正在读取本地数据…</p>
      ) : snapshots.length === 0 ? (
        <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500" data-testid="import-empty">
          还没有数据。先按下面的「3 步上手」导一次，看板会自动算出两块进度。
        </div>
      ) : null}

      {/* 当前数据状态放在主按钮下面：有几个账号、上次什么时候导的 */}
      {loaded && snapshots.length > 0 ? (
        <p className="text-xs text-slate-400">
          <span>{snapshots.length} 个账号</span>
          {lastImportedAt ? <span> · 上次导入 {new Date(lastImportedAt).toLocaleString()}</span> : null}
        </p>
      ) : null}

      {stale ? (
        <div className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800">
          数据已超过一周未更新，请重新导入抓包数据。
        </div>
      ) : null}

      {/* 第一次用？3 步上手（2026-10-06）：此前导入页完全没说数据从哪来，
          新用户不知道「抓包」是什么、采集器在哪拿 → 给一条最短路径 */}
      <section className="rounded-2xl bg-white p-3 shadow-sm" data-testid="import-guide">
        <button
          type="button"
          aria-expanded={guideOpen}
          onClick={() => setGuideOpen((open) => !open)}
          data-testid="import-guide-toggle"
          className="flex min-h-[32px] w-full items-center justify-between text-left text-sm font-medium text-slate-500"
        >
          <span>第一次用？3 步上手</span>
          <span className="text-xs text-slate-300" aria-hidden>
            {guideOpen ? '▲' : '▼'}
          </span>
        </button>
        {guideOpen ? (
          <ol className="mt-1 space-y-1.5 text-[13px] leading-relaxed text-slate-600">
            <li>
              <span className="font-medium text-slate-700">1. 装采集器</span>
              ：在手机上装好配套的采集器 APK（安卓）。
            </li>
            <li>
              <span className="font-medium text-slate-700">2. 抓一次</span>
              ：按采集器的提示抓一遍，再在采集器里点「分享」、选「洛克工具箱」；也可以「导出
              全部数据」，再把文件传过来。
            </li>
            <li>
              <span className="font-medium text-slate-700">3. 导入</span>
              ：分享过来的数据会自己进来；也可以点上面的「导入游戏数据」手动选文件。
            </li>
          </ol>
        ) : null}
      </section>

      {autoConflict ? (
        <div
          className="rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700"
          data-testid="sync-conflict-notice"
        >
          已保存到本机。云端刚被别的设备改过，这次自动同步没完成——到下面「云同步」点一次「立即同步」即可。
        </div>
      ) : null}

      {syncNotice ? (
        <div
          className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800"
          data-testid="sync-adopted-notice"
        >
          {syncNotice}
        </div>
      ) : null}

      {/* 云同步（跨设备）已是核心能力（换设备全靠它）→ 从页面最底提到主按钮下面 */}
      <AccountPanel
        autoConflict={autoConflict}
        onAutoConflictHandled={() => setSyncConflict(null)}
      />

      {/* 导入历史入口（「本次新增」明细在看板，2026-10-05 用户拍板） */}
      {importHistory.length > 0 ? <ImportResultCard /> : null}

      {/* 低频操作收在底部、默认收起：导出 / 合并导入 / 重置。
          合并导入与主按钮、分享导入重复度很高（换设备也已经有云同步），所以下沉到这里。 */}
      <section className="rounded-2xl bg-white shadow-sm" data-testid="import-more">
        <button
          type="button"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
          data-testid="import-more-toggle"
          className="flex min-h-[44px] w-full items-center justify-between px-4 text-left text-sm font-medium text-slate-500"
        >
          <span>更多（导出 / 合并导入 / 重置）</span>
          <span className="text-xs text-slate-300" aria-hidden>
            {moreOpen ? '▲' : '▼'}
          </span>
        </button>
        {moreOpen ? (
          <div className="px-4 pb-4" data-testid="import-more-body">
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="export-button"
                disabled={snapshots.length === 0}
                onClick={() => void handleExport()}
                className="flex min-h-[48px] flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 disabled:text-slate-300"
              >
                导出全部数据
              </button>
              <button
                type="button"
                data-testid="import-backup-button"
                onClick={() => backupInputRef.current?.click()}
                className="flex min-h-[48px] flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700"
              >
                合并导入
              </button>
            </div>
            <input
              ref={backupInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              data-testid="backup-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleImportBackup(file);
                event.target.value = '';
              }}
            />
            <p className="mt-1 text-xs text-slate-400">
              导出的是你自己的账号数据（几个账号打包成一个文件）。换设备首选上面的「云同步」；没开云同步时再用它：
              两台设备各导出一份、互相合并导入一次。收到的备份也可以直接在微信/QQ 里「分享给洛克工具箱」。
            </p>
            {snapshots.length > 0 ? (
              <button
                type="button"
                onClick={() => void handleReset()}
                className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600"
              >
                重置导入数据
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* 匿名统计开关（2026-10-06）：只报「设备 + 用了哪个功能」，可随时关掉 */}
      <section className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-700">匿名使用统计</p>
          <p className="mt-0.5 text-xs text-slate-400">
            只记录「哪台设备用了哪个功能」，不含精灵内容；用来知道哪些功能真有人用
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={analyticsOn}
          data-testid="analytics-toggle"
          onClick={() => {
            const next = !analyticsOn;
            setAnalyticsEnabled(next);
            setAnalyticsOn(next);
          }}
          className={`min-h-[36px] shrink-0 rounded-full border px-3 text-xs font-medium ${
            analyticsOn
              ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
              : 'border-slate-200 bg-white text-slate-400'
          }`}
        >
          {analyticsOn ? '已开启' : '已关闭'}
        </button>
      </section>

      <SourceNotice />
    </main>
  );
}