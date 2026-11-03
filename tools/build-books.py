#!/usr/bin/env python3
"""生成词书数据 data/book-*.js。
数据来源（均为宽松许可证，详见 LICENSES/THIRD_PARTY_NOTICES.md）：
  - ECDICT (MIT)  https://github.com/skywind3000/ECDICT  -> ecdict.csv
  - KyleBing/english-vocabulary (BSD-3-Clause) json/6-托福-顺序.json
用法：
  curl -L -o /tmp/ecdict.csv https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv
  curl -L -o /tmp/toefl.json "https://raw.githubusercontent.com/KyleBing/english-vocabulary/master/json/6-%E6%89%98%E7%A6%8F-%E9%A1%BA%E5%BA%8F.json"
  python3 tools/build-books.py /tmp/ecdict.csv /tmp/toefl.json
原 v1 的 359 个词（data/original-words.json，原创例句）放在核心词书最前面，释义/音标用 ECDICT 校正。
"""
import csv, json, re, sys, os
csv.field_size_limit(10**9)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ecd_path, kb_path = sys.argv[1], sys.argv[2]
POS_RE = re.compile(r'^(n|v|vt|vi|adj|a|adv|ad|prep|conj|pron|num|art|int|interj|aux|abbr|pl|s)\.\s*', re.I)
POS_MAP = {'a': 'adj', 'ad': 'adv', 'vt': 'v', 'vi': 'v', 'interj': 'int', 's': 'n', 'pl': 'n'}

def clean(trans):
    """返回 (pos, meaning)。去掉 [网络]/[计] 等行，按行取词性，每个词性最多 3 个义项，总共最多 3 行。"""
    senses = []
    for line in trans.replace('\\n', '\n').split('\n'):
        line = line.strip()
        if not line or line.startswith('['): continue
        m = POS_RE.match(line)
        pos = ''
        if m:
            p = m.group(1).lower(); pos = POS_MAP.get(p, p) + '.'; line = line[m.end():]
        line = re.sub(r'\[[^\]]*\]', '', line)          # 去掉 [医] 等领域标签
        line = re.sub(r'（[^）]{12,}）|\([^)]{12,}\)', '', line)  # 去掉过长括注
        parts = [x.strip() for x in re.split(r'[；;,，]', line) if x.strip()]
        if not parts: continue
        senses.append((pos, '；'.join(parts[:3])))
        if len(senses) >= 3: break
    if not senses: return '', ''
    merged = {}
    for p, s in senses:  # 同词性合并（vt./vi. -> v.），每个词性最多 3 个义项
        lst = merged.setdefault(p, [])
        for x in s.split('；'):
            if x not in lst and len(lst) < 3: lst.append(x)
    items = list(merged.items())
    main_pos = items[0][0] or 'n.'
    return main_pos, ' '.join((p + ' ' if p and i else '') + '；'.join(v) for i, (p, v) in enumerate(items)).strip()

def ipa(ph):
    """把 ECDICT 的旧式英音音标规范成现代英式 IPA（ˈ ˌ ə ɪ ʊ aɪ əʊ eə ...）。"""
    if not ph: return ''
    s = ph.replace("'", 'ˈ').replace(',', 'ˌ').replace('ә', 'ə').replace('є', 'e').replace(':', 'ː').replace('ɡ', 'g')
    for a, b in [('əu', 'əʊ'), ('ai', 'aɪ'), ('au', 'aʊ'), ('ei', 'eɪ'), ('ɔi', 'ɔɪ'), ('iə', 'ɪə'), ('uə', 'ʊə')]: s = s.replace(a, b)
    s = re.sub(r'i(?!ː)', 'ɪ', s); s = re.sub(r'u(?!ː)', 'ʊ', s)
    return '/' + s + '/'

ecd = {}
with open(ecd_path, encoding='utf-8') as f:
    for r in csv.DictReader(f):
        w = r['word']
        if not re.fullmatch(r'[a-z][a-z-]*', w): continue
        if w not in ecd or r['translation']: ecd[w] = r
kb = [x['word'].strip() for x in json.load(open(kb_path, encoding='utf-8'))]
kb_set = {w for w in kb if w in ecd}
orig = json.load(open(os.path.join(ROOT, 'data/original-words.json'), encoding='utf-8'))

def tagged(r): t = r['tag'].split(); return 'ielts' in t or 'toefl' in t
def entry(w, r):
    pos, meaning = clean(r['translation'])
    return {'word': w, 'ipa': ipa(r['phonetic'].strip()), 'pos': pos, 'meaning': meaning, 'examples': []}
def score(r):
    frq = int(r['frq'] or 0) or 10**6; bnc = int(r['bnc'] or 0) or 10**6
    return min(frq, bnc)

full_words = {w for w, r in ecd.items() if tagged(r)} | kb_set
def is_core(w):
    r = ecd[w]; col = int(r['collins'] or 0)
    return (tagged(r) and w in kb_set and (col >= 3 or (r['oxford'] == '1' and col >= 2))) or (tagged(r) and col >= 4)
corrected = []
def build(words):
    out, seen = [], set()
    for o in orig:  # 原 359 词优先，保留原创例句
        w = o['word']; r = ecd.get(w)
        e = dict(o)
        if r:
            pos, meaning = clean(r['translation'])
            if meaning:
                # 原释义里经 ECDICT 原文证实、且属于同一词性的首个义项保留在最前（学术语境义），其余以 ECDICT 为准
                first = re.split(r'[；;，,]', o['meaning'])[0].strip()
                if pos == o['pos'] and first and first in r['translation'] and first not in meaning.split(' ')[0].split('；'):
                    meaning = first + '；' + meaning
                e['meaning'] = meaning; e['pos'] = pos or e['pos']
            if not e.get('ipa') and r['phonetic'].strip(): e['ipa'] = ipa(r['phonetic'].strip())  # 原音标已是现代英式 IPA，仅缺失时补
            if e['meaning'] != o['meaning'] and w not in corrected: corrected.append(w)
        out.append(e); seen.add(w)
    rest = sorted((w for w in words if w not in seen), key=lambda w: (score(ecd[w]), w))
    for w in rest:
        e = entry(w, ecd[w])
        if e['meaning'] and e['pos']: out.append(e)
    return out

core = build({w for w in full_words if is_core(w)})
full = build(full_words)
books = [('ielts-toefl-core', '雅思托福核心词', '雅思/托福标签且出现在托福词表或 Collins/牛津高频的词；前 359 词带原创例句。', core),
         ('ielts-toefl-full', '雅思托福全部词', 'ECDICT 中标为雅思或托福的全部词 + KyleBing 托福词表。', full)]
index = []
for bid, name, desc, words in books:
    fn = 'data/book-' + bid + '.js'
    with open(os.path.join(ROOT, fn), 'w', encoding='utf-8') as f:
        f.write('// 自动生成：tools/build-books.py。来源 ECDICT(MIT) + KyleBing/english-vocabulary(BSD-3)\n')
        f.write('window.__registerBook(' + json.dumps({'id': bid, 'name': name, 'description': desc, 'words': words}, ensure_ascii=False, separators=(',', ':')) + ');\n')
    index.append({'id': bid, 'name': name, 'description': desc, 'count': len(words), 'file': fn})
with open(os.path.join(ROOT, 'data/books-index.js'), 'w', encoding='utf-8') as f:
    f.write('// 自动生成：词书目录（词书文件按需加载）\nwindow.VOCAB_BOOK_INDEX = ' + json.dumps(index, ensure_ascii=False, indent=1) + ';\n')
print({b['id']: b['count'] for b in index}, 'original words with ECDICT-corrected meaning:', len(corrected), 'missing from ECDICT:', [o['word'] for o in orig if o['word'] not in ecd])
