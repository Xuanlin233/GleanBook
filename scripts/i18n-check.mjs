// Checks the interface translations (npm run i18n:check):
//  - every tr('…') text in src/ has an entry in each src/locales/*.ts file, with the same
//    {placeholders};
//  - no Chinese text is shown without tr() (strings, templates, JSX text). Text that must
//    stay Chinese, such as fixed keys, is marked with an `i18n-ignore` comment on the line
//    or the line above;
//  - entries that are no longer used are listed as warnings.
// `--missing <lang>` prints the untranslated texts as a ready-to-fill object.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const CJK = /[　-〿一-鿿＀-￯]/;
const placeholders = (s) =>
  [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');

const keys = new Map(); // text -> first location
const errors = [];
const warnings = [];

function walk(node, parent, visit) {
  if (!node || typeof node.type !== 'string') return;
  if (visit(node, parent) === false) return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'start' || k === 'end') continue;
    if (Array.isArray(v)) for (const c of v) walk(c, node, visit);
    else if (v && typeof v === 'object') walk(v, node, visit);
  }
}

const files = readdirSync(src, { recursive: true })
  .map(String)
  .filter((f) => /\.tsx?$/.test(f) && !f.startsWith('locales') && f !== 'i18n.ts');
for (const rel of files) {
  const text = readFileSync(path.join(src, rel), 'utf8');
  const lines = text.split(/\r?\n/);
  const lineOf = (pos) => text.slice(0, pos).split('\n').length;
  const ignored = (pos) => {
    const n = lineOf(pos);
    return /i18n-ignore/.test((lines[n - 1] ?? '') + (lines[n - 2] ?? ''));
  };
  const at = (node) => `src/${rel.replace(/\\/g, '/')}:${lineOf(node.start)}`;
  const ast = parseAst(text, { lang: rel.endsWith('x') ? 'tsx' : 'ts' });
  const visit = (node, parent) => {
    if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration') return false;
    if (/^TS(?!AsExpression|SatisfiesExpression|NonNullExpression)/.test(node.type)) return false;
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'tr'
    ) {
      const [first, ...rest] = node.arguments;
      if (first?.type === 'Literal' && typeof first.value === 'string') {
        if (!keys.has(first.value)) keys.set(first.value, at(node));
      } else if (!ignored(node.start))
        errors.push(`${at(node)} tr() 的第一个参数必须是字符串字面量`);
      for (const r of rest) walk(r, node, visit);
      return false;
    }
    const stray =
      (node.type === 'Literal' &&
        typeof node.value === 'string' &&
        !node.regex &&
        CJK.test(node.value)) ||
      (node.type === 'TemplateLiteral' &&
        node.quasis.some((q) => CJK.test(q.value.cooked ?? ''))) ||
      (node.type === 'JSXText' && CJK.test(node.value));
    if (!stray) return;
    if (parent?.type === 'Property' && parent.key === node && !parent.computed) return;
    if (!ignored(node.start))
      errors.push(
        `${at(node)} 未翻译的界面文字：${text.slice(node.start, node.end).trim().slice(0, 60)}`,
      );
    return node.type !== 'TemplateLiteral';
  };
  walk(ast, null, visit);
}

// Locale files: `export const xx: Record<string, string> = { '中文': 'Translation', … };`
const localeDir = path.join(src, 'locales');
const locales = {};
for (const file of readdirSync(localeDir).filter((f) => f.endsWith('.ts'))) {
  const text = readFileSync(path.join(localeDir, file), 'utf8');
  const entries = new Map();
  walk(parseAst(text, { lang: 'ts' }), null, (node) => {
    if (node.type !== 'ObjectExpression') return;
    for (const p of node.properties) {
      const k = p.key?.type === 'Literal' ? p.key.value : p.key?.name;
      if (p.value?.type !== 'Literal' || typeof p.value.value !== 'string')
        errors.push(`src/locales/${file} “${k}” 的译文必须是字符串字面量`);
      else {
        if (entries.has(k)) errors.push(`src/locales/${file} 重复条目：${k}`);
        entries.set(k, p.value.value);
      }
    }
    return false;
  });
  locales[file.replace(/\.ts$/, '')] = entries;
}

for (const [lang, entries] of Object.entries(locales)) {
  let missing = 0;
  for (const [key, where] of keys) {
    if (!entries.has(key)) {
      missing++;
      if (missing <= 30) errors.push(`${lang} 缺少翻译（${where}）：${key}`);
    } else if (placeholders(entries.get(key)) !== placeholders(key))
      errors.push(`${lang} 占位符不一致：${key} → ${entries.get(key)}`);
  }
  if (missing > 30) errors.push(`${lang} 另有 ${missing - 30} 条缺少翻译`);
  for (const key of entries.keys())
    if (!keys.has(key)) warnings.push(`${lang} 未使用的条目：${key}`);
}

const want = process.argv.indexOf('--missing');
if (want > 0) {
  const entries = locales[process.argv[want + 1]] ?? new Map();
  for (const key of keys.keys())
    if (!entries.has(key)) console.log(`  ${JSON.stringify(key)}: '',`);
  process.exit(0);
}

for (const w of warnings) console.warn('提示 ' + w);
for (const e of errors) console.error('错误 ' + e);
console.log(
  `界面文字 ${keys.size} 条；语言：${Object.entries(locales)
    .map(([l, e]) => `${l} ${[...keys.keys()].filter((k) => e.has(k)).length}`)
    .join('，')}。`,
);
if (errors.length) process.exit(1);
