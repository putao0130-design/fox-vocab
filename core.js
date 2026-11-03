// 纯逻辑模块：间隔重复、词形匹配、造句检查、宠物计算。浏览器与 Node 共用。
(function (root) {
  const MIN = 60 * 1000, DAY = 24 * 60 * MIN;
  // 阶段 0..7 对应的下次复习间隔
  const INTERVALS = [5 * MIN, 30 * MIN, 1 * DAY, 2 * DAY, 4 * DAY, 7 * DAY, 15 * DAY, 30 * DAY];
  const INTERVAL_LABELS = ['5分钟', '30分钟', '1天', '2天', '4天', '7天', '15天', '30天'];
  const MASTER_STAGE = 7; // 到达 30 天间隔 = 掌握

  function dayKey(t) { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function daysBetween(k1, k2) { // k2 - k1 天数（按本地日期）
    const a = new Date(k1 + 'T00:00:00'), b = new Date(k2 + 'T00:00:00');
    return Math.round((b - a) / DAY);
  }
  function newCard(now) { return { stage: 0, due: now + INTERVALS[0], reps: 0, lapses: 0, learnedAt: now, mastered: false, masteredAt: null }; }
  function isDue(card, now) { return !!card && !card.mastered && card.due <= now; }

  // 返回 {card, event}；event: 'advance' | 'mastered' | 'lapse' | 'practice'
  function grade(card, correct, now) {
    const c = Object.assign({}, card);
    c.reps = (c.reps || 0) + 1;
    if (!correct) {
      c.lapses = (c.lapses || 0) + 1;
      c.stage = c.stage >= 3 ? c.stage - 3 : 0; // 答错：退 3 级（最低 0），5分钟后再考
      c.due = now + INTERVALS[0];
      if (c.mastered) { c.mastered = false; c.masteredAt = null; }
      return { card: c, event: 'lapse' };
    }
    if (c.mastered || c.due > now) return { card: c, event: 'practice' }; // 未到期的额外练习不升级
    c.stage = Math.min(c.stage + 1, MASTER_STAGE);
    c.due = now + INTERVALS[c.stage];
    if (c.stage >= MASTER_STAGE) { c.mastered = true; c.masteredAt = now; return { card: c, event: 'mastered' }; }
    return { card: c, event: 'advance' };
  }
  function markKnown(card, now) { // "太熟了"：直接掌握
    const c = Object.assign(newCard(now), card || {});
    c.stage = MASTER_STAGE; c.mastered = true; c.masteredAt = now; c.due = now + INTERVALS[MASTER_STAGE];
    return c;
  }

  function streak(days, todayKey) {
    const set = new Set(days); let k = todayKey, n = 0;
    if (!set.has(k)) { k = shiftDay(k, -1); }
    while (set.has(k)) { n++; k = shiftDay(k, -1); }
    return n;
  }
  function shiftDay(k, d) { const t = new Date(k + 'T12:00:00'); t.setDate(t.getDate() + d); return dayKey(t.getTime()); }

  // 词形：返回在文本中出现的该词（含常见屈折变化）的形式，找不到返回 null
  function stemOf(w) {
    w = w.toLowerCase();
    if (w.length > 4 && /[ey]$/.test(w)) return w.slice(0, -1);
    return w;
  }
  function findForm(text, word) {
    const w = word.toLowerCase(), stem = stemOf(w);
    const re = /[A-Za-z][A-Za-z'-]*/g; let m;
    while ((m = re.exec(text))) {
      const t = m[0].toLowerCase().replace(/'s$/, '');
      if (t === w) return { form: m[0], index: m.index };
      if (t.startsWith(stem) && t.length <= w.length + 4 && /^(s|es|d|ed|ing|ies|ied|er|ers|ly|ion|ions|al|ment|ments|ive)?$/.test(t.slice(stem.length).replace(/^[ey]/, ''))) return { form: m[0], index: m.index };
      if (t.startsWith(w) && t.length <= w.length + 3) return { form: m[0], index: m.index };
    }
    return null;
  }
  function makeCloze(sentence, word) {
    const f = findForm(sentence, word); if (!f) return null;
    return { text: sentence.slice(0, f.index) + '_____' + sentence.slice(f.index + f.form.length), answer: f.form };
  }
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
  function foxAge(mastered, total) { // 月龄：掌握整本词书 = 12 个月 = 1 岁
    const months = total ? Math.min(12, mastered / total * 12) : 0;
    return { months, years: months / 12, label: months >= 12 ? '1岁' : months.toFixed(1) + ' 个月' };
  }
  function foxStage(months) {
    if (months >= 12) return { name: '成年狐狸', emoji: '🦊👑' };
    if (months >= 6) return { name: '青年狐狸', emoji: '🦊' };
    if (months >= 2) return { name: '少年小狐', emoji: '🦊' };
    return { name: '狐狸幼崽', emoji: '🥚🦊' };
  }
  function foxMood(h) { return h >= 80 ? '开心 😄' : h >= 50 ? '还行 🙂' : h >= 20 ? '饿了 😟' : '非常饿 😢'; }
  // 按“没有学习的天数”降低饱食度
  function applyHunger(fox, studyDays, todayKey) {
    const f = Object.assign({}, fox);
    const last = f.lastCheck || todayKey;
    const set = new Set(studyDays);
    let k = last;
    while (daysBetween(k, todayKey) > 0) { // 对 last 之后、today 之前（含 last 当天若未学习）
      if (!set.has(k)) f.hunger = Math.max(0, f.hunger - HUNGER_PER_DAY);
      k = shiftDay(k, 1);
    }
    f.lastCheck = todayKey;
    return f;
  }
  function feed(fox) {
    if (fox.food <= 0) return { fox, ok: false };
    const f = Object.assign({}, fox); f.food--; f.hunger = Math.min(100, f.hunger + FEED_HUNGER); f.xp += FEED_XP; f.fed = (f.fed || 0) + 1;
    return { fox: f, ok: true };
  }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  const api = { MIN, DAY, INTERVALS, INTERVAL_LABELS, MASTER_STAGE, dayKey, daysBetween, shiftDay, newCard, isDue, grade, markKnown, streak, findForm, makeCloze, norm, answerMatch, checkSentence, foxLevel, foxAge, foxStage, foxMood, applyHunger, feed, shuffle, HUNGER_PER_DAY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VocabCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
