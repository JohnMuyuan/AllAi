#!/usr/bin/env bash
# AllAi 远程控制中继 —— 服务器端部署脚本。
# 一般不用手动跑：电脑上的 scripts/relay-push.ps1 会把它连同中继一起传上来并调用。
# 手动用法（在这个目录里）：
#   bash deploy.sh up        首次部署 / 更新（口令第一次自动生成，以后一直沿用）
#   bash deploy.sh status    容器状态 + 健康检查
#   bash deploy.sh logs      看日志
#   bash deploy.sh token     显示口令（电脑上 AllAi 要填它）
#   bash deploy.sh restart   重启
#   bash deploy.sh down      停止
# 端口：环境变量 RELAY_PORT（默认 30778），写进 .env 后以后都沿用。
set -euo pipefail
cd "$(dirname "$0")"

DEFAULT_PORT=30778
NEW_TOKEN=0

die() { echo "错误：$1" >&2; exit 1; }
info() { echo ""; echo "==> $1"; }

COMPOSE=()
need_docker() {
  command -v docker >/dev/null 2>&1 || die "没找到 docker。1Panel 装好后一般自带；或者看 https://docs.docker.com/engine/install/"
  if docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE=(docker-compose)
  else
    die "需要 Docker Compose（docker compose）。"
  fi
}

random_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
  else
    head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

# 在 .env 里设置 KEY=VALUE（有就改，没有就加）
set_kv() {
  local key="$1" value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    echo "${key}=${value}" >> .env
  fi
}

get_kv() {
  grep "^$1=" .env 2>/dev/null | tail -n 1 | cut -d= -f2- || true
}

ensure_env() {
  [[ -f .env ]] || touch .env
  chmod 600 .env
  local token
  token="$(get_kv RELAY_TOKEN)"
  if [[ ${#token} -lt 16 ]]; then
    set_kv RELAY_TOKEN "$(random_token)"
    NEW_TOKEN=1
  fi
  # 从电脑上传过来的端口优先；没传就沿用 .env 里的；都没有用默认值
  if [[ -n "${RELAY_PORT:-}" ]]; then
    set_kv RELAY_PORT "$RELAY_PORT"
  elif [[ -z "$(get_kv RELAY_PORT)" ]]; then
    set_kv RELAY_PORT "$DEFAULT_PORT"
  fi
  [[ -n "$(get_kv RELAY_BIND)" ]] || set_kv RELAY_BIND 127.0.0.1
  PORT="$(get_kv RELAY_PORT)"
  BIND="$(get_kv RELAY_BIND)"
  [[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT > 0 && PORT < 65536 )) || die "RELAY_PORT 不是有效端口：$PORT"
}

port_busy_by_others() {
  local mine
  mine="$(docker ps -q --filter name=^allai-relay$ 2>/dev/null || true)"
  [[ -n "$mine" ]] && return 1
  if command -v ss >/dev/null 2>&1; then
    ss -ltnH "sport = :$PORT" 2>/dev/null | grep -q .
  else
    return 1
  fi
}

http_ok() {
  local url="http://127.0.0.1:$PORT/healthz"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 3 "$url" >/dev/null 2>&1
  else
    wget -qO- -T 3 "$url" >/dev/null 2>&1
  fi
}

wait_health() {
  info "等待中继就绪"
  local i
  for i in $(seq 1 30); do
    if http_ok; then
      echo "健康检查通过。"
      return 0
    fi
    sleep 1
  done
  "${COMPOSE[@]}" logs --tail=30 || true
  die "30 秒内没起来，上面是最近的日志。"
}

cmd_up() {
  need_docker
  [[ -f dist/server.cjs ]] || die "缺少 dist/server.cjs。应该由电脑上的 relay-push.ps1 先打包上传。"
  ensure_env
  if port_busy_by_others; then
    die "端口 $PORT 已经被别的程序占用了。换一个：在电脑的 scripts/relay-deploy.env 里改 RELAY_PORT。"
  fi
  info "构建并启动中继（端口 $BIND:$PORT）"
  "${COMPOSE[@]}" up -d --build --remove-orphans
  wait_health
  # 旧镜像留着占空间，顺手清一下没人用的
  docker image prune -f >/dev/null 2>&1 || true

  echo ""
  echo "================================================================"
  echo " 中继已运行：$BIND:$PORT"
  echo ""
  echo " 1Panel 反向代理的「代理地址」填： http://127.0.0.1:$PORT"
  echo " （记得开 HTTPS，并确认反代配置里有 WebSocket 的 Upgrade 那几行）"
  echo ""
  if [[ "$NEW_TOKEN" == "1" ]]; then
    echo " 这是第一次部署，已生成中继口令："
  else
    echo " 中继口令（沿用之前的）："
  fi
  echo ""
  echo "   $(get_kv RELAY_TOKEN)"
  echo ""
  echo " 电脑上 AllAi「设置 → 远程」的「中继口令」填这一串。"
  echo "================================================================"
}

cmd_status() {
  need_docker
  ensure_env
  "${COMPOSE[@]}" ps
  if http_ok; then echo "健康检查：ok（127.0.0.1:$PORT）"; else echo "健康检查：失败（127.0.0.1:$PORT）"; fi
}

cmd_logs() {
  need_docker
  "${COMPOSE[@]}" logs -f --tail=100
}

cmd_token() {
  [[ -f .env ]] || die "还没部署过。"
  get_kv RELAY_TOKEN
}

cmd_restart() {
  need_docker
  "${COMPOSE[@]}" restart
}

cmd_down() {
  need_docker
  "${COMPOSE[@]}" down
}

case "${1:-}" in
  up) cmd_up ;;
  status) cmd_status ;;
  logs) cmd_logs ;;
  token) cmd_token ;;
  restart) cmd_restart ;;
  down) cmd_down ;;
  *)
    sed -n '2,12p' "$0"
    exit 1
    ;;
esac
