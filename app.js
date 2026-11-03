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
  function loadBook(id) {
    if (LOADED[id]) return Promise.resolve(LOADED[id]);
    const meta = INDEX.find(b => b.id === id) || INDEX[0];
    if (LOADED[meta.id]) return Promise.resolve(LOADED[meta.id]);
    if (!pending[meta.id]) pending[meta.id] = (window.__bookLoader || defaultLoader)(meta.file).then(() => { if (!LOADED[meta.id]) throw new Error('book missing'); return LOADED[meta.id]; }).finally(() => delete pending[meta.id]);
    return pending[meta.id];
  }
  window.__loadedBooks = () => Object.keys(LOADED);

  // ---------- 存储 ----------
  function defaultState() {
    return { v: 2, bookId: INDEX[0] && INDEX[0].id, settings: { dailyNew: 20, autoPlay: true }, books: {}, days: {}, studyDays: [],
      fox: { food: 0, xp: 0, hunger: 80, lastCheck: today(), fed: 0, name: '小狐' } };
  }
  function normalize(s) { const d = defaultState(); const o = Object.assign(d, s); o.settings = Object.assign(defaultState().settings, s.settings || {}); o.fox = Object.assign(defaultState().fox, s.fox || {}); if (!INDEX.find(b => b.id === o.bookId)) o.bookId = d.bookId; return o; }
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
  const sayBtn = w => `<button class="say" onclick="__speak('${esc(w)}')" title="英音发音">🔊 发音</button>`;

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
    if (r.event === 'advance') { if (r.card.scheduled_days >= 1) { S.fox.food += 1; msg = '复习成功，获得 1 份狐粮 🍖；'; } msg += nxt; }
    else if (r.event === 'mastered') { S.fox.food += 5; msg = '🎉 已掌握（复习间隔 ≥ ' + C.MASTER_DAYS + ' 天）！获得 5 份狐粮 🍖；' + nxt; }
    else if (r.event === 'lapse') msg = '答错了，记忆强度下调：' + nxt;
    else msg = '（未到复习时间的额外练习，不改变复习计划）';
    save(); return msg;
  }

  // ---------- 题目 ----------
  function pick(arr, n, exclude) { return C.shuffle(arr.filter(x => !exclude.includes(x))).slice(0, n); }
  function sample(arr, n, pred) { const out = []; const seen = new Set(); for (let i = 0; i < 400 && out.length < n; i++) { const x = arr[Math.floor(Math.random() * arr.length)]; if (!seen.has(x) && pred(x)) { seen.add(x); out.push(x); } } return out; }
  const CLOZE = ['clozeChoice', 'clozeType'];
  function makeQ(w, type) {
    const all = W(); const ex = w.examples && w.examples[0];
    const others = (n, pred) => sample(all, n, x => x.word !== w.word && (!pred || pred(x)));
    switch (type) {
      case 'w2m': { const o = C.shuffle([w].concat(others(3, x => x.meaning !== w.meaning))); return { title: '看词选意', prompt: `<div class="word">${esc(w.word)}</div><div class="muted">${esc(w.ipa)} ${sayBtn(w.word)}</div>`, options: o.map(x => ({ label: x.pos + ' ' + x.meaning, ok: x === w })), say: w.word }; }
      case 'm2w': { const o = C.shuffle([w].concat(others(3))); return { title: '看意选词', prompt: `<div class="word">${esc(w.meaning)}</div><div class="muted">${esc(w.pos)}</div>`, options: o.map(x => ({ label: x.word, ok: x === w })) }; }
      case 'pos': { const o = C.shuffle([w].concat(others(3, x => x.pos !== w.pos))); return { title: '看词性选词', prompt: `<div>请选出词性为 <b>${esc(w.pos)}</b> 且意为下列含义的词：</div><div class="word">${esc(w.meaning)}</div><div class="muted">提示：其余选项都是其他词性的词</div>`, options: o.map(x => ({ label: x.word, ok: x === w, reveal: x.word + '  ' + x.pos + ' ' + x.meaning })) }; }
      case 'clozeChoice': { const cz = C.makeCloze(ex, w.word); const o = C.shuffle([w].concat(others(3, x => x.pos === w.pos))); return { title: '例句填空（选择）', prompt: `<div style="font-size:19px">${esc(cz.text)}</div><div class="muted">选出空格处单词的原形</div>`, options: o.map(x => ({ label: x.word, ok: x === w })) }; }
      case 'clozeType': { const cz = C.makeCloze(ex, w.word); return { title: '例句填空（拼写）', prompt: `<div style="font-size:19px">${esc(cz.text)}</div><div class="muted">提示：${esc(w.pos)} ${esc(w.meaning)}，首字母 ${esc(cz.answer[0])}；可填句中形式或原形</div>`, typed: [cz.answer, w.word] }; }
      case 'dictation': return { title: '听音默写（英音）', prompt: `<div><button class="primary" onclick="__speak('${esc(w.word)}')">🔊 再听一遍</button></div><div class="muted">听发音写出单词：${esc(w.ipa)}　${esc(w.pos)}</div>`, typed: [w.word], say: w.word, forceSay: true };
      case 'meaningType': return { title: '看意默写', prompt: `<div class="word">${esc(w.meaning)}</div><div class="muted">${esc(w.pos)}　共 ${w.word.length} 个字母</div>`, typed: [w.word] };
      case 'flash': return { title: '单词卡', prompt: `<div class="word">${esc(w.word)}</div><div class="muted">${esc(w.ipa)} ${sayBtn(w.word)}</div>`, flash: true, say: w.word };
    }
  }
  const TYPES = { flash: '单词卡（自评）', w2m: '看词选意', m2w: '看意选词', pos: '看词性选词', clozeChoice: '例句填空（选择）', clozeType: '例句填空（拼写）', dictation: '听音默写', meaningType: '看意默写' };
  const typeOk = (w, t) => !CLOZE.includes(t) || C.hasExample(w);

  function detail(w) {
    return `<div><b style="font-size:20px">${esc(w.word)}</b> <span class="muted">${esc(w.ipa)}</span> ${sayBtn(w.word)}</div><div>${esc(w.pos)} ${esc(w.meaning)}</div>` + (w.examples || []).map(e => `<div class="muted">例：${esc(e)}</div>`).join('');
  }
  function gradeButtons(card) {
    const p = C.preview(card, now());
    return `<div class="row grades">${[1, 2, 3, 4].map(g => `<button class="${g === 3 ? 'primary' : ''}" data-g="${g}">${C.RATING_LABELS[g]}<small>${C.fmtInterval(p[g])}</small></button>`).join('')}</div>`;
  }

  function showQ(container, w, type, next) {
    const q = makeQ(w, type);
    container.innerHTML = `<div class="card"><div class="muted">${q.title}</div>${q.prompt}<div id="ans"></div><div id="fb"></div></div>`;
    const ans = container.querySelector('#ans'), fb = container.querySelector('#fb');
    if (q.say && (q.forceSay || S.settings.autoPlay)) setTimeout(() => speak(q.say), 200);
    function finish(rating, pre) {
      const ok = rating > 1; const m = record(w, rating);
      fb.innerHTML = (pre || '') + `<div class="${ok ? 'ok' : 'err'}" style="margin-top:8px"><b>${q.flash ? C.RATING_LABELS[rating] : ok ? '✔ 正确' : '✘ 错误'}</b> ${esc(m)}</div><div class="card">${detail(w)}</div><button class="primary" id="nx">下一个 →</button>`;
      const b = fb.querySelector('#nx'); b.onclick = next; b.focus();
    }
    if (q.flash) {
      ans.innerHTML = `<button class="primary" id="show">想一想，然后查看释义</button>`;
      ans.querySelector('#show').onclick = () => {
        ans.innerHTML = `<div class="card">${detail(w)}</div><div class="muted">你记得怎么样？</div>` + gradeButtons(cards()[w.word]);
        ans.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { ans.innerHTML = ''; finish(+b.dataset.g); });
      };
    } else if (q.options) {
      ans.className = 'opts';
      q.options.forEach(o => { const b = document.createElement('button'); b.textContent = o.label; b.onclick = () => {
        [...ans.children].forEach((c, i) => { c.disabled = true; if (q.options[i].ok) c.classList.add('right'); if (q.options[i].reveal) c.textContent = q.options[i].reveal; });
        if (!o.ok) b.classList.add('wrong'); finish(o.ok ? C.Rating.Good : C.Rating.Again); }; ans.appendChild(b); });
    } else {
      ans.innerHTML = `<div class="row"><input type="text" id="inp" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="输入英文单词"><button class="primary" id="sub">提交</button><button id="skip">不会</button></div>`;
      const inp = ans.querySelector('#inp'); inp.focus();
      const go = (give) => { if (inp.disabled) return; inp.disabled = true; const ok = !give && q.typed.some(t => C.answerMatch(inp.value, t));
        finish(ok ? C.Rating.Good : C.Rating.Again, ok ? '' : `<div>正确答案：<b>${esc(q.typed[0])}</b>${inp.value ? '，你的答案：' + esc(inp.value) : ''}</div>`); };
      ans.querySelector('#sub').onclick = () => go(false); ans.querySelector('#skip').onclick = () => go(true);
      inp.onkeydown = e => { if (e.key === 'Enter') go(false); };
    }
  }

  // ---------- 视图 ----------
  const views = {};
  let navSeq = 0;
  function go(v, arg) {
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    location.hash = v; const seq = ++navSeq;
    const render = () => { if (seq !== navSeq) return; (views[v] || views.home)(arg); window.scrollTo(0, 0); };
    if (BOOK && BOOK.id === S.bookId) return render();
    $app.innerHTML = '<div class="card">正在加载词书…</div>';
    return loadBook(S.bookId).then(b => { BOOK = b; S.bookId = b.id; render(); }).catch(e => { $app.innerHTML = `<div class="card err">词书加载失败，请检查网络后刷新页面。（${esc(e.message)}）</div>`; });
  }
  document.getElementById('nav').onclick = e => { if (e.target.dataset.view) go(e.target.dataset.view); };
  window.__go = go;

  views.home = function () {
    const d = dayStat(), total = W().length, m = masteredCount(), due = dueList().length;
    const st = C.streak(S.studyDays, today());
    let cal = ''; const start = C.shiftDay(today(), -27); const pad = (new Date(start + 'T12:00:00').getDay() + 6) % 7;
    cal += ['一', '二', '三', '四', '五', '六', '日'].map(x => `<div style="background:none">${x}</div>`).join('') + '<div style="background:none"></div>'.repeat(pad);
    for (let i = 0; i < 28; i++) { const k = C.shiftDay(start, i); cal += `<div class="${S.studyDays.includes(k) ? 'on' : ''}" title="${k}">${+k.slice(8)}</div>`; }
    const acc = d.correct + d.wrong ? Math.round(d.correct / (d.correct + d.wrong) * 100) + '%' : '-';
    $app.innerHTML = `<div class="card"><div class="muted">当前词书：${esc(BOOK.name)}（${total} 词）</div>
    <div class="stats" style="margin-top:8px">
      <div class="stat">今日新学<b>${d.new}/${S.settings.dailyNew}</b></div><div class="stat">待复习<b>${due}</b></div>
      <div class="stat">今日已复习<b>${d.review}</b></div><div class="stat">今日正确率<b>${acc}</b></div>
      <div class="stat">已学<b>${learned().length}</b></div><div class="stat">已掌握<b>${m}</b></div>
      <div class="stat">连续打卡<b>${st} 天</b></div><div class="stat">累计打卡<b>${S.studyDays.length} 天</b></div>
    </div>
    <div style="margin-top:10px">词书进度（掌握）</div><div class="bar"><i style="width:${(m / total * 100).toFixed(1)}%"></i></div>
    <div class="row"><button class="primary" onclick="__go('review')">开始复习（${due}）</button><button class="primary" onclick="__go('learn')">学新词（剩 ${newLeftToday()}）</button><button onclick="__go('preview')">预习</button><button onclick="__go('pet')">看看狐狸（狐粮 ${S.fox.food}）</button></div>
    ${S.migratedFrom === 1 ? '<div class="muted">已从 v1 自动迁移学习进度到 FSRS 记忆算法（原数据已备份）。</div>' : ''}</div>
    <div class="card"><b>近 28 天打卡</b><div class="cal" style="margin-top:6px">${cal}</div></div>`;
  };

  views.learn = function () {
    const left = newLeftToday(); const list = unlearned();
    if (!list.length) { $app.innerHTML = '<div class="card">🎉 整本词书都学过了！去复习吧。</div>'; return; }
    if (left <= 0) { $app.innerHTML = `<div class="card">今天的 ${S.settings.dailyNew} 个新词已完成 ✅<div class="row"><button class="primary" onclick="__go('review')">去复习（${dueList().length}）</button><button id="more">再加学 5 个</button></div></div>`; $app.querySelector('#more').onclick = () => { S.settings.dailyNew += 5; save(); views.learn(); }; return; }
    const w = list[0];
    $app.innerHTML = `<div class="card"><div class="muted">学新词　今日 ${dayStat().new + 1}/${S.settings.dailyNew}</div><div class="word">${esc(w.word)}</div><div class="muted">${esc(w.ipa)} ${sayBtn(w.word)}</div>
      <div id="reveal"><button class="primary" id="show">想一想，然后查看释义</button></div></div>`;
    auto(w.word);
    $app.querySelector('#show').onclick = () => {
      $app.querySelector('#reveal').innerHTML = `<div style="margin-top:8px">${esc(w.pos)} ${esc(w.meaning)}</div>${(w.examples || []).map(e => `<div class="muted">例：${esc(e)}</div>`).join('')}
      <div class="muted" style="margin-top:8px">你对这个词的熟悉程度？（FSRS 会按你的评分安排下次复习）</div>${gradeButtons(null)}
      <div class="row"><button id="known">太熟了，直接标为掌握</button></div>`;
      const add = (rating, known) => { cards()[w.word] = known ? C.markKnown(null, now()) : C.learnCard(rating, now()); dayStat().new++; markStudied(); if (known) S.fox.food += 5; save(); views.learn(); };
      $app.querySelectorAll('[data-g]').forEach(b => b.onclick = () => add(+b.dataset.g, false));
      $app.querySelector('#known').onclick = () => add(0, true);
    };
  };

  function quizLoop(getWord, typeFor, emptyHtml, header) {
    const w = getWord();
    if (!w) { $app.innerHTML = emptyHtml(); return; }
    $app.innerHTML = `<div class="muted">${header()}</div><div id="q"></div>`;
    showQ($app.querySelector('#q'), w, typeFor(w), () => quizLoop(getWord, typeFor, emptyHtml, header));
  }
  const REVIEW_TYPES = ['flash', 'w2m', 'm2w', 'clozeChoice', 'meaningType', 'clozeType', 'pos'];
  const randType = (w, list) => { const ok = list.filter(t => typeOk(w, t)); return ok[Math.floor(Math.random() * ok.length)]; };
  views.review = function () {
    quizLoop(() => dueList()[0], w => randType(w, REVIEW_TYPES),
      () => { const next = learned().map(w => cards()[w.word]).sort((a, b) => a.due - b.due)[0];
        return `<div class="card">✅ 当前没有到期的复习。${next ? `下一个复习在约 ${C.fmtInterval(next.due - now())}后。` : ''}<div class="row"><button class="primary" onclick="__go('learn')">学新词</button><button onclick="__go('practice')">自由练习</button></div></div>`; },
      () => `今日回顾 · 剩余 ${dueList().length} 个到期`);
  };

  views.preview = function () {
    const left = newLeftToday(), un = unlearned();
    const todayW = un.slice(0, left), tomorrow = un.slice(left, left + S.settings.dailyNew);
    const tEnd = new Date(C.shiftDay(today(), 1) + 'T23:59:59').getTime();
    const dueTomorrow = learned().filter(w => cards()[w.word].due <= tEnd).length;
    const list = arr => arr.map(w => `<div class="card">${detail(w)}</div>`).join('') || '<div class="muted">无</div>';
    $app.innerHTML = `<div class="card">明天（截至明晚）预计需复习 <b>${dueTomorrow}</b> 个词；今天还剩 <b>${todayW.length}</b> 个新词未学。</div>
      <h3>今日待学新词（${todayW.length}）</h3>${list(todayW)}<h3>明日新词预习（${tomorrow.length}）</h3>${list(tomorrow)}`;
  };

  views.practice = function (mode) {
    if (!mode) {
      $app.innerHTML = `<div class="card"><b>选择练习模式</b><div class="muted">优先出到期待复习的词，其次随机出已学过的词。到期词的结果计入 FSRS；未到期的词答对不会提前推迟复习，答错会缩短间隔。例句填空只出有例句的词。</div><div class="opts">${Object.entries(TYPES).map(([k, v]) => `<button data-m="${k}">${v}</button>`).join('')}<button data-m="mix">混合模式</button></div></div>`;
      $app.querySelectorAll('[data-m]').forEach(b => b.onclick = () => views.practice(b.dataset.m)); return;
    }
    let last = null; const keys = Object.keys(TYPES);
    const eligible = w => mode === 'mix' || typeOk(w, mode);
    const getWord = () => { const d = dueList().filter(eligible); if (d.length) return d[0]; const l = learned().filter(w => eligible(w) && w !== last); const w = l.length ? l[Math.floor(Math.random() * l.length)] : learned().filter(eligible)[0]; last = w; return w; };
    quizLoop(getWord, w => mode === 'mix' ? randType(w, keys) : mode,
      () => `<div class="card">${CLOZE.includes(mode) ? '还没有学过带例句的词（例句填空只用有例句的词，核心词书前 359 个词都有原创例句）。' : '还没有学过的词，先去学几个新词吧。'}<div class="row"><button class="primary" onclick="__go('learn')">学新词</button><button onclick="__go('practice')">换模式</button></div></div>`,
      () => `练习：${mode === 'mix' ? '混合模式' : TYPES[mode]} <button onclick="__go('practice')">换模式</button>`);
  };

  views.sentence = function (wordArg) {
    const l = learned(); const pool = l.length ? l : W().filter(C.hasExample);
    const w = (wordArg && byWord(wordArg)) || pool[Math.floor(Math.random() * pool.length)];
    const mine = bs().sentences[w.word] || []; const exs = w.examples || [];
    $app.innerHTML = `<div class="card"><div class="muted">造句（离线检查：含目标词或变形、≥5 个词、首字母大写、句末标点）</div>
      <div class="word">${esc(w.word)}</div><div>${esc(w.ipa)} ${esc(w.pos)} ${esc(w.meaning)} ${sayBtn(w.word)}</div>
      <textarea id="s" rows="3" placeholder="用 ${esc(w.word)} 写一个英文句子"></textarea>
      <div class="row"><button class="primary" id="chk">检查并保存</button><button id="ref" ${exs.length ? '' : 'disabled title="该词暂无参考例句"'}>看参考例句${exs.length ? '' : '（无）'}</button><button id="nxt">换一个词</button>
      <input type="text" id="pickw" placeholder="指定单词" style="width:140px"><button id="pk">指定</button></div><div id="fb"></div>
      <div id="refbox"></div><h4>我为这个词写过的句子（${mine.length}）</h4>${mine.map(s => `<div class="card">${esc(s.text)} <span class="muted">${s.date}</span></div>`).join('') || '<div class="muted">暂无</div>'}</div>`;
    $app.querySelector('#ref').onclick = () => $app.querySelector('#refbox').innerHTML = exs.map(e => `<div class="muted">参考：${esc(e)}</div>`).join('');
    $app.querySelector('#nxt').onclick = () => views.sentence();
    $app.querySelector('#pk').onclick = () => { const v = C.norm($app.querySelector('#pickw').value); if (byWord(v)) views.sentence(v); else alert('词书中没有这个词'); };
    $app.querySelector('#chk').onclick = () => {
      const t = $app.querySelector('#s').value.trim(); const r = C.checkSentence(t, w.word); const fb = $app.querySelector('#fb');
      if (!r.ok) { fb.innerHTML = r.errors.map(e => `<div class="err">✘ ${esc(e)}</div>`).join(''); return; }
      (bs().sentences[w.word] = bs().sentences[w.word] || []).push({ text: t, date: today() });
      const m = record(w, C.Rating.Good); views.sentence(w.word);
      $app.querySelector('#fb').innerHTML = `<div class="ok">✔ 句子格式检查通过，已保存。${esc(m)}</div><div class="muted">注：离线检查只看格式和是否用到该词，不判断语法与用法是否地道${exs.length ? '，请对照参考例句' : ''}。</div>`;
    };
  };

  views.pet = function () {
    S.fox = C.applyHunger(S.fox, S.studyDays, today()); save();
    const f = S.fox, total = W().length, m = masteredCount();
    const age = C.foxAge(m, total), stg = C.foxStage(age.months), lv = C.foxLevel(f.xp);
    const nextXp = Math.pow(lv, 2) * 20, curXp = Math.pow(lv - 1, 2) * 20; const size = 48 + Math.min(1, age.months / 12) * 72;
    $app.innerHTML = `<div class="card"><div class="fox" style="font-size:${size}px">${stg.emoji}</div>
      <div style="text-align:center"><b>${esc(f.name)}</b> · ${stg.name} · 月龄 <b>${age.label}</b> · Lv.${lv} · 心情：${C.foxMood(f.hunger)}</div>
      <div style="margin-top:10px">年龄（「${esc(BOOK.name)}」掌握 ${m}/${total} 词 → 1岁）</div><div class="bar"><i style="width:${(age.years * 100).toFixed(1)}%"></i></div>
      <div style="margin-top:6px">饱食度 ${f.hunger}/100</div><div class="bar"><i style="width:${f.hunger}%"></i></div>
      <div style="margin-top:6px">经验 ${f.xp}（下一级 ${nextXp}）</div><div class="bar"><i style="width:${((f.xp - curXp) / (nextXp - curXp) * 100).toFixed(1)}%"></i></div>
      <div class="row"><span>🍖 狐粮：<b>${f.food}</b></span><button class="primary" id="f1" ${f.food ? '' : 'disabled'}>喂 1 份</button><button id="fa" ${f.food ? '' : 'disabled'}>全部喂掉</button><button id="rn">改名</button></div>
      <div id="msg"></div>
      <div class="muted" style="margin-top:10px">规则：到期复习答对且下次间隔 ≥ 1 天 +1 狐粮；单词「掌握」（FSRS 复习间隔达到 ${C.MASTER_DAYS} 天及以上）+5 狐粮，之后答错会失去掌握状态。喂 1 份 = 饱食度 +10、经验 +10。哪天没学习，饱食度 −${C.HUNGER_PER_DAY}。月龄只由当前词书的掌握词数决定：整本词书全部掌握 = 1岁（12 个月）。成长阶段：幼崽(&lt;2月)→少年(2月)→青年(6月)→成年(1岁)。累计喂食 ${f.fed || 0} 次。</div></div>`;
    const doFeed = (n) => { let c = 0; while (c < n) { const r = C.feed(S.fox); if (!r.ok) break; S.fox = r.fox; c++; } save(); views.pet(); $app.querySelector('#msg').innerHTML = `<div class="ok">喂了 ${c} 份，小狐狸很满足 🦊💕</div>`; };
    $app.querySelector('#f1').onclick = () => doFeed(1); $app.querySelector('#fa').onclick = () => doFeed(f.food);
    $app.querySelector('#rn').onclick = () => { const n = prompt('给狐狸起个名字', f.name); if (n) { S.fox.name = n.slice(0, 20); save(); views.pet(); } };
  };

  views.words = function () {
    const LIMIT = 200;
    const row = (w, i) => { const c = cards()[w.word]; const st = !c ? '未学' : (c.mastered ? '✅掌握 · ' : '') + '间隔 ' + C.fmtInterval(Math.max(C.MIN, c.due - (c.last_review || c.due)));
      const due = c ? new Date(c.due).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      return `<tr><td>${i + 1}</td><td><b>${esc(w.word)}</b> <span class="muted">${esc(w.ipa)}</span></td><td>${esc(w.pos)} ${esc(w.meaning)}</td><td>${st}</td><td>${due}</td><td><button data-s="${esc(w.word)}">造句</button></td></tr>`; };
    const render = v => { const all = W(); const hits = []; for (let i = 0; i < all.length && hits.length < LIMIT; i++) { const w = all[i]; if (!v || w.word.includes(v) || w.meaning.includes(v)) hits.push(row(w, i)); }
      $app.querySelector('#tb').innerHTML = `<tr><th>#</th><th>单词</th><th>释义</th><th>状态</th><th>下次复习</th><th></th></tr>` + hits.join('');
      $app.querySelector('#cnt').textContent = `共 ${all.length} 词，最多显示 ${LIMIT} 条，可搜索`; $app.querySelectorAll('[data-s]').forEach(b => b.onclick = () => go('sentence', b.dataset.s)); };
    $app.innerHTML = `<div class="card"><input type="text" id="q" placeholder="搜索单词或中文"><div class="muted" id="cnt"></div><table id="tb"></table></div>`;
    $app.querySelector('#q').oninput = e => render(e.target.value.trim().toLowerCase()); render('');
  };

  views.settings = function () {
    $app.innerHTML = `<div class="card"><b>学习设置</b><div class="row">词书：<select id="bk">${INDEX.map(b => `<option value="${b.id}" ${b.id === S.bookId ? 'selected' : ''}>${esc(b.name)}（${b.count}）</option>`).join('')}</select></div>
      <div class="muted">每本词书的进度分别保存；切换词书时才下载该词书（全部词约 1.5 MB）。</div>
      <div class="row">每日新词数：<input type="number" id="dn" min="1" max="200" value="${S.settings.dailyNew}" style="width:80px"></div>
      <div class="row"><label><input type="checkbox" id="ap" ${S.settings.autoPlay ? 'checked' : ''}> 自动播放发音（英音）</label>${sayBtn('vocabulary')}</div>
      <div class="row"><button class="primary" id="sv">保存</button></div></div>
      <div class="card"><b>备份</b><div class="muted">进度保存在本浏览器中。可导出 JSON 文件备份，或在另一台设备导入（也可导入 v1 版导出的文件）。</div>
      <div class="row"><button id="ex">导出进度</button><label><button id="imb">导入进度</button><input type="file" id="im" accept=".json,application/json" style="display:none"></label></div></div>
      <div class="card"><b>危险操作</b><div class="row"><button id="rs">清空所有进度</button></div></div><div id="msg"></div>
      <div class="card muted credit">词库：<a href="https://github.com/skywind3000/ECDICT" target="_blank">ECDICT</a>（MIT）、<a href="https://github.com/KyleBing/english-vocabulary" target="_blank">KyleBing/english-vocabulary</a>（BSD-3-Clause）；记忆算法：<a href="https://github.com/open-spaced-repetition/ts-fsrs" target="_blank">ts-fsrs</a>（MIT）；英音发音：有道词典在线音频，失败时用浏览器 en-GB 语音。详见 <a href="LICENSES/THIRD_PARTY_NOTICES.md" target="_blank">第三方许可</a>。</div>`;
    $app.querySelector('#sv').onclick = () => { const n = parseInt($app.querySelector('#dn').value, 10); if (n > 0) S.settings.dailyNew = n; S.settings.autoPlay = $app.querySelector('#ap').checked; S.bookId = $app.querySelector('#bk').value; save();
      const p = go('settings'); const ok = () => { const m = $app.querySelector('#msg'); if (m) m.innerHTML = '<div class="ok">已保存</div>'; }; p && p.then ? p.then(ok) : ok(); };
    $app.querySelector('#ex').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' })); a.download = 'fox-vocab-backup-' + today() + '.json'; a.click(); };
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
