// App bridge for Supabase pairing-code sync. Idle until the learner confirms
// the backup preview. No access tokens are written to localStorage. The device
// private key stays in IndexedDB (non-extractable). Manual export is still
// available but is not a substitute for auto-sync.
(function (root) {
  const sync = root.DogverbSync;
  const prep = root.VocabSyncPrep;
  const ON = 'foxVocab.syncOn';
  const BASE = 'foxVocab.syncBase';
  const SEQ = 'foxVocab.syncSeq';
  const OUT = 'foxVocab.syncOutbox';
  const REV = 'foxVocab.syncSettingsRev';
  const DEAD = 'foxVocab.syncDead';
  const PAIR_TTL_MS = 5 * 60 * 1000;
  const ARM_FAST_MS = 5000;
  const ARM_SLOW_MS = 30000;
  const NULL_STATUS = '已连接，但云端数据没读出来，本次没有合并';
  let session = null;
  let joining = null;
  let waitingPair = 0;
  let timer = 0;
  let intervalMs = ARM_FAST_MS;
  let failStreak = 0;
  let visBound = 0;
  let statusText = '';
  let errorText = '';
  let recoveryOnce = '';
  let pendingRemote = null;
  let pendingBound = 0;
  const projectDiag = {
    remoteCards: 0, remoteDaysRows: 0, remoteStudyDays: 0,
    daysSkippedByZone: 0, studyDaysSkippedByZone: 0,
    localEmpty: false, remoteEmpty: false, result: ''
  };
  const syncDiag = {
    project: projectDiag,
    pullBlockedByOutbox: 0,
    lastPullBlockCount: 0,
    deadCount: 0,
    failStreak: 0,
    intervalMs: ARM_FAST_MS
  };

  function cfg() {
    const c = root.DOGVERB_SYNC_CONFIG;
    if (!c || !root.DogverbSupabase) return null;
    if (root.DogverbSupabase.disabled(c)) return null;
    return c;
  }
  function backend() {
    const c = cfg();
    if (!c) { const err = new Error('sync-disabled'); err.data = { error: 'sync-disabled' }; throw err; }
    return root.DogverbSupabase.bind(c);
  }
  function opted() { return !!(cfg() && localStorage.getItem(ON) === '1'); }
  function readAllBox() { try { return JSON.parse(localStorage.getItem(OUT) || '[]'); } catch (e) { return []; } }
  function isDead(item) { return !!(item && item.dead); }
  function readBox() { return readAllBox().filter(function (item) { return item && !isDead(item); }); }
  function readDead() {
    let stored = [];
    try { stored = JSON.parse(localStorage.getItem(DEAD) || '[]'); } catch (e) { stored = []; }
    if (!Array.isArray(stored)) stored = [];
    const leftover = readAllBox().filter(isDead);
    const seen = {};
    const out = [];
    stored.concat(leftover).forEach(function (item) {
      if (!item || !item.id || seen[item.id]) return;
      seen[item.id] = 1;
      out.push(item);
    });
    return out;
  }
  function writeBox(items) { localStorage.setItem(OUT, JSON.stringify(items || [])); }
  function writeDead(items) {
    const list = items || [];
    localStorage.setItem(DEAD, JSON.stringify(list));
    syncDiag.deadCount = list.length;
  }
  function deadMessage() {
    const n = readDead().length;
    return n ? ('有 ' + n + ' 条没传上去（点此重试）') : '';
  }
  function recordDiag() {
    syncDiag.project = projectDiag;
    syncDiag.failStreak = failStreak;
    syncDiag.intervalMs = intervalMs;
    syncDiag.deadCount = readDead().length;
    root.__dogverbSyncDiag = syncDiag;
    return syncDiag;
  }
  function noteSyncResult(ok) {
    if (ok) failStreak = 0;
    else failStreak += 1;
    const next = failStreak >= 5 ? ARM_SLOW_MS : ARM_FAST_MS;
    recordDiag();
    if (timer && next !== intervalMs) {
      clearInterval(timer);
      intervalMs = next;
      timer = setInterval(armTick, intervalMs);
    } else {
      intervalMs = next;
    }
    syncDiag.intervalMs = intervalMs;
  }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function num(v) { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : 0; }
  function sanitize(state) {
    const s = clone(state);
    if (s.fox) { delete s.fox.hunger; delete s.fox.lastCheck; }
    return s;
  }
  function learningEmpty(s) {
    const books = s.books || {};
    for (const id in books) {
      const b = books[id] || {};
      if (b.cards && Object.keys(b.cards).length) return false;
      if (b.sentences && Object.keys(b.sentences).length) return false;
      if (b.extra && b.extra.length) return false;
      if (b.today && b.today.length) return false;
    }
    if ((s.customBooks || []).some(function (b) { return b.words && b.words.length; })) return false;
    if ((s.studyDays || []).length) return false;
    const fox = s.fox || {};
    if (num(fox.food) || num(fox.xp) || num(fox.fed)) return false;
    if (fox.name && fox.name !== '小狗' && fox.name !== '小狐') return false;
    return true;
  }
  function diff(prev, next) {
    const ops = [];
    const p = prev || { books: {}, customBooks: [], days: {}, studyDays: [], settings: {}, fox: {}, bookId: '' };
    const ps = p.settings || {}; const ns = next.settings || {};
    if (num(ps.dailyNew) !== num(ns.dailyNew) || !!ps.autoPlay !== !!ns.autoPlay || (p.bookId || '') !== (next.bookId || '')) {
      ops.push({ kind: 'settings', baseRev: num(localStorage.getItem(REV)), patch: { dailyNew: ns.dailyNew, autoPlay: !!ns.autoPlay, bookId: next.bookId || '' } });
    }
    const days = {};
    Object.keys(p.days || {}).forEach(function (k) { days[k] = 1; });
    Object.keys(next.days || {}).forEach(function (k) { days[k] = 1; });
    Object.keys(days).forEach(function (day) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
      const a = (p.days || {})[day] || {}; const b = (next.days || {})[day] || {};
      const delta = { new: num(b.new) - num(a.new), review: num(b.review) - num(a.review), correct: num(b.correct) - num(a.correct), wrong: num(b.wrong) - num(a.wrong) };
      if (delta.new || delta.review || delta.correct || delta.wrong) ops.push({ kind: 'day', zone: 'device-local', day: day, delta: delta });
    });
    const seenDays = {};
    (p.studyDays || []).forEach(function (d) { seenDays[d] = 1; });
    (next.studyDays || []).forEach(function (d) { if (!seenDays[d]) ops.push({ kind: 'study', zone: 'device-local', day: d }); });
    const bookIds = {};
    Object.keys(p.books || {}).forEach(function (id) { bookIds[id] = 1; });
    Object.keys(next.books || {}).forEach(function (id) { bookIds[id] = 1; });
    Object.keys(bookIds).forEach(function (id) {
      const pb = (p.books || {})[id] || {}; const nb = (next.books || {})[id] || {};
      const words = {};
      Object.keys(pb.cards || {}).forEach(function (w) { words[w] = 1; });
      Object.keys(nb.cards || {}).forEach(function (w) { words[w] = 1; });
      Object.keys(words).forEach(function (w) {
        const a = (pb.cards || {})[w]; const b = (nb.cards || {})[w];
        if (b && JSON.stringify(a || null) !== JSON.stringify(b)) ops.push({ kind: 'card', bookId: id, word: w, card: b });
      });
      const had = {};
      (pb.extra || []).forEach(function (e) { if (e && e.word) had[e.word] = 1; });
      (nb.extra || []).forEach(function (e) { if (e && e.word && !had[e.word]) ops.push({ kind: 'extra', bookId: id, entry: e }); });
      const pins = {};
      (pb.today || []).forEach(function (w) { pins[w] = 1; });
      (nb.today || []).forEach(function (w) { if (!pins[w]) ops.push({ kind: 'pin', bookId: id, word: w }); });
      const sent = {};
      Object.keys(pb.sentences || {}).forEach(function (w) { (pb.sentences[w] || []).forEach(function (s) { sent[w + '\n' + s.text + '\n' + s.date] = 1; }); });
      Object.keys(nb.sentences || {}).forEach(function (w) {
        (nb.sentences[w] || []).forEach(function (s) {
          if (!sent[w + '\n' + s.text + '\n' + s.date]) ops.push({ kind: 'sentence', bookId: id, word: w, text: s.text, date: s.date, zone: 'device-local' });
        });
      });
    });
    const beforeBooks = {}; const afterBooks = {};
    (p.customBooks || []).forEach(function (b) { beforeBooks[b.id] = b; });
    (next.customBooks || []).forEach(function (b) { afterBooks[b.id] = b; });
    Object.keys(beforeBooks).forEach(function (id) { if (!afterBooks[id]) ops.push({ kind: 'tombstone', bookId: id }); });
    Object.keys(afterBooks).forEach(function (id) {
      if (!beforeBooks[id] || JSON.stringify(beforeBooks[id]) !== JSON.stringify(afterBooks[id])) ops.push({ kind: 'custom', book: afterBooks[id] });
    });
    const pf = p.fox || {}; const nf = next.fox || {};
    const food = num(nf.food) - num(pf.food); const xp = num(nf.xp) - num(pf.xp); const fed = num(nf.fed) - num(pf.fed);
    const name = (nf.name || '') !== (pf.name || '') ? nf.name : '';
    if (food || xp || fed || name) ops.push({ kind: 'fox', food: food, xp: xp, fed: fed, name: name || undefined });
    return ops;
  }
  function storageAdapter() {
    return { getItem: function (k) { return localStorage.getItem(k); }, setItem: function (k, v) { localStorage.setItem(k, v); }, removeItem: function (k) { localStorage.removeItem(k); } };
  }
  function refreshPreview(force) {
    const slot = document.getElementById('sync-preview');
    if (!slot || typeof root.__dogverbReadState !== 'function') return;
    if (!force && slot.textContent && slot.textContent.indexOf('将上传本机进度') === 0) return;
    const preview = previewOf(root.__dogverbReadState() || {});
    slot.textContent = '已学 ' + preview.cards + '，自建词书 ' + preview.custom + '，打卡 ' + preview.days;
  }
  function paint() {
    refreshPreview(false);
    const box = document.getElementById('syncstatus');
    if (!box) return;
    const deadMsg = deadMessage();
    const parts = [statusText, errorText];
    if (deadMsg && statusText !== deadMsg && errorText !== deadMsg) parts.push(deadMsg);
    box.textContent = parts.filter(Boolean).join(' ');
    if (deadMsg) {
      box.onclick = function () { retryDead(); };
      if (box.style) box.style.cursor = 'pointer';
    } else {
      box.onclick = null;
      if (box.style) box.style.cursor = '';
    }
  }
  function previewOf(state) {
    let cards = 0;
    Object.keys(state.books || {}).forEach(function (id) { cards += Object.keys((state.books[id] && state.books[id].cards) || {}).length; });
    return { cards: cards, custom: (state.customBooks || []).length, days: (state.studyDays || []).length };
  }
  async function ensureSession() {
    const store = sync.idbStorage();
    const api = backend();
    if (session && session.accessToken) {
      if (!api.accessExpired || !api.accessExpired(session)) return session;
      try {
        if (api.refreshSession) {
          session = await api.refreshSession(session);
          return session;
        }
      } catch (e) {
        session = null;
      }
    }
    session = await api.resume({ storage: store });
    return session;
  }
  function blurPairingFields() {
    ['sync-join', 'sync-recover', 'sync-code', 'sync-secret'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el && document.activeElement === el && typeof el.blur === 'function') el.blur();
    });
  }
  function retryPendingApply() {
    if (!pendingRemote) return;
    finishRemoteApply(pendingRemote.remote, pendingRemote.connectedText);
  }
  function listenForPendingApply() {
    if (pendingBound) return;
    pendingBound = 1;
    document.addEventListener('focusout', retryPendingApply);
    document.addEventListener('visibilitychange', retryPendingApply);
  }
  function blankState() {
    return { v: 2, bookId: '', settings: {}, books: {}, customBooks: [], days: {}, studyDays: [], fox: {} };
  }
  function enqueueCloudGap(remoteState, merged) {
    if (!opted() || !remoteState || !merged) return { ops: 0 };
    const saved = {
      remoteCards: projectDiag.remoteCards,
      remoteDaysRows: projectDiag.remoteDaysRows,
      remoteStudyDays: projectDiag.remoteStudyDays,
      daysSkippedByZone: projectDiag.daysSkippedByZone,
      studyDaysSkippedByZone: projectDiag.studyDaysSkippedByZone,
      localEmpty: projectDiag.localEmpty,
      remoteEmpty: projectDiag.remoteEmpty,
      result: projectDiag.result
    };
    const cloudAsLocal = project(remoteState, blankState(), { record: false });
    Object.assign(projectDiag, saved);
    recordDiag();
    if (!cloudAsLocal) return { ops: 0 };
    const ops = diff(sanitize(cloudAsLocal), sanitize(merged));
    if (!ops.length) return { ops: 0 };
    const seq = (Number(localStorage.getItem(SEQ)) || 0) + 1;
    const box = readBox();
    const id = 'commit-' + seq;
    box.push({ id: id, type: 'commit', ops: ops });
    writeBox(box);
    localStorage.setItem(SEQ, String(seq));
    return { ops: ops.length, id: id, items: ops };
  }
  function finishRemoteApply(remote, connectedText) {
    if (!remote || !remote.state) return { skipped: true };
    const next = project(remote.state, root.__dogverbReadState());
    if (!next) {
      pendingRemote = null;
      statusText = NULL_STATUS;
      errorText = 'project-null: cards=' + projectDiag.remoteCards + ' days=' + projectDiag.remoteDaysRows + ' studyDays=' + projectDiag.remoteStudyDays;
      paint();
      return { applied: false, skippedMerge: true, projectNull: true, result: projectDiag.result };
    }
    const applied = root.__dogverbApplyRemote(next);
    if (applied && applied.applied) {
      pendingRemote = null;
      localStorage.setItem(REV, String(remote.state.settingsRev || 0));
      localStorage.setItem(BASE, JSON.stringify(sanitize(root.__dogverbReadState())));
      statusText = connectedText || '已连接';
      errorText = '';
      refreshPreview(true);
      paint();
      noteSyncResult(true);
      const pushed = enqueueCloudGap(remote.state, root.__dogverbReadState());
      if (pushed && pushed.ops) flush({ keepStatusOnSuccess: true });
      return { applied: true, queued: pushed && pushed.ops ? pushed.ops : 0, queuedId: pushed && pushed.id };
    }
    pendingRemote = { remote: remote, connectedText: connectedText || '已连接' };
    listenForPendingApply();
    return applied || { deferred: true };
  }
  function bumpRetry(item) {
    const next = Object.assign({}, item, { retries: (Number(item && item.retries) || 0) + 1 });
    if (next.retries >= 3) {
      next.dead = true;
      return next;
    }
    return next;
  }
  async function retryDead() {
    const dead = readDead();
    if (!dead.length) return { empty: true };
    const box = readBox();
    dead.forEach(function (item) {
      const ev = Object.assign({}, item);
      delete ev.dead;
      ev.retries = 0;
      box.push(ev);
    });
    writeBox(box);
    writeDead([]);
    statusText = '正在重试上传';
    errorText = '';
    paint();
    const res = await flush();
    if (!readBox().length && opted()) await pull();
    return res;
  }
  function retainUnsent(sentBox, kept) {
    const sent = {};
    (sentBox || []).forEach(function (item) { if (item && item.id) sent[item.id] = 1; });
    const out = [];
    const seen = {};
    (kept || []).forEach(function (item) {
      if (!item || !item.id || seen[item.id]) return;
      seen[item.id] = 1;
      out.push(item);
    });
    readBox().forEach(function (item) {
      if (!item || !item.id || seen[item.id] || sent[item.id]) return;
      seen[item.id] = 1;
      out.push(item);
    });
    return out;
  }
  let flushTail = Promise.resolve();
  async function flush(opts) {
    if (!opted()) return { skipped: true };
    const prev = flushTail;
    let release;
    const slot = new Promise(function (resolve) { release = resolve; });
    flushTail = slot;
    try {
      await prev;
      if (!opted()) return { skipped: true };
      return await flushOnce(opts);
    } finally {
      release();
    }
  }
  async function flushOnce(opts) {
    const box = readBox();
    if (!box.length) return { empty: true };
    try {
      await ensureSession();
      if (!session) return { skipped: true };
      const res = await backend().pushEvents(session, box);
      if (res && res.offline) { statusText = '离线，本机进度已记下，联网后会继续传'; errorText = ''; paint(); noteSyncResult(false); return res; }
      const results = (res && res.results) || [];
      const byId = {};
      results.forEach(function (row) { if (row && row.id) byId[row.id] = row; });
      const failed = results.filter(function (row) { return row && row.reason && row.reason !== 'duplicate'; });
      const kept = [];
      const newlyDead = readDead();
      const deadIds = {};
      newlyDead.forEach(function (item) { if (item && item.id) deadIds[item.id] = 1; });
      box.forEach(function (item) {
        if (!item || !item.id) return;
        const row = byId[item.id];
        // Keep/retry only when this id was returned with a non-duplicate reason.
        // Missing ids, success rows, and duplicates are cleared.
        const failedRow = !!(row && row.reason && row.reason !== 'duplicate');
        if (!failedRow) return;
        const bumped = bumpRetry(item);
        if (bumped.dead) {
          if (!deadIds[bumped.id]) { newlyDead.push(bumped); deadIds[bumped.id] = 1; }
        } else kept.push(bumped);
      });
      writeBox(retainUnsent(box, kept));
      writeDead(newlyDead);
      if (failed.length) {
        statusText = '有 ' + failed.length + ' 条没写上：' + failed[0].reason;
        errorText = '';
        noteSyncResult(false);
      } else {
        if (!(opts && opts.keepStatusOnSuccess)) {
          statusText = '已同步';
          errorText = '';
        }
        noteSyncResult(true);
      }
      paint();
      return res;
    } catch (e) {
      errorText = '同步失败';
      statusText = '本机进度还在';
      paint();
      noteSyncResult(false);
      return { error: true };
    }
  }
  async function pull() {
    if (!opted()) return { skipped: true };
    try {
      const flushed = await flush();
      const box = readBox();
      if (box.length) {
        statusText = '本机有 ' + box.length + ' 条待上传，暂不拉取';
        syncDiag.pullBlockedByOutbox += 1;
        syncDiag.lastPullBlockCount = box.length;
        recordDiag();
        paint();
        return { blocked: true, outbox: box.length, flushed: flushed };
      }
      await ensureSession();
      if (!session) return { skipped: true };
      const remote = await backend().pull(session);
      return finishRemoteApply(remote, '已连接');
    } catch (e) {
      if (e && e.data && e.data.error === 'unauthorized') { errorText = '这台设备已退出同步'; statusText = ''; }
      else errorText = '暂时连不上同步';
      paint();
      noteSyncResult(false);
      return { error: true };
    }
  }
  function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function remoteShapeProblem(remote) {
    if (!isPlainObject(remote)) return true;
    if (remote.books != null && !isPlainObject(remote.books)) return true;
    if (remote.days != null && !isPlainObject(remote.days)) return true;
    if (remote.studyDays != null && !Array.isArray(remote.studyDays)) return true;
    if (remote.customBooks != null && !Array.isArray(remote.customBooks)) return true;
    if (remote.books) {
      const ids = Object.keys(remote.books);
      for (let i = 0; i < ids.length; i++) {
        const book = remote.books[ids[i]];
        if (!isPlainObject(book)) return true;
        if (book.cards != null && !isPlainObject(book.cards)) return true;
      }
    }
    return false;
  }
  function countRemoteCards(remote) {
    let n = 0;
    if (!isPlainObject(remote) || !isPlainObject(remote.books)) return 0;
    Object.keys(remote.books).forEach(function (id) {
      const book = remote.books[id];
      if (isPlainObject(book) && isPlainObject(book.cards)) n += Object.keys(book.cards).length;
    });
    return n;
  }
  function rememberProject(fields) {
    projectDiag.remoteCards = fields.remoteCards;
    projectDiag.remoteDaysRows = fields.remoteDaysRows;
    projectDiag.remoteStudyDays = fields.remoteStudyDays;
    projectDiag.daysSkippedByZone = fields.daysSkippedByZone || 0;
    projectDiag.studyDaysSkippedByZone = fields.studyDaysSkippedByZone || 0;
    projectDiag.localEmpty = fields.localEmpty;
    projectDiag.remoteEmpty = fields.remoteEmpty;
    projectDiag.result = fields.result;
    recordDiag();
  }
  function countZoneSkips(remote) {
    let daysSkippedByZone = 0;
    let studyDaysSkippedByZone = 0;
    if (isPlainObject(remote) && isPlainObject(remote.days)) {
      Object.keys(remote.days).forEach(function (key) {
        const row = remote.days[key];
        if (row && row.zone !== 'device-local') daysSkippedByZone += 1;
      });
    }
    if (remote && Array.isArray(remote.studyDays)) {
      remote.studyDays.forEach(function (d) {
        if (d && d.zone !== 'device-local') studyDaysSkippedByZone += 1;
      });
    }
    return { daysSkippedByZone: daysSkippedByZone, studyDaysSkippedByZone: studyDaysSkippedByZone };
  }
  function project(remote, local, opts) {
    const record = !(opts && opts.record === false);
    const localEmpty = learningEmpty(sanitize(local || {}));
    if (remoteShapeProblem(remote)) {
      const shapeSkips = countZoneSkips(remote);
      if (record) rememberProject({
        remoteCards: countRemoteCards(remote),
        remoteDaysRows: isPlainObject(remote) && isPlainObject(remote.days) ? Object.keys(remote.days).length : 0,
        remoteStudyDays: remote && Array.isArray(remote.studyDays) ? remote.studyDays.length : 0,
        daysSkippedByZone: shapeSkips.daysSkippedByZone,
        studyDaysSkippedByZone: shapeSkips.studyDaysSkippedByZone,
        localEmpty: localEmpty, remoteEmpty: false, result: 'null-shape'
      });
      return null;
    }
    const remoteCards = countRemoteCards(remote);
    const remoteDaysRows = Object.keys(remote.days || {}).length;
    const remoteStudyDays = (remote.studyDays || []).length;
    const remoteCustom = (remote.customBooks || []).length;
    const remoteEmpty = !remoteCards && !remoteCustom && !remoteStudyDays && !remoteDaysRows;
    const zoneSkips = countZoneSkips(remote);
    if (remoteEmpty && !localEmpty) {
      if (record) rememberProject({
        remoteCards: remoteCards, remoteDaysRows: remoteDaysRows, remoteStudyDays: remoteStudyDays,
        daysSkippedByZone: zoneSkips.daysSkippedByZone,
        studyDaysSkippedByZone: zoneSkips.studyDaysSkippedByZone,
        localEmpty: localEmpty, remoteEmpty: true, result: 'null-empty'
      });
      return null;
    }
    if (record) rememberProject({
      remoteCards: remoteCards, remoteDaysRows: remoteDaysRows, remoteStudyDays: remoteStudyDays,
      daysSkippedByZone: zoneSkips.daysSkippedByZone,
      studyDaysSkippedByZone: zoneSkips.studyDaysSkippedByZone,
      localEmpty: localEmpty, remoteEmpty: remoteEmpty, result: 'merged'
    });
    const next = clone(local);
    next.settings = Object.assign({}, local.settings || {}, remote.settings || {});
    if (remote.settings && remote.settings.bookId) next.bookId = remote.settings.bookId;
    next.books = next.books || {};
    Object.keys(remote.books || {}).forEach(function (id) {
      const src = remote.books[id];
      const cur = next.books[id] || { cards: {}, sentences: {}, extra: [], today: [] };
      Object.keys(src.cards || {}).forEach(function (word) {
        const have = cur.cards[word]; const incoming = src.cards[word];
        if (!have || num(incoming.last_review) >= num(have.last_review)) cur.cards[word] = incoming;
      });
      const pins = {};
      (cur.today || []).forEach(function (w) { pins[w] = 1; });
      (src.today || []).forEach(function (w) { pins[w] = 1; });
      cur.today = Object.keys(pins);
      const extra = {};
      (cur.extra || []).forEach(function (e) { if (e && e.word) extra[e.word] = e; });
      (src.extra || []).forEach(function (e) { if (e && e.word && !extra[e.word]) extra[e.word] = e; });
      cur.extra = Object.keys(extra).map(function (w) { return extra[w]; });
      const sentences = cur.sentences || {};
      (src.sentences || []).forEach(function (s) {
        if (!s || !s.word) return;
        const list = sentences[s.word] || [];
        if (!list.some(function (item) { return item.text === s.text && item.date === s.date; })) list.push({ text: s.text, date: s.date });
        sentences[s.word] = list;
      });
      cur.sentences = sentences;
      next.books[id] = cur;
    });
    const tomb = {};
    (remote.tombstones || []).forEach(function (id) { tomb[id] = 1; });
    const custom = {};
    (next.customBooks || []).forEach(function (b) { custom[b.id] = b; });
    (remote.customBooks || []).forEach(function (b) { custom[b.id] = b; });
    next.customBooks = Object.keys(custom).filter(function (id) { return !tomb[id]; }).map(function (id) { return custom[id]; });
    Object.keys(tomb).forEach(function (id) { if (next.books[id]) delete next.books[id]; });
    const sums = {};
    Object.keys(remote.days || {}).forEach(function (key) {
      const row = remote.days[key];
      if (!row || row.zone !== 'device-local') return;
      const cur = sums[row.day] || { new: 0, review: 0, correct: 0, wrong: 0 };
      cur.new += num(row.new); cur.review += num(row.review); cur.correct += num(row.correct); cur.wrong += num(row.wrong);
      sums[row.day] = cur;
    });
    Object.keys(sums).forEach(function (day) { next.days[day] = sums[day]; });
    const marks = {};
    (next.studyDays || []).forEach(function (d) { marks[d] = 1; });
    (remote.studyDays || []).forEach(function (d) { if (d.zone === 'device-local') marks[d.day] = 1; });
    next.studyDays = Object.keys(marks).sort();
    if (remote.fox) {
      next.fox = Object.assign({}, next.fox || {}, { food: remote.fox.food, xp: remote.fox.xp, fed: remote.fox.fed, name: remote.fox.name });
    }
    return next;
  }
  function onSave(state) {
    if (opted()) arm();
    if (!opted()) return;
    const clean = sanitize(state);
    let before = null;
    try { before = JSON.parse(localStorage.getItem(BASE) || 'null'); } catch (e) { before = null; }
    if (!before) return;
    if (learningEmpty(clean) && !learningEmpty(before)) {
      errorText = '本机清空不会上传，云端进度仍在';
      paint();
      return;
    }
    const ops = diff(before, clean);
    localStorage.setItem(BASE, JSON.stringify(clean));
    if (!ops.length) return;
    const seq = (Number(localStorage.getItem(SEQ)) || 0) + 1;
    const box = readBox();
    box.push({ id: 'commit-' + seq, type: 'commit', ops: ops });
    localStorage.setItem(OUT, JSON.stringify(box));
    localStorage.setItem(SEQ, String(seq));
    flush();
  }
  async function armTick() {
    if (!opted()) return;
    await pull();
    refreshPending();
  }
  function bindVisibility() {
    if (visBound || !root.document || !root.document.addEventListener) return;
    visBound = 1;
    root.document.addEventListener('visibilitychange', function () {
      if (root.document.visibilityState === 'visible' && opted()) pull();
    });
  }
  function arm() {
    bindVisibility();
    if (timer) return;
    intervalMs = failStreak >= 5 ? ARM_SLOW_MS : ARM_FAST_MS;
    syncDiag.intervalMs = intervalMs;
    timer = setInterval(armTick, intervalMs);
  }
  async function clearJoining(sess) {
    waitingPair = 0;
    joining = null;
    const api = cfg() ? backend() : null;
    if (api && typeof api.clearPendingPairing === 'function' && sess) {
      try { await api.clearPendingPairing(sess); } catch (e) { /* keep going */ }
    }
  }
  function remainingSeconds(deadline) {
    return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  }
  function startWaitLoop(joiningSession, expiresAt, resumed) {
    if (waitingPair) return;
    waitingPair = 1;
    joining = { session: joiningSession, fingerprint: joiningSession && joiningSession.fingerprint };
    const deadline = Number(expiresAt) > 0 ? Number(expiresAt) : (Date.now() + PAIR_TTL_MS);
    const tick = async function () {
      if (!joining || !waitingPair) return;
      const left = remainingSeconds(deadline);
      if (left <= 0) {
        const sess = joining.session;
        await clearJoining(sess);
        statusText = '';
        errorText = '配对已过期，请重新生成配对码';
        paint();
        return;
      }
      if (resumed) {
        statusText = '上次配对未完成，正在继续（还剩 ' + left + ' 秒）';
        errorText = '';
        paint();
      }
      try {
        session = await backend().claimPairing(joining.session);
        await clearJoining(session);
        localStorage.setItem(ON, '1');
        blurPairingFields();
      } catch (e) {
        const err = e && e.data && e.data.error;
        if (err === 'pair-expired') {
          const sess = joining && joining.session;
          await clearJoining(sess);
          statusText = '';
          errorText = '配对已过期，请重新生成配对码';
          paint();
          return;
        }
        if (err === 'pair-not-confirmed' || err === 'nonce-replay') {
          setTimeout(tick, 700);
          return;
        }
        const sess = joining && joining.session;
        await clearJoining(sess);
        errorText = '配对没有成功';
        paint();
        return;
      }
      try {
        const remote = await backend().pull(session);
        finishRemoteApply(remote, '已连接');
      } catch (e) {
        statusText = '已连上，但这次拉取失败：暂时连不上同步';
        errorText = '';
        paint();
      }
      arm();
    };
    setTimeout(tick, 700);
  }
  async function resumePendingPairing() {
    if (waitingPair || (session && session.refreshToken)) return false;
    const c = cfg();
    if (!c) return false;
    const api = backend();
    if (!api || typeof api.resumePendingPairing !== 'function') return false;
    const pending = await api.resumePendingPairing({ storage: sync.idbStorage() });
    if (!pending || !pending.session) return false;
    const left = remainingSeconds(pending.expiresAt || 0);
    if (left <= 0) {
      await api.clearPendingPairing(pending.session);
      statusText = '';
      errorText = '配对已过期，请重新生成配对码';
      paint();
      return false;
    }
    statusText = '上次配对未完成，正在继续（还剩 ' + left + ' 秒）';
    errorText = '';
    paint();
    startWaitLoop(pending.session, pending.expiresAt, true);
    return true;
  }
  function boot() {
    bindVisibility();
    if (opted()) arm();
    resumePendingPairing().catch(function () {});
  }
  async function recoverWithSecret() {
    const input = document.getElementById('sync-recover');
    const secret = input ? input.value.trim() : '';
    if (!secret) return;
    errorText = '';
    try {
      const backup = prep.commitPrecloudBackup(storageAdapter());
      if (prep.precloudBackupWriteFailed(backup)) { errorText = '备份没有写成，同步没有开始'; paint(); return; }
      const made = await backend().recover({ recoverySecret: secret, deviceName: '这台设备', storage: sync.idbStorage() });
      session = made.session;
      localStorage.setItem(ON, '1');
      blurPairingFields();
      const remote = await backend().pull(session);
      finishRemoteApply(remote, '已用恢复码连接');
      arm();
    } catch (e) { errorText = '恢复码无效'; paint(); }
  }
  async function enableNew() {
    errorText = '';
    // A leftover foxVocab.precloud.backup must stay immutable, but it must not block the current preview or arming 确认备份并上传.
    const backup = prep.commitPrecloudBackup(storageAdapter());
    if (prep.precloudBackupWriteFailed(backup)) { errorText = '备份没有写成，同步没有开始'; paint(); return; }
    const state = sanitize(root.__dogverbReadState());
    const preview = previewOf(state);
    const slot = document.getElementById('sync-preview');
    if (slot) slot.textContent = '将上传本机进度：已学 ' + preview.cards + '，自建词书 ' + preview.custom + '，打卡 ' + preview.days + '。两台旧设备重叠的当天次数只保留较大的一边，不会相加，因此可能少计。空的云端不会覆盖本机。';
    statusText = '请确认后再上传';
    paint();
    const button = document.getElementById('sync-go');
    if (button) button.onclick = async function () {
      try {
        const made = await backend().createSpace({ deviceName: '这台设备', storage: sync.idbStorage() });
        session = made.session;
        recoveryOnce = made.recoverySecret;
        const secret = document.getElementById('sync-secret');
        if (secret) secret.value = recoveryOnce;
        if (!learningEmpty(state)) {
          const uploaded = await backend().pushLegacy(session, state);
          if (uploaded && uploaded.legacy && uploaded.legacy.limitation) errorText = '重叠的旧进度按较大值合并，不会把两边次数相加';
        }
        localStorage.setItem(BASE, JSON.stringify(state));
        localStorage.setItem(ON, '1');
        localStorage.setItem(REV, '0');
        statusText = '已连接。配对码只在这里显示，它本身打不开进度。';
        errorText = '';
        const code = document.getElementById('sync-code');
        const minted = await backend().mintPairing(session);
        joining = null;
        if (code) code.value = minted.payload;
        paint();
        arm();
      } catch (e) { errorText = '没有连上'; paint(); }
    };
  }
  async function join() {
    const input = document.getElementById('sync-join');
    const payload = input ? input.value.trim() : '';
    if (!payload) return;
    errorText = '';
    try {
      joining = await backend().submitPairing({ payload: payload, deviceName: '新设备', storage: sync.idbStorage() });
      statusText = '已提交，等原来的那台确认指纹 ' + joining.fingerprint.slice(0, 8);
      paint();
      const expiresAt = (joining.session && joining.session.pendingPairingExpiresAt) || joining.expiresAt;
      startWaitLoop(joining.session, expiresAt, false);
    } catch (e) { errorText = '配对码无效或已过期'; paint(); }
  }
  async function refreshPending() {
    if (!session || session.role === 'member') return;
    try {
      const proof = await backend().pull(session);
      const waiting = await backend().pendingPairings(session);
      const box = document.getElementById('sync-pending');
      if (!box) return;
      box.innerHTML = '';
      (waiting.pending || []).forEach(function (item) {
        const row = document.createElement('div');
        row.className = 'row';
        const label = document.createElement('span');
        label.textContent = (item.deviceName || '新设备') + ' 指纹 ' + item.fingerprint.slice(0, 8);
        const ok = document.createElement('button');
        ok.type = 'button'; ok.className = 'primary sm'; ok.textContent = '确认这台设备';
        ok.onclick = async function () {
          await backend().confirmPairing(session, item.pairingId, item.fingerprint);
          statusText = '已确认';
          paint();
          refreshPending();
        };
        row.appendChild(label); row.appendChild(ok); box.appendChild(row);
      });
      (proof.devices || []).forEach(function (device) {
        if (device.deviceId === session.deviceId || device.revoked) return;
        const row = document.createElement('div');
        row.className = 'row';
        const label = document.createElement('span');
        label.textContent = device.name + ' ' + device.fingerprint.slice(0, 8);
        const revoke = document.createElement('button');
        revoke.type = 'button'; revoke.className = 'danger sm'; revoke.textContent = '移除';
        revoke.onclick = async function () {
          await backend().revokeDevice(session, device.deviceId);
          statusText = '已移除一台设备';
          paint();
          refreshPending();
        };
        row.appendChild(label); row.appendChild(revoke); box.appendChild(row);
      });
    } catch (e) { /* status already covered by pull */ }
  }
  function mount() {
    const slot = document.getElementById('sync-slot');
    if (!slot) return;
    if (!cfg()) {
      slot.innerHTML = '<div class="card"><div class="ctitle">跨设备同步</div><div class="hint">配对码同步还没接通。接通后，学习进度、复习计划、生词和自助词书会在这台手机、Windows 和 Mac 的同一个网页之间自动同步。手动导出不能代替自动同步。请先在 Supabase 控制台按 docs/supabase-sync.md 做完迁移和函数，再把 Project Settings → API 里的 anon/public 密钥填进 sync-config.js（不要把 service_role 或数据库密码写进仓库或聊天）。</div></div>';
      return;
    }
    slot.innerHTML = '<div class="card"><div class="ctitle">跨设备同步</div><div class="hint">用配对码连接设备，不用注册学习账号。学习进度、复习计划、生词和自助词书会自动同步。手动导出仍可当备份，但不能代替自动同步。</div><div id="syncstatus" class="hint"></div><div id="sync-preview" class="hint"></div><div class="row"><button type="button" class="primary" id="sync-enable">在这台开启</button><button type="button" class="ghost" id="sync-go">确认备份并上传</button></div><label class="field">恢复码（只显示这一次）<input id="sync-secret" type="text" readonly autocomplete="off"></label><button type="button" class="ghost sm" id="sync-hid">我已保存恢复码</button><label class="field">配对码<input id="sync-code" type="text" readonly autocomplete="off"></label><label class="field">加入另一台<input id="sync-join" type="text" autocomplete="off" spellcheck="false" placeholder="粘贴配对码"></label><button type="button" class="primary" id="sync-submit">提交配对</button><label class="field">用恢复码重新加入<input id="sync-recover" type="text" autocomplete="off" spellcheck="false" placeholder="粘贴恢复码"></label><button type="button" class="ghost" id="sync-recover-go">用恢复码加入</button><div id="sync-pending"></div></div>';
    statusText = opted() ? '已开启' : '还没开启。开启前会先做一份不可覆盖的本机备份。';
    paint();
    document.getElementById('sync-enable').onclick = enableNew;
    document.getElementById('sync-submit').onclick = join;
    document.getElementById('sync-recover-go').onclick = recoverWithSecret;
    document.getElementById('sync-hid').onclick = function () {
      recoveryOnce = '';
      const secret = document.getElementById('sync-secret');
      if (secret) secret.value = '';
    };
    const pendingBox = document.getElementById('sync-pending');
    if (opted()) {
      ensureSession().then(function () { return pull(); }).then(function () {
        arm();
        const code = document.getElementById('sync-code');
        if (session && code && !code.value) backend().mintPairing(session).then(function (minted) { code.value = minted.payload; refreshPending(); }).catch(function () { errorText = '配对码没有生成'; paint(); });
      }).catch(function () { arm(); });
    }
    if (pendingBox) pendingBox.addEventListener('click', function () {});
  }
  root.__dogverbAfterSave = onSave;
  root.DogverbAppSync = {
    mount: mount, flush: flush, pull: pull, join: join, recoverWithSecret: recoverWithSecret,
    finishRemoteApply: finishRemoteApply, retryPendingApply: retryPendingApply, ensureSession: ensureSession,
    arm: arm, boot: boot, retryDead: retryDead, project: project,
    status: function () { return { statusText: statusText, errorText: errorText }; },
    pending: function () { return pendingRemote; },
    diag: function () { return recordDiag(); },
    projectDiag: function () { return projectDiag; },
    timerInfo: function () { return { intervalMs: intervalMs, failStreak: failStreak, armed: !!timer }; },
    debugServer: function (url) { if (session) session.server = url; if (joining && joining.session) joining.session.server = url; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
