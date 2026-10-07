# 数据来源与许可

## 来源

- 站点：洛克王国：世界 Wiki（非官方资料站）
- 地址：https://wiki.biligame.com/nrc/
- 站点声明：https://wiki.biligame.com/nrc/Project:%E7%AB%99%E7%82%B9%E5%A3%B0%E6%98%8E
- 抓取方式：MediaWiki API（`api.php?action=parse&prop=wikitext`），非 HTML 爬取
- 抓取时间：2026-09-25
- 数据版本：`s4-2026-09-24`（wiki 自报 `current_version`）

## 抓取的数据模块

| 本地文件 | 上游页面 | 内容 |
|---|---|---|
| `Catalog.lua` | `Module:Pets/data/Catalog` | 625 只精灵：蛋组、性别比、蛋重阈值、种族值、属性、图鉴号等 |
| `Config.lua` | `Module:Pets/data/Config` | 数据版本、图鉴数量、天赋池等配置 |
| `Index.lua` | `Module:Pets/data/Index` | 精灵索引 |

## 许可与署名要求

站点声明（原文摘要）：

- 「除另有标注外，本站原创文字及有权授权的资料整理成果，采用知识共享『署名—相同方式共享 4.0 国际』协议（CC BY-SA 4.0）发布。」
- 「转载、引用或使用本站的页面内容及整理数据，须注明本站名称，并附上原页面链接。对受上述协议保护的内容，还须保留适用的作者信息、附上许可链接，并说明是否作过修改；改编成果须以相同协议发布。」
- 「本站展示的游戏角色、立绘、图标、截图、音视频、标识等素材……不是自由版权内容，不适用本站的 CC BY-SA 4.0 协议。」其权利归魔方工作室、腾讯游戏及相应权利人所有。

因此：

1. 精灵数据（蛋组、性别比、蛋重阈值等整理数据）可以使用，但须署名站点 + 附原页面链接 + 以 CC BY-SA 4.0 相同协议发布 + 说明修改过。
2. 立绘、图标、截图等游戏素材不得打包分发，本项目不使用这些图片资源。
3. 站点为个人项目，抓取时使用自定义 User-Agent、请求间隔限速，仅抓取必需的少量页面。

## 抓取时的 robots.txt 情况（2026-09-25）

`https://wiki.biligame.com/robots.txt` 允许正文页与 `api.php`；禁止抓取 `index.php?`、`load.php?`、`File:`、`User:`、`MediaWiki:`、`模板:`、`特殊:`、`diff=`、`oldid=` 等路径。本流程只使用 `api.php`。
