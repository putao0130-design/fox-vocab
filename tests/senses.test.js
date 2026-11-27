const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const forbidden = ['考义', '考点', '考过'];

const senseSrc = read('data/senses.js');
const appSrc = read('app.js');
const css = read('style.css');
for (const bad of forbidden) {
  assert.ok(!senseSrc.includes(bad), 'senses.js ' + bad);
  assert.ok(!appSrc.includes(bad), 'app.js ' + bad);
  assert.ok(!css.includes(bad), 'style.css ' + bad);
}
assert.ok(appSrc.includes('高频义项'));
assert.ok(!/cambridge|剑桥真题|官方真题/i.test(senseSrc));
assert.ok(!senseSrc.includes('question'));
assert.ok(css.includes('#FF0000') && css.includes('border-left:3px solid #FF0000'));
assert.ok(css.includes('.sense-high{color:#FF0000;font-weight:500;'));
assert.ok(css.includes('font-family:"LXGW WenKai","霞鶩文楷",serif'));
assert.ok(css.includes('font-family:"Nunito",sans-serif'));
assert.ok(!css.includes('.sense-high .sense-gloss,.sense-high .sense-mark{color:#FF0000;font-weight:700'));

const ctx = { window: {}, globalThis: {} };
vm.runInNewContext(senseSrc, ctx);
const table = ctx.window.DOGVERB_SENSES;
assert.ok(Array.isArray(table) && table.length > 0);
const fields = ['word', 'pos', 'idx', 'gloss', 'is_high_freq', 'freq_score', 'source'];
for (const row of table) {
  assert.deepStrictEqual(Object.keys(row).sort(), fields.slice().sort(), row.word + ' ' + row.gloss);
  assert.strictEqual(row.source, 'manual', row.word);
  assert.strictEqual(typeof row.is_high_freq, 'boolean');
  assert.strictEqual(typeof row.freq_score, 'number');
  assert.ok(!('sentence' in row) && !('example' in row));
}
assert.ok(table.some(r => r.is_high_freq) && table.some(r => !r.is_high_freq), 'mixed flags in the fixture');

globalThis.DOGVERB_SENSES = table;
const C = require('../core.js');

function glosses(word) { return C.sensesOf(word).map(r => r.gloss); }

// 高频在前，同组按原来的 idx。freq_score 不改变顺序。
assert.deepStrictEqual(glosses('issue'), ['问题', '发行', '后果']);
assert.deepStrictEqual(glosses('Issue'), ['问题', '发行', '后果']);
assert.strictEqual(C.sensesOf('issue')[0].is_high_freq, true);
assert.ok(C.sensesOf('issue').slice(1).every(r => r.is_high_freq === false));
assert.deepStrictEqual(glosses('paper'), ['文章', '纸', '文件']);
assert.deepStrictEqual(glosses('novel'), ['新奇的', '小说', '长篇故事', '异常的']);
assert.deepStrictEqual(glosses('address'), ['演说', '发表(演说或讲话)', '对付', '住址', '举止', '写地址']);
assert.ok(C.sensesOf('address')[3].gloss === '住址' && C.sensesOf('address')[3].freq_score > C.sensesOf('address')[0].freq_score, 'a higher manual score does not jump a non-high sense ahead');
assert.deepStrictEqual(glosses('cell'), ['细胞', '单元', '电池']);
assert.deepStrictEqual(glosses('field'), ['领域', '田地', '场地']);
assert.strictEqual(C.sensesOf('field')[0].idx, 0, 'field keeps the original first sense when that sense is high');
assert.deepStrictEqual(glosses('concrete'), ['具体的', '凝结物', '混凝土', '实在的']);

const synthetic = [
  { word: 'zz', pos: 'n.', idx: 0, gloss: '甲', is_high_freq: false, freq_score: 100, source: 'manual' },
  { word: 'zz', pos: 'n.', idx: 2, gloss: '乙', is_high_freq: true, freq_score: 1, source: 'manual' },
  { word: 'zz', pos: 'v.', idx: 1, gloss: '丙', is_high_freq: true, freq_score: 1, source: 'manual' },
  { word: 'zz', pos: 'n.', idx: 3, gloss: '丁', is_high_freq: false, freq_score: 50, source: 'manual' }
];
assert.deepStrictEqual(C.sensesOf('zz', synthetic).map(r => r.gloss), ['丙', '乙', '甲', '丁']);
assert.deepStrictEqual(C.sortSenses(synthetic).map(r => r.gloss), ['丙', '乙', '甲', '丁']);

// 没有表行的词保持空结果，调用方继续用整行释义。
for (const word of ['analyse', 'approach', 'area', 'action', 'anterior', '']) {
  assert.deepStrictEqual(C.sensesOf(word), [], word || '(empty)');
}
assert.deepStrictEqual(C.sensesOf(null), []);
assert.deepStrictEqual(C.sensesOf('issue', []), []);
assert.deepStrictEqual(C.sensesOf('issue', [{ word: 'issue', pos: 'n.', idx: 0, gloss: '  ', freq_score: 1, source: 'manual', is_high_freq: true }]), []);
assert.deepStrictEqual(C.sensesOf('issue', [{ word: 'issue', pos: 'n.', idx: 0, gloss: '问题', freq_score: 1, source: 'scraped', is_high_freq: true }]), []);
assert.strictEqual(C.sensesOf('zz', [{ word: 'zz', pos: 'n.', idx: 0, gloss: '甲', freq_score: 1, source: 'manual', is_high_freq: 1 }])[0].is_high_freq, false, 'only boolean true is high');

const books = {};
vm.runInNewContext(read('data/book-ielts-toefl-core.js'), { window: { __registerBook: b => { books.core = b; } } });
const byWord = {};
for (const w of books.core.words) byWord[w.word] = w;
const heads = [...new Set(table.map(r => r.word))];
assert.deepStrictEqual(heads.sort(), ['address', 'cell', 'concrete', 'field', 'issue', 'novel', 'paper']);
for (const row of table) {
  const entry = byWord[row.word];
  assert.ok(entry, 'missing book word ' + row.word);
  assert.ok(entry.meaning.includes(row.gloss), row.word + ' gloss not in ECDICT meaning: ' + row.gloss);
}
for (const word of heads) {
  const rows = table.filter(r => r.word === word);
  assert.ok(rows.some(r => r.is_high_freq) && rows.some(r => !r.is_high_freq), word + ' is mixed');
}
for (const word of ['issue', 'paper', 'novel', 'address', 'cell', 'concrete']) {
  const rows = table.filter(r => r.word === word).slice().sort((a, b) => a.idx - b.idx);
  assert.strictEqual(rows[0].is_high_freq, false, word + ' high-freq sense is not the original first sense');
}

console.log('senses tests ok');
