const assert = require('assert'); const C = require('../core.js');
const T0 = new Date('2026-11-03T10:00:00').getTime(), DAY = C.DAY;
// FSRS：新卡 Good -> 短期学习步；连续按时 Good 间隔递增，达到 30 天即掌握
let c = C.learnCard(C.Rating.Good, T0);
assert.ok(c.due > T0 && c.due - T0 <= 30 * C.MIN, 'first Good is a short learning step');
assert.strictEqual(C.grade(c, C.Rating.Good, T0).event, 'practice', 'not due -> practice, unchanged');
let t = c.due, path = [], ivs = [];
while (!c.mastered && path.length < 20) { const r = C.grade(c, C.Rating.Good, t); c = r.card; path.push(r.event); ivs.push(C.intervalDays(c)); t = c.due; }
assert.strictEqual(path[path.length - 1], 'mastered'); assert.ok(c.mastered && C.intervalDays(c) >= 30 && c.state === C.State.Review);
for (let i = 1; i < ivs.length; i++) assert.ok(ivs[i] > ivs[i - 1], 'intervals grow');
// 答错：失去掌握、短间隔、lapses+1
let r = C.grade(c, C.Rating.Again, t); assert.strictEqual(r.event, 'lapse'); assert.ok(!r.card.mastered); assert.ok(r.card.due - t < DAY); assert.strictEqual(r.card.lapses, c.lapses + 1);
// 布尔答题映射：true=Good, false=Again
assert.strictEqual(C.grade(c, false, t).event, 'lapse');
// 四档评分：Easy > Good > Hard > Again
const p = C.preview(null, T0); assert.ok(p[4] > p[3] && p[3] >= p[2] && p[2] >= p[1]);
const k = C.markKnown(null, T0); assert.ok(k.mastered && k.due === T0 + 60 * DAY);
// v1 迁移
const v1card = { stage: 3, due: T0 + DAY, reps: 4, lapses: 1, learnedAt: T0 - 5 * DAY, mastered: false, masteredAt: null };
const m = C.migrateCard(v1card);
assert.strictEqual(m.due, v1card.due); assert.strictEqual(m.reps, 4); assert.strictEqual(m.lapses, 1); assert.strictEqual(m.state, C.State.Review); assert.strictEqual(m.stability, 2); assert.strictEqual(m.learnedAt, v1card.learnedAt);
const mm = C.migrateCard({ stage: 7, due: T0 + 30 * DAY, reps: 9, lapses: 0, learnedAt: T0 - 40 * DAY, mastered: true, masteredAt: T0 });
assert.ok(mm.mastered && mm.stability >= 30 && C.intervalDays(mm) >= 30);
const m0 = C.migrateCard({ stage: 0, due: T0 + 5 * C.MIN, reps: 0, lapses: 0, learnedAt: T0 });
assert.strictEqual(m0.state, C.State.Learning);
// 迁移后的卡能继续被 FSRS 调度
assert.ok(C.grade(m, C.Rating.Good, m.due).card.due > m.due + DAY);
assert.ok(C.grade(m0, C.Rating.Good, m0.due).card.due > m0.due);
const st = C.migrate({ v: 1, bookId: 'ielts-toefl-core', settings: { dailyNew: 30 }, books: { 'ielts-toefl-core': { cards: { analyse: v1card }, sentences: { analyse: [{ text: 'X', date: '2026-11-01' }] } } }, days: { '2026-11-01': { new: 1, review: 0, correct: 1, wrong: 0 } }, studyDays: ['2026-11-01'], fox: { food: 3, xp: 20, hunger: 70, lastCheck: '2026-11-01', fed: 2, name: '阿狸' } });
assert.strictEqual(st.v, 2); assert.strictEqual(st.settings.dailyNew, 30); assert.strictEqual(st.settings.autoPlay, true);
assert.strictEqual(st.books['ielts-toefl-core'].sentences.analyse.length, 1); assert.deepStrictEqual(st.fox.name, '阿狸'); assert.deepStrictEqual(st.studyDays, ['2026-11-01']);
assert.strictEqual(C.migrate(st), st); assert.throws(() => C.migrate({ v: 9, books: {} }));
// 英音
assert.strictEqual(C.audioUrl('analyse'), 'https://dict.youdao.com/dictvoice?audio=analyse&type=1');
assert.strictEqual(C.pickVoice([{ lang: 'en-US', name: 'a' }, { lang: 'en-GB', name: 'b' }]).name, 'b'); assert.strictEqual(C.pickVoice([{ lang: 'en-US' }]), null);
// 其他（沿用 v1）
assert.strictEqual(C.streak(['2026-11-01', '2026-11-02', '2026-11-03'], '2026-11-03'), 3);
assert.strictEqual(C.streak(['2026-11-01'], '2026-11-03'), 0);
assert.strictEqual(C.findForm('Researchers analysed the data.', 'analyse').form, 'analysed');
assert.strictEqual(C.findForm('Farmland occupies most land.', 'occupy').form, 'occupies');
assert.ok(C.checkSentence('Scientists analyse samples every single week.', 'analyse').ok);
assert.strictEqual(C.checkSentence('i analyse it', 'analyse').errors.length, 3);
assert.strictEqual(C.foxAge(2209, 2209).label, '1岁'); assert.strictEqual(C.foxAge(0, 2209).months, 0);
let f = { food: 2, xp: 0, hunger: 100, lastCheck: '2026-11-01' };
f = C.applyHunger(f, ['2026-11-01'], '2026-11-04'); assert.strictEqual(f.hunger, 50);
f = C.feed(f).fox; assert.deepStrictEqual([f.food, f.hunger, f.xp], [1, 60, 10]);
// 词书数据
global.window = {}; const books = {}; window.__registerBook = b => books[b.id] = b;
require('../data/books-index.js'); for (const b of window.VOCAB_BOOK_INDEX) require('../' + b.file);
const orig = require('../data/original-words.json');
for (const id in books) { const b = books[id]; assert.strictEqual(b.words.length, window.VOCAB_BOOK_INDEX.find(x => x.id === id).count); const seen = new Set();
  for (const w of b.words) { assert.ok(w.word && w.pos && w.meaning, id + ' ' + w.word); assert.ok(!seen.has(w.word), 'dup ' + w.word); seen.add(w.word); assert.ok(Array.isArray(w.examples)); if (w.examples.length) assert.ok(C.hasExample(w), 'cloze ' + w.word); } }
const core = books['ielts-toefl-core'];
for (let i = 0; i < orig.length; i++) { assert.strictEqual(core.words[i].word, orig[i].word); assert.deepStrictEqual(core.words[i].examples, orig[i].examples); }
assert.ok(core.words.length >= 2000 && core.words.length <= 3000, 'core size');
assert.ok(books['ielts-toefl-full'].words.length > core.words.length);
console.log('core tests passed;', Object.entries(books).map(([k, b]) => k + '=' + b.words.length).join(', '), '; mastered after', path.length, 'Good reviews');
