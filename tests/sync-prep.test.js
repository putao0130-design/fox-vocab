const assert = require('assert');
const fs = require('fs');
const path = require('path');
const P = require('../sync-prep.js');
const DAY = 86400000;
const T0 = Date.UTC(2026, 10, 20, 4, 0, 0);

function card(last, reps) {
  return { due: last + DAY, stability: 2, difficulty: 5, elapsed_days: 0, scheduled_days: 1, learning_steps: 0, reps: reps, lapses: 0, state: 2, last_review: last, learnedAt: last - DAY, mastered: false, masteredAt: null };
}
function snap(over) {
  return Object.assign({
    v: 2, bookId: 'ielts-toefl-core', settings: { dailyNew: 20, autoPlay: true },
    books: {}, customBooks: [], days: {}, studyDays: [],
    fox: { food: 0, xp: 0, hunger: 80, lastCheck: '2026-11-20', fed: 0, name: '小狗' }
  }, over);
}
function day(view, zone, date) { return view.days[zone + '|' + date]; }
function legacy(view, date) { return day(view, P.ZONE_LEGACY, date); }
function product(view, date) { return day(view, P.ZONE_PRODUCT, date); }

const deviceA = snap({
  settings: { dailyNew: 20, autoPlay: true },
  days: { '2026-11-01': { new: 3, review: 2, correct: 4, wrong: 1 } },
  studyDays: ['2026-11-01'],
  books: { 'ielts-toefl-core': { cards: { analyse: card(1000, 2) }, sentences: { analyse: [{ text: 'We analyse data.', date: '2026-11-01' }] }, today: ['approach'] } },
  customBooks: [{ id: 'custom-travel', name: '旅游', words: [{ word: 'ticket', meaning: '票' }] }],
  fox: { food: 3, xp: 10, fed: 1, hunger: 90, lastCheck: '2026-11-01', name: '豆豆' }
});
const deviceB = snap({
  settings: { dailyNew: 30, autoPlay: false }, bookId: 'ielts',
  days: { '2026-11-01': { new: 5, review: 2, correct: 1, wrong: 0 }, '2026-11-02': { new: 1, review: 0, correct: 1, wrong: 0 } },
  studyDays: ['2026-11-01', '2026-11-02'],
  books: { 'ielts-toefl-core': { cards: { analyse: card(2000, 4), approach: card(1500, 1) } } },
  fox: { food: 5, xp: 4, fed: 2, hunger: 10, lastCheck: '2026-11-02', name: '小黑' }
});

assert.strictEqual(P.shanghaiDayKey(Date.UTC(2026, 10, 20, 16, 30)), '2026-11-21');
assert.strictEqual(P.shanghaiDayKey(Date.UTC(2026, 10, 20, 15, 59)), '2026-11-20');
assert.strictEqual(P.isEmptySnapshot(snap()), true);
assert.strictEqual(P.isEmptySnapshot(deviceA), false);

assert.strictEqual(P.migrationIdFor(deviceA), P.migrationIdFor(JSON.parse(JSON.stringify(deviceA))));
const swapped = { fox: deviceA.fox, studyDays: deviceA.studyDays, days: deviceA.days, customBooks: deviceA.customBooks, books: deviceA.books, settings: deviceA.settings, bookId: deviceA.bookId, v: 2 };
assert.strictEqual(P.migrationIdFor(deviceA), P.migrationIdFor(swapped), 'migration id ignores key order');

let store = P.createStore();
assert.strictEqual(P.materialize(store, 'ariel'), null);
const emptyTry = P.importLegacy(store, 'ariel', snap());
assert.strictEqual(emptyTry.ok, false);
assert.strictEqual(emptyTry.reason, 'empty-snapshot');
assert.strictEqual(P.materialize(store, 'ariel'), null, 'empty cloud is not created by an empty snapshot');

const first = P.importLegacy(store, 'ariel', deviceA);
assert.strictEqual(first.applied, true);
assert.strictEqual(first.migrationId, P.migrationIdFor(deviceA));
let view = P.materialize(store, 'ariel');
assert.strictEqual(view.eventIds.length, 0, 'legacy import fabricates no events');
assert.strictEqual(legacy(view, '2026-11-01').new, 3);
assert.strictEqual(view.books['ielts-toefl-core'].cards.analyse.reps, 2);
assert.strictEqual(view.fox.food, 3);
assert.strictEqual(view.fox.hunger, undefined, 'hunger is not a synced total');
assert.strictEqual(view.fox.name, '豆豆');
assert.strictEqual(view.settings.dailyNew, 20);
assert.strictEqual(view.settingsRev, 0);
assert.ok(view.studyDays.some(function (d) { return d.day === '2026-11-01' && d.zone === 'device-local'; }));
assert.ok(!view.studyDays.some(function (d) { return d.zone === 'Asia/Shanghai'; }));

const again = P.importLegacy(store, 'ariel', swapped);
assert.strictEqual(again.noop, true);
assert.strictEqual(again.applied, false);
view = P.materialize(store, 'ariel');
assert.strictEqual(legacy(view, '2026-11-01').new, 3, 'same migration id does not add the baseline again');
assert.strictEqual(view.migrations.length, 1);

const overlap = P.importLegacy(store, 'ariel', deviceB);
assert.strictEqual(overlap.applied, true);
assert.strictEqual(overlap.export.limitation, P.LEGACY_OVERLAP_LIMIT);
view = P.materialize(store, 'ariel');
assert.strictEqual(legacy(view, '2026-11-01').new, 5, 'overlap uses max, not 3+5');
assert.strictEqual(legacy(view, '2026-11-01').review, 2, 'equal review counts stay 2, not 4');
assert.strictEqual(legacy(view, '2026-11-01').correct, 4);
assert.strictEqual(legacy(view, '2026-11-01').wrong, 1);
assert.strictEqual(legacy(view, '2026-11-02').new, 1);
assert.strictEqual(view.books['ielts-toefl-core'].cards.analyse.reps, 4, 'later legacy card wins without adding reps');
assert.strictEqual(view.books['ielts-toefl-core'].cards.analyse.last_review, 2000);
assert.ok(view.books['ielts-toefl-core'].cards.approach, 'word that exists on only one device is kept');
assert.strictEqual(view.fox.food, 5);
assert.strictEqual(view.fox.xp, 10, 'xp uses max, not 10+4');
assert.strictEqual(view.fox.fed, 2);
assert.strictEqual(view.fox.name, '豆豆');
assert.strictEqual(overlap.export.nameConflict.other, '小黑');
assert.strictEqual(view.settings.dailyNew, 20, 'settings stay on the baseline revision');
assert.strictEqual(view.settingsRev, 0);
assert.strictEqual(view.settingsConflicts.length, 1);
assert.strictEqual(view.settingsConflicts[0].reason, 'server-rev-not-client-clock');
assert.strictEqual(view.eventIds.length, 0);
assert.ok(overlap.export.droppedCards.some(function (d) { return d.word === 'analyse' && d.dropped.reps === 2 && d.kept.reps === 4; }));
assert.ok(view.limitations.indexOf(P.LEGACY_OVERLAP_LIMIT) >= 0);
const retryB = P.importLegacy(store, 'ariel', deviceB);
assert.strictEqual(retryB.noop, true);
assert.strictEqual(P.materialize(store, 'ariel').fox.food, 5);

const tieStore = P.createStore();
P.importLegacy(tieStore, 'ariel', snap({ books: { core: { cards: { analyse: card(1000, 2) } } }, days: { '2026-11-01': { new: 1, review: 0, correct: 0, wrong: 0 } }, fox: { food: 1, xp: 0, fed: 0, name: '小狗' } }));
const tie = P.importLegacy(tieStore, 'ariel', snap({ books: { core: { cards: { analyse: card(1000, 9) } } }, days: { '2026-11-01': { new: 1, review: 0, correct: 0, wrong: 0 } }, fox: { food: 1, xp: 0, fed: 0, name: '小狗' } }));
assert.strictEqual(P.materialize(tieStore, 'ariel').books.core.cards.analyse.reps, 9, 'tied clocks keep the larger reps and do not add');
assert.strictEqual(tie.export.droppedCards[0].reason, 'tie-higher-reps');
assert.strictEqual(tie.export.droppedCards[0].dropped.reps, 2);

const other = P.importLegacy(store, 'bei', deviceA);
assert.strictEqual(other.applied, true, 'the same legacy id is independent in another account');
assert.strictEqual(P.materialize(store, 'bei').fox.name, '豆豆');
assert.strictEqual(P.materialize(store, 'ariel').books['ielts-toefl-core'].cards.analyse.reps, 4);
assert.ok(!P.materialize(store, 'bei').books['ielts-toefl-core'].cards.approach, 'account B does not receive account A overlap');

const learned = P.acceptEvents(store, 'ariel', [
  { id: 'learn-1', type: 'learn', bookId: 'ielts-toefl-core', word: 'benefit', rating: 3, productDay: '2026-11-20', dayZone: 'Asia/Shanghai', clientNow: 10 ** 15 },
  { id: 'learn-1', type: 'learn', bookId: 'ielts-toefl-core', word: 'benefit', rating: 3, productDay: '2026-11-20', dayZone: 'Asia/Shanghai' },
  { id: 'learn-2', type: 'learn', bookId: 'ielts-toefl-core', word: 'benefit', rating: 4, productDay: '2026-11-20', dayZone: 'Asia/Shanghai', clientNow: 1 }
], { appliedAt: T0 });
assert.strictEqual(learned.ok, true);
view = P.materialize(store, 'ariel');
assert.strictEqual(product(view, '2026-11-20').new, 1, 'two completions of one new word count once');
assert.strictEqual(view.books['ielts-toefl-core'].cards.benefit.last_review, T0, 'schedule uses appliedAt, not the skewed client clock');
assert.ok(view.books['ielts-toefl-core'].cards.benefit.due < T0 + 2 * DAY);
assert.strictEqual(legacy(view, '2026-11-01').new, 5, 'a new event does not add into the legacy day');
const learnRetry = P.acceptEvents(store, 'ariel', [
  { id: 'learn-2', type: 'learn', bookId: 'ielts-toefl-core', word: 'benefit', rating: 4, productDay: '2026-11-20', dayZone: 'Asia/Shanghai' }
], { appliedAt: T0 + 1000 });
assert.strictEqual(learnRetry.results[0].noop, true);
assert.strictEqual(product(P.materialize(store, 'ariel'), '2026-11-20').new, 1);

const grades = P.acceptEvents(store, 'ariel', [
  { id: 'grade-b', type: 'grade', bookId: 'ielts-toefl-core', word: 'benefit', rating: 1, productDay: '2026-11-20', dayZone: 'Asia/Shanghai', clientNow: 1, baseLastReview: 0 },
  { id: 'grade-a', type: 'grade', bookId: 'ielts-toefl-core', word: 'benefit', rating: 3, productDay: '2026-11-20', dayZone: 'Asia/Shanghai', clientNow: 10 ** 15, baseLastReview: 123 }
], { appliedAt: T0 + 5000 });
view = P.materialize(store, 'ariel');
assert.strictEqual(product(view, '2026-11-20').review, 2, 'two different review ids both count');
assert.strictEqual(product(view, '2026-11-20').new, 1);
assert.ok(grades.results.every(function (r) { return r.consumed; }));
assert.strictEqual(view.books['ielts-toefl-core'].cards.benefit.last_review, T0 + 5000);
const repsAfter = view.books['ielts-toefl-core'].cards.benefit.reps;
const gradeRetry = P.acceptEvents(store, 'ariel', [
  { id: 'grade-a', type: 'grade', bookId: 'ielts-toefl-core', word: 'benefit', rating: 3, productDay: '2026-11-20', dayZone: 'Asia/Shanghai' },
  { id: 'grade-b', type: 'grade', bookId: 'ielts-toefl-core', word: 'benefit', rating: 1, productDay: '2026-11-20', dayZone: 'Asia/Shanghai' }
], { appliedAt: T0 + 9000 });
assert.ok(gradeRetry.results.every(function (r) { return r.noop; }));
assert.strictEqual(P.materialize(store, 'ariel').books['ielts-toefl-core'].cards.benefit.reps, repsAfter);

const fresh = P.createStore();
const outOfOrder = P.acceptEvents(fresh, 'ariel', [
  { id: 'g-late', type: 'grade', bookId: 'core', word: 'area', rating: 3, productDay: '2026-11-18', dayZone: 'Asia/Shanghai', clientNow: 10 },
  { id: 'l-first', type: 'learn', bookId: 'core', word: 'area', rating: 3, productDay: '2026-11-18', dayZone: 'Asia/Shanghai', clientNow: 9999999999999 }
], { appliedAt: T0 });
assert.ok(outOfOrder.results.every(function (r) { return r.consumed; }));
let freshView = P.materialize(fresh, 'ariel');
assert.strictEqual(product(freshView, '2026-11-18').new, 1);
assert.strictEqual(product(freshView, '2026-11-18').review, 1);
assert.strictEqual(freshView.books.core.cards.area.last_review, T0, 'arrival grouping applies the review after the learn at appliedAt');
assert.ok(!freshView.days['device-local|2026-11-18'], 'a Shanghai product day does not rewrite a device-local key');

const beiBefore = JSON.stringify(P.materialize(store, 'bei'));
P.acceptEvents(store, 'bei', [
  { id: 'learn-1', type: 'learn', bookId: 'ielts-toefl-core', word: 'other', rating: 3, productDay: '2026-11-20', dayZone: 'Asia/Shanghai' }
], { appliedAt: T0 });
assert.strictEqual(P.materialize(store, 'ariel').books['ielts-toefl-core'].cards.benefit.reps, repsAfter);
assert.ok(!P.materialize(store, 'ariel').books['ielts-toefl-core'].cards.other);
assert.ok(P.materialize(store, 'bei').books['ielts-toefl-core'].cards.other);
assert.notStrictEqual(JSON.stringify(P.materialize(store, 'bei')), beiBefore);

const settings = P.acceptEvents(store, 'ariel', [
  { id: 'set-1', type: 'settings', baseRev: 0, clientNow: 1, patch: { dailyNew: 10, updatedAt: 999 } },
  { id: 'set-stale', type: 'settings', baseRev: 0, clientNow: 10 ** 15, patch: { dailyNew: 99 } }
], { appliedAt: T0 });
view = P.materialize(store, 'ariel');
assert.strictEqual(view.settings.dailyNew, 10);
assert.strictEqual(view.settingsRev, 1);
assert.strictEqual(settings.results[1].reason, 'stale-rev');
assert.ok(!view.eventIds.some(function (id) { return id === 'set-stale'; }));
const settingsNext = P.acceptEvents(store, 'ariel', [
  { id: 'set-2', type: 'settings', baseRev: 1, clientNow: 0, patch: { dailyNew: 12, autoPlay: false } }
], { appliedAt: T0 });
assert.strictEqual(settingsNext.results[0].consumed, true);
assert.strictEqual(P.materialize(store, 'ariel').settings.dailyNew, 12);
assert.strictEqual(P.materialize(store, 'ariel').settings.autoPlay, false);
assert.strictEqual(P.materialize(store, 'ariel').settingsRev, 2);

assert.ok(P.materialize(store, 'ariel').customBooks.some(function (b) { return b.id === 'custom-travel'; }));
const tomb = P.acceptEvents(store, 'ariel', [
  { id: 'del-builtin', type: 'tombstone', entity: 'customBook', bookId: 'ielts-toefl-core' },
  { id: 'del-travel', type: 'tombstone', entity: 'customBook', bookId: 'custom-travel' }
], { appliedAt: T0 });
assert.strictEqual(tomb.results[0].reason, 'bad-tombstone');
assert.strictEqual(tomb.results[1].consumed, true);
view = P.materialize(store, 'ariel');
assert.ok(view.books['ielts-toefl-core'], 'a tombstone does not grant deletion of a built-in book');
assert.ok(!view.customBooks.some(function (b) { return b.id === 'custom-travel'; }));
assert.ok(view.tombstones.indexOf('custom-travel') >= 0);
const lateSnap = JSON.parse(JSON.stringify(deviceA));
lateSnap.days['2026-11-09'] = { new: 9, review: 9, correct: 9, wrong: 9 };
lateSnap.books['ielts-toefl-core'].cards.analyse = card(99999, 50);
const late = P.importLegacy(store, 'ariel', lateSnap);
assert.strictEqual(late.applied, true);
assert.strictEqual(late.export.limitation, P.LATE_LEGACY_LIMIT);
assert.ok(late.export.blockedBooks.indexOf('custom-travel') >= 0);
view = P.materialize(store, 'ariel');
assert.ok(!view.customBooks.some(function (b) { return b.id === 'custom-travel'; }), 'legacy bytes do not resurrect a tombstone');
assert.strictEqual(product(view, '2026-11-20').new, 1, 'a later legacy snapshot does not add its counters onto events');
assert.strictEqual(legacy(view, '2026-11-01').new, 5);
assert.ok(!legacy(view, '2026-11-09'), 'late legacy counters are exported, not merged');
assert.strictEqual(view.books['ielts-toefl-core'].cards.analyse.reps, 4, 'a late legacy card does not replace the sealed card');
const tombRetry = P.acceptEvents(store, 'ariel', [
  { id: 'del-travel', type: 'tombstone', entity: 'customBook', bookId: 'custom-travel' }
], { appliedAt: T0 + 1 });
assert.strictEqual(tombRetry.results[0].noop, true);

const omission = P.createStore();
P.importLegacy(omission, 'ariel', deviceA);
P.importLegacy(omission, 'ariel', snap({
  days: { '2026-11-03': { new: 2, review: 0, correct: 2, wrong: 0 } },
  studyDays: ['2026-11-03'],
  books: { 'ielts-toefl-core': { cards: { benefit: card(3000, 1) } } },
  fox: { food: 1, xp: 1, fed: 0, name: '豆豆' }
}));
const omitted = P.materialize(omission, 'ariel');
assert.ok(omitted.customBooks.some(function (b) { return b.id === 'custom-travel'; }), 'a snapshot that omits a book is not a delete');
assert.strictEqual(omitted.tombstones.length, 0);

const v1 = { v: 1, bookId: 'ielts-toefl-core', settings: { dailyNew: 15 }, days: {}, studyDays: ['2026-11-04'], books: { 'ielts-toefl-core': { cards: { area: { stage: 3, due: T0, reps: 4, lapses: 0, learnedAt: T0 - DAY, mastered: false, masteredAt: null } }, sentences: {} } }, fox: { food: 2, xp: 0, hunger: 70, fed: 0, name: '阿狸' } };
const v1store = P.createStore();
const v1imp = P.importLegacy(v1store, 'ariel', v1);
assert.strictEqual(v1imp.applied, true);
assert.strictEqual(P.importLegacy(v1store, 'ariel', v1).noop, true);
assert.strictEqual(P.materialize(v1store, 'ariel').books['ielts-toefl-core'].cards.area.reps, 4);
assert.strictEqual(P.materialize(v1store, 'ariel').fox.hunger, undefined);

const rawV1 = '{"v":1,"kept":true}';
const rawV1Backup = '{"v":1,"backup":true}';
const rawV2 = JSON.stringify(deviceA);
const disk = P.memoryStorage({ 'foxVocab.v1': rawV1, 'foxVocab.v1.backup': rawV1Backup, 'foxVocab.v2': rawV2 });
const saved = P.commitPrecloudBackup(disk);
assert.strictEqual(saved.ok, true);
assert.strictEqual(saved.wrote, true);
assert.strictEqual(disk.getItem('foxVocab.v1'), rawV1);
assert.strictEqual(disk.getItem('foxVocab.v1.backup'), rawV1Backup);
assert.strictEqual(disk.getItem('foxVocab.v2'), rawV2);
const backupBody = JSON.parse(disk.getItem(P.BACKUP_KEY));
assert.strictEqual(backupBody.sources['foxVocab.v1'], rawV1);
assert.strictEqual(backupBody.sources['foxVocab.v1.backup'], rawV1Backup);
assert.strictEqual(backupBody.sources['foxVocab.v2'], rawV2);
const secondSave = P.commitPrecloudBackup(disk);
assert.strictEqual(secondSave.noop, true);
assert.strictEqual(disk.getItem(P.BACKUP_KEY), JSON.stringify(backupBody));
disk.setItem('foxVocab.v2', '{"v":2,"changed":true}');
const blocked = P.commitPrecloudBackup(disk);
assert.strictEqual(blocked.ok, false);
assert.strictEqual(blocked.reason, 'backup-exists');
assert.strictEqual(disk.getItem('foxVocab.v2'), '{"v":2,"changed":true}');
assert.strictEqual(JSON.parse(disk.getItem(P.BACKUP_KEY)).sources['foxVocab.v2'], rawV2, 'a second backup does not overwrite the first');
disk.setItem('foxVocab.v2', rawV2);

// Leftover immutable backup after the source key later changes (e.g. a new
// calendar day saved foxVocab.v2). enableNew must still proceed and must not
// clobber the first snapshot.
const leftoverDisk = P.memoryStorage({ 'foxVocab.v1': rawV1, 'foxVocab.v1.backup': rawV1Backup, 'foxVocab.v2': rawV2 });
const firstBackup = P.commitPrecloudBackup(leftoverDisk);
assert.strictEqual(firstBackup.ok, true);
const originalBackup = leftoverDisk.getItem(P.BACKUP_KEY);
assert.ok(originalBackup);
leftoverDisk.setItem('foxVocab.v2', JSON.stringify({ v: 2, changed: true, lastCheck: 1764288000000 }));
const retryCommit = P.commitPrecloudBackup(leftoverDisk);
assert.strictEqual(retryCommit.ok, false);
assert.strictEqual(retryCommit.reason, 'backup-exists');
assert.strictEqual(retryCommit.wrote, false);
assert.strictEqual(leftoverDisk.getItem(P.BACKUP_KEY), originalBackup, 'enable/commit must not overwrite the first precloud snapshot');
assert.strictEqual(JSON.parse(originalBackup).sources['foxVocab.v2'], rawV2);
assert.strictEqual(P.precloudBackupWriteFailed(retryCommit), false, 'a leftover valid backup must not hard-stop enableNew');
assert.strictEqual(P.precloudBackupWriteFailed(firstBackup), false);
assert.strictEqual(P.precloudBackupWriteFailed({ ok: false, reason: 'write-failed' }), true);
assert.strictEqual(P.precloudBackupWriteFailed({ ok: false, reason: 'read-failed' }), true);
assert.strictEqual(P.precloudBackupWriteFailed({ ok: false, reason: 'readback-mismatch' }), true);
assert.strictEqual(P.precloudBackupWriteFailed({ ok: false, reason: 'rollback-failed' }), true);
const syncApp = fs.readFileSync(path.join(__dirname, '..', 'sync-app.js'), 'utf8');
assert.ok(syncApp.includes('precloudBackupWriteFailed(backup)'));
assert.ok(!/if \(!backup\.ok\) \{ errorText = '备份没有写成/.test(syncApp));
assert.ok(!/if \(!backup\.ok && !backup\.noop\)/.test(syncApp));

const throwing = P.memoryStorage({ 'foxVocab.v2': rawV2, 'foxVocab.v1': rawV1, 'foxVocab.v1.backup': rawV1Backup });
throwing.setItem = function (k) { if (k === P.BACKUP_KEY) throw new Error('full'); };
const failed = P.commitPrecloudBackup(throwing);
assert.strictEqual(failed.aborted, true);
assert.strictEqual(failed.reason, 'write-failed');
assert.strictEqual(throwing.getItem('foxVocab.v2'), rawV2);
assert.strictEqual(throwing.getItem('foxVocab.v1'), rawV1);
assert.strictEqual(throwing.getItem(P.BACKUP_KEY), null);

const corrupt = P.memoryStorage({ 'foxVocab.v2': rawV2, 'foxVocab.v1': rawV1, 'foxVocab.v1.backup': rawV1Backup });
const realSet = corrupt.setItem;
corrupt.setItem = function (k, v) { realSet.call(corrupt, k, k === P.BACKUP_KEY ? 'CORRUPT' : v); };
const mismatch = P.commitPrecloudBackup(corrupt);
assert.strictEqual(mismatch.aborted, true);
assert.strictEqual(mismatch.reason, 'readback-mismatch');
assert.strictEqual(mismatch.sourcesIntact, true);
assert.strictEqual(corrupt.getItem(P.BACKUP_KEY), null);
assert.strictEqual(corrupt.getItem('foxVocab.v2'), rawV2);
assert.strictEqual(corrupt.getItem('foxVocab.v1.backup'), rawV1Backup);

disk.removeItem('foxVocab.v2');
const restored = P.restorePrecloudBackup(disk);
assert.strictEqual(restored.ok, true);
assert.ok(restored.restored.indexOf('foxVocab.v2') >= 0);
assert.strictEqual(disk.getItem('foxVocab.v2'), rawV2);
assert.strictEqual(disk.getItem('foxVocab.v1'), rawV1);
disk.setItem('foxVocab.v2', '{"v":2,"live":true}');
const refused = P.restorePrecloudBackup(disk);
assert.strictEqual(refused.reason, 'would-overwrite');
assert.strictEqual(disk.getItem('foxVocab.v2'), '{"v":2,"live":true}');
assert.strictEqual(disk.getItem('foxVocab.v1'), rawV1);

const root = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.ok(!appJs.includes('foxVocab.precloud'));
assert.ok(appJs.includes("localStorage.setItem(KEY, JSON.stringify(S))"));
assert.ok(sw.includes("const CACHE = 'dog-verb-shell-v39'"));
assert.ok(html.includes('app.js?v=36') && html.includes('sw.js?v=39') && html.includes('sync-app.js?v=38'));
assert.ok(html.includes('data/etymology.js?v=31') && html.includes('data/senses.js?v=32') && html.includes('data/t2s.js?v=22'));
assert.ok(html.includes('style.css?v=32') && html.includes('core.js?v=32'));
assert.ok(sw.includes('sync-app.js?v=38') && sw.includes('client-adapter.js?v=36') && sw.includes('./app.js?v=36'));
assert.ok(sw.includes("etymology.js?v=31") && sw.includes("senses.js?v=32"));

console.log('sync-prep tests ok');
