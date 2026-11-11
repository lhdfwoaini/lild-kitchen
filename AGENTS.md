# Lil D Home Kitchen 项目规则

- 更新食谱时使用 `.agents/skills/lild-kitchen-update/SKILL.md`，先看实际数据和 Git 状态。
- 本项目 marker 为 `lild-home-kitchen`。唯一发布目标为 `lhdfwoaini/lild-kitchen` 的 `main`，origin 为 `https://github.com/lhdfwoaini/lild-kitchen.git`，Pages 为 `https://lhdfwoaini.github.io/lild-kitchen/`。与 `kitchen.config.json` 核对；不自动换目标或重复建仓库。绝不修改 `lhdfwoaini/lildphotos`、`lhdfwoaini/street-corner-darkroom`、`lhdfwoaini/thesis-doctor`。
- `data/recipes.json` 是做法的唯一来源，`data/images.json` 是图片身份/来源映射。`assets/recipes.js` 是生成物，不手改。`status: ready` 表示可以展示，不表示已上线。
- 原图入口 `图片/原图/菜名/`。保留文件名与内容，后续更新不移动/覆盖/删除原图。网页只使用 `图片/展示图/` 的去元数据派生图。
- 无用户做法的新菜进入本地 drafts，不从照片编造步骤或“亲自实测”。牛扒6+4分钟、锡纸烤盘及人生记录必须保留。快食意大利面已按用户要求从网站移除，recipe-002 为 archived；保留原始记录与照片，不因扫描原图自动重新上架或复用其ID。
- 平底锅煎牛排是独立菜谱，保留先煎、醒肉、黄油迷迭香回锅的顺序；打抛饭酱汁按用户补充的大致用量记录：鱼露1勺、生抽1勺、老抽半勺、蚝油半勺，保留九层塔与“充分炒熟”。不把“勺”擅自换算为毫升或克数。未提供的时间/热量/份数不补写，“一起做”不等于份数或人生做菜序号。
- 无实拍的新封面用 `kind: ai, basis: recipe, promptId`，明确标示为生成示意图；不借用旧菜实拍，不制造空的实拍栏目。后续同菜原图导入仍走 sync。
- 更新模式可修改本地候选版；“不发布”禁止 commit/push/deploy。只扫描时不改菜谱。先备份，保留非本轮改动；不用 `git add .`，不 force push，不设置 CNAME。
- SHA256 + 路径 + 稳定ID识别增量；不重写旧菜、不重排、不重复压缩。缺图报告、保留既有派生素材；首次没有基线不得冒称已部署。
- `build → check → pack → 真实浏览器/目视检查 → release-check → export --require-qa`。测试失败不发布，静态检查不能代替布局/交互检查。
- `.local/`、`图片/原图/`、本地处理记录、已发布清单和 drafts 均忽略；仅 dist allowlist 部署。GitHub Actions 只导出已生成且验收过的静态文件，不接触原图。
- 已生成、已检查、已部署是不同状态；只有成功部署并逐文件线上核验后才能更新 `data/已发布照片清单.json`。
