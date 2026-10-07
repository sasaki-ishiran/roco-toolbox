// 解析 wiki 的 Lua 数据模块（形如 "return {...}"）为普通 JS 值。
import luaparse from 'luaparse';

/** 把 Lua 字符串字面量还原成 JS 字符串。luaparse 默认模式下 value 为 null，只能从 raw 解码。 */
export function unescapeLuaString(raw) {
  const body = raw.slice(1, -1);
  const simple = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'" };
  return body.replace(/\\(x[0-9a-fA-F]{2}|\d{1,3}|.)/g, (match, esc) => {
    if (esc[0] === 'x') return String.fromCharCode(parseInt(esc.slice(1), 16));
    if (/^\d+$/.test(esc)) return String.fromCharCode(parseInt(esc, 10));
    return Object.prototype.hasOwnProperty.call(simple, esc) ? simple[esc] : esc;
  });
}

function literalToJs(node) {
  switch (node.type) {
    case 'StringLiteral':
      return node.value !== null && node.value !== undefined ? node.value : unescapeLuaString(node.raw);
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return node.value;
    case 'NilLiteral':
      return null;
    case 'UnaryExpression':
      if (node.operator === '-') return -literalToJs(node.argument);
      throw new Error(`不支持的运算符: ${node.operator}`);
    case 'TableConstructorExpression':
      return tableToJs(node);
    default:
      throw new Error(`不支持的节点类型: ${node.type}`);
  }
}

function tableToJs(node) {
  const keyed = node.fields.filter((f) => f.type === 'TableKeyString' || f.type === 'TableKey');
  if (keyed.length === 0) return node.fields.map((f) => literalToJs(f.value));
  const out = {};
  for (const field of keyed) {
    const key = field.type === 'TableKeyString' ? field.key.name : String(literalToJs(field.key));
    out[key] = literalToJs(field.value);
  }
  return out;
}

/** 解析一个 "return {...}" 形式的 Lua 文件内容。 */
export function parseLuaReturn(text) {
  const ast = luaparse.parse(text, { luaVersion: '5.3' });
  const ret = ast.body.find((n) => n.type === 'ReturnStatement');
  if (!ret || ret.arguments.length !== 1) throw new Error('不是单个 return 语句，无法解析');
  return literalToJs(ret.arguments[0]);
}
