// 无头 UI 测试（jsdom）：用法 NODE_PATH=<含 jsdom 的 node_modules> node tests/ui.test.js
const { JSDOM } = require('jsdom'); const fs = require('fs'); const path = require('path'); const assert = require('assert');
const dir = path.join(__dirname, '..'); let store = {}; let offset = 0;
function boot() {
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8').replace(/<script src=.*<\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window; const real = w.Date.now; w.Date.now = () => real() + offset;
  Object.defineProperty(w, 'localStorage', { value: { getItem: k => store[k] ?? null, setItem: (k, v) => store[k] = String(v), removeItem: k => delete store[k] } });
  w.alert = () => {}; w.confirm = () => true; w.scrollTo = () => {};
  for (const f of ['data/books.js', 'core.js', 'app.js']) w.eval(fs.readFileSync(path.join(dir, f), 'utf8'));
  return w;
}
const q = (w, s) => w.document.querySelector(s), txt = w => w.document.getElementById('app').textContent;
let w = boot(); assert.ok(txt(w).includes('今日新学'), 'home renders');
w.__go('learn');
for (let i = 0; i < 20; i++) { q(w, '#show').click(); (i === 0 ? q(w, '#known') : q(w, '#ok')).click(); }
assert.ok(txt(w).includes('已完成'), 'daily target done');
assert.strictEqual(Object.keys(w.__state().books['ielts-toefl-core'].cards).length, 20);
assert.strictEqual(w.__state().fox.food, 5);
// 预习
w.__go('preview'); assert.ok(txt(w).includes('明日新词预习（20）'));
// 复习：6 分钟后到期
offset = 6 * 60000; w = boot(); w.__go('review'); assert.ok(txt(w).includes('剩余 19 个到期'), txt(w).slice(0, 80));
let answered = 0;
function answer(w, correct) {
  const btns = [...w.document.querySelectorAll('#ans button')];
  if (btns.length) { const s = w.__state(); btns[0].click(); }
  else { const inp = q(w, '#inp'); inp.value = 'zzz'; q(w, '#sub').click(); }
  answered++; q(w, '#nx').click();
}
for (let i = 0; i < 19; i++) answer(w, false);
const st = w.__state(); assert.ok(st.days[Object.keys(st.days)[0]].correct + st.days[Object.keys(st.days)[0]].wrong >= 19);
// 各练习模式都能出题并作答
for (const m of ['w2m', 'm2w', 'pos', 'clozeChoice', 'clozeType', 'dictation', 'meaningType', 'mix']) { w.__go('practice'); q(w, `[data-m="${m}"]`).click(); assert.ok(q(w, '#ans'), m); answer(w); }
// 造句
w.__go('sentence', 'analyse'); q(w, '#s').value = 'bad'; q(w, '#chk').click(); assert.ok(txt(w).includes('句首应大写'));
q(w, '#s').value = 'Scientists analysed the samples carefully last week.'; q(w, '#chk').click();
assert.ok(txt(w).includes('已保存')); assert.strictEqual(w.__state().books['ielts-toefl-core'].sentences.analyse.length, 1);
// 宠物
w.__go('pet'); assert.ok(txt(w).includes('月龄')); q(w, '#f1').click(); assert.strictEqual(w.__state().fox.food, 4); assert.strictEqual(w.__state().fox.xp, 10);
// 持久化：重新打开
w = boot(); assert.strictEqual(w.__state().fox.xp, 10); assert.strictEqual(Object.keys(w.__state().books['ielts-toefl-core'].cards).length, 20);
// 三天没学 -> 饱食度下降
const h = w.__state().fox.hunger; offset = 3 * 86400000; w = boot(); w.__go('pet'); assert.ok(w.__state().fox.hunger < h, 'hunger drops');
w.__go('words'); w.__go('settings'); w.__go('home');
console.log('UI tests passed, answered', answered);
