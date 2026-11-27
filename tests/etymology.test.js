const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../data/etymology.js'), 'utf8');
const ctx = { window: {}, globalThis: {} };
vm.runInNewContext(src, ctx);
const data = ctx.window.DOGVERB_ETYMOLOGY;
assert.ok(data && data.prefixes && data.roots && data.suffixes, 'etymology payload loads');
assert.strictEqual(data.license, 'CC BY-SA 4.0');
assert.ok(data.attribution.includes('Etymoasis'));
assert.ok(data.attribution.includes('维基词典'));

globalThis.DOGVERB_ETYMOLOGY = data;
const C = require('../core.js');

function ids(hit) { return hit.parts.map(p => p.id); }
function forms(hit) { return hit.parts.map(p => p.kind + ':' + p.form); }

// 例词（数据已核对）
const action = C.etymologyOf('action');
assert.ok(action && action.checked, 'action is a checked example');
assert.ok(ids(action).includes('act') && ids(action).includes('-ion'), ids(action).join(','));
assert.ok(action.parts.some(p => p.meaningZh && /[\u4e00-\u9fff]/.test(p.meaningZh)), 'Chinese gloss present');

const bio = C.etymologyOf('biology');
assert.ok(bio && bio.checked);
assert.ok(ids(bio).includes('bio') && ids(bio).includes('-logy'), ids(bio).join(','));

const photo = C.etymologyOf('photograph');
assert.ok(photo && photo.checked);
assert.ok(ids(photo).includes('phot') && ids(photo).includes('graph'), ids(photo).join(','));

const typ = C.etymologyOf('atypical');
assert.ok(typ && typ.checked);
assert.ok(ids(typ).includes('a-not'), ids(typ).join(','));

const tel = C.etymologyOf('telephone');
assert.ok(tel && tel.checked);
assert.ok(ids(tel).includes('tele-') && ids(tel).includes('phon'), ids(tel).join(','));

const psy = C.etymologyOf('psychology');
assert.ok(psy && psy.checked);
assert.ok(ids(psy).includes('psych') && ids(psy).includes('-logy'), ids(psy).join(','));

const micro = C.etymologyOf('microscope');
assert.ok(micro && micro.checked);
assert.ok(ids(micro).includes('micro-') && ids(micro).includes('scop'), ids(micro).join(','));

const trans = C.etymologyOf('transport');
assert.ok(trans && trans.checked);
assert.ok(ids(trans).includes('trans-') && ids(trans).includes('port'), ids(trans).join(','));

const demo = C.etymologyOf('democracy');
assert.ok(demo && demo.checked);
assert.ok(ids(demo).includes('dem') && ids(demo).includes('-cracy'), ids(demo).join(','));

// 英式拼写变体仍能对上例词
const colour = C.etymologyOf('colour') || C.etymologyOf('color');
// colour may or may not be in examples; just must not throw
assert.strictEqual(colour, C.etymologyOf('colour'));

// 不展示：太短、no-split、编造不了的词
assert.strictEqual(C.etymologyOf('area'), null);
assert.strictEqual(C.etymologyOf('cat'), null);
assert.strictEqual(C.etymologyOf('the'), null);
assert.strictEqual(C.etymologyOf('discover'), null, 'no-split');
assert.strictEqual(C.etymologyOf('automatic'), null, 'no-split wins over auto- example');
assert.strictEqual(C.etymologyOf('champion'), null);
assert.strictEqual(C.etymologyOf('agriculture'), null, 'agri/cult not in licensed data');
assert.strictEqual(C.etymologyOf(''), null);
assert.strictEqual(C.etymologyOf(null), null);

// 高置信模式切分（不在例词表，但词根词缀可完整覆盖）
const inv = C.etymologyOf('invisible');
assert.ok(inv, 'invisible pattern');
assert.ok(ids(inv).includes('in-not') && ids(inv).includes('vid') && ids(inv).some(id => id === '-able' || id === '-ible'), ids(inv).join(','));

const abd = C.etymologyOf('abdicate');
assert.ok(abd, 'abdicate pattern');
assert.ok(ids(abd).includes('ab-') || ids(abd).some(id => id.indexOf('ab') === 0), ids(abd).join(','));
assert.ok(ids(abd).includes('dict') || ids(abd).includes('dic') || abd.parts.some(p => p.form.indexOf('dic') === 0), forms(abd).join(','));

const abund = C.etymologyOf('abundance');
assert.ok(abund, 'abundance pattern');
assert.ok(abund.parts.some(p => p.form === 'und' || p.id === 'und'), forms(abund).join(','));

const cephal = C.etymologyOf('cephalic');
assert.ok(cephal, 'cephalic pattern');
assert.ok(cephal.parts.some(p => p.id === 'cephal'), forms(cephal).join(','));

// 易误切：不展示
assert.strictEqual(C.etymologyOf('acidity'), null, 'acid is not a listed root; cid+ity is a false split');
assert.strictEqual(C.etymologyOf('activity'), null, 'act+vit+y is a false split');
assert.strictEqual(C.etymologyOf('abdominal'), null, 'ab+domin+al is a false split');
assert.strictEqual(C.etymologyOf('absentee'), null, 'ab+sent+ee is a false split');

// inspect：例词只有 spect 时，可补上 in-
const inspect = C.etymologyOf('inspect');
assert.ok(inspect, 'inspect');
assert.ok(inspect.parts.some(p => p.id === 'spec' || p.form.indexOf('spect') === 0), forms(inspect).join(','));

// 展示形态：前缀带尾连字符，后缀带首连字符
const actPart = action.parts.find(p => p.id === '-ion');
assert.ok(actPart && actPart.display === '-ion', actPart && actPart.display);

// 传入数据对象时不依赖全局
const isolated = C.etymologyOf('biology', data);
assert.ok(isolated && isolated.checked);


// 补上的 in- 与 in-not / in-into 形态相同，释义并列，避免只标成「不」
const inspectIn = inspect.parts.find(p => p.kind === 'prefix');
assert.ok(inspectIn && inspectIn.meaningZh.includes('进入') && inspectIn.meaningZh.includes('不'), inspectIn && inspectIn.meaningZh);

// phot 的 light 是「光」不是「轻」
const photoLight = photo.parts.find(p => p.id === 'phot');
assert.ok(photoLight && photoLight.meaningZh === '光', photoLight && photoLight.meaningZh);

// 例词已标明 a-not 时，不与 ab- 的短形式 a 混在一起
const typMean = typ.parts.find(p => p.id === 'a-not');
assert.ok(typMean && typMean.meaningZh === '不，没有', typMean && typMean.meaningZh);

console.log('etymology tests ok');

