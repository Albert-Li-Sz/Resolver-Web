#!/usr/bin/env bash
# Standalone installer: no checkout, Node.js, jq or Python required.
set -Eeuo pipefail
umask 077

APP_IMAGE=ghcr.io/albert-li-sz/resolver-web
WORKER_IMAGE=ghcr.io/albert-li-sz/resolver-web-media-worker
GATEWAY_IMAGE=bluenviron/mediamtx:1.21.3
COMMAND=install
INSTALL_DIR=
PUBLIC_HOST=
APP_PORT=9080
MEDIA_PORT_BASE=20001
BIND_ADDRESS=0.0.0.0
PROJECT=
CHANNEL=
MEDIA=1
WAIT_SECONDS=120
LOCKED=0
STAGE=
BACKUP=
RECOVER=0
APPLIED=0
PORT_PROBE=
INSTALL_STARTED=0
CONFIRM=0
PURGE_DATA=0
COMPOSE=()
INSTALLER_BASE_OVERRIDE=
INSTALLER_IMAGES_OVERRIDE=
INSTALLER_ENV_OVERRIDE=
SCRIPT_FILE=${BASH_SOURCE[0]:-}

say() { printf '%s\n' "$*"; }
fail() { printf '错误：%s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'HELP'
ICPC 赛事制作台安装与更新

  bash install.sh install [选项]   安装（默认命令）
  bash manage.sh update [--tag 标签] 更新，保留配置和数据，自动备份
  bash manage.sh status            查看容器状态
  bash manage.sh logs              持续查看最近日志
  bash manage.sh stop              停止服务，保留数据
  bash manage.sh start             启动已安装版本
  bash manage.sh backup            暂停应用并备份数据，然后恢复运行
  bash manage.sh uninstall         移除本项目容器和网络，保留数据与配置

选项：
  --dir 路径        安装目录，默认 ./resolver-web；manage.sh 默认所在目录
  --host IP或域名   可选媒体对外地址；网页及媒体默认跟随访问 IP / 域名
  --port 端口       网页端口，默认 9080；媒体默认使用 20001–20006
  --media-port-base 端口  媒体连续六个端口的起点，默认 20001
  --bind IP         监听地址，默认 0.0.0.0；本机使用可填 127.0.0.1
  --project 名称    新安装的 Compose 项目名，默认自动生成
  --tag 标签       main、sha-完整提交号或已发布版本；默认 main
  --no-media        新安装时仅启用应用，不启动媒体网关和转码服务
  --yes             确认卸载操作；安装与更新默认无需交互
  --purge-data      仅卸载时使用，同时删除本项目赛事数据卷（需 --yes）
  --wait-timeout 秒 服务健康检查等待时间，默认 120
  --help            显示帮助

需要已安装且可访问的 Docker、Docker Compose 2.20+（或新版独立 docker-compose）。
脚本不执行 .env；仅显式卸载并指定 --purge-data 时删除本项目数据卷。
HELP
}

if [ $# -gt 0 ] && [[ $1 != -* ]]; then COMMAND=$1; shift; fi
case "$COMMAND" in install|update|status|logs|stop|start|backup|uninstall) ;; help) usage; exit 0 ;; *) fail "未知命令：$COMMAND" ;; esac
INSTALL_OPTIONS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --yes) CONFIRM=1; shift ;;
    --purge-data) PURGE_DATA=1; shift ;;
    --no-media) MEDIA=0; INSTALL_OPTIONS=1; shift ;;
    --dir|--host|--port|--media-port-base|--bind|--project|--tag|--wait-timeout)
      if [ $# -lt 2 ] || [ -z "$2" ]; then fail "$1 缺少参数"; fi
      case "$1" in
        --dir) INSTALL_DIR=$2 ;;
        --host) PUBLIC_HOST=$2; INSTALL_OPTIONS=1 ;;
        --port) APP_PORT=$2; INSTALL_OPTIONS=1 ;;
        --media-port-base) MEDIA_PORT_BASE=$2; INSTALL_OPTIONS=1 ;;
        --bind) BIND_ADDRESS=$2; INSTALL_OPTIONS=1 ;;
        --project) PROJECT=$2; INSTALL_OPTIONS=1 ;;
        --tag) CHANNEL=$2 ;;
        --wait-timeout) WAIT_SECONDS=$2 ;;
      esac
      shift 2 ;;
    *) fail "未知选项：$1" ;;
  esac
done
[ "$PURGE_DATA" = 0 ] || [ "$COMMAND" = uninstall ] || fail "--purge-data 只能用于 uninstall。"
[ "$PURGE_DATA" = 0 ] || [ "$CONFIRM" = 1 ] || fail "删除赛事数据卷须同时指定 --purge-data --yes。"
[ "$COMMAND" = install ] || [ "$INSTALL_OPTIONS" = 0 ] || fail "地址、端口、项目及媒体选项只用于首次安装；后续请编辑安装目录的 .env。"
if ! [[ $WAIT_SECONDS =~ ^[1-9][0-9]*$ ]] || [ "$WAIT_SECONDS" -gt 3600 ]; then fail "等待时间须为 1–3600 秒"; fi
if ! [[ $APP_PORT =~ ^[1-9][0-9]*$ ]] || [ "$APP_PORT" -gt 65535 ]; then fail "端口须为 1–65535"; fi
if ! [[ $MEDIA_PORT_BASE =~ ^[1-9][0-9]*$ ]] || [ "$MEDIA_PORT_BASE" -gt 65530 ]; then fail "媒体端口起点须为 1–65530"; fi
if [ -n "$CHANNEL" ]; then [[ $CHANNEL =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]] || fail "镜像标签格式不正确"; fi

if [ -n "$SCRIPT_FILE" ] && [ -f "$SCRIPT_FILE" ]; then
  SCRIPT_FILE="$(cd "$(dirname "$SCRIPT_FILE")" && pwd)/$(basename "$SCRIPT_FILE")"
fi
if [ "$COMMAND" = install ] || [ "$COMMAND" = update ]; then
  if [ -z "$SCRIPT_FILE" ] || [ ! -f "$SCRIPT_FILE" ]; then fail "请先将脚本下载为文件，再用 bash 文件名运行，以便保存后续管理入口。"; fi
fi
if [ -z "$INSTALL_DIR" ]; then
  if [ -n "$SCRIPT_FILE" ] && [ -f "$(dirname "$SCRIPT_FILE")/.install-state" ]; then INSTALL_DIR=$(dirname "$SCRIPT_FILE")
  else INSTALL_DIR="$PWD/resolver-web"; fi
fi
[[ $INSTALL_DIR != *$'\n'* && $INSTALL_DIR != *$'\r'* ]] || fail "安装路径不能包含换行"
if [ "$COMMAND" = install ]; then mkdir -p "$INSTALL_DIR"; fi
[ -d "$INSTALL_DIR" ] || fail "安装目录不存在：$INSTALL_DIR"
INSTALL_DIR=$(cd "$INSTALL_DIR" && pwd)

command -v docker >/dev/null 2>&1 || fail "未安装 Docker。请先安装 Docker Engine 或 Docker Desktop：https://docs.docker.com/get-started/get-docker/"
docker info >/dev/null 2>&1 || fail "无法连接 Docker；请启动 Docker 并确认当前用户有访问权限。"
if docker compose version >/dev/null 2>&1; then COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1 && docker-compose version >/dev/null 2>&1; then COMPOSE=(docker-compose)
else fail "未找到 Docker Compose：https://docs.docker.com/compose/install/"; fi
"${COMPOSE[@]}" up --help | grep -- '--wait-timeout' > /dev/null || fail "请升级 Docker Compose 至 2.20 或更新版本。"

# Read only our single-line metadata. Never source/eval .env or downloaded text.
field() { sed -n "s/^$2=//p" "$1" | head -n 1; }
compose() (
  unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES
  unset RESOLVER_ADMIN_KEY MEDIA_INTERNAL_KEY MEDIA_PUBLIC_HOST RESOLVER_PORT
  unset RESOLVER_BIND_ADDRESS MEDIA_BIND_ADDRESS RESOLVER_IMAGE MEDIA_WORKER_IMAGE
  unset RESOLVER_NETWORK_POLICY RESOLVER_TRUST_PROXY RESOLVER_ALLOWED_ORIGINS RESOLVER_SECURITY_HEADERS
  unset RESOLVER_FEED_ORIGINS RESOLVER_MEDIA_ORIGINS MEDIA_BROWSER_BASE MEDIA_HLS_BASE MEDIA_ICE_HOSTS
  unset MEDIA_RTSP_PORT MEDIA_RTMP_PORT MEDIA_SRT_PORT MEDIA_HLS_PORT MEDIA_WEBRTC_PORT MEDIA_ICE_PORT
  if [ "$MEDIA" = 1 ]; then export COMPOSE_PROFILES=media; else export COMPOSE_PROFILES=; fi
  "${COMPOSE[@]}" --project-directory "$INSTALL_DIR" -p "$PROJECT" --env-file "${INSTALLER_ENV_OVERRIDE:-$INSTALL_DIR/.env}" \
    -f "${INSTALLER_BASE_OVERRIDE:-$INSTALL_DIR/compose.yaml}" -f "${INSTALLER_IMAGES_OVERRIDE:-$INSTALL_DIR/compose.override.yaml}" "$@"
)
load_state() {
  [ -f "$INSTALL_DIR/.install-state" ] || fail "该目录尚未由脚本安装，请先执行 install。"
  [ "$(field "$INSTALL_DIR/.install-state" FORMAT)" = 1 ] || fail "安装记录版本不兼容，请下载新版脚本。"
  PROJECT=$(field "$INSTALL_DIR/.install-state" PROJECT)
  VOLUME=$(field "$INSTALL_DIR/.install-state" VOLUME)
  MEDIA=$(field "$INSTALL_DIR/.install-state" MEDIA)
  SAVED_CHANNEL=$(field "$INSTALL_DIR/.install-state" CHANNEL)
  [[ $PROJECT =~ ^[a-z0-9][a-z0-9_-]*$ && $VOLUME =~ ^[a-z0-9][a-z0-9_.-]*$ ]] || fail "安装记录中的项目或数据卷名称无效。"
  [[ $MEDIA = 0 || $MEDIA = 1 ]] || fail "安装记录中的媒体模式无效。"
  [[ $SAVED_CHANNEL =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]] || fail "安装记录中的标签无效。"
  CHANNEL=${CHANNEL:-$SAVED_CHANNEL}
  for file in .env compose.yaml compose.override.yaml deploy/mediamtx.yml; do
    [ -f "$INSTALL_DIR/$file" ] || fail "缺少 ${file}，请从配置备份恢复。"
  done
}
cleanup() {
  local result=$?
  trap - EXIT INT TERM
  set +e
  if [ -n "$PORT_PROBE" ]; then docker rm -f "$PORT_PROBE" >/dev/null 2>&1; fi
  if [ "$RECOVER" = 1 ]; then
    say "操作未完成，正在恢复更新前的运行配置……"
    if [ "$APPLIED" = 1 ]; then
      cp "$BACKUP/compose.override.yaml" "$INSTALL_DIR/compose.override.yaml"
      cp "$BACKUP/compose.yaml" "$INSTALL_DIR/compose.yaml"
      cp "$BACKUP/.install-state" "$INSTALL_DIR/.install-state"
      cp "$BACKUP/.env" "$INSTALL_DIR/.env"
      cp "$BACKUP/deploy/mediamtx.yml" "$INSTALL_DIR/deploy/mediamtx.yml"
    fi
    if compose up -d --force-recreate --no-build --pull never --wait --wait-timeout "$WAIT_SECONDS"; then
      say "原镜像已恢复；赛事数据未被覆盖。备份：$BACKUP"
    else
      say "原镜像恢复未通过健康检查，请查看 logs；配置和数据备份保留在：$BACKUP"
    fi
  fi
  if [ "$INSTALL_STARTED" = 1 ] && [ "$result" != 0 ]; then
    say "安装尚未完成，配置和数据已保留。修正问题后运行：bash \"$INSTALL_DIR/manage.sh\" start"
  fi
  if [ -n "$STAGE" ] && [ -d "$STAGE" ]; then rm -rf "$STAGE"; fi
  if [ "$LOCKED" = 1 ]; then rmdir "$INSTALL_DIR/.install-lock" 2>/dev/null; fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$COMMAND" != install ]; then load_state
elif [ -f "$INSTALL_DIR/.install-state" ]; then
  load_state
  say "此目录已安装。更新请执行：bash \"$INSTALL_DIR/manage.sh\" update"
  compose ps
  exit 0
fi
if [ "$COMMAND" = status ]; then compose ps; exit 0; fi
if [ "$COMMAND" = logs ]; then compose logs --tail 100 -f; exit 0; fi

if [ "$COMMAND" = install ]; then
  [ -z "$(ls -A "$INSTALL_DIR")" ] || fail "安装目录不是空目录，请指定新的 --dir，避免覆盖已有部署。"
fi
mkdir "$INSTALL_DIR/.install-lock" 2>/dev/null || fail "另一个操作正在使用此目录；若上次被强制终止，请确认无安装进程后移除 .install-lock。"
LOCKED=1
STAGE=$(mktemp -d "$INSTALL_DIR/.staging.XXXXXX")

random_key() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }
valid_ipv4() {
  [[ $1 =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || return 1
  local octet
  local -a octets
  IFS=. read -r -a octets <<< "$1"
  for octet in "${octets[@]}"; do [ "$((10#$octet))" -le 255 ] || return 1; done
}
valid_host() {
  [[ $1 =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ && $1 != *..* && $1 != *- && $1 != *. && $1 != 0.0.0.0 ]] || return 1
  if [[ $1 =~ ^[0-9.]+$ ]]; then valid_ipv4 "$1"; fi
}
write_state() {
  printf 'FORMAT=1\nPROJECT=%s\nVOLUME=%s\nMEDIA=%s\nCHANNEL=%s\n' "$PROJECT" "$VOLUME" "$MEDIA" "$CHANNEL" > "$STAGE/state"
  mv "$STAGE/state" "$INSTALL_DIR/.install-state"
}
save_manager() {
  if [ -n "$SCRIPT_FILE" ] && [ -f "$SCRIPT_FILE" ] && [ "$SCRIPT_FILE" != "$INSTALL_DIR/manage.sh" ]; then
    cp "$SCRIPT_FILE" "$STAGE/manage.sh"
    chmod 700 "$STAGE/manage.sh"
    mv "$STAGE/manage.sh" "$INSTALL_DIR/manage.sh"
  fi
  cat > "$INSTALL_DIR/uninstall.sh" <<'UNINSTALL'
#!/usr/bin/env bash
set -euo pipefail
directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
exec bash "$directory/manage.sh" uninstall "$@"
UNINSTALL
  chmod 700 "$INSTALL_DIR/uninstall.sh"
}
pull_image() {
  docker pull "$1" >&2 || return $?
  local digest
  digest=$(docker image inspect "$1" --format '{{range .RepoDigests}}{{println .}}{{end}}' | awk -v prefix="$2@" 'index($0,prefix)==1 {print;exit}')
  [[ $digest =~ @sha256:[a-f0-9]{64}$ ]] || fail "无法获取镜像摘要：$1"
  printf '%s' "$digest"
}
prepare_images() {
  say "拉取 $CHANNEL 镜像并校验应用与媒体来源……"
  APP_PIN=$(pull_image "$APP_IMAGE:$CHANNEL" "$APP_IMAGE")
  local revision worker_revision
  revision=$(docker image inspect "$APP_PIN" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
  [[ $revision =~ ^[a-f0-9]{40}$ ]] || fail "应用镜像缺少构建来源。"
  [ "$(docker image inspect "$APP_PIN" --format '{{index .Config.Labels "io.resolver.network-layout"}}')" = 2 ] || fail "目标应用镜像尚不支持新版端口布局，请等待 main 镜像构建完成后重试；现有部署未变更。"
  WORKER_PIN="$WORKER_IMAGE:$CHANNEL"
  GATEWAY_PIN=$GATEWAY_IMAGE
  if [ "$MEDIA" = 1 ]; then
    WORKER_PIN=$(pull_image "$WORKER_IMAGE:$CHANNEL" "$WORKER_IMAGE")
    worker_revision=$(docker image inspect "$WORKER_PIN" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
    [ "$revision" = "$worker_revision" ] || fail "应用与媒体镜像来自不同提交，请稍后重试；现有服务未变更。"
    [ "$(docker image inspect "$WORKER_PIN" --format '{{index .Config.Labels "io.resolver.network-layout"}}')" = 2 ] || fail "目标媒体镜像尚不支持新版端口布局，请等待构建完成后重试。"
    GATEWAY_PIN=$(pull_image "$GATEWAY_IMAGE" bluenviron/mediamtx)
  fi
  {
    printf 'services:\n  resolver:\n    image: %s\n' "$APP_PIN"
    cat <<'NETWORK'
    environment:
      RESOLVER_NETWORK_POLICY: ${RESOLVER_NETWORK_POLICY:-open}
      RESOLVER_TRUST_PROXY: ${RESOLVER_TRUST_PROXY:-true}
      RESOLVER_ALLOWED_ORIGINS: ${RESOLVER_ALLOWED_ORIGINS:-}
      RESOLVER_SECURITY_HEADERS: ${RESOLVER_SECURITY_HEADERS:-false}
      RESOLVER_FEED_ORIGINS: ${RESOLVER_FEED_ORIGINS:-}
      RESOLVER_MEDIA_ORIGINS: ${RESOLVER_MEDIA_ORIGINS:-}
      MEDIA_RTSP_PORT: ${MEDIA_RTSP_PORT:-20001}
      MEDIA_RTMP_PORT: ${MEDIA_RTMP_PORT:-20002}
      MEDIA_SRT_PORT: ${MEDIA_SRT_PORT:-20003}
      MEDIA_HLS_PORT: ${MEDIA_HLS_PORT:-20004}
      MEDIA_WEBRTC_PORT: ${MEDIA_WEBRTC_PORT:-20005}
NETWORK
    printf '  media-worker:\n    image: %s\n' "$WORKER_PIN"
    cat <<'WORKER'
    environment:
      RESOLVER_NETWORK_POLICY: ${RESOLVER_NETWORK_POLICY:-open}
WORKER
    printf '  mediamtx:\n    image: %s\n' "$GATEWAY_PIN"
    cat <<'ICE'
    environment:
      MTX_WEBRTCADDITIONALHOSTS: ${MEDIA_ICE_HOSTS:-${MEDIA_PUBLIC_HOST:-}}
      MTX_WEBRTCLOCALUDPADDRESS: :${MEDIA_ICE_PORT:-20006}
      MTX_WEBRTCLOCALTCPADDRESS: :${MEDIA_ICE_PORT:-20006}
ICE
  } > "$STAGE/compose.override.yaml"
  say "构建提交：$revision"
}
backup_config() {
  BACKUP="$INSTALL_DIR/backups/$(date +%Y%m%d-%H%M%S)-$$"
  mkdir -p "$BACKUP/deploy"
  for file in .env .install-state compose.yaml compose.override.yaml; do cp "$INSTALL_DIR/$file" "$BACKUP/$file"; done
  cp "$INSTALL_DIR/deploy/mediamtx.yml" "$BACKUP/deploy/mediamtx.yml"
  if [ -f "$INSTALL_DIR/manage.sh" ]; then cp "$INSTALL_DIR/manage.sh" "$BACKUP/manage.sh"; fi
}
backup_data() {
  docker volume inspect "$VOLUME" >/dev/null || fail "数据卷不存在，已停止备份；不会创建空卷替代现有数据。"
  local old_image
  old_image=$(awk '/^  resolver:/{getline;sub(/^    image: /,"");print;exit}' "$INSTALL_DIR/compose.override.yaml")
  [ -n "$old_image" ] || fail "无法识别现有应用镜像。"
  # Archive through stdout: works with remote daemons; host user owns the backup.
  docker run --rm --network none --read-only --user 0 \
    -v "$VOLUME:/data:ro" --entrypoint tar "$old_image" -czf - -C /data . > "$BACKUP/data.tar.gz.tmp"
  mv "$BACKUP/data.tar.gz.tmp" "$BACKUP/data.tar.gz"
  say "配置和赛事数据已备份：$BACKUP"
}

check_install_ports() {
  # Bind through the actual Docker daemon, including remote daemons and UDP.
  # The probe has no data mounts and never starts the application.
  local -a mappings=(-p "$BIND_ADDRESS:$APP_PORT:9080/tcp")
  local offset protocol port
  if [ "$MEDIA" = 1 ]; then
    for offset in 0 1 2 3 4 5; do
      port=$((MEDIA_PORT_BASE + offset))
      protocol=tcp
      if [ "$offset" = 2 ]; then protocol=udp; fi
      mappings+=(-p "$BIND_ADDRESS:$port:$port/$protocol")
    done
    mappings+=(-p "$BIND_ADDRESS:$((MEDIA_PORT_BASE + 5)):$((MEDIA_PORT_BASE + 5))/udp")
  fi
  say "检查网页与媒体端口是否可用……"
  PORT_PROBE=$(docker create --name "$PROJECT-port-check-$$" --network bridge --no-healthcheck \
    "${mappings[@]}" --entrypoint node "$APP_PIN" -e 'setTimeout(() => {}, 60000)')
  if ! docker start "$PORT_PROBE" > /dev/null 2> "$STAGE/ports.log"; then
    cat "$STAGE/ports.log" >&2
    fail "端口检查未通过，尚未创建赛事数据或启动服务。请用 --port 或 --media-port-base 调整端口后重试；现有服务未变更。"
  fi
  docker rm -f "$PORT_PROBE" >/dev/null
  PORT_PROBE=
}

migrate_network_config() {
  # Exact legacy template expressions only; keep custom ports and proxy URLs.
  # shellcheck disable=SC2016
  sed \
    -e 's|RESOLVER_ADMIN_KEY: ${RESOLVER_ADMIN_KEY:?请设置管理员密钥}|RESOLVER_ADMIN_KEY: ${RESOLVER_ADMIN_KEY:-}|' \
    -e 's|MEDIA_PUBLIC_HOST: ${MEDIA_PUBLIC_HOST:?请填写服务器地址}|MEDIA_PUBLIC_HOST: ${MEDIA_PUBLIC_HOST:-}|' \
    -e 's|MEDIA_BROWSER_BASE: http://${MEDIA_PUBLIC_HOST}:8889|MEDIA_BROWSER_BASE: ${MEDIA_BROWSER_BASE:-}|' \
    -e 's|MEDIA_HLS_BASE: http://${MEDIA_PUBLIC_HOST}:8888|MEDIA_HLS_BASE: ${MEDIA_HLS_BASE:-}|' \
    -e 's|${RESOLVER_PORT:-4173}:4173|${RESOLVER_PORT:-9080}:9080|' \
    -e 's|^      PORT: 4173$|      PORT: 9080|' \
    -e 's|MEDIA_WORKER_URL: http://media-worker:8091|MEDIA_WORKER_URL: http://media-worker:20007|' \
    -e 's|:8554:8554"|:${MEDIA_RTSP_PORT:-20001}:20001"|' \
    -e 's|:1935:1935"|:${MEDIA_RTMP_PORT:-20002}:20002"|' \
    -e 's|:8890:8890/udp"|:${MEDIA_SRT_PORT:-20003}:20003/udp"|' \
    -e 's|:8888:8888"|:${MEDIA_HLS_PORT:-20004}:20004"|' \
    -e 's|:8889:8889"|:${MEDIA_WEBRTC_PORT:-20005}:20005"|' \
    -e 's|:8189:8189/|:${MEDIA_ICE_PORT:-20006}:${MEDIA_ICE_PORT:-20006}/|' \
    "$INSTALL_DIR/compose.yaml" > "$STAGE/compose.yaml"
  sed 's/^RESOLVER_PORT=4173$/RESOLVER_PORT=9080/' "$INSTALL_DIR/.env" > "$STAGE/env"
  awk '
    { lines[++count]=$0; split($0, field, ":"); present[field[1]]=1 }
    END {
      for(i=1;i<=count;i++) {
        line=lines[i]
        if(line=="rtspTransports: [tcp]" && !present["rtspAddress"]) print "rtspAddress: :20001"
        sub(/^authHTTPAddress: http:\/\/resolver:4173\//,"authHTTPAddress: http://resolver:9080/",line)
        sub(/^apiAddress: :9997$/,"apiAddress: :20008",line)
        sub(/^rtspAddress: :8554$/,"rtspAddress: :20001",line)
        sub(/^rtmpAddress: :1935$/,"rtmpAddress: :20002",line)
        sub(/^srtAddress: :8890$/,"srtAddress: :20003",line)
        sub(/^hlsAddress: :8888$/,"hlsAddress: :20004",line)
        sub(/^webrtcAddress: :8889$/,"webrtcAddress: :20005",line)
        sub(/^webrtcLocalUDPAddress: :8189$/,"webrtcLocalUDPAddress: :20006",line)
        sub(/^webrtcLocalTCPAddress: :8189$/,"webrtcLocalTCPAddress: :20006",line)
        print line
        if(line=="rtmp: yes" && !present["rtmpAddress"]) print "rtmpAddress: :20002"
        if(line=="srt: yes" && !present["srtAddress"]) print "srtAddress: :20003"
        if(line=="hls: yes" && !present["hlsAddress"]) print "hlsAddress: :20004"
        if(line=="webrtc: yes" && !present["webrtcAddress"]) print "webrtcAddress: :20005"
      }
    }' "$INSTALL_DIR/deploy/mediamtx.yml" > "$STAGE/mediamtx.yml"
}

if [ "$COMMAND" = install ]; then
  CHANNEL=${CHANNEL:-main}
  PROJECT=${PROJECT:-resolver-$(random_key | cut -c1-8)}
  [[ $PROJECT =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail "项目名仅支持小写字母、数字、连字符和下划线。"
  VOLUME="$PROJECT-resolver-data"
  [ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")" ] || fail "项目名已被其他容器使用，请换一个 --project。"
  if docker volume inspect "$VOLUME" >/dev/null 2>&1; then fail "数据卷 $VOLUME 已存在，请使用原安装目录更新，或选择新的项目名。"; fi
  if [ "$PUBLIC_HOST" = 0.0.0.0 ]; then PUBLIC_HOST=; fi
  if [ -n "$PUBLIC_HOST" ]; then valid_host "$PUBLIC_HOST" || fail "--host 请填写有效的 IPv4 地址或域名（不带协议和端口）。"; fi
  valid_ipv4 "$BIND_ADDRESS" || fail "--bind 请填写有效的 IPv4 监听地址。"
  if [ "$MEDIA" = 1 ]; then
    for offset in 0 1 3 4 5; do
      [ "$APP_PORT" -ne "$((MEDIA_PORT_BASE + offset))" ] || fail "网页端口与媒体 TCP 端口重复，请调整 --port 或 --media-port-base。"
    done
  fi
  prepare_images
  check_install_ports
  mkdir -p "$INSTALL_DIR/deploy"
  cat > "$INSTALL_DIR/.env" <<ENV
COMPOSE_PROJECT_NAME=$PROJECT
COMPOSE_PROFILES=$(if [ "$MEDIA" = 1 ]; then printf media; fi)
RESOLVER_ADMIN_KEY=$(random_key)
MEDIA_INTERNAL_KEY=$(random_key)
MEDIA_PUBLIC_HOST=$PUBLIC_HOST
RESOLVER_BIND_ADDRESS=$BIND_ADDRESS
RESOLVER_PORT=$APP_PORT
MEDIA_BIND_ADDRESS=$BIND_ADDRESS
RESOLVER_NETWORK_POLICY=open
RESOLVER_TRUST_PROXY=true
RESOLVER_ALLOWED_ORIGINS=
RESOLVER_SECURITY_HEADERS=false
MEDIA_BROWSER_BASE=
MEDIA_HLS_BASE=
MEDIA_ICE_HOSTS=
MEDIA_RTSP_PORT=$MEDIA_PORT_BASE
MEDIA_RTMP_PORT=$((MEDIA_PORT_BASE + 1))
MEDIA_SRT_PORT=$((MEDIA_PORT_BASE + 2))
MEDIA_HLS_PORT=$((MEDIA_PORT_BASE + 3))
MEDIA_WEBRTC_PORT=$((MEDIA_PORT_BASE + 4))
MEDIA_ICE_PORT=$((MEDIA_PORT_BASE + 5))
ENV
  cat > "$INSTALL_DIR/compose.yaml" <<'COMPOSE'
services:
  resolver:
    image: ghcr.io/albert-li-sz/resolver-web:main
    restart: unless-stopped
    ports:
      - "${RESOLVER_BIND_ADDRESS:-0.0.0.0}:${RESOLVER_PORT:-9080}:9080"
    environment:
      HOST: 0.0.0.0
      PORT: 9080
      RESOLVER_ADMIN_KEY: ${RESOLVER_ADMIN_KEY:-}
      RESOLVER_NETWORK_POLICY: ${RESOLVER_NETWORK_POLICY:-open}
      RESOLVER_TRUST_PROXY: ${RESOLVER_TRUST_PROXY:-true}
      RESOLVER_ALLOWED_ORIGINS: ${RESOLVER_ALLOWED_ORIGINS:-}
      RESOLVER_SECURITY_HEADERS: ${RESOLVER_SECURITY_HEADERS:-false}
      RESOLVER_DATA_DIR: /app/data
      MEDIA_INTERNAL_KEY: ${MEDIA_INTERNAL_KEY:?请设置媒体内部密钥}
      MEDIA_WORKER_URL: http://media-worker:20007
      MEDIA_PUBLIC_HOST: ${MEDIA_PUBLIC_HOST:-}
      MEDIA_BROWSER_BASE: ${MEDIA_BROWSER_BASE:-}
      MEDIA_HLS_BASE: ${MEDIA_HLS_BASE:-}
    volumes:
      - resolver-data:/app/data
    security_opt: [no-new-privileges:true]
    logging: {driver: json-file, options: {max-size: 10m, max-file: "3"}}
  mediamtx:
    profiles: [media]
    image: bluenviron/mediamtx:1.21.3
    restart: unless-stopped
    environment:
      MTX_WEBRTCADDITIONALHOSTS: ${MEDIA_ICE_HOSTS:-${MEDIA_PUBLIC_HOST:-}}
    volumes:
      - ./deploy/mediamtx.yml:/mediamtx.yml:ro
    ports:
      - "${MEDIA_BIND_ADDRESS:-0.0.0.0}:${MEDIA_RTSP_PORT:-20001}:20001"
      - "${MEDIA_BIND_ADDRESS:-0.0.0.0}:${MEDIA_RTMP_PORT:-20002}:20002"
      - "${MEDIA_BIND_ADDRESS:-0.0.0.0}:${MEDIA_SRT_PORT:-20003}:20003/udp"
      - "${MEDIA_BIND_ADDRESS:-0.0.0.0}:${MEDIA_HLS_PORT:-20004}:20004"
      - "${MEDIA_BIND_ADDRESS:-0.0.0.0}:${MEDIA_WEBRTC_PORT:-20005}:20005"
      - "${MEDIA_BIND_ADDRESS:-0.0.0.0}:${MEDIA_ICE_PORT:-20006}:${MEDIA_ICE_PORT:-20006}/udp"
      - "${MEDIA_BIND_ADDRESS:-0.0.0.0}:${MEDIA_ICE_PORT:-20006}:${MEDIA_ICE_PORT:-20006}/tcp"
    security_opt: [no-new-privileges:true]
  media-worker:
    profiles: [media]
    image: ghcr.io/albert-li-sz/resolver-web-media-worker:main
    restart: unless-stopped
    environment:
      MEDIA_INTERNAL_KEY: ${MEDIA_INTERNAL_KEY}
      MEDIA_MTX_HOST: mediamtx
      RESOLVER_NETWORK_POLICY: ${RESOLVER_NETWORK_POLICY:-open}
    security_opt: [no-new-privileges:true]
volumes:
  resolver-data:
COMPOSE
  printf '    name: %s\n    external: true\n' "$VOLUME" >> "$INSTALL_DIR/compose.yaml"
  cat > "$INSTALL_DIR/deploy/mediamtx.yml" <<'GATEWAY'
logLevel: warn
authMethod: http
authHTTPAddress: http://resolver:9080/internal/media/auth
authHTTPExclude: []
api: yes
apiAddress: :20008
rtspAddress: :20001
rtspTransports: [tcp]
rtmp: yes
rtmpAddress: :20002
srt: yes
srtAddress: :20003
hls: yes
hlsAddress: :20004
hlsVariant: lowLatency
hlsAlwaysRemux: no
hlsAllowOrigins: ['*']
webrtc: yes
webrtcAddress: :20005
webrtcAllowOrigins: ['*']
webrtcLocalUDPAddress: :20006
webrtcLocalTCPAddress: :20006
paths:
  all_others:
GATEWAY
  mv "$STAGE/compose.override.yaml" "$INSTALL_DIR/compose.override.yaml"
  compose config --quiet
  docker volume create "$VOLUME" >/dev/null
  write_state
  save_manager
  INSTALL_STARTED=1
  compose up -d --no-build --pull never --wait --wait-timeout "$WAIT_SECONDS"
  INSTALL_STARTED=0
  say "安装完成：监听 ${BIND_ADDRESS}:${APP_PORT}，可通过本机 IP 或域名访问。"
  say "本机访问：http://127.0.0.1:$APP_PORT/"
  say "管理员：admin；密码保存在 $INSTALL_DIR/.env 的 RESOLVER_ADMIN_KEY。"
  say "更新：bash \"$INSTALL_DIR/manage.sh\" update"
  say "卸载：bash \"$INSTALL_DIR/uninstall.sh\"（默认保留赛事数据）"
elif [ "$COMMAND" = update ]; then
  prepare_images
  backup_config
  migrate_network_config
  INSTALLER_BASE_OVERRIDE="$STAGE/compose.yaml" INSTALLER_IMAGES_OVERRIDE="$STAGE/compose.override.yaml" INSTALLER_ENV_OVERRIDE="$STAGE/env" compose config --quiet
  RECOVER=1
  APPLIED=1
  compose stop resolver
  backup_data
  mv "$STAGE/compose.yaml" "$INSTALL_DIR/compose.yaml"
  mv "$STAGE/env" "$INSTALL_DIR/.env"
  mv "$STAGE/mediamtx.yml" "$INSTALL_DIR/deploy/mediamtx.yml"
  mv "$STAGE/compose.override.yaml" "$INSTALL_DIR/compose.override.yaml"
  compose up -d --force-recreate --no-build --pull never --wait --wait-timeout "$WAIT_SECONDS"
  write_state
  save_manager
  RECOVER=0
  say "更新完成；旧默认端口已迁移，管理员密码、项目名和数据卷已保留。"
  say "网页端口：$(field "$INSTALL_DIR/.env" RESOLVER_PORT)；请同步调整反向代理或访问地址。"
elif [ "$COMMAND" = backup ]; then
  backup_config
  if [ -n "$(compose ps -q --status running resolver)" ]; then RECOVER=1; fi
  compose stop resolver
  backup_data
  if [ "$RECOVER" = 1 ]; then
    compose up -d --no-build --pull never --wait --wait-timeout "$WAIT_SECONDS"
    RECOVER=0
  fi
elif [ "$COMMAND" = start ]; then
  compose up -d --no-build --pull never --wait --wait-timeout "$WAIT_SECONDS"
elif [ "$COMMAND" = stop ]; then
  compose stop
  say "服务已停止，数据和配置保留。"
elif [ "$COMMAND" = uninstall ]; then
  [ "$VOLUME" = "$PROJECT-resolver-data" ] || fail "数据卷与安装项目不匹配，拒绝卸载。"
  if [ "$CONFIRM" != 1 ]; then
    [ -t 0 ] || fail "卸载须交互确认，或显式指定 --yes。"
    printf '卸载项目 %s 的容器和网络，保留数据与配置？[y/N] ' "$PROJECT"
    read -r answer
    if [[ $answer != y && $answer != Y ]]; then say "已取消。"; exit 0; fi
  fi
  compose down
  if [ "$PURGE_DATA" = 1 ]; then
    if docker volume inspect "$VOLUME" >/dev/null 2>&1; then docker volume rm "$VOLUME" >/dev/null; fi
    say "已卸载并删除本项目赛事数据卷：${VOLUME}。配置和备份仍保留在 ${INSTALL_DIR}；镜像未删除。"
  else
    say "已卸载容器和网络；赛事数据、配置、备份和镜像已保留。恢复使用：bash \"$INSTALL_DIR/manage.sh\" start"
  fi
fi
