const assert = require('assert'); const C = require('../core.js');
const T0 = new Date('2026-11-03T10:00:00').getTime(); let c = C.newCard(T0);
assert.strictEqual(c.due, T0 + 5 * C.MIN);
assert.strictEqual(C.grade(c, true, T0).event, 'practice', 'not due -> practice');
let t = c.due, path = [];
for (let i = 0; i < 7; i++) { const r = C.grade(c, true, t); c = r.card; path.push(r.event); t = c.due; }
assert.deepStrictEqual(path, ['advance','advance','advance','advance','advance','advance','mastered']);
assert.ok(c.mastered && c.stage === 7);
let r = C.grade(c, false, t); assert.strictEqual(r.card.stage, 4); assert.ok(!r.card.mastered); assert.strictEqual(r.card.due, t + 5 * C.MIN);
r = C.grade(C.newCard(T0), false, T0); assert.strictEqual(r.card.stage, 0);
assert.strictEqual(C.streak(['2026-11-01','2026-11-02','2026-11-03'], '2026-11-03'), 3);
assert.strictEqual(C.streak(['2026-11-01','2026-11-02'], '2026-11-03'), 2);
assert.strictEqual(C.streak(['2026-11-01'], '2026-11-03'), 0);
assert.strictEqual(C.findForm('Researchers analysed the data.', 'analyse').form, 'analysed');
assert.strictEqual(C.findForm('Farmland occupies most land.', 'occupy').form, 'occupies');
assert.strictEqual(C.findForm('I like cats.', 'analyse'), null);
assert.ok(C.checkSentence('Scientists analyse samples every single week.', 'analyse').ok);
assert.strictEqual(C.checkSentence('i analyse it', 'analyse').errors.length, 3);
assert.ok(C.answerMatch('  Analyse ', 'analyse'));
assert.strictEqual(C.foxAge(359, 359).label, '1岁'); assert.strictEqual(C.foxAge(0, 359).months, 0);
let f = { food: 2, xp: 0, hunger: 100, lastCheck: '2026-11-01' };
f = C.applyHunger(f, ['2026-11-01'], '2026-11-04'); assert.strictEqual(f.hunger, 50); // 11-02,11-03 missed
f = C.feed(f).fox; assert.deepStrictEqual([f.food, f.hunger, f.xp], [1, 60, 10]);
assert.strictEqual(C.foxLevel(0), 1); assert.strictEqual(C.foxLevel(20), 2);
global.window = {}; require('../data/books.js');
for (const b of window.VOCAB_BOOKS) for (const w of b.words) { assert.ok(w.word && w.ipa && w.pos && w.meaning && w.examples.length, w.word); assert.ok(C.makeCloze(w.examples[0], w.word), 'cloze ' + w.word); }
console.log('core tests passed;', window.VOCAB_BOOKS[0].words.length, 'words');
