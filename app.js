(function () {
  const C = window.VocabCore, KEY = 'foxVocab.v1';
  const BOOKS = window.VOCAB_BOOKS || [];
  const $app = document.getElementById('app');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => Date.now(), today = () => C.dayKey(now());

  // ---------- 存储 ----------
  function defaultState() {
    return { v: 1, bookId: BOOKS[0] && BOOKS[0].id, settings: { dailyNew: 20 }, books: {}, days: {}, studyDays: [],
      fox: { food: 0, xp: 0, hunger: 80, lastCheck: today(), fed: 0, name: '小狐' } };
  }
  function load() { try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.v === 1) return Object.assign(defaultState(), s); } catch (e) { } return defaultState(); }
  let S = load();
  function save() { localStorage.setItem(KEY, JSON.stringify(S)); }
  function book() { return BOOKS.find(b => b.id === S.bookId) || BOOKS[0]; }
  function bs() { const id = book().id; if (!S.books[id]) S.books[id] = { cards: {}, sentences: {} }; return S.books[id]; }
  function cards() { return bs().cards; }
  function dayStat(k) { k = k || today(); if (!S.days[k]) S.days[k] = { new: 0, review: 0, correct: 0, wrong: 0 }; return S.days[k]; }
  function markStudied() { const k = today(); if (!S.studyDays.includes(k)) S.studyDays.push(k); }
  S.fox = C.applyHunger(S.fox, S.studyDays, today()); save();

  const W = () => book().words;
  const byWord = w => W().find(x => x.word === w);
  const learned = () => W().filter(w => cards()[w.word]);
  const unlearned = () => W().filter(w => !cards()[w.word]);
  const dueList = () => W().filter(w => C.isDue(cards()[w.word], now())).sort((a, b) => cards()[a.word].due - cards()[b.word].due);
  const masteredCount = () => W().filter(w => cards()[w.word] && cards()[w.word].mastered).length;
  const newLeftToday = () => Math.max(0, S.settings.dailyNew - dayStat().new);

  function speak(word) {
    if (!('speechSynthesis' in window)) return false;
    try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(word); u.lang = 'en-US'; u.rate = 0.9; speechSynthesis.speak(u); return true; } catch (e) { return false; }
  }
  window.__speak = speak;

  // 记录答题，喂给间隔重复
  function record(w, correct) {
    const cs = cards(); let card = cs[w.word]; let msg = '';
    const d = dayStat(); correct ? d.correct++ : d.wrong++; markStudied();
    if (!card) { save(); return '（未学词，不计入复习计划）'; }
    const wasDue = C.isDue(card, now());
    const r = C.grade(card, correct, now()); cs[w.word] = r.card;
    if (wasDue) d.review++;
    if (r.event === 'advance') { if (r.card.stage >= 2) { S.fox.food += 1; msg = '复习成功，获得 1 份狐粮 🍖；'; } msg += '下次复习：' + C.INTERVAL_LABELS[r.card.stage] + '后'; }
    else if (r.event === 'mastered') { S.fox.food += 5; msg = '🎉 已掌握！获得 5 份狐粮 🍖'; }
    else if (r.event === 'lapse') msg = '答错了，已缩短间隔：5分钟后再复习';
    else msg = '（未到复习时间的额外练习，不改变复习计划）';
    save(); return msg;
  }

  // ---------- 题目 ----------
  function pick(arr, n, exclude) { return C.shuffle(arr.filter(x => !exclude.includes(x))).slice(0, n); }
  function makeQ(w, type) {
    const all = W(); const others = all.filter(x => x.word !== w.word);
    const ex = w.examples[0];
    switch (type) {
      case 'w2m': { const o = C.shuffle([w].concat(pick(others.filter(x => x.meaning !== w.meaning), 3, []))); return { title: '看词选意', prompt: `<div class="word">${esc(w.word)}</div><div class="muted">${esc(w.ipa)} <button onclick="__speak('${esc(w.word)}')">🔊</button></div>`, options: o.map(x => ({ label: x.pos + ' ' + x.meaning, ok: x === w })), say: w.word }; }
      case 'm2w': { const o = C.shuffle([w].concat(pick(others, 3, []))); return { title: '看意选词', prompt: `<div class="word">${esc(w.meaning)}</div><div class="muted">${esc(w.pos)}</div>`, options: o.map(x => ({ label: x.word, ok: x === w })) }; }
      case 'pos': { const o = C.shuffle([w].concat(pick(others.filter(x => x.pos !== w.pos), 3, []))); return { title: '看词性选词', prompt: `<div>请选出词性为 <b>${esc(w.pos)}</b> 且意为下列含义的词：</div><div class="word">${esc(w.meaning)}</div><div class="muted">提示：其余选项都是其他词性的词</div>`, options: o.map(x => ({ label: x.word + '  (' + (x === w ? '?' : '?') + ')', ok: x === w, reveal: x.word + '  ' + x.pos + ' ' + x.meaning })) }; }
      case 'clozeChoice': { const cz = C.makeCloze(ex, w.word); const o = C.shuffle([w].concat(pick(others.filter(x => x.pos === w.pos), 3, []))); return { title: '例句填空（选择）', prompt: `<div style="font-size:19px">${esc(cz.text)}</div><div class="muted">选出空格处单词的原形</div>`, options: o.map(x => ({ label: x.word, ok: x === w })) }; }
      case 'clozeType': { const cz = C.makeCloze(ex, w.word); return { title: '例句填空（拼写）', prompt: `<div style="font-size:19px">${esc(cz.text)}</div><div class="muted">提示：${esc(w.pos)} ${esc(w.meaning)}，首字母 ${esc(cz.answer[0])}；可填句中形式或原形</div>`, typed: [cz.answer, w.word] }; }
      case 'dictation': { const can = 'speechSynthesis' in window; return { title: '听音默写', prompt: `<div><button class="primary" onclick="__speak('${esc(w.word)}')">🔊 再听一遍</button></div><div class="muted">${can ? '听发音写出单词' : '当前浏览器不支持发音，按音标写出单词'}：${esc(w.ipa)}　${esc(w.pos)}</div>`, typed: [w.word], say: w.word }; }
      case 'meaningType': return { title: '看意默写', prompt: `<div class="word">${esc(w.meaning)}</div><div class="muted">${esc(w.pos)}　共 ${w.word.length} 个字母</div>`, typed: [w.word] };
    }
  }
  const TYPES = { w2m: '看词选意', m2w: '看意选词', pos: '看词性选词', clozeChoice: '例句填空（选择）', clozeType: '例句填空（拼写）', dictation: '听音默写', meaningType: '看意默写' };

  function detail(w) {
    return `<div><b style="font-size:20px">${esc(w.word)}</b> <span class="muted">${esc(w.ipa)}</span> <button onclick="__speak('${esc(w.word)}')">🔊</button></div><div>${esc(w.pos)} ${esc(w.meaning)}</div>` + w.examples.map(e => `<div class="muted">例：${esc(e)}</div>`).join('');
  }

  // 显示一道题；done(correct) 后调用 next()
  function showQ(container, w, type, next) {
    const q = makeQ(w, type);
    container.innerHTML = `<div class="card"><div class="muted">${q.title}</div>${q.prompt}<div id="ans"></div><div id="fb"></div></div>`;
    const ans = container.querySelector('#ans'), fb = container.querySelector('#fb');
    if (q.say) setTimeout(() => speak(q.say), 200);
    function finish(ok) {
      const m = record(w, ok);
      fb.innerHTML = `<div class="${ok ? 'ok' : 'err'}" style="margin-top:8px"><b>${ok ? '✔ 正确' : '✘ 错误'}</b> ${esc(m)}</div><div class="card">${detail(w)}</div><button class="primary" id="nx">下一个 →</button>`;
      const b = fb.querySelector('#nx'); b.onclick = next; b.focus();
    }
    if (q.options) {
      ans.className = 'opts';
      q.options.forEach(o => { const b = document.createElement('button'); b.textContent = type === 'pos' ? o.label.replace(/\s+\(\?\)$/, '') : o.label; b.onclick = () => {
        [...ans.children].forEach((c, i) => { c.disabled = true; if (q.options[i].ok) c.classList.add('right'); if (type === 'pos') c.textContent = q.options[i].reveal; });
        if (!o.ok) b.classList.add('wrong'); finish(o.ok); }; ans.appendChild(b); });
    } else {
      ans.innerHTML = `<div class="row"><input type="text" id="inp" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="输入英文单词"><button class="primary" id="sub">提交</button><button id="skip">不会</button></div>`;
      const inp = ans.querySelector('#inp'); inp.focus();
      const go = (give) => { if (inp.disabled) return; inp.disabled = true; const ok = !give && q.typed.some(t => C.answerMatch(inp.value, t)); if (!ok) fb.innerHTML = ''; finish(ok); if (!ok) fb.insertAdjacentHTML('afterbegin', `<div>正确答案：<b>${esc(q.typed[0])}</b>${inp.value ? '，你的答案：' + esc(inp.value) : ''}</div>`); };
      ans.querySelector('#sub').onclick = () => go(false); ans.querySelector('#skip').onclick = () => go(true);
      inp.onkeydown = e => { if (e.key === 'Enter') go(false); };
    }
  }

  // ---------- 视图 ----------
  const views = {};
  function go(v, arg) { document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === v)); location.hash = v; (views[v] || views.home)(arg); window.scrollTo(0, 0); }
  document.getElementById('nav').onclick = e => { if (e.target.dataset.view) go(e.target.dataset.view); };
  window.__go = go;

  views.home = function () {
    const d = dayStat(), total = W().length, m = masteredCount(), due = dueList().length;
    const st = C.streak(S.studyDays, today());
    let cal = '';
    const start = C.shiftDay(today(), -27);
    const pad = (new Date(start + 'T12:00:00').getDay() + 6) % 7;
    cal += ['一', '二', '三', '四', '五', '六', '日'].map(x => `<div style="background:none">${x}</div>`).join('') + '<div style="background:none"></div>'.repeat(pad);
    for (let i = 0; i < 28; i++) { const k = C.shiftDay(start, i); cal += `<div class="${S.studyDays.includes(k) ? 'on' : ''}" title="${k}">${+k.slice(8)}</div>`; }
    const acc = d.correct + d.wrong ? Math.round(d.correct / (d.correct + d.wrong) * 100) + '%' : '-';
    $app.innerHTML = `<div class="card"><div class="muted">当前词书：${esc(book().name)}（${total} 词）</div>
    <div class="stats" style="margin-top:8px">
      <div class="stat">今日新学<b>${d.new}/${S.settings.dailyNew}</b></div>
      <div class="stat">待复习<b>${due}</b></div>
      <div class="stat">今日已复习<b>${d.review}</b></div>
      <div class="stat">今日正确率<b>${acc}</b></div>
      <div class="stat">已学<b>${learned().length}</b></div>
      <div class="stat">已掌握<b>${m}</b></div>
      <div class="stat">连续打卡<b>${st} 天</b></div>
      <div class="stat">累计打卡<b>${S.studyDays.length} 天</b></div>
    </div>
    <div style="margin-top:10px">词书进度（掌握）</div><div class="bar"><i style="width:${(m / total * 100).toFixed(1)}%"></i></div>
    <div class="row"><button class="primary" onclick="__go('review')">开始复习（${due}）</button><button class="primary" onclick="__go('learn')">学新词（剩 ${newLeftToday()}）</button><button onclick="__go('preview')">预习</button><button onclick="__go('pet')">看看狐狸（狐粮 ${S.fox.food}）</button></div></div>
    <div class="card"><b>近 28 天打卡</b><div class="cal" style="margin-top:6px">${cal}</div></div>`;
  };

  views.learn = function () {
    const left = newLeftToday(); const list = unlearned();
    if (!list.length) { $app.innerHTML = '<div class="card">🎉 整本词书都学过了！去复习吧。</div>'; return; }
    if (left <= 0) { $app.innerHTML = `<div class="card">今天的 ${S.settings.dailyNew} 个新词已完成 ✅<div class="row"><button class="primary" onclick="__go('review')">去复习（${dueList().length}）</button><button id="more">再加学 5 个</button></div></div>`; $app.querySelector('#more').onclick = () => { S.settings.dailyNew += 5; save(); views.learn(); }; return; }
    const w = list[0];
    $app.innerHTML = `<div class="card"><div class="muted">学新词　今日 ${dayStat().new + 1}/${S.settings.dailyNew}</div><div class="word">${esc(w.word)}</div><div class="muted">${esc(w.ipa)} <button onclick="__speak('${esc(w.word)}')">🔊</button></div>
      <div id="reveal"><button class="primary" id="show">想一想，然后查看释义</button></div></div>`;
    speak(w.word);
    $app.querySelector('#show').onclick = () => {
      $app.querySelector('#reveal').innerHTML = `<div style="margin-top:8px">${esc(w.pos)} ${esc(w.meaning)}</div>${w.examples.map(e => `<div class="muted">例：${esc(e)}</div>`).join('')}
      <div class="row"><button class="primary" id="ok">记住了，加入复习计划</button><button id="known">太熟了，直接标为掌握</button></div><div class="muted">加入后 5 分钟、30 分钟、1、2、4、7、15 天各复习一次，第 15 天那次答对即「掌握」。</div>`;
      const add = (known) => { cards()[w.word] = known ? C.markKnown(null, now()) : C.newCard(now()); dayStat().new++; markStudied(); if (known) S.fox.food += 5; save(); views.learn(); };
      $app.querySelector('#ok').onclick = () => add(false); $app.querySelector('#known').onclick = () => add(true);
    };
  };

  function quizLoop(getWord, typeFor, emptyHtml, header) {
    const w = getWord();
    if (!w) { $app.innerHTML = emptyHtml(); return; }
    $app.innerHTML = `<div class="muted">${header()}</div><div id="q"></div>`;
    showQ($app.querySelector('#q'), w, typeFor(w), () => quizLoop(getWord, typeFor, emptyHtml, header));
  }
  const REVIEW_TYPES = ['w2m', 'm2w', 'clozeChoice', 'meaningType', 'clozeType', 'pos'];
  views.review = function () {
    quizLoop(() => dueList()[0], () => REVIEW_TYPES[Math.floor(Math.random() * REVIEW_TYPES.length)],
      () => { const next = W().map(w => cards()[w.word]).filter(c => c && !c.mastered).sort((a, b) => a.due - b.due)[0];
        const t = next ? Math.ceil((next.due - now()) / 60000) : null;
        return `<div class="card">✅ 当前没有到期的复习。${t !== null ? `下一个复习在约 ${t < 120 ? t + ' 分钟' : Math.round(t / 60) + ' 小时'}后。` : ''}<div class="row"><button class="primary" onclick="__go('learn')">学新词</button><button onclick="__go('practice')">自由练习</button></div></div>`; },
      () => `今日回顾 · 剩余 ${dueList().length} 个到期`);
  };

  views.preview = function () {
    const left = newLeftToday(), un = unlearned();
    const todayW = un.slice(0, left), tomorrow = un.slice(left, left + S.settings.dailyNew);
    const tEnd = new Date(C.shiftDay(today(), 1) + 'T23:59:59').getTime();
    const dueTomorrow = W().filter(w => { const c = cards()[w.word]; return c && !c.mastered && c.due <= tEnd; }).length;
    const list = arr => arr.map(w => `<div class="card">${detail(w)}</div>`).join('') || '<div class="muted">无</div>';
    $app.innerHTML = `<div class="card">明天（截至明晚）预计需复习 <b>${dueTomorrow}</b> 个词；今天还剩 <b>${todayW.length}</b> 个新词未学。</div>
      <h3>今日待学新词（${todayW.length}）</h3>${list(todayW)}<h3>明日新词预习（${tomorrow.length}）</h3>${list(tomorrow)}`;
  };

  views.practice = function (mode) {
    if (!mode) {
      $app.innerHTML = `<div class="card"><b>选择练习模式</b><div class="muted">优先出到期待复习的词，其次随机出已学过的词。所有结果都会计入复习计划（未到期的词答对不会提前升级，答错会缩短间隔）。</div><div class="opts">${Object.entries(TYPES).map(([k, v]) => `<button data-m="${k}">${v}</button>`).join('')}<button data-m="mix">混合模式</button></div></div>`;
      $app.querySelectorAll('[data-m]').forEach(b => b.onclick = () => views.practice(b.dataset.m)); return;
    }
    let last = null;
    const getWord = () => { const d = dueList(); if (d.length) return d[0]; const l = learned().filter(w => w !== last); const w = l.length ? l[Math.floor(Math.random() * l.length)] : learned()[0]; last = w; return w; };
    const keys = Object.keys(TYPES);
    quizLoop(getWord, () => mode === 'mix' ? keys[Math.floor(Math.random() * keys.length)] : mode,
      () => `<div class="card">还没有学过的词，先去学几个新词吧。<div class="row"><button class="primary" onclick="__go('learn')">学新词</button></div></div>`,
      () => `练习：${mode === 'mix' ? '混合模式' : TYPES[mode]} <button onclick="__go('practice')">换模式</button>`);
  };

  views.sentence = function (wordArg) {
    const l = learned(); const pool = l.length ? l : W();
    const w = (wordArg && byWord(wordArg)) || pool[Math.floor(Math.random() * pool.length)];
    const mine = bs().sentences[w.word] || [];
    $app.innerHTML = `<div class="card"><div class="muted">造句（离线检查：含目标词或变形、≥5 个词、首字母大写、句末标点）</div>
      <div class="word">${esc(w.word)}</div><div>${esc(w.ipa)} ${esc(w.pos)} ${esc(w.meaning)} <button onclick="__speak('${esc(w.word)}')">🔊</button></div>
      <textarea id="s" rows="3" placeholder="用 ${esc(w.word)} 写一个英文句子"></textarea>
      <div class="row"><button class="primary" id="chk">检查并保存</button><button id="ref">看参考例句</button><button id="nxt">换一个词</button>
      <input type="text" id="pickw" placeholder="指定单词" style="width:140px"><button id="pk">指定</button></div><div id="fb"></div>
      <div id="refbox"></div><h4>我为这个词写过的句子（${mine.length}）</h4>${mine.map(s => `<div class="card">${esc(s.text)} <span class="muted">${s.date}</span></div>`).join('') || '<div class="muted">暂无</div>'}</div>`;
    $app.querySelector('#ref').onclick = () => $app.querySelector('#refbox').innerHTML = w.examples.map(e => `<div class="muted">参考：${esc(e)}</div>`).join('');
    $app.querySelector('#nxt').onclick = () => views.sentence();
    $app.querySelector('#pk').onclick = () => { const v = C.norm($app.querySelector('#pickw').value); if (byWord(v)) views.sentence(v); else alert('词书中没有这个词'); };
    $app.querySelector('#chk').onclick = () => {
      const t = $app.querySelector('#s').value.trim(); const r = C.checkSentence(t, w.word); const fb = $app.querySelector('#fb');
      if (!r.ok) { fb.innerHTML = r.errors.map(e => `<div class="err">✘ ${esc(e)}</div>`).join(''); return; }
      (bs().sentences[w.word] = bs().sentences[w.word] || []).push({ text: t, date: today() });
      const m = record(w, true); views.sentence(w.word);
      $app.querySelector('#fb').innerHTML = `<div class="ok">✔ 句子格式检查通过，已保存。${esc(m)}</div><div class="muted">注：离线检查只看格式和是否用到该词，不判断语法与用法是否地道，请对照参考例句。</div>`;
    };
  };

  views.pet = function () {
    S.fox = C.applyHunger(S.fox, S.studyDays, today()); save();
    const f = S.fox, total = W().length, m = masteredCount();
    const age = C.foxAge(m, total), stg = C.foxStage(age.months), lv = C.foxLevel(f.xp);
    const nextXp = Math.pow(lv, 2) * 20, curXp = Math.pow(lv - 1, 2) * 20;
    const size = 48 + Math.min(1, age.months / 12) * 72;
    $app.innerHTML = `<div class="card"><div class="fox" style="font-size:${size}px">${stg.emoji}</div>
      <div style="text-align:center"><b>${esc(f.name)}</b> · ${stg.name} · 月龄 <b>${age.label}</b> · Lv.${lv} · 心情：${C.foxMood(f.hunger)}</div>
      <div style="margin-top:10px">年龄（掌握 ${m}/${total} 词 → 1岁）</div><div class="bar"><i style="width:${(age.years * 100).toFixed(1)}%"></i></div>
      <div style="margin-top:6px">饱食度 ${f.hunger}/100</div><div class="bar"><i style="width:${f.hunger}%"></i></div>
      <div style="margin-top:6px">经验 ${f.xp}（下一级 ${nextXp}）</div><div class="bar"><i style="width:${((f.xp - curXp) / (nextXp - curXp) * 100).toFixed(1)}%"></i></div>
      <div class="row"><span>🍖 狐粮：<b>${f.food}</b></span><button class="primary" id="f1" ${f.food ? '' : 'disabled'}>喂 1 份</button><button id="fa" ${f.food ? '' : 'disabled'}>全部喂掉</button><button id="rn">改名</button></div>
      <div id="msg"></div>
      <div class="muted" style="margin-top:10px">规则：复习答对（1 天及以上间隔）+1 狐粮；单词「掌握」+5 狐粮。喂 1 份 = 饱食度 +10、经验 +10。哪天没学习，饱食度 −${C.HUNGER_PER_DAY}。月龄只由掌握词数决定：整本词书全部掌握 = 1岁（12 个月）。成长阶段：幼崽(&lt;2月)→少年(2月)→青年(6月)→成年(1岁)。累计喂食 ${f.fed || 0} 次。</div></div>`;
    const doFeed = (n) => { let c = 0; while (c < n) { const r = C.feed(S.fox); if (!r.ok) break; S.fox = r.fox; c++; } save(); views.pet(); $app.querySelector('#msg').innerHTML = `<div class="ok">喂了 ${c} 份，小狐狸很满足 🦊💕</div>`; };
    $app.querySelector('#f1').onclick = () => doFeed(1); $app.querySelector('#fa').onclick = () => doFeed(f.food);
    $app.querySelector('#rn').onclick = () => { const n = prompt('给狐狸起个名字', f.name); if (n) { S.fox.name = n.slice(0, 20); save(); views.pet(); } };
  };

  views.words = function () {
    const rows = W().map((w, i) => { const c = cards()[w.word]; const st = !c ? '未学' : c.mastered ? '✅掌握' : '阶段' + c.stage + '（' + C.INTERVAL_LABELS[c.stage] + '）';
      const due = c && !c.mastered ? new Date(c.due).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      return `<tr data-q="${esc((w.word + w.meaning).toLowerCase())}"><td>${i + 1}</td><td><b>${esc(w.word)}</b></td><td>${esc(w.pos)} ${esc(w.meaning)}</td><td>${st}</td><td>${due}</td><td><button data-s="${esc(w.word)}">造句</button></td></tr>`; }).join('');
    $app.innerHTML = `<div class="card"><input type="text" id="q" placeholder="搜索单词或中文"><table><tr><th>#</th><th>单词</th><th>释义</th><th>状态</th><th>下次复习</th><th></th></tr>${rows}</table></div>`;
    $app.querySelector('#q').oninput = e => { const v = e.target.value.toLowerCase(); $app.querySelectorAll('tr[data-q]').forEach(r => r.style.display = r.dataset.q.includes(v) ? '' : 'none'); };
    $app.querySelectorAll('[data-s]').forEach(b => b.onclick = () => go('sentence', b.dataset.s));
  };

  views.settings = function () {
    $app.innerHTML = `<div class="card"><b>学习设置</b><div class="row">词书：<select id="bk">${BOOKS.map(b => `<option value="${b.id}" ${b.id === book().id ? 'selected' : ''}>${esc(b.name)}（${b.words.length}）</option>`).join('')}</select></div>
      <div class="row">每日新词数：<input type="number" id="dn" min="1" max="200" value="${S.settings.dailyNew}" style="width:80px"><button class="primary" id="sv">保存</button></div></div>
      <div class="card"><b>备份</b><div class="muted">进度保存在本浏览器中。可导出 JSON 文件备份，或在另一台设备导入。</div>
      <div class="row"><button id="ex">导出进度</button><label><button id="imb">导入进度</button><input type="file" id="im" accept=".json,application/json" style="display:none"></label></div></div>
      <div class="card"><b>危险操作</b><div class="row"><button id="rs">清空所有进度</button></div></div><div id="msg"></div>`;
    $app.querySelector('#sv').onclick = () => { const n = parseInt($app.querySelector('#dn').value, 10); if (n > 0) S.settings.dailyNew = n; S.bookId = $app.querySelector('#bk').value; save(); $app.querySelector('#msg').innerHTML = '<div class="ok">已保存</div>'; };
    $app.querySelector('#ex').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' })); a.download = 'fox-vocab-backup-' + today() + '.json'; a.click(); };
    $app.querySelector('#imb').onclick = () => $app.querySelector('#im').click();
    $app.querySelector('#im').onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { try { const s = JSON.parse(t); if (s.v !== 1 || !s.books) throw 0; if (!confirm('导入会覆盖当前进度，确定吗？')) return; S = Object.assign(defaultState(), s); save(); go('home'); } catch (err) { alert('文件格式不正确'); } }); };
    $app.querySelector('#rs').onclick = () => { if (confirm('确定清空所有学习进度和宠物数据吗？此操作不可撤销（建议先导出）。')) { S = defaultState(); save(); go('home'); } };
  };

  window.__state = () => S;
  go((location.hash || '#home').slice(1).split('?')[0] in views ? location.hash.slice(1) : 'home');
})();
