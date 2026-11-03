# 狐狸背单词 v1
纯静态网页，无需构建。直接打开 index.html 或用 `python3 -m http.server` 托管（可用于 GitHub Pages）。
- data/books.js：词书数据（向 window.VOCAB_BOOKS 追加即可增加新词书）
- core.js：间隔重复/词形/造句检查/宠物逻辑（浏览器与 Node 共用）
- app.js：界面；style.css：样式
- 测试：`node tests/core.test.js`；`NODE_PATH=<jsdom所在node_modules> node tests/ui.test.js`
