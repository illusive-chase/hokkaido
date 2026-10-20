# hokkaido

把小红书上的北海道旅行帖子整理成本地数据，再做成一个可以交互浏览、对比路线的网页（「雪国手帖」）。

整个流程分三层，每层只读上一层、不回写：

```
data/notes/        ① 下载：帖子原样（正文、图片、前 5 条评论），不进 git   scripts/xhs-fetch.mjs
data/captures/     ① 补全评论：登录后浏览时用插件存下的完整评论，不进 git  extension/
atlas/             ② 整理：行程、地点、坐标、经验摘要，进 git              人工 / Claude 读帖子后编写
public/local/      ③ 生成：网页用的图片（统一 jpg）和原文，不进 git          scripts/build-site-data.mjs
src/               网页（React + Vite + MapLibre）
scripts/xhs-read.mjs  给人和 agent 读帖子用的命令行，把 ① 的原始数据转成精简的纯文本
```

## 协作方式

1. 人类把小红书链接贴进 `data/links.txt`，运行 `npm run fetch` 下载（见下文「下载流程」）。
   评论多、值得细看的帖子，再用插件补全评论（见下文「用插件补全评论」）。
2. Claude 用 `npm run -s read` 读帖子（见下文「读帖子：`xhs-read`」），**不要直接 cat `note.json` / `comments.json`**。
   在 `atlas/trips/<noteId>.json` 写这篇的行程、城际交通（`legs`）、经验和照片对应；用到的新地点加进 `atlas/places/*.json`（坐标用 OSM Nominatim 查，查不到的标 `approx: true`）。
3. 运行 `npm run data` 生成 `atlas/sources.json` 和 `public/local/`，同时校验所有引用。
4. `npm run dev` 打开网页查看。

## 读帖子：`xhs-read`

`note.json` 和 `comments.json` 里大半是头像地址、用户 ID、带签名的链接、重复的回复关系，直接读既费 context 又难看清楼层。
`scripts/xhs-read.mjs` 把正文和评论合并、去噪后按「一楼一行」打印成纯文本：插件采集评论最多的一篇（6785e650，363 条）原始 JSON 约 320KB，`--brief` 输出约 40KB。
评论的合并方式和网页（`npm run data`）相同，都走 `scripts/lib/notes.mjs`：插件采集的完整评论优先，再补上 `note.json` 里它没有的几条。

```bash
npm run -s read -- list                       # 所有帖子一览：评论采集情况、图片数、是否已整理进 atlas
npm run -s read -- 6785e6 --brief             # 读一篇（ID 写前 6 位以上即可），正文 + 全部评论
npm run -s read -- 6785e6 --no-desc --sort likes --top 30 --replies 5   # 先看最高赞的 30 楼，每楼最多 5 条回复
npm run -s read -- 6785e6 --author            # 只看作者参与的楼（作者回复往往是最可靠的补充）
npm run -s read -- 6785e6 --grep 'JR|巴士|打车'   # 只看提到交通的楼
npm run -s read -- grep '周游券|JR ?pass'      # 跨所有帖子搜索；也可以在后面列几个 ID 限定范围
```

输出格式：

```
━━ <noteId>  <标题>
作者 … · 发布 … · 赞 … 藏 … 评 … · 图 N 张
atlas trips/<id 前 8 位>….json：itinerary · 9 天 · plan 8 · legs 8 · notes 8 · tips 5     ← 已整理到什么程度
评论 插件采集 132/189（一级 50/65 未到底，17 楼回复没展开完）                         ← 评论是否完整

── 正文（1002 字）
……（话题标签已去掉，表情代码已去掉）

── 评论（显示 50 楼、82 条回复；折叠 3 条无内容评论，--all 显示）
[1] 昵称 【作者·置顶】 ♥7 广东 26-07-21｜内容 [图×1]
  [1.1] 昵称 → 被回复的人 ♥3 日本 26-07-21｜内容
  … 另有 4 条回复未显示，3 条回复没采集
```

- 楼层号 `[12]` / `[12.3]` 是该楼在合并结果里的固定位置，筛选、排序后不变，整理时可以用它引用出处。
- 默认折叠只有「码住」「好美」「@某人」这类无内容评论和 AI 助手回复；`--all` 全部显示。
- `--brief` 去掉每条的 IP 属地和日期，再省三成左右。
- 「回复没采集」是插件保存时还没展开的楼，需要的话回网页上展开后再保存一次。

读一篇的建议顺序：先 `list` 看规模；评论少的直接读全文；评论多的先 `--no-desc --sort likes --top 30` 看高赞，再 `--author` 看作者回复，最后用 `--grep` 按主题（交通、住宿、某个地名）补漏。

## 网页

```bash
npm install
npm run data     # 从 data/notes（和 data/captures）生成图片和原文，并校验 atlas
npm run dev      # http://localhost:5280
npm run build    # 类型检查 + 打包到 dist/
```

- 底图来自 OpenFreeMap（OpenStreetMap 数据），需要联网；其余数据都在本地。
- 没有 `data/` 的机器也能跑起来：`atlas/` 和 `atlas/sources.json` 都在 git 里，只是没有图片和原文。
- 地图分三个图层，在左侧面板顶部切换，各自的卡片和详情互不影响：
  - **建议路线**（默认打开）：综合全部帖子和评论，按用户的偏好排出来的逐日行程（`atlas/plans/`，见下文）。地图上实线是主线、粗虚线是跨城的一段，细虚线是备选分支；圆圈是住处，里面的数字是第几晚。左侧总览有住宿分段条、「天 × 上午/下午/傍晚」的时间轴（有备选的格子挂天气图标：❄ 暴雪·停运、☁ 阴天、◌ 没有雪、☀ 放晴、↺ 补上前几天），以及按主题分组的应变规则。点一天看细节：跨城交通、每个时段的安排和出处，以及这个时段的备选；点「换成这个」，时间轴和地图都会换成这个分支。URL 是 `#day=8&alt=8.0.1`。
  - **城际通行**：地图上只剩城市（`atlas/areas.json` 的 20 个区域）和城市之间的边，底图隐去道路、铁路和地名。边的粗细是经过的帖子数；实线是有帖子写了怎么走，虚线是只在行程里经过。**点一条边**，左侧列出各帖子在这两座城市之间的走法（交通方式、时间、价格）和注意事项，以及「经过但没写怎么走」的帖子；点一个城市，列出它连着哪些城市。左侧「帖子」只显示路线链、交通方式和交通建议，不含景点和美食；「路段」按经过的帖子数列出所有边。可以按交通方式（JR、巴士、包车……）筛选。
  - **城市内**：景点、饮食、交通（车站、机场）、住宿四类元素，在地图上方分别开关，默认只开景点和交通。低缩放时按区域聚合，点聚合的圆放大；**点单个地点只打开详情，不移动、不缩放地图**。从左侧列表点开的地点不在视野里时，地图只平移过去、不改变缩放。帖子（类型、经过的区域、天数筛选，逐日行程、地点经验、原文评论）和地点（区域、主题筛选，推荐、注意事项、照片、「常和它排在同一天」）都在这一层。
- 城市内图层最多选 3 条行程并排**对比**：逐日对照、区域覆盖天数、共同和独有的景点，地图上用三种颜色区分。
- 视图状态写在 URL 的 hash 里（`#layer=transit&edge=hakodate~toya`、`#trip=…`、`#place=…`、`#cmp=a,b,c`），可以直接分享或收藏某个视图。
- 浅色「雪地」和深色「蓝调时刻」两套主题，默认跟随系统。

## 整理数据 `atlas/`

### `atlas/areas.json`

`regions`（5 个大区，用于筛选）、`areas`（20 个区域，地点归属到区域，总览地图按区域聚合）、`themes`（地点主题，用于筛选）。

### `atlas/places/*.json`

按大区分文件，每个文件是地点数组：

| 字段 | 说明 |
|---|---|
| `id` | 全局唯一的英文短名，例如 `tenguyama` |
| `name` / `ja` | 中文名 / 日文名（日文名用于搜索和 Google 地图） |
| `kind` | `town` 城镇、`sight` 景点、`station` 车站、`airport` 机场、`food` 餐饮、`stay` 住宿。餐饮和住宿在地图上默认隐藏 |
| `area` | 所属区域，`areas.json` 里的 id |
| `at` | `[经度, 纬度]` |
| `themes` | 主题，`areas.json` 里 `themes` 的值 |
| `blurb` | 一句话介绍（可选） |
| `approx` | 坐标只是大致位置（可选） |
| `offmap` | 不在北海道，地图上不画（例如东京） |

### `atlas/trips/<noteId>.json`

一篇帖子一个文件，文件名就是笔记 ID。

| 字段 | 说明 |
|---|---|
| `kind` | `itinerary` 多日行程、`daytrip` 一日游、`pilgrimage` 巡礼、`guide` 经验、`review` 点评、`question` 提问 |
| `summary` | 一两句话概括这篇的思路，卡片上显示 |
| `days` / `when` | 天数 / 出行时间（原帖写了才填） |
| `bases` | 住宿的区域，按顺序 |
| `in` / `out` | 进出的机场或车站 |
| `style` | 关键词，例如「函进札出」「solo」 |
| `budget` / `partial` / `commercial` | 花费 / 原帖不完整的说明 / 是否商业推广 |
| `plan[]` | `{ day, label?, title, stops[], stay?, move? }`：每天的标题、按顺序经过的地点、住宿、交通方式。地图上的路线由它画出 |
| `photos[]` | `{ place, img[] }`：第几张图（从 1 开始）拍的是哪个地点 |
| `notes[]` | `{ place, tone, text, from }`：针对某个地点的经验。`tone` 是 `good` 推荐 / `warn` 注意 / `meh` 觉得一般 / `info` 信息；`from` 是 `post` 正文 / `comment` 评论区 / `editor` 整理者注 |
| `tips[]` | `{ topic, text, from }`：不针对具体地点的建议，`topic` 如「交通」「装备」「住宿」 |
| `ratings[]` | `{ place, score, label }`：点评帖的打分（`score` 0–5） |
| `legs[]` | 城际交通，城际通行图层的边由它和 `plan` 一起算出，见下表 |

`legs[]` 的每一项是这篇帖子在两个区域之间的一种走法，或者只是对这段路的经验：

| 字段 | 说明 |
|---|---|
| `between` | `[出发区域, 到达区域]`，`areas.json` 里的 id，按行进方向。两个必须不同；同一区域内的交通写进 `notes` / `tips` |
| `day` | 第几天（可选，对应 `plan` 的 `day`） |
| `mode` | 交通方式数组：`jr`、`bus` 巴士、`shuttle` 酒店接驳车、`car` 自驾、`charter` 包车/拼车、`tour` 一日游团、`flight` 飞机、`taxi` 打车 |
| `how` | 怎么走：车次、换乘、在哪上车、行李怎么处理 |
| `time` / `cost` | 耗时 / 花费，保留原文的写法（「约 2 小时」「往返约 130 元」） |
| `from` | 方案出自哪里，默认 `post`；评论区给的方案写 `comment` |
| `notes[]` | `{ tone, text, from }`：这一段的注意事项和评价，`tone` 同上 |

`how` 和 `notes` 至少要有一个。帖子里只说「第 5 天去了洞爷湖」但没写怎么去的，不用写 `legs`：行程经过的路段会从 `plan` 自动算出来，在地图上画成虚线。
提问帖、经验帖没有自己的行程，评论区里别人给的走法也写进 `legs`（`from: "comment"`）。

整理原则：经验尽量保留作者原话的意思和具体数字（时间、价格、班次），不加评价；评论区的内容要标 `from: "comment"`；广告帖标 `commercial`。

### `atlas/plans/<id>.json`

建议路线：不是哪一篇帖子的行程，而是把所有帖子、评论里的经验综合起来，按用户回答的偏好（天数、月份、进出机场、换几次酒店、对每个地方感不感兴趣）排出来的。网友意见冲突的地方（天狗山蓝调还是早上去、洞爷湖住不住、全程住札幌还是换酒店），按用户看重的那一方取舍，在 `prefs` 里写明。

| 字段 | 说明 |
|---|---|
| `title` / `summary` / `when` | 标题、一段话概括、出行月份 |
| `in` / `out` | 进出的机场（地点 id） |
| `prefs[]` | `{ q, a }`：用户回答过的偏好，总览里原样显示 |
| `rules[]` | `{ title, kind, items[] }`：不针对某一天的应变规则（暴雪、阴天、行李、车票、装备），`items` 是 `{ text, refs? }` |
| `days[]` | 每天一项，见下表 |

`days[]` 的每一项：

| 字段 | 说明 |
|---|---|
| `day` / `title` / `short` | 第几天（连续）、标题、时间轴上的短名（一般是当晚住的城市） |
| `stay` / `stayNote` / `stayRefs` | 当晚住的地点、为什么住这里、出处。最后一天不写 `stay` |
| `move` | 跨城那天的交通：`{ between, mode[], time?, how, refs? }`，字段含义同 `legs` |
| `slots[]` | `{ slot, time?, short, title, stops[], via?, text, refs?, alts? }`：`slot` 是 `am` / `pm` / `eve`，同一时段可以有几项 |
| `alts[]` | 影响整天的备选，结构同下 |

备选分支（`slots[].alts[]` 和 `days[].alts[]`）：`{ kind, if, short, title, from?, stops[], text, refs? }`。`kind` 是 `snow` 暴雪·停运 / `cloud` 阴天 / `nosnow` 没有雪 / `sunny` 放晴 / `makeup` 补上前几天落下的；`if` 写触发条件；`from` 是分支在地图上从哪个地点接出去，不写就从这个时段之前最后经过的地点接出去。

`refs` 一律写帖子 ID 的前缀（前 8 位即可），网页上显示成作者名，点开跳到那篇帖子。`npm run data` / `npm run check` 会校验地点、区域、交通方式、分支类型和每个出处都能对上唯一一篇帖子。

### `atlas/sources.json`

由 `npm run data` 从 `data/notes` 生成的帖子元信息快照（标题、作者、发布时间、互动数、图片尺寸），不要手改。

## 快速开始（下载）

```bash
# 1. 把链接贴进 data/links.txt，一行一条。可以直接粘贴 App 里「复制链接」得到的整段分享文案
# 2. 先预览本次会抓哪些，不发任何请求
node scripts/xhs-fetch.mjs --dry-run
# 3. 正式抓取。已经下载过的会自动跳过，每两篇之间随机等 20–40 秒
node scripts/xhs-fetch.mjs
```

需要 Node ≥ 18，不依赖任何第三方包，也不需要登录或浏览器。

## 下载流程

### 前提条件

两条都要满足，缺一条就拿不到数据：

1. **链接必须带 `xsec_token`**。App 分享出来的 `xhslink.cn` 短链和网页版地址栏里的链接都带这个参数。只有笔记 ID 的裸链接（例如 `xiaohongshu.com/explore/<id>`）会被跳到 404，提示「当前笔记暂时无法浏览」（`error_code=300031`）。
2. **要用手机浏览器的 UA 请求**。用桌面 UA 会被 302 到登录页。脚本里固定用 iPhone Safari 的 UA。

### 单篇帖子怎么抓

```
links.txt 中的一行（可能是整段分享文案）
  │  取出第一个 http(s) 链接
  ▼
xhslink.cn/o/<code>  或  xiaohongshu.com/explore/<id>?xsec_token=…
  │  GET，跟随重定向（短链只能用 GET 解析，HEAD 会返回 404）
  ▼
www.xiaohongshu.com/discovery/item/<noteId>?xsec_token=…&xsec_source=…
  │  返回服务端渲染的 H5 页面，约 130KB
  ▼
页面里的 window.__INITIAL_STATE__（JS 对象字面量，把裸 undefined 换成 null 就是合法 JSON）
  │  取 .noteData.data = { noteData, commentData, widgets }
  ├──▶ raw.json   原样保存
  ├──▶ note.json  字段归一化后保存
  └──▶ images/    按每张图的 fileId 拼出 https://sns-img-qc.xhscdn.com/<fileId>，下载无水印原图
```

- **图片**：SSR 数据里的 `imageList[].url` 是 1080 宽、带「小红书」水印、带时间签名（会过期）的地址，**不要用**。用 `fileId` 拼出来的地址没有签名、没有水印，也不需要 Cookie 或 Referer，返回原图（样本最大一张 3072×4096）。原图格式不固定，样本 15 张里有 1 张是 PNG，所以扩展名按响应的 `Content-Type` 决定。
- **评论**：未登录时只能拿到 SSR 自带的前 5 条一级评论，每条最多附 1 条回复。翻页接口需要签名，未登录会被拒绝。需要完整评论时用插件补（见「用插件补全评论」）。
- **视频 / Live 图**：脚本会尝试下载 `video.media.stream.h264[0].masterUrl` 和 Live 图的视频。这部分**还没有用真实样本验证过**，所以下载失败不会让整篇失败，只记录到 `note.json` 的 `downloadErrors`。

### 批量下载与防风控

批量下载时脚本按下面的规则执行（规则集中写在 `scripts/xhs-fetch.mjs` 开头的几个常量里）：

| 规则 | 做法 |
|---|---|
| 间隔 | 每两次**笔记页请求**之间随机等待 **20–40 秒**（均匀分布）。同一篇内的图片来自 CDN，按顺序一张张下载，中间不额外等待 |
| 串行 | 一次只处理一篇，不并发 |
| 跳过已下载 | `data/notes/<noteId>/note.json` 已经存在的直接跳过，不发请求。短链要请求一次才知道笔记 ID，所以用 `data/index.json` 记录「链接 → 笔记 ID」，下次运行时据此跳过 |
| 去重 | 同一批里多条链接指向同一篇，只下载一次 |
| 遇到风控立即停止 | 被转到验证码页（`/website-login/captcha`）或登录页，或者返回 HTTP 403 / 429 / 461 / 471，就停止整批，退出码 2 |
| 连续失败停止 | 连续 3 篇失败（比如风控还没被识别出来时）也停止整批，退出码 2 |
| 失败可重来 | 失败和没执行到的链接在 `index.json` 里记为 `failed` 或者没有记录，下次运行会自动重试 |
| 不留半份数据 | 每篇先写到 `data/notes/.tmp-<noteId>/`，所有图片下载成功后才改名为正式目录。单张图片失败会再重试 2 次，仍然失败就整篇算失败 |

> 说明：验证码页是上游节点用无头浏览器时实际遇到的；上面那几个 HTTP 状态码是常见的风控返回码，属于预防性判断，还没有实际触发过。用普通 HTTP 连续请求同一篇 4 次时没有被风控。批量请求会在什么频率下触发风控，目前还不知道，所以第一次正式批量下载时建议先用 `--limit` 跑几篇看看。

一篇帖子大约需要「20–40 秒间隔 + 几秒下载图片」，10 篇大约 6 分钟。

### 命令行参数

```
node scripts/xhs-fetch.mjs [链接或分享文案 …] [选项]
```

| 参数 | 作用 |
|---|---|
| （不带链接） | 读 `data/links.txt` |
| `'<链接>' …` | 只处理命令行给出的链接，仍然写入 `data/`，同样遵守间隔和跳过规则 |
| `--dry-run` | 只列出本次会抓的链接，不发任何请求 |
| `--limit <n>` | 本次最多处理 n 条链接 |
| `--force` | 已下载过的也重新抓取（刷新互动数和评论）。会覆盖原来的目录 |
| `--print` | 只抓第一条链接，把 `note.json` 打印到 stdout，不写盘、不下载图片。用来调试 |
| `--web` | 图片改存 1440 宽的 WebP（约 300KB/张）。默认存原图 |
| `--data <dir>` | 数据目录，默认 `data` |

退出码：`0` 全部成功；`1` 有失败但跑完了；`2` 因风控或连续失败中途停止。

## 用插件补全评论

`scripts/xhs-fetch.mjs` 未登录，每篇只能拿到前 5 条一级评论、每条最多 1 条回复（38 篇合计约 11%）。`extension/` 是一个 Chrome 插件：你登录小红书**网页版**，自己往下翻评论、自己点「展开 N 条回复」，看完点一下「保存」，插件把页面上**已经加载出来**的笔记和评论存进 `data/captures/`。

插件不发任何网络请求，不模拟点击或滚动，不改页面 DOM，也没有常驻在页面里的脚本。只有点「读取」或「保存」的那一刻，才往页面里注入一个只读函数（`extension/snapshot.js`），读一次页面内存里的数据就结束。所以小红书看到的请求，和你不装插件、自己浏览时完全一样。插件不做自动滚动、自动展开：网页版对搜索框等位置的脚本点击（`isTrusted=false`）有专门的识别。

### 安装

1. Chrome（≥ 116）打开 `chrome://extensions`，打开右上角的「开发者模式」。
2. 点「加载已解压的扩展程序」，选择仓库里的 `extension/` 目录。
3. 把工具栏上的插件图标固定出来，点它会在右侧打开侧边栏。
4. 第一次使用时，在侧边栏点「选择…」，选中仓库里的 `data/` 目录（选仓库根目录也可以，会自动进入 `data/`），然后允许读写。浏览器重启后，第一次点「读取」或「保存」时会再确认一次权限。

改了 `extension/` 里的代码之后，到 `chrome://extensions` 点插件卡片上的刷新按钮，再重新打开侧边栏。

### 使用

1. 用**专门的小号**登录 `www.xiaohongshu.com`。不要在 Playwright、Puppeteer，或者带远程调试端口启动的 Chrome 里用。
2. 打开一篇笔记。从首页、搜索结果点进去的浮层，或者直接打开 `/explore/<笔记ID>` 都可以。
3. 往下翻评论区，直到看到「- THE END -」；有用的楼层点「展开 N 条回复」。
4. 在侧边栏点「读取」，查看完整度：
   - **一级评论**：已加载数 / 总数，显示「✓ 已到底」就说明翻完了。总数取自本地 `note.json`，网页版的数据里没有这一项，本地没有这篇时显示「?」。
   - **回复**：已加载数 / 总数，以及还有几楼没有展开完。
   - **页面校验**：拿插件读到的评论 ID，和页面上的 `comment-<id>` 元素逐条比对。
   - **上次保存**：这篇之前保存过的话，显示合并后会多出几条。
   - **本地正文**：`data/notes/` 里还没有这篇时，可以点「追加到 links.txt」，之后运行 `npm run fetch` 下载正文和原图。
5. 点「保存」。如果同一次浏览里还打开过别的笔记，并且页面内存里还留着它们，这些笔记会列在下面，也可以勾选后一起保存。默认只勾选当前这篇，以及本地已经有的笔记（`data/notes/` 里下载过的，或者以前保存过的），这样随手看过的无关笔记不会被存进来。
6. 一篇没翻完也可以先存。下次接着翻、再保存，新旧评论会按 ID 合并，之前存过的不会丢。
7. 运行 `npm run data`，网页「原文与评论」里就会显示完整的评论。

使用节奏：插件本身不会增加风控风险，但浏览行为本身是有风险的。一篇看完歇一会儿再开下一篇；不要一次开几十个标签页；评论少的帖子（≤ 30 条）未登录脚本基本已经拿全了，不必再翻；一旦出现滑块验证码或者跳到登录页，当天就停下来。

### 插件怎么读数据

```
首选：页面内存里的 Pinia store（结构化的原始字段，时间、点赞数都是精确值）
  #app.__vue_app__.config.globalProperties.$pinia._s.get('note')
    .currentNoteId
    .noteDetailMap[noteId] = { note, comments: { list[], cursor, hasMore, firstRequestFinish } }
       list[i] = { id, content, createTime, ipLocation, likeCount, userInfo, showTags, targetComment,
                   pictures[], subComments[], subCommentCount, hasMore }

兜底：解析评论区 DOM（store 读不到，或者 store 里没有当前这篇时才用）
  .parent-comment > .comment-item#comment-<id>，回复是 .comment-item-sub
  时间只有「3 天前」「10-05」这样的文字，点赞是「1.2万」这样的缩写，拿不到回复关系。只能读当前打开的这一篇
```

用 DOM 兜底时，侧边栏会标出「DOM 兜底」，并且显示诊断信息（页面上有没有 Vue 应用、有哪些 store）。**线上页面的结构还没有在登录状态下实际验证过**：如果 store 读不到，或者字段对不上，把诊断信息和一份 `snapshots/*.json` 发回来，按实际情况修改 `extension/snapshot.js` 和 `extension/lib.js`，然后运行 `npm run captures`，用已经存下来的原始快照重新生成 `comments.json`。

### `data/captures/`

不放进 `data/notes/<noteId>/`，原因是 `xhs-fetch.mjs --force` 会把那个目录整个删掉再重建。

```
data/captures/<noteId>/
├── snapshots/
│   └── 2026-10-20T08-31-05Z.json   # 每点一次保存，就把页面里的原始数据原样存一份，只新增不修改
└── comments.json                   # 历次快照按评论 ID 合并、归一化之后的结果（下游读这个文件）
```

`comments.json` 的字段：

| 字段 | 说明 |
|---|---|
| `schema` / `noteId` / `source` | 格式版本 `1`、笔记 ID、固定为 `"pc-logged-in"` |
| `note` | 保存时的笔记元数据：`title`、`desc`、`publishTime`、`author`、`tags`、`counts`、`imageCount`，以及带 `xsec_token` 的 `url`。**不包含图片地址**，原图继续用 `npm run fetch` 下载 |
| `total` / `topLevelTotal` / `hasMore` / `items[]` | 结构和 `note.json` 里的 `comments` 相同。`items[]` 是按 ID 合并后的全部评论 |
| `loaded` | `{ topLevel, replies, all }`：实际存下的条数 |
| `complete` | `{ topLevel, replies, pendingThreads }`：一级评论是否翻到底、回复是否全部展开、还有几楼没展开完 |
| `snapshots[]` | 合并了哪几次快照：`{ file, capturedAt, mode, topLevel, replies }` |
| `updatedAt` | 最近一次保存的时间 |

`items[]` 在 `note.json` 评论字段的基础上，还多了这几个字段：

| 字段 | 说明 |
|---|---|
| `isAuthor` / `isPinned` / `isBot` | 是否笔记作者、是否置顶、是否 AI 助手（来自 `showTags`） |
| `replyTo` | 回复里「回复 某某：」指向的评论：`{ id, userId, nickname }`，没有时为 `null` |
| `subHasMore` | 一级评论才有：回复是否还没展开完 |
| `source` | `pc-store` 或 `pc-dom`。合并时 DOM 兜底读到的数据不会覆盖 store 读到的 |
| `timeText` | 仅 `pc-dom` 才有：页面上显示的时间文字，这时 `time` 为 `null` |

同一条评论保留最新一次看到的版本（点赞数会变化）。以前存过、这次页面上没加载出来的评论会继续保留。

`npm run data` 生成网页数据时，如果存在 `comments.json`，就优先用它，再补上 `note.json` 里有而它没有的评论（两边的评论 ID 是同一套）。

## 数据结构

`data/` 整个目录已经写进 `.gitignore`，不进 git。里面是网友的作品，只供个人整理用，不要公开发布。

```
data/
├── links.txt                 # 人工维护：要下载的链接，一行一条
├── index.json                # 脚本维护：链接 → 抓取结果
├── captures/                 # 插件写入的完整评论，见「用插件补全评论」
└── notes/
    └── <noteId>/             # 一篇帖子一个目录，noteId 是 24 位十六进制字符串
        ├── note.json         # 归一化后的帖子数据（下游读这个）
        ├── raw.json          # SSR 原始数据，原样保存
        ├── images/
        │   ├── 01.jpg        # 按帖子里的顺序编号，从 01 开始；扩展名取决于实际格式
        │   ├── 02.png
        │   └── 03.live.mp4   # 只有 Live 图才有（未验证）
        └── video.mp4         # 只有视频笔记才有（未验证）
```

一篇图文帖子的原图大约 10MB（样本 15 张共 10.9MB，单张 0.1–2.2MB）。

### `links.txt`

一行一条。每行取第一个 `http(s)://` 链接，所以直接粘贴 App 的整段分享文案也可以。空行和 `#` 开头的行会被忽略，没有链接的行会打印警告后跳过。

```
# 北海道
62 北海道3日游行程分享（懒人版💤） http://xhslink.cn/o/2SvGy1eZ1QE 复制后打开【小红书】查看笔记！
https://www.xiaohongshu.com/explore/6ab24d45000000003602b4dd?xsec_token=…&xsec_source=pc_share
```

### `index.json`

键是 `links.txt` 里提取出来的链接，值是最近一次处理的结果。多条链接可以指向同一个 `noteId`。

```json
{
  "http://xhslink.cn/o/2SvGy1eZ1QE": {
    "noteId": "6ab24d45000000003602b4dd",
    "status": "ok",
    "title": "北海道3日游行程分享（懒人版💤）",
    "fetchedAt": "2026-10-19T12:38:54.126Z"
  },
  "https://www.xiaohongshu.com/discovery/item/…": {
    "status": "failed",
    "error": "被重定向到 /404（300031 当前笔记暂时无法浏览）；…",
    "fetchedAt": "…"
  }
}
```

### `note.json`

所有时间都是 ISO 8601 UTC 字符串，所有计数都是整数（「1.2万」「10万+」这类写法会转成整数，`10万+` 记为 100000）。拿不到的值是 `null`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `schema` | number | 本文件的格式版本，目前是 `1`。字段有不兼容的改动时加一 |
| `noteId` | string | 笔记 ID |
| `type` | string | `normal` 为图文，`video` 为视频 |
| `url` | string | 规范化的可访问链接：`/discovery/item/<id>?xsec_token=…&xsec_source=…` |
| `title` | string | 标题 |
| `desc` | string | 正文全文，原样保留换行、emoji 和 `#话题[话题]#` 标记 |
| `publishTime` / `lastUpdateTime` | string | 发布时间 / 最后编辑时间 |
| `author` | object | `{ id, nickname, avatar }`，`avatar` 是头像的远程地址 |
| `tags` | string[] | 话题标签名（结构化字段，和正文里的 `#…#` 一致） |
| `counts` | object | `{ liked, collected, comment, share }`：点赞、收藏、评论、分享数，是抓取时的值。拿不到浏览量 |
| `images[]` | object[] | 见下表，顺序与帖子一致 |
| `video` | object \| null | 视频笔记才有：`{ url, local }`。`url` 是远程地址，`local` 是 `"video.mp4"` 或 `null`（未验证） |
| `comments` | object | `{ total, topLevelTotal, hasMore, items[] }`：`total` 是全部评论数（含回复），`topLevelTotal` 是一级评论数，`items` 是实际拿到的评论 |
| `source` | object | `{ input, finalUrl, fetchedAt, loggedIn }`：`input` 是 `links.txt` 里的原始链接，`finalUrl` 是重定向后的地址，`loggedIn` 恒为 `false` |
| `downloadErrors` | string[] | 下载失败的非必需文件（视频、Live 图视频）。正常情况下是空数组 |

`images[]` 的每一项：

| 字段 | 说明 |
|---|---|
| `fileId` | 图片在小红书 CDN 上的 ID，例如 `notes_pre_post/1040g3k8…`，用来拼出下面的地址 |
| `width` / `height` | SSR 数据里写的展示尺寸。**原图可能更大**（样本第 1 张写的是 1440×1920，原图是 3072×4096），需要真实尺寸时读本地文件 |
| `original` | 无水印原图的远程地址 |
| `web` | 1440 宽 WebP 的远程地址 |
| `local` | 本地文件，相对于帖子目录，例如 `images/01.jpg` |
| `livePhoto` | 是否为 Live 图 |
| `livePhotoVideo` / `livePhotoLocal` | Live 图视频的远程地址 / 本地文件（未验证） |

`comments.items[]` 的每一项（`subComments` 结构相同，但不会再往下嵌套）：

| 字段 | 说明 |
|---|---|
| `id` | 评论 ID |
| `content` | 评论内容。表情是 `[笑哭R]` 这类文字代码 |
| `time` | 评论时间 |
| `ipLocation` | IP 属地，例如「四川」「日本」 |
| `likeCount` | 点赞数（取自 `likeViewCount`；未登录时原始数据里的 `likeCount` 总是 0） |
| `user` | `{ id, nickname, avatar }` |
| `pictures` | 评论配图的远程地址，**不下载到本地**（未验证） |
| `subCommentCount` | 这条评论下的回复总数 |
| `subComments` | 实际拿到的回复，最多 1 条 |

### `raw.json`

页面 `window.__INITIAL_STATE__.noteData.data` 原样保存，包含 `noteData`（帖子）、`commentData`（评论）、`widgets` 三部分。保存它是为了以后需要更多字段时，可以从本地重新生成 `note.json`，不必再请求一次。里面的图片 `url` 是带签名的临时地址，过一段时间就会失效。

## 风险与未验证项

- **只用一篇图文帖子验证过**：样本是 `6ab24d45000000003602b4dd`，2026-10-19 测试。视频笔记、Live 图、带地点的笔记、带图评论都还没有真实样本。
- **批量请求的风控阈值未知**：上面的 20–40 秒间隔、遇到风控就停，都是保守的预防措施。
- **`xsec_token` 能用多久未知**：样本的 token 当天可以反复使用。链接放久了再抓，可能会进 404。
- **依赖小红书 H5 的当前实现**：`__INITIAL_STATE__` 的结构、手机 UA 能访问、用 fileId 拼原图地址，这几点在平台改版后都可能失效。相关逻辑集中在 `fetchPage`、`extractState`、`normalize` 三个函数里。
- **插件还没有在登录状态的线上页面上跑过**：store 的读取路径、PC 版评论的字段名，都是根据 2026-10-19 前端代码的静态分析得出的，目前只用模拟页面测试过。第一次使用时，请先拿评论多的 `6730b59b00000000190167ec` 试一下（807 条，本地 `note.json` 里有前 5 条可以对照）。另外有几件事还不确定：一级评论每页加载多少条、每次「展开」加载多少条回复、`noteDetailMap` 会不会保留同一次浏览里看过的其他笔记、目录授权在浏览器重启后会不会失效。
