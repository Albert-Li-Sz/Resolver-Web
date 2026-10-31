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
APP_PORT=4173
BIND_ADDRESS=0.0.0.0
PROJECT=
CHANNEL=
MEDIA=1
ASSUME_YES=0
WAIT_SECONDS=120
LOCKED=0
STAGE=
BACKUP=
RECOVER=0
APPLIED=0
COMPOSE=()
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

选项：
  --dir 路径        安装目录，默认 ./resolver-web；manage.sh 默认所在目录
  --host IP或域名   展示电脑可访问的服务器地址，不含 http:// 或端口
  --port 端口       网页端口，默认 4173
  --bind IP         监听地址，默认 0.0.0.0；本机使用可填 127.0.0.1
  --project 名称    新安装的 Compose 项目名，默认自动生成
  --tag 标签       main、sha-完整提交号或已发布版本；默认 main
  --no-media        新安装时仅启用应用，不启动媒体网关和转码服务
  --yes             使用自动检测的服务器地址，不交互
  --wait-timeout 秒 服务健康检查等待时间，默认 120
  --help            显示帮助

需要已安装且可访问的 Docker、Docker Compose 2.20+（或新版独立 docker-compose）。
脚本不执行 .env、不删除数据卷，也不自动接管其他目录中的手工部署。
HELP
}

if [ $# -gt 0 ] && [[ $1 != -* ]]; then COMMAND=$1; shift; fi
case "$COMMAND" in install|update|status|logs|stop|start|backup) ;; help) usage; exit 0 ;; *) fail "未知命令：$COMMAND" ;; esac
INSTALL_OPTIONS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --yes) ASSUME_YES=1; shift ;;
    --no-media) MEDIA=0; INSTALL_OPTIONS=1; shift ;;
    --dir|--host|--port|--bind|--project|--tag|--wait-timeout)
      if [ $# -lt 2 ] || [ -z "$2" ]; then fail "$1 缺少参数"; fi
      case "$1" in
        --dir) INSTALL_DIR=$2 ;;
        --host) PUBLIC_HOST=$2; INSTALL_OPTIONS=1 ;;
        --port) APP_PORT=$2; INSTALL_OPTIONS=1 ;;
        --bind) BIND_ADDRESS=$2; INSTALL_OPTIONS=1 ;;
        --project) PROJECT=$2; INSTALL_OPTIONS=1 ;;
        --tag) CHANNEL=$2 ;;
        --wait-timeout) WAIT_SECONDS=$2 ;;
      esac
      shift 2 ;;
    *) fail "未知选项：$1" ;;
  esac
done
[ "$COMMAND" = install ] || [ "$INSTALL_OPTIONS" = 0 ] || fail "地址、端口、项目及媒体选项只用于首次安装；后续请编辑安装目录的 .env。"
if ! [[ $WAIT_SECONDS =~ ^[1-9][0-9]*$ ]] || [ "$WAIT_SECONDS" -gt 3600 ]; then fail "等待时间须为 1–3600 秒"; fi
if ! [[ $APP_PORT =~ ^[1-9][0-9]*$ ]] || [ "$APP_PORT" -gt 65535 ]; then fail "端口须为 1–65535"; fi
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
  if [ "$MEDIA" = 1 ]; then export COMPOSE_PROFILES=media; else export COMPOSE_PROFILES=; fi
  "${COMPOSE[@]}" --project-directory "$INSTALL_DIR" -p "$PROJECT" --env-file "$INSTALL_DIR/.env" \
    -f "$INSTALL_DIR/compose.yaml" -f "$INSTALL_DIR/compose.override.yaml" "$@"
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
    [ -f "$INSTALL_DIR/$file" ] || fail "缺少 $file，请从配置备份恢复。"
  done
}
cleanup() {
  local result=$?
  trap - EXIT INT TERM
  set +e
  if [ "$RECOVER" = 1 ]; then
    say "操作未完成，正在恢复更新前的运行配置……"
    if [ "$APPLIED" = 1 ]; then
      cp "$BACKUP/compose.override.yaml" "$INSTALL_DIR/compose.override.yaml"
      cp "$BACKUP/.install-state" "$INSTALL_DIR/.install-state"
    fi
    if compose up -d --no-build --pull never --wait --wait-timeout "$WAIT_SECONDS"; then
      say "原镜像已恢复；赛事数据未被覆盖。备份：$BACKUP"
    else
      say "原镜像恢复未通过健康检查，请查看 logs；配置和数据备份保留在：$BACKUP"
    fi
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
detect_host() {
  local candidate=
  if command -v ip >/dev/null 2>&1; then candidate=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++)if($i=="src"){print $(i+1);exit}}' || true); fi
  if [ -z "$candidate" ] && command -v ipconfig >/dev/null 2>&1; then
    local interface
    interface=$(route -n get default 2>/dev/null | awk '/interface:/{print $2;exit}' || true)
    if [ -n "$interface" ]; then candidate=$(ipconfig getifaddr "$interface" 2>/dev/null || true); fi
  fi
  printf '%s' "$candidate"
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
  WORKER_PIN="$WORKER_IMAGE:$CHANNEL"
  GATEWAY_PIN=$GATEWAY_IMAGE
  if [ "$MEDIA" = 1 ]; then
    WORKER_PIN=$(pull_image "$WORKER_IMAGE:$CHANNEL" "$WORKER_IMAGE")
    worker_revision=$(docker image inspect "$WORKER_PIN" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
    [ "$revision" = "$worker_revision" ] || fail "应用与媒体镜像来自不同提交，请稍后重试；现有服务未变更。"
    GATEWAY_PIN=$(pull_image "$GATEWAY_IMAGE" bluenviron/mediamtx)
  fi
  cat > "$STAGE/compose.override.yaml" <<IMAGES
services:
  resolver:
    image: $APP_PIN
  media-worker:
    image: $WORKER_PIN
  mediamtx:
    image: $GATEWAY_PIN
IMAGES
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

if [ "$COMMAND" = install ]; then
  CHANNEL=${CHANNEL:-main}
  PROJECT=${PROJECT:-resolver-$(random_key | cut -c1-8)}
  [[ $PROJECT =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail "项目名仅支持小写字母、数字、连字符和下划线。"
  VOLUME="$PROJECT-resolver-data"
  [ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")" ] || fail "项目名已被其他容器使用，请换一个 --project。"
  if docker volume inspect "$VOLUME" >/dev/null 2>&1; then fail "数据卷 $VOLUME 已存在，请使用原安装目录更新，或选择新的项目名。"; fi
  if [ -z "$PUBLIC_HOST" ]; then
    PUBLIC_HOST=$(detect_host)
    if [ "$ASSUME_YES" = 0 ] && [ -t 0 ]; then
      printf '展示电脑可访问的服务器 IP 或域名 [%s]：' "$PUBLIC_HOST"
      read -r answer
      PUBLIC_HOST=${answer:-$PUBLIC_HOST}
    fi
  fi
  valid_host "$PUBLIC_HOST" || fail "请通过 --host 指定服务器 IPv4 地址或域名（不带协议和端口）。"
  valid_ipv4 "$BIND_ADDRESS" || fail "--bind 请填写有效的 IPv4 监听地址。"
  prepare_images
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
ENV
  cat > "$INSTALL_DIR/compose.yaml" <<'COMPOSE'
services:
  resolver:
    image: ghcr.io/albert-li-sz/resolver-web:main
    restart: unless-stopped
    ports:
      - "${RESOLVER_BIND_ADDRESS:-0.0.0.0}:${RESOLVER_PORT:-4173}:4173"
    environment:
      HOST: 0.0.0.0
      PORT: 4173
      RESOLVER_ADMIN_KEY: ${RESOLVER_ADMIN_KEY:?请设置管理员密钥}
      RESOLVER_DATA_DIR: /app/data
      MEDIA_INTERNAL_KEY: ${MEDIA_INTERNAL_KEY:?请设置媒体内部密钥}
      MEDIA_WORKER_URL: http://media-worker:8091
      MEDIA_PUBLIC_HOST: ${MEDIA_PUBLIC_HOST:?请填写服务器地址}
      MEDIA_BROWSER_BASE: http://${MEDIA_PUBLIC_HOST}:8889
      MEDIA_HLS_BASE: http://${MEDIA_PUBLIC_HOST}:8888
    volumes:
      - resolver-data:/app/data
    security_opt: [no-new-privileges:true]
    logging: {driver: json-file, options: {max-size: 10m, max-file: "3"}}
  mediamtx:
    profiles: [media]
    image: bluenviron/mediamtx:1.21.3
    restart: unless-stopped
    environment:
      MTX_WEBRTCADDITIONALHOSTS: ${MEDIA_PUBLIC_HOST}
    volumes:
      - ./deploy/mediamtx.yml:/mediamtx.yml:ro
    ports:
      - "${MEDIA_BIND_ADDRESS:-0.0.0.0}:8554:8554"
      - "${MEDIA_BIND_ADDRESS:-0.0.0.0}:1935:1935"
      - "${MEDIA_BIND_ADDRESS:-0.0.0.0}:8890:8890/udp"
      - "${MEDIA_BIND_ADDRESS:-0.0.0.0}:8888:8888"
      - "${MEDIA_BIND_ADDRESS:-0.0.0.0}:8889:8889"
      - "${MEDIA_BIND_ADDRESS:-0.0.0.0}:8189:8189/udp"
      - "${MEDIA_BIND_ADDRESS:-0.0.0.0}:8189:8189/tcp"
    security_opt: [no-new-privileges:true]
  media-worker:
    profiles: [media]
    image: ghcr.io/albert-li-sz/resolver-web-media-worker:main
    restart: unless-stopped
    environment:
      MEDIA_INTERNAL_KEY: ${MEDIA_INTERNAL_KEY}
      MEDIA_MTX_HOST: mediamtx
    security_opt: [no-new-privileges:true]
volumes:
  resolver-data:
COMPOSE
  printf '    name: %s\n    external: true\n' "$VOLUME" >> "$INSTALL_DIR/compose.yaml"
  cat > "$INSTALL_DIR/deploy/mediamtx.yml" <<'GATEWAY'
logLevel: warn
authMethod: http
authHTTPAddress: http://resolver:4173/internal/media/auth
authHTTPExclude: []
api: yes
apiAddress: :9997
rtspTransports: [tcp]
rtmp: yes
srt: yes
hls: yes
hlsVariant: lowLatency
hlsAlwaysRemux: no
hlsAllowOrigins: ['*']
webrtc: yes
webrtcAllowOrigins: ['*']
webrtcLocalUDPAddress: :8189
webrtcLocalTCPAddress: :8189
paths:
  all_others:
GATEWAY
  mv "$STAGE/compose.override.yaml" "$INSTALL_DIR/compose.override.yaml"
  compose config --quiet
  docker volume create "$VOLUME" >/dev/null
  write_state
  save_manager
  compose up -d --no-build --pull never --wait --wait-timeout "$WAIT_SECONDS"
  say "安装完成：http://$PUBLIC_HOST:$APP_PORT/"
  say "管理员：admin；密码保存在 $INSTALL_DIR/.env 的 RESOLVER_ADMIN_KEY。"
  say "更新：bash \"$INSTALL_DIR/manage.sh\" update"
elif [ "$COMMAND" = update ]; then
  compose config --quiet
  prepare_images
  backup_config
  RECOVER=1
  compose stop resolver
  backup_data
  APPLIED=1
  mv "$STAGE/compose.override.yaml" "$INSTALL_DIR/compose.override.yaml"
  compose up -d --no-build --pull never --wait --wait-timeout "$WAIT_SECONDS"
  write_state
  save_manager
  RECOVER=0
  say "更新完成；配置、管理员密码、项目名和数据卷已保留。"
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
fi
