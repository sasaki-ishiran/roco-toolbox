import { useState, type ReactNode } from 'react';
import { analyticsEnabled, setAnalyticsEnabled } from '../../../api/analytics';
import { clearLocalData } from '../../clearLocalData';
import { ImportPanel } from '../../ImportPanel';
import { Button } from '../../primitives/Button';
import { ModalSurface } from '../../primitives/ModalSurface';
import type { SectionProps } from '../types';

/**
 * 更多与设置（2026-11-28 重排）：这里只放**导航、帮助与隐私**，不放业务数字。
 *
 * 设置类内容（导出 / 数据来源 / 匿名统计）按规范 §0.4 不进首屏：
 * 导出与来源收在同一行的弹层里；「使用统计」是隐私开关，直接放进设置分组，不再藏进弹层。
 */
function SettingsList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <h2 className="px-s4 pb-s1 pt-s3 text-caption font-semibold tracking-wide text-ink-muted">
        {title}
      </h2>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

function SettingsRow({
  testId,
  label,
  value,
  onClick,
}: {
  testId: string;
  label: string;
  value?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      data-testid={testId}
      className="flex min-h-12 w-full items-center gap-s2 px-s4 text-left text-body text-ink transition-colors active:bg-surface-sunken disabled:text-ink-muted disabled:active:bg-transparent"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {value ? <span className="shrink-0 text-meta text-ink-muted">{value}</span> : null}
      <span aria-hidden className="shrink-0 text-ink-faint">
        ›
      </span>
    </button>
  );
}

export function SettingsSection({ ctx }: SectionProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [analyticsOn, setAnalyticsOn] = useState(() => analyticsEnabled());

  const confirmClear = async () => {
    setClearing(true);
    try {
      await clearLocalData();
    } finally {
      setClearing(false);
      setClearOpen(false);
    }
  };

  return (
    <div data-section="settings" className="space-y-s3">
      <SettingsList title="设置与帮助">
        <SettingsRow
          testId="profile-section-identity"
          label="我的身份"
          value={ctx.accountId ? ctx.accountName || '已登录' : '未登录'}
          onClick={ctx.onGoIdentity}
        />
        <SettingsRow testId="profile-guide" label="新手引导" value="重看一遍" onClick={ctx.onStartTour} />
        <SettingsRow
          testId="profile-settings-more"
          label="导出 / 数据来源"
          value="设置"
          onClick={() => setSettingsOpen(true)}
        />
        {/* 清空本机数据（2026-11-28 CLEAN2）：文件导入删除后保留的安全阀，只清本机 */}
        <SettingsRow
          testId="profile-settings-clear"
          label="清空本机数据"
          value="不可撤销"
          onClick={() => setClearOpen(true)}
        />
        {/* 匿名统计（2026-11-28 CLEAN2）：从导入面板移进设置，保留随时关闭的入口 */}
        <div
          className="flex min-h-12 items-center gap-s2 px-s4 py-s1"
          data-testid="settings-analytics"
        >
          <div className="min-w-0 flex-1">
            <p className="text-body text-ink">使用统计</p>
            <p className="text-meta text-ink-muted">
              只记录「哪台设备用了哪个功能」，不含精灵内容
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={analyticsOn}
            aria-label="使用统计"
            data-testid="analytics-toggle"
            onClick={() => {
              const next = !analyticsOn;
              setAnalyticsEnabled(next);
              setAnalyticsOn(next);
            }}
            className={`min-h-8 shrink-0 rounded-md border px-2.5 text-meta font-medium ${
              analyticsOn
                ? 'border-accent bg-accent-soft text-accent-strong'
                : 'border-line bg-surface text-ink-muted'
            }`}
          >
            {analyticsOn ? '已开启' : '已关闭'}
          </button>
        </div>
      </SettingsList>

      <ModalSurface
        open={settingsOpen}
        title="导出与数据来源"
        onClose={() => setSettingsOpen(false)}
        testId="profile-settings-dialog"
        closeTestId="profile-settings-close"
      >
        <div className="p-s4">
          <ImportPanel />
        </div>
      </ModalSurface>

      <ModalSurface
        open={clearOpen}
        title="清空本机数据"
        onClose={() => {
          if (!clearing) setClearOpen(false);
        }}
        testId="clear-local-dialog"
        closeTestId="clear-local-close"
        footer={
          <div className="flex justify-end gap-s2">
            <Button
              variant="secondary"
              disabled={clearing}
              onClick={() => setClearOpen(false)}
              data-testid="clear-local-cancel"
            >
              取消
            </Button>
            <Button
              variant="danger"
              busy={clearing}
              onClick={() => void confirmClear()}
              data-testid="clear-local-confirm"
            >
              确认清空
            </Button>
          </div>
        }
      >
        <div className="space-y-s3 p-s4 text-body text-ink" data-testid="clear-local-body">
          <p>
            清空本机的账号快照，以及由它派生的筛选、计划、「已换到」、本次新增等缓存。
          </p>
          <p>
            云端那份还在：重新登录同一账号，点「私有同步 · 立即同步」就能拉回来。
            <strong className="font-semibold"> 不想丢数据，请先同步一次。</strong>
          </p>
          <p className="rounded-tile border border-rose-200 bg-rose-50 px-s3 py-s2 text-rose-700">
            此操作不可撤销。
          </p>
        </div>
      </ModalSurface>
    </div>
  );
}
