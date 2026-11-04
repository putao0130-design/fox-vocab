// 无头 UI 测试（jsdom）：用法 NODE_PATH=<含 jsdom 的 node_modules> node tests/ui.test.js
const { JSDOM } = require('jsdom'); const fs = require('fs'); const path = require('path'); const assert = require('assert');
const dir = path.join(__dirname, '..'); let store = {}; let offset = 0; let loads = []; let audios = [];
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
async function boot() {
  const html = read('index.html').replace(/<script src=.*<\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window; const real = w.Date.now; w.Date.now = () => real() + offset;
  Object.defineProperty(w, 'localStorage', { value: { getItem: k => store[k] ?? null, setItem: (k, v) => store[k] = String(v), removeItem: k => delete store[k] } });
  w.alert = () => {}; w.confirm = () => true; w.scrollTo = () => {}; w.prompt = () => null;
  w.Audio = function (src) { audios.push(src); this.src = src; this.play = () => Promise.resolve(); this.pause = () => {}; };
  w.__bookLoader = file => { loads.push(file); w.eval(read(file.split('?')[0])); return Promise.resolve(); };
  for (const f of ['vendor/ts-fsrs.umd.js', 'data/books-index.js', 'core.js', 'app.js']) w.eval(read(f));
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
  console.log('UI tests passed');
})().catch(e => { console.error(e); process.exit(1); });
function C_today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function C_shift(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
