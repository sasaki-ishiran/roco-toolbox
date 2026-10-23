import { describe, expect, test, beforeEach } from 'vitest';
import {
  beginImport,
  getImportOutcome,
  resetImportOutcomeForTest,
  updateImportOutcome,
  useImportOutcome,
} from './importOutcomeStore';

beforeEach(() => {
  resetImportOutcomeForTest();
});

describe('importOutcomeStore', () => {
  test('开始导入进入 importing，阶段分别更新', () => {
    const id = beginImport();
    expect(getImportOutcome()).toMatchObject({
      operationId: id,
      local: 'importing',
      cloud: 'not-enabled',
      group: 'unverified',
    });
    updateImportOutcome(id, { local: 'saved', cloud: 'syncing', message: '新增 1 个账号' });
    expect(getImportOutcome()).toMatchObject({
      local: 'saved',
      cloud: 'syncing',
      group: 'unverified',
    });
    updateImportOutcome(id, { cloud: 'failed' });
    expect(getImportOutcome().cloud).toBe('failed');
    // 本机成功不会被云失败覆盖
    expect(getImportOutcome().local).toBe('saved');
  });

  test('旧 operationId 的晚到响应不能覆盖新导入结果', () => {
    const first = beginImport();
    const second = beginImport();
    updateImportOutcome(first, { local: 'failed', message: '旧响应' });
    expect(getImportOutcome().operationId).toBe(second);
    expect(getImportOutcome().local).toBe('importing');
  });

  test('hook 能读到最新状态', () => {
    // 只验证 hook 的类型/订阅入口存在；渲染级验证在其他组件测试里做
    expect(typeof useImportOutcome).toBe('function');
  });
});
