import { useId } from 'react';
import { FIELD } from './styles';

export interface SearchFieldProps {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  description?: string;
  testId?: string;
  className?: string;
}

/**
 * 清单搜索（2026-10-24 统一控件）：固定在清单顶部、独立于高级筛选。
 *
 * - 始终有可访问名称（label）
 * - 有值时才出现「清除搜索」，触区 44×44，且**只**清这个词——不碰其他筛选
 */
export function SearchField({
  label,
  value,
  onValueChange,
  placeholder,
  description,
  testId,
  className = '',
}: SearchFieldProps) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {description ? <p className="mb-1 text-xs text-slate-400">{description}</p> : null}
      <div className="relative">
        <input
          id={id}
          type="search"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={placeholder}
          data-testid={testId}
          className={`${FIELD} pr-12`}
        />
        {value ? (
          <button
            type="button"
            onClick={() => onValueChange('')}
            aria-label="清除搜索"
            className="absolute right-0 top-0 flex min-h-[44px] min-w-[44px] items-center justify-center text-sm text-slate-400"
          >
            ✕
          </button>
        ) : null}
      </div>
    </div>
  );
}
