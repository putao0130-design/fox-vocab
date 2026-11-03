// 纯逻辑模块：FSRS 间隔重复、v1 迁移、英音发音、词形匹配、造句检查、宠物计算。浏览器与 Node 共用。
(function (root) {
  let F = root.FSRS;
  if (!F && typeof require !== 'undefined') { // Node：加载 vendor 的 UMD 文件到全局
    const sb = {}; require('vm').runInNewContext(require('fs').readFileSync(require('path').join(__dirname, 'vendor/ts-fsrs.umd.js'), 'utf8'), sb);
    F = sb.FSRS;
  }
  const MIN = 60 * 1000, DAY = 24 * 60 * MIN;
  const MASTER_DAYS = 30; // 掌握：处于复习状态且本次排定间隔 ≥ 30 天
  const Rating = { Again: 1, Hard: 2, Good: 3, Easy: 4 };
  const RATING_LABELS = { 1: '忘了', 2: '难', 3: '记得', 4: '简单' };
  const scheduler = F.fsrs(F.generatorParameters({ enable_fuzz: false, enable_short_term: true, request_retention: 0.9, maximum_interval: 365 }));
  // v1 的固定间隔（用于迁移）
  const V1_INTERVALS = [5 * MIN, 30 * MIN, 1 * DAY, 2 * DAY, 4 * DAY, 7 * DAY, 15 * DAY, 30 * DAY];

  function dayKey(t) { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function daysBetween(k1, k2) { const a = new Date(k1 + 'T00:00:00'), b = new Date(k2 + 'T00:00:00'); return Math.round((b - a) / DAY); }

  // 存储格式（全部为数字，便于 JSON）：{due,stability,difficulty,elapsed_days,scheduled_days,learning_steps,reps,lapses,state,last_review,learnedAt,mastered,masteredAt}
  function toF(c) { return { due: new Date(c.due), stability: c.stability, difficulty: c.difficulty, elapsed_days: c.elapsed_days || 0, scheduled_days: c.scheduled_days || 0, learning_steps: c.learning_steps || 0, reps: c.reps || 0, lapses: c.lapses || 0, state: c.state, last_review: c.last_review ? new Date(c.last_review) : undefined }; }
  function fromF(fc, base) { return Object.assign({}, base, { due: +fc.due, stability: fc.stability, difficulty: fc.difficulty, elapsed_days: fc.elapsed_days, scheduled_days: fc.scheduled_days, learning_steps: fc.learning_steps, reps: fc.reps, lapses: fc.lapses, state: fc.state, last_review: fc.last_review ? +fc.last_review : null }); }
  function emptyCard(now) { return fromF(F.createEmptyCard(new Date(now)), { learnedAt: now, mastered: false, masteredAt: null }); }
  function intervalDays(c) { return c.last_review ? (c.due - c.last_review) / DAY : 0; }
  function qualifiesMastered(c) { return c.state === F.State.Review && intervalDays(c) >= MASTER_DAYS - 0.01; }
  function isDue(card, now) { return !!card && card.due <= now; }

  // 第一次学习：对新卡打分
  function learnCard(rating, now) { return grade(emptyCard(now), rating, now, true).card; }
  // 返回 {card, event}；event: 'advance' | 'mastered' | 'lapse' | 'practice'
  function grade(card, rating, now, force) {
    if (typeof rating === 'boolean') rating = rating ? Rating.Good : Rating.Again;
    if (!force && card.due > now && rating !== Rating.Again) return { card, event: 'practice' }; // 未到期的额外练习答对不改变计划
    const r = scheduler.next(toF(card), new Date(now), rating);
    const c = fromF(r.card, card);
    if (rating === Rating.Again) { c.mastered = false; c.masteredAt = null; return { card: c, event: 'lapse' }; }
    if (!c.mastered && qualifiesMastered(c)) { c.mastered = true; c.masteredAt = now; return { card: c, event: 'mastered' }; }
    return { card: c, event: 'advance' };
  }
  function markKnown(card, now) { // "太熟了"：直接设为长期记忆、掌握
    const c = Object.assign(emptyCard(now), card || {});
    Object.assign(c, { state: F.State.Review, stability: 60, difficulty: 3, scheduled_days: 60, elapsed_days: 0, learning_steps: 0, last_review: now, due: now + 60 * DAY, reps: (c.reps || 0) + 1, mastered: true, masteredAt: now });
    return c;
  }
  function preview(card, now) { // 各评分对应的下次间隔（用于按钮提示）
    const base = card || emptyCard(now), out = {};
    for (const g of [1, 2, 3, 4]) { const n = scheduler.next(toF(base), new Date(now), g).card; out[g] = n.due - now; }
    return out;
  }
  function fmtInterval(ms) { const m = Math.round(ms / MIN); if (m < 60) return Math.max(1, m) + '分钟'; if (m < 60 * 24) return Math.round(m / 60) + '小时'; const d = Math.round(m / 1440); return d < 31 ? d + '天' : d < 365 ? Math.round(d / 30) + '个月' : (d / 365).toFixed(1) + '年'; }

  // ---------- v1 -> v2 迁移 ----------
  function migrateCard(o) {
    const stage = Math.max(0, Math.min(7, o.stage | 0));
    const iv = V1_INTERVALS[stage];
    const due = typeof o.due === 'number' ? o.due : Date.now();
    const lapses = o.lapses || 0;
    const c = { due, stability: Math.max(0.1, iv / DAY), difficulty: Math.min(10, 5 + lapses * 0.7), elapsed_days: 0, scheduled_days: Math.round(iv / DAY), learning_steps: stage <= 1 ? stage : 0,
      reps: o.reps || 0, lapses, state: stage <= 1 ? (lapses ? F.State.Relearning : F.State.Learning) : F.State.Review, last_review: due - iv, learnedAt: o.learnedAt || due - iv, mastered: !!o.mastered, masteredAt: o.masteredAt || null };
    if (c.mastered) { c.state = F.State.Review; c.stability = Math.max(c.stability, MASTER_DAYS); c.scheduled_days = Math.max(c.scheduled_days, MASTER_DAYS); c.last_review = Math.min(c.last_review, due - MASTER_DAYS * DAY); }
    return c;
  }
  function migrate(s) { // 接受 v1 或 v2 状态对象，返回 v2
    if (!s || typeof s !== 'object' || !s.books) throw new Error('bad state');
    if (s.v === 2) return s;
    if (s.v !== 1) throw new Error('unknown version');
    const out = JSON.parse(JSON.stringify(s)); out.v = 2; out.migratedFrom = 1;
    out.settings = Object.assign({ dailyNew: 20, autoPlay: true }, s.settings || {});
    for (const id in out.books) { const b = out.books[id]; b.sentences = b.sentences || {}; for (const w in b.cards || {}) b.cards[w] = migrateCard(b.cards[w]); }
    return out;
  }

  // ---------- 英音发音 ----------
  function audioUrl(word) { return 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(word) + '&type=1'; } // type=1 = 英音
  function pickVoice(voices) { voices = voices || []; return voices.find(v => /^en[-_]GB/i.test(v.lang)) || null; }

  function streak(days, todayKey) { const set = new Set(days); let k = todayKey, n = 0; if (!set.has(k)) k = shiftDay(k, -1); while (set.has(k)) { n++; k = shiftDay(k, -1); } return n; }
  function shiftDay(k, d) { const t = new Date(k + 'T12:00:00'); t.setDate(t.getDate() + d); return dayKey(t.getTime()); }

  function stemOf(w) { w = w.toLowerCase(); if (w.length > 4 && /[ey]$/.test(w)) return w.slice(0, -1); return w; }
  function findForm(text, word) {
    const w = word.toLowerCase(), stem = stemOf(w); const re = /[A-Za-z][A-Za-z'-]*/g; let m;
    while ((m = re.exec(text))) {
      const t = m[0].toLowerCase().replace(/'s$/, '');
      if (t === w) return { form: m[0], index: m.index };
      if (t.startsWith(stem) && t.length <= w.length + 4 && /^(s|es|d|ed|ing|ies|ied|er|ers|ly|ion|ions|al|ment|ments|ive)?$/.test(t.slice(stem.length).replace(/^[ey]/, ''))) return { form: m[0], index: m.index };
      if (t.startsWith(w) && t.length <= w.length + 3) return { form: m[0], index: m.index };
    }
    return null;
  }
  function makeCloze(sentence, word) { if (!sentence) return null; const f = findForm(sentence, word); if (!f) return null; return { text: sentence.slice(0, f.index) + '_____' + sentence.slice(f.index + f.form.length), answer: f.form }; }
  function hasExample(w) { return !!(w.examples && w.examples.length && makeCloze(w.examples[0], w.word)); }
  function norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function answerMatch(input, expected) { return norm(input) === norm(expected); }
  function checkSentence(s, word) {
    const errors = []; s = String(s || '').trim();
    if (!findForm(s, word)) errors.push('句子中没有出现目标词「' + word + '」（或其变形）');
    const n = (s.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || []).length;
    if (n < 5) errors.push('句子太短，至少 5 个单词（当前 ' + n + ' 个）');
    if (n > 60) errors.push('句子过长，建议不超过 60 个单词');
    if (!/^[A-Z"']/.test(s)) errors.push('句首应大写');
    if (!/[.!?]["']?$/.test(s)) errors.push('句末应有标点 . ! ?');
    if (/[\u4e00-\u9fa5]/.test(s)) errors.push('句子中含有中文字符');
    return { ok: errors.length === 0, errors };
  }

  // 宠物
  const HUNGER_PER_DAY = 25, FEED_HUNGER = 10, FEED_XP = 10;
  function foxLevel(xp) { return Math.floor(Math.sqrt((xp || 0) / 20)) + 1; }
  function foxAge(mastered, total) { const months = total ? Math.min(12, mastered / total * 12) : 0; return { months, years: months / 12, label: months >= 12 ? '1岁' : months.toFixed(1) + ' 个月' }; }
  function foxStage(months) { if (months >= 12) return { name: '成年狐狸', emoji: '🦊👑' }; if (months >= 6) return { name: '青年狐狸', emoji: '🦊' }; if (months >= 2) return { name: '少年小狐', emoji: '🦊' }; return { name: '狐狸幼崽', emoji: '🥚🦊' }; }
  function foxMood(h) { return h >= 80 ? '开心 😄' : h >= 50 ? '还行 🙂' : h >= 20 ? '饿了 😟' : '非常饿 😢'; }
  function applyHunger(fox, studyDays, todayKey) {
    const f = Object.assign({}, fox); const last = f.lastCheck || todayKey; const set = new Set(studyDays); let k = last;
    while (daysBetween(k, todayKey) > 0) { if (!set.has(k)) f.hunger = Math.max(0, f.hunger - HUNGER_PER_DAY); k = shiftDay(k, 1); }
    f.lastCheck = todayKey; return f;
  }
  function feed(fox) { if (fox.food <= 0) return { fox, ok: false }; const f = Object.assign({}, fox); f.food--; f.hunger = Math.min(100, f.hunger + FEED_HUNGER); f.xp += FEED_XP; f.fed = (f.fed || 0) + 1; return { fox: f, ok: true }; }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  const api = { MIN, DAY, MASTER_DAYS, Rating, RATING_LABELS, State: F.State, V1_INTERVALS, dayKey, daysBetween, shiftDay, emptyCard, learnCard, isDue, grade, markKnown, preview, fmtInterval, intervalDays, migrateCard, migrate, audioUrl, pickVoice, streak, findForm, makeCloze, hasExample, norm, answerMatch, checkSentence, foxLevel, foxAge, foxStage, foxMood, applyHunger, feed, shuffle, HUNGER_PER_DAY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VocabCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
