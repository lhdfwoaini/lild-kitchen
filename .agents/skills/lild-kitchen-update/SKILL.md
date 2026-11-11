---
name: lild-kitchen-update
description: "维护 Lil D Home Kitchen 个人食谱：扫描原图、根据用户真实做法增量更新菜谱、生成展示图、预览验收，并在明确要求发布时更新独立 GitHub Pages。用于新增菜品、修改做法或调用 $lild-kitchen-update；不适用于摄影网站。"
---

# Lil D Kitchen 更新

仅操作本技能所在项目根目录（本文件向上三层，当前为 `J:\codex帮我从0到1搞钱\食谱`）。先读根目录 `AGENTS.md`、`kitchen.config.json`、`README.md` 和 `docs/维护规范.md`，核实 Git 状态与 origin。项目 marker 必须为 `lild-home-kitchen`；禁止修改 `lhdfwoaini/lildphotos`、`lhdfwoaini/street-corner-darkroom`、`lhdfwoaini/thesis-doctor`。摄影技能是流程来源，不是本技能的调用目标。

固定目标：公开仓库 `lhdfwoaini/lild-kitchen`，origin `https://github.com/lhdfwoaini/lild-kitchen.git`，分支 `main`，发布方式 GitHub Pages Actions（`.github/workflows/pages.yml`），站点 `https://lhdfwoaini.github.io/lild-kitchen/`。已于2026-11-11独立创建。以后仅更新此仓库，不再创建新仓库；配置/origin不一致时先核实，不覆盖远程或改摄影目标。

## 两种命令

- `$lild-kitchen-update 扫描新增照片并预览变更，不发布`：完成扫描、必要的本地数据/图片更新、构建、检查和预览；不暂存、不提交、不推送、不更新已发布清单。修改前先 backup，最终明确列出本地修改。只有扫描需求而未要求更新时，只 scan 和打开当前预览。
- `$lild-kitchen-update 更新并发布食谱网站`：执行同样本地流程，再核实独立食谱目标，审查本轮 diff，执行发布与线上核验。目标缺失时完成本地部分，集中报告缺项；不猜仓库、不新建其他网站。

预览模式与摄影技能的“纯干运行”有所不同：食谱预览允许可恢复的本地候选变更，但绝不推进线上基线。

## 标准流程

1. **核实和备份**：读取上述文件、`data/recipes.json`、`data/images.json`、本地处理记录与已发布清单（若存在）。保留不相关未提交修改；不把未知更改顺带提交。运行 `pwsh -NoProfile -File scripts/kitchen.ps1 backup`。
2. **扫描**：运行 `pwsh -NoProfile -File scripts/kitchen.ps1 scan`。读取 `.local/reports/scan.json`；按稳定ID、路径、SHA256 判断，不能仅用时间戳。原图缺失只报告并保留正常展示图；坏图先跳过/报告，不能当成无变化。歧义映射只问必要问题。
3. **匹配与文字**：`sync` 为明确已有菜名文件夹中的新图增加补充实拍、处理同目录唯一改名、避免同菜完全相同副本重复展示；未知菜名只建 `data/drafts.json`。有用户实际做法后，由 Codex 用补丁更新 `recipes.json` 和 `images.json`，不要让用户手改数据。只修改本次菜谱，稳定ID和旧顺序不变。先检查是否已经录入，避免重复请求创建同一道菜。新菜用下一个未使用编号；补足菜名、食材、实际步骤、个人记录、有效封面对应后才置 `status: ready`，否则保持 draft。允许暂无实拍的 `photos: []`；不要挪用旧菜照片。时间/温度/克数/比例/热量不猜；确认份数有提供才记，“一起做”不等于份数或第几次做菜。扫描不等于发布授权。
4. **图片**：读 `docs/图片来源与提示词.md`，先检查并实际查看对应原图。用户要求新封面或源图改变时，优先使用 imagegen，一张通过后再生成下一张。有实拍：以同菜实拍为依据，标 `kind: ai` 并登记 references/promptId，显示“AI 重绘展示图”。无实拍且允许生成：只按用户实际菜谱制作，标 `kind: ai, basis: recipe, promptId`，不填虚假的 references，显示“AI 生成示意图 / 非实拍”。不得往提示词补写食材。源图/菜品不变时不重复生成。工具不可用且有实拍时直接用实拍；无实拍则使用明确标注待补图片的风格一致占位并补齐其类型支持，不虚构文件路径，不阻塞文字记录。AI 母版放 `.local/generated/`，网页派生图由脚本生成。不要覆盖原图。
5. **生成/预览**：依次运行 `sync`（若有新图）、`build`、`check`、`pack`：命令格式为 `pwsh -NoProfile -File scripts/kitchen.ps1 命令`。非零退出停止后续发布。`build` 只处理指纹变化的图，输出 640/1200 WebP、清理元数据并导出 `assets/recipes.js`。一次生成来源不等于部署。打开 `一键预览.cmd` 或启动 `node scripts/preview.cjs`；服务仅暴露 dist。
6. **验收**：运行 `node scripts/validate-browser.cjs`，实际检查 1440/768/390 首页与全部菜谱详情、导航/前后退/刷新、速查、弹窗关闭/Esc/焦点、来源标注和网络错误。查看 `.local/qa/` 中手机、桌面与本次受影响详情截图。浏览器受限按正常权限流程重试，不能关闭 Chromium 安全沙箱。未完成真实验收则不发布。脚本改动时再运行 `test-incremental.py`（使用 kitchen.ps1 中探测的 Python）。通过且目视确认后更新 `data/release-check.json` 的 siteFingerprint、passed、visualReview 和 evidence；不得直接写通过以绕过检查。对当前文件运行 `node scripts/export.mjs --require-qa`。
7. **仅发布模式**：读 `docs/维护规范.md` 的发布段；所有目标和权限齐全且本轮明确允许上线才运行 `publish.py --execute`。脚本支持已有 CLI 登录或系统 Git 凭据管理器登录，核实账号必须为 `lhdfwoaini`；不读取或输出凭据文件。审查 diff 后，将本轮具体文件相对路径数组写入 `.local/release-files.json`，不要填目录或混入既有不相关修改。脚本只暂存这些文件并再次检查白名单。无输入/公开文件变化时不生成图、不空提交、不触发无意义部署；之前已推送而未核验则 `--verify-only`，不要重新提交。发布脚本检查 origin/main、当前 QA、Pages workflow，正常提交推送，等待工作流并逐文件核对公网 SHA256，成功后才写 `data/已发布照片清单.json`。再运行 `node scripts/validate-browser.cjs --online`，真实访问公网全部菜谱并查看 `.local/qa-online/` 截图；不能把只推送成功说成上线完成。失败保留上次成功清单和本次待核验状态，不自动回滚/force push。需要回退时从已有 commit 正常 revert 并再次验收。

## 收尾

用简短中文报告：本轮新增/修改/草稿/缺失数量、实际更新的菜品、图片来源、验证结果、预览入口。只有核验成功才给正式上线地址和 commit；否则说明准确阻塞。原图、母版、归档和运维证据从不进入公开仓库。完整来源清单保存在本地，技能/脚本/菜谱数据及必要展示图纳入食谱 Git。
