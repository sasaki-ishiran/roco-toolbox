import { afterEach, describe, expect, test } from 'vitest';
import { requestAutoImport } from './autoImportFlow';

afterEach(() => {
  delete window.rocoDesktop;
});

describe('桌面版的采集策略', () => {
  test('PC 端按实时采集处理：不自动停止、不自动导入', () => {
    window.rocoDesktop = { platform: 'win32', version: '1' };
    expect(requestAutoImport('capture-1.pcap')).toBe(false);
  });
});
