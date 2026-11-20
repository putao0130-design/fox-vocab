// Vendor-independent sync preparation. The learning app does not call this file.
// Legacy snapshots have no event ids. Overlapping legacy counters use a per-day max.
// They are never summed, and this module does not invent review events for them.
// Keyed events are a separate stream. Replaying the same migration id or event id
// inside one account is a no-op. Another account is a separate ledger.
(function (root) {
  const C = (root && root.VocabCore) || (typeof require === 'function' ? require('./core.js') : null);
  if (!C) throw new Error('VocabCore required');

  const SOURCE_KEYS = ['foxVocab.v2', 'foxVocab.v1', 'foxVocab.v1.backup'];
  const BACKUP_KEY = 'foxVocab.precloud.backup';
  const ZONE_LEGACY = 'device-local';
  const ZONE_PRODUCT = 'Asia/Shanghai';
  const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const LEGACY_OVERLAP_LIMIT = 'Legacy snapshots have no event ids. Overlapping per-day counters and pet totals use the larger value, not the sum. Shared history is not counted twice. Separate study on the same local day can be under-counted. The export keeps every dropped card. Reps were not added.';
  const LATE_LEGACY_LIMIT = 'Keyed events already exist for this account. This later legacy snapshot did not change counters, pet totals, or settings. New cards and books were copied. A missing book is not a deletion.';

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(function (k) { return JSON.stringify(k) + ':' + canonical(value[k]); }).join(',') + '}';
    }
    return JSON.stringify(value);
  }
  function sha256(text) {
    return require('crypto').createHash('sha256').update(String(text)).digest('hex');
  }
  function num(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.floor(n);
  }
  function shanghaiDayKey(utcMs) {
    const d = new Date(Number(utcMs) + SHANGHAI_OFFSET_MS);
    if (Number.isNaN(d.getTime())) return null;
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function bucketKey(zone, day) { return zone + '|' + day; }
  function freshAccount() {
    return {
      migrations: {}, events: {}, seq: 0,
      settings: null, settingsRev: 0, settingsConflicts: [],
      fox: null, legacyDays: {}, eventDays: {}, studyMarks: {},
      books: {}, customBooks: {}, tombstones: {}, cardLineage: {},
      limitations: [], exports: []
    };
  }
  function createStore() { return { accounts: {} }; }
  function ensure(store, accountId) {
    if (!store.accounts[accountId]) store.accounts[accountId] = freshAccount();
    return store.accounts[accountId];
  }
  function normalizeSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') throw new Error('bad-snapshot');
    let s = snapshot;
    if (s.v === 1) s = C.migrate(s);
    if (!s || s.v !== 2 || !s.books || typeof s.books !== 'object') throw new Error('bad-snapshot');
    return clone(s);
  }
  function migrationIdFor(snapshot) {
    return 'legacy:' + sha256(canonical(normalizeSnapshot(snapshot)));
  }
  function isEmptySnapshot(snapshot) {
    let s;
    try { s = normalizeSnapshot(snapshot); } catch (e) { return false; }
    const books = s.books || {};
    for (const id in books) {
      const b = books[id] || {};
      if (b.cards && Object.keys(b.cards).length) return false;
      if (b.sentences && Object.keys(b.sentences).length) return false;
      if (Array.isArray(b.extra) && b.extra.length) return false;
      if (Array.isArray(b.today) && b.today.length) return false;
    }
    if (Array.isArray(s.customBooks) && s.customBooks.some(function (b) { return b && Array.isArray(b.words) && b.words.length; })) return false;
    if (Array.isArray(s.studyDays) && s.studyDays.length) return false;
    const days = s.days || {};
    for (const k in days) {
      const d = days[k] || {};
      if (num(d.new) || num(d.review) || num(d.correct) || num(d.wrong)) return false;
    }
    const fox = s.fox || {};
    if (num(fox.food) || num(fox.xp) || num(fox.fed)) return false;
    if (fox.name && fox.name !== '小狗' && fox.name !== '小狐') return false;
    const settings = s.settings || {};
    if (settings.dailyNew != null && Number(settings.dailyNew) !== 20) return false;
    if (settings.autoPlay != null && settings.autoPlay !== true) return false;
    return true;
  }
  function rowOf(raw) {
    return { new: num(raw && raw.new), review: num(raw && raw.review), correct: num(raw && raw.correct), wrong: num(raw && raw.wrong) };
  }
  function rowPositive(a) { return a.new > 0 || a.review > 0 || a.correct > 0 || a.wrong > 0; }
  function maxRow(a, b) {
    return {
      new: Math.max(a.new, b.new), review: Math.max(a.review, b.review),
      correct: Math.max(a.correct, b.correct), wrong: Math.max(a.wrong, b.wrong)
    };
  }
  function chooseCard(current, incoming) {
    const ar = Number(current && current.last_review) || 0;
    const br = Number(incoming && incoming.last_review) || 0;
    if (ar !== br) {
      const laterIncoming = br > ar;
      return { card: clone(laterIncoming ? incoming : current), dropped: clone(laterIncoming ? current : incoming), reason: 'later-last-review' };
    }
    const areps = num(current && current.reps), breps = num(incoming && incoming.reps);
    if (areps !== breps) {
      const incomingWins = breps > areps;
      return { card: clone(incomingWins ? incoming : current), dropped: clone(incomingWins ? current : incoming), reason: 'tie-higher-reps' };
    }
    const al = num(current && current.lapses), bl = num(incoming && incoming.lapses);
    if (al !== bl) {
      const incomingWins = bl > al;
      return { card: clone(incomingWins ? incoming : current), dropped: clone(incomingWins ? current : incoming), reason: 'tie-higher-lapses' };
    }
    const as = canonical(current), bs = canonical(incoming);
    if (as === bs) return { card: clone(current), dropped: null, reason: 'identical' };
    const incomingWins = bs > as;
    return { card: clone(incomingWins ? incoming : current), dropped: clone(incomingWins ? current : incoming), reason: 'tie-canonical' };
  }
  function ensureBook(acc, id) {
    if (!acc.books[id]) acc.books[id] = { cards: {}, sentences: {}, extra: {}, today: {} };
    return acc.books[id];
  }
  function lineageKey(bookId, word) { return bookId + '\n' + word; }
  function rememberLimit(acc, text) {
    if (text && acc.limitations.indexOf(text) < 0) acc.limitations.push(text);
  }
  function mergeLegacy(acc, snap, report, sealed) {
    const settings = {
      dailyNew: snap.settings && snap.settings.dailyNew != null ? snap.settings.dailyNew : 20,
      autoPlay: !(snap.settings && snap.settings.autoPlay === false),
      bookId: snap.bookId || ''
    };
    if (!sealed) {
      if (!acc.settings) {
        acc.settings = settings;
        acc.settingsRev = 0;
      } else if (canonical(acc.settings) !== canonical(settings)) {
        const conflict = { kept: clone(acc.settings), other: settings, rev: acc.settingsRev, reason: 'server-rev-not-client-clock' };
        acc.settingsConflicts.push(conflict);
        report.settingsConflict = conflict;
      }
      const fox = snap.fox || {};
      const incomingFox = { food: num(fox.food), xp: num(fox.xp), fed: num(fox.fed), name: fox.name || '小狗' };
      if (!acc.fox) acc.fox = incomingFox;
      else {
        const next = {
          food: Math.max(acc.fox.food, incomingFox.food),
          xp: Math.max(acc.fox.xp, incomingFox.xp),
          fed: Math.max(acc.fox.fed, incomingFox.fed),
          name: acc.fox.name
        };
        if ((acc.fox.food > 0 && incomingFox.food > 0) || (acc.fox.xp > 0 && incomingFox.xp > 0) || (acc.fox.fed > 0 && incomingFox.fed > 0)) {
          report.sawOverlap = true;
          report.foxNote = { kept: next, left: clone(acc.fox), right: incomingFox, policy: 'max-not-sum' };
        }
        if (incomingFox.name && incomingFox.name !== acc.fox.name) {
          report.nameConflict = { kept: acc.fox.name, other: incomingFox.name };
        }
        acc.fox = next;
      }
      const days = snap.days || {};
      for (const day in days) {
        if (!DAY_RE.test(day)) continue;
        const key = bucketKey(ZONE_LEGACY, day);
        const right = rowOf(days[day]);
        const prev = acc.legacyDays[key] ? rowOf(acc.legacyDays[key]) : null;
        const merged = prev ? maxRow(prev, right) : right;
        if (prev) {
          report.sawOverlap = true;
          report.counterDays.push({ key: key, zone: ZONE_LEGACY, day: day, left: prev, right: right, merged: merged, policy: 'max-not-sum' });
        }
        acc.legacyDays[key] = { new: merged.new, review: merged.review, correct: merged.correct, wrong: merged.wrong, zone: ZONE_LEGACY, day: day, origin: 'legacy' };
        if (rowPositive(merged)) acc.studyMarks[key] = { day: day, zone: ZONE_LEGACY, source: 'legacy' };
      }
    } else {
      report.countersIgnored = true;
      report.ignoredDays = clone(snap.days || {});
      report.ignoredFox = clone(snap.fox || null);
      report.ignoredSettings = settings;
    }
    const marks = Array.isArray(snap.studyDays) ? snap.studyDays : [];
    for (let i = 0; i < marks.length; i++) {
      const day = marks[i];
      if (!DAY_RE.test(day)) continue;
      const key = bucketKey(ZONE_LEGACY, day);
      if (!acc.studyMarks[key]) acc.studyMarks[key] = { day: day, zone: ZONE_LEGACY, source: 'legacy' };
    }
    const custom = Array.isArray(snap.customBooks) ? snap.customBooks : [];
    for (let i = 0; i < custom.length; i++) {
      const raw = custom[i];
      if (!raw || typeof raw.id !== 'string' || !raw.id) continue;
      if (acc.tombstones[raw.id]) { report.blockedBooks.push(raw.id); continue; }
      if (!acc.customBooks[raw.id]) acc.customBooks[raw.id] = { id: raw.id, name: String(raw.name || '我的词书'), words: {} };
      else if (raw.name && raw.name !== acc.customBooks[raw.id].name) {
        report.bookNameConflicts = report.bookNameConflicts || [];
        report.bookNameConflicts.push({ id: raw.id, kept: acc.customBooks[raw.id].name, other: raw.name });
      }
      const dest = acc.customBooks[raw.id].words;
      const words = Array.isArray(raw.words) ? raw.words : [];
      for (let w = 0; w < words.length; w++) {
        const entry = words[w];
        if (!entry || !entry.word) continue;
        if (!dest[entry.word]) dest[entry.word] = clone(entry);
        else if (canonical(dest[entry.word]) !== canonical(entry)) {
          report.wordConflicts = report.wordConflicts || [];
          report.wordConflicts.push({ bookId: raw.id, word: entry.word, kept: clone(dest[entry.word]), other: clone(entry) });
        }
      }
    }
    const books = snap.books || {};
    for (const bookId in books) {
      if (acc.tombstones[bookId]) { report.blockedBooks.push(bookId); continue; }
      const src = books[bookId] || {};
      const book = ensureBook(acc, bookId);
      const cards = src.cards || {};
      for (const word in cards) {
        const incoming = clone(cards[word]);
        const key = lineageKey(bookId, word);
        const current = book.cards[word];
        if (!current) {
          book.cards[word] = incoming;
          if (!acc.cardLineage[key]) acc.cardLineage[key] = 'legacy';
          continue;
        }
        if (sealed || acc.cardLineage[key] === 'event') {
          report.keptEventCards.push({ bookId: bookId, word: word, dropped: incoming });
          continue;
        }
        const choice = chooseCard(current, incoming);
        book.cards[word] = choice.card;
        if (choice.reason !== 'identical') {
          report.droppedCards.push({
            bookId: bookId, word: word, reason: choice.reason, kept: choice.card, dropped: choice.dropped,
            clockNote: 'last_review is the device clock inside the legacy snapshot. Skew can keep the wrong one. Reps were not added.'
          });
        }
      }
      const sentences = src.sentences || {};
      for (const word in sentences) {
        const list = Array.isArray(sentences[word]) ? sentences[word] : [];
        for (let i = 0; i < list.length; i++) {
          const item = list[i];
          if (!item || !item.text) continue;
          const date = DAY_RE.test(item.date) ? item.date : '';
          const skey = word + '\n' + item.text + '\n' + date + '\n' + ZONE_LEGACY;
          if (!book.sentences[skey]) book.sentences[skey] = { word: word, text: item.text, date: date, zone: ZONE_LEGACY };
        }
      }
      const extra = Array.isArray(src.extra) ? src.extra : [];
      for (let i = 0; i < extra.length; i++) {
        const entry = extra[i];
        if (!entry || !entry.word || book.extra[entry.word]) continue;
        book.extra[entry.word] = clone(entry);
      }
      const today = Array.isArray(src.today) ? src.today : [];
      for (let i = 0; i < today.length; i++) {
        const word = String(today[i] || '');
        if (word) book.today[word] = true;
      }
    }
  }
  function importLegacy(store, accountId, snapshot, opts) {
    if (!accountId || typeof accountId !== 'string') return { ok: false, applied: false, reason: 'account-required' };
    let normalized;
    try { normalized = normalizeSnapshot(snapshot); }
    catch (e) { return { ok: false, applied: false, reason: 'bad-snapshot' }; }
    if (isEmptySnapshot(normalized)) return { ok: false, applied: false, reason: 'empty-snapshot' };
    let id;
    try { id = migrationIdFor(normalized); }
    catch (e) { return { ok: false, applied: false, reason: 'bad-snapshot' }; }
    if (opts && opts.migrationId && opts.migrationId !== id) return { ok: false, applied: false, reason: 'migration-id-mismatch' };
    const acc = ensure(store, accountId);
    if (acc.migrations[id]) return { ok: true, applied: false, noop: true, migrationId: id };
    const sealed = Object.keys(acc.events).length > 0;
    const report = {
      migrationId: id, sealed: sealed, limitation: null, droppedCards: [], keptEventCards: [],
      blockedBooks: [], counterDays: [], settingsConflict: null, foxNote: null, sawOverlap: false,
      inputs: [canonical(normalized)]
    };
    mergeLegacy(acc, normalized, report, sealed);
    if (report.sawOverlap) {
      report.limitation = LEGACY_OVERLAP_LIMIT;
      rememberLimit(acc, LEGACY_OVERLAP_LIMIT);
    }
    if (sealed) {
      report.limitation = LATE_LEGACY_LIMIT;
      rememberLimit(acc, LATE_LEGACY_LIMIT);
    }
    acc.migrations[id] = { id: id };
    acc.exports.push(report);
    return { ok: true, applied: true, noop: false, migrationId: id, export: report };
  }
  function ratingOf(value) {
    if (typeof value === 'boolean') return value ? C.Rating.Good : C.Rating.Again;
    const n = Number(value);
    if (n === 1 || n === 2 || n === 3 || n === 4) return n;
    return null;
  }
  function productDay(ev) {
    if (!ev || ev.dayZone !== ZONE_PRODUCT || !DAY_RE.test(ev.productDay || '')) return null;
    return ev.productDay;
  }
  function bumpEvent(acc, ev, field) {
    const day = productDay(ev);
    if (!day) return { ok: false, reason: 'product-day' };
    const key = bucketKey(ZONE_PRODUCT, day);
    if (!acc.eventDays[key]) acc.eventDays[key] = { new: 0, review: 0, correct: 0, wrong: 0, zone: ZONE_PRODUCT, day: day, origin: 'event' };
    if (field) acc.eventDays[key][field] += 1;
    acc.studyMarks[key] = { day: day, zone: ZONE_PRODUCT, source: 'event' };
    return { ok: true, key: key };
  }
  function applyOne(acc, ev, appliedAt) {
    if (ev.type === 'learn') {
      const rating = ratingOf(ev.rating == null ? C.Rating.Good : ev.rating);
      if (!ev.bookId || !ev.word || !rating || !productDay(ev)) return { consume: false, reason: 'bad-learn' };
      if (acc.tombstones[ev.bookId]) return { consume: true, rejected: 'tombstone' };
      const book = ensureBook(acc, ev.bookId);
      if (book.cards[ev.word]) return { consume: true, duplicateCompletion: true };
      book.cards[ev.word] = C.learnCard(rating, appliedAt);
      acc.cardLineage[lineageKey(ev.bookId, ev.word)] = 'event';
      const bumped = bumpEvent(acc, ev, 'new');
      if (!bumped.ok) {
        delete book.cards[ev.word];
        delete acc.cardLineage[lineageKey(ev.bookId, ev.word)];
        return { consume: false, reason: bumped.reason };
      }
      return { duplicateCompletion: false, clientNowIgnored: true };
    }
    if (ev.type === 'grade') {
      const rating = ratingOf(ev.rating);
      if (!ev.bookId || !ev.word || !rating || !productDay(ev)) return { consume: false, reason: 'bad-grade' };
      if (acc.tombstones[ev.bookId]) return { consume: true, rejected: 'tombstone' };
      const book = ensureBook(acc, ev.bookId);
      if (!book.cards[ev.word]) return { consume: false, reason: 'no-card' };
      const before = book.cards[ev.word].last_review;
      const graded = C.grade(book.cards[ev.word], rating, appliedAt, true);
      book.cards[ev.word] = graded.card;
      acc.cardLineage[lineageKey(ev.bookId, ev.word)] = 'event';
      const bumped = bumpEvent(acc, ev, 'review');
      if (!bumped.ok) return { consume: false, reason: bumped.reason };
      acc.eventDays[bumped.key][rating > 1 ? 'correct' : 'wrong'] += 1;
      return {
        reviewEvent: graded.event,
        rebased: ev.baseLastReview != null && ev.baseLastReview !== before,
        clientNowIgnored: true,
        scheduledAt: appliedAt
      };
    }
    if (ev.type === 'settings') {
      if (!ev.patch || typeof ev.patch !== 'object') return { consume: false, reason: 'bad-settings' };
      if (ev.baseRev !== acc.settingsRev) return { consume: false, reason: 'stale-rev', rev: acc.settingsRev };
      if (!acc.settings) acc.settings = { dailyNew: 20, autoPlay: true, bookId: '' };
      const patch = ev.patch;
      const next = clone(acc.settings);
      if (patch.dailyNew != null) {
        const n = Number(patch.dailyNew);
        if (!Number.isInteger(n) || n < 1 || n > 200) return { consume: false, reason: 'bad-settings' };
        next.dailyNew = n;
      }
      if (patch.autoPlay != null) {
        if (typeof patch.autoPlay !== 'boolean') return { consume: false, reason: 'bad-settings' };
        next.autoPlay = patch.autoPlay;
      }
      if (patch.bookId != null) {
        if (typeof patch.bookId !== 'string') return { consume: false, reason: 'bad-settings' };
        next.bookId = patch.bookId;
      }
      acc.settings = next;
      acc.settingsRev += 1;
      return { rev: acc.settingsRev, clientNowIgnored: true };
    }
    if (ev.type === 'tombstone') {
      if (ev.entity !== 'customBook' || typeof ev.bookId !== 'string' || ev.bookId.indexOf('custom-') !== 0) return { consume: false, reason: 'bad-tombstone' };
      acc.tombstones[ev.bookId] = { eventId: ev.id };
      delete acc.customBooks[ev.bookId];
      delete acc.books[ev.bookId];
      const prefix = ev.bookId + '\n';
      Object.keys(acc.cardLineage).forEach(function (key) { if (key.indexOf(prefix) === 0) delete acc.cardLineage[key]; });
      return { tombstone: ev.bookId };
    }
    if (ev.type === 'feed') {
      if (!acc.fox) acc.fox = { food: 0, xp: 0, fed: 0, name: '小狗' };
      const fed = C.feed(acc.fox);
      if (!fed.ok) return { consume: false, reason: 'no-food' };
      acc.fox = { food: num(fed.fox.food), xp: num(fed.fox.xp), fed: num(fed.fox.fed), name: acc.fox.name };
      return { fed: true };
    }
    return { consume: false, reason: 'unknown-type' };
  }
  function acceptEvents(store, accountId, events, opts) {
    if (!accountId || typeof accountId !== 'string') return { ok: false, reason: 'account-required' };
    const appliedAt = opts && opts.appliedAt;
    if (!Number.isFinite(appliedAt)) return { ok: false, reason: 'applied-at-required' };
    const acc = ensure(store, accountId);
    const list = Array.isArray(events) ? events.slice() : [];
    const learns = [], rest = [], results = [];
    for (let i = 0; i < list.length; i++) {
      const ev = list[i];
      if (!ev || typeof ev.id !== 'string' || !ev.id) { results.push({ reason: 'bad-id', consumed: false }); continue; }
      if (ev.type === 'learn') learns.push(ev); else rest.push(ev);
    }
    const ordered = learns.concat(rest);
    for (let i = 0; i < ordered.length; i++) {
      const ev = ordered[i];
      if (acc.events[ev.id]) { results.push({ id: ev.id, consumed: false, noop: true, reason: 'duplicate' }); continue; }
      const out = applyOne(acc, ev, appliedAt);
      if (!out.consume && out.consume !== undefined && out.consume === false) {
        results.push({ id: ev.id, consumed: false, reason: out.reason, rev: out.rev });
        continue;
      }
      if (out.consume === false) {
        results.push({ id: ev.id, consumed: false, reason: out.reason });
        continue;
      }
      acc.seq += 1;
      acc.events[ev.id] = { id: ev.id, type: ev.type, seq: acc.seq, accountId: accountId };
      results.push({
        id: ev.id, consumed: true, seq: acc.seq, type: ev.type,
        duplicateCompletion: !!out.duplicateCompletion, rebased: !!out.rebased,
        rejected: out.rejected || null, scheduledAt: out.scheduledAt || null, rev: out.rev || null
      });
    }
    return { ok: true, accountId: accountId, appliedAt: appliedAt, order: 'learns-then-arrival', results: results };
  }
  function materialize(store, accountId) {
    const acc = store && store.accounts && store.accounts[accountId];
    if (!acc) return null;
    const days = {};
    Object.keys(acc.legacyDays).sort().forEach(function (key) { days[key] = clone(acc.legacyDays[key]); });
    Object.keys(acc.eventDays).sort().forEach(function (key) { days[key] = clone(acc.eventDays[key]); });
    const books = {};
    Object.keys(acc.books).sort().forEach(function (id) {
      if (acc.tombstones[id]) return;
      const b = acc.books[id];
      books[id] = {
        cards: clone(b.cards),
        sentences: Object.keys(b.sentences).sort().map(function (key) { return clone(b.sentences[key]); }),
        extra: Object.keys(b.extra).sort().map(function (key) { return clone(b.extra[key]); }),
        today: Object.keys(b.today).filter(function (word) { return !b.cards[word]; }).sort()
      };
    });
    return {
      accountId: accountId, v: 2,
      settings: clone(acc.settings), settingsRev: acc.settingsRev, settingsConflicts: clone(acc.settingsConflicts),
      fox: clone(acc.fox),
      days: days,
      studyDays: Object.keys(acc.studyMarks).sort().map(function (key) { return clone(acc.studyMarks[key]); }),
      books: books,
      customBooks: Object.keys(acc.customBooks).sort().filter(function (id) { return !acc.tombstones[id]; }).map(function (id) {
        const c = acc.customBooks[id];
        return { id: c.id, name: c.name, words: Object.keys(c.words).sort().map(function (word) { return clone(c.words[word]); }) };
      }),
      tombstones: Object.keys(acc.tombstones).sort(),
      migrations: Object.keys(acc.migrations).sort(),
      eventIds: Object.keys(acc.events).sort(),
      limitations: acc.limitations.slice()
    };
  }
  function memoryStorage(init) {
    const data = Object.assign({}, init || {});
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[k] = String(v); },
      removeItem: function (k) { delete data[k]; }
    };
  }
  function readSources(storage) {
    const sources = {};
    for (let i = 0; i < SOURCE_KEYS.length; i++) sources[SOURCE_KEYS[i]] = storage.getItem(SOURCE_KEYS[i]);
    return sources;
  }
  function sameSources(a, b) {
    for (let i = 0; i < SOURCE_KEYS.length; i++) if (a[SOURCE_KEYS[i]] !== b[SOURCE_KEYS[i]]) return false;
    return true;
  }
  function payloadFor(sources) {
    return JSON.stringify({ kind: 'dog-verb-precloud-backup', v: 1, sources: sources });
  }
  function commitPrecloudBackup(storage) {
    let before;
    try { before = readSources(storage); }
    catch (e) { return { ok: false, aborted: true, wrote: false, reason: 'read-failed' }; }
    const payload = payloadFor(before);
    let existing;
    try { existing = storage.getItem(BACKUP_KEY); }
    catch (e) { return { ok: false, aborted: true, wrote: false, reason: 'read-failed' }; }
    if (existing != null && existing !== payload) return { ok: false, aborted: true, wrote: false, reason: 'backup-exists' };
    if (existing === payload) {
      const after = readSources(storage);
      if (!sameSources(before, after)) return { ok: false, aborted: true, wrote: false, reason: 'sources-moved' };
      return { ok: true, noop: true, wrote: false, key: BACKUP_KEY };
    }
    try { storage.setItem(BACKUP_KEY, payload); }
    catch (e) { return { ok: false, aborted: true, wrote: false, reason: 'write-failed' }; }
    let readback = null;
    try { readback = storage.getItem(BACKUP_KEY); } catch (e) { readback = null; }
    if (readback !== payload) {
      let rollbackFailed = false;
      try { storage.removeItem(BACKUP_KEY); }
      catch (e) { rollbackFailed = true; }
      let left = null;
      try { left = storage.getItem(BACKUP_KEY); } catch (e) { rollbackFailed = true; left = 'unreadable'; }
      if (left != null) rollbackFailed = true;
      return {
        ok: false, aborted: true, wrote: false,
        reason: rollbackFailed ? 'rollback-failed' : 'readback-mismatch',
        sourcesIntact: sameSources(before, readSources(storage))
      };
    }
    const after = readSources(storage);
    if (!sameSources(before, after)) return { ok: false, aborted: true, wrote: true, reason: 'sources-moved', sourcesIntact: false };
    return { ok: true, noop: false, wrote: true, key: BACKUP_KEY, sourcesIntact: true };
  }
  function restorePrecloudBackup(storage) {
    let raw;
    try { raw = storage.getItem(BACKUP_KEY); }
    catch (e) { return { ok: false, aborted: true, wrote: false, reason: 'read-failed' }; }
    if (raw == null) return { ok: false, aborted: true, wrote: false, reason: 'no-backup' };
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { return { ok: false, aborted: true, wrote: false, reason: 'bad-backup' }; }
    if (!parsed || parsed.kind !== 'dog-verb-precloud-backup' || !parsed.sources) return { ok: false, aborted: true, wrote: false, reason: 'bad-backup' };
    const plan = [];
    for (let i = 0; i < SOURCE_KEYS.length; i++) {
      const key = SOURCE_KEYS[i];
      const saved = parsed.sources[key] == null ? null : String(parsed.sources[key]);
      let live;
      try { live = storage.getItem(key); }
      catch (e) { return { ok: false, aborted: true, wrote: false, reason: 'read-failed' }; }
      if (saved == null) continue;
      if (live == null) plan.push({ key: key, value: saved });
      else if (live !== saved) return { ok: false, aborted: true, wrote: false, reason: 'would-overwrite', key: key };
    }
    const written = [];
    for (let i = 0; i < plan.length; i++) {
      try { storage.setItem(plan[i].key, plan[i].value); }
      catch (e) {
        rollbackRestore(storage, written);
        return { ok: false, aborted: true, wrote: false, reason: 'write-failed' };
      }
      if (storage.getItem(plan[i].key) !== plan[i].value) {
        written.push(plan[i]);
        rollbackRestore(storage, written);
        return { ok: false, aborted: true, wrote: false, reason: 'readback-mismatch' };
      }
      written.push(plan[i]);
    }
    return { ok: true, restored: plan.map(function (step) { return step.key; }) };
  }
  function rollbackRestore(storage, written) {
    for (let i = written.length - 1; i >= 0; i--) {
      try { storage.removeItem(written[i].key); } catch (e) { /* best-effort; the backup itself remains */ }
    }
  }

  const api = {
    SOURCE_KEYS: SOURCE_KEYS, BACKUP_KEY: BACKUP_KEY,
    ZONE_LEGACY: ZONE_LEGACY, ZONE_PRODUCT: ZONE_PRODUCT,
    LEGACY_OVERLAP_LIMIT: LEGACY_OVERLAP_LIMIT, LATE_LEGACY_LIMIT: LATE_LEGACY_LIMIT,
    shanghaiDayKey: shanghaiDayKey, canonical: canonical, migrationIdFor: migrationIdFor,
    normalizeSnapshot: normalizeSnapshot, isEmptySnapshot: isEmptySnapshot,
    createStore: createStore, importLegacy: importLegacy, acceptEvents: acceptEvents, materialize: materialize,
    memoryStorage: memoryStorage, commitPrecloudBackup: commitPrecloudBackup, restorePrecloudBackup: restorePrecloudBackup
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VocabSyncPrep = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
