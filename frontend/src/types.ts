export type AnyRecord = Record<string, any>;
export type Scene = {
  layout: string;
  teamIds: string[];
  mediaIds: string[];
  audioMediaId: string;
  title: string;
  ticker: string;
  image: string;
  volume: number;
  widgets: Record<string, boolean>;
  positions: Record<string, { x: number; y: number }>;
};
export type Item = {
  type: string;
  duration: number;
  text?: string;
  teamId?: string;
  images?: string[];
  targetTime?: number;
};
export type Program = { items: Item[]; loop: boolean; transition: string };
export const labels: Record<string, string> = {
  standby: '待机画面',
  scoreboard: "实时榜单",
  leaders: "领先队伍榜",
  clock: "比赛时钟",
  countdown: "倒计时",
  queue: "判题队列",
  "first-solves": "首解列表",
  team: "队伍介绍",
  logo: "赛事 Logo",
  photos: "图片轮播",
  message: "文字公告",
  calibration: "屏幕校准",
  resolver: "Resolver 观众画面",
  live: "Live 正式画面",
};
export const widgetLabels: Record<string, string> = {
  scoreboard: "榜单",
  clock: "时钟",
  queue: "提交队列",
  firstSolves: "首解提示",
  team: "队伍信息",
  title: "字幕",
  ticker: "滚动消息",
  image: "图片",
};
