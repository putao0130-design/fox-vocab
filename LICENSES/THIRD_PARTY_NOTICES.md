# 第三方组件与数据许可 / Third-party notices

| 组件 | 用途 | 许可证 | 文件 |
|---|---|---|---|
| [ECDICT](https://github.com/skywind3000/ECDICT) © Linwei (skywind3000) | 词书单词、英式音标、中文释义、词性。雅思托福词书用其中的雅思/托福标签；雅思专项只收标签含 `ielts` 的词；考研英语的释义和音标也取自这里 | MIT | ECDICT-LICENSE.txt |
| [KyleBing/english-vocabulary](https://github.com/KyleBing/english-vocabulary) © 2022-2026 KyleBing | 托福顺序词表 `json/6-托福-顺序.json`；考研顺序词表 `json/5-考研-顺序.json`（README 记 9602 条，词书按该顺序去重） | BSD-3-Clause | english-vocabulary-LICENSE.txt |
| [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) v6.0.0 © Open Spaced Repetition | FSRS 记忆算法（vendor/ts-fsrs.umd.js） | MIT | ts-fsrs-LICENSE.txt |
| [OpenCC](https://github.com/BYVoid/OpenCC) © OpenCC contributors | 在线释义的繁体转简体字符表（data/t2s.js，源自 TSCharacters） | Apache-2.0 | — |
| [Wiktionary](https://en.wiktionary.org/) © 维基词典贡献者 | 词书未收录的词，页面运行时查询英文维基词典的中文释义 | CC BY-SA 4.0 / GFDL | — |
| Inria Serif © 2017 The Inria Serif Project Authors；Noto Sans SC © 2014-2021 Adobe；Noto Serif SC © 2012 Google | 每日金句卡的西文与中文（按金句子集） | SIL OFL 1.1 | assets/fonts/OFL.txt |
| Wikimedia Commons 风景：JaredMcKenzie、Z3lvs、Romainbehar | 每日金句卡背景（CC0 原图，长边 2160） | CC0 1.0 | assets/landscapes/SOURCES.md |

雅思专项的词表和释义都来自 ECDICT。考研英语只用 KyleBing 的 `json/5-考研-顺序.json` 决定词和顺序，释义与音标用 ECDICT；ECDICT 里没有释义或没有词性的词不写入这本词书。

《解剖学基础词汇》（`data/book-anatomy.js`，888 词）是 Ariel 自编词表，内容为人体基础、恐龙专项、家畜、比较解剖、家禽、扬子鳄。英式拼写与音标按源表原样收录。它不是 ECDICT 或 KyleBing 词表，不是剑桥考试词表，也不是新东方或不背单词的商用词书。

发音音频在播放时从有道词典 (dict.youdao.com, type=1 英音) 在线获取，不随本项目分发。有道 jsonapi 对网页 Origin 返回 403，释义不从该接口读取。
词书未收录的词，中文释义在查询时来自英文维基词典，不随本项目分发。
原 359 个词的例句为本项目原创。

## KyleBing/english-vocabulary — BSD 3-Clause License

BSD 3-Clause License

Copyright (c) 2022-2026, KyleBing

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
