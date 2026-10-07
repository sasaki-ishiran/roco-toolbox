import { describe, expect, test } from 'vitest';
import { fetchAllModules } from '../src/fetch-modules.mjs';

const modules = [
  { title: 'Module:A', file: 'A.lua' },
  { title: 'Module:B', file: 'B.lua' },
];

const okResponse = (wikitext) =>
  new Response(JSON.stringify({ parse: { wikitext } }), { status: 200, headers: { 'content-type': 'application/json' } });

const noSleep = async () => {};

describe('fetchAllModules', () => {
  test('遇到限流（567）会重试，成功后返回内容', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return new Response('', { status: 567 });
      return okResponse('return {a=1}');
    };
    const result = await fetchAllModules({ modules: [modules[0]], fetchImpl, sleep: noSleep, delayMs: 0 });
    expect(calls).toBe(2);
    expect(result).toEqual([{ file: 'A.lua', title: 'Module:A', text: 'return {a=1}' }]);
  });

  test('重试到上限仍失败就抛错，不返回部分结果', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response('', { status: 567 });
    };
    await expect(
      fetchAllModules({ modules, fetchImpl, sleep: noSleep, delayMs: 0, attempts: 3 }),
    ).rejects.toThrow(/567/);
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  test('全部成功时按声明顺序返回每个模块', async () => {
    const fetchImpl = async (url) => {
      const page = new URL(url).searchParams.get('page');
      return okResponse(`return {u="${page}"}`);
    };
    const result = await fetchAllModules({ modules, fetchImpl, sleep: noSleep, delayMs: 0 });
    expect(result.map((item) => item.file)).toEqual(['A.lua', 'B.lua']);
    expect(result.map((item) => item.text)).toEqual(['return {u="Module:A"}', 'return {u="Module:B"}']);
  });

  test('返回内容为空也算失败', async () => {
    const fetchImpl = async () => okResponse('');
    await expect(fetchAllModules({ modules: [modules[0]], fetchImpl, sleep: noSleep, delayMs: 0, attempts: 2 })).rejects.toThrow(
      /为空/,
    );
  });

  test('请求带浏览器风格请求头，否则会被 CDN 拦成 567', async () => {
    let headers;
    const fetchImpl = async (url, options) => {
      headers = options.headers;
      return okResponse('return {}');
    };
    await fetchAllModules({ modules: [modules[0]], fetchImpl, sleep: noSleep, delayMs: 0 });
    expect(headers['User-Agent']).toMatch(/Mozilla\/5\.0/);
    expect(headers.Accept).toContain('application/json');
    expect(headers['Accept-Language']).toContain('zh-CN');
    expect(headers.Referer).toBe('https://wiki.biligame.com/nrc/');
  });
});
