# Resolver Web

在浏览器中配置和主持 ICPC / XCPC 滚榜。支持 CCS Contest API 事件流、Hydro CDP 导出、素材管理、封榜还原、自定义奖项，以及跟随主持端的只读观众页面。

本项目为非官方 Web 实现，基于 [ICPC Tools Resolver](https://github.com/icpctools/icpctools)。配置中心参考 [Hydro Docs](https://docs.hydro.ac/zh)、[Pintia UEP](https://uep.pintia.cn/dashboard) 和 [NXOPA-RegSYS](https://github.com/Albert-Li-Sz/NXOPA-RegSYS) 的简洁布局、蓝白配色与表单风格。采用原版排名规则和 Canvas 展示，并支持奖项区之前的 4 倍速快进与固定观众入口。节奏设计及参考资料见 [播放说明](docs/PLAYBACK.md)。

![数据源与上传入口](doc/images/01-data-empty.jpg)

[图文使用指南 PDF](doc/使用指南.pdf) · [在线阅读使用指南](doc/使用指南.md) · [示例榜单下载](examples/README.md) · [测试记录](doc/TESTING.md)

## 功能与操作流程

1. **数据源**：上传 `.ndjson` / `.jsonl` / `.json` 事件流，或从远程地址读取。首次打开为空白赛事，不会自动载入演示。示例统一在 GitHub 下载，再通过相同的上传入口使用。
2. **Logo 与照片**：导入时按学校中英文名称及别名自动匹配 [Hydro 学校 Logo 库](https://avatar.hydrooj.com/)，未匹配或图片加载失败时使用内置 ICPC 官方 Logo。保留赛事自带及手工上传的图片，支持逐组织或逐队替换，也可赛前按 ID 或名称准备素材。
3. **显示与节奏**：设置每屏行数、行偏移、开场屏、奖项与图例；从完整赛后事件流还原封榜。可同时配置金银铜、冠军/亚军/季军，以及指定题目或全部题目的最快解题奖，预览完整获奖名单。
4. **实时预览**：在独立的 16:9 预览中前进、后退和重置，检查数据与颁奖画面。
5. **配置预设**：将参数连同赛事保存到服务端，之后载入复用。
6. **开始滚榜**：开场点击后约 650 毫秒滑到底部；已启用奖项的获奖队伍封榜位置之前自动 4 倍速掠过，进入奖项区后恢复手动推进。分享固定 `/view` 入口，其他电脑只读观看并同步进度。

### 示例下载

| 场景 | 队伍 / 题目 | 重点 |
| --- | --- | --- |
| [快速上手](examples/01-quickstart-8-teams.ndjson) | 8 / 5 | 基本封榜、通过与失败揭晓 |
| [决赛与颁奖](examples/02-finals-18-teams.ndjson) | 18 / 13 | 20 次揭晓、首解、徽标和颁奖 |
| [多页榜单](examples/03-regional-48-teams.ndjson) | 48 / 10 | 滚动与投影布局 |
| [并列与奖线](examples/04-ties-and-medals.ndjson) | 8 / 5 | 同题数同罚时与并列同奖 |
| [Hydro 风格](examples/05-hydro-starred.ndjson) | 4 / 2 | 打星、秒级罚时和非罚时判题 |

[下载全部示例 ZIP](https://github.com/Albert-Li-Sz/Resolver-Web/raw/refs/heads/main/examples/scoreboards.zip)。示例为合成练习数据，非官方比赛成绩。ZIP 需先解压，上传其中一个事件流文件；清单及 SHA-256 见 [examples/manifest.json](examples/manifest.json)。

## 本机快速开始

需要 [Node.js](https://nodejs.org/en/download) 22 或 24，推荐 24 LTS。源码兼容 Node.js 20+；无需前端构建、数据库或额外服务。

```bash
git clone https://github.com/Albert-Li-Sz/Resolver-Web.git
cd Resolver-Web
npm ci
npm start
```

打开 `http://127.0.0.1:4173/`，从 GitHub 下载示例或使用真实赛事事件流，点击「上传文件」。本机默认无需密码。改变端口：`PORT=8080 npm start`。

学校名称索引随项目附带，导入无需在线查询；匹配到的校徽从 Hydro 加载，无法加载时自动使用本地 ICPC Logo。通过 `npm run logos:sync` 更新学校索引。匹配忽略大小写、空格和常用标点，支持中英文双语名称；存在歧义时使用默认 Logo，避免串校。

### 局域网主持与观众

```bash
export HOST=0.0.0.0
export RESOLVER_ADMIN_KEY="$(openssl rand -hex 24)"
printf '本次管理员密码：%s\n' "$RESOLVER_ADMIN_KEY"
npm start
```

主持人使用 `http://服务器局域网IP:4173/`，浏览器登录用户名为 `admin`，密码为上面生成的值。观众打开固定 `http://服务器局域网IP:4173/view`，会自动等待并接入当前正式滚榜；预览不会替换直播。主持页也可复制固定入口，或使用 `/view?id=...` 只观看指定场次。请让所有设备使用同一服务器地址；`localhost` 和 `127.0.0.1` 指向观看者自己的电脑。

本机配置中心默认仅接受回环地址。域名、局域网及反向代理部署均须设置 `RESOLVER_ADMIN_KEY`。观众页面无需管理员密码，主持控制由独立会话令牌保护。

## 部署

### 方案一：Docker Compose

安装 [Docker Engine 与 Compose](https://docs.docker.com/compose/install/)，然后：

```bash
git clone https://github.com/Albert-Li-Sz/Resolver-Web.git
cd Resolver-Web
cp .env.example .env
openssl rand -hex 24
```

把随机输出填入 `.env` 的 `RESOLVER_ADMIN_KEY=`，保持该文件私有。默认只在服务器的 `127.0.0.1:4173` 开放端口，供 Nginx / 1Panel 反向代理使用。

```bash
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:4173/api/health
```

返回 `"ok":true` 后，通过下节的域名或本机浏览器进入配置中心，使用 `admin` 和 `.env` 中的密码登录。容器以非 root 用户运行，数据保存在 `resolver-data` 命名卷。仅需局域网直连时，可在 `.env` 把 `RESOLVER_BIND_ADDRESS` 改为 `0.0.0.0` 后重新执行 `docker compose up -d`，并按实际网络配置防火墙。

```bash
# 查看日志
docker compose logs --tail=100 -f
# 升级：赛后操作，先按后文备份
git pull --ff-only
docker compose up -d --build
# 停止并移除容器，保留数据卷
docker compose down
```

服务重启会清空当前滚榜会话和链接；预设与素材会保留。比赛进行中请勿升级或重启。镜像在本机从源码构建，无需依赖未经发布的镜像标签。

### 域名、HTTPS 与 Nginx / 1Panel

将域名指向服务器，在 Nginx 或 1Panel 新建反向代理网站，目标设为 `http://127.0.0.1:4173`，申请并启用 HTTPS 证书。公网使用 HTTPS 后再登录管理页面。参考配置位于 [deploy/nginx.conf](deploy/nginx.conf)，替换示例域名即可。

在网站的反向代理配置中保留以下设置：

```nginx
client_max_body_size 40m;
location / {
    proxy_pass http://127.0.0.1:4173;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
    proxy_send_timeout 1h;
}
```

这是站点根路径部署，不支持任意子路径前缀。`Host` 头用于管理来源校验；SSE 观众同步依赖长连接，按 [Nginx 官方说明](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering) 关闭缓冲，避免进度积压。不要给整个站点再套一层统一 Basic Auth，否则观众也会被要求登录。应用自身已区分管理页面与公开观众页面。

若 1Panel / OpenResty 自身运行在另一容器中，其 `127.0.0.1` 指向该容器。请使用它能够访问的宿主机地址或同一 Docker 网络内的服务名；相应调整端口绑定，保留管理员密码和上述请求头。

部署后用域名登录，完成一次「上传示例 → 预览 → 开始滚榜」，再在另一浏览器打开观众链接，确认前进、回退、刷新后同步。健康检查只证明服务启动，不代表这条完整流程已通过。

### 方案二：Linux systemd

先安装 Node.js 24，并确认 `command -v node`。以下以 `/usr/bin/node` 为例；如果不同，请修改服务文件中的 `ExecStart`。

```bash
sudo useradd --system --home-dir /var/lib/resolver-web --create-home --shell /usr/sbin/nologin resolver
sudo git clone https://github.com/Albert-Li-Sz/Resolver-Web.git /opt/Resolver-Web
cd /opt/Resolver-Web
sudo npm ci --omit=dev --ignore-scripts
sudo install -d -o resolver -g resolver /var/lib/resolver-web
sudo install -m 600 /dev/null /etc/resolver-web.env
sudoedit /etc/resolver-web.env
```

在环境文件中填写（密码请自行生成，下面的占位文字必须替换）：

```dotenv
HOST=127.0.0.1
PORT=4173
RESOLVER_ADMIN_KEY=替换为随机管理员密码
RESOLVER_DATA_DIR=/var/lib/resolver-web
```

```bash
sudo cp deploy/resolver.service /etc/systemd/system/resolver-web.service
sudo systemctl daemon-reload
sudo systemctl enable --now resolver-web
sudo systemctl status resolver-web
curl -fsS http://127.0.0.1:4173/api/health
```

再按上节配置 HTTPS 反向代理。日志：`sudo journalctl -u resolver-web -f`。升级前备份 `/var/lib/resolver-web`，更新代码、执行 `npm ci --omit=dev --ignore-scripts`，在无正在直播的赛事时重启服务。

### 环境变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Node 监听地址；容器内使用 `0.0.0.0` |
| `PORT` | `4173` | Node 监听端口 |
| `RESOLVER_ADMIN_KEY` | 未设置 | 管理员密码；配置后用户名为 `admin` |
| `RESOLVER_DATA_DIR` | 项目 `data/` | 预设、素材库及图片的数据目录 |
| `RESOLVER_FEED_ORIGINS` | 未设置 | 允许拉取的局域网 CDS 精确来源，英文逗号分隔 |
| `RESOLVER_BIND_ADDRESS` | `127.0.0.1` | Compose 的宿主机端口绑定地址 |
| `RESOLVER_PORT` | `4173` | Compose 的宿主机公开端口 |

远程事件流默认只允许公网 HTTP(S) 的 80 / 443 端口；DNS 和每次重定向均重新检查。局域网 CDS 需显式设置，例如 `RESOLVER_FEED_ORIGINS=http://192.168.1.20:8080,https://cds.example.org:8443`。直接上传文件不受此限制。

### 备份、恢复与卸载

预设、素材规则与图片在服务端持久化；当前赛事及未保存的选项还保存在所用浏览器的本地存储。换电脑或清理浏览器数据前，先保存配置预设。主持会话仅存在内存中，不能通过备份恢复正在直播的链接。

Docker 备份：先结束直播，然后在项目目录执行：

```bash
mkdir -p backup
docker compose stop
docker compose run --rm --no-deps --user root --entrypoint sh -v "$PWD/backup:/backup" resolver -c 'tar -czf /backup/resolver-data.tar.gz -C /app/data .'
docker compose start
```

Docker 恢复：把备份文件放到项目的 `backup/`，停止服务后执行：

```bash
docker compose stop
docker compose run --rm --no-deps --user root --entrypoint sh -v "$PWD/backup:/backup" resolver -c 'tar -xzf /backup/resolver-data.tar.gz -C /app/data && chown -R node:node /app/data'
docker compose up -d
```

恢复会覆盖同名数据文件，恢复前也请备份当前数据。Node / systemd 部署则在停止服务后备份整个 `RESOLVER_DATA_DIR`，还原至同一目录并保证 `resolver` 用户可写。数据包括 `configs.json`、`media-library.json` 和 `images/`，请一起保留。

卸载 Docker 部署时先备份，再执行 `docker compose down`；它会保留数据卷。systemd 部署先执行 `sudo systemctl disable --now resolver-web`，再移除服务文件、站点反向代理与程序目录。数据目录可留作恢复，不必随程序一起删除。

## 数据格式与注意事项

接受标准 CCS Contest API 事件流：UTF-8，每行一个 JSON 对象，或一个 JSON 数组。通常包含 `contests`、`teams`、`organizations`、`problems`、`submissions`、`judgements`、`judgement-types`、`awards` 等事件。支持 create / update / delete。

Hydro 用户在比赛榜单导出 CDP，解压后上传 `event-feed.ndjson`；自动识别 ACM/XCPC 赛制并保留秒级罚时与打星队伍。OI / IOI 积分制不支持。相对路径图片不会随 NDJSON 一起上传，请在素材页补齐。格式依据：[Hydro 现场赛说明](https://docs.hydro.ac/zh/docs/Hydro/system/onsite-contest)。

封榜可读取事件流的当前或历史记录，也可手动指定最后多少分钟。恰好位于封榜起点的提交需要揭晓；仅含最终汇总成绩的 CSV / Excel 无法重建提交过程。

自定义奖项按累计名额划线；开启并列同奖时，同题数同罚时取较高奖项，可能超出名额。打星队伍不占正式排名或奖项名额。自定义金银铜会替换原奖牌、保留首解等其他奖项。

### 容量与会话

事件流原始文本上限 38 MB；兼容 JSON 请求体上限 16 MB。单场最多 3000 队、30 题、15 万提交、30 万事件、20 万步骤，会话 JSON 上限 32 MB。服务最多保存 80 场会话，序列化总预算 256 MB，容量在用时返回 503。单场 SSE 最多 100 名观众，全局最多 500 条连接。这些是输入和连接保护上限，不是已保证的并发性能指标。

连续 6 小时无访问的会话过期，观看会保持会话活跃。预设最多 60 条，单条 4 MB，总量 64 MB。图片最多 1 万张、总量 512 MB；素材上传会在浏览器压缩。清理孤立图片参见 `node scripts/prune-assets.mjs` 的参数说明；默认仅列出，不自动删除。

### 主持快捷键

| 操作 | 按键 |
| --- | --- |
| 下一步 | 右键、`→`、`↓`、`PageDown`、空格、回车 |
| 上一步 | 左键、`←`、`↑`、`PageUp`、退格 |
| 开头 / 结尾 | `Home` / `End` |
| 重置 / 全屏 / 帮助 | `R` / `F` / `?` |
| 关闭分享或帮助、退出全屏 | `Esc` |

鼠标操作作用于滚榜画面；PPT 翻页器可使用 PageDown / PageUp。滚榜为手动推进，动画在步骤之间照常呈现。

## 开发与验证

```bash
npm ci
npm run check
npm test
npm run examples
```

`npm run check` 检查自有 JavaScript 语法。单元及 HTTP 回归覆盖引擎、封榜、奖项、会话授权、SSE、存储、输入校验、下载样例和规模边界。CI 在 Node 22 / 24 运行检查，并构建容器验证真实 HTTP 流程及重启后的预设持久化。

对独立测试部署运行 `RESOLVER_ADMIN_KEY=测试服务的密码 npm run smoke -- http://127.0.0.1:4180`。该命令会创建测试会话与预设，请仅用于测试实例。重启后可用相同环境执行 `npm run smoke -- http://127.0.0.1:4180 verify-restart`；状态文件默认为 `/tmp/resolver-smoke-state.json`，可通过 `RESOLVER_SMOKE_STATE` 指定。

目录：`public/` 为无框架配置页面及播放器，`server/` 为 Express API、事件流引擎和会话，`tests/` 为回归测试，`examples/` 为下载数据，`doc/` 为图文文档，`deploy/` 为部署模板。原有引擎契约与审计资料保留在 `docs/`。

## 许可与致谢

沿用目标仓库的 [Apache-2.0](LICENSE) 许可，并保留原 Resolver Web 的 [MIT 声明](licenses/Resolver-original-MIT.txt)。来自 ICPC Tools 的移植逻辑、字体和图像继续适用其 [ICPC Software License](public/assets/ICPC-LICENSE.txt)，DM Sans 适用 SIL OFL；详见 [第三方声明](THIRD_PARTY_NOTICES.md)。本项目与 ICPC Foundation、Hydro、Pintia 无隶属关系，也不代表这些项目。
