import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { CollectSection } from './CollectSection';
import { makeCtx } from '../testContext';

afterEach(cleanup);

describe('本机采集卡（UX1 方案 A）', () => {
  test('卡面有标题、状态、文件数；说明默认收起；文件导入入口不再出现', () => {
    render(<CollectSection ctx={makeCtx()} />);

    expect(screen.getByTestId('profile-collect')).toBeTruthy();
    expect(screen.getByTestId('profile-collect-card')).toBeTruthy();
    expect(screen.getByTestId('native-collector')).toHaveAttribute('data-compact');
    // 网页没有采集桥：边界必须直接可见（不藏在 ? 里）
    expect(screen.getByTestId('native-collector-status')).toHaveTextContent('没有内置采集');
    expect(screen.getByTestId('native-collector-files')).toHaveTextContent('采集文件 0 个');
    expect(screen.queryByTestId('native-collector-help-body')).toBeNull();
    // 文件导入 / 合并导入 / 导入历史入口已删除
    expect(screen.queryByTestId('import-button')).toBeNull();
    expect(screen.queryByTestId('import-input')).toBeNull();
    expect(screen.queryByTestId('import-more')).toBeNull();
  });

  test('断数据不炸：没有精灵/账号时仍渲染采集卡', () => {
    render(<CollectSection ctx={makeCtx({ snapshots: [] })} />);
    expect(screen.getByTestId('native-collector')).toHaveAttribute('data-compact');
  });
});
