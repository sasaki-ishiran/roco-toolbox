import { beforeEach, describe, expect, test } from 'vitest';
import {
  hasAutoImported,
  hasAutoStopped,
  markAutoImported,
  markAutoStopped,
  resetCaptureSessionMarks,
  unmarkAutoImported,
  unmarkAutoStopped,
} from './captureSessionStore';

/**
 * 2026-11-28：失败后「重试」必须能把两道标记都清掉。
 * 只清 autoStopped 时，autoImportFlow.run() 里的 `if (hasAutoImported(session)) return;`
 * 仍会把重试挡回去——按钮看起来可点，实际不会重新导入。
 */
describe('采集会话标记', () => {
  beforeEach(() => resetCaptureSessionMarks());

  test('清掉 autoStopped 与 autoImported 后可以重新判定', () => {
    markAutoStopped('s1');
    markAutoImported('s1');
    expect(hasAutoStopped('s1')).toBe(true);
    expect(hasAutoImported('s1')).toBe(true);

    unmarkAutoStopped('s1');
    unmarkAutoImported('s1');

    expect(hasAutoStopped('s1')).toBe(false);
    expect(hasAutoImported('s1')).toBe(false);
  });

  test('只清 autoStopped 不够：autoImported 仍挡着重试', () => {
    markAutoStopped('s2');
    markAutoImported('s2');
    unmarkAutoStopped('s2');
    expect(hasAutoImported('s2')).toBe(true);
    unmarkAutoImported('s2');
    expect(hasAutoImported('s2')).toBe(false);
  });

  test('清标记只影响这一次会话，不影响别的会话', () => {
    markAutoImported('a');
    markAutoImported('b');
    unmarkAutoImported('a');
    expect(hasAutoImported('a')).toBe(false);
    expect(hasAutoImported('b')).toBe(true);
  });
});