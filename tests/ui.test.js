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
  for (let i = 0; i < 20; i++) { q(w, '#show').click(); if (i === 0) q(w, '#known').click(); else q(w, `[data-g="${i % 2 ? 3 : 1}"]`).click(); }
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
  w.__go('learn'); q(w, '#show').click(); q(w, '[data-g="3"]').click();
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
  w.__go('learn'); q(w, '#show').click(); q(w, '[data-g="3"]').click();
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
  q(w, '#show').click();
  assert.ok(txt(w).includes('家庭') || txt(w).includes('一家人'), 'definition reused');
  w = await boot();
  w.__go('learn');
  assert.strictEqual(q(w, '.word').textContent, 'household', 'today list persists');
  assert.ok(w.__state().books['ielts-toefl-core'].extra.some(e => e.word === 'from' && e.meaning));

  // 窄屏键盘：输入坞贴在 visualViewport 上方，选择题不启用
  const css = read('style.css');
  assert.ok(css.includes('bottom:calc(env(safe-area-inset-bottom) + 64px + 12px)'));
  assert.ok(css.includes('bottom:calc(var(--ime-bottom) + var(--dock-h, 0px) + 12px)'));
  assert.ok(css.includes('body.kb-open #nav{display:none}'));
  assert.ok(!css.includes('bottom:110px'));
  w = await boot(win => {
    let vh = 844, top = 0; const ls = {};
    const fake = {
      get height() { return vh; }, get offsetTop() { return top; }, width: 390,
      addEventListener(t, fn) { (ls[t] = ls[t] || []).push(fn); }, removeEventListener() {},
      dispatch() { (ls.resize || []).forEach(fn => fn()); }
    };
    Object.defineProperty(win, 'visualViewport', { configurable: true, get: () => fake });
    Object.defineProperty(win, 'innerHeight', { configurable: true, get: () => 844 });
    win.matchMedia = q => ({ matches: /max-width:\s*759/.test(String(q)), addEventListener() {}, removeEventListener() {} });
    win.__ime = { set(h, off) { vh = h; top = off || 0; fake.dispatch(); } };
  });
  w.__go('learn'); q(w, '#show').click(); q(w, '[data-g="3"]').click();
  w.__go('practice'); q(w, '[data-m="clozeType"]').click();
  assert.ok(q(w, '#ans #inp'), 'spelling input starts in the card');
  assert.ok(!w.document.body.classList.contains('kb-open'));
  w.__ime.set(844 - 336, 0);
  assert.ok(w.document.body.classList.contains('kb-open'));
  assert.strictEqual(w.document.documentElement.style.getPropertyValue('--ime-bottom'), '336px');
  const dock = w.document.getElementById('ime-dock');
  assert.ok(dock && dock.querySelector('#inp') && dock.querySelector('.senttip'), 'dock holds the hint and the input');
  assert.ok(!q(w, '#ans #inp'));
  assert.ok(dock.querySelector('.senttip').textContent.includes('长按单词加入今日学习'));
  w.__ime.set(844 - 336, 20);
  assert.ok(w.document.getElementById('ime-dock').querySelector('#inp'), 'a second viewport event keeps the dock');
  assert.strictEqual(w.document.documentElement.style.getPropertyValue('--ime-bottom'), '316px');
  w.__go('practice'); q(w, '[data-m="clozeChoice"]').click();
  w.__ime.set(844 - 336, 0);
  assert.ok(!w.document.getElementById('ime-dock'), 'choice questions do not dock');
  w.__ime.set(844, 0);
  w.__go('sentence', 'analyse');
  w.__ime.set(844 - 300, 12);
  assert.strictEqual(w.document.documentElement.style.getPropertyValue('--ime-bottom'), '288px');
  assert.ok(w.document.getElementById('ime-dock').querySelector('#s'), 'sentence box docks');
  w.__ime.set(844, 0);
  assert.ok(!w.document.body.classList.contains('kb-open'));
  assert.ok(q(w, '#s'), 'textarea returns after the keyboard closes');

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
  assert.ok(!unique.some(t => t === '连续打卡' || t.indexOf('累计') !== -1 || /^\d+$/.test(t)), unique.join('|'));
  assert.strictEqual(ops.filter(o => o.op === 'stroke').length, 1, 'gold rule only');
  assert.ok(ops.some(o => o.op === 'set' && o.key === 'strokeStyle' && String(o.value).toUpperCase() === '#F0BB51'));
  assert.ok(ops.some(o => o.op === 'set' && o.key === 'lineWidth' && o.value === 2));
  const drawn = ops.filter(o => o.op === 'drawImage');
  assert.ok(drawn.every(o => o.args[0] && o.args[0]._decoded), 'draw only after decode');
  const drawnSrc = drawn.map(o => o.args[0] && o.args[0]._src || '');
  assert.ok(drawnSrc.some(s => s.indexOf(photos[quote.index]) !== -1), 'today landscape ' + photos[quote.index]);
  assert.ok(drawnSrc.some(s => s.indexOf('logo-doubao') !== -1), 'doubao logo');
  assert.ok(drawnSrc.some(s => s.indexOf('dog-mascot-transparent') !== -1), 'transparent pet');
  assert.ok(drawnSrc.every(s => s.indexOf('paw-check') === -1), 'calendar paw is not on the card');
  assert.ok(drawnSrc.every(s => s.indexOf('dog-mascot.png') === -1), 'no watermarked mascot');
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
  assert.ok(ops.some(o => o.op === 'drawImage' && String(o.args[0] && o.args[0]._src || '').indexOf(photos[quote2.index]) !== -1));
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

  console.log('UI tests passed');
})().catch(e => { console.error(e); process.exit(1); });
function C_today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function C_shift(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
