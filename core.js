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
  // 当月月历：周一开头，固定 6 行。只标 studyDays 里落在本月的日期。
  function monthGrid(days, todayKey) {
    days = Array.isArray(days) ? days : [];
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(todayKey || ''));
    if (!m) throw new Error('bad day');
    const year = +m[1], month = +m[2], dim = new Date(year, month, 0).getDate();
    const lead = (new Date(m[1] + '-' + m[2] + '-01T12:00:00').getDay() + 6) % 7;
    const set = new Set(days);
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const day = i - lead + 1;
      if (day < 1 || day > dim) { cells.push(null); continue; }
      const key = m[1] + '-' + m[2] + '-' + (day < 10 ? '0' : '') + day;
      cells.push({ key, day, on: set.has(key), today: key === todayKey });
    }
    return { year, month, label: year + '年' + month + '月', rows: 6, weekdays: ['一', '二', '三', '四', '五', '六', '日'], cells, streak: streak(days, todayKey), total: days.length };
  }
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
// 默写对答案：忽略大小写、首尾空白和简单标点。词条只有一种拼写时，英式/美式变体也算对，仍以词头为准。
function dictationNorm(s) {
  return String(s || '').trim().toLowerCase()
    .replace(/[.,!?;:"“”()[\]{}，。！？；：、（）【】…·「」『』]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function dictationMatch(input, headword) {
  const got = dictationNorm(input);
  const want = dictationNorm(headword);
  if (!got || !want) return false;
  if (got === want) return true;
  const variant = spellingVariant(String(headword || '').trim().toLowerCase().replace(/\s+/g, ' '));
  return !!variant && got === dictationNorm(variant);
}
// 今日新词学完第 n 个（从 1 计）后的默写题型。奇数看意，偶数听音，一场里两种都会出现。
function learnDictationKind(n) { return (n | 0) % 2 === 1 ? 'gloss' : 'listen'; }
// 跟写：词头一直按原样显示，用户逐个打字母。大小写不敏感。空白忽略。
// 词头里的撇号、连字符、句点和空格不单独挡路，打下一个字母时直接跨过去。
function followSlots(headword) {
  const raw = String(headword || '');
  const slots = [];
  for (let i = 0; i < raw.length; i++) slots.push({ ch: raw[i], letter: /[A-Za-z]/.test(raw[i]) });
  return slots;
}
function followCursor(slots, index) {
  let i = index > 0 ? index : 0;
  while (i < slots.length && !slots[i].letter) i++;
  return i;
}
function followPress(headword, index, text) {
  const slots = followSlots(headword);
  let i = followCursor(slots, index | 0);
  let wrong = '';
  const chars = String(text == null ? '' : text);
  for (let c = 0; c < chars.length && i < slots.length; c++) {
    const ch = chars[c];
    if (/\s/.test(ch) || !/[A-Za-z]/.test(ch)) continue;
    if (ch.toLowerCase() === slots[i].ch.toLowerCase()) {
      i = followCursor(slots, i + 1);
      wrong = '';
    } else {
      wrong = ch;
      break;
    }
  }
  return { index: i, done: i >= slots.length, wrong, expected: i < slots.length ? slots[i].ch : '' };
}
function followView(headword, index, wrongKey) {
  const slots = followSlots(headword);
  const cur = followCursor(slots, index | 0);
  const wrong = String(wrongKey || '');
  let typed = '';
  const painted = slots.map((s, n) => {
    let cls = 'fl';
    if (!s.letter) cls += ' punct';
    if (n < cur) {
      cls += ' on';
      if (s.letter) typed += s.ch;
    } else if (n === cur) cls += wrong ? ' cur miss' : ' cur';
    return { ch: s.ch, cls };
  });
  return { index: cur, done: cur >= slots.length, expected: cur < slots.length ? slots[cur].ch : '', wrong, typed, slots: painted };
}
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
  function foxStage(months) { if (months >= 12) return { name: '成犬', emoji: '🐶' }; if (months >= 6) return { name: '青年小狗', emoji: '🐶' }; if (months >= 2) return { name: '少年小狗', emoji: '🐶' }; return { name: '幼崽', emoji: '🐶' }; }
  function foxMood(h) { return h >= 80 ? '开心 😄' : h >= 50 ? '还行 🙂' : h >= 20 ? '饿了 😟' : '非常饿 😢'; }
  function applyHunger(fox, studyDays, todayKey) {
    const f = Object.assign({}, fox); const last = f.lastCheck || todayKey; const set = new Set(studyDays); let k = last;
    while (daysBetween(k, todayKey) > 0) { if (!set.has(k)) f.hunger = Math.max(0, f.hunger - HUNGER_PER_DAY); k = shiftDay(k, 1); }
    f.lastCheck = todayKey; return f;
  }
  function feed(fox) { if (fox.food <= 0) return { fox, ok: false }; const f = Object.assign({}, fox); f.food--; f.hunger = Math.min(100, f.hunger + FEED_HUNGER); f.xp += FEED_XP; f.fed = (f.fed || 0) + 1; return { fox: f, ok: true }; }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // 不规则屈折：规则去尾缀还原不了、但词书里常有原形的那些。原词本身永远排在最前。
  const IRREGULAR = {
    children: 'child', men: 'man', women: 'woman', mice: 'mouse', feet: 'foot', teeth: 'tooth', geese: 'goose', oxen: 'ox',
    people: 'person', phenomena: 'phenomenon', criteria: 'criterion', indices: 'index', formulae: 'formula',
    analyses: 'analysis', crises: 'crisis', theses: 'thesis', hypotheses: 'hypothesis', parentheses: 'parenthesis',
    oases: 'oasis', diagnoses: 'diagnosis', synopses: 'synopsis', appendices: 'appendix', matrices: 'matrix',
    vertices: 'vertex', alumni: 'alumnus', cacti: 'cactus', fungi: 'fungus', nuclei: 'nucleus', stimuli: 'stimulus',
    syllabi: 'syllabus', foci: 'focus', radii: 'radius', curricula: 'curriculum', media: 'medium', bacteria: 'bacterium',
    wives: 'wife', knives: 'knife', halves: 'half', wolves: 'wolf', shelves: 'shelf', thieves: 'thief', calves: 'calf', loaves: 'loaf',
    went: 'go', gone: 'go', took: 'take', taken: 'take', made: 'make', saw: 'see', seen: 'see', came: 'come',
    got: 'get', gotten: 'get', gave: 'give', given: 'give', found: 'find', thought: 'think', brought: 'bring',
    bought: 'buy', taught: 'teach', caught: 'catch', fought: 'fight', sought: 'seek', knew: 'know', known: 'know',
    grew: 'grow', grown: 'grow', threw: 'throw', thrown: 'throw', wrote: 'write', written: 'write',
    spoke: 'speak', spoken: 'speak', broke: 'break', broken: 'break', ate: 'eat', eaten: 'eat', did: 'do', done: 'do',
    was: 'be', were: 'be', been: 'be', had: 'have', has: 'have', said: 'say', told: 'tell', sold: 'sell', held: 'hold',
    felt: 'feel', kept: 'keep', slept: 'sleep', left: 'leave', meant: 'mean', met: 'meet', led: 'lead', paid: 'pay',
    heard: 'hear', built: 'build', sent: 'send', spent: 'spend', lost: 'lose', shot: 'shoot', sat: 'sit', ran: 'run',
    began: 'begin', begun: 'begin', drank: 'drink', drunk: 'drink', sang: 'sing', sung: 'sing', swam: 'swim', swum: 'swim',
    rang: 'ring', rung: 'ring', sank: 'sink', sunk: 'sink', chose: 'choose', chosen: 'choose', froze: 'freeze', frozen: 'freeze',
    drove: 'drive', driven: 'drive', rode: 'ride', ridden: 'ride', rose: 'rise', risen: 'rise', stole: 'steal', stolen: 'steal',
    woke: 'wake', woken: 'wake', wore: 'wear', worn: 'wear', tore: 'tear', torn: 'tear', drew: 'draw', drawn: 'draw',
    flew: 'fly', flown: 'fly', fell: 'fall', fallen: 'fall', forgot: 'forget', forgotten: 'forget', hid: 'hide', hidden: 'hide',
    bit: 'bite', bitten: 'bite', lay: 'lie', lain: 'lie', hung: 'hang', dug: 'dig', stuck: 'stick', struck: 'strike', won: 'win',
    understood: 'understand', became: 'become', stood: 'stand', dealt: 'deal', fed: 'feed', fled: 'flee', flung: 'fling',
    forgave: 'forgive', forgiven: 'forgive', knelt: 'kneel', lit: 'light', mistook: 'mistake', mistaken: 'mistake',
    overcame: 'overcome', shook: 'shake', shaken: 'shake', shone: 'shine', shrank: 'shrink', shrunk: 'shrink', slid: 'slide',
    sped: 'speed', spun: 'spin', sprang: 'spring', sprung: 'spring', stung: 'sting', stank: 'stink', stunk: 'stink',
    swung: 'swing', swept: 'sweep', wept: 'weep', wove: 'weave', woven: 'weave', wound: 'wind', arose: 'arise', arisen: 'arise',
    awoke: 'awake', awoken: 'awake', bled: 'bleed', bred: 'breed', clung: 'cling', crept: 'creep', dreamt: 'dream', dwelt: 'dwell',
    ground: 'grind', leapt: 'leap', learnt: 'learn', lent: 'lend', misled: 'mislead', overtook: 'overtake', overtaken: 'overtake',
    spat: 'spit', swore: 'swear', sworn: 'swear', strove: 'strive', striven: 'strive', strung: 'string', underwent: 'undergo',
    withdrew: 'withdraw', withdrawn: 'withdraw', withstood: 'withstand', wrung: 'wring', borne: 'bear', born: 'bear', bound: 'bind'
  };
  // 规则去尾缀会误伤的 -er/-est/-ly 原形。这些词本身仍会作为候选，只是不再剥后缀。
  const SUFFIX_SKIP = { letter: 1, summer: 1, matter: 1, dinner: 1, butter: 1, pepper: 1, copper: 1, hammer: 1, ladder: 1, better: 1, water: 1, number: 1, under: 1, over: 1, after: 1, never: 1, cover: 1, enter: 1, paper: 1, answer: 1, other: 1, another: 1, mother: 1, father: 1, brother: 1, sister: 1, member: 1, power: 1, order: 1, offer: 1, computer: 1, interest: 1, forest: 1, harvest: 1, suggest: 1, protest: 1, request: 1, honest: 1, modest: 1, west: 1, test: 1, rest: 1, chest: 1, best: 1, former: 1, inner: 1, outer: 1, super: 1, family: 1, early: 1, only: 1, apply: 1, reply: 1, supply: 1, imply: 1, comply: 1, ugly: 1, rely: 1 };
  // 不是 -ise/-ize 拼写差异的 -ise 词。
  const ISE_SKIP = { promise: 1, premise: 1, compromise: 1, exercise: 1, expertise: 1, franchise: 1, surprise: 1, advertise: 1, concise: 1, precise: 1, paradise: 1, advise: 1, comprise: 1, disguise: 1, enterprise: 1, demise: 1, treatise: 1, sunrise: 1, arise: 1, wise: 1, otherwise: 1, likewise: 1, clockwise: 1 };
  const SPELLING_EXACT = {
    colour: 'color', color: 'colour', favour: 'favor', favor: 'favour', honour: 'honor', honor: 'honour', labour: 'labor', labor: 'labour',
    neighbour: 'neighbor', neighbor: 'neighbour', behaviour: 'behavior', behavior: 'behaviour', flavour: 'flavor', flavor: 'flavour',
    harbour: 'harbor', harbor: 'harbour', humour: 'humor', humor: 'humour', rumour: 'rumor', rumor: 'rumour', vigour: 'vigor', vigor: 'vigour',
    odour: 'odor', odor: 'odour', clamour: 'clamor', clamor: 'clamour', endeavour: 'endeavor', endeavor: 'endeavour', armour: 'armor', armor: 'armour',
    saviour: 'savior', savior: 'saviour', glamour: 'glamor', glamor: 'glamour', centre: 'center', center: 'centre', metre: 'meter', meter: 'metre',
    litre: 'liter', liter: 'litre', theatre: 'theater', theater: 'theatre', fibre: 'fiber', fiber: 'fibre', calibre: 'caliber', caliber: 'calibre',
    spectre: 'specter', specter: 'spectre', sombre: 'somber', somber: 'sombre', lustre: 'luster', luster: 'lustre', meagre: 'meager', meager: 'meagre',
    defence: 'defense', defense: 'defence', offence: 'offense', offense: 'offence', licence: 'license', license: 'licence', pretence: 'pretense', pretense: 'pretence',
    practise: 'practice', practice: 'practise', grey: 'gray', gray: 'grey', tyre: 'tire', tire: 'tyre', kerb: 'curb', curb: 'kerb',
    plough: 'plow', plow: 'plough', mould: 'mold', mold: 'mould', smoulder: 'smolder', smolder: 'smoulder', sulphur: 'sulfur', sulfur: 'sulphur',
    draught: 'draft', draft: 'draught', cheque: 'check', check: 'cheque', pyjamas: 'pajamas', pajamas: 'pyjamas', sceptic: 'skeptic', skeptic: 'sceptic',
    sceptical: 'skeptical', skeptical: 'sceptical', ageing: 'aging', aging: 'ageing', artefact: 'artifact', artifact: 'artefact', cosy: 'cozy', cozy: 'cosy',
    doughnut: 'donut', donut: 'doughnut', yoghurt: 'yogurt', yogurt: 'yoghurt', jewellery: 'jewelry', jewelry: 'jewellery', aeroplane: 'airplane', airplane: 'aeroplane',
    aluminium: 'aluminum', aluminum: 'aluminium', manoeuvre: 'maneuver', maneuver: 'manoeuvre', anaemia: 'anemia', anemia: 'anaemia',
    anaesthesia: 'anesthesia', anesthesia: 'anaesthesia', paediatric: 'pediatric', pediatric: 'paediatric', encyclopaedia: 'encyclopedia', encyclopedia: 'encyclopaedia',
    archaeology: 'archeology', archeology: 'archaeology', foetus: 'fetus', fetus: 'foetus', oestrogen: 'estrogen', estrogen: 'oestrogen',
    diarrhoea: 'diarrhea', diarrhea: 'diarrhoea', oesophagus: 'esophagus', esophagus: 'oesophagus', leukaemia: 'leukemia', leukemia: 'leukaemia',
    catalogue: 'catalog', catalog: 'catalogue', dialogue: 'dialog', dialog: 'dialogue', analogue: 'analog', analog: 'analogue', programme: 'program', program: 'programme',
    travelled: 'traveled', traveled: 'travelled', travelling: 'traveling', traveling: 'travelling', traveller: 'traveler', traveler: 'traveller',
    cancelled: 'canceled', canceled: 'cancelled', labelled: 'labeled', labeled: 'labelled', modelled: 'modeled', modeled: 'modelled',
    counsellor: 'counselor', counselor: 'counsellor', marvellous: 'marvelous', marvelous: 'marvellous', skilful: 'skillful', skillful: 'skilful',
    fulfil: 'fulfill', fulfill: 'fulfil', fulfilment: 'fulfillment', fulfillment: 'fulfilment', enrolment: 'enrollment', enrollment: 'enrolment',
    judgement: 'judgment', judgment: 'judgement', analyse: 'analyze', analyze: 'analyse'
  };
  function spellingVariant(w) {
    if (SPELLING_EXACT[w]) return SPELLING_EXACT[w];
    if (/ised$/.test(w) && !ISE_SKIP[w.slice(0, -1)]) return w.slice(0, -4) + 'ized';
    if (/ized$/.test(w) && !ISE_SKIP[w.slice(0, -1)]) return w.slice(0, -4) + 'ised';
    if (/ising$/.test(w) && !ISE_SKIP[w.slice(0, -3) + 'e']) return w.slice(0, -5) + 'izing';
    if (/izing$/.test(w) && !ISE_SKIP[w.slice(0, -3) + 'e']) return w.slice(0, -5) + 'ising';
    if (/yse[ds]$/.test(w) || /ysing$/.test(w)) return w.replace(/yse/, 'yze').replace(/ysing$/, 'yzing');
    if (/yze[ds]$/.test(w) || /yzing$/.test(w)) return w.replace(/yze/, 'yse').replace(/yzing$/, 'ysing');
    if (/ise$/.test(w) && w.length > 5 && !ISE_SKIP[w]) return w.slice(0, -3) + 'ize';
    if (/ize$/.test(w) && w.length > 5 && !ISE_SKIP[w.slice(0, -3) + 'ise']) return w.slice(0, -3) + 'ise';
    if (/isation$/.test(w)) return w.slice(0, -7) + 'ization';
    if (/ization$/.test(w)) return w.slice(0, -7) + 'isation';
    if (/yse$/.test(w) && w.length > 5) return w.slice(0, -3) + 'yze';
    if (/yze$/.test(w) && w.length > 5) return w.slice(0, -3) + 'yse';
    if (/our$/.test(w) && w.length >= 6) return w.slice(0, -3) + 'or';
    return '';
  }
  // 句中单词的原形候选：先原词，再不规则屈折、常见规则屈折、比较级/最高级、-ly，以及英式/美式拼写。
  function wordCandidates(surface) {
    let w = String(surface || '').toLowerCase().replace(/[’']/g, "'").replace(/'s$/, '').replace(/'+$/g, '');
    const out = [];
    const add = s => { if (/^[a-z][a-z'-]{1,48}$/.test(s) && !out.includes(s)) out.push(s); };
    add(w);
    if (IRREGULAR[w]) add(IRREGULAR[w]);
    if (/ies$/.test(w) && w.length > 4) add(w.slice(0, -3) + 'y');
    if (/ied$/.test(w) && w.length > 4) add(w.slice(0, -3) + 'y');
    if (/ing$/.test(w) && w.length > 5) {
      add(w.slice(0, -3)); add(w.slice(0, -3) + 'e');
      if (w.length > 5 && w[w.length - 4] === w[w.length - 5]) add(w.slice(0, -4));
    }
    if (/ed$/.test(w) && w.length > 4) {
      add(w.slice(0, -1)); add(w.slice(0, -2));
      if (w.length > 4 && w[w.length - 3] === w[w.length - 4]) add(w.slice(0, -3));
    }
    if (/es$/.test(w) && w.length > 4) { add(w.slice(0, -2)); add(w.slice(0, -1)); }
    if (/s$/.test(w) && !/ss$/.test(w) && w.length > 3) add(w.slice(0, -1));
    if (w === 'lives') add('life');
    if (w === 'leaves') add('leaf');
    if (w === 'bases') add('basis');
    if (w === 'axes') add('axis');
    if (!SUFFIX_SKIP[w]) {
      if (/iest$/.test(w) && w.length > 5) add(w.slice(0, -4) + 'y');
      if (/ier$/.test(w) && w.length > 4) add(w.slice(0, -3) + 'y');
      if (/est$/.test(w) && w.length > 5) {
        if (w[w.length - 4] === w[w.length - 5]) add(w.slice(0, -4));
        if (w[w.length - 3] === 'e') add(w.slice(0, -2));
        if (w.length > 6) add(w.slice(0, -3));
      }
      if (/er$/.test(w) && w.length >= 5) {
        if (w[w.length - 3] === w[w.length - 4]) add(w.slice(0, -3));
        if (w[w.length - 2] === 'e') add(w.slice(0, -1));
        if (w.length > 5) add(w.slice(0, -2));
      }
      if (/ly$/.test(w) && w.length >= 5) {
        if (/ically$/.test(w)) add(w.slice(0, -4));
        if (/ily$/.test(w)) add(w.slice(0, -3) + 'y');
        const stem = w.slice(0, -2);
        if (stem.length >= 4) add(stem);
        if (stem.length >= 3 && /[^aeiou]$/.test(stem)) add(stem + 'e');
        if (/[^aeiou]ly$/.test(w)) add(w.slice(0, -1) + 'e');
      }
    }
    const base = out.slice();
    for (let i = 0; i < base.length; i++) add(spellingVariant(base[i]));
    return out;
  }
  function findInLists(cands, lists) {
    const want = Array.isArray(cands) ? cands : [];
    const books = Array.isArray(lists) ? lists : [];
    for (let i = 0; i < want.length; i++) {
      for (let j = 0; j < books.length; j++) {
        const list = books[j] || [];
        for (let k = 0; k < list.length; k++) {
          const x = list[k];
          if (x && x.word === want[i] && x.meaning) return x;
        }
      }
    }
    return null;
  }
  // 译文里 {目标词} 在作答前遮住，答完再揭开，避免例句填空被中文直接剧透。
  function maskExampleZh(zh) { return String(zh || '').replace(/\{([^{}]+)\}/g, '____'); }
  function revealExampleZh(zh) { return String(zh || '').replace(/\{([^{}]+)\}/g, '$1'); }
  function lemmaHint(meaning) {
    const m = /（\s*([A-Za-z][A-Za-z-]*)\s*的/.exec(String(meaning || ''));
    return m ? m[1].toLowerCase() : '';
  }
  function parseYoudaoEntry(data) {
    const block = data && data.ec && data.ec.word && data.ec.word[0];
    if (!block) return null;
    const phrase = block['return-phrase'] && block['return-phrase'].l && block['return-phrase'].l.i;
    const surface = String(phrase || data.input || '').trim().toLowerCase();
    if (!/^[a-z][a-z' .-]{0,48}$/.test(surface)) return null;
    const senses = [];
    for (const tr of block.trs || []) {
      const i = tr && tr.tr && tr.tr[0] && tr.tr[0].l && tr.tr[0].l.i;
      const line = String(Array.isArray(i) ? i[0] : (i || '')).trim();
      if (!line || /人名|【名】/.test(line)) continue;
      senses.push(line);
      if (senses.length >= 3) break;
    }
    if (!senses.length) return null;
    const posM = /^(n|v|vt|vi|adj|adv|prep|conj|pron|art|num|int|aux)\.\s*/i.exec(senses[0]);
    const posMap = { vt: 'v', vi: 'v' };
    const pos = posM ? (posMap[posM[1].toLowerCase()] || posM[1].toLowerCase()) + '.' : '';
    let meaning = senses.map(s => s.replace(/^(n|v|vt|vi|adj|adv|prep|conj|pron|art|num|int|aux)\.\s*/i, '')).filter(Boolean).join(' ');
    meaning = meaning.replace(/\s+/g, ' ').trim();
    if (meaning.length > 120) {
      const cut = meaning.slice(0, 120);
      const p = Math.max(cut.lastIndexOf('；'), cut.lastIndexOf('，'), cut.lastIndexOf(';'));
      meaning = (p > 30 ? cut.slice(0, p) : cut).trim();
    }
    if (!meaning) return null;
    let phone = block.ukphone || '';
    if (!phone && data.simple && data.simple.word && data.simple.word[0]) phone = data.simple.word[0].ukphone || '';
    const one = String(phone).split(/[;,]/)[0].trim().replace(/^\/|\/$/g, '');
    return { word: surface, ipa: one ? '/' + one + '/' : '', pos, meaning, examples: [] };
  }

  // 每日金句。英句按核对过的原句保存，不改写。同一天本地日历日永远同一句。
  const DAILY_QUOTES = [
    { en: "I'd love to stay and talk, but I just remembered I have to run away.", zh: '我很想留下来聊，但我突然想起我得逃走了。', source: '《破产姐妹》' },
    { en: "I don't cry. I sold my tear ducts to an organ bank for cash two years ago.", zh: '我不哭。两年前我就把泪腺卖给器官库套现了。', source: '《破产姐妹》' },
    { en: 'And one day, I will try lettuce, but not tonight.', zh: '总有一天我会试试生菜，但不是今晚。', source: '《破产姐妹》' }
  ];
  function dailyQuote(dayKey) {
    if (!/^(\d{4})-(\d{2})-(\d{2})$/.test(String(dayKey || ''))) throw new Error('bad day');
    const n = daysBetween('2026-01-01', dayKey);
    const i = ((n % DAILY_QUOTES.length) + DAILY_QUOTES.length) % DAILY_QUOTES.length;
    return { index: i, en: DAILY_QUOTES[i].en, zh: DAILY_QUOTES[i].zh, source: DAILY_QUOTES[i].source };
  }

  function toSimplified(text) {
    const map = root.VocabT2S;
    const s = String(text || '');
    if (!map) return s;
    let out = '';
    for (const ch of s) out += map[ch] || ch;
    return out;
  }
  function englishSection(wt) {
    const lines = String(wt || '').split('\n');
    let start = -1;
    for (let i = 0; i < lines.length; i++) if (/^==\s*English\s*==\s*$/.test(lines[i])) { start = i + 1; break; }
    if (start < 0) return '';
    let end = lines.length;
    for (let i = start; i < lines.length; i++) if (/^==[^=]/.test(lines[i])) { end = i; break; }
    return lines.slice(start, end).join('\n');
  }
  function ukIpa(section) {
    const pm = /===Pronunciation===([\s\S]*?)(?:\n===|$)/.exec(section);
    const block = pm ? pm[1] : '';
    const lines = block.split('\n');
    let accent = '';
    const tagged = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const am = /\{\{a\|([^}]+)\}\}/.exec(line);
      if (am) accent = am[1];
      const re = /\{\{IPA\|en\|([^}]+)\}\}/g;
      let m;
      while ((m = re.exec(line))) {
        const parts = m[1].split('|');
        const phone = (parts.find(p => /^\//.test(p)) || '').trim();
        const a = ((parts.find(p => /^a=/.test(p)) || '').slice(2)) || accent;
        if (phone) tagged.push({ phone, a });
      }
    }
    const uk = tagged.find(t => /UK|RP|GB|Britain|Commonwealth/i.test(t.a));
    const phone = (uk || tagged[0] || {}).phone || '';
    const one = phone.replace(/^\/|\/$/g, '').split(/[;,]/)[0].trim();
    return one ? '/' + one + '/' : '';
  }
  const POS_CODE = { noun: 'n.', verb: 'v.', adjective: 'adj.', adverb: 'adv.', preposition: 'prep.', conjunction: 'conj.', pronoun: 'pron.', article: 'art.', numeral: 'num.', interjection: 'int.', determiner: 'det.', particle: 'part.', 'proper noun': 'n.' };
  function mandarinGlosses(section) {
    const lines = section.split('\n');
    let pos = '', batch = [], best = null, subpage = false;
    const flush = () => { if (batch.length && !best) best = { pos, glosses: batch.slice(0, 3) }; batch = []; };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const h = /^(={3,6})\s*([^=]+?)\s*\1$/.exec(line);
      if (h) {
        const name = h[2].trim().toLowerCase();
        if (POS_CODE[name]) { flush(); pos = name; }
        continue;
      }
      if (/\{\{see translation subpage\|/.test(line) && !best && !batch.length) { subpage = true; continue; }
      if (subpage || !/Mandarin/.test(line) || /\{\{(?:not used|t-needed)\|cmn\}\}/.test(line)) continue;
      const re = /\{\{t{1,2}\+?\|cmn\|([^}|]+)(?:\|([^}]*))?\}\}/g;
      let m;
      while ((m = re.exec(line))) {
        let gloss = m[1].trim();
        const alt = /(?:^|\|)alt=([^|}]+)/.exec(m[2] || '');
        if (alt) gloss = alt[1].trim();
        gloss = toSimplified(gloss.replace(/\[\[([^|\]]+\|)?([^\]]+)\]\]/g, '$2').replace(/[{}]/g, '')).replace(/\s+/g, '');
        if (!gloss || !/[\u3400-\u9fff]/.test(gloss) || /[….]{2,}/.test(gloss) || gloss.length > 12) continue;
        if (!batch.includes(gloss)) batch.push(gloss);
      }
    }
    flush();
    if (best) return best;
    return subpage ? { pos: '', glosses: [], subpage: true } : null;
  }
  function formLemmas(section) {
    const lemmas = [];
    const add = s => { s = String(s || '').replace(/\[\[|\]\]/g, '').trim().toLowerCase(); if (/^[a-z][a-z'-]{1,48}$/.test(s) && !lemmas.includes(s)) lemmas.push(s); };
    const lines = section.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/^#\s+\{\{/.test(line)) continue;
      let m;
      const reEn = /\{\{en-(?:comparative|superlative|simple past|past|past participle|present participle) of\|([^}|]+)/g;
      while ((m = reEn.exec(line))) add(m[1]);
      const reInfl = /\{\{infl of\|en\|([^}|]+)/g;
      while ((m = reInfl.exec(line))) add(m[1]);
      const reOf = /\{\{(?:plural|comparative|superlative|past tense|past participle|present participle|gerund|alternative spelling|standard spelling) of\|en\|([^}]+)\}\}/g;
      while ((m = reOf.exec(line))) {
        const parts = m[1].split('|').map(s => s.trim()).filter(s => s && !/=/.test(s));
        if (parts.length) add(parts[parts.length - 1]);
      }
    }
    return lemmas;
  }
  // 英文维基词典 parse API 的 JSON。有道 jsonapi 对 GitHub Pages 的 Origin 返回 403，不能在页面里直连。
  function parseWiktionaryEntry(data) {
    if (!data || data.error || !data.parse) return null;
    const wt = data.parse.wikitext && data.parse.wikitext['*'];
    if (!wt) return null;
    const section = englishSection(wt);
    if (!section) return null;
    let title = String(data.parse.title || '').trim().toLowerCase();
    if (title.indexOf('/') >= 0) title = title.split('/')[0];
    const ipa = ukIpa(section);
    const lemmas = formLemmas(section);
    const gloss = mandarinGlosses(section);
    const base = { ipa, lemmas, word: title };
    if (gloss && gloss.subpage && (!gloss.glosses || !gloss.glosses.length)) return Object.assign(base, { subpage: true });
    if (!gloss || !gloss.glosses.length) return lemmas.length ? base : null;
    if (!/^[a-z][a-z' .-]{0,48}$/.test(title)) return lemmas.length ? base : null;
    const pos = POS_CODE[gloss.pos] || '';
    let meaning = gloss.glosses.join('；');
    if (meaning.length > 120) meaning = meaning.slice(0, 120);
    return { word: title, ipa, pos, meaning, examples: [], lemmas };
  }
  function classifyLookupError(err, onLine) {
    const name = err && err.name || '';
    const msg = String(err && (err.message || err.reason) || '');
    if (name === 'AbortError' || (err && err.kind === 'timeout') || /abort|timeout/i.test(msg)) return 'timeout';
    if (onLine === false || (err && err.kind === 'offline')) return 'offline';
    return 'http';
  }
  function lookupFailureMessage(kind, word) {
    const w = String(word || '');
    if (kind === 'offline') return '没网，查不了「' + w + '」。请联网后再试';
    if (kind === 'timeout') return '查询「' + w + '」超时，请稍后再试';
    if (kind === 'http') return '词典请求失败，没能查询「' + w + '」，请稍后再试';
    return '没有找到「' + w + '」的中文释义';
  }
  // 键盘挡住布局视口底部的高度。offsetTop 是 iOS 为了露出光标而上移可视视口的平移，
  // 减进去会把键盘高度算成 0。平移时保持 keyboard = layout - visual；
  // 布局高度短暂追上可视高度（innerHeight 与 vv.height 同帧）时，沿用 held。
  function imeBottom(layoutHeight, viewportHeight, offsetTop, held) {
    const layout = Number(layoutHeight);
    const view = Number(viewportHeight);
    const pan = Number(offsetTop);
    const keyboard = (Number.isFinite(layout) ? layout : 0) - (Number.isFinite(view) ? view : 0);
    const occluded = keyboard - (Number.isFinite(pan) && pan > 0 ? pan : 0);
    let inset = keyboard > 0 && pan > 0 && occluded < keyboard ? keyboard : occluded;
    if (!(inset > 0)) {
      const keep = Number(held);
      if (keep > 0) inset = keep;
    }
    return inset > 0 ? inset : 0;
  }

  // 词根词缀：用 Etymoasis（CC BY-SA 4.0）开放数据做保守切分。匹配器为原创，不复制其网站代码。
  // 对不上的词不展示、不编造。no-split 词一律不切。长度不足 7 的词只采数据里已核对的例词。
  var ETYM_VOWELS = 'aeiou';

  function etymologyData(data) {
    if (data) return data;
    var root = typeof globalThis !== 'undefined' ? globalThis : null;
    return root && root.DOGVERB_ETYMOLOGY ? root.DOGVERB_ETYMOLOGY : null;
  }

  function foldEtymon(s) {
    s = String(s || '').toLowerCase().trim();
    try { s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
    return s.replace(/[^a-z ]/g, '');
  }

  function etymonVariants(word) {
    var w = foldEtymon(word);
    var cands = [w, w.replace(/ /g, '')];
    if (w.indexOf(' ') !== -1) {
      w.split(/\s+/).forEach(function (tok) { if (tok.length >= 4) cands.push(tok); });
    }
    var more = [];
    cands.forEach(function (c) {
      if (c.slice(-3) === 'ise') more.push(c.slice(0, -3) + 'ize');
      if (c.slice(-3) === 'ize') more.push(c.slice(0, -3) + 'ise');
      if (c.slice(-3) === 'yse') more.push(c.slice(0, -3) + 'yze');
      if (c.slice(-3) === 'yze') more.push(c.slice(0, -3) + 'yse');
      if (c.slice(-7) === 'isation') more.push(c.slice(0, -7) + 'ization');
      if (c.slice(-7) === 'ization') more.push(c.slice(0, -7) + 'isation');
      if (c.indexOf('our') !== -1) more.push(c.replace(/our/g, 'or'));
      if (c.length > 4 && c.slice(-2) === 're' && 'aeiou'.indexOf(c.charAt(c.length - 3)) === -1) more.push(c.slice(0, -2) + 'er');
      if (c.indexOf('ae') !== -1) more.push(c.replace(/ae/g, 'e'));
      if (c.indexOf('oe') !== -1) more.push(c.replace(/oe/g, 'e'));
    });
    var seen = Object.create(null), out = [];
    cands.concat(more).forEach(function (x) {
      if (x && !seen[x]) { seen[x] = 1; out.push(x); }
    });
    return out;
  }

  function langZhOf(lang) {
    if (lang === 'Latin') return '拉丁';
    if (lang === 'Greek') return '希腊';
    return lang || '';
  }

  function displayForm(kind, form) {
    if (kind === 'prefix') return form.slice(-1) === '-' ? form : form + '-';
    if (kind === 'suffix') return form.charAt(0) === '-' ? form : '-' + form;
    return form;
  }

  function peersForForm(idx, kind, form) {
    var list = kind === 'prefix' ? idx.prefixes : kind === 'suffix' ? idx.suffixes : idx.roots;
    var peers = [];
    for (var i = 0; i < list.length; i++) {
      var forms = list[i].forms || [];
      for (var j = 0; j < forms.length; j++) {
        if (forms[j][0] === form) { peers.push(list[i]); break; }
      }
    }
    return peers;
  }

  function stripSenseTag(label) {
    return String(label || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  }

  function toPart(e, form, idx, merge) {
    var meaning = e.meaning, meaningZh = e.meaningZh || e.meaning, label = e.label;
    if (merge && idx) {
      var peers = peersForForm(idx, e.kind, form);
      if (peers.length > 1) {
        var meanings = [], meaningsZh = [], labels = [], seen = Object.create(null);
        for (var i = 0; i < peers.length; i++) {
          var p = peers[i];
          if (p.meaning && meanings.indexOf(p.meaning) === -1) meanings.push(p.meaning);
          var zh = p.meaningZh || p.meaning;
          if (zh && meaningsZh.indexOf(zh) === -1) meaningsZh.push(zh);
          var lab = stripSenseTag(p.label) || p.label;
          if (lab && !seen[lab]) { seen[lab] = 1; labels.push(lab); }
        }
        meaning = meanings.join('; ');
        meaningZh = meaningsZh.join('；');
        if (labels.length) label = labels[0];
      }
    }
    return {
      id: e.id,
      kind: e.kind,
      form: form,
      display: displayForm(e.kind, form),
      label: label,
      meaning: meaning,
      meaningZh: meaningZh,
      lang: e.lang || '',
      langZh: langZhOf(e.lang)
    };
  }

  function withKind(list, kind) {
    return (list || []).map(function (e) {
      return {
        id: e.id,
        kind: kind,
        label: e.label,
        meaning: e.meaning,
        meaningZh: e.meaningZh,
        lang: e.lang,
        forms: e.forms || []
      };
    });
  }

  function etymologyIndex(data) {
    if (data._dogverbIndex) return data._dogverbIndex;
    var prefixes = withKind(data.prefixes, 'prefix');
    var roots = withKind(data.roots, 'root');
    var suffixes = withKind(data.suffixes, 'suffix');
    var byId = Object.create(null);
    prefixes.concat(roots, suffixes).forEach(function (e) { byId[e.id] = e; });
    var noSplit = Object.create(null);
    (data.noSplit || []).forEach(function (w) { noSplit[w] = 1; });
    var rootIndex = Object.create(null);
    roots.forEach(function (e) {
      (e.forms || []).forEach(function (f) {
        var spell = f[0];
        if (!spell || spell.length < 3) return;
        var key = spell.slice(0, 3);
        (rootIndex[key] || (rootIndex[key] = [])).push({ e: e, spell: spell, nxt: f[1] || '' });
      });
    });
    data._dogverbIndex = {
      prefixes: prefixes,
      roots: roots,
      suffixes: suffixes,
      byId: byId,
      noSplit: noSplit,
      rootIndex: rootIndex,
      examples: data.examples || {}
    };
    return data._dogverbIndex;
  }

  function prefixHits(prefixes, word, at) {
    var hits = [];
    for (var i = 0; i < prefixes.length; i++) {
      var e = prefixes[i], forms = e.forms || [];
      for (var j = 0; j < forms.length; j++) {
        var spell = forms[j][0], nxt = forms[j][1] || '';
        if (!spell || word.slice(at, at + spell.length) !== spell) continue;
        var end = at + spell.length;
        if (nxt && (end >= word.length || nxt.indexOf(word.charAt(end)) === -1)) continue;
        hits.push({ e: e, spell: spell, end: end });
      }
    }
    hits.sort(function (a, b) { return b.spell.length - a.spell.length; });
    return hits;
  }

  function suffixHits(suffixes, s) {
    var hits = [];
    for (var i = 0; i < suffixes.length; i++) {
      var e = suffixes[i], forms = e.forms || [];
      for (var j = 0; j < forms.length; j++) {
        var spell = forms[j][0];
        if (!spell || spell.length >= s.length) continue;
        if (s.slice(-spell.length) !== spell) continue;
        hits.push({ e: e, spell: spell });
      }
    }
    hits.sort(function (a, b) { return b.spell.length - a.spell.length; });
    return hits;
  }

  function rootsAt(idx, s, at) {
    var list = idx.rootIndex[s.slice(at, at + 3)] || [];
    var hits = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (s.slice(at, at + item.spell.length) !== item.spell) continue;
      var end = at + item.spell.length;
      if (item.nxt && end < s.length && item.nxt.indexOf(s.charAt(end)) === -1) continue;
      hits.push({ e: item.e, spell: item.spell, end: end });
    }
    hits.sort(function (a, b) { return b.spell.length - a.spell.length; });
    return hits;
  }

  function suffixesFrom(idx, s) {
    var out = [{ rest: s, sufs: [] }];
    var hits = suffixHits(idx.suffixes, s);
    for (var i = 0; i < hits.length; i++) {
      var h = hits[i];
      if (h.spell.length === 1 && s.length < 8) continue;
      var rest = s.slice(0, s.length - h.spell.length);
      if (!rest) continue;
      out.push({ rest: rest, sufs: [h] });
      var hits2 = suffixHits(idx.suffixes, rest);
      for (var k = 0; k < hits2.length; k++) {
        var h2 = hits2[k];
        if (h2.spell.length === 1) continue;
        var rest2 = rest.slice(0, rest.length - h2.spell.length);
        if (rest2) out.push({ rest: rest2, sufs: [h2, h] });
      }
    }
    return out;
  }

  function isVowel(ch) { return ETYM_VOWELS.indexOf(ch) !== -1; }

  function rootsCover(idx, s) {
    var found = [];
    function push(parts, end) {
      if (end === s.length) found.push(parts);
    }
    function extendFrom(parts, at) {
      var hits = rootsAt(idx, s, at);
      for (var i = 0; i < hits.length; i++) {
        var h = hits[i];
        var next = parts.concat([{ e: h.e, spell: h.spell }]);
        push(next, h.end);
        if (h.end === s.length - 1 && isVowel(s.charAt(h.end))) {
          push(next.concat([{ e: 'vowel', spell: s.charAt(h.end) }]), s.length);
        }
        if (h.end < s.length && isVowel(s.charAt(h.end))) {
          var afterV = rootsAt(idx, s, h.end + 1);
          for (var j = 0; j < afterV.length; j++) {
            var h2 = afterV[j];
            var two = next.concat([{ e: 'vowel', spell: s.charAt(h.end) }, { e: h2.e, spell: h2.spell }]);
            push(two, h2.end);
            if (h2.end === s.length - 1 && isVowel(s.charAt(h2.end))) {
              push(two.concat([{ e: 'vowel', spell: s.charAt(h2.end) }]), s.length);
            }
          }
        }
        var direct = rootsAt(idx, s, h.end);
        for (var d = 0; d < direct.length; d++) {
          var hd = direct[d];
          push(next.concat([{ e: hd.e, spell: hd.spell }]), hd.end);
        }
      }
    }
    extendFrom([], 0);
    if (s && isVowel(s.charAt(0))) extendFrom([{ e: 'vowel', spell: s.charAt(0) }], 1);
    return found;
  }

  function patternOk(parts) {
    var roots = [], affixes = [], i;
    for (i = 0; i < parts.length; i++) {
      if (parts[i].kind === 'root') roots.push(parts[i]);
      else affixes.push(parts[i]);
    }
    if (!roots.length) return false;
    for (i = 0; i < roots.length; i++) if (roots[i].form.length < 3) return false;
    if (roots.length >= 2) {
      for (i = 0; i < roots.length; i++) if (roots[i].form.length < 4) return false;
    }
    var weak = 0, strong = 0, hasPrefix2 = false, hasSuffix4 = false;
    for (i = 0; i < affixes.length; i++) {
      var n = affixes[i].form.length;
      if (n <= 2) weak++;
      if (n >= 3) strong++;
      if (affixes[i].kind === 'prefix' && n >= 2) hasPrefix2 = true;
      if (n >= 4) hasSuffix4 = true;
    }
    var minRoot = roots[0].form.length;
    for (i = 1; i < roots.length; i++) if (roots[i].form.length < minRoot) minRoot = roots[i].form.length;
    if (minRoot === 3 && !hasPrefix2 && !hasSuffix4) return false;
    if (weak >= 2 && !strong) return false;
    return true;
  }

  function greedyPattern(idx, word) {
    if (word.length < 7) return null;
    var best = null, bestScore = null;
    var prefixOpts = [{ pos: 0, pfx: [] }];
    var hits = prefixHits(idx.prefixes, word, 0);
    for (var i = 0; i < hits.length; i++) {
      var h = hits[i];
      if (h.spell.length === 1 && word.length < 8) continue;
      prefixOpts.push({ pos: h.end, pfx: [h] });
      var hits2 = prefixHits(idx.prefixes, word, h.end);
      for (var k = 0; k < hits2.length; k++) {
        var h2 = hits2[k];
        if (h2.spell.length < 2) continue;
        prefixOpts.push({ pos: h2.end, pfx: [h, h2] });
      }
    }
    for (var p = 0; p < prefixOpts.length; p++) {
      var opt = prefixOpts[p];
      var mid = word.slice(opt.pos);
      if (!mid) continue;
      var sufOpts = suffixesFrom(idx, mid);
      for (var s = 0; s < sufOpts.length; s++) {
        var so = sufOpts[s];
        if (so.rest.length < 3) continue;
        var covers = rootsCover(idx, so.rest);
        for (var r = 0; r < covers.length; r++) {
          var roots = covers[r];
          var built = '';
          var raw = opt.pfx.concat(roots, so.sufs);
          for (var b = 0; b < raw.length; b++) built += raw[b].spell;
          if (built !== word) continue;
          var parts = [];
          for (var t = 0; t < raw.length; t++) {
            if (raw[t].e === 'vowel') continue;
            parts.push(toPart(raw[t].e, raw[t].spell, idx, true));
          }
          if (!patternOk(parts)) continue;
          var letters = 0;
          for (var L = 0; L < parts.length; L++) letters += parts[L].form.length;
          var score = letters * 10 - parts.length;
          if (bestScore === null || score > bestScore) {
            bestScore = score;
            best = { word: word, checked: false, parts: parts };
          }
        }
      }
    }
    return best;
  }

  function placeExample(idx, word) {
    var ids = idx.examples[word];
    if (!ids || !ids.length) return null;
    var placed = [];
    var seen = Object.create(null);
    for (var i = 0; i < ids.length; i++) {
      var e = idx.byId[ids[i]];
      if (!e || seen[e.id]) continue;
      seen[e.id] = 1;
      var best = null, forms = e.forms || [], f, spell, nxt, pos;
      if (e.kind === 'prefix') {
        for (f = 0; f < forms.length; f++) {
          spell = forms[f][0]; nxt = forms[f][1] || '';
          if (word.slice(0, spell.length) === spell && (!nxt || (spell.length < word.length && nxt.indexOf(word.charAt(spell.length)) !== -1))) {
            best = { start: 0, spell: spell };
            break;
          }
        }
      }
      if (!best && e.kind === 'suffix') {
        for (f = 0; f < forms.length; f++) {
          spell = forms[f][0];
          if (spell.length < word.length && word.slice(-spell.length) === spell) {
            best = { start: word.length - spell.length, spell: spell };
            break;
          }
        }
      }
      if (!best) {
        var ordered = forms.slice().sort(function (a, b) { return b[0].length - a[0].length; });
        for (f = 0; f < ordered.length; f++) {
          spell = ordered[f][0];
          pos = word.indexOf(spell);
          if (pos !== -1) { best = { start: pos, spell: spell }; break; }
        }
      }
      if (best) placed.push({ start: best.start, end: best.start + best.spell.length, e: e, spell: best.spell });
    }
    if (!placed.length) return null;
    var onlySuffix = true;
    for (i = 0; i < placed.length; i++) if (placed[i].e.kind !== 'suffix') onlySuffix = false;
    if (onlySuffix && word.length < 8) return null;
    placed.sort(function (a, b) { return a.start - b.start; });
    return completeExample(idx, word, placed);
  }

  function completeExample(idx, word, placed) {
    var first = placed[0], last = placed[placed.length - 1], i;
    if (first.start > 0) {
      var pHits = prefixHits(idx.prefixes, word, 0);
      for (i = 0; i < pHits.length; i++) {
        if (pHits[i].end === first.start) {
          placed.unshift({ start: 0, end: pHits[i].end, e: pHits[i].e, spell: pHits[i].spell, filled: true });
          break;
        }
      }
    }
    last = placed[placed.length - 1];
    if (last.end < word.length) {
      var gap = word.slice(last.end);
      var suffixes = idx.suffixes;
      var found = false;
      for (var s = 0; s < suffixes.length && !found; s++) {
        var forms = suffixes[s].forms || [];
        for (var f = 0; f < forms.length; f++) {
          if (forms[f][0] === gap) {
            placed.push({ start: last.end, end: word.length, e: suffixes[s], spell: gap, filled: true });
            found = true;
            break;
          }
        }
      }
    }
    placed.sort(function (a, b) { return a.start - b.start; });
    var parts = [];
    var checked = true;
    for (i = 0; i < placed.length; i++) {
      if (placed[i].filled) checked = false;
      parts.push(toPart(placed[i].e, placed[i].spell, idx, !!placed[i].filled));
    }
    return { word: word, checked: checked, parts: parts };
  }

  function wrapEtymon(data, hit) {
    if (!hit || !hit.parts || !hit.parts.length) return null;
    return {
      word: hit.word,
      checked: !!hit.checked,
      attribution: data.attribution || 'Etymoasis，数据来自维基词典贡献者，CC BY-SA 4.0',
      license: data.license || 'CC BY-SA 4.0',
      licenseUrl: data.licenseUrl || 'https://creativecommons.org/licenses/by-sa/4.0/',
      source: data.source || 'https://etymoasis.me/',
      parts: hit.parts
    };
  }

  function etymologyOf(word, data) {
    data = etymologyData(data);
    if (!data || !word) return null;
    var idx = etymologyIndex(data);
    var vars = etymonVariants(word);
    var i, w, hit;
    for (i = 0; i < vars.length; i++) {
      w = vars[i];
      if (idx.noSplit[w]) return null;
      hit = placeExample(idx, w);
      if (hit) return wrapEtymon(data, hit);
    }
    for (i = 0; i < vars.length; i++) {
      w = vars[i];
      if (idx.noSplit[w] || w.length < 2) continue;
      hit = greedyPattern(idx, w);
      if (hit) return wrapEtymon(data, hit);
    }
    return null;
  }

  // 高频义项结果表。没有行的词不拆、不标。排序只看 is_high_freq，然后按原来的 idx。
  // freq_score 随表保存，不参与排序。source 只接受 manual 或 corpus。
  function sensesTable(data) {
    if (data) return data;
    var g = typeof globalThis !== 'undefined' ? globalThis : root;
    if (g && g.DOGVERB_SENSES) return g.DOGVERB_SENSES;
    return root && root.DOGVERB_SENSES ? root.DOGVERB_SENSES : null;
  }

  function senseWord(word) {
    return String(word || '').toLowerCase().trim();
  }

  function senseRows(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.rows)) return data.rows;
    return [];
  }

  function normalizeSense(row) {
    if (!row || typeof row !== 'object') return null;
    var word = senseWord(row.word);
    var gloss = String(row.gloss == null ? '' : row.gloss).trim();
    var idx = Number(row.idx);
    var source = row.source === 'manual' || row.source === 'corpus' ? row.source : '';
    if (!word || !gloss || !Number.isFinite(idx) || !source) return null;
    var score = Number(row.freq_score);
    return {
      word: word,
      pos: String(row.pos == null ? '' : row.pos),
      idx: idx,
      gloss: gloss,
      is_high_freq: row.is_high_freq === true,
      freq_score: Number.isFinite(score) ? score : 0,
      source: source
    };
  }

  function sortSenses(rows) {
    return (rows || []).map(function (r, i) { return { r: r, i: i }; }).sort(function (a, b) {
      var ah = a.r && a.r.is_high_freq === true ? 1 : 0;
      var bh = b.r && b.r.is_high_freq === true ? 1 : 0;
      if (ah !== bh) return bh - ah;
      var ai = Number(a.r && a.r.idx);
      var bi = Number(b.r && b.r.idx);
      if (ai !== bi) return ai - bi;
      return a.i - b.i;
    }).map(function (x) { return x.r; });
  }

  function sensesOf(word, data) {
    var key = senseWord(word);
    if (!key) return [];
    var out = [];
    senseRows(sensesTable(data)).forEach(function (row) {
      var n = normalizeSense(row);
      if (n && n.word === key) out.push(n);
    });
    return sortSenses(out);
  }

  const api = { MIN, DAY, MASTER_DAYS, Rating, RATING_LABELS, State: F.State, V1_INTERVALS, dayKey, daysBetween, shiftDay, emptyCard, learnCard, isDue, grade, markKnown, preview, fmtInterval, intervalDays, migrateCard, migrate, audioUrl, pickVoice, streak, monthGrid, dailyQuote, findForm, makeCloze, hasExample, norm, answerMatch, dictationMatch, learnDictationKind, followPress, followView, checkSentence, foxLevel, foxAge, foxStage, foxMood, applyHunger, feed, shuffle, HUNGER_PER_DAY, wordCandidates, findInLists, maskExampleZh, revealExampleZh, lemmaHint, parseYoudaoEntry, parseWiktionaryEntry, classifyLookupError, lookupFailureMessage, imeBottom, etymologyOf, sensesOf, sortSenses };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VocabCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
