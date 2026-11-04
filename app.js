(function () {
  const C = window.VocabCore, KEY = 'foxVocab.v2', OLD_KEY = 'foxVocab.v1', BACKUP_KEY = 'foxVocab.v1.backup';
  const INDEX = window.VOCAB_BOOK_INDEX || [];
  const LOADED = {}; // id -> book
  window.__registerBook = b => { LOADED[b.id] = b; };
  const $app = document.getElementById('app');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => Date.now(), today = () => C.dayKey(now());

  // ---------- 词书按需加载 ----------
  const pending = {};
  function defaultLoader(file) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = file; s.onload = res; s.onerror = () => rej(new Error('load ' + file)); document.head.appendChild(s); }); }
  function customOf(id) { return (S.customBooks || []).find(b => b.id === id); }
  function asCustomBook(c) { return { id: c.id, name: c.name, description: c.description || '自定义词书', words: c.words, custom: true }; }
  function loadBook(id) {
    const custom = customOf(id);
    if (custom) return Promise.resolve(asCustomBook(custom));
    if (LOADED[id]) return Promise.resolve(LOADED[id]);
    const meta = INDEX.find(b => b.id === id) || INDEX[0];
    if (LOADED[meta.id]) return Promise.resolve(LOADED[meta.id]);
    if (!pending[meta.id]) pending[meta.id] = (window.__bookLoader || defaultLoader)(meta.file).then(() => { if (!LOADED[meta.id]) throw new Error('book missing'); return LOADED[meta.id]; }).finally(() => delete pending[meta.id]);
    return pending[meta.id];
  }
  window.__loadedBooks = () => Object.keys(LOADED);

  // ---------- 存储 ----------
  function defaultState() {
    return { v: 2, bookId: INDEX[0] && INDEX[0].id, settings: { dailyNew: 20, autoPlay: true }, books: {}, customBooks: [], days: {}, studyDays: [],
      fox: { food: 0, xp: 0, hunger: 80, lastCheck: today(), fed: 0, name: '小狗' } };
  }
  function normalize(s) {
    const d = defaultState(); const o = Object.assign(d, s);
    o.settings = Object.assign(defaultState().settings, s.settings || {});
    o.fox = Object.assign(defaultState().fox, s.fox || {});
    if (o.fox.name === '小狐') o.fox.name = '小狗';
    o.customBooks = (Array.isArray(s.customBooks) ? s.customBooks : []).map(normalizeCustom).filter(Boolean);
    const known = INDEX.some(b => b.id === o.bookId) || o.customBooks.some(b => b.id === o.bookId);
    if (!known) o.bookId = d.bookId;
    return o;
  }
  function normalizeCustom(b) {
    if (!b || typeof b !== 'object') return null;
    const id = String(b.id || '');
    if (!/^custom-[a-z0-9-]{4,}$/i.test(id)) return null;
    const seen = new Set(); const words = [];
    for (const raw of b.words || []) {
      const src = typeof raw === 'string' ? { word: raw } : (raw || {});
      const word = String(src.word || '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (!/^[a-z][a-z' .-]{0,48}$/.test(word) || seen.has(word)) continue;
      seen.add(word);
      words.push({ word, ipa: String(src.ipa || ''), pos: String(src.pos || ''), meaning: String(src.meaning || '').slice(0, 120), examples: Array.isArray(src.examples) ? src.examples.map(String).filter(Boolean).slice(0, 3) : [] });
    }
    return { id, name: String(b.name || '我的词书').trim().slice(0, 40) || '我的词书', description: '自定义词书', words };
  }
  function parseWordList(text) {
    const out = [];
    for (let line of String(text || '').split(/\r?\n/)) {
      line = line.trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) continue;
      line = line.replace(/^\d+[\.\)、:：]\s*/, '');
      let word = '', meaning = '';
      const parts = line.split(/\t|\s*[|｜]\s*|\s+[-—–:：]\s+/);
      if (parts.length >= 2 && /^[A-Za-z]/.test(parts[0])) { word = parts[0]; meaning = parts.slice(1).join(' '); }
      else {
        const m = line.match(/^([A-Za-z][A-Za-z' .-]*?)(?:\s{2,}|\s+)([\u4e00-\u9fff].*)$/);
        if (m) { word = m[1]; meaning = m[2]; } else word = line;
      }
      out.push({ word, meaning: meaning.trim() });
    }
    return out;
  }
  function newCustomId() { return 'custom-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function syncCurrentBook() { const c = customOf(S.bookId); if (c && BOOK && BOOK.custom) BOOK = asCustomBook(c); }
  function load() {
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.v === 2) return normalize(s); } catch (e) { }
    try {
      const raw = localStorage.getItem(OLD_KEY);
      if (raw) { const old = JSON.parse(raw); if (old && old.v === 1) { if (!localStorage.getItem(BACKUP_KEY)) localStorage.setItem(BACKUP_KEY, raw); const s = normalize(C.migrate(old)); localStorage.setItem(KEY, JSON.stringify(s)); return s; } }
    } catch (e) { console.error('migration failed', e); }
    return defaultState();
  }
  let S = load();
  function save() { localStorage.setItem(KEY, JSON.stringify(S)); }
  let BOOK = null;
  const book = () => BOOK;
  function bs() { const id = BOOK.id; if (!S.books[id]) S.books[id] = { cards: {}, sentences: {} }; return S.books[id]; }
  function cards() { return bs().cards; }
  function dayStat(k) { k = k || today(); if (!S.days[k]) S.days[k] = { new: 0, review: 0, correct: 0, wrong: 0 }; return S.days[k]; }
  function markStudied() { const k = today(); if (!S.studyDays.includes(k)) S.studyDays.push(k); }
  S.fox = C.applyHunger(S.fox, S.studyDays, today()); save();

  const W = () => BOOK.words;
  const byWord = w => W().find(x => x.word === w);
  const learned = () => W().filter(w => cards()[w.word]);
  const unlearned = () => W().filter(w => !cards()[w.word]);
  const dueList = () => { const cs = cards(), t = now(); return W().filter(w => C.isDue(cs[w.word], t)).sort((a, b) => cs[a.word].due - cs[b.word].due); };
  const masteredCount = () => { const cs = cards(); return W().filter(w => cs[w.word] && cs[w.word].mastered).length; };
  const newLeftToday = () => Math.max(0, S.settings.dailyNew - dayStat().new);

  // ---------- 英音发音：有道 type=1，失败时用 en-GB 语音合成 ----------
  let lastAudio = null;
  function tts(word) {
    if (!('speechSynthesis' in window)) return false;
    try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(word); u.lang = 'en-GB'; const v = C.pickVoice(speechSynthesis.getVoices()); if (v) u.voice = v; u.rate = 0.9; speechSynthesis.speak(u); return true; } catch (e) { return false; }
  }
  function speak(word) {
    window.__lastSpoken = { word, url: C.audioUrl(word) };
    try {
      if (lastAudio) lastAudio.pause();
      const a = new Audio(C.audioUrl(word)); lastAudio = a; let fell = false;
      const fb = () => { if (!fell) { fell = true; tts(word); } };
      a.onerror = fb; const p = a.play(); if (p && p.catch) p.catch(fb);
      return true;
    } catch (e) { return tts(word); }
  }
  window.__speak = speak;
  const auto = w => { if (S.settings.autoPlay) setTimeout(() => speak(w), 150); };
  const sayBtn = w => `<button class="say" onclick="event.stopPropagation();__speak('${esc(w)}')" title="英音发音" aria-label="英音发音">🔊</button>`;

  // 记录答题，喂给 FSRS
  function record(w, rating) {
    if (typeof rating === 'boolean') rating = rating ? C.Rating.Good : C.Rating.Again;
    const cs = cards(); const card = cs[w.word]; let msg = '';
    const d = dayStat(); rating > 1 ? d.correct++ : d.wrong++; markStudied();
    if (!card) { save(); return '（未学词，不计入复习计划）'; }
    const wasDue = C.isDue(card, now());
    const r = C.grade(card, rating, now()); cs[w.word] = r.card;
    if (wasDue) d.review++;
    const nxt = '下次复习：' + C.fmtInterval(r.card.due - now()) + '后';
    if (r.event === 'advance') { if (r.card.scheduled_days >= 1) { S.fox.food += 1; msg = '复习成功，获得 1 份狗粮 🦴；'; } msg += nxt; }
    else if (r.event === 'mastered') { S.fox.food += 5; msg = '🎉 已掌握（复习间隔 ≥ ' + C.MASTER_DAYS + ' 天）！获得 5 份狗粮 🦴；' + nxt; }
    else if (r.event === 'lapse') msg = '答错了，记忆强度下调：' + nxt;
    else msg = '（未到复习时间的额外练习，不改变复习计划）';
    save(); return msg;
  }

  // ---------- 小工具：动效 ----------
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function confetti() {
    if (reduced() || !document.body) return;
    const box = document.createElement('div'); box.className = 'confetti';
    const cols = ['#F0BB51', '#A27650', '#4B423E', '#F7F3EE', '#A36D43'];
    for (let i = 0; i < 46; i++) { const p = document.createElement('i'); p.style.left = Math.random() * 100 + '%'; p.style.background = cols[i % cols.length]; p.style.animationDelay = Math.random() * .4 + 's'; p.style.setProperty('--x', (Math.random() * 160 - 80) + 'px'); p.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg'); box.appendChild(p); }
    document.body.appendChild(box); setTimeout(() => box.remove(), 2200);
  }
  function flash(el, cls) { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  function toast(html) { const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = html; document.body.appendChild(t); setTimeout(() => t.remove(), 2200); }

  // ---------- 小狗 SVG（炭黑身 + 棕口鼻，四阶段同一只狗长大） ----------
  function stageIdx(months) { return months >= 12 ? 3 : months >= 6 ? 2 : months >= 2 ? 1 : 0; }
  const STAGE_NAMES = ['幼崽', '少年', '青年', '成犬'];
  let dogSeq = 0;
  function dogSVG(stage, hunger, cls) {
    const st = Math.max(0, Math.min(3, stage | 0));
    const sad = hunger < 20, hungry = hunger < 50;
    // 同一只坐姿小黑狗。Stage 2（index 1）对齐锁定稿：大圆立耳、棕口鼻/腮圆/爪、黑点眼、黑鼻、右侧淡蓝口水。
    const spec = [
      { head: 1.1, body: 0.86, ear: 8, drool: 1, star: 0, blush: 14 },
      { head: 1, body: 1, ear: 0, drool: 1, star: 0, blush: 12 },
      { head: 0.96, body: 1.08, ear: 0, drool: hungry || sad ? 1 : 0, star: 0, blush: 11 },
      { head: 0.93, body: 1.16, ear: 0, drool: sad ? 1 : 0, star: 1, blush: 11 }
    ][st];
    const earDrop = sad ? 10 : hungry ? 4 : 0;
    const fid = 'df' + (++dogSeq);
    const drool = spec.drool ? `<g class="drool">
        <path d="M158 148c8 14 10 28 6 42 3 7 0 14-7 15-7 1-11-5-8-12 2-10-1-22-4-36 1-8 6-12 13-9z" fill="#D6EAF8"/>
        <ellipse cx="164" cy="214" rx="4.5" ry="6" fill="#D6EAF8"/>
      </g>` : '';
    const collar = spec.star ? `<path d="M92 168c24 14 56 14 78-2" fill="none" stroke="#F0BB51" stroke-width="5" stroke-linecap="round"/>
      <polygon points="132,162 135,170 144,171 137,177 139,186 132,181 125,186 127,177 120,171 129,170" fill="#F0BB51"/>` : '';
    const showProps = cls && st === 1;
    const props = showProps ? `<g>
        <g transform="translate(14,22)" fill="#F7F3EE" stroke="#3C3030" stroke-width="1.5" stroke-linejoin="round">
          <rect x="12" y="18" width="30" height="9" rx="4.5"/>
          <circle cx="12" cy="17" r="6"/><circle cx="12" cy="28" r="6"/>
          <circle cx="42" cy="17" r="6"/><circle cx="42" cy="28" r="6"/>
        </g>
        <polygon transform="translate(208,30)" fill="#F0BB51" points="14,0 17,9 27,9 19,15 22,25 14,19 6,25 9,15 1,9 11,9"/>
        <g transform="translate(188,188)">
          <ellipse cx="24" cy="18" rx="18" ry="12" fill="#A36D43"/>
          <circle cx="38" cy="12" r="5.5" fill="#F7F3EE"/><circle cx="44" cy="20" r="4.5" fill="#F7F3EE"/>
        </g>
      </g>` : '';
    const ear = (cx, dir) => `<g style="transform-origin:${cx}px 70px;transform:rotate(${dir * (spec.ear + earDrop)}deg)">
        <ellipse cx="${cx}" cy="58" rx="27" ry="46" fill="#3C3030"/>
        <ellipse cx="${cx}" cy="58" rx="24" ry="43" fill="#4B423E"/>
        <ellipse cx="${cx}" cy="66" rx="13" ry="26" fill="#CBA398"/>
      </g>`;
    return `<svg class="dogsvg ${sad ? 'sad' : hungry ? 'hungry' : 'happy'} ${cls || ''}" viewBox="0 0 256 256" role="img" aria-label="小狗${STAGE_NAMES[st]}">
      <defs><filter id="${fid}" x="-12%" y="-12%" width="124%" height="124%"><feGaussianBlur stdDeviation="0.65"/></filter></defs>
      ${props}
      <g filter="url(#${fid})">
        <g class="tail" style="transform-origin:190px 188px" transform="translate(128 190) scale(${spec.body}) translate(-128 -190)">
          <ellipse cx="188" cy="178" rx="14" ry="20" fill="#4B423E" transform="rotate(36 188 178)"/>
        </g>
        <g transform="translate(128 196) scale(${spec.body}) translate(-128 -196)">
          <ellipse cx="128" cy="188" rx="58" ry="40" fill="#3C3030"/>
          <ellipse cx="128" cy="186" rx="56" ry="38" fill="#4B423E"/>
          <ellipse cx="172" cy="196" rx="24" ry="18" fill="#4B423E"/>
        </g>
        <g class="head" style="transform-origin:128px 120px" transform="translate(128 122) scale(${spec.head}) translate(-128 -122)">
          ${ear(86, -1)}${ear(170, 1)}
          <ellipse cx="128" cy="124" rx="74" ry="62" fill="#3C3030"/>
          <ellipse cx="128" cy="124" rx="71" ry="59" fill="#4B423E"/>
          <ellipse cx="104" cy="104" rx="10" ry="7" fill="#A27650" transform="rotate(-16 104 104)"/>
          <ellipse cx="154" cy="104" rx="10" ry="7" fill="#A27650" transform="rotate(16 154 104)"/>
          <circle cx="72" cy="138" r="${spec.blush}" fill="#A27650"/>
          <circle cx="184" cy="138" r="${spec.blush}" fill="#A27650"/>
          <ellipse cx="128" cy="150" rx="42" ry="32" fill="#A27650"/>
          <ellipse cx="128" cy="160" rx="24" ry="13" fill="#8C5C3C" opacity=".2"/>
          <circle class="eye" cx="108" cy="118" r="4.4" fill="#1A1210"/>
          <circle class="eye" cx="152" cy="118" r="4.4" fill="#1A1210"/>
          <ellipse cx="128" cy="138" rx="20" ry="16" fill="#1A1210"/>
          <ellipse cx="121" cy="132" rx="3.4" ry="2.2" fill="#F7F3EE" opacity=".4"/>
          ${drool}${collar}
        </g>
        <g transform="translate(128 218) scale(${spec.body}) translate(-128 -218)">
          <ellipse cx="106" cy="216" rx="17" ry="12" fill="#8C5C3C"/>
          <ellipse cx="152" cy="216" rx="17" ry="12" fill="#8C5C3C"/>
          <ellipse cx="106" cy="214" rx="15" ry="10" fill="#A27650"/>
          <ellipse cx="152" cy="214" rx="15" ry="10" fill="#A27650"/>
        </g>
      </g>
    </svg>`;
  }
  window.__dogSVG = dogSVG;

  function foxInfo() {
    const total = W().length, m = masteredCount(), age = C.foxAge(m, total), st = stageIdx(age.months), lv = C.foxLevel(S.fox.xp);
    return { total, m, age, st, lv };
  }
  function greeting() {
    const f = S.fox, d = dayStat(), due = dueList().length, left = newLeftToday();
    let s;
    if (f.hunger < 20) s = '好饿呀…背几个单词给我换点狗粮吧 🥺';
    else if (!due && !left) s = ['今天的目标完成啦！你真的超棒 ✨', '打卡成功！明天也要来看我哦 🧡', '学习好认真，我都长大了一点点！'][d.new % 3];
    else if (f.hunger < 50) s = '肚子咕咕叫了…今天一起学习好吗？';
    else if (due) s = `还有 ${due} 个词在等你复习，趁热打铁！`;
    else if (d.new) s = `已经学了 ${d.new} 个新词，再坚持 ${left} 个就完成啦！`;
    else s = `今天学 ${left} 个新词，我们一起长大吧！`;
    if (f.food > 0 && f.hunger < 90) s += `<br><small>你有 ${f.food} 份狗粮，可以喂我哦～</small>`;
    return s;
  }
  function hello() { const h = new Date(now()).getHours(); return h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好'; }

  // ---------- 题目 ----------
  function pick(arr, n, exclude) { return C.shuffle(arr.filter(x => !exclude.includes(x))).slice(0, n); }
  function sample(arr, n, pred) { const out = []; const seen = new Set(); for (let i = 0; i < 400 && out.length < n; i++) { const x = arr[Math.floor(Math.random() * arr.length)]; if (!seen.has(x) && pred(x)) { seen.add(x); out.push(x); } } return out; }
  const CLOZE = ['clozeChoice', 'clozeType'];
  const wordHead = w => `<div class="word">${esc(w.word)}</div><div class="ipa">${esc(w.ipa)} ${sayBtn(w.word)}</div>`;
  function makeQ(w, type) {
    const all = W(); const ex = w.examples && w.examples[0];
    const others = (n, pred) => sample(all, n, x => x.word !== w.word && (!pred || pred(x)));
    switch (type) {
      case 'w2m': { const o = C.shuffle([w].concat(others(3, x => x.meaning !== w.meaning))); return { title: '看词选意', prompt: wordHead(w), options: o.map(x => ({ label: x.pos + ' ' + x.meaning, ok: x === w })), say: w.word }; }
      case 'm2w': { const o = C.shuffle([w].concat(others(3))); return { title: '看意选词', prompt: `<div class="meaning-big">${esc(w.meaning)}</div><div class="ipa">${esc(w.pos)}</div>`, options: o.map(x => ({ label: x.word, ok: x === w })) }; }
      case 'pos': { const o = C.shuffle([w].concat(others(3, x => x.pos !== w.pos))); return { title: '看词性选词', prompt: `<div class="hint">请选出词性为 <b class="tag">${esc(w.pos)}</b> 且意为下列含义的词</div><div class="meaning-big">${esc(w.meaning)}</div><div class="hint">其余选项都是其他词性的词</div>`, options: o.map(x => ({ label: x.word, ok: x === w, reveal: x.word + '  ' + x.pos + ' ' + x.meaning })) }; }
      case 'clozeChoice': { const cz = C.makeCloze(ex, w.word); const o = C.shuffle([w].concat(others(3, x => x.pos === w.pos))); return { title: '例句填空 · 选择', prompt: `<div class="sent">${esc(cz.text)}</div><div class="hint">选出空格处单词的原形</div>`, options: o.map(x => ({ label: x.word, ok: x === w })) }; }
      case 'clozeType': { const cz = C.makeCloze(ex, w.word); return { title: '例句填空 · 拼写', prompt: `<div class="sent">${esc(cz.text)}</div><div class="hint">提示：${esc(w.pos)} ${esc(w.meaning)}，首字母 <b>${esc(cz.answer[0])}</b>；可填句中形式或原形</div>`, typed: [cz.answer, w.word] }; }
      case 'dictation': return { title: '听音默写 · 英音', prompt: `<button class="bigsay" onclick="__speak('${esc(w.word)}')" aria-label="再听一遍">🔊</button><div class="hint">点击喇叭再听一遍 · ${esc(w.ipa)}　${esc(w.pos)}</div>`, typed: [w.word], say: w.word, forceSay: true };
      case 'meaningType': return { title: '看意默写', prompt: `<div class="meaning-big">${esc(w.meaning)}</div><div class="hint">${esc(w.pos)}　共 ${w.word.length} 个字母</div><div class="slots">${'<i></i>'.repeat(Math.min(w.word.length, 18))}</div>`, typed: [w.word] };
      case 'flash': return { title: '单词卡', prompt: wordHead(w), flash: true, say: w.word };
    }
  }
  const TYPES = { flash: '单词卡（自评）', w2m: '看词选意', m2w: '看意选词', pos: '看词性选词', clozeChoice: '例句填空（选择）', clozeType: '例句填空（拼写）', dictation: '听音默写', meaningType: '看意默写' };
  const TYPE_ICONS = { flash: '🃏', w2m: '👀', m2w: '💭', pos: '🏷️', clozeChoice: '🧩', clozeType: '✍️', dictation: '🎧', meaningType: '📝', mix: '🎲' };
  const TYPE_DESC = { flash: '翻卡自评，FSRS 四档', w2m: '英文 → 中文四选一', m2w: '中文 → 英文四选一', pos: '按词性辨析', clozeChoice: '原创例句选词', clozeType: '原创例句拼写', dictation: '英音听写', meaningType: '中文提示拼写', mix: '随机题型' };
  const typeOk = (w, t) => !CLOZE.includes(t) || C.hasExample(w);

  function detail(w) {
    return `<div class="detail"><div class="dhead"><b>${esc(w.word)}</b> <span class="ipa">${esc(w.ipa)}</span> ${sayBtn(w.word)}</div><div class="dmean"><span class="tag">${esc(w.pos)}</span> ${esc(w.meaning)}</div>` + (w.examples || []).map(e => `<div class="ex">${esc(e)}</div>`).join('') + '</div>';
  }
  function gradeButtons(card) {
    const p = C.preview(card, now());
    return `<div class="grades">${[1, 2, 3, 4].map(g => `<button class="g${g}" data-g="${g}">${C.RATING_LABELS[g]}<small>${C.fmtInterval(p[g])}</small></button>`).join('')}</div>`;
  }

  // 会话统计
  let SESS = null;
  function startSess(kind, total) { SESS = { kind, total, done: 0, correct: 0, food0: S.fox.food, t0: now() }; }
  function progressBar(done, total, label) {
    const pct = total ? Math.min(100, done / total * 100) : 0;
    return `<div class="sessbar"><button class="back" onclick="__go('home')" aria-label="返回首页">✕</button><div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div><span>${label}</span></div>`;
  }
  function summary(title, sub, extra) {
    const s = SESS || { done: 0, correct: 0, food0: S.fox.food, t0: now() };
    const acc = s.done ? Math.round(s.correct / s.done * 100) + '%' : '-';
    const mins = Math.max(1, Math.round((now() - s.t0) / 60000));
    return `<div class="card summary pop"><div class="sumfox">${dogSVG(foxInfo().st, S.fox.hunger, 'bounce')}</div><h2>${title}</h2><p class="muted">${sub}</p>
      <div class="sumstats"><div><b>${s.done}</b><span>完成</span></div><div><b>${acc}</b><span>正确率</span></div><div><b>+${Math.max(0, S.fox.food - s.food0)}</b><span>🦴 狗粮</span></div><div><b>${mins}</b><span>分钟</span></div></div>${extra || ''}</div>`;
  }

  function showQ(container, w, type, next) {
    const q = makeQ(w, type);
    container.innerHTML = `<div class="card qcard enter" id="qc"><div class="qtype">${q.title}</div><div class="prompt">${q.prompt}</div><div id="ans"></div><div id="fb"></div></div>`;
    const ans = container.querySelector('#ans'), fb = container.querySelector('#fb'), qc = container.querySelector('#qc');
    if (q.say && (q.forceSay || S.settings.autoPlay)) setTimeout(() => speak(q.say), 200);
    function finish(rating, pre) {
      const ok = rating > 1; const m = record(w, rating);
      if (SESS) { SESS.done++; if (ok) SESS.correct++; }
      flash(qc, ok ? 'good' : 'bad');
      fb.innerHTML = (pre || '') + `<div class="verdict ${ok ? 'ok' : 'err'}"><b>${q.flash ? C.RATING_LABELS[rating] : ok ? '✔ 正确' : '✘ 再接再厉'}</b> <span>${esc(m)}</span></div>${detail(w)}<button class="primary block" id="nx">下一个 →<kbd>Enter</kbd></button>`;
      const b = fb.querySelector('#nx'); b.onclick = next; try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); }
    }
    if (q.flash) {
      ans.innerHTML = `<button class="primary block" id="show">想一想，然后查看释义<kbd>空格</kbd></button>`;
      ans.querySelector('#show').onclick = () => {
        flash(qc, 'flip');
        ans.innerHTML = `${detail(w)}<div class="hint center">你记得怎么样？</div>` + gradeButtons(cards()[w.word]);
        ans.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { ans.innerHTML = ''; finish(+b.dataset.g); });
      };
    } else if (q.options) {
      ans.className = 'opts';
      q.options.forEach(o => { const b = document.createElement('button'); b.textContent = o.label; b.onclick = () => {
        [...ans.children].forEach((c, i) => { c.disabled = true; if (q.options[i].ok) c.classList.add('right'); if (q.options[i].reveal) c.textContent = q.options[i].reveal; });
        if (!o.ok) b.classList.add('wrong'); finish(o.ok ? C.Rating.Good : C.Rating.Again); }; ans.appendChild(b); });
    } else {
      ans.innerHTML = `<div class="typerow"><input type="text" id="inp" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="输入英文单词"><button class="primary" id="sub">提交</button><button class="ghost" id="skip">不会</button></div>`;
      const inp = ans.querySelector('#inp'); try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); }
      const go = (give) => { if (inp.disabled) return; inp.disabled = true; const ok = !give && q.typed.some(t => C.answerMatch(inp.value, t));
        finish(ok ? C.Rating.Good : C.Rating.Again, ok ? '' : `<div class="answer">正确答案：<b>${esc(q.typed[0])}</b>${inp.value ? '，你的答案：<s>' + esc(inp.value) + '</s>' : ''}</div>`); };
      ans.querySelector('#sub').onclick = () => go(false); ans.querySelector('#skip').onclick = () => go(true);
      inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); go(false); } };
    }
  }

  // ---------- 键盘快捷键（桌面） ----------
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || ''; const typing = /INPUT|TEXTAREA|SELECT/.test(tag);
    const q = s => $app.querySelector(s);
    if (e.key === 'Enter' && !typing && q('#nx')) { e.preventDefault(); q('#nx').click(); return; }
    if (typing) return;
    if (e.key === ' ' && q('#show')) { e.preventDefault(); q('#show').click(); return; }
    if (/^[1-4]$/.test(e.key)) {
      const g = q(`[data-g="${e.key}"]`); if (g) { e.preventDefault(); g.click(); return; }
      const opts = $app.querySelectorAll('#ans.opts button:not(:disabled)'); const b = opts[+e.key - 1]; if (b) { e.preventDefault(); b.click(); }
    }
  });

  // ---------- 视图 ----------
  const views = {};
  const TAB_OF = { home: 'home', study: 'study', learn: 'study', review: 'study', preview: 'study', practice: 'practice', sentence: 'practice', pet: 'pet', me: 'me', words: 'me', settings: 'me', books: 'me' };
  let navSeq = 0;
  function go(v, arg) {
    if (!(v in views)) v = 'home';
    document.querySelectorAll('#nav [data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === TAB_OF[v]));
    document.body.dataset.view = v;
    location.hash = v; const seq = ++navSeq;
    const render = () => { if (seq !== navSeq) return; views[v](arg); $app.classList.remove('fade'); void $app.offsetWidth; $app.classList.add('fade'); window.scrollTo(0, 0); };
    if (BOOK && BOOK.id === S.bookId) return render();
    $app.innerHTML = '<div class="card loading"><div class="spinner"></div>正在加载词书…</div>';
    return loadBook(S.bookId).then(b => { BOOK = b; S.bookId = b.id; render(); }).catch(e => { $app.innerHTML = `<div class="card err">词书加载失败，请检查网络后刷新页面。（${esc(e.message)}）</div>`; });
  }
  document.getElementById('nav').onclick = e => { const b = e.target.closest('[data-view]'); if (b) go(b.dataset.view); };
  window.__go = go;

  function ring(pct, size) {
    const r = 52, c = 2 * Math.PI * r, off = c * (1 - Math.min(1, pct));
    return `<svg class="ring" viewBox="0 0 120 120" width="${size}" height="${size}"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F0BB51"/><stop offset="1" stop-color="#A27650"/></linearGradient></defs>
      <circle cx="60" cy="60" r="${r}" class="ring-bg"/><circle cx="60" cy="60" r="${r}" class="ring-fg" stroke="url(#rg)" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 60 60)"/></svg>`;
  }
  function weekBars() {
    const days = []; let max = 1;
    for (let i = 6; i >= 0; i--) { const k = C.shiftDay(today(), -i); const s = S.days[k] || { new: 0, review: 0 }; const n = (s.new || 0) + (s.review || 0); max = Math.max(max, n); days.push({ k, n }); }
    const wd = ['日', '一', '二', '三', '四', '五', '六'];
    return `<div class="week">${days.map(d => `<div class="wcol ${d.k === today() ? 'today' : ''}"><span class="wn">${d.n || ''}</span><div class="wbar"><i style="height:${Math.max(4, d.n / max * 100)}%"></i></div><span>${d.k === today() ? '今' : wd[new Date(d.k + 'T12:00:00').getDay()]}</span></div>`).join('')}</div>`;
  }
  function calendar() {
    let cal = ''; const start = C.shiftDay(today(), -27); const pad = (new Date(start + 'T12:00:00').getDay() + 6) % 7;
    cal += ['一', '二', '三', '四', '五', '六', '日'].map(x => `<div class="h">${x}</div>`).join('') + '<div class="h"></div>'.repeat(pad);
    for (let i = 0; i < 28; i++) { const k = C.shiftDay(start, i); cal += `<div class="${S.studyDays.includes(k) ? 'on' : ''} ${k === today() ? 'td' : ''}" title="${k}">${+k.slice(8)}</div>`; }
    return `<div class="cal">${cal}</div>`;
  }

  views.home = function () {
    const d = dayStat(), total = W().length, m = masteredCount(), due = dueList().length;
    const st = C.streak(S.studyDays, today()), left = newLeftToday();
    const goal = S.settings.dailyNew + d.review + due, done = Math.min(d.new, S.settings.dailyNew) + d.review;
    const pct = goal ? done / goal : 1, finished = !due && !left;
    const acc = d.correct + d.wrong ? Math.round(d.correct / (d.correct + d.wrong) * 100) + '%' : '-';
    const fi = foxInfo();
    const cta = finished ? `<button class="cta done" onclick="__go('practice')">🎉 今日目标已完成 · 再练一会</button>`
      : `<button class="cta" id="start" onclick="__go('${due ? 'review' : 'learn'}')">开始今天的学习<small>${due ? `先复习 ${due} 个` : `学 ${left} 个新词`}</small></button>`;
    $app.innerHTML = `
    <div class="topline"><div><div class="hello">${hello()} 👋</div><div class="muted">${esc(BOOK.name)} · ${total} 词</div></div><div class="streak ${st ? 'on' : ''}" title="连续打卡"><span class="flame">🔥</span><b>${st}</b><small>天</small></div></div>
    <div class="grid2">
    <div class="card hero">
      <div class="herofox" onclick="__go('pet')">${dogSVG(fi.st, S.fox.hunger, 'idle')}<div class="bubble">${greeting()}</div></div>
      <div class="ringwrap">${ring(pct, 150)}<div class="ringtxt"><b>${Math.round(pct * 100)}<small>%</small></b><span>今日进度</span></div></div>
      <div class="ringlegend"><div><i class="dot n"></i>新词 <b>${d.new}/${S.settings.dailyNew}</b></div><div><i class="dot r"></i>复习 <b>${d.review}/${d.review + due}</b></div></div>
      ${cta}
    </div>
    <div class="col">
    <div class="stats">
      <div class="stat"><span>今日新学</span><b>${d.new}/${S.settings.dailyNew}</b></div><div class="stat hot"><span>待复习</span><b>${due}</b></div>
      <div class="stat"><span>今日已复习</span><b>${d.review}</b></div><div class="stat"><span>今日正确率</span><b>${acc}</b></div>
      <div class="stat"><span>已学</span><b>${learned().length}</b></div><div class="stat"><span>已掌握</span><b>${m}</b></div>
      <div class="stat"><span>连续打卡</span><b>${st} 天</b></div><div class="stat"><span>累计打卡</span><b>${S.studyDays.length} 天</b></div>
    </div>
    <div class="card"><div class="ctitle">本周学习<span class="muted">新学 + 复习</span></div>${weekBars()}</div>
    <div class="card"><div class="ctitle">词书进度<span class="muted">已掌握 ${m}/${total}</span></div><div class="bar big"><i style="width:${(total ? m / total * 100 : 0).toFixed(1)}%"></i></div>
      <div class="quick"><button onclick="__go('review')">📖 复习 ${due}</button><button onclick="__go('learn')">✨ 新词 ${left}</button><button onclick="__go('preview')">🔭 预习</button><button onclick="__go('pet')">🦴 狗粮 ${S.fox.food}</button></div></div>
    </div></div>
    ${S.migratedFrom === 1 ? '<div class="note">已从 v1 自动迁移学习进度到 FSRS 记忆算法（原数据已备份）。</div>' : ''}
    <div class="card"><div class="ctitle">近 28 天打卡</div>${calendar()}</div>`;
  };

  views.study = function () {
    const due = dueList().length, left = newLeftToday(), d = dayStat();
    $app.innerHTML = `<h2 class="ph">学习</h2><div class="tiles">
      <button class="tile t1" onclick="__go('learn')"><span class="ti">✨</span><b>学新词</b><small>今日 ${d.new}/${S.settings.dailyNew} · 剩 ${left}</small></button>
      <button class="tile t2" onclick="__go('review')"><span class="ti">📖</span><b>今日回顾</b><small>${due} 个到期 · FSRS 智能排程</small></button>
      <button class="tile t3" onclick="__go('preview')"><span class="ti">🔭</span><b>预习</b><small>提前看今明两天的新词</small></button>
      <button class="tile t4" onclick="__go('sentence')"><span class="ti">✍️</span><b>造句</b><small>用学过的词写句子</small></button></div>`;
  };

  views.learn = function () {
    const left = newLeftToday(); const list = unlearned();
    if (!W().length) { $app.innerHTML = '<div class="card summary"><h2>这本词书还没有词</h2><p class="muted">先添加几个单词再开始。</p><button class="primary" onclick="__go(\'books\')">去词书</button></div>'; return; }
    if (!list.length) { $app.innerHTML = '<div class="card summary"><h2>🎉 整本词书都学过了！</h2><button class="primary" onclick="__go(\'review\')">去复习</button></div>'; return; }
    if (left <= 0) {
      const just = SESS && SESS.kind === 'learn' && SESS.done > 0;
      $app.innerHTML = summary('今天的新词已完成', `今天的 ${S.settings.dailyNew} 个新词已完成 ✅ 记得按时回来复习哦`, `<div class="row center"><button class="primary" onclick="__go('review')">去复习（${dueList().length}）</button><button class="ghost" id="more">再加学 5 个</button></div>`);
      $app.querySelector('#more').onclick = () => { S.settings.dailyNew += 5; save(); views.learn(); };
      if (just) { confetti(); SESS = null; }
      return;
    }
    if (!SESS || SESS.kind !== 'learn') startSess('learn', left);
    const w = list[0], n = dayStat().new;
    $app.innerHTML = progressBar(n, S.settings.dailyNew, `${n + 1}/${S.settings.dailyNew}`) + `<div class="card qcard enter" id="qc"><div class="qtype">学新词 <span class="new">NEW</span></div>${wordHead(w)}
      <div id="reveal"><div class="blur">${esc(w.pos)} ••••••</div><button class="primary block" id="show">想一想，然后查看释义<kbd>空格</kbd></button></div></div>`;
    auto(w.word);
    $app.querySelector('#show').onclick = () => {
      flash($app.querySelector('#qc'), 'flip');
      $app.querySelector('#reveal').innerHTML = `<div class="dmean big"><span class="tag">${esc(w.pos)}</span> ${esc(w.meaning)}</div>${(w.examples || []).map(e => `<div class="ex">${esc(e)}</div>`).join('')}
      <div class="hint center">你对这个词的熟悉程度？</div>${gradeButtons(null)}
      <button class="ghost block" id="known">😎 太熟了，直接标为掌握</button>`;
      const add = (rating, known) => { cards()[w.word] = known ? C.markKnown(null, now()) : C.learnCard(rating, now()); dayStat().new++; markStudied(); if (known) S.fox.food += 5; if (SESS) { SESS.done++; if (known || rating > 1) SESS.correct++; } save(); views.learn(); };
      $app.querySelectorAll('[data-g]').forEach(b => b.onclick = () => add(+b.dataset.g, false));
      $app.querySelector('#known').onclick = () => add(0, true);
    };
  };

  function quizLoop(getWord, typeFor, emptyHtml, header, total) {
    const w = getWord();
    if (!w) { $app.innerHTML = emptyHtml(); return; }
    const h = header();
    $app.innerHTML = (total ? progressBar(SESS ? SESS.done : 0, total(), '') : '') + `<div class="qhead">${h}</div><div id="q"></div>`;
    showQ($app.querySelector('#q'), w, typeFor(w), () => quizLoop(getWord, typeFor, emptyHtml, header, total));
  }
  const REVIEW_TYPES = ['flash', 'w2m', 'm2w', 'clozeChoice', 'meaningType', 'clozeType', 'pos'];
  const randType = (w, list) => { const ok = list.filter(t => typeOk(w, t)); return ok[Math.floor(Math.random() * ok.length)]; };
  views.review = function () {
    startSess('review', dueList().length);
    quizLoop(() => dueList()[0], w => randType(w, REVIEW_TYPES),
      () => { const next = learned().map(w => cards()[w.word]).sort((a, b) => a.due - b.due)[0];
        const nx = next ? `下一个复习在约 ${C.fmtInterval(next.due - now())}后。` : '';
        const acts = `<div class="row center"><button class="primary" onclick="__go('learn')">学新词</button><button class="ghost" onclick="__go('practice')">自由练习</button></div>`;
        if (SESS && SESS.done) { const html = summary('复习完成！', '✅ 当前没有到期的复习。' + nx, acts); if (!newLeftToday()) confetti(); SESS = null; return html; }
        return `<div class="card summary"><div class="sumfox">${dogSVG(foxInfo().st, S.fox.hunger, 'idle')}</div><h2>✅ 当前没有到期的复习。</h2><p class="muted">${nx}</p>${acts}</div>`; },
      () => `今日回顾 · 剩余 ${dueList().length} 个到期`, () => SESS.done + dueList().length);
  };

  views.preview = function () {
    const left = newLeftToday(), un = unlearned();
    const todayW = un.slice(0, left), tomorrow = un.slice(left, left + S.settings.dailyNew);
    const tEnd = new Date(C.shiftDay(today(), 1) + 'T23:59:59').getTime();
    const dueTomorrow = learned().filter(w => cards()[w.word].due <= tEnd).length;
    const list = arr => arr.map(w => `<div class="card mini">${detail(w)}</div>`).join('') || '<div class="muted">无</div>';
    $app.innerHTML = `<h2 class="ph">预习</h2><div class="card note">明天（截至明晚）预计需复习 <b>${dueTomorrow}</b> 个词；今天还剩 <b>${todayW.length}</b> 个新词未学。</div>
      <h3>今日待学新词（${todayW.length}）</h3><div class="plist">${list(todayW)}</div><h3>明日新词预习（${tomorrow.length}）</h3><div class="plist">${list(tomorrow)}</div>`;
  };

  views.practice = function (mode) {
    if (!mode) {
      $app.innerHTML = `<h2 class="ph">练习</h2><p class="muted">优先出到期待复习的词，其次随机出已学过的词。到期词的结果计入 FSRS；未到期的词答对不会提前推迟复习，答错会缩短间隔。例句填空只出有例句的词。</p>
        <div class="tiles modes">${Object.entries(TYPES).concat([['mix', '混合模式']]).map(([k, v]) => `<button class="tile" data-m="${k}"><span class="ti">${TYPE_ICONS[k]}</span><b>${v}</b><small>${TYPE_DESC[k]}</small></button>`).join('')}
        <button class="tile" onclick="__go('sentence')"><span class="ti">💬</span><b>造句</b><small>写句子 + 格式检查</small></button></div>`;
      $app.querySelectorAll('[data-m]').forEach(b => b.onclick = () => views.practice(b.dataset.m)); return;
    }
    let last = null; const keys = Object.keys(TYPES);
    startSess('practice', 0);
    const eligible = w => mode === 'mix' || typeOk(w, mode);
    const getWord = () => { const d = dueList().filter(eligible); if (d.length) return d[0]; const l = learned().filter(w => eligible(w) && w !== last); const w = l.length ? l[Math.floor(Math.random() * l.length)] : learned().filter(eligible)[0]; last = w; return w; };
    quizLoop(getWord, w => mode === 'mix' ? randType(w, keys) : mode,
      () => `<div class="card summary"><h2>还没有可练的词</h2><p class="muted">${CLOZE.includes(mode) ? '还没有学过带例句的词（例句填空只用有例句的词）。' : '还没有学过的词，先去学几个新词吧。'}</p><div class="row center"><button class="primary" onclick="__go('learn')">学新词</button><button class="ghost" onclick="__go('practice')">换模式</button></div></div>`,
      () => `<span>${TYPE_ICONS[mode]} 练习：${mode === 'mix' ? '混合模式' : TYPES[mode]}${SESS && SESS.done ? ` · 已答 ${SESS.done} · 对 ${SESS.correct}` : ''}</span><button class="ghost sm" onclick="__go('practice')">换模式</button>`);
  };

  views.sentence = function (wordArg) {
    const l = learned(); const pool = l.length ? l : W().filter(C.hasExample);
    const w = (wordArg && byWord(wordArg)) || pool[Math.floor(Math.random() * pool.length)];
    const mine = bs().sentences[w.word] || []; const exs = w.examples || [];
    $app.innerHTML = `<h2 class="ph">造句</h2><div class="card qcard"><div class="qtype">离线检查：含目标词或变形、≥5 个词、首字母大写、句末标点</div>
      ${wordHead(w)}<div class="dmean center"><span class="tag">${esc(w.pos)}</span> ${esc(w.meaning)}</div>
      <textarea id="s" rows="3" placeholder="用 ${esc(w.word)} 写一个英文句子"></textarea>
      <div class="row"><button class="primary" id="chk">检查并保存</button><button class="ghost" id="ref" ${exs.length ? '' : 'disabled title="该词暂无参考例句"'}>看参考例句${exs.length ? '' : '（无）'}</button><button class="ghost" id="nxt">换一个词</button></div>
      <div class="row"><input type="text" id="pickw" placeholder="指定单词" style="flex:1;min-width:0"><button class="ghost" id="pk">指定</button></div><div id="fb"></div>
      <div id="refbox"></div></div><div class="card"><div class="ctitle">我为这个词写过的句子（${mine.length}）</div>${mine.map(s => `<div class="mine">${esc(s.text)} <span class="muted">${s.date}</span></div>`).join('') || '<div class="muted">暂无</div>'}</div>`;
    $app.querySelector('#ref').onclick = () => $app.querySelector('#refbox').innerHTML = exs.map(e => `<div class="ex">${esc(e)}</div>`).join('');
    $app.querySelector('#nxt').onclick = () => views.sentence();
    $app.querySelector('#pk').onclick = () => { const v = C.norm($app.querySelector('#pickw').value); if (byWord(v)) views.sentence(v); else alert('词书中没有这个词'); };
    $app.querySelector('#chk').onclick = () => {
      const t = $app.querySelector('#s').value.trim(); const r = C.checkSentence(t, w.word); const fb = $app.querySelector('#fb');
      if (!r.ok) { fb.innerHTML = r.errors.map(e => `<div class="err">✘ ${esc(e)}</div>`).join(''); flash($app.querySelector('.qcard'), 'bad'); return; }
      (bs().sentences[w.word] = bs().sentences[w.word] || []).push({ text: t, date: today() });
      const m = record(w, C.Rating.Good); views.sentence(w.word);
      $app.querySelector('#fb').innerHTML = `<div class="verdict ok">✔ 句子格式检查通过，已保存。${esc(m)}</div><div class="hint">注：离线检查只看格式和是否用到该词，不判断语法与用法是否地道${exs.length ? '，请对照参考例句' : ''}。</div>`;
      flash($app.querySelector('.qcard'), 'good');
    };
  };

  views.pet = function (fedN) {
    S.fox = C.applyHunger(S.fox, S.studyDays, today()); save();
    const f = S.fox, fi = foxInfo(), { total, m, age, lv } = fi;
    const nextXp = Math.pow(lv, 2) * 20, curXp = Math.pow(lv - 1, 2) * 20;
    const size = 170 + fi.st * 30;
    $app.innerHTML = `<div class="card petcard">
      <div class="pethead"><div><h2>${esc(f.name)} <button class="ghost sm" id="rn">改名</button></h2><div class="muted">${C.foxStage(age.months).name} · 月龄 <b>${age.label}</b></div></div><div class="lv">Lv.${lv}</div></div>
      <div class="stage s${fi.st}"><div class="bubble">${fedN ? `谢谢你的狗粮！好好吃 💕` : greeting()}</div><div class="dogbox" id="dogbox" style="width:${size}px">${dogSVG(fi.st, f.hunger, 'idle' + (fedN ? ' bounce' : ''))}</div></div>
      <div class="mood">心情：${C.foxMood(f.hunger)}</div>
      <div class="meter"><span>🎂 年龄</span><div class="bar"><i style="width:${(age.years * 100).toFixed(1)}%"></i></div><small>掌握 ${m}/${total}</small></div>
      <div class="meter"><span>🍗 饱食度</span><div class="bar ${f.hunger < 50 ? 'warn' : 'full'}"><i style="width:${f.hunger}%"></i></div><small>${f.hunger}/100</small></div>
      <div class="meter"><span>⭐ 经验</span><div class="bar xp"><i style="width:${((f.xp - curXp) / (nextXp - curXp) * 100).toFixed(1)}%"></i></div><small>${f.xp}/${nextXp}</small></div>
      <div class="feedrow"><div class="foodbag">🦴<b>${f.food}</b><small>狗粮</small></div><button class="primary" id="f1" ${f.food ? '' : 'disabled'}>喂 1 份</button><button class="ghost" id="fa" ${f.food ? '' : 'disabled'}>全部喂掉</button></div>
      <div id="msg"></div>
      <div class="stages">${STAGE_NAMES.map((n, i) => `<div class="${i <= fi.st ? 'on' : ''}">${dogSVG(i, 100)}<span>${n}</span></div>`).join('')}</div></div>
      <details class="card rules"><summary>成长规则</summary><div class="muted">规则：到期复习答对且下次间隔 ≥ 1 天 +1 狗粮；单词「掌握」（FSRS 复习间隔达到 ${C.MASTER_DAYS} 天及以上）+5 狗粮，之后答错会失去掌握状态。喂 1 份 = 饱食度 +10、经验 +10。哪天没学习，饱食度 −${C.HUNGER_PER_DAY}。月龄只由当前词书（「${esc(BOOK.name)}」）的掌握词数决定：整本词书全部掌握 = 1岁（12 个月）。成长阶段：幼崽(&lt;2月)→少年(2月)→青年(6月)→成犬(1岁)。累计喂食 ${f.fed || 0} 次。</div></details>`;
    const doFeed = (n, btn) => {
      let c = 0; while (c < n) { const r = C.feed(S.fox); if (!r.ok) break; S.fox = r.fox; c++; } save();
      const from = btn && btn.getBoundingClientRect ? btn.getBoundingClientRect() : null;
      views.pet(c);
      $app.querySelector('#msg').innerHTML = `<div class="verdict ok">喂了 ${c} 份，小狗很满足 🐶💕</div>`;
      const fb = $app.querySelector('#dogbox'); if (!fb || !from || reduced()) return;
      const to = fb.getBoundingClientRect();
      for (let i = 0; i < Math.min(c, 8); i++) { const e = document.createElement('div'); e.className = 'flyfood'; e.textContent = '🍖';
        e.style.left = (from.left + from.width / 2) + 'px'; e.style.top = (from.top) + 'px';
        e.style.setProperty('--dx', (to.left + to.width / 2 - from.left - from.width / 2) + 'px'); e.style.setProperty('--dy', (to.top + to.height * .55 - from.top) + 'px'); e.style.animationDelay = i * 80 + 'ms';
        document.body.appendChild(e); setTimeout(() => e.remove(), 1000 + i * 80); }
    };
    $app.querySelector('#f1').onclick = e => doFeed(1, e.currentTarget); $app.querySelector('#fa').onclick = e => doFeed(f.food, e.currentTarget);
    $app.querySelector('#rn').onclick = () => { const n = prompt('给小狗起个名字', f.name); if (n && n.trim()) { S.fox.name = n.trim().slice(0, 20); save(); views.pet(); } };
  };

  views.me = function () {
    const fi = foxInfo(), st = C.streak(S.studyDays, today());
    $app.innerHTML = `<div class="card mehead"><div class="avatar">${dogSVG(fi.st, S.fox.hunger)}</div><div><h2>我的学习</h2><div class="muted">${esc(BOOK.name)} · 连续 ${st} 天 · 累计 ${S.studyDays.length} 天</div></div></div>
      <div class="stats three"><div class="stat"><span>已学</span><b>${learned().length}</b></div><div class="stat"><span>已掌握</span><b>${fi.m}</b></div><div class="stat"><span>待复习</span><b>${dueList().length}</b></div></div>
      <div class="menu"><button onclick="__go('books')">📚 词书<span>›</span></button><button onclick="__go('words')">📖 词表<span>›</span></button><button onclick="__go('preview')">🔭 预习<span>›</span></button><button onclick="__go('sentence')">✍️ 造句<span>›</span></button><button onclick="__go('settings')">⚙️ 设置与备份<span>›</span></button></div>
      <div class="card"><div class="ctitle">近 28 天打卡</div>${calendar()}</div>`;
  };

  views.words = function () {
    const LIMIT = 200;
    const row = (w, i) => { const c = cards()[w.word]; const st = !c ? '<span class="pill">未学</span>' : (c.mastered ? '<span class="pill ok">✅掌握</span> ' : '') + '<span class="pill">间隔 ' + C.fmtInterval(Math.max(C.MIN, c.due - (c.last_review || c.due))) + '</span>';
      const due = c ? new Date(c.due).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      return `<div class="wrow"><div class="wmain"><b>${esc(w.word)}</b> <span class="ipa">${esc(w.ipa)}</span><div class="wm">${esc(w.pos)} ${esc(w.meaning)}</div></div><div class="wside">${st}<small>${due}</small><button class="ghost sm" data-s="${esc(w.word)}">造句</button></div></div>`; };
    const render = v => { const all = W(); const hits = []; for (let i = 0; i < all.length && hits.length < LIMIT; i++) { const w = all[i]; if (!v || w.word.includes(v) || w.meaning.includes(v)) hits.push(row(w, i)); }
      $app.querySelector('#tb').innerHTML = hits.join('') || '<div class="muted">没有找到</div>';
      $app.querySelector('#cnt').textContent = `共 ${all.length} 词，最多显示 ${LIMIT} 条，可搜索`; $app.querySelectorAll('[data-s]').forEach(b => b.onclick = () => go('sentence', b.dataset.s)); };
    $app.innerHTML = `<h2 class="ph">词表</h2><div class="card"><input type="search" id="q" placeholder="🔍 搜索单词或中文"><div class="muted" id="cnt"></div><div id="tb" class="wlist"></div></div>`;
    $app.querySelector('#q').oninput = e => render(e.target.value.trim().toLowerCase()); render('');
  };

  function bookOptions() {
    const builtin = INDEX.map(b => `<option value="${b.id}" ${b.id === S.bookId ? 'selected' : ''}>${esc(b.name)}（${b.count}）</option>`).join('');
    const custom = (S.customBooks || []).map(b => `<option value="${esc(b.id)}" ${b.id === S.bookId ? 'selected' : ''}>${esc(b.name)}（${b.words.length}·我的）</option>`).join('');
    return builtin + custom;
  }
  views.books = function () {
    const editing = customOf(S.bookId);
    const rows = (S.customBooks || []).map(b => `<div class="card bookitem"><div class="ctitle">${esc(b.name)}<span class="muted">${b.words.length} 词${b.id === S.bookId ? ' · 当前' : ''}</span></div>
      <div class="row"><button class="primary sm" data-use="${esc(b.id)}">学习这本</button><button class="ghost sm" data-ren="${esc(b.id)}">重命名</button><button class="danger sm" data-del="${esc(b.id)}">删除</button></div>
      <div class="wordchips">${b.words.slice(0, 12).map(w => `<span>${esc(w.word)}${w.meaning ? ' ' + esc(w.meaning) : ''}</span>`).join('')}${b.words.length > 12 ? `<span>…共 ${b.words.length}</span>` : ''}</div></div>`).join('');
    $app.innerHTML = `<h2 class="ph">词书</h2>
      <div class="card"><div class="ctitle">内置词书</div>${INDEX.map(b => `<div class="row" style="justify-content:space-between"><span>${esc(b.name)} <small class="muted">${b.count} 词</small></span><button class="ghost sm" data-use="${b.id}">${b.id === S.bookId ? '当前' : '切换'}</button></div>`).join('')}</div>
      <div class="card"><div class="ctitle">新建自定义词书</div>
        <label class="field">名称<input id="bname" type="text" maxlength="40" placeholder="例如：旅游口语"></label>
        <label class="field">粘贴词表（可选）<textarea id="bpaste" rows="4" placeholder="每行一个：apple 苹果&#10;banana&#9;香蕉&#10;orange"></textarea></label>
        <button class="primary block" id="bcreate">创建词书</button>
        <div class="hint">也可以先创建空词书，再逐词添加。进度按词书分开保存，删词书不会影响其他词书。</div></div>
      ${rows || '<div class="card muted">还没有自定义词书。</div>'}
      ${editing ? `<div class="card"><div class="ctitle">往「${esc(editing.name)}」加词</div>
        <div class="row"><input id="aw" type="text" placeholder="单词" autocomplete="off" autocapitalize="off"><input id="am" type="text" placeholder="中文释义（可选）"></div>
        <div class="row"><button class="primary" id="aadd">添加这个词</button><button class="ghost" id="exb">导出 JSON</button><label><button class="ghost" id="imb">导入 JSON</button><input id="imbf" type="file" accept=".json,application/json" style="display:none"></label></div>
        <label class="field">再粘贴一批<textarea id="apaste" rows="3" placeholder="每行一个单词，可带中文"></textarea></label>
        <button class="ghost block" id="ap">把粘贴的词加进来</button></div>` : ''}
      <div id="msg"></div>`;
    const use = id => { S.bookId = id; save(); BOOK = null; go('home'); };
    $app.querySelectorAll('[data-use]').forEach(b => b.onclick = () => use(b.dataset.use));
    $app.querySelectorAll('[data-ren]').forEach(b => b.onclick = () => {
      const c = customOf(b.dataset.ren); const n = prompt('词书名称', c ? c.name : '');
      if (!c || !n || !n.trim()) return; c.name = n.trim().slice(0, 40); save(); syncCurrentBook(); views.books();
    });
    $app.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      const id = b.dataset.del; const c = customOf(id); if (!c) return;
      if (!confirm('删除词书「' + c.name + '」及其学习进度？此操作不可撤销。')) return;
      S.customBooks = S.customBooks.filter(x => x.id !== id); delete S.books[id];
      if (S.bookId === id) { S.bookId = INDEX[0] ? INDEX[0].id : ''; BOOK = null; }
      save(); views.books();
    });
    $app.querySelector('#bcreate').onclick = () => {
      const name = ($app.querySelector('#bname').value || '').trim() || '我的词书';
      const words = parseWordList($app.querySelector('#bpaste').value);
      const book = normalizeCustom({ id: newCustomId(), name, words });
      if (!book) return;
      S.customBooks.push(book); S.bookId = book.id; save(); BOOK = null;
      const p = go('books'); const ok = () => { const m = $app.querySelector('#msg'); if (m) m.innerHTML = `<div class="verdict ok">已创建「${esc(book.name)}」，${book.words.length} 个词</div>`; };
      p && p.then ? p.then(ok) : ok();
    };
    const addWords = list => {
      const c = customOf(S.bookId); if (!c) return 0;
      const before = c.words.length;
      const merged = normalizeCustom({ id: c.id, name: c.name, words: c.words.concat(list) });
      c.words = merged.words; save(); syncCurrentBook(); return c.words.length - before;
    };
    const addBtn = $app.querySelector('#aadd');
    if (addBtn) addBtn.onclick = () => {
      const n = addWords([{ word: $app.querySelector('#aw').value, meaning: $app.querySelector('#am').value }]);
      views.books(); const m = $app.querySelector('#msg'); if (m) m.innerHTML = n ? '<div class="verdict ok">已添加</div>' : '<div class="err">没有识别到新单词（需英文，且不要重复）</div>';
    };
    const pasteBtn = $app.querySelector('#ap');
    if (pasteBtn) pasteBtn.onclick = () => {
      const n = addWords(parseWordList($app.querySelector('#apaste').value));
      views.books(); const m = $app.querySelector('#msg'); if (m) m.innerHTML = `<div class="verdict ok">新增 ${n} 个词</div>`;
    };
    const exb = $app.querySelector('#exb');
    if (exb) exb.onclick = () => {
      const c = customOf(S.bookId); if (!c) return;
      const payload = { type: 'dog-verb-book', v: 1, name: c.name, words: c.words };
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' })); a.download = 'dog-verb-book-' + today() + '.json'; a.click();
    };
    const imb = $app.querySelector('#imb');
    if (imb) { imb.onclick = () => $app.querySelector('#imbf').click();
      $app.querySelector('#imbf').onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { const r = importBookText(t); const m = $app.querySelector('#msg'); if (m) m.innerHTML = r.ok ? `<div class="verdict ok">${esc(r.msg)}</div>` : `<div class="err">${esc(r.msg)}</div>`; if (r.ok) views.books(); }); };
    }
  };
  function importBookText(t) {
    let data; try { data = JSON.parse(t); } catch (e) { return { ok: false, msg: '文件不是 JSON' }; }
    const src = Array.isArray(data) ? { name: '导入的词书', words: data } : data;
    if (!src || typeof src !== 'object') return { ok: false, msg: '格式不正确' };
    const words = Array.isArray(src.words) ? src.words : [];
    const book = normalizeCustom({ id: newCustomId(), name: src.name || '导入的词书', words });
    if (!book || !book.words.length) return { ok: false, msg: '没有可用的单词' };
    S.customBooks.push(book); S.bookId = book.id; save(); BOOK = null;
    return { ok: true, msg: '已导入「' + book.name + '」，' + book.words.length + ' 个词' };
  }
  window.__importBook = importBookText;
  views.settings = function () {
    $app.innerHTML = `<h2 class="ph">设置</h2><div class="card"><div class="ctitle">学习设置</div><label class="field">词书<select id="bk">${bookOptions()}</select></label>
      <div class="hint">每本词书的进度分别保存。内置词书切换时才下载（全部词约 1.5 MB）。<a href="#books" onclick="event.preventDefault();__go('books')">管理自助词书</a></div>
      <label class="field">每日新词数<input type="number" id="dn" min="1" max="200" value="${S.settings.dailyNew}"></label>
      <div class="field"><label class="switch"><input type="checkbox" id="ap" ${S.settings.autoPlay ? 'checked' : ''}><i></i> 自动播放发音（英音）</label>${sayBtn('vocabulary')}</div>
      <button class="primary block" id="sv">保存</button></div>
      <div class="card"><div class="ctitle">备份</div><div class="hint">进度保存在本浏览器中。可导出 JSON 文件备份，或在另一台设备导入（也可导入 v1 版导出的文件）。</div>
      <div class="row"><button class="ghost" id="ex">导出进度</button><label><button class="ghost" id="imb">导入进度</button><input type="file" id="im" accept=".json,application/json" style="display:none"></label></div></div>
      <div class="card"><div class="ctitle">危险操作</div><div class="row"><button class="danger" id="rs">清空所有进度</button></div></div><div id="msg"></div>
      <div class="card muted credit">词库：<a href="https://github.com/skywind3000/ECDICT" target="_blank">ECDICT</a>（MIT）、<a href="https://github.com/KyleBing/english-vocabulary" target="_blank">KyleBing/english-vocabulary</a>（BSD-3-Clause）；记忆算法：<a href="https://github.com/open-spaced-repetition/ts-fsrs" target="_blank">ts-fsrs</a>（MIT）；英音发音：有道词典在线音频，失败时用浏览器 en-GB 语音。详见 <a href="LICENSES/THIRD_PARTY_NOTICES.md" target="_blank">第三方许可</a>。小狗形象与界面为原创。</div>`;
    $app.querySelector('#sv').onclick = () => { const n = parseInt($app.querySelector('#dn').value, 10); if (n > 0) S.settings.dailyNew = n; S.settings.autoPlay = $app.querySelector('#ap').checked; S.bookId = $app.querySelector('#bk').value; save();
      const p = go('settings'); const ok = () => { const m = $app.querySelector('#msg'); if (m) m.innerHTML = '<div class="verdict ok">已保存</div>'; }; p && p.then ? p.then(ok) : ok(); };
    $app.querySelector('#ex').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' })); a.download = 'dog-verb-backup-' + today() + '.json'; a.click(); };
    $app.querySelector('#imb').onclick = () => $app.querySelector('#im').click();
    $app.querySelector('#im').onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => importText(t)); };
    $app.querySelector('#rs').onclick = () => { if (confirm('确定清空所有学习进度和宠物数据吗？此操作不可撤销（建议先导出）。')) { S = defaultState(); save(); BOOK = null; go('home'); } };
  };
  function importText(t) {
    let s; try { s = C.migrate(JSON.parse(t)); } catch (err) { alert('文件格式不正确'); return false; }
    if (!confirm('导入会覆盖当前进度，确定吗？')) return false;
    S = normalize(s); save(); BOOK = null; go('home'); return true;
  }
  window.__import = importText;
  window.__state = () => S;
  window.__ready = go((location.hash || '#home').slice(1).split('?')[0] in views ? location.hash.slice(1) : 'home');
})();
