# ICPC 赛事制作台

纯 Web 的赛事滚榜、导播与多屏展示平台，提供四个入口：

- **Resolver**：保留原有滚榜、奖项、校徽、主持与观众同步。
- **Live**：导播预览、正式输出与 OBS 透明叠加。
- **PresentationAdmin**：通过链接码连接、命名和分组展示屏，下发同步节目单。
- **Presentations**：浏览器展示端，支持中英模板、2K / 4K、LED 比例与断线恢复。

## 快速部署

安装 Docker Compose，在源码目录执行：

```bash
cp deploy/platform.env.example .env
# 填写管理员密码、随机媒体内部密钥、服务器局域网 IP。
docker compose --env-file .env -f compose.platform.yaml pull
docker compose --env-file .env -f compose.platform.yaml up -d --no-build
```

打开 `http://服务器IP:4173/`。管理端用户名为 `admin`，密码为 `.env` 中的 `RESOLVER_ADMIN_KEY`。升级请保留原项目名及 `resolver-data` 数据卷。

默认使用 GitHub Actions 构建的 `main` 镜像，应用与媒体工作服务均支持 amd64 / arm64。`main` 是四模块平台的场馆验收版；稳定版 `latest` 仍为 v1.3.0。需要固定版本时，将两个镜像都改为同一 `sha-完整提交号` 标签。源码构建可使用 `up -d --build`。

本地开发：

```bash
npm ci
npm run build
npm start
```

## 快速使用

1. 在“赛事中心”配置一次 CCS 连接、校徽照片和队伍媒体，选择大屏语言，点击“切换当前赛事”供全端使用。
2. 赛后在 Resolver 从 CCS 获取 NDJSON 或手动上传，配置奖项后开始滚榜；外部观众使用 `/view`。
3. 在 Live 调整预览，确认后切换正式画面，复制输出链接到 OBS。
4. 展示电脑打开 Presentations，管理端输入链接码并命名，选择模板立即上屏，或编排节目单后下发。隐藏控制栏后按 H 或点击右上角恢复。

Live 与大屏分别提供待机、恢复和单层回切；屏幕卡片及 Live 诊断显示实际画面与媒体健康状态。

[操作说明书](doc/使用指南.md) · [PDF 下载](doc/使用指南.pdf) · [部署与开发](doc/PLATFORM.md) · [示例事件流](examples/README.md)

基于 ICPC Tools 的滚榜与展示理念，参考 ICPC Live-v3 导播流程。第三方许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
