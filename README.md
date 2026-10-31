# ICPC 赛事制作台

纯 Web 的赛事滚榜、导播与多屏展示平台，提供四个入口：

- **Resolver**：保留原有滚榜、奖项、校徽、主持与观众同步。
- **Live**：导播预览、正式输出与 OBS 透明叠加。
- **PresentationAdmin**：通过链接码连接、命名和分组展示屏，下发同步节目单。
- **Presentations**：浏览器展示端，支持中英模板、2K / 4K、LED 比例与断线恢复。

## 快速部署

安装 Docker 和 Docker Compose 后直接执行：

```bash
curl -fsSL https://raw.githubusercontent.com/Albert-Li-Sz/Resolver-Web/main/install.sh -o resolver-install.sh && bash resolver-install.sh
```

默认监听 `0.0.0.0:9080`，可通过任意本机 IP 或指向本机的域名访问。默认安装到 `./resolver-web`；用户名为 `admin`，密码在该目录 `.env` 的 `RESOLVER_ADMIN_KEY` 中。

媒体使用 `20001–20006`。卸载执行 `bash ./resolver-web/uninstall.sh`，默认保留赛事数据；端口配置和完整卸载选项见 [安装说明](doc/INSTALL.md)。

更新、查看状态：

```bash
bash resolver-web/manage.sh update
bash resolver-web/manage.sh status
```

默认使用 GitHub Actions 构建的 `main` 镜像，支持 amd64 / arm64；更新自动备份，保留配置与数据。`main` 是四模块平台的场馆验收版，稳定版 `latest` 仍为 v1.3.0。[安装选项、更新与备份](doc/INSTALL.md) · [手动 Compose 部署](doc/PLATFORM.md)

网络访问默认开放；来源限制、反向代理和安全策略由部署者配置，见[网络配置](doc/NETWORK.md)。

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
