#!/usr/bin/env node
/**
 * 文案 lint：只报告存量、拦截新增（2026-11-08，整合重构第一批 Track B）。
 *
 * 背景与口径（用户已拍板）：教学只留教程体系（src/ui/tour.ts 的分段引导），页面常驻文案
 * 只留一句事实。所以这里盯两类疑似"多余说明"：
 *   1) keyword  —— 出现「说明：」「提示：」「（注」「口径」「已下线」等说明性措辞；
 *   2) long-hint —— className 带 text-slate-400 / text-slate-500 的提示段落正文超过 40 字。
 *
 * 用法：
 *   node tools/lint-copy.mjs                     # 有新增 → 退出码 1；存量只报告
 *   node tools/lint-copy.mjs --update-baseline   # 把当前结果写进基线（存量豁免）
 *   node tools/lint-copy.mjs --report out.md     # 同时把 markdown 报告写到文件
 *
 * 白名单：
 *   - 文件任意位置写 `copy-lint-ignore-file` → 整个文件跳过；
 *   - 违规行本身或它的上一行写 `copy-lint-ignore` → 跳过这一条。
 *
 * 基线的粒度是「文件 + 规则」的条数（tools/lint-copy-baseline.json）：
 * 改写一条既有文案不会误报；只有条数变多才算新增。代价是同文件删几条后又加几条可能漏报，
 * 这是为了日常改文案不折腾基线的取舍。
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIR = join(ROOT, 'src', 'ui');
const BASELINE_FILE = join(ROOT, 'tools', 'lint-copy-baseline.json');

const KEYWORDS = ['说明：', '提示：', '（注', '口径', '已下线'];
const HINT_CLASS = /text-slate-(?:400|500)/;
const MAX_HINT_CHARS = 40;

const args = process.argv.slice(2);
const updateBaseline = args.includes('--update-baseline');
const reportIndex = args.indexOf('--report');
const reportPath = reportIndex >= 0 ? resolve(ROOT, args[reportIndex + 1] ?? '') : null;

/** 递归收集待扫描的 tsx（跳过测试文件）。 */
function collectFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full));
      continue;
    }
    if (!name.endsWith('.tsx')) continue;
    if (/\.(test|spec)\.tsx$/.test(name)) continue;
    out.push(full);
  }
  return out.sort();
}

const posix = (p) => relative(ROOT, p).split(sep).join('/');

/** 去掉注释（保留行号）：块注释整段抹掉，行注释只在不像 URL 时抹掉。 */
function stripComments(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (two === '//' && source[i - 1] !== ':') {
      const end = source.indexOf('\n', i);
      const stop = end < 0 ? source.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

/** 抹掉所有 {…} 表达式（支持嵌套与字符串），用于只量 JSX 正文。 */
function stripBraces(raw) {
  let out = '';
  let depth = 0;
  let quote = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote && raw[i - 1] !== '\\') quote = '';
      if (depth === 0) out += ch;
      continue;
    }
    if (depth > 0 && (ch === '"' || ch === "'" || ch === '`')) {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) out += ch;
  }
  return out;
}

/** 去掉 JSX 标签 / 表达式 / HTML 实体后，统计可见正文字数。 */
function visibleLength(raw) {
  const text = stripBraces(raw)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, '');
  return [...text].length;
}

/** 把一段 JSX 正文压成单行摘要，方便报告里定位。 */
function snippet(raw) {
  const text = stripBraces(raw)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

function lintFile(file) {
  const raw = readFileSync(file, 'utf8');
  const clean = stripComments(raw);
  const lines = clean.split(/\r?\n/);
  const rawLines = raw.split(/\r?\n/);
  const hits = [];

  if (raw.includes('copy-lint-ignore-file')) return hits;

  // 白名单标记本身写在注释里，会被 stripComments 抹掉，所以要在原文上找
  const ignored = (index) => {
    const own = rawLines[index] ?? '';
    const prev = rawLines[index - 1] ?? '';
    return own.includes('copy-lint-ignore') || prev.includes('copy-lint-ignore');
  };

  const push = (line, rule, text) => {
    const index = line - 1;
    if (ignored(index)) return;
    hits.push({ file: posix(file), line, rule, text: snippet(text) });
  };

  // 规则 1：说明性措辞（注释已在 clean 里抹掉）
  lines.forEach((line, index) => {
    const hit = KEYWORDS.find((word) => line.includes(word));
    if (hit) push(index + 1, 'keyword', line);
  });

  // 规则 2：text-slate-400/500 的提示段落正文超过 40 字
  for (let i = 0; i < lines.length; i += 1) {
    const open = lines[i];
    const match = /<([a-zA-Z][\w.]*)\b[^>]*className=("[^"]*"|\{`[^`]*`\})/.exec(open);
    if (!match || !HINT_CLASS.test(match[2])) continue;
    const tag = match[1];
    const close = `</${tag}>`;
    let body = '';
    let end = -1;

    // 单行写法：<p ...>正文</p>
    const sameLine = open.indexOf('>', open.indexOf(match[2]) + match[2].length);
    if (sameLine >= 0 && open.indexOf(close, sameLine) > sameLine) {
      body = open.slice(sameLine + 1, open.indexOf(close, sameLine));
      end = i;
    } else {
      for (let j = i; j < lines.length && j < i + 30; j += 1) {
        const part = j === i ? open.slice(open.indexOf('>', open.indexOf(match[2]) + match[2].length) + 1) : lines[j];
        if (part.includes(close)) {
          body += ` ${part.slice(0, part.indexOf(close))}`;
          end = j;
          break;
        }
        body += ` ${part}`;
      }
    }

    if (end >= 0 && visibleLength(body) > MAX_HINT_CHARS) push(i + 1, 'long-hint', body);
    if (end > i) i = end; // 跳过已消费的正文行
  }

  return hits;
}

function loadBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
  } catch {
    return { counts: {} };
  }
}

/** 基线结构：{ counts: { "src/ui/X.tsx": { keyword: 2, "long-hint": 1 } } } */
function toCounts(hits) {
  const counts = {};
  for (const hit of hits) {
    counts[hit.file] ??= {};
    counts[hit.file][hit.rule] = (counts[hit.file][hit.rule] ?? 0) + 1;
  }
  return counts;
}

function diffAgainstBaseline(hits, baseline) {
  const remaining = JSON.parse(JSON.stringify(baseline.counts ?? {}));
  const allowed = [];
  const added = [];
  for (const hit of hits) {
    const left = remaining[hit.file]?.[hit.rule] ?? 0;
    if (left > 0) {
      remaining[hit.file][hit.rule] = left - 1;
      allowed.push(hit);
    } else {
      added.push(hit);
    }
  }
  return { allowed, added };
}

function renderReport({ files, hits, allowed, added, baselinePath }) {
  const lines = [];
  lines.push('# 文案 lint 报告');
  lines.push('');
  lines.push(`- 扫描目录：src/ui（${files} 个 tsx，已跳过 *.test.tsx / *.spec.tsx）`);
  lines.push('- 口径：教学只留教程体系；页面常驻文案只留一句事实');
  lines.push(`- 基线：${baselinePath}`);
  lines.push('');
  lines.push(`## 存量（只报告，不拦截）：${allowed.length} 条`);
  lines.push('');
  if (allowed.length === 0) {
    lines.push('（无）');
  } else {
    lines.push('| 文件 | 行 | 规则 | 摘要 |');
    lines.push('| --- | --- | --- | --- |');
    for (const hit of allowed) {
      lines.push(`| ${hit.file} | ${hit.line} | ${hit.rule} | ${hit.text.replace(/\|/g, '\\|')} |`);
    }
  }
  lines.push('');
  lines.push(`## 新增（会拦截）：${added.length} 条`);
  lines.push('');
  if (added.length === 0) {
    lines.push('（无）');
  } else {
    lines.push('| 文件 | 行 | 规则 | 摘要 |');
    lines.push('| --- | --- | --- | --- |');
    for (const hit of added) {
      lines.push(`| ${hit.file} | ${hit.line} | ${hit.rule} | ${hit.text.replace(/\|/g, '\\|')} |`);
    }
  }
  lines.push('');
  if (hits.length > 0) {
    lines.push('> 确认是新文案该保留时：在该行或上一行写 `copy-lint-ignore`；整文件豁免写 `copy-lint-ignore-file`。');
  }
  return lines.join('\n');
}

function main() {
  const files = collectFiles(SCAN_DIR);
  const hits = files.flatMap(lintFile);

  if (updateBaseline) {
    const payload = {
      updatedAt: new Date().toISOString().slice(0, 10),
      note: '存量基线：条数口径（文件 + 规则）。改写既有文案不加条，新增才拦截。',
      counts: toCounts(hits),
    };
    writeFileSync(BASELINE_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`文案 lint：已写入基线 ${posix(BASELINE_FILE)}（存量 ${hits.length} 条）`);
    return 0;
  }

  const baseline = loadBaseline();
  const { allowed, added } = diffAgainstBaseline(hits, baseline);
  const report = renderReport({
    files: files.length,
    hits,
    allowed,
    added,
    baselinePath: posix(BASELINE_FILE),
  });

  console.log(report);
  if (reportPath) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${report}\n`, 'utf8');
  }

  if (added.length > 0) {
    console.error(`\n文案 lint 不通过：新增 ${added.length} 条说明性文案（见上表）。`);
    return 1;
  }
  console.log(`\n文案 lint 通过：存量 ${allowed.length} 条，新增 0 条。`);
  return 0;
}

process.exitCode = main();
