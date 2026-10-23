/**
 * 无数据时的统一空态。
 *
 * 2026-10-06 修：此前三处空态都写「请先到『看板』导入抓包数据」，但看板上根本没有导入入口
 * （真正入口在「导入数据」页），用户照做会原地打转。这里统一指向「导入数据」页，并给一个
 * 直接跳过去的按钮。
 */
import { Button } from './primitives/Button';
import { StateNotice } from './primitives/StateNotice';

export interface EmptyStateProps {
  /** 跳到「导入数据」页；不给时只显示文案（用于无法导航的场景） */
  onGoImport?: () => void;
}

export function EmptyState({ onGoImport }: EmptyStateProps = {}) {
  return (
    <StateNotice
      kind="empty-data"
      title="还没有数据"
      description="到「导入数据」页导入一次抓包数据后，这里就有内容了。"
      testId="empty-state"
      action={
        onGoImport ? (
          <Button onClick={onGoImport} data-testid="empty-go-import">
            去导入数据
          </Button>
        ) : undefined
      }
    />
  );
}
