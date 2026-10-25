# ICPC Resolver Web 代码审计报告

- **审计日期**：2026-10-23
- **审计对象**：`/Users/albert_li/data/Code/Resolver`，约 9,075 行自有 JS / HTML / CSS / 测试代码（不含 `node_modules/` 与 `reference/icpctools/` 的上游 Java 参考源码）
- **审计方式**：只读静态审查 + 运行时复现 + 覆盖率测量 + 依赖审计 + 性能基准；按服务端、引擎、配置中心、播放/渲染四个域并行审查，关键结论由 Lead 独立复现
- **代码变更**：**无**。本报告仅新增文档，未修改任何项目代码、配置或数据
- **基线**：Node v24.18.0，`npm test` **49/49 通过**；行覆盖率 **92.27%**、分支覆盖率 **81.60%**（仅统计被测试导入的模块）；`npm audit`（JSON）显示 **0 个已知漏洞**，唯一直接依赖 `express@5.3.0`

---

## 1. 总体结论

这是一个**完成度与工程质量都明显高于平均水平**的单体应用：核心 ICPC 排名/封榜/奖项规则在服务端有认真实现，前后端共享同一份 `standings.js` / `medals.js` / `freeze.js`，49 个测试覆盖了错误代价最高的引擎路径，持久化采用原子写与串行化事务，观众端的数据隔离（不提前下发后续步骤与奖项）经测试与实测均成立。审计**未发现**可在常规路径上造成最终排名错误、RCE、持久化数据损坏或已确认的 DOM XSS 的缺陷。

主要风险集中在四个方向：

1. **部署/信任模型**：默认无登录，`/api/fetch` 是无限制的服务端请求（SSRF），且 80 次匿名建局即可挤掉正在直播的主持会话；
2. **输入规模**：解析/建局无队伍/提交/步骤/字节上限，大输入会阻塞单线程事件循环，游戏 JSON 随「揭晓次数 × 队伍数」膨胀；
3. **直播画面正确性**：颁奖详情页存在一个可复现的「显示上一支队伍」缺陷；回退/重连采用全量重放，大队伍规模下会卡顿数十秒；
4. **客户端零自动化测试**：配置中心、播放页、渲染器、SSE 客户端全部没有自动化测试，上述客户端缺陷均无法被现有测试发现。

**风险统计**

| 级别 | 数量 | 说明 |
| --- | ---: | --- |
| Critical | 0 | 无 |
| High | 4 | 内网 SSRF、时间解析致排名错误、颁奖页错队、主持会话被挤掉 |
| Medium | 15 | 认证/规模/持久化/引擎保真度/客户端数据丢失等 |
| Low | 26 | 硬化、边界、竞态、报告误导等 |
| Nit | 6 | 可维护性与规范 |

---

## 2. 关键风险 Top 6

| # | 风险 | 级别 | 触发条件 | 后果 |
| --- | --- | --- | --- | --- |
| H1 | `/api/fetch` 可被抓取任意 http(s) 目标，含回环/内网/云元数据，且跟随重定向 | High | 服务对局域网开放（README 推荐的 `HOST=0.0.0.0`） | 内网探测与正文片段外带 |
| H2 | 无法解析的提交时间被静默当作 0 分 | High | 事件流含 `"contest_time":"garbage"`、空串，或 `time` 无可用 `start_time` | 最终排名/奖牌可能错误，且无任何提示 |
| H3 | 颁奖详情页先显示**上一支**队伍，下一动作才纠正 | High | 开启奖项且连续出现多个 `teamAward` | 投影/观众端在停留期间看到错误的队伍、照片与奖项 |
| H4 | 80 次匿名 `POST /api/game` 可驱逐正在直播的主持会话 | High | 主持页无 SSE 连接，是容量淘汰的首选 | 主持端 404，直播中断且无法恢复 |
| M6 | 游戏 JSON 随「揭晓数 × 队伍数」增长 | Medium | 2000 队 / 1.6 万次揭晓 | 实测 360 MB；3000 队时 `JSON.stringify` 抛 RangeError（500） |
| M14 | 观众端 SSE 在非 200 响应后永久卡住 | Medium | 反向代理短暂 502/503 | 画面冻结，只有切换标签页才重连 |

---

## 3. 详细发现

### 3.1 High

#### H1 —— `POST /api/fetch` 的服务端请求伪造（SSRF）

**位置**：`server/index.js:77-94`、`server/lib/remote-feed.js:2-40`、`server/index.js:266`

**证据**：路由只校验 `/^https?:\/\//i`；`fetchFeedText` 未设置 `redirect`，Node `fetch` 默认跟随最多 20 次重定向；未解析/校验目标地址。**本报告已复现**：在 127.0.0.1 启动一个内部 HTTP 服务，向 `/api/fetch` 提交其地址后，内部服务收到请求并返回 200；解析失败时错误响应还会回显远端正文的前若干字符（`Invalid event feed: line 1 is not valid JSON (Unexpected token 'I', "INTERNAL-S"...`）。

**影响**：任何能访问端口的客户端都可让服务器代其访问回环、RFC1918、链路本地（含 `169.254.169.254`）地址；`HOST=0.0.0.0` 的 LAN 场景下风险直接可达。DNS rebinding 亦无防护。

**建议**：解析 URL 并解析/固定 DNS，逐跳拒绝 loopback/private/link-local/multicast；`redirect:'manual'` 并对每个 `Location` 重新校验；限制端口与协议；错误信息不回显远端正文。若该端点只服务于可信主持人，应在反向代理层直接封禁。

#### H2 —— 不可解析的提交时间被静默计为 0

**位置**：`server/lib/engine.js:493-502`（时间解析）、`server/lib/engine.js:221-225`、`public/js/freeze.js:9-14`、`README.md:153`

**证据**：`parseContestTime` 对非法输入返回 `0` 而非 `null`；只有字段**完全缺失**才 `missingSubmissionTimes++`。冻结存在时 `withFreezeOptions` 本应抛错，但由于计数为 0 而放行。**本报告已复现**：A 队 4:30 解题、B 队 `contest_time:"garbage"` 解题，结果为 `missingSubmissionTimes=0`、`b.contestTime=0`，冻结榜顺序 `["b","a"]`——B 队以第 0 分钟夺冠且无任何警告。

同样的洞存在于墙钟时间回退：仅有 `time` 且 `start_time` 缺失/不可解析时也会落到 0。另注意 `parseTimestamp` 依赖 `Date.parse`，而项目自身 fixture 的 `+00` 写法（`tests/engine.test.js:84`）在 Node 中返回 `NaN`，导致历史封榜恢复与墙钟换算在该类 feed 上被静默禁用。

**影响**：最终排名与奖牌可能错误（且恰好在「有封榜」这一最常见配置下绕过保护），与 README「缺少提交时间时会明确报错」的承诺相反。

**建议**：时间解析改为全函数（非空但非法即 `null`），计入 `missingSubmissionTimes`；只要计数 > 0 就拒绝建局（与冻结模式无关）；`start_time` 使用严格 RFC3339 解析并接受 `Z` / `+HH:MM` / `+HHMM` / 小数秒。

#### H3 —— 颁奖详情页显示上一支队伍

**位置**：`public/js/render/resolver-view.js:493-500`、`:619`、`:1091`；`server/lib/engine.js:1320-1321`

**证据**：引擎的步骤顺序是 `selectTeam` → `pause` → `presentation teamAward` → `award`。进入 `teamAward` 时：

```js
this._awardTeamId = this._awardTeamId || this._selectedTeamIds[0] || this._lastAward?.teamId || null;
```

`_awardTeamId` 一旦被首个奖项页写入就不再清空，`selectTeam` 也不会重置它，因此 `||` 始终取到旧值；`award` 步骤要到下一次操作才纠正。渲染层 `:1091` 正是优先使用 `_awardTeamId`。子审查用演示赛事复现：选中 `team-02` 的颁奖页实际渲染 `team-05` / 铜奖，直到下一动作才变为 `team-02` / 银奖。

**影响**：这是整场滚榜的高潮画面。若主持人停在该动作（完全正常的操作），投影仪与所有观众端会持续显示错误的队伍/照片/奖项；观众端在快照重放时同样如此。

**建议**：进入 `teamAward` 时优先当前选择（`_selectedTeamIds[0] || _lastAward?.teamId || _awardTeamId`），或在 `selectTeam` / 切回 `scoreboard` 时清空 `_awardTeamId`。同时修正 `public/render-test.html` 中「先 award 后 presentation」的顺序——它正好掩盖了该缺陷。

#### H4 —— 正在直播的主持会话可被 80 次匿名建局挤掉

**位置**：`server/lib/sessions.js:29-45`（容量淘汰）、`server/index.js:128-143`、`public/js/play.js:192-198`

**证据**：`maxGames=80`，淘汰时按 `clients.size > 0` 再按 `touchedAt` 排序，取第一个。主持页不建立 SSE 连接（`play.js` 只做 GET/PUT），因此其会话 `clients.size === 0`，是最早被淘汰的对象。**本报告已复现**：先建局并确认主持 GET 返回 200，随后连续 82 次匿名 `POST /api/game`，主持端 GET 变为 **404**。

**影响**：同网段任何人（或大量预览页/重复点击）都能在直播中途终结主持链接；主持端此时只会弹出 toast 重试（`play.js:192-194`），没有终止态提示，无法自行恢复。

**建议**：不淘汰最近一段时间内有 GET/PUT 活动的会话，或增加 `presenterActive` 标记；候选项全部在用时应返回 503 而不是淘汰；主持端对 404/403 进入不可恢复错误态并提供「重新开始」；客户端对播放写失败区分「临时失败」与「会话已结束」。

---

### 3.2 Medium

| ID | 位置 | 问题与证据 | 影响 | 建议 |
| --- | --- | --- | --- | --- |
| M1 | `server/index.js:262-267` | 500 响应始终携带 `details: err.message`。实测畸形 contest → `details:"Cannot read properties of null (reading 'hidden')"`；`store.js:14` / `media-library.js:12` 的 `JSON.parse` 错误会带文件内容片段 | 向匿名调用方泄漏内部实现、路径与已存配置片段 | 仅在 `err.expose === true`（或非生产）时返回 `details`；完整信息只进日志 |
| M2 | `server/index.js:96-143,199-236`；`README.md:80-81` | 配置中心全部写接口无认证：`/api/configs`、`/api/assets`、`/api/media-library`、`/api/parse`、`/api/fetch`、`POST /api/game` | 同网段可删改预设、写入图片、读取已保存赛事、耗尽资源。README 已声明为可信网络模型并建议代理层限制——属**已接受的设计风险** | 纵深防御：管理接口独立监听/加服务端密钥；默认仅绑定 127.0.0.1 并在 UI 明示 |
| M3 | `server/index.js:17,54,128-139`；`server/lib/engine.js:131` | 40 MB JSON / 38 MB 文本全量同步解析；无队伍/题目/提交/步骤/字节上限；`title` 无长度上限；`maxGames=80` 无字节预算 | 单次大 POST 即可阻塞心跳与所有请求数秒，构造性 feed 可 OOM | 各数组与总字节设上限；建局前估算序列化大小；重活移出请求线程或直接拒绝 |
| M4 | `server/index.js:176-197` | SSE 无每会话/全局连接上限；每连接一个 `setInterval` 与一次完整快照序列化；心跳可让半开连接永久存活 | 内存/FD 耗尽；每个新观众 O(游戏大小) 的 CPU | 连接数上限、按 revision 预序列化并共享、全局单心跳、最大连接时长 |
| M5 | `server/lib/store.js:27-33,51-70`；`server/lib/assets.js:12-26` | 预设单条与总量无上限，每次操作整文件读写；图片每张 4 MB 但无总量/数量配额、无删除/回收路径、无像素尺寸校验 | 磁盘与内存耗尽；超大 PNG 解码拖慢观众浏览器 | 单条/总字节上限、素材配额与 GC、解析尺寸并限制像素 |
| M6 | `server/lib/engine.js:1291`（`order: order.slice()`） | 每个 resolve 都内嵌完整排名数组。子审查实测：1000 队/8k 揭晓 → 89 MB / 1.5 s；2000 队/16k → 360 MB / 9 s；3000 队 → `JSON.stringify` 抛 `RangeError`。本报告复核 2000 队/4000 待定 → 745 ms、22.5 MB | 大区赛/总决赛规模下建局极慢或 500；会话内存与 SSE 快照同步放大 | 仅在名次变化时下发 `order`（或下发增量）；让渲染端用共享 `standings.js` 本地重算；避免每次揭晓全量排序 |
| M7 | `server/lib/engine.js:878-894` | 冻结后的非罚时判题（CE/FE）被判为 `pending`，随后产生一次多余的 `resolve failed`。Java `ResolverLogic.cleanOutlierSubmissions` 会把这些判题重新并入冻结榜 | 直播中多出一次无意义的红色 «No» 揭晓；大比赛可能累积很多 | 冻结视图中对非 solved/非 penalty 的隐藏判题按已判无效处理，不置 pending |
| M8 | `server/lib/engine.js:537-547` | 只处理 `team.hidden`，忽略 `hidden:true` 的 group。**已复现**：`Staff` 组内队伍仍进入榜单并排到第 1 | 常见 CDS feed 用组隐藏工作人员/观察员，导致错误可见榜单 | 解析时把组隐藏并入 team.hidden |
| M9 | `server/lib/engine.js:927-946` | FTS 循环不检查 `unrank`。**已复现**：Hydro fixture 中打星观察队 `S01` 拿到 FTS，正式队 `01` 失去；观察队的未判提交还会阻断 FTS | 绿色的首解标记与首解奖归属错误 | 计算 FTS 时完全跳过 `unrank` 队伍（既不获奖也不阻断） |
| M10 | `server/lib/engine.js:1127-1142` | `display_mode:"list"` 被直接 `continue` 跳过，永远不产生 `teamList` 步骤。**已复现**：`top-3` list 奖只出现在 `contest.awards`，无任何画面 | README 声称支持 list 排版，实际现场不可见 | 按 Java 路径在所有获奖队伍揭晓后插入 teamList 展示 |
| M11 | `public/js/config.js:699-704,779-783,866-870,2012-2017,911-932` | 载入演示/事件流/预设直接覆盖 `state.contest` 并清空手动 Logo/照片记录，无确认、无脏检查；预设列表也不显示是否含赛事数据 | 误操作即永久丢失手动素材与未保存选项 | 有赛事时二次确认；预设列表标注「含赛事数据」；保留一份可撤销备份 |
| M12 | `public/js/config.js:2157-2207` | `startResolve` 只检查 `apiOnline`，不检查 `source==='offline'` / `previewDisabled`（预览路径 `1691`/`1763` 有检查）。先离线打开页面、服务恢复后点「开始滚榜」 | 会把 16 队假演示赛事建成正式滚榜并开播 | 与预览一致地拒绝离线/禁用状态，提示重新导入 |
| M13 | `public/js/play.js:139-155,190,377`；`public/js/watch.js:27-34` | 回退/Home/End/刷新恢复/409 同步/每个快照都从第 0 步全量重放，且每次 resolve 都调用 `scoreStandings` 全排序。子审查实测（Node + stub canvas）：1k 队 0.9 s、3k 队 10.5 s、5k 队 55.6 s | 中大型比赛按一次「上一步」或切回标签页即冻结数十秒，所有观众端同步卡顿 | 每 N 个动作做检查点，只重放尾部；`instant` 重放直接采用 `step.order`；观众端去重首次快照 |
| M14 | `public/js/watch.js:58-70,136-139` | `EventSource` 在非 200/错误 MIME 时会永久停止重连，而 `onerror` 只处理 404，其他情况无定时重试；同时每次 `visibilitychange` 都主动关闭并重连健康连接 | 代理短暂 502 后画面永久冻结（只有切标签页能救）；正常切标签也会重置并全量重放、闪烁 | 任意失败按退避重连并在 N 次后显示重试；仅在 `readyState===CLOSED` 时重连；去抖 |
| M15 | `public/js/play.js:175-198` | 主持页不订阅任何服务端状态；双窗口各自持有同一控制令牌，A 前进后 B 长时间显示旧画面，B 下次操作才发现 409 并丢弃本次操作 | 双屏/双人主持时投影可能长期是旧状态；操作被吞 | 空闲时轮询 `playback.revision` 或提供只读 SSE；409 后自动重放用户原本的动作 |

---

### 3.3 Low

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| L1 | `server/lib/engine.js:851-852` | 队伍 id 为 `__proto__` 时结果对象原型被赋值，`Object.entries` 丢键，建局 500（**已复现**：`details:"Cannot read properties of undefined (reading 'status')"`）。非全局原型污染 | 结果表用 `Object.create(null)` 或 `Map`，并拒绝保留键 |
| L2 | `server/index.js:17,54` | 文档上限 38 MB 文本对引号密度高的紧凑 NDJSON 实际不可达：JSON 编码后正文约为 1.2–1.5 倍。**已复现**：33 MB 紧凑 NDJSON → 43.5 MB body → 40 MB body-parser 先返回英文 `request entity too large` | 提高 body 上限或改为原始文本上传，并统一中文错误 |
| L3 | `server/index.js:239-249`；`public/preview.html:136` | 未设置 CSP / Permissions-Policy / Referrer-Policy；预览 iframe 同源无 sandbox。当前无 XSS 利用点，属纵深防御缺口 | 增加 CSP（`script-src 'self'`、`img-src 'self' data: blob: https:`、`frame-src 'self'`）与 Permissions-Policy |
| L4 | `public/js/standings.js:24-32` | 最终并列用 `displayName.localeCompare`，结果依赖运行时 locale。实测 `"一队" vs "二队"` 在 `en-US` 与 `zh-CN` 下顺序相反；Node 服务器与浏览器可能给出不同的名次数字 | 显式固定 locale（如 `'en'`）或按码点比较，并以队伍 id 作最终 tiebreaker |
| L5 | `server/lib/store.js:55-63` | 调用方自带 `id` 可覆盖已有预设；`id` 未做类型/长度校验 | 更新必须使用服务端签发 id，并校验格式 |
| L6 | `server/index.js:187`；`server/lib/sessions.js:92-96` | 1 MB 背压检查只在 `move()` 内且写前检查；首个快照绕过检查，回退的大快照可在下次 move 前超限 | 统一 `send()` 封装，写后检查并监听 `drain` |
| L7 | `server/index.js:199-215` | `/api/configs*` 未设置 `Cache-Control: no-store`（实测为 null），与其他敏感接口不一致 | 统一 no-store |
| L8 | `server/lib/store.js:31-33`；`media-library.js:21-22`；`assets.js:21-25` | 写临时文件后 rename，无 `fsync`；崩溃可能丢失最近一次写入并残留 `*.tmp` | `fsync` 文件与目录，启动时清理陈旧 tmp |
| L9 | `server/index.js:263` | body-parser 错误对象带原始 body，`console.error(err)` 会把最大 40 MB 的请求体写进日志 | 只记录 `type/message/status` |
| L10 | `server/index.js:251-259` | SPA 回退对任意 GET 返回 200 index.html；`/media/deadbeef.png`、未知路径均 200 | 带扩展名或 `/media/` 前缀返回真 404；`/api` 保持 JSON 404 |
| L11 | `public/js/config.js:2075-2078` vs `201-205` | 保存预设时不检查 `source==='offline'`，离线假赛事可被持久化（与 `flushPersist` 的保护不一致） | 复用同一守卫 |
| L12 | `public/js/config.js:904-910,991,107,198` | 素材导入匹配报告不随赛事身份清理，加载另一赛事预设后仍显示上一场的未匹配统计 | 报告按赛事 id 绑定或加载时清空 |
| L13 | `public/js/config.js:151-182,189-223,584-585` | 无 `storage` 事件同步；两个标签页各自全量写，后写者覆盖选项与整个赛事对象 | 监听 storage 或按域拆分 key |
| L14 | `public/js/config.js:207-222` | 配额失败后每次 persist 仍重新 stringify 巨型赛事再重试 | 记住「赛事过大」直到赛事变化 |
| L15 | `public/js/media-library.js:18-29` | 每条对象内 `filter` 全部规则，O(对象×规则)；实测 5k 队/5k 规则 601 ms 同步阻塞 | 按 kind/matchBy 建索引 |
| L16 | `public/js/media-library.js:20-21,33-34` | 别名命中时报错原因写成「已使用更优先的 ID 规则」（实际无 ID 规则）；两个名称规则时按插入序取胜 | 明确优先级与真实原因 |
| L17 | `public/js/config.js:1431-1437`；`public/js/media-library-ui.js:26-31` | 先 `response.json()` 再判 `ok`，代理返回 HTML/超时时暴露英文解析错误 | 复用 `fetchJSON` 的文本+JSON 兜底 |
| L18 | `public/js/config.js:790-793,873-883,2137-2149` | HTTP 4xx（说明服务器在线）不更新 `apiOnline=true`，页面可能持续显示「离线」 | 任何 HTTP 响应都视为在线 |
| L19 | `public/js/config.js:1744-1752` | 只检查 iframe `src` 与 loading 状态，play 页报错也提示「预览就绪」 | 同源检查 `contentWindow.ICPCResolver` 或 postMessage + 超时 |
| L20 | `public/js/config.js:1377-1408` vs `1476-1494` | Logo 上传缺少照片上传的「赛事已切换」保护，await 后仍修改旧赛事并提示成功 | 重新查找组织并校验赛事身份 |
| L21 | `public/js/render/resolver-view.js:503,523` | `_buildTeamListState()` 设置滚动目标后立刻 `reset(0)` 覆盖；且 `maxScroll` 按 12 行算、实际可见 11 行。当前引擎不下发 teamList，属潜在缺陷 | 先 reset 后 setTarget，按实际可见行数计算 |
| L22 | `public/js/play.js:438-446` | macOS Ctrl+点击先触发 `pointerdown`（后退）再 `contextmenu`（前进），第二次被 `transitioning` 丢弃 → 净后退一步 | `ctrlKey/metaKey` 时忽略 pointerdown |
| L23 | `server/lib/engine.js:879-880,932-934` | Hydro 冻结边界为 `<=`（包含），ICPC/Java 为 `<`；同一秒内的提交揭晓行为不一致 | 统一为严格 `<` 或写入契约 |
| L24 | `server/lib/engine.js:177-179` | `parseDuration(Infinity)` 返回 Infinity，序列化后变 `null`，时间计算产生 NaN | 数字分支加 `Number.isFinite` |
| L25 | `server/lib/engine.js:749` | `Boolean(s.penalty)` 会把字符串 `"false"` 当作真（仅影响手工/预设数据，feed 解析产出布尔） | 统一用 `toBool` |
| L26 | `server/lib/engine.js:1079` | 默认 single-step 行按 `order.length` 计数，含打星队，可能比 Java 默认低若干行 | 仅按有排名队伍计数 |

### 3.4 Nit

| ID | 位置 | 问题 |
| --- | --- | --- |
| N1 | `server/index.js:152` | 控制令牌用 `!==` 比较；256 位随机下时序攻击不现实，但可用 `timingSafeEqual` |
| N2 | `public/js/config.js:381-384` | 「查看源码」为 `#` 占位并只弹提示；`singleStepStartRow` 有同步逻辑但没有任何页面元素；`updateRangeFill`/`formatPause` 未被使用 |
| N3 | `public/*.html` | 可访问性小缺口：`#saveError` 未与输入框 `aria-describedby` 关联；计数/分页无 `aria-live`；素材库列表缺 `role=list/listitem` |
| N4 | `public/js/render/shaded-rect.js:131,158`；`resolver-view.js:264-274` | 立方体标签基线固定 `y+21`，几何随行数缩放；`rowsPerScreen>15` 时文字可能越界（UI 仅开放 9/12/15） |
| N5 | `server/lib/engine.js:107-108` vs `1219-1224` | 关于 `singleStepStartRow` 为 null 的注释自相矛盾（行为与 Java 一致） |
| N6 | 仓库根目录 | 无 `LICENSE` 文件，但 `package.json` 与 README 均声称 MIT；`public/assets/` 含 ICPC 字体/图像，需按 ICPC Software License 保留声明；目录无 `.git`，无法核对历史与来源 |

---

## 4. 已验证良好的部分

1. **观众端数据隔离正确**：`sessions.snapshot()` 将 `steps` 截断到 `index+1` 并把 `contest.awards` 置空（`server/lib/sessions.js:61-71`）；实测快照仅 1 步、无奖项、无 `submissions` 字段。`GET /api/game/:id` 与 `PUT playback` 强制控制头，实测无令牌 403。
2. **令牌生命周期安全**：32 字节随机令牌，仅经 URL fragment 传入并由 `history.replaceState` 清除、存入 `sessionStorage`；服务端只接受头部；`x-powered-by` 已关闭；无令牌进入日志或 Referer。
3. **核心排名规则是认真的 LIVE 移植**：解题数降序、整分钟罚时、`penaltyCount` 显式累计而非由 attempts 推断、ICPC 最后解题时间 tie-break、Hydro 精确秒且无 last-solve tie-break、并列同名次、打星队不占名次。子审查用 400 个 ICPC 随机种子 + 500 个混合种子验证了「最终 order == 最终榜」「每个 resolve.order == 共享 standings 重算」「无重复/遗漏揭晓」「buildSteps == buildGame.steps」「滚动逐行不跳」。
4. **封榜/双视图一致**：冻结与最终视图共用同一计算路径，冻结边界、pending 集合、历史封榜恢复（清空元数据后仍能恢复）均有测试；缺少时间在「feed 冻结」与「手动封榜」路径会明确抛 400。
5. **奖项数学正确**：累计名额、同分取较高奖、严格名额、0 名额、名额超队伍数、打星队排除、Hydro 精确秒相等，均与 README 示例一致。
6. **安全工程细节到位**：图片按 magic bytes + 声明 MIME 双重校验、SHA-256 内容寻址、`nosniff`、`dotfiles:'deny'`、SVG/HTML 拒收；预设写入串行化且失败不污染队列、损坏文件不被覆盖（有测试）。
7. **前端渲染无 XSS**：配置中心所有 `innerHTML` 仅为常量图标；赛事/用户数据一律 `textContent` / 属性 API；唯一 URL 汇聚点 `img.src` 经 `isSafeLogo()` 过滤 `javascript:` 与 `data:text/html`；播放/观众页无 HTML 字符串 sink。攻击模型「导入恶意事件流」未找到脚本执行路径。
8. **依赖与许可**：唯一直接依赖 `express@5.3.0`，lockfile 65/65 含 integrity，`npm audit` 0 漏洞。（`npm audit` 文本模式因网络超时失败，JSON 结果可用。）

---

## 5. 测试与工程质量

- **49 个测试全部通过**，集中在引擎、封榜、Hydro、奖项、会话、存储、远程抓取，质量高且有针对性。
- **覆盖率**（`node --test --experimental-test-coverage`）：整体 92.27% 行 / 81.60% 分支；`engine.js` 95.53% / 80.20%；`server/index.js` 仅 **58.18% 行 / 33.33% 函数**——`/api/parse`、`/api/fetch`、`/api/configs*`、`/api/assets`、`/api/awards`、`/api/media-library*`、404 与错误中间件基本未被 HTTP 级测试覆盖。
- **客户端零自动化测试**：`public/js/config.js`、`play.js`、`watch.js`、`render/*` 均未被任何测试导入；`render-test.html` 是手工页面，且其步骤顺序掩盖了 H3。
- **无 CI、无 lint、无格式化、无 E2E**；`package.json` 只有 `start/dev/test`。
- **测试缺口（按风险）**：① 事件流 `awards` 解析与 list/pause/ignore 展示；② `start_time`/墙钟时间换算与非法 `contest_time`（H2 本该被测试捕获）；③ hidden group（M8）与 Hydro 观察队 FTS（M9）；④ 大队伍规模基准（M6/M13）；⑤ SSE 生命周期、重连、背压、驱逐（M4/H4）；⑥ 客户端 DOM/SSE/XSS 回归；⑦ 错误响应与缓存头断言（M1/L7）。

**建议质量门禁**：`node --test` + 覆盖率阈值（如 85% 行）+ 至少一个 1000 队基准 + 一个 Playwright 冒烟（载入演示 → 预览 → 开始 → 观众同步）。

---

## 6. 修复路线图

**P0 —— 下一次正式直播前**

1. 限制或封禁 `/api/fetch`（H1）；至少禁用重定向、拒绝私网地址、不回显远端正文。
2. 时间解析严格化：非法即计数并拒绝建局（H2）。
3. 修复颁奖页 `_awardTeamId` 取值（H3）。
4. 会话保护：不淘汰近期活跃会话 / 主持端心跳 / 主持端对 404 进入终止态（H4）。
5. 收敛错误响应 `details`（M1）。

**P1 —— 本迭代**

6. 输入与规模上限：队伍/提交/步骤/游戏字节/`title`，建局前估算（M3、M6）。
7. 大队伍性能：仅名次变化时下发 `order`；客户端检查点重放；观众端去重快照（M6、M13）。
8. 引擎保真度：hidden group、Hydro FTS、list 奖项、CE pending（M7–M10）。
9. 配置中心：覆盖确认与预设含赛事标识、离线守卫（M11、M12）。
10. SSE 治理：连接上限、预序列化快照、重连退避（M4、M14）。
11. 安全头与 CSP（L3）。

**P2 —— 后续**

12. 持久化与素材配额、fsync、孤儿图片 GC（M5、L8、L14）。
13. 客户端测试、E2E、规模基准、CI/lint（第 5 节）。
14. 文档与合规：补 `LICENSE`、更新 CONTRACT（Hydro 边界、观察队策略、list 支持现状）、清理死 UI 与过时注释。
15. 低优先级项按上表逐条处理。

---

## 附录 A：关键复现记录

```bash
# H1: SSRF —— 提交内网/回环 URL 后，内部服务收到请求并返回 200
# （在 127.0.0.1 起一个返回 NDJSON 的内部服务，然后）
curl -X POST http://127.0.0.1:4173/api/fetch \
  -H 'Content-Type: application/json' \
  -d '{"url":"http://127.0.0.1:PORT/secret.ndjson"}'

# H2: 非法 contest_time 被当作 0，且 missingSubmissionTimes=0
# 见报告 §3.1 H2 的 11 行 NDJSON 复现（B 队以 0 分钟排第一）

# H4: 会话被挤掉
#   1) POST /api/game -> 记下 id/controlToken；GET /api/game/:id 返回 200
#   2) 连续 82 次 POST /api/game
#   3) 再 GET /api/game/:id -> 404

# M8: hidden group 未隐藏
#   feed 含 {"type":"groups","data":{"id":"staff","hidden":true}} 与 group_ids:["staff"] 的队伍
#   -> contest.teams 仍含该队，initialState.order 中排第一

# L2: 33 MB 文本被 40 MB JSON body 上限提前拒绝
#   JSON.stringify({text:<33MB>}) -> 43.5MB -> 413 "request entity too large"

# 基线
npm test
node --test --experimental-test-coverage tests/*.test.js
npm audit --json
```

## 附录 B：审计局限与未验证项

- 渲染层结论基于 Node + stub 2D context 的状态模拟，**未做真实浏览器像素比对**；H3 由代码路径与状态复现确认，建议再用真实浏览器复核一次。
- 未搭建真实 DNS rebinding 环境；H1 的「内网可达」已用回环服务实证，地址过滤缺失由代码确认。
- 未运行双进程写同一 `configs.json` / `media-library.json`；多进程丢失更新是代码层推断（README 已声明单实例）。
- `npm audit` 文本模式因网络超时失败，报告采用其 JSON 输出的 0 漏洞结论。
- 无 `.git`，无法审计历史变更、提交粒度与来源；`reference/icpctools` 为上游参考代码，不在本次审查范围。
- 性能数字为 Node 微基准（含 stub 渲染上下文），真实浏览器通常同量级或更慢，仅用于判断数量级与回归阈值。
