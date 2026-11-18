#!/usr/bin/env python3
"""词书筛选的小样本检查。不读取完整 ECDICT。"""
import csv, importlib.util, os, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('build_books', os.path.join(ROOT, 'tools/build-books.py'))
bb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bb)

def row(word, translation, tag, collins='0', oxford='0', frq='0', bnc='0', phonetic='test'):
    return {
        'word': word, 'phonetic': phonetic, 'definition': '', 'translation': translation,
        'pos': '', 'collins': collins, 'oxford': oxford, 'tag': tag, 'bnc': bnc, 'frq': frq,
        'exchange': '', 'detail': '', 'audio': '',
    }

rows = [
    row('alpha', 'n. 阿尔法', 'ielts toefl', collins='5', oxford='1', frq='9', phonetic="æl'fə"),
    row('bravo', 'n. 布拉沃', 'toefl', collins='1', frq='3'),
    row('charlie', 'n. 查理', 'ielts', collins='2', frq='2'),
    row('delta', 'n. 德尔塔', 'ielts toefl', collins='3', frq='1'),
    row('echo', 'n. 回声', '', collins='5', frq='4'),
    row('foxtrot', 'n. 狐步', 'ky', collins='1', frq='8'),
    row('golf', '[计] 高尔夫', 'ielts', frq='7'),
    row('hotel', 'n. 旅馆', 'ky', phonetic="həʊ'tel"),
    row('india', '', ''),
    row('juliet', '朱丽叶', 'ky'),
    row('kilo', 'n. 千克', ''),
    row('lima', 'n. 利马', ''),
]
bb.ecd = {r['word']: r for r in rows}
bb.kb = ['alpha', 'bravo', 'delta', 'echo']
bb.kb_set = {w for w in bb.kb if w in bb.ecd}
bb.orig = [
    {'word': 'alpha', 'ipa': '/ˈælfə/', 'pos': 'n.', 'meaning': '阿尔法', 'examples': ['Alpha stays in the original list.']},
    {'word': 'bravo', 'ipa': '/ˈbrɑːvəʊ/', 'pos': 'n.', 'meaning': '布拉沃', 'examples': ['Bravo is only toefl.']},
    {'word': 'core', 'ipa': '/kɔː/', 'pos': 'n.', 'meaning': '核心', 'examples': ['Core is not in ECDICT.']},
]
bb.corrected = []
full_words = {w for w, r in bb.ecd.items() if bb.tagged(r)} | bb.kb_set
core = bb.build({w for w in full_words if bb.is_core(w)})
full = bb.build(full_words)
assert [w['word'] for w in core[:3]] == ['alpha', 'bravo', 'core'], [w['word'] for w in core]
assert core[0]['examples'] == ['Alpha stays in the original list.']
assert {w['word'] for w in core[3:]} == {'delta'}
assert [w['word'] for w in full[:3]] == ['alpha', 'bravo', 'core']
assert 'echo' in {w['word'] for w in full} and 'charlie' in {w['word'] for w in full}
assert 'foxtrot' not in {w['word'] for w in full}

ielts_set = {w for w, r in bb.ecd.items() if bb.has_tag(r, 'ielts')}
ielts = bb.build_ielts(ielts_set)
names = [w['word'] for w in ielts]
assert names == ['alpha', 'delta', 'charlie'], names
assert 'bravo' not in names and 'echo' not in names and 'golf' not in names and 'core' not in names
assert ielts[0]['examples'][0] == 'Alpha stays in the original list.'
assert ielts[0]['examples'][0] == bb.orig[0]['examples'][0]
assert all(bb.has_tag(bb.ecd[w], 'ielts') for w in names)
assert all(not w['examples'] for w in ielts if w['word'] not in {o['word'] for o in bb.orig})

ordered = bb.build_ordered(['hotel', 'india', 'juliet', 'kilo', 'Hotel', 'lima', 'kilo', '  LIMA '])
assert [w['word'] for w in ordered] == ['hotel', 'kilo', 'lima']
assert ordered[0]['pos'] == 'n.' and '旅馆' in ordered[0]['meaning']
assert ordered[0]['ipa'].startswith('/') and ordered[0]['ipa'].endswith('/')
assert bb.ipa("həʊ'tel") == ordered[0]['ipa']

# 没有词性的译文即使能洗出文字，也不进考研词书。
assert bb.clean('朱丽叶')[1] == '朱丽叶'
assert bb.has_pos('朱丽叶') is False
assert bb.has_pos('n. 千克') is True
assert bb.clean('[计] 高尔夫') == ('', '')

fd, path = tempfile.mkstemp(suffix='.csv')
os.close(fd)
with open(path, 'w', encoding='utf-8', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    writer.writeheader(); writer.writerows(rows)
loaded = {}
with open(path, encoding='utf-8') as f:
    for r in csv.DictReader(f):
        if r['word'] == 'alpha': loaded = r
os.remove(path)
assert loaded['tag'] == 'ielts toefl' and loaded['translation'] == 'n. 阿尔法'
print('build-books tests passed', {'core': len(core), 'full': len(full), 'ielts': names, 'kaoyan': [w['word'] for w in ordered]})
