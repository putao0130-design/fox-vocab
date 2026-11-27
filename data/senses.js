/* Manual preview table for the study-card sense list.
 * Glosses are splits of ECDICT (MIT) meanings already shipped in the built-in books.
 * idx is the 0-based place of that chunk in the book gloss. freq_score is a manual
 * preview weight, not a corpus count, and the UI does not sort by it.
 * source is "manual" on every row. No corpus sentences are stored here.
 */
(function (root) {
  root.DOGVERB_SENSES = [
    { word: 'issue', pos: 'n.', idx: 0, gloss: '发行', is_high_freq: false, freq_score: 2, source: 'manual' },
    { word: 'issue', pos: 'n.', idx: 1, gloss: '问题', is_high_freq: true, freq_score: 5, source: 'manual' },
    { word: 'issue', pos: 'n.', idx: 2, gloss: '后果', is_high_freq: false, freq_score: 1, source: 'manual' },

    { word: 'paper', pos: 'n.', idx: 0, gloss: '纸', is_high_freq: false, freq_score: 2, source: 'manual' },
    { word: 'paper', pos: 'n.', idx: 1, gloss: '文件', is_high_freq: false, freq_score: 2, source: 'manual' },
    { word: 'paper', pos: 'n.', idx: 2, gloss: '文章', is_high_freq: true, freq_score: 5, source: 'manual' },

    { word: 'novel', pos: 'n.', idx: 0, gloss: '小说', is_high_freq: false, freq_score: 3, source: 'manual' },
    { word: 'novel', pos: 'n.', idx: 1, gloss: '长篇故事', is_high_freq: false, freq_score: 1, source: 'manual' },
    { word: 'novel', pos: 'adj.', idx: 2, gloss: '新奇的', is_high_freq: true, freq_score: 5, source: 'manual' },
    { word: 'novel', pos: 'adj.', idx: 3, gloss: '异常的', is_high_freq: false, freq_score: 1, source: 'manual' },

    { word: 'address', pos: 'n.', idx: 0, gloss: '住址', is_high_freq: false, freq_score: 9, source: 'manual' },
    { word: 'address', pos: 'n.', idx: 1, gloss: '演说', is_high_freq: true, freq_score: 4, source: 'manual' },
    { word: 'address', pos: 'n.', idx: 2, gloss: '举止', is_high_freq: false, freq_score: 1, source: 'manual' },
    { word: 'address', pos: 'v.', idx: 3, gloss: '发表(演说或讲话)', is_high_freq: true, freq_score: 4, source: 'manual' },
    { word: 'address', pos: 'v.', idx: 4, gloss: '对付', is_high_freq: true, freq_score: 2, source: 'manual' },
    { word: 'address', pos: 'v.', idx: 5, gloss: '写地址', is_high_freq: false, freq_score: 1, source: 'manual' },

    { word: 'cell', pos: 'n.', idx: 0, gloss: '单元', is_high_freq: false, freq_score: 1, source: 'manual' },
    { word: 'cell', pos: 'n.', idx: 1, gloss: '细胞', is_high_freq: true, freq_score: 5, source: 'manual' },
    { word: 'cell', pos: 'n.', idx: 2, gloss: '电池', is_high_freq: false, freq_score: 2, source: 'manual' },

    { word: 'field', pos: 'n.', idx: 0, gloss: '领域', is_high_freq: true, freq_score: 5, source: 'manual' },
    { word: 'field', pos: 'n.', idx: 1, gloss: '田地', is_high_freq: false, freq_score: 1, source: 'manual' },
    { word: 'field', pos: 'n.', idx: 2, gloss: '场地', is_high_freq: false, freq_score: 2, source: 'manual' },

    { word: 'concrete', pos: 'n.', idx: 0, gloss: '凝结物', is_high_freq: false, freq_score: 1, source: 'manual' },
    { word: 'concrete', pos: 'n.', idx: 1, gloss: '混凝土', is_high_freq: false, freq_score: 2, source: 'manual' },
    { word: 'concrete', pos: 'adj.', idx: 2, gloss: '具体的', is_high_freq: true, freq_score: 5, source: 'manual' },
    { word: 'concrete', pos: 'adj.', idx: 3, gloss: '实在的', is_high_freq: false, freq_score: 1, source: 'manual' }
  ];
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
