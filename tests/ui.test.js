// 无头 UI 测试（jsdom）：用法 NODE_PATH=<含 jsdom 的 node_modules> node tests/ui.test.js
const { JSDOM } = require('jsdom'); const fs = require('fs'); const path = require('path'); const assert = require('assert');
const dir = path.join(__dirname, '..'); let store = {}; let offset = 0; let loads = []; let audios = [];
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
async function boot(setup) {
  const html = read('index.html').replace(/<script src=.*<\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window; const real = w.Date.now; w.Date.now = () => real() + offset;
  Object.defineProperty(w, 'localStorage', { value: { getItem: k => store[k] ?? null, setItem: (k, v) => store[k] = String(v), removeItem: k => delete store[k] } });
  w.alert = () => {}; w.confirm = () => true; w.scrollTo = () => {}; w.prompt = () => null;
  w.Audio = function (src) { audios.push(src); this.src = src; this.play = () => Promise.resolve(); this.pause = () => {}; };
  w.__bookLoader = file => { loads.push(file); w.eval(read(file.split('?')[0])); return Promise.resolve(); };
  if (setup) setup(w);
  for (const f of ['vendor/ts-fsrs.umd.js', 'data/books-index.js', 'data/example-zh.js', 'data/t2s.js', 'core.js', 'app.js']) w.eval(read(f));
  await w.__ready; return w;
}
const q = (w, s) => w.document.querySelector(s), txt = w => w.document.getElementById('app').textContent;
function answer(w) {
  const g = w.document.querySelector('#ans #show'); if (g) { g.click(); w.document.querySelector('[data-g="1"]').click(); }
  else { const btns = [...w.document.querySelectorAll('#ans button')]; if (btns.length) btns[0].click(); else { q(w, '#inp').value = 'zzz'; q(w, '#sub').click(); } }
  q(w, '#nx').click();
}
function passDict(w, value) {
  const inp = q(w, '#inp');
  assert.ok(inp, 'dictation follows the study card');
  inp.value = value == null ? 'zzz' : value;
  q(w, '#sub').click();
  q(w, '#nx').click();
}
function typeFollow(w, key) {
  const inp = q(w, '[data-follow] #inp');
  assert.ok(inp, '跟写 field for ' + key);
  inp.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}
function passFollow(w) {
  const card = q(w, '[data-follow]');
  if (!card) return;
  for (const ch of card.dataset.follow) {
    if (!/[A-Za-z]/.test(ch)) continue;
    typeFollow(w, ch);
  }
}
(async () => {
  // ---- v1 迁移：真实的 v1 localStorage 数据 ----
  const T = Date.now(), D = 86400000, M = 60000;
  const v1 = { v: 1, bookId: 'ielts-toefl-core', settings: { dailyNew: 15 }, days: { '2026-11-01': { new: 3, review: 2, correct: 4, wrong: 1 } },
    studyDays: [], books: { 'ielts-toefl-core': { cards: {
      analyse: { stage: 2, due: T - M, reps: 3, lapses: 0, learnedAt: T - 2 * D, mastered: false, masteredAt: null },
      approach: { stage: 0, due: T + 5 * M, reps: 1, lapses: 1, learnedAt: T - D, mastered: false, masteredAt: null },
      area: { stage: 7, due: T + 30 * D, reps: 8, lapses: 0, learnedAt: T - 60 * D, mastered: true, masteredAt: T - D } },
      sentences: { analyse: [{ text: 'We analyse data every single day.', date: '2026-11-01' }] } } },
    fox: { food: 7, xp: 40, hunger: 90, lastCheck: C_today(), fed: 4, name: '阿狸' } };
  for (let i = 0; i < 5; i++) v1.studyDays.push(C_shift(-i));
  store['foxVocab.v1'] = JSON.stringify(v1);
  let w = await boot();
  assert.strictEqual(store['foxVocab.v1.backup'], JSON.stringify(v1), 'raw v1 backed up');
  let s = w.__state(); assert.strictEqual(s.v, 2); assert.strictEqual(s.settings.dailyNew, 15);
  assert.strictEqual(s.fox.food, 7); assert.strictEqual(s.fox.name, '阿狸'); assert.strictEqual(s.fox.xp, 40);
  assert.strictEqual(s.books['ielts-toefl-core'].sentences.analyse.length, 1);
  assert.ok(txt(w).includes('连续打卡5 天'), 'streak kept'); assert.ok(txt(w).includes('已掌握1'), 'mastered kept'); assert.ok(txt(w).includes('待复习1'));
  assert.strictEqual(w.document.querySelectorAll('.cal .on .paw').length, 5, 'checked days show a paw');
  assert.ok([...w.document.querySelectorAll('.cal .on')].every(el => !/^\d+$/.test(el.textContent.trim())), 'checked days are not number tiles');
  assert.ok(q(w, '.cal .td'), 'today keeps an outline');
  assert.ok(txt(w).includes('已从 v1 自动迁移'));
  // 懒加载：启动只加载核心词书
  assert.deepStrictEqual(loads, ['data/book-ielts-toefl-core.js']); assert.strictEqual(w.__loadedBooks().join(), 'ielts-toefl-core');
  // 复习迁移卡（Good -> 间隔变长）
  w.__go('review'); assert.ok(txt(w).includes('剩余 1 个到期'));
  // 再次打开不重复迁移
  w = await boot(); assert.strictEqual(w.__state().fox.food, 7);
  // 导入 v1 导出文件
  assert.ok(w.__import(JSON.stringify(v1))); await new Promise(r => setTimeout(r, 0)); assert.strictEqual(w.__state().v, 2); assert.strictEqual(w.__state().books['ielts-toefl-core'].cards.area.mastered, true);
  assert.strictEqual(w.__import('{"v":5}'), false);

  // ---- 全新用户 ----
  store = {}; loads = []; w = await boot(); assert.ok(txt(w).includes('今日新学'), 'home renders');
  w.__go('learn'); audios = [];
  for (let i = 0; i < 20; i++) { passFollow(w); q(w, '#show').click(); if (i === 0) q(w, '#known').click(); else q(w, `[data-g="${i % 2 ? 3 : 1}"]`).click(); passDict(w); }
  assert.ok(txt(w).includes('已完成'), 'daily target done');
  assert.strictEqual(Object.keys(w.__state().books['ielts-toefl-core'].cards).length, 20); assert.strictEqual(w.__state().fox.food, 5);
  await new Promise(r => setTimeout(r, 300));
  assert.ok(audios.length >= 1 && audios.every(u => /^https:\/\/dict\.youdao\.com\/dictvoice\?audio=[a-z-]+&type=1$/.test(u)), 'UK audio ' + audios[0]);
  w.__speak('analyse'); assert.strictEqual(w.__lastSpoken.url, 'https://dict.youdao.com/dictvoice?audio=analyse&type=1');
  // 4 档评分按钮
  w.__go('learn'); assert.ok(true);
  w.__go('preview'); assert.ok(txt(w).includes('明日新词预习（20）'));
  // 复习：1 小时后，学习步到期
  offset = 60 * M; w = await boot(); w.__go('review'); const m1 = txt(w).match(/剩余 (\d+) 个到期/); assert.ok(m1 && +m1[1] >= 10, txt(w).slice(0, 80));
  for (let i = 0; i < +m1[1]; i++) answer(w);
  assert.ok(txt(w).includes('剩余') || txt(w).includes('没有到期'));
  // 各练习模式都能出题并作答（包括单词卡、例句填空只用有例句的词）
  for (const m of ['flash', 'w2m', 'm2w', 'pos', 'clozeChoice', 'clozeType', 'dictation', 'meaningType', 'mix']) { w.__go('practice'); q(w, `[data-m="${m}"]`).click(); assert.ok(q(w, '#ans'), m); answer(w); }
  // 单词卡四档
  w.__go('practice'); q(w, '[data-m="flash"]').click(); q(w, '#show').click(); assert.strictEqual([...w.document.querySelectorAll('[data-g]')].map(b => b.firstChild.textContent).join(), ['忘了', '难', '记得', '简单'].join());
  // 造句
  w.__go('sentence', 'analyse'); q(w, '#s').value = 'bad'; q(w, '#chk').click(); assert.ok(txt(w).includes('句首应大写'));
  q(w, '#s').value = 'Scientists analysed the samples carefully last week.'; q(w, '#chk').click();
  assert.ok(txt(w).includes('已保存')); assert.strictEqual(w.__state().books['ielts-toefl-core'].sentences.analyse.length, 1);
  // 无例句的词也能造句
  w.__go('sentence', 'different'); assert.ok(q(w, '#ref').disabled);
  // 宠物
  w.__go('pet'); assert.ok(txt(w).includes('月龄')); const food = w.__state().fox.food; q(w, '#f1').click(); assert.strictEqual(w.__state().fox.food, food - 1); assert.strictEqual(w.__state().fox.xp, 10);
  // 持久化
  w = await boot(); assert.strictEqual(w.__state().fox.xp, 10);
  const h = w.__state().fox.hunger; offset = 3 * D; w = await boot(); w.__go('pet'); assert.ok(w.__state().fox.hunger < h, 'hunger drops');
  w.__go('words'); assert.ok(txt(w).includes('共 2209 词'));
  // 切换到全部词书 -> 此时才加载
  loads = []; w.__go('settings'); q(w, '#bk').value = 'ielts-toefl-full'; q(w, '#sv').click(); await new Promise(r => setTimeout(r, 10));
  assert.deepStrictEqual(loads, ['data/book-ielts-toefl-full.js']); assert.ok(txt(w).includes('已保存')); assert.ok(txt(w).includes('ECDICT'));
  w.__go('home'); assert.ok(txt(w).includes('雅思托福全部词 · 12883 词'));
  w.__go('practice'); q(w, '[data-m="clozeType"]').click(); assert.ok(txt(w).includes('还没有学过带例句的词'));
  // 界面：底部 5 个标签、锁定稿小狗 PNG、开始学习按钮、键盘快捷键、会话总结
  assert.strictEqual([...w.document.querySelectorAll('#nav [data-view]')].map(b => b.textContent.trim().slice(-2)).join(), '首页,学习,练习,小狗,我的');
  w.__go('home'); assert.ok(q(w, '#app .petpose.idle .sway') && q(w, '#app .petpose .drop') && q(w, '#app .petpose .earl') && q(w, '#app .petpose .earr') && q(w, '#app .petpose img').getAttribute('src').includes('dog-mascot.png') && txt(w).includes('今日进度'));
  assert.ok(!txt(w).includes('狐狸') && !txt(w).includes('狐粮'), 'no fox copy on home');
  for (const v of ['study', 'me', 'words', 'settings', 'preview']) { w.__go(v); assert.ok(w.document.querySelector('#nav .active'), v); }
  w.__go('pet'); assert.ok(q(w, '#dogbox .petpose.idle .sway') && q(w, '#dogbox .drop'));
  assert.strictEqual(w.document.querySelectorAll('.stages img.dogsvg').length, 4);
  assert.ok([...w.document.querySelectorAll('.stages img.dogsvg')].every(el => el.getAttribute('src').includes('dog-mascot.png')));
  assert.strictEqual(w.document.querySelectorAll('#app svg.dogsvg, #app .foxsvg').length, 0);
  assert.ok(txt(w).includes('狗粮') && txt(w).includes('成犬'));
  w.__go('settings'); q(w, '#bk').value = 'ielts-toefl-core'; q(w, '#sv').click(); await new Promise(r => setTimeout(r, 10));
  w.__go('practice'); q(w, '[data-m="w2m"]').click(); const key = k => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
  key('1'); assert.ok(q(w, '#nx'), 'key 1 answers'); key('Enter'); assert.ok(!q(w, '#nx'), 'Enter -> next');
  w.__go('practice'); q(w, '[data-m="flash"]').click(); key(' '); assert.ok(q(w, '[data-g="3"]'), 'space flips'); key('3'); assert.ok(q(w, '#nx'));
  offset += 30 * D; w = await boot(); w.__go('review'); const n = +txt(w).match(/剩余 (\d+) 个到期/)[1]; for (let i = 0; i < n; i++) answer(w);
  assert.ok(txt(w).includes('复习完成') && txt(w).includes('正确率'), 'summary');

  // 默认名「小狐」迁成「小狗」，自定义名不动
  store = { 'foxVocab.v2': JSON.stringify({ v: 2, bookId: 'ielts-toefl-core', settings: { dailyNew: 20, autoPlay: true }, books: {}, days: {}, studyDays: [], fox: { food: 2, xp: 0, hunger: 80, lastCheck: C_today(), fed: 0, name: '小狐' } }) };
  loads = []; w = await boot();
  assert.strictEqual(w.__state().fox.name, '小狗', 'default name migrated');
  assert.strictEqual(w.__state().fox.food, 2);
  store['foxVocab.v2'] = JSON.stringify({ v: 2, bookId: 'ielts-toefl-core', settings: { dailyNew: 20, autoPlay: true }, books: {}, days: {}, studyDays: [], fox: { food: 1, xp: 0, hunger: 80, lastCheck: C_today(), fed: 0, name: '豆豆' } });
  w = await boot(); assert.strictEqual(w.__state().fox.name, '豆豆', 'custom name kept');

  // 自助词书：创建、加词、进度与内置词书分开
  store = {}; loads = []; w = await boot();
  w.__go('books');
  assert.ok(txt(w).includes('雅思托福核心词') && txt(w).includes('2209 词'), 'core book on the picker');
  assert.ok(txt(w).includes('雅思托福全部词') && txt(w).includes('12883 词'), 'full book on the picker');
  assert.ok(txt(w).includes('雅思专项') && txt(w).includes('4958 词'), 'ielts book on the picker');
  assert.ok(txt(w).includes('考研英语') && txt(w).includes('5005 词'), 'kaoyan book on the picker');
  q(w, '#bname').value = '旅游';
  q(w, '#bpaste').value = 'apple\t苹果\nbanana 香蕉\norange';
  q(w, '#bcreate').click();
  await new Promise(r => setTimeout(r, 20));
  assert.strictEqual(w.__state().customBooks.length, 1);
  assert.strictEqual(w.__state().customBooks[0].words.length, 3);
  assert.strictEqual(w.__state().bookId, w.__state().customBooks[0].id);
  w.__go('books');
  q(w, '#aw').value = 'ticket'; q(w, '#am').value = '票'; q(w, '#aadd').click();
  assert.strictEqual(w.__state().customBooks[0].words.length, 4);
  const cid = w.__state().customBooks[0].id;
  w.__go('learn'); passFollow(w); q(w, '#show').click(); q(w, '[data-g="3"]').click();
  assert.ok(w.__state().books[cid].cards.apple || w.__state().books[cid].cards.banana || Object.keys(w.__state().books[cid].cards).length === 1);
  const learnedCustom = Object.keys(w.__state().books[cid].cards).length;
  assert.strictEqual(learnedCustom, 1);
  w.__go('settings'); q(w, '#bk').value = 'ielts-toefl-core'; q(w, '#sv').click();
  await new Promise(r => setTimeout(r, 20));
  assert.strictEqual(w.__state().bookId, 'ielts-toefl-core');
  assert.strictEqual(Object.keys((w.__state().books['ielts-toefl-core'] || {}).cards || {}).length, 0, 'builtin progress separate');
  assert.strictEqual(Object.keys(w.__state().books[cid].cards).length, 1, 'custom progress kept');
  const dumped = JSON.stringify({ type: 'dog-verb-book', v: 1, name: '旅游', words: w.__state().customBooks[0].words });
  w.__go('books'); q(w, '[data-del]').click();
  assert.strictEqual(w.__state().customBooks.length, 0);
  const imp = w.__importBook(dumped);
  assert.strictEqual(imp.ok, true);
  assert.strictEqual(w.__state().customBooks[0].name, '旅游');
  assert.strictEqual(w.__state().customBooks[0].words.length, 4);
  // 例句填空：中文译文先遮住目标词；长按/右键把句中生词加入今日学习
  store = {}; loads = []; w = await boot();
  w.__go('learn'); passFollow(w); q(w, '#show').click(); q(w, '[data-g="3"]').click(); passDict(w, 'analyse');
  w.__go('practice'); q(w, '[data-m="clozeChoice"]').click();
  const sent = q(w, '.prompt .sent');
  assert.ok(sent.textContent.includes('_____') && !sent.textContent.includes('analysed'), 'cloze hides the answer');
  const masked = q(w, '.prompt .exzh').textContent;
  assert.ok(masked.includes('____') && masked.includes('研究人员') && !masked.includes('分析') && !masked.includes('{'), 'zh masked ' + masked);
  assert.ok(txt(w).includes('长按单词加入今日学习'));
  const households = [...w.document.querySelectorAll('.prompt .sent .tok')].find(el => el.dataset.w === 'households');
  assert.ok(households, 'households token');
  const menu = new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  households.dispatchEvent(menu);
  assert.strictEqual(menu.defaultPrevented, true, 'callout suppressed');
  assert.ok([...w.document.querySelectorAll('.toast')].some(t => t.textContent.includes('已将「household」加入今日学习')));
  assert.ok(w.__state().books['ielts-toefl-core'].today.includes('household'));
  assert.ok(!(w.__state().books['ielts-toefl-core'].extra || []).some(e => e.word === 'household'), 'reused the book entry');
  offset += 1000;
  households.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  assert.ok([...w.document.querySelectorAll('.toast')].some(t => t.textContent.includes('「household」已在今日学习列表')));
  const calls = [];
  const pageOf = url => decodeURIComponent((String(url).match(/[?&]page=([^&]+)/) || [])[1] || '');
  w.fetch = url => {
    const word = pageOf(url);
    calls.push(word);
    if (word !== 'from') return Promise.reject(new Error('unexpected ' + word));
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ parse: { title: 'from', wikitext: { '*': "==English==\n===Pronunciation===\n* {{a|UK}} {{IPA|en|/frɒm/}}\n===Preposition===\n====Translations====\n*: Mandarin: {{t+|cmn|從|tr=cóng}}\n" } } }) });
  };
  const thousand = [...w.document.querySelectorAll('.prompt .sent .tok')].find(el => el.dataset.w === 'thousand');
  thousand.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: 4, clientY: 4, button: 0 }));
  thousand.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true, clientX: 4, clientY: 4, button: 0 }));
  await new Promise(r => setTimeout(r, 520));
  assert.ok(!calls.includes('thousand'), 'short press does not add');
  const from = [...w.document.querySelectorAll('.prompt .sent .tok')].find(el => el.dataset.w === 'from');
  from.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 30));
  const extra = w.__state().books['ielts-toefl-core'].extra.find(e => e.word === 'from');
  assert.ok(extra && extra.meaning.includes('从') && extra.ipa === '/frɒm/' && extra.pos === 'prep.', JSON.stringify(extra));
  const todayList = w.__state().books['ielts-toefl-core'].today;
  assert.ok(Array.isArray(todayList) && todayList.join(',') === 'household,from', JSON.stringify(todayList));
  async function pressWord(word, impl, online) {
    Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => online });
    w.fetch = impl;
    const el = [...w.document.querySelectorAll('.prompt .sent .tok')].find(t => t.dataset.w === word);
    el.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 30));
    return [...w.document.querySelectorAll('.toast')].pop().textContent;
  }
  const off = await pressWord('over', () => Promise.reject(Object.assign(new Error('Failed to fetch'), { name: 'TypeError' })), false);
  const timed = await pressWord('two', () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), true);
  const failed = await pressWord('over', () => Promise.resolve({ ok: false, status: 503 }), true);
  const missing = await pressWord('two', () => Promise.resolve({ ok: true, json: () => Promise.resolve({ error: { code: 'missingtitle' } }) }), true);
  assert.ok(off.includes('联网') && !off.includes('没有找到'), off);
  assert.ok(timed.includes('超时') && !timed.includes('联网'), timed);
  assert.ok(failed.includes('失败') && !failed.includes('联网') && !failed.includes('没有找到'), failed);
  assert.ok(missing.includes('没有找到') && !missing.includes('联网') && !missing.includes('超时'), missing);
  assert.strictEqual(new Set([off, timed, failed, missing]).size, 4);
  const extras = w.__state().books['ielts-toefl-core'].extra || [];
  assert.ok(!extras.some(e => e.word === 'over' || e.word === 'two' || !e.meaning), 'no blank entries ' + JSON.stringify(extras));
  [...w.document.querySelectorAll('#ans button')].find(b => b.textContent === 'analyse').click();
  const looked = [];
  w.fetch = url => { looked.push(pageOf(url)); return Promise.reject(new Error('offline')); };
  const analysed = [...w.document.querySelectorAll('.detail .sent .tok')].find(el => el.dataset.w === 'analysed');
  assert.ok(analysed, 'full example shows the inflected form');
  analysed.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  assert.ok([...w.document.querySelectorAll('.toast')].some(t => t.textContent.includes('「analyse」已经学过了')));
  assert.deepStrictEqual(looked, [], 'inflection hits the book without a lookup');
  assert.ok(q(w, '.prompt .exzh').textContent.includes('分析') && !q(w, '.prompt .exzh').textContent.includes('____'));
  assert.ok([...w.document.querySelectorAll('.detail .exzh')].every(el => el.textContent.includes('分析') && !el.textContent.includes('{')));
  w.__go('learn');
  assert.strictEqual(q(w, '.word').textContent, 'household', 'pinned word is today\'s next new word');
  assert.ok(q(w, '[data-follow]'), 'pinned word starts with 跟写');
  passFollow(w);
  q(w, '#show').click();
  assert.ok(txt(w).includes('家庭') || txt(w).includes('一家人'), 'definition reused');
  w = await boot();
  w.__go('learn');
  assert.strictEqual(q(w, '.word').textContent, 'household', 'today list persists');
  assert.ok(w.__state().books['ielts-toefl-core'].extra.some(e => e.word === 'from' && e.meaning));

  // 窄屏键盘：坞留在题目里，贴在 visualViewport 上方；选择题不启用
  const css = read('style.css');
  const html = read('index.html');
  const appSrc = read('app.js');
  assert.ok(css.includes('bottom:calc(env(safe-area-inset-bottom) + 64px + 12px)'));
  assert.ok(css.includes('bottom:calc(var(--ime-bottom) + var(--dock-h, 0px) + 12px)'));
  assert.ok(css.includes('body.kb-open #nav{display:none}'));
  assert.ok(!css.includes('bottom:110px'));
  assert.ok(html.includes('content="width=device-width, initial-scale=1, viewport-fit=cover"'));
  assert.ok(!html.includes('interactive-widget'), 'viewport must not resize layout with the keyboard');
  assert.ok(!html.includes('resizes-content'), 'viewport must not use resizes-content');
  assert.ok(!appSrc.includes('takeIntoDock') && !appSrc.includes('restoreImeDock') && !appSrc.includes('appendChild(dock)'));
  assert.ok(!appSrc.includes('scrollIntoView'), 'viewport sync must not scroll a focused field');
  const syncSrc = appSrc.slice(appSrc.indexOf('function syncIme'), appSrc.indexOf('function bindIme'));
  assert.ok(syncSrc.startsWith('function syncIme') && !syncSrc.includes('.focus('), 'viewport sync must not focus');
  async function pump() { await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0)); }
  const GRACE = 260;
  w = await boot(win => {
    let vh = 844, top = 0, ih = 844; const ls = {};
    const fake = {
      get height() { return vh; }, get offsetTop() { return top; }, width: 390,
      addEventListener(t, fn) { (ls[t] = ls[t] || []).push(fn); }, removeEventListener() {},
    };
    const resizeFns = [], scrollFns = [];
    const origAdd = win.addEventListener.bind(win);
    win.addEventListener = (t, fn, o) => {
      if (t === 'resize') resizeFns.push(fn);
      else if (t === 'scroll') scrollFns.push(fn);
      return origAdd(t, fn, o);
    };
    win.requestAnimationFrame = fn => setTimeout(() => fn(Date.now()), 0);
    win.cancelAnimationFrame = id => clearTimeout(id);
    Object.defineProperty(win, 'visualViewport', { configurable: true, get: () => fake });
    Object.defineProperty(win, 'innerHeight', { configurable: true, get: () => ih });
    win.matchMedia = q => ({ matches: /max-width:\s*759/.test(String(q)), addEventListener() {}, removeEventListener() {} });
    const fire = () => {
      (ls.resize || []).forEach(fn => fn());
      (ls.scroll || []).forEach(fn => fn());
      resizeFns.forEach(fn => fn());
      scrollFns.forEach(fn => fn());
    };
    win.__ime = {
      set(h, off, layout) { vh = h; top = off || 0; if (layout != null) ih = layout; fire(); },
      fire,
    };
  });
  w.__go('learn');
  const followField = q(w, '[data-follow] #inp');
  assert.ok(followField && followField.closest('#ime-dock') && followField.closest('.qcard'), '跟写 keeps the spelling dock in the card');
  const followHome = followField.parentNode;
  assert.notStrictEqual(w.document.getElementById('ime-dock').parentNode, w.document.body);
  const studied = q(w, '.word') ? q(w, '.word').textContent : '';
  await pump();
  assert.ok(!w.document.body.classList.contains('kb-open'), '跟写 focus alone does not open the dock');
  w.__ime.set(844 - 36, 0, 844);
  await pump();
  assert.ok(!w.document.body.classList.contains('kb-open'), '跟写 ignores a brief inset');
  w.__ime.set(844 - 336, 0, 844);
  await pump();
  assert.ok(w.document.body.classList.contains('kb-open'), '跟写 opens once the keyboard inset is real');
  assert.strictEqual(followField.parentNode, followHome, '跟写 input is not reparented');
  assert.strictEqual(q(w, '#inp'), followField, '跟写 does not recreate the input');
  followField.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }));
  assert.ok(q(w, '#follow i.miss'), 'wrong key stays on the follow card');
  assert.strictEqual(q(w, '#inp'), followField, 'wrong key does not replace the input');
  assert.strictEqual(followField.parentNode, followHome);
  w.__ime.set(844, 0, 844);
  await pump();
  passFollow(w);
  w.document.documentElement.style.removeProperty('--ime-bottom');
  w.document.documentElement.style.removeProperty('--dock-h');
  q(w, '#show').click(); q(w, '[data-g="3"]').click();
  assert.ok(q(w, '#ans #inp') && q(w, '#ans #inp').closest('#ime-dock'), 'learn dictation keeps the spelling dock in the card');
  assert.notStrictEqual(w.document.getElementById('ime-dock').parentNode, w.document.body);
  if (q(w, '[data-dict="listen"]')) {
    assert.ok(studied && !q(w, '#qc').textContent.toLowerCase().includes(studied), 'listen card hides the english word');
    assert.ok(q(w, '#replay'), 'listen card has replay');
  }
  const dictField = q(w, '#ans #inp');
  const dictHome = dictField.parentNode;
  assert.ok(dictHome.closest('#ans'), 'learn dictation input stays in the card');
  dictField.value = 'spell';
  assert.strictEqual(dictField.value, 'spell');
  assert.strictEqual(dictField.parentNode, dictHome);
  w.__go('practice'); q(w, '[data-m="clozeType"]').click();
  const inp = q(w, '#ans #inp');
  const parent = inp.parentNode;
  assert.ok(inp, 'spelling input starts in the card');
  assert.ok(parent.closest('#ans'), 'input stays inside #ans');
  assert.notStrictEqual(parent, w.document.body);
  assert.notStrictEqual(w.document.getElementById('ime-dock').parentNode, w.document.body);
  const dock = w.document.getElementById('ime-dock');
  assert.ok(dock.querySelector('#inp') && dock.querySelector('.senttip'), 'in-tree dock holds the hint and the input');
  assert.ok(dock.querySelector('.senttip').textContent.includes('长按单词加入今日学习'));
  const en = q(w, '.sent .senten');
  let scrolls = 0;
  en.scrollIntoView = () => { scrolls++; w.__ime.fire(); };
  let focuses = 0;
  const origFocus = inp.focus;
  inp.focus = function (...args) { focuses++; return origFocus.apply(this, args); };
  let cssWrites = 0;
  const rootStyle = w.document.documentElement.style;
  const origSet = rootStyle.setProperty.bind(rootStyle);
  rootStyle.setProperty = (name, value) => { cssWrites++; return origSet(name, value); };
  await pump();
  assert.ok(!w.document.body.classList.contains('kb-open'), 'focus alone does not open the dock');
  assert.strictEqual(w.document.documentElement.style.getPropertyValue('--ime-bottom'), '', 'focus alone does not pin the dock');
  assert.strictEqual(scrolls, 0, 'sync does not scroll the sentence');
  assert.strictEqual(focuses, 0, 'sync does not focus');
  assert.strictEqual(inp.parentNode, parent);
  w.__ime.set(844 - 36, 0, 844);
  await pump();
  w.__ime.set(844 - 100, 0, 844);
  await pump();
  assert.ok(!w.document.body.classList.contains('kb-open'), 'brief inset jitter does not open the dock');
  assert.strictEqual(scrolls, 0);
  assert.strictEqual(focuses, 0);
  cssWrites = 0;
  for (let i = 0; i < 12; i++) w.__ime.fire();
  await pump();
  assert.strictEqual(cssWrites, 0, 'identical viewport events do not rewrite CSS');
  assert.ok(!w.document.body.classList.contains('kb-open'));
  w.__ime.set(844 - 336, 0, 844);
  await pump();
  assert.ok(w.document.body.classList.contains('kb-open'), 'a real keyboard inset opens the dock');
  assert.strictEqual(w.document.documentElement.style.getPropertyValue('--ime-bottom'), '336px');
  assert.strictEqual(focuses, 0, 'viewport sync does not refocus');
  assert.strictEqual(scrolls, 0, 'opening the dock does not scroll');
  for (let i = 0; i < 24; i++) {
    const off = [0, 40, 120, 280, 336, 16][i % 6];
    if (i % 3 === 0) w.__ime.set(508, off, 508);
    else w.__ime.set(508, off, 844);
  }
  await pump();
  assert.ok(w.document.body.classList.contains('kb-open'), 'offsetTop jumps and innerHeight races keep the dock open');
  assert.strictEqual(w.document.documentElement.style.getPropertyValue('--ime-bottom'), '336px');
  assert.strictEqual(inp.parentNode, parent, 'input is not reparented');
  assert.strictEqual(q(w, '#inp'), inp, 'input element is not recreated');
  assert.strictEqual(scrolls, 0, 'later viewport events do not scroll');
  assert.strictEqual(focuses, 0);
  cssWrites = 0;
  w.__ime.set(844 - 330, 0, 844);
  await pump();
  assert.strictEqual(w.document.documentElement.style.getPropertyValue('--ime-bottom'), '336px', 'sub-jitter inset changes do not repaint');
  assert.strictEqual(cssWrites, 0);
  for (let i = 0; i < 8; i++) {
    w.__ime.set(508, 80 * i, i % 2 ? 508 : 844);
    await pump();
    assert.ok(w.document.body.classList.contains('kb-open'));
    assert.strictEqual(inp.parentNode, parent);
    assert.strictEqual(q(w, '#inp'), inp);
  }
  w.__ime.set(508, 0, 844);
  await pump();
  q(w, '#sub').focus();
  await pump();
  assert.ok(w.document.body.classList.contains('kb-open'), 'submit in the same row does not flash the dock closed');
  await new Promise(r => setTimeout(r, GRACE));
  await pump();
  assert.ok(w.document.body.classList.contains('kb-open'));
  assert.strictEqual(inp.parentNode, parent);
  q(w, '#sub').blur();
  await new Promise(r => setTimeout(r, 40));
  await pump();
  assert.ok(w.document.body.classList.contains('kb-open'), 'blur grace keeps the dock up');
  await new Promise(r => setTimeout(r, GRACE));
  await pump();
  assert.ok(!w.document.body.classList.contains('kb-open'), 'blur leaves kb-open after the grace');
  assert.strictEqual(inp.parentNode, parent, 'closing the dock does not move the input');
  assert.strictEqual(w.document.documentElement.style.getPropertyValue('--ime-bottom'), '0px');
  inp.focus();
  await pump();
  w.__ime.set(508, 0, 844);
  await pump();
  assert.ok(w.document.body.classList.contains('kb-open'));
  inp.blur();
  await new Promise(r => setTimeout(r, GRACE));
  await pump();
  assert.ok(!w.document.body.classList.contains('kb-open'));
  inp.focus();
  await pump();
  w.__ime.set(508, 0, 844);
  await pump();
  assert.ok(w.document.body.classList.contains('kb-open'));
  w.__ime.set(844, 0, 844);
  await pump();
  assert.ok(w.document.body.classList.contains('kb-open'), 'one collapsed frame does not flash the dock closed');
  assert.strictEqual(w.document.activeElement, inp);
  await new Promise(r => setTimeout(r, GRACE));
  await pump();
  assert.ok(!w.document.body.classList.contains('kb-open'), 'a keyboard that stays gone closes the dock');
  assert.strictEqual(w.document.activeElement, inp, 'closing the dock does not move focus');
  assert.strictEqual(inp.parentNode, parent);
  w.__go('practice'); q(w, '[data-m="clozeChoice"]').click();
  const choiceBtn = q(w, '#ans button');
  choiceBtn.focus();
  w.__ime.set(508, 0, 844);
  await pump();
  await new Promise(r => setTimeout(r, GRACE));
  await pump();
  assert.ok(!w.document.body.classList.contains('kb-open'));
  assert.ok(!w.document.getElementById('ime-dock'), 'choice questions do not dock');
  for (const m of ['dictation', 'meaningType']) {
    w.__ime.set(844, 0, 844);
    w.__go('practice'); q(w, `[data-m="${m}"]`).click();
    const field = q(w, '#ans #inp');
    const home = field.parentNode;
    assert.ok(home.closest('#ans') && home.closest('#ime-dock'), m + ' dock stays in the card');
    assert.notStrictEqual(w.document.getElementById('ime-dock').parentNode, w.document.body);
    await pump();
    assert.ok(!w.document.body.classList.contains('kb-open'), m + ' focus alone does not open the dock');
    assert.strictEqual(w.document.activeElement, field, m + ' field stays focused');
    w.__ime.set(508, 0, 844);
    await pump();
    assert.ok(w.document.body.classList.contains('kb-open'), m + ' opens once the keyboard inset is real');
    w.__ime.set(508, 220, 508);
    await pump();
    assert.ok(w.document.body.classList.contains('kb-open'), m + ' stays open through an offsetTop race');
    assert.strictEqual(field.parentNode, home, m + ' input is not reparented');
    assert.strictEqual(q(w, '#inp'), field);
    field.value = 'test';
    assert.strictEqual(field.value, 'test', m + ' stays typable');
  }
  w.__ime.set(844, 0, 844);
  w.__go('learn');
  const again = q(w, '#ans #inp');
  assert.ok(again && again.closest('#ime-dock') && again.closest('.qcard'), 'new-word dictation keeps the dock in the card');
  const againHome = again.parentNode;
  if (w.document.activeElement !== again) again.focus();
  await pump();
  assert.ok(!w.document.body.classList.contains('kb-open'), 'learn dictation focus alone does not open the dock');
  w.__ime.set(508, 0, 844);
  await pump();
  assert.ok(w.document.body.classList.contains('kb-open'), 'learn dictation opens once the keyboard inset is real');
  assert.strictEqual(again.parentNode, againHome, 'learn dictation input is not reparented');
  assert.strictEqual(q(w, '#inp'), again);
  w.__ime.set(844, 0, 844);
  await pump();
  if (w.document.activeElement && w.document.activeElement.blur) w.document.activeElement.blur();
  await new Promise(r => setTimeout(r, GRACE));
  await pump();
  w.__go('sentence', 'analyse');
  const area = q(w, '#s');
  const areaParent = area.parentNode;
  assert.strictEqual(areaParent.id, 'ime-dock');
  assert.ok(area.closest('.qcard'), 'sentence box stays in the card');
  assert.notStrictEqual(areaParent.parentNode, w.document.body);
  assert.ok(!w.document.body.classList.contains('kb-open'));
  area.focus();
  await pump();
  assert.ok(!w.document.body.classList.contains('kb-open'), 'sentence focus alone does not open the dock');
  assert.strictEqual(scrolls, 0);
  w.__ime.set(844 - 300, 180, 844);
  await pump();
  assert.ok(w.document.body.classList.contains('kb-open'), 'sentence field opens the dock with a real keyboard');
  assert.strictEqual(w.document.documentElement.style.getPropertyValue('--ime-bottom'), '300px');
  assert.strictEqual(area.parentNode, areaParent);
  w.__ime.set(544, 400, 544);
  await pump();
  assert.ok(w.document.body.classList.contains('kb-open'));
  assert.strictEqual(w.document.documentElement.style.getPropertyValue('--ime-bottom'), '300px');
  assert.strictEqual(area.parentNode, areaParent);
  area.value = 'Scientists analysed the samples carefully last week.';
  assert.strictEqual(area.value.startsWith('Scientists'), true);
  const pick = q(w, '#pickw');
  pick.focus();
  await pump();
  assert.ok(w.document.body.classList.contains('kb-open'), 'leaving the sentence for pick-word does not flash the dock shut');
  await new Promise(r => setTimeout(r, GRACE));
  await pump();
  assert.ok(!w.document.body.classList.contains('kb-open'), 'pick-word does not keep the nav hidden');
  pick.value = 'analyse';
  assert.strictEqual(pick.value, 'analyse', 'pick-word stays typable');
  assert.strictEqual(w.document.activeElement, pick);
  assert.strictEqual(area.parentNode, areaParent, 'textarea stays put after the keyboard closes');
  area.focus();
  await pump();
  w.__ime.set(844 - 300, 0, 844);
  await pump();
  assert.ok(w.document.body.classList.contains('kb-open'));
  area.blur();
  await new Promise(r => setTimeout(r, GRACE));
  await pump();
  assert.ok(!w.document.body.classList.contains('kb-open'));
  assert.strictEqual(area.parentNode, areaParent);

  // 长按例句：键盘收起也不要在按住期间拆掉坞
  w.__go('practice'); q(w, '[data-m="clozeType"]').click();
  const heldInp = q(w, '#ans #inp');
  const heldParent = heldInp.parentNode;
  await pump();
  w.__ime.set(844 - 336, 0, 844);
  await pump();
  assert.ok(w.document.body.classList.contains('kb-open'));
  const tok = q(w, '.prompt .sent .tok');
  assert.ok(tok && tok.dataset.w, 'cloze sentence has a pressable token');
  tok.dispatchEvent(new w.PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 12, clientY: 18, pointerId: 1, button: 0 }));
  heldInp.blur();
  w.__ime.set(844, 0, 844);
  await pump();
  assert.ok(tok.classList.contains('pressing'), 'long-press started');
  assert.ok(w.document.body.classList.contains('kb-open'), 'dock stays put while the token is held');
  assert.strictEqual(heldInp.parentNode, heldParent);
  await new Promise(r => setTimeout(r, 480));
  await pump();
  assert.ok(!tok.classList.contains('pressing'), 'long-press completed');
  assert.ok([...w.document.querySelectorAll('.toast')].length >= 1, 'long-press still looks the word up');
  assert.strictEqual(q(w, '#inp'), heldInp, 'long-press does not replace the input');
  assert.strictEqual(heldInp.parentNode, heldParent);
  await new Promise(r => setTimeout(r, GRACE));
  await pump();
  assert.ok(!w.document.body.classList.contains('kb-open'), 'dock closes after the press and the blur grace');

  // 搜索、自定义词书、设置：能打字，但不会把导航藏起来
  async function staysPlain(view, sel, value, arg) {
    w.__ime.set(844, 0, 844);
    w.__go(view, arg);
    await pump();
    const field = q(w, sel);
    assert.ok(field, view + ' ' + sel);
    const home = field.parentNode;
    field.focus();
    await pump();
    w.__ime.set(844 - 320, 40, 844);
    await pump();
    for (let i = 0; i < 8; i++) {
      w.__ime.set(844 - 320, 20 * i, i % 2 ? 524 : 844);
      await pump();
      assert.ok(!w.document.body.classList.contains('kb-open'), view + ' ' + sel + ' does not hide the nav');
      assert.strictEqual(field.parentNode, home, view + ' ' + sel + ' is not moved');
      assert.strictEqual(w.document.activeElement, field, view + ' ' + sel + ' stays focused');
    }
    field.value = value;
    field.dispatchEvent(new w.Event('input', { bubbles: true }));
    assert.strictEqual(field.value, value, view + ' ' + sel + ' stays typable');
    field.blur();
    await new Promise(r => setTimeout(r, GRACE));
    await pump();
    assert.ok(!w.document.body.classList.contains('kb-open'));
  }
  await staysPlain('capture', '#nw', 'from');
  await staysPlain('capture', '#nm', '票');
  await staysPlain('words', '#q', 'house');
  assert.ok(q(w, '#tb').textContent.includes('household'), 'search still filters');
  await staysPlain('books', '#bname', '旅游口语');
  await staysPlain('books', '#bpaste', 'apple 苹果');
  await staysPlain('settings', '#dn', '12');
  await staysPlain('sentence', '#pickw', 'from', 'analyse');
  w.__go('books');
  await pump();
  q(w, '#bname').value = '旅游口语';
  q(w, '#bpaste').value = 'apple 苹果';
  q(w, '#bcreate').click();
  await pump();
  const aw = q(w, '#aw'), am = q(w, '#am'), apaste = q(w, '#apaste');
  assert.ok(aw && am && apaste, 'custom book editor has typable fields');
  for (const [field, value] of [[aw, 'ticket'], [am, '票'], [apaste, 'orange 橙子']]) {
    field.focus();
    w.__ime.set(508, 30, 844);
    await pump();
    for (let i = 0; i < 4; i++) w.__ime.fire();
    await pump();
    assert.ok(!w.document.body.classList.contains('kb-open'), field.id + ' does not hide the nav');
    field.value = value;
    assert.strictEqual(field.value, value, field.id + ' stays typable');
    assert.strictEqual(w.document.activeElement, field);
  }

  // 生产 v=22 在窄屏 inset>80 时就会 kb-open，粘贴框也不例外。这些框必须留在表单里，底栏不能闪。
  {
    let flips = 0;
    const origToggle = w.document.body.classList.toggle.bind(w.document.body.classList);
    w.document.body.classList.toggle = function (name, force) {
      if (name === 'kb-open' && this.contains(name) !== !!force) flips++;
      return origToggle(name, force);
    };
    w.__ime.set(844, 0, 844);
    w.__go('books');
    await pump();
    if (w.document.activeElement && w.document.activeElement.blur) w.document.activeElement.blur();
    await new Promise(r => setTimeout(r, GRACE));
    await pump();
    flips = 0;
    w.__ime.set(844 - 336, 0, 844);
    await pump();
    w.__ime.set(844 - 336, 336, 844);
    await pump();
    w.__ime.set(508, 180, 508);
    await pump();
    assert.strictEqual(flips, 0, 'inset with no typable dock field does not toggle kb-open');
    assert.ok(!w.document.body.classList.contains('kb-open'));
    for (const sel of ['#bpaste', '#apaste']) {
      const field = q(w, sel);
      assert.ok(field, 'settings paste field ' + sel);
      const home = field.parentNode;
      field.focus();
      await pump();
      const at = flips;
      w.__ime.set(844 - 320, 0, 844);
      await pump();
      w.__ime.set(844 - 320, 300, 844);
      await pump();
      w.__ime.set(524, 200, 524);
      await pump();
      for (let i = 0; i < 10; i++) w.__ime.fire();
      await pump();
      assert.strictEqual(flips, at, sel + ' inset storm does not flash the nav');
      assert.ok(!w.document.body.classList.contains('kb-open'), sel + ' does not hide the nav');
      assert.strictEqual(field.parentNode, home, sel + ' stays in the form');
      assert.notStrictEqual(field.parentNode, w.document.body);
      const dock = w.document.getElementById('ime-dock');
      assert.ok(!dock || dock.parentNode !== w.document.body, sel + ' is not reparented into a body dock');
      assert.strictEqual(w.document.activeElement, field, sel + ' keeps focus');
      const text = 'apple 苹果\nbanana 香蕉';
      field.value = text;
      field.dispatchEvent(new w.Event('input', { bubbles: true }));
      assert.strictEqual(field.value, text, sel + ' stays typable');
      const painted = w.document.documentElement.style.getPropertyValue('--ime-bottom');
      assert.ok(painted === '' || painted === '0px', sel + ' does not pin a dock, got ' + painted);
    }
  }

  // 转发：每日金句方卡。页内日历还在，分享图不再画月历。
  offset = 0;
  const dayKey = C_today();
  store = { 'foxVocab.v2': JSON.stringify({ v: 2, bookId: 'ielts-toefl-core', settings: { dailyNew: 20, autoPlay: true }, books: {}, days: {}, studyDays: [dayKey, '2020-01-01'], fox: { food: 0, xp: 0, hunger: 80, lastCheck: dayKey, fed: 0, name: '豆豆' } }) };
  loads = [];
  const ops = []; const srcs = [];
  w = await boot(win => {
    win.Image = function () { this.naturalWidth = 64; this.naturalHeight = 64; this.width = 64; this.height = 64; };
    Object.defineProperty(win.Image.prototype, 'src', { configurable: true, set(v) { this._src = String(v); this._decoded = false; srcs.push(this._src); setTimeout(() => { if (this.onload) this.onload(); }, 0); }, get() { return this._src; } });
    win.Image.prototype.decode = function () { const self = this; return new Promise(resolve => setTimeout(() => { self._decoded = true; resolve(); }, 5)); };
  });
  assert.strictEqual(q(w, '.sharecal').textContent, '转发', 'share entry on home');
  assert.ok(q(w, '.cal') && txt(w).includes('近 28 天打卡'), 'calendar stays on home');
  assert.ok(q(w, '.cal .on .paw'), 'checked day still shows a paw in the app');
  w.__go('me'); assert.strictEqual(q(w, '.sharecal').textContent, '转发', 'share entry on me');
  assert.ok(q(w, '.cal'), 'calendar stays on me');
  w.__go('home');
  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
    get: (_, k) => k === 'measureText' ? t => ({ width: String(t).length * 18 }) : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : (...args) => { ops.push({ op: String(k), args }); },
    set: (_, k, v) => { ops.push({ op: 'set', key: String(k), value: v }); return true; }
  });
  w.HTMLCanvasElement.prototype.toBlob = function (cb, type) { cb(new w.Blob(['png'], { type: type || 'image/png' })); };
  const canvases = [];
  const createEl = w.document.createElement.bind(w.document);
  w.document.createElement = function (tag) { const el = createEl(tag); if (String(tag).toLowerCase() === 'canvas') canvases.push(el); return el; };
  let shared = null;
  Object.defineProperty(w.navigator, 'canShare', { configurable: true, value: p => !!(p && p.files && p.files[0]) });
  Object.defineProperty(w.navigator, 'share', { configurable: true, value: p => { shared = p; return Promise.resolve(); } });
  const quote = w.VocabCore.dailyQuote(dayKey);
  const photos = ['kubota-garden-seattle.jpg', 'lyon-riverside-terrace.jpg', 'wallabi-beach.jpg'];
  q(w, '.sharecal').click();
  await new Promise(r => setTimeout(r, 250));
  assert.ok(canvases.some(c => c.width === 1080 && c.height === 1080), 'square card');
  assert.ok(shared && shared.files[0].type === 'image/png', 'share file');
  assert.ok(shared.files[0].name.indexOf(dayKey) !== -1, shared.files[0].name);
  assert.ok(shared.text.indexOf(quote.zh) !== -1 && shared.text.indexOf('《破产姐妹》') !== -1, shared.text);
  assert.ok(shared.text.indexOf('连续打卡') === -1, 'share text is the quote');
  assert.ok(!q(w, '#sharesheet'), 'sheet stays hidden when share works');
  assert.ok(q(w, '.cal') && txt(w).includes('近 28 天打卡'), 'calendar still in the app');
  assert.ok(!txt(w).includes(quote.en), 'quote is on the image, not the calendar');
  const texts = ops.filter(o => o.op === 'fillText').map(o => String(o.args[0]));
  const unique = []; texts.forEach(t => { if (unique.indexOf(t) === -1) unique.push(t); });
  const enDrawn = unique.filter(t => /^[A-Za-z0-9 ,.'’]+$/.test(t));
  assert.strictEqual(enDrawn.join(' '), quote.en, enDrawn.join(' | '));
  assert.ok(unique.indexOf(quote.zh) !== -1, 'chinese line');
  assert.ok(unique.indexOf('《破产姐妹》') !== -1, 'source title');
  assert.ok(unique.indexOf('Dog Verb  ·  每日金句') !== -1, 'brand line');
  assert.ok(unique.indexOf('本日学习 0 个，复习 0 个') !== -1, 'zero counts still render');
  assert.strictEqual(textTop(ops, quote.zh), 888, 'chinese quote stays put');
  assert.strictEqual(textTop(ops, '《破产姐妹》'), 946, 'source stays put');
  assert.strictEqual(textTop(ops, 'Dog Verb  ·  每日金句'), 978, 'brand stays put');
  assert.strictEqual(textTop(ops, '本日学习 0 个，复习 0 个'), 1014, 'stats sit under the brand');
  assert.ok(textTop(ops, '本日学习 0 个，复习 0 个') + 32 < 1080, 'stats are not clipped');
  assert.ok(!unique.some(t => t === '连续打卡' || t.indexOf('累计') !== -1 || /^\d+$/.test(t)), unique.join('|'));
  assert.strictEqual(ops.filter(o => o.op === 'stroke').length, 1, 'gold rule only');
  assert.ok(ops.some(o => o.op === 'set' && o.key === 'strokeStyle' && String(o.value).toUpperCase() === '#F0BB51'));
  assert.ok(ops.some(o => o.op === 'set' && o.key === 'lineWidth' && o.value === 2));
  const drawn = ops.filter(o => o.op === 'drawImage');
  assert.ok(drawn.every(o => o.args[0] && o.args[0]._decoded), 'draw only after decode');
  const drawnSrc = drawn.map(o => o.args[0] && o.args[0]._src || '');
  assert.ok(drawnSrc.some(s => s.indexOf(photos[quote.index]) !== -1), 'today landscape ' + photos[quote.index]);
  assert.ok(drawnSrc.some(s => s.indexOf('logo-doubao') !== -1), 'doubao logo');
  assert.ok(drawnSrc.every(s => s.indexOf('dog-mascot-transparent') === -1), 'share card has no second dog');
  assert.ok(drawnSrc.every(s => s.indexOf('paw-check') === -1), 'calendar paw is not on the card');
  assert.ok(drawnSrc.every(s => s.indexOf('dog-mascot.png') === -1), 'in-app mascot stays off the card');
  offset = 36 * 60 * 60 * 1000;
  const day2 = w.VocabCore.dayKey(w.Date.now());
  const quote2 = w.VocabCore.dailyQuote(day2);
  assert.notStrictEqual(quote2.index, quote.index, 'next day is a different card');
  ops.length = 0; shared = null;
  q(w, '.sharecal').click();
  await new Promise(r => setTimeout(r, 250));
  const texts2 = [];
  ops.filter(o => o.op === 'fillText').forEach(o => { const t = String(o.args[0]); if (texts2.indexOf(t) === -1) texts2.push(t); });
  assert.strictEqual(texts2.filter(t => /^[A-Za-z0-9 ,.'’]+$/.test(t)).join(' '), quote2.en);
  assert.ok(texts2.indexOf('本日学习 0 个，复习 0 个') !== -1, 'next day with no finished counts still shows zeros');
  assert.ok(ops.some(o => o.op === 'drawImage' && String(o.args[0] && o.args[0]._src || '').indexOf(photos[quote2.index]) !== -1));
  assert.ok(ops.filter(o => o.op === 'drawImage').every(o => String(o.args[0] && o.args[0]._src || '').indexOf('dog-mascot') === -1), 'next card also has only the logo');
  offset = 0;
  shared = null;
  Object.defineProperty(w.navigator, 'share', { configurable: true, value: () => { const e = new Error('abort'); e.name = 'AbortError'; return Promise.reject(e); } });
  q(w, '.sharecal').click(); await new Promise(r => setTimeout(r, 250));
  assert.ok(!q(w, '#sharesheet'), 'cancel does not open the sheet');
  Object.defineProperty(w.navigator, 'canShare', { configurable: true, value: () => false });
  q(w, '.sharecal').click(); await new Promise(r => setTimeout(r, 250));
  const preview = q(w, '#sharesheet img');
  assert.ok(preview && preview.getAttribute('src').indexOf('data:image/png') === 0, 'long-press image');
  assert.ok(q(w, '[aria-label="转发每日金句"]'));
  assert.strictEqual(q(w, '#sharesave').textContent, '保存图片');
  q(w, '#shareclose').click(); assert.ok(!q(w, '#sharesheet'));

  // 完成数读当天 days.new / days.review。7 不是每日目标 20，4 不是待复习 11，也不是 4+11。
  const dueWords = ['analyse', 'approach', 'area', 'assess', 'assume', 'authority', 'available', 'benefit', 'concept', 'consist', 'context'];
  const st = w.__state();
  st.settings.dailyNew = 20;
  st.days[dayKey] = { new: 7, review: 4, correct: 11, wrong: 1 };
  const past = w.Date.now() - 60 * 1000;
  if (!st.books['ielts-toefl-core']) st.books['ielts-toefl-core'] = { cards: {}, sentences: {} };
  st.books['ielts-toefl-core'].cards = {};
  dueWords.forEach(word => {
    st.books['ielts-toefl-core'].cards[word] = { due: past, stability: 2, difficulty: 5, elapsed_days: 1, scheduled_days: 1, learning_steps: 0, reps: 2, lapses: 0, state: 2, last_review: past - 86400000, learnedAt: past - 86400000, mastered: false, masteredAt: null };
  });
  w.__go('home');
  assert.ok(txt(w).includes('今日新学7/20'), txt(w));
  assert.ok(txt(w).includes('今日已复习4'), txt(w));
  assert.ok(txt(w).includes('待复习11'), txt(w));
  ops.length = 0;
  q(w, '.sharecal').click();
  await new Promise(r => setTimeout(r, 250));
  const statsDrawn = ops.filter(o => o.op === 'fillText').map(o => String(o.args[0]));
  assert.ok(statsDrawn.includes('本日学习 7 个，复习 4 个'), statsDrawn.filter((t, i, a) => a.indexOf(t) === i).join('|'));
  assert.ok(!statsDrawn.includes('本日学习 20 个，复习 4 个') && !statsDrawn.includes('本日学习 7 个，复习 11 个') && !statsDrawn.includes('本日学习 7 个，复习 15 个'));
  assert.strictEqual(textTop(ops, quote.zh), 888, 'seeded card does not move the quote');
  assert.strictEqual(textTop(ops, '本日学习 7 个，复习 4 个'), 1014);
  const card = await w.__renderQuoteCard(dayKey);
  assert.strictEqual(card.studied, 7);
  assert.strictEqual(card.reviewed, 4);
  assert.strictEqual(card.dayKey, dayKey);
  q(w, '#shareclose').click();

  // 每日学习单词卡：只在词属于雅思专项（book-ielts.js）时换样式，文案只写「雅思常考」
  store = {}; loads = []; audios = [];
  w = await boot();
  assert.deepStrictEqual(loads, ['data/book-ielts-toefl-core.js'], 'home does not preload the ielts set');
  w.__go('learn');
  assert.strictEqual(q(w, '.word').textContent, 'analyse');
  assert.strictEqual(q(w, '[data-follow]').dataset.follow, 'analyse');
  passFollow(w);
  assert.strictEqual(q(w, '#qc').dataset.word, 'analyse');
  assert.ok(loads.includes('data/book-ielts.js'), 'daily study reuses book-ielts.js');
  await new Promise(r => setTimeout(r, 20));
  assert.ok(!q(w, '#qc').classList.contains('ielts-freq'), 'analyse is not in the ielts set');
  assert.ok(!q(w, '.ielts-badge'));
  assert.ok(!txt(w).includes('雅思常考') && !txt(w).includes('剑桥真题') && !txt(w).includes('官方真题'));
  q(w, '#show').click();
  q(w, '[data-g="3"]').click();
  passDict(w, 'analyse');
  assert.strictEqual(q(w, '.word').textContent, 'approach');
  passFollow(w);
  assert.ok(q(w, '#qc').classList.contains('ielts-freq'), 'approach is in the ielts set');
  assert.strictEqual(q(w, '.ielts-badge').textContent, '雅思常考');
  w.__go('settings'); q(w, '#bk').value = 'kaoyan'; q(w, '#sv').click();
  await new Promise(r => setTimeout(r, 20));
  w.__go('learn');
  assert.strictEqual(q(w, '.word').textContent, 'act');
  passFollow(w);
  await new Promise(r => setTimeout(r, 20));
  assert.ok(!q(w, '#qc').classList.contains('ielts-freq'), '考研 act is not in the ielts set');
  assert.ok(!q(w, '.ielts-badge'));
  q(w, '#show').click();
  q(w, '[data-g="3"]').click();
  passDict(w, 'act');
  assert.strictEqual(q(w, '.word').textContent, 'action');
  passFollow(w);
  assert.ok(q(w, '#qc').classList.contains('ielts-freq'), '考研 action is in the ielts set');
  assert.strictEqual(q(w, '.ielts-badge').textContent, '雅思常考');
  w.__go('settings'); q(w, '#bk').value = 'ielts'; q(w, '#sv').click();
  await new Promise(r => setTimeout(r, 20));
  w.__go('learn');
  assert.strictEqual(q(w, '.word').textContent, 'approach');
  passFollow(w);
  assert.ok(q(w, '#qc').classList.contains('ielts-freq'), '雅思专项 card keeps the frequent style');
  assert.strictEqual(q(w, '.ielts-badge').textContent, '雅思常考');
  assert.ok(!txt(w).includes('剑桥真题') && !txt(w).includes('官方真题'));
  w.__go('settings'); q(w, '#bk').value = 'ielts-toefl-core'; q(w, '#sv').click();
  await new Promise(r => setTimeout(r, 20));
  w.__go('practice'); q(w, '[data-m="flash"]').click();
  assert.ok(q(w, '#qc') && !q(w, '#qc').classList.contains('ielts-freq') && !q(w, '.ielts-badge'), 'practice cards stay plain');
  assert.ok(css.includes('.qcard.ielts-freq') && css.includes('#F0BB51') && css.includes('#4B423E'));
  assert.ok(appSrc.includes('雅思常考') && !appSrc.includes('剑桥真题') && !appSrc.includes('官方真题'));
  assert.ok(appSrc.includes("loadBook('ielts')") && !appSrc.includes('ielts-word-list'));

  // 新词：先跟写（英文一直可见，逐字母），再单词卡，再一道默写。看意和听音仍交替。
  store = {}; loads = []; audios = [];
  w = await boot();
  w.fetch = () => Promise.reject(new Error('no network'));
  w.__go('learn');
  const dayOf = () => w.VocabCore.dayKey(w.Date.now());
  assert.strictEqual(q(w, '[data-follow]').dataset.follow, 'analyse');
  assert.strictEqual(q(w, '.word').textContent, 'analyse', '跟写 shows the english word');
  assert.ok(q(w, '.qtype').textContent.includes('跟写'));
  assert.ok(q(w, '#follow').textContent.includes('analyse'));
  assert.ok(!q(w, '#show'), '跟写 is not the study card yet');
  assert.strictEqual((w.__state().days[dayOf()] || {}).new || 0, 0);
  typeFollow(w, 'A');
  assert.ok(q(w, '#follow i.on'), 'correct key advances');
  assert.strictEqual(q(w, '#follow i.cur').textContent, 'n');
  assert.strictEqual(q(w, '#inp').value, 'a');
  assert.strictEqual(q(w, '.word').textContent, 'analyse', 'the headword stays visible');
  typeFollow(w, ' ');
  assert.strictEqual(q(w, '#follow i.cur').textContent, 'n', 'space does not move the cursor');
  assert.ok(!q(w, '#follow i.miss'));
  typeFollow(w, 'x');
  assert.ok(q(w, '#follow i.miss'), 'wrong key is marked');
  assert.strictEqual(q(w, '#follow i.cur').textContent, 'n', 'wrong key does not advance');
  assert.ok(q(w, '#follow-err').textContent.includes('不对') && q(w, '#follow-err').dataset.wrong === 'x');
  assert.strictEqual(q(w, '#inp').value, 'a');
  assert.ok(q(w, '[data-follow]'), 'a wrong key stays on 跟写');
  for (const ch of 'nalyse') typeFollow(w, ch);
  assert.ok(!q(w, '[data-follow]'), 'finished 跟写 leaves the follow card');
  assert.strictEqual(q(w, '.word').textContent, 'analyse');
  assert.ok(q(w, '.qtype').textContent.includes('学新词'), 'the study card follows 跟写');
  assert.strictEqual((w.__state().days[dayOf()] || {}).new || 0, 0, '跟写 does not count a new word');
  q(w, '#show').click();
  q(w, '[data-g="3"]').click();
  assert.strictEqual(w.__state().days[dayOf()].new, 1, 'study card still counts as 今日新学');
  assert.strictEqual(q(w, '[data-dict]').dataset.dict, 'gloss');
  assert.ok(q(w, '.qtype').textContent.includes('看意单词默写'));
  assert.ok(q(w, '.meaning-big').textContent.includes('分析'));
  assert.ok(!q(w, '.word'), 'gloss card hides the english word');
  assert.ok(!q(w, '#qc').textContent.toLowerCase().includes('analyse'));
  assert.ok(q(w, '#inp') && q(w, '#inp').closest('#ime-dock'));
  q(w, '#inp').value = '  Analyze. ';
  q(w, '#sub').click();
  assert.ok(q(w, '.verdict').textContent.includes('正确'));
  assert.ok(!q(w, '.answer'), 'a correct spelling is not marked wrong');
  assert.strictEqual(w.__state().days[dayOf()].new, 1, 'dictation does not count another new word');
  q(w, '#nx').click();
  assert.strictEqual(q(w, '.word').textContent, 'approach', 'next item is 跟写 again');
  assert.ok(q(w, '.qtype').textContent.includes('跟写'));
  passFollow(w);
  assert.ok(q(w, '.qtype').textContent.includes('学新词'));
  q(w, '#show').click();
  w.__state().settings.autoPlay = false;
  const entryPlays = [];
  w.Audio = function (src) {
    entryPlays.push(src);
    this.src = src;
    this.play = () => Promise.resolve();
    this.pause = () => {};
  };
  q(w, '[data-g="1"]').click();
  assert.strictEqual(q(w, '[data-dict]').dataset.dict, 'listen');
  assert.ok(q(w, '.qtype').textContent.includes('听音默写单词'));
  assert.ok(!q(w, '#qc').innerHTML.toLowerCase().includes('approach'), 'listen card html does not contain the word');
  assert.ok(!q(w, '#qc').innerHTML.includes('youdao') && !q(w, '#qc').innerHTML.includes('dictvoice'), 'listen card html does not contain the audio url');
  assert.ok(!q(w, '.word'));
  assert.ok(q(w, '#replay') && q(w, '#replay').getAttribute('aria-label') === '再听一遍');
  assert.ok(q(w, '#inp').closest('#ime-dock'), 'dictation input stays in the dock');
  assert.deepStrictEqual(entryPlays, ['https://dict.youdao.com/dictvoice?audio=approach&type=1'], 'entry play starts in the rating click, type=1');
  const heard = entryPlays.length;
  await new Promise(r => setTimeout(r, 400));
  assert.strictEqual(entryPlays.length, heard, 'no second speak is waiting to pause the entry audio');
  q(w, '#replay').click();
  assert.strictEqual(entryPlays.length, heard + 1);
  assert.strictEqual(entryPlays[entryPlays.length - 1], 'https://dict.youdao.com/dictvoice?audio=approach&type=1');
  await new Promise(r => setTimeout(r, 400));
  assert.strictEqual(entryPlays.length, heard + 1, 'a tap is not followed by another autoplay');
  q(w, '#inp').value = 'nope';
  q(w, '#sub').click();
  assert.ok(q(w, '.verdict').textContent.includes('再接再厉'));
  assert.ok(q(w, '.answer').textContent.includes('approach'));
  assert.ok(q(w, '.dmean').textContent.includes('接近'));
  assert.strictEqual(w.__state().days[dayOf()].new, 2);
  q(w, '#nx').click();
  assert.strictEqual(q(w, '.word').textContent, 'area');

  // 听音卡：播放被拒绝、网络失败、过期的失败回调。这些是本机可复现的失败，不是 iPhone 实测。
  store = {}; loads = []; audios = [];
  w = await boot();
  const uk = 'https://dict.youdao.com/dictvoice?audio=approach&type=1';
  const spoken = [];
  w.__voices = [];
  w.SpeechSynthesisUtterance = function (text) { this.text = text; };
  w.speechSynthesis = {
    cancel() {},
    getVoices() { return w.__voices; },
    speak(u) { spoken.push({ lang: u.lang, voice: u.voice && u.voice.lang, text: u.text }); }
  };
  const pending = [];
  w.Audio = function (src) {
    audios.push(src);
    this.src = src;
    this.error = null;
    this.play = () => new Promise((resolve, reject) => pending.push({ resolve, reject, el: this }));
    this.pause = () => { this.paused = true; };
  };
  w.__go('learn');
  passFollow(w);
  q(w, '#show').click();
  q(w, '[data-g="3"]').click();
  passDict(w, 'analyse');
  passFollow(w);
  q(w, '#show').click();
  w.matchMedia = query => ({ matches: String(query).includes('max-width: 759px'), media: String(query), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  audios = []; pending.length = 0;
  q(w, '[data-g="1"]').click();
  assert.strictEqual(q(w, '[data-dict]').dataset.dict, 'listen');
  assert.strictEqual(audios.join(','), uk, 'narrow entry still requests British audio');
  assert.notStrictEqual(w.document.activeElement, q(w, '#inp'), 'narrow listen card does not focus the input');
  assert.ok(q(w, '#inp').closest('#ime-dock'));
  assert.strictEqual(pending.length, 1);
  q(w, '#replay').click();
  assert.strictEqual(pending.length, 2, 'tap starts its own play and does not leave the entry timer running');
  assert.strictEqual(pending[0].el.paused, true, 'tap pauses the entry element on purpose');
  pending[1].resolve();
  await new Promise(r => setTimeout(r, 0));
  assert.strictEqual(q(w, '#listen-status').dataset.state, 'playing');
  assert.strictEqual(q(w, '#listen-status').textContent, '正在播放英音');
  pending[0].reject(Object.assign(new Error('NotAllowedError'), { name: 'NotAllowedError' }));
  await new Promise(r => setTimeout(r, 0));
  assert.strictEqual(q(w, '#listen-status').dataset.state, 'playing', 'a stale entry rejection must not cover the tap');
  const saved = store['foxVocab.v2'];
  w.__voices = [{ lang: 'en-US', name: 'Samantha' }];
  spoken.length = 0;
  q(w, '#replay').click();
  pending[pending.length - 1].reject(Object.assign(new Error('NotAllowedError'), { name: 'NotAllowedError' }));
  await new Promise(r => setTimeout(r, 0));
  assert.strictEqual(q(w, '#listen-status').textContent, '请点喇叭再听一次');
  assert.strictEqual(q(w, '#listen-status').dataset.state, 'error');
  assert.strictEqual(spoken.length, 0, 'an en-US voice is not used as fallback');
  assert.ok(!q(w, '#qc').innerHTML.toLowerCase().includes('approach'));
  assert.ok(!q(w, '#qc').innerHTML.includes('youdao') && !q(w, '#qc').innerHTML.includes('dictvoice'));
  assert.ok(!/[A-Za-z]/.test(q(w, '#listen-status').textContent), q(w, '#listen-status').textContent);
  assert.strictEqual(store['foxVocab.v2'], saved, 'a blocked play does not rewrite local records');
  q(w, '#replay').click();
  const net = pending[pending.length - 1];
  net.el.error = { code: 2 };
  net.resolve();
  net.el.onerror();
  await new Promise(r => setTimeout(r, 0));
  assert.strictEqual(q(w, '#listen-status').textContent, '读音没有播放出来，点喇叭再试一次');
  assert.ok(!q(w, '#qc').innerHTML.toLowerCase().includes('approach'));
  assert.ok(!q(w, '#qc').innerHTML.includes('http'));
  assert.strictEqual(store['foxVocab.v2'], saved, 'a media error does not reset storage');
  w.__voices = [{ lang: 'en-GB', name: 'Daniel' }];
  spoken.length = 0;
  q(w, '#replay').click();
  pending[pending.length - 1].reject(Object.assign(new Error('NotSupportedError'), { name: 'NotSupportedError' }));
  await new Promise(r => setTimeout(r, 0));
  assert.strictEqual(spoken.length, 1);
  assert.strictEqual(spoken[0].lang, 'en-GB');
  assert.strictEqual(spoken[0].voice, 'en-GB');
  assert.strictEqual(q(w, '#listen-status').textContent, '正在用本机英音播放');
  assert.ok(!q(w, '#listen-status').textContent.toLowerCase().includes('approach'));
  assert.ok(!q(w, '#qc').innerHTML.toLowerCase().includes('approach'));

  // 首页生词：本机词书自动填释义，加入今日队列，不重复，刷新还在，学完计入今日新学。
  store = {}; loads = []; audios = [];
  w = await boot();
  w.fetch = () => { throw new Error('no network'); };
  w.__go('home');
  assert.ok(q(w, '#newword').textContent.includes('生词'));
  assert.ok(q(w, '.hero').contains(q(w, '#newword')), '生词 sits on the home hero');
  assert.ok(q(w, '.petpose img').getAttribute('src').includes('assets/dog-mascot.png'));
  q(w, '#newword').click();
  assert.ok(q(w, '#nw') && q(w, '#nm') && q(w, '#nwadd'));
  q(w, '#nw').value = 'household';
  q(w, '#nw').dispatchEvent(new w.Event('input', { bubbles: true }));
  q(w, '#nw').dispatchEvent(new w.Event('blur'));
  await new Promise(r => setTimeout(r, 40));
  assert.ok(q(w, '#nm').value.includes('家庭'), q(w, '#nm').value);
  assert.ok(q(w, '#nwmeta').textContent.includes('/ˈhaʊshəʊld/'));
  assert.ok(!loads.includes('data/book-ielts-toefl-full.js'), 'current book fills without another word list');
  q(w, '#nwadd').click();
  await new Promise(r => setTimeout(r, 40));
  assert.ok([...w.document.querySelectorAll('.toast')].some(t => t.textContent.includes('已将「household」加入今日学习')));
  assert.strictEqual(w.__state().books['ielts-toefl-core'].today.join(','), 'household');
  assert.ok(!(w.__state().books['ielts-toefl-core'].extra || []).some(e => e.word === 'household'));
  q(w, '#nw').value = 'household';
  q(w, '#nm').value = '家庭';
  q(w, '#nwadd').click();
  await new Promise(r => setTimeout(r, 40));
  assert.ok([...w.document.querySelectorAll('.toast')].some(t => t.textContent.includes('「household」已在今日学习列表')));
  assert.strictEqual(w.__state().books['ielts-toefl-core'].today.join(','), 'household');
  q(w, '#nw').value = 'zzword';
  q(w, '#nm').value = '';
  q(w, '#nwadd').click();
  for (let i = 0; i < 80 && ![...w.document.querySelectorAll('.toast')].some(t => t.textContent.includes('请补上中文释义')); i++) await new Promise(r => setTimeout(r, 50));
  assert.ok([...w.document.querySelectorAll('.toast')].some(t => t.textContent.includes('请补上中文释义')));
  assert.strictEqual(w.__state().books['ielts-toefl-core'].today.join(','), 'household');
  q(w, '#nw').value = 'actress';
  q(w, '#nm').value = '';
  q(w, '#nw').dispatchEvent(new w.Event('blur'));
  for (let i = 0; i < 80 && q(w, '#nm').value !== '女演员'; i++) await new Promise(r => setTimeout(r, 50));
  assert.strictEqual(q(w, '#nm').value, '女演员');
  assert.ok(!w.__loadedBooks().includes('kaoyan'), 'lookup does not leave the other book open');
  assert.ok(!w.__loadedBooks().includes('ielts-toefl-full'));
  q(w, '#nwadd').click();
  await new Promise(r => setTimeout(r, 40));
  const bookState = w.__state().books['ielts-toefl-core'];
  assert.strictEqual(bookState.today.join(','), 'household,actress');
  const actress = bookState.extra.find(e => e.word === 'actress');
  assert.ok(actress && actress.meaning === '女演员' && actress.ipa === '/ˈæktrɪs/', JSON.stringify(actress));
  w = await boot();
  w.__go('learn');
  assert.strictEqual(q(w, '[data-follow]').dataset.follow, 'household', 'added word starts with 跟写');
  assert.strictEqual(q(w, '.word').textContent, 'household', 'added word is first in today\'s study');
  assert.ok(q(w, '.qtype').textContent.includes('跟写'));
  passFollow(w);
  assert.ok(q(w, '.qtype').textContent.includes('学新词'));
  q(w, '#show').click();
  assert.ok(txt(w).includes('家庭'));
  q(w, '[data-g="3"]').click();
  assert.strictEqual(w.__state().days[w.VocabCore.dayKey(w.Date.now())].new, 1);
  assert.strictEqual(q(w, '[data-dict]').dataset.dict, 'gloss');
  assert.ok(!q(w, '#qc').textContent.toLowerCase().includes('household'));
  passDict(w, 'household');
  w.__go('home');
  assert.ok(txt(w).includes('今日新学1/20'), txt(w));
  w.__go('capture');
  q(w, '#nw').value = 'household';
  q(w, '#nm').value = '家庭';
  q(w, '#nwadd').click();
  await new Promise(r => setTimeout(r, 40));
  assert.ok([...w.document.querySelectorAll('.toast')].some(t => t.textContent.includes('已经学过了')));
  assert.ok(!appSrc.includes('剑桥真题') && !appSrc.includes('官方真题'));

  console.log('UI tests passed');
})().catch(e => { console.error(e); process.exit(1); });
function textTop(ops, text) {
  const ys = ops.filter(o => o.op === 'fillText' && o.args[0] === text).map(o => o.args[2]);
  assert.ok(ys.length >= 1, text + ' ' + ys.join(','));
  return Math.min.apply(null, ys);
}
function C_today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function C_shift(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
