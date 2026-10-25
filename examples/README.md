# 示例榜单下载

示例均为可重复生成的合成练习数据，不是官方比赛赛果。下载 `.ndjson` 文件后，在配置中心「数据源 → 上传文件」选择它；ZIP 请先解压，上传其中一个事件流文件。网页不再提供内置演示、自动载入示例或离线虚构赛事。

[下载全部示例 ZIP](https://github.com/Albert-Li-Sz/Resolver-Web/raw/refs/heads/main/examples/scoreboards.zip)

| 示例 | 队伍 / 题目 | 可练习内容 | 下载 |
| --- | --- | --- | --- |
| 快速上手 | 8 / 5 | 封榜、通过与失败揭晓 | [NDJSON](https://github.com/Albert-Li-Sz/Resolver-Web/raw/refs/heads/main/examples/01-quickstart-8-teams.ndjson) |
| 决赛与颁奖 | 18 / 13 | 20 次揭晓、金银铜、首解与组织徽标 | [NDJSON](https://github.com/Albert-Li-Sz/Resolver-Web/raw/refs/heads/main/examples/02-finals-18-teams.ndjson) |
| 多页榜单 | 48 / 10 | 滚动、每屏行数与投影布局 | [NDJSON](https://github.com/Albert-Li-Sz/Resolver-Web/raw/refs/heads/main/examples/03-regional-48-teams.ndjson) |
| 并列与奖线 | 8 / 5 | team-1 与 team-2 同题数同罚时，检查并列同奖 | [NDJSON](https://github.com/Albert-Li-Sz/Resolver-Web/raw/refs/heads/main/examples/04-ties-and-medals.ndjson) |
| Hydro 风格 | 4 / 2 | 打星队伍、秒级罚时和非罚时判题 | [NDJSON](https://github.com/Albert-Li-Sz/Resolver-Web/raw/refs/heads/main/examples/05-hydro-starred.ndjson) |

所有示例都有 5 小时赛时和最后 60 分钟封榜。决赛示例附带奖项；在「显示与节奏」打开「显示奖项」查看颁奖。其他示例可选择自定义金银铜名额。

`manifest.json` 记录文件 SHA-256、队伍数、题目数、提交数和揭晓数。运行 `npm run examples` 可重新生成 NDJSON、校验清单及 ZIP；`npm test` 会重新解析每个文件并检查这些数值，以及并列和 Hydro 规则。

文件中的 SVG 徽标直接嵌入，不依赖图片站点。所有提交和判题仅用于演练，勿作为真实比赛数据发布。
