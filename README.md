# ICPC 赛事制作台

纯 Web 的赛事滚榜、导播与多屏展示平台，提供四个入口：

- **Resolver**：保留原有滚榜、奖项、校徽、主持与观众同步。
- **Live**：网页配置赛事和媒体来源，导播预览、正式输出与 OBS 透明叠加。
- **PresentationAdmin**：通过链接码连接、命名和分组展示屏，下发同步节目单。
- **Presentations**：浏览器展示端，支持 2K / 4K、LED 比例与断线恢复。

## 快速部署

安装 Docker Compose，在源码目录执行：

```bash
cp deploy/platform.env.example .env
# 填写管理员密码、随机媒体内部密钥、服务器局域网 IP。
docker compose --env-file .env -f compose.platform.yaml up -d --build
```

打开 `http://服务器IP:4173/`。管理端用户名为 `admin`，密码为 `.env` 中的 `RESOLVER_ADMIN_KEY`。升级请保留原项目名及 `resolver-data` 数据卷。

本地开发：

```bash
npm ci
npm run build
npm start
```

## 快速使用

1. 在 Live 导入 NDJSON 或配置 Contest API / 事件流连接，填写媒体来源。
2. 在 Resolver 创建独立快照并配置滚榜；外部观众使用 `/view`。
3. 在 Live 调整预览，确认后切换正式画面，复制输出链接到 OBS。
4. 展示电脑打开 Presentations，管理端输入链接码、命名屏幕，选择节目单后下发。

[完整使用与部署说明](doc/PLATFORM.md) · [示例事件流](examples/README.md)

基于 ICPC Tools 的滚榜与展示理念，参考 ICPC Live-v3 导播流程。第三方许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
