# 一键安装与更新

支持 Linux、macOS 和已连接 Docker Desktop 的 WSL。需要 Bash、Docker，以及 Docker Compose 2.20 或更新版本；兼容新版独立的 `docker-compose` 命令。脚本会检查 Docker 是否可用，不需要安装 Node.js、Python 或 Git。

## 安装

在服务器终端执行：

```bash
curl -fsSL https://raw.githubusercontent.com/Albert-Li-Sz/Resolver-Web/main/install.sh -o resolver-install.sh && bash resolver-install.sh
```

默认监听 `0.0.0.0:9080`，无需填写固定 IP 或域名。可通过任意本机 IP 或指向本机的域名访问。默认目录为当前目录下的 `resolver-web`；自动生成管理员密码和媒体内部密钥，启动应用、MediaMTX 和媒体工作服务。

无交互安装或指定目录：

```bash
bash resolver-install.sh install --dir /opt/resolver-web --yes
```

打开 `http://服务器IP:9080/`，用户名为 `admin`。查看生成的管理员密码：

```bash
sed -n 's/^RESOLVER_ADMIN_KEY=//p' /opt/resolver-web/.env
```

仅在本机使用时加 `--host 127.0.0.1 --bind 127.0.0.1`；不使用视频时加 `--no-media`。网页端口可通过 `--port 8080` 修改，媒体端口可通过 `--media-port-base 20501` 整组改为 `20501–20506`。`--host` 仅用于指定可选的媒体对外地址，不是访问白名单。各端口的用途和按需开放范围见 [网络配置](NETWORK.md#端口与访问范围)。

安装会先通过 Docker 检查端口能否绑定，再创建赛事数据和启动服务；冲突时不停止占用端口的其他服务。若在后续健康检查阶段失败，配置会保留，修正后运行 `manage.sh start`。

默认使用已发布的 `main` 镜像，支持 amd64 / arm64。脚本校验应用和媒体镜像来自同一提交，再保存实际镜像摘要，避免重启时发生隐式升级。`main` 是四模块平台的场馆验收版；稳定版 `latest` 仍为原 v1.3.0。

## 更新

```bash
bash /opt/resolver-web/manage.sh update
```

更新过程会：

1. 拉取并校验目标镜像。拉取失败或应用与媒体版本不一致时，现有服务继续运行。
2. 备份配置，短暂停止应用，将赛事数据归档到 `backups/日期-进程号/data.tar.gz`。
3. 使用新镜像启动，等待服务健康检查通过。旧默认网页端口 `4173` 迁移到 `9080`，媒体端口迁移到 `20001–20006`；自定义网页端口和显式媒体代理地址保留。管理员密码、项目名、屏幕绑定与数据卷保持不变。
4. 启动失败时回退旧镜像和配置，并重新启动。数据卷不会被清空，也不会自动用备份覆盖；更新期间写入的数据仍保留。

更新会有短暂服务中断，请在比赛前或维护时段执行。每次更新保留一份备份，脚本不自动清理；数据量较大时请预留备份空间。

固定到指定构建时，使用两种镜像都已发布的完整提交号标签：

```bash
bash /opt/resolver-web/manage.sh update --tag sha-完整的40位提交号
```

此后继续跟随该标签；恢复跟随主分支镜像可执行 `update --tag main`。更新管理脚本本身时，重新下载最新版，再执行：

```bash
bash resolver-install.sh update --dir /opt/resolver-web
```

## 常用命令

```bash
bash /opt/resolver-web/manage.sh status
bash /opt/resolver-web/manage.sh logs
bash /opt/resolver-web/manage.sh backup
bash /opt/resolver-web/manage.sh stop
bash /opt/resolver-web/manage.sh start
```

`backup` 会短暂停止正在运行的应用，备份后恢复；原本已停止的应用保持停止。`stop` 保留容器、配置和数据卷。

安装目录也是普通 Compose 部署目录，可以直接使用 Docker Compose：

```bash
cd /opt/resolver-web
docker compose ps
docker compose logs --tail 100 -f
```

`.env` 保存地址、端口、密钥和媒体启用状态；`compose.yaml` 保存服务配置；`compose.override.yaml` 保存镜像摘要和环境变量映射；`.install-state` 固定管理脚本的项目、数据卷和更新标签。更新兼容迁移旧模板中的默认端口与固定媒体地址，并备份原 `.env` 和网关配置；启动失败时一并恢复。不要手动修改脚本管理的镜像摘要和安装记录。

## 卸载

安装目录自带独立卸载入口，也可以使用 `manage.sh uninstall`：

```bash
bash /opt/resolver-web/uninstall.sh
```

确认后仅移除本项目容器和网络，保留赛事数据卷、配置、备份和下载的镜像。无交互执行时加 `--yes`；需要恢复运行时执行 `bash /opt/resolver-web/manage.sh start`。

同时删除赛事数据卷，需显式指定两个参数：

```bash
bash /opt/resolver-web/uninstall.sh --purge-data --yes
```

此操作会删除该项目数据卷中的全部赛事、绑定和恢复进度。安装目录中的配置、备份和镜像仍保留，其他 Docker 项目不受影响。删除数据后若需全新安装，请选择新的空目录；需要恢复历史赛事则使用保留的备份。

旧安装没有 `uninstall.sh` 时，可重新下载 `resolver-install.sh`，直接执行 `bash resolver-install.sh uninstall --dir /opt/resolver-web`；无需先拉取镜像或更新服务。

## 已有部署与恢复

脚本安装使用独立目录及数据卷。同一目录重复执行安装只显示状态；不会覆盖已有手工部署或接管同名项目。已有手工 Compose 部署可继续按原项目名和数据卷执行 `pull`、`up -d --no-build`，步骤见 [部署说明](PLATFORM.md)。

每份备份含 `.env`、Compose 文件、安装记录、网关配置和完整数据归档。它包含赛事凭据，请妥善保管；脚本创建的配置及备份仅当前用户可读。

需要恢复赛事数据时，先停止应用，确认目标数据卷和备份时间，再人工恢复。不要直接在运行中的比赛上覆盖数据。如果只是镜像启动失败，优先查看日志和脚本给出的回退结果。

若机器被断电或安装进程被强制结束，确认没有仍在运行的安装进程后，可移除安装目录中的空目录 `.install-lock`，再执行 `start` 或 `update`。普通错误及 Ctrl+C 会自动释放锁。

网络默认开放；可选登录、跨域来源、反向代理和内网策略见 [网络配置](NETWORK.md)。
