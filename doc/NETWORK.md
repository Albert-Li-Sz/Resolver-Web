# 网络与访问配置

默认监听 `0.0.0.0:4173`。任意能够连接服务器的客户端都可以通过本机 IP 或指向本机的域名访问；不需要登记 Host、来源域名或客户端 IP。

应用默认使用 `RESOLVER_NETWORK_POLICY=open`，允许跨域请求及内网、回环、任意 HTTP(S) 端口的数据源和图片来源；视频工作服务使用同一策略。防火墙、TLS、反向代理、认证和来源限制由部署者配置。

## 常用设置

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 直接运行 Node 时的监听地址。 |
| `RESOLVER_BIND_ADDRESS` | `0.0.0.0` | Docker Compose 网页端口的宿主机绑定地址。 |
| `RESOLVER_PORT` | `4173` | Docker Compose 网页端口。 |
| `RESOLVER_ADMIN_KEY` | 可选 | 设置后管理端使用 `admin` 登录；留空且使用开放策略时不启用登录。安装脚本会生成初始密码。 |
| `RESOLVER_NETWORK_POLICY` | `open` | `restricted` 恢复应用内的网络访问检查。 |
| `RESOLVER_ALLOWED_ORIGINS` | 空 | 留空接受任意来源；填写后按精确 Origin 限制跨域访问，以逗号分隔。 |
| `RESOLVER_TRUST_PROXY` | `true` | 是否采用反向代理提供的 Host、协议和客户端地址；支持 `false`、代理层数及 IP / CIDR 列表。 |
| `RESOLVER_SECURITY_HEADERS` | `false` | 可设为 `true`，启用应用自带的 CSP 等响应头。 |
| `RESOLVER_FEED_ORIGINS` | 空 | 限制策略下额外允许的 HTTP(S) 数据源 Origin。 |
| `RESOLVER_MEDIA_ORIGINS` | 空 | 限制策略下额外允许的图片来源 Origin。 |

安装脚本部署可修改安装目录的 `.env`，然后执行 `bash manage.sh start` 重新应用配置。手工部署执行 `docker compose up -d`；完整源码 Compose 则使用 `-f compose.platform.yaml`。更换镜像版本执行 `manage.sh update`。

`0.0.0.0` 是监听地址。浏览器中使用 `http://localhost:4173/`、`http://服务器IP:4173/` 或部署者的域名。

## 按需限制访问

以下仅为部署者选择启用限制的示例：

```dotenv
RESOLVER_NETWORK_POLICY=restricted
RESOLVER_ADMIN_KEY=部署者设置的密码
RESOLVER_ALLOWED_ORIGINS=https://director.example.org,https://screen.example.org
RESOLVER_TRUST_PROXY=loopback,uniquelocal
RESOLVER_SECURITY_HEADERS=true
RESOLVER_FEED_ORIGINS=http://192.168.1.20:8080
RESOLVER_MEDIA_ORIGINS=http://192.168.1.30:8081
```

限制策略保留原来的无密码本机管理、跨站写入和来源地址检查。此时赛事连接及媒体来源界面会显示“允许场馆内网”选项。管理员密码与展示端、主持端的身份令牌分别管理。

## 多 IP、域名和反向代理

网页链接和媒体播放地址默认跟随当前请求的 Host。经反向代理访问时，应用按照 `RESOLVER_TRUST_PROXY` 读取 `X-Forwarded-Host` 和 `X-Forwarded-Proto`；代理监听地址、域名、TLS 及访问控制由部署者设置。请求头和代理信任配置应对应实际拓扑，见 [Express 官方说明](https://expressjs.com/en/guide/behind-proxies/)。

媒体配置：

| 变量 | 留空时的行为 |
| --- | --- |
| `MEDIA_PUBLIC_HOST` | 发布链接使用当前访问主机；该字段是可选对外地址，不是访问白名单。 |
| `MEDIA_BROWSER_BASE` | 使用当前协议和域名的 `8889` 端口提供 WHEP。可配置成 HTTPS 地址或同源代理路径，如 `/webrtc`。 |
| `MEDIA_HLS_BASE` | 使用当前协议和域名的 `8888` 端口提供 HLS。可配置成 HTTPS 地址或同源代理路径，如 `/hls`。 |
| `MEDIA_ICE_HOSTS` | 默认采用 `MEDIA_PUBLIC_HOST`；可填写浏览器能到达的 WebRTC 地址，支持逗号分隔。留空使用网关自动收集的地址。 |

Docker/NAT 场景若需要 WebRTC，可由部署者填写 `MEDIA_ICE_HOSTS` 并映射 ICE 端口；这是媒体连接地址，不限制访问来源。HTTPS 站点的媒体服务也应配置 HTTPS 或同源反向代理。未配置 WebRTC 可达地址时，播放器可回退到可达的 HLS。

通过不同域名打开的浏览器站点拥有各自的本地展示身份；共享赛事、服务器数据和已签发的观看链接仍由同一服务提供。

## 更新已有脚本部署

下载新版 `install.sh` 后，对原安装目录执行：

```bash
bash resolver-install.sh update --dir /opt/resolver-web
```

脚本保留管理员密码和赛事数据，并将旧模板中强制填写固定地址的配置迁移为可选项。若已有显式 `MEDIA_BROWSER_BASE` 或 `MEDIA_HLS_BASE` 设置，则继续使用部署者设置的地址。新安装默认监听全部 IPv4 网卡；已有安装的显式监听地址保留，需要时由部署者将 `RESOLVER_BIND_ADDRESS` 改为 `0.0.0.0`。
