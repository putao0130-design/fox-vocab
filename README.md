# Dog Verb

纯静态网页背单词（雅思/托福 + 自助词书），无需构建，GitHub Pages 直接托管：https://putao0130-design.github.io/fox-vocab/

- 词书：雅思托福核心词（2209）/ 雅思托福全部词（12883）/ 雅思专项（4958）/ 考研英语（5005）/ 解剖学基础词汇（888），按需加载（`data/book-*.js`）。前四本由 `tools/build-books.py` 从 ECDICT (MIT) 与 KyleBing/english-vocabulary (BSD-3) 生成。雅思专项只收 ECDICT 里带 `ielts` 标签的词。考研英语按 KyleBing `json/5-考研-顺序.json` 的顺序，释义和音标用 ECDICT。前 359 词的原创例句仍在两本雅思托福词书最前；雅思专项里与这 359 词重合的词也保留原例句。解剖学基础词汇是 Ariel 自编词表（人体基础、恐龙专项、家畜、比较解剖、家禽、扬子鳄），英式拼写与音标按源表原样收录；它不是剑桥考试词表，也不是新东方或不背单词的商用词书。也可以自己创建词书（粘贴词表或逐词添加），进度按词书分开存在本机。
- 记忆算法：FSRS（`vendor/ts-fsrs.umd.js`，ts-fsrs v6.0.0，MIT）。评分 忘了/难/记得/简单；测验题答对=记得，答错=忘了。
- 掌握：FSRS 复习状态且排定间隔 ≥ 30 天。小狗月龄 = 当前词书掌握比例 × 12 个月，全部掌握 = 1 岁。四阶段：幼崽 → 少年 → 青年 → 成犬。
- 发音：英音，有道 `dictvoice?type=1`，失败时用浏览器 en-GB 语音。
- 进度：localStorage `foxVocab.v2`（键名沿用，避免清掉旧进度）；v1 数据（`foxVocab.v1`）首次打开时自动迁移，原始数据备份在 `foxVocab.v1.backup`。宠物默认名「小狗」；若旧数据里名字仍是「小狐」，会自动改成「小狗」，自定义名字保持不变。

测试：`node tests/core.test.js`；`NODE_PATH=<含 jsdom 的 node_modules> node tests/ui.test.js`；`python3 tests/build-books.test.py`；`node tests/sync-prep.test.js`；`node tests/supabase-adapter.test.js`；`node tests/sync-secrets.test.js`；`node tests/dogverb-sync-entry.test.js`；`node tests/dogverb-sync-bundle.test.mjs`

跨设备同步（配对码、Supabase Postgres + Edge Functions）的操作说明见 `docs/supabase-sync.md`。在 Ariel 亲口同意之前，不要合并或部署。现网 GitHub Pages 仍是 `?v=32`。

新词卡和复习卡在「查看释义」/翻开之后，若能用开放数据对上，会显示词根词缀（对不上则不显示）。数据来自 Etymoasis（源自维基词典贡献者，CC BY-SA 4.0），构建脚本是 `tools/build-etymology.py`。

第三方许可见 `LICENSES/THIRD_PARTY_NOTICES.md`。
