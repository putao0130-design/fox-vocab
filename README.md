# Dog Verb

纯静态网页背单词（雅思/托福 + 自助词书），无需构建，GitHub Pages 直接托管：https://putao0130-design.github.io/fox-vocab/

- 词书：雅思托福核心词（2209）/ 雅思托福全部词（12883），按需加载（`data/book-*.js`），由 `tools/build-books.py` 从 ECDICT (MIT) 与 KyleBing/english-vocabulary (BSD-3) 生成。前 359 词带原创例句。也可以自己创建词书（粘贴词表或逐词添加），进度按词书分开存在本机。
- 记忆算法：FSRS（`vendor/ts-fsrs.umd.js`，ts-fsrs v6.0.0，MIT）。评分 忘了/难/记得/简单；测验题答对=记得，答错=忘了。
- 掌握：FSRS 复习状态且排定间隔 ≥ 30 天。小狗月龄 = 当前词书掌握比例 × 12 个月，全部掌握 = 1 岁。四阶段：幼崽 → 少年 → 青年 → 成犬。
- 发音：英音，有道 `dictvoice?type=1`，失败时用浏览器 en-GB 语音。
- 进度：localStorage `foxVocab.v2`（键名沿用，避免清掉旧进度）；v1 数据（`foxVocab.v1`）首次打开时自动迁移，原始数据备份在 `foxVocab.v1.backup`。宠物默认名「小狗」；若旧数据里名字仍是「小狐」，会自动改成「小狗」，自定义名字保持不变。

测试：`node tests/core.test.js`；`NODE_PATH=<含 jsdom 的 node_modules> node tests/ui.test.js`

第三方许可见 `LICENSES/THIRD_PARTY_NOTICES.md`。
