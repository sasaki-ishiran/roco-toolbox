import { describe, expect, test } from 'vitest';
import { parseLuaReturn } from '../src/lua-tables.mjs';

describe('parseLuaReturn', () => {
  test('把命名键的 Lua 表解析成对象', () => {
    expect(parseLuaReturn('return {a=1, b="二"}')).toEqual({ a: 1, b: '二' });
  });

  test('把纯位置值的 Lua 表解析成数组', () => {
    expect(parseLuaReturn('return {6, 9}')).toEqual([6, 9]);
  });

  test('嵌套表按对象/数组混合解析', () => {
    const lua = 'return {pet_000001={name="喵喵", egg_group={6,9}, stats={hp=65}}}';
    expect(parseLuaReturn(lua)).toEqual({
      pet_000001: { name: '喵喵', egg_group: [6, 9], stats: { hp: 65 } },
    });
  });

  test('还原被转义的引号', () => {
    expect(parseLuaReturn('return {a="say \\"hi\\""}')).toEqual({ a: 'say "hi"' });
  });

  test('保留中文字符', () => {
    expect(parseLuaReturn('return {name="机械方方", note="婉转声"}')).toEqual({ name: '机械方方', note: '婉转声' });
  });

  test('解析负数与布尔值', () => {
    expect(parseLuaReturn('return {a=-3, b=true, c=false}')).toEqual({ a: -3, b: true, c: false });
  });

  test('不是 return 语句时报错', () => {
    expect(() => parseLuaReturn('local a = 1')).toThrow();
  });
});
