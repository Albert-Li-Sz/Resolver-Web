# Resolver Web

## 项目介绍

面向 ICPC / XCPC 现场颁奖的 Web 滚榜工具，在浏览器中完成赛事配置、榜单揭晓和大屏展示。

支持 CCS Contest API 事件流及 Hydro CDP 导出，提供学校 Logo 自动匹配、队伍照片、金银铜与冠亚季军、最快解题奖、观众同步、重启恢复和 LED 大屏校准。无需数据库或前端构建。

本项目是基于 [ICPC Tools Resolver](https://github.com/icpctools/icpctools) 的非官方 Web 实现。[开源许可](LICENSE) · [第三方声明](THIRD_PARTY_NOTICES.md)

## 快速部署

### Docker Compose

镜像由 GitHub Actions 构建并发布到 GHCR，支持 amd64 / arm64。安装 Docker 和 Compose，然后执行：

```bash
git clone https://github.com/Albert-Li-Sz/Resolver-Web.git
cd Resolver-Web
cp .env.example .env
```

编辑 `.env`，设置管理员密码，并允许局域网设备访问：

```dotenv
RESOLVER_ADMIN_KEY=请替换为自己的管理员密码
RESOLVER_BIND_ADDRESS=0.0.0.0
```

启动服务：

```bash
docker compose pull
docker compose up -d
```

打开 `http://服务器IP:4173/`，用户名为 `admin`，密码为 `.env` 中设置的值。赛事、素材与直播进度保存在 Docker 数据卷中。

### 本机运行

安装 Node.js 22 或 24，然后执行：

```bash
git clone https://github.com/Albert-Li-Sz/Resolver-Web.git
cd Resolver-Web
npm ci
npm start
```

打开 <http://127.0.0.1:4173/>，本机默认无需密码。域名、HTTPS、局域网配置、升级与备份见[部署说明](doc/部署说明.md)。

## 快速使用

1. **导入赛事**：上传 `.ndjson`、`.jsonl` 或 `.json` 事件流。Hydro 用户上传 CDP 导出包中的 `event-feed.ndjson`。
2. **准备素材**：自动匹配学校 Logo，未匹配时使用 ICPC 官方 Logo；可补充队伍照片，赛前点击「检查并缓存素材」。
3. **配置并预览**：在「显示与节奏」中设置封榜、奖项和画面参数，再通过「实时预览」检查效果。
4. **开始滚榜**：点击「开始滚榜」，使用 `→` / 空格推进、`←` 回退，`F` 全屏，`C` 校准大屏。
5. **分享观众页**：其他设备打开 `http://服务器IP:4173/view`，自动跟随主持端观看。

服务重启后，在配置中心点击「继续上次滚榜」恢复进度；恢复后保持暂停。连接中断时，观众页保留画面并自动重连。

[示例榜单](examples/README.md) · [图文使用指南](doc/使用指南.md) · [PDF 使用指南](doc/使用指南.pdf)
