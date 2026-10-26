# 观众入口与滚榜节奏

## 外部观众

`/view` 是固定只读入口，无需管理员登录。没有正式滚榜时显示等待页；主持人点击「开始滚榜」后自动接入，新场次开始时自动切换。预览会话不发布到该入口。`/view?id=...` 固定观看某一场，旧 `/watch.html?id=...` 兼容。

## 开场与正式滚榜

冻结榜单第一次前进直接执行到底部的滚动，固定约 650 毫秒。队伍数量增加不会再把开场动画拖长。

正式滚榜的手动起点取所有已启用、未忽略奖项获奖队伍的最低封榜位置，覆盖金银铜、冠亚季军、题目首解和名单类奖项。起点之前保留完整的逐队滚动、选择、揭晓和排名变化，以 4 倍速自动播放。到达起点后停下，由主持人继续手动操作；如果获奖队伍被其他队伍挤到更低位置，会先停下处理该队。没有活动奖项时从底部手动推进。

快进可以暂停/继续；回退、重置、离开主持页及其他主持窗口接管时，会停止本窗口的自动推进。预览可逐步排查每个动作。观众通过 SSE 接收每个已公开动作，并使用相同的动画倍率；不会提前收到后续判题或完整获奖名单。

## 参考项目

- [ICPC Tools ResolverLogic](https://github.com/icpctools/icpctools/blob/main/ContestModel/src/org/icpc/tools/contest/model/resolver/ResolverLogic.java)：从底部逐队处理、ScoreboardTiming 与 PauseTiming 的分界，以及揭晓后重新计算当前行的队伍。本项目将分界扩展到全部活动奖项，并使用获奖队伍封榜位置。
- [CN XCPC Tools 滚榜说明](https://github.com/cn-xcpc-tools/cn-xcpc-docs/blob/master/resolver.md)：奖牌、前三名、首解奖的组合与 `--fast` 节奏控制。本项目使用固定 4 倍速预段和手动奖项区。
- [XCPCIO Board Resolver](https://github.com/xcpcio/xcpcio/blob/main/packages/apps/board/src/components/Resolver.vue)：首次滚到底部、随后逐次揭晓和跟随当前队伍的滚动流程。其首次滚动时长随队伍数增长；本项目按本次需求改为固定 650 毫秒。
