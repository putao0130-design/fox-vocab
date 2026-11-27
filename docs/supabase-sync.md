# Dog Verb 跨设备同步（Supabase）操作说明

请勿合并本 pull request，也不要部署到 GitHub Pages 或把函数/迁移自己点上线，除非 Ariel 亲口同意。

本说明针对已经建好的免费项目，不要再新建项目，也不要开通任何付费计划。

- 组织：putao0130-design's Org（Free）
- 项目：putao0130-design's Project
- 项目 URL / ref：`https://zkvscutsjspzuteogfet.supabase.co`（`zkvscutsjspzuteogfet`）
- 区域：Northeast Asia (Tokyo) `ap-northeast-1`
- GitHub 保持未连接

现网学习页仍然是 https://putao0130-design.github.io/fox-vocab/?v=32 。GitHub Pages 只发布 `main`，所以不要打开现网 `?v=33` 来预览这个分支。

## 同步什么

配对成功后，同一学习空间会在 HarmonyOS 手机、Windows 11 Edge、Mac 的同一个 PWA 地址之间自动同步：

- 学习进度（各词书的 FSRS 卡片）
- 复习计划
- 生词
- 自助词书

设备先用配对码连接，不用注册学习账号。手动导出/导入只是备份，不能代替自动同步。进度键名仍是 `foxVocab.v2`。

## 安全

- **不要**把数据库密码、`service_role` 密钥或任何密钥写进聊天、前端、仓库、commit、PR 正文、测试、日志或截图。
- 浏览器只调用 Edge Function。函数用 **function secret** 里的 `SUPABASE_SERVICE_ROLE_KEY` 写数据库。客户端可以保存 **anon / public** 密钥，不能保存 service role。
- 表已开启 RLS，并且没有给 `anon` / `authenticated` 的政策或授权。即使有人拿 anon 密钥直接打 Data API，也读不到、写不了别人的行。
- 请把 Data API automatic grants 保持关闭。

## 1. 在 SQL Editor 跑迁移

1. 打开项目 `zkvscutsjspzuteogfet`。
2. 左侧进入 **SQL Editor**，点 **New query**。
3. 把仓库里的 `supabase/migrations/001_dogverb_sync.sql` 全文粘贴进去，点 **Run**。
4. 不要改脚本，不要在这个查询里粘贴任何密钥。

脚本会建立 `public.dogverb_kv`、开启并强制 RLS、收回 `anon` / `authenticated` / `PUBLIC` 的表权限、并把 `dogverb_commit_tx` 的 `EXECUTE` 只授给 `service_role`。

## 2. 确认 Data API 自动授权是关的

打开 **Project Settings → Data API**（有的界面在 **Project Settings → API**）。

把针对新表自动授予 `anon` / `authenticated` 的选项保持关闭。本迁移已经显式收回这些权限；不要再打开自动授权。

## 3. 设置 Edge Function 密钥（只在控制台，不要发到聊天）

1. 打开 **Project Settings → API**，在 **Project API keys** 里能看到：
   - `anon` `public`：可以稍后填进 `sync-config.js`（这不是机密）。
   - `service_role`：只用于下一步，**不要复制到聊天、仓库或前端**。
2. 打开 **Project Settings → Edge Functions → Secrets**（有的界面是 Edge Functions 页的 Manage secrets）。
3. 新增一条密钥，名字必须是：
   - `SUPABASE_SERVICE_ROLE_KEY`
4. 值从第 1 步的 `service_role` 密钥粘贴到控制台这个字段里。`SUPABASE_URL` 一般会由运行时自动注入，不用再写一遍。

如果需要别人代填 `anon` / public 密钥，请走密码库（vault），不要发在聊天里。`service_role` 和数据库密码同样只进控制台，不要进聊天或仓库。

## 4. 准备并部署函数 `dogverb-sync`（在你同意上线之后）

本 PR 只提供源码，**没有**部署函数。

在仓库根目录执行：

```bash
bash supabase/prepare-function.sh
```

它会把 `sync-wire.js`、`sync-prep.js`、`core.js` 和 `vendor/ts-fsrs.umd.js` 复制到 `supabase/functions/dogverb-sync/`，并打出 `bundle.js`（这些生成文件已列入 `.gitignore`）。准备时需要能运行 `npx esbuild`。然后在本机登录 Supabase CLI，对这个已有项目部署同一个函数（不要换项目、不要连接 GitHub）：

```bash
supabase functions deploy dogverb-sync --remote=zkvscutsjspzuteogfet --use-api --yes
```

只部署这一个函数。不要用 `--prune`。CLI 3.4 用 `--remote` 指定项目，`--use-api` 在没有 Docker 时做服务端打包。准备脚本会把共享模块打进 `bundle.js`，因为 `--use-api` 只会上传静态 import 能扫到的文件；不要在入口用 `readFileSync` 或 `require` 去读这些副本。`supabase/config.toml` 里 `verify_jwt = true`，所以浏览器请求要带 anon/public 密钥；函数仍然只用设备签名和配对令牌来授权学习数据，anon 密钥不会用来打开数据库。

函数允许的浏览器来源是 `https://putao0130-design.github.io`。本地 `http://127.0.0.1` 预览会被函数拒绝，这是故意的。

## 5. 把 anon/public 密钥填进页面配置

打开 `sync-config.js`。项目 URL 已经写好。把 **Project Settings → API → Project API keys → anon / public** 的值填进 `anonKey`，替换空字符串，保存后再把这个改动单独提交（仍须 Ariel 同意后才合并）。

- 密钥仍是空的、或仍是 `PASTE_SUPABASE_ANON_PUBLIC_KEY` 这类占位符时，设置页会显示同步尚未接通，浏览器不会访问函数。
- 不要把 `service_role` 或数据库密码填进这个文件。

## 6. 本地看页面（不会改现网）

检出本分支后：

```bash
python3 -m http.server 8080
```

打开 http://127.0.0.1:8080/?v=33 ，在「我的 › 设置」里看跨设备同步卡片。在 anon 密钥填好、函数和迁移都部署之前，卡片只会提示尚未接通。不要打开现网 `?v=33`。

## 免费额度

只用这个已有的 Free 项目。如果控制台要求升级、绑卡或付费，停下来，先问 Ariel。不要开通付费计划。
