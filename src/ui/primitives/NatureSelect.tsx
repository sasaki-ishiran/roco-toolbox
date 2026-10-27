import { useMemo, useRef, useState } from 'react';
import { allNatureNames, targetNaturePool } from '../../data/catalog';
import { ModalSurface } from './ModalSurface';

export interface NatureSelectProps {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  testId?: string;
  menuTestId?: string;
  optionTestId?: (value: string) => string;
  className?: string;
}

/** 八大目标性格：默认展开这一组，避免一上来滑 30 个。 */
const PRIMARY_NATURES = targetNaturePool.map((nature) => nature.name);
const EXTRA_NATURES = allNatureNames.filter((nature) => !PRIMARY_NATURES.includes(nature));

/**
 * 性格选择（2026-10-27）：不再用一个 30 项的页内下拉。
 *
 * - 第一层：`不挑` + 常用性格（八大目标性格）；
 * - 第二层：搜索 / 展开全部 30 个；
 * - 已选的非常用性格仍然保留在触发按钮上，不会被静默丢掉。
 */
export function NatureSelect({
  label,
  value,
  onValueChange,
  testId,
  menuTestId,
  optionTestId,
  className = '',
}: NatureSelectProps) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const currentLabel = value || '不挑';

  const keywordText = keyword.trim();
  const matches = useMemo(() => {
    if (!keywordText) return [];
    return allNatureNames.filter((nature) => nature.includes(keywordText));
  }, [keywordText]);
  const extras = useMemo(() => {
    if (!keywordText) return EXTRA_NATURES;
    return matches.filter((nature) => !PRIMARY_NATURES.includes(nature));
  }, [keywordText, matches]);
  const primaries = useMemo(() => {
    if (!keywordText) return PRIMARY_NATURES;
    return matches.filter((nature) => PRIMARY_NATURES.includes(nature));
  }, [keywordText, matches]);

  const close = () => {
    setOpen(false);
    setKeyword('');
    triggerRef.current?.focus();
  };

  const choose = (next: string) => {
    onValueChange(next);
    close();
  };

  const option = (nature: string) => {
    const on = nature === value;
    return (
      <button
        key={nature}
        type="button"
        aria-pressed={on}
        onClick={() => choose(nature)}
        data-testid={optionTestId?.(nature)}
        className={`min-h-[34px] rounded-lg border px-2.5 text-xs ${
          on
            ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
            : 'border-slate-200 bg-white text-slate-600'
        }`}
      >
        {nature}
      </button>
    );
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-label={`${label}：${currentLabel}`}
        onClick={() => setOpen(true)}
        data-testid={testId}
        className={`flex min-h-[32px] max-w-full items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-normal text-slate-600 ${className}`}
      >
        <span className="truncate">{currentLabel}</span>
        <span aria-hidden="true" className="text-[10px] text-slate-400">
          ▼
        </span>
      </button>

      <ModalSurface
        open={open}
        title={label}
        placement="sheet"
        onClose={close}
        testId={menuTestId}
        closeTestId="nature-select-close"
        backdropTestId="nature-select-backdrop"
      >
        <div className="space-y-2 p-3">
          <button
            type="button"
            aria-pressed={value === ''}
            onClick={() => choose('')}
            data-testid={optionTestId?.('')}
            className={`min-h-[36px] w-full rounded-lg border px-3 text-left text-sm ${
              value === ''
                ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
                : 'border-slate-200 bg-white text-slate-600'
            }`}
          >
            不挑
          </button>

          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜性格（如：胆、固、踏）"
            aria-label="搜索性格"
            data-testid="nature-select-search"
            className="min-h-[36px] w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-700"
          />

          {primaries.length > 0 ? (
            <section className="space-y-1" data-testid="nature-select-primary">
              <h3 className="text-[11px] font-medium text-slate-400">
                {keywordText ? '匹配的常用性格' : '常用性格'}
              </h3>
              <div className="flex flex-wrap gap-1.5">{primaries.map(option)}</div>
            </section>
          ) : null}

          {extras.length > 0 ? (
            <section className="space-y-1" data-testid="nature-select-extra">
              <h3 className="text-[11px] font-medium text-slate-400">
                {keywordText ? '其他匹配' : `更多性格 ${extras.length}`}
              </h3>
              <div className="flex flex-wrap gap-1.5">{extras.map(option)}</div>
            </section>
          ) : null}

          {keywordText && matches.length === 0 ? (
            <p className="py-3 text-center text-xs text-slate-400">没有匹配的性格</p>
          ) : null}
        </div>
      </ModalSurface>
    </>
  );
}
