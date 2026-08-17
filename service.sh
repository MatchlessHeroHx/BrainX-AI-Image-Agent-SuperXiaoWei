#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="${ROOT_DIR}/.service.pid"
LOG_FILE="${ROOT_DIR}/.service.log"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3000}"

cd "$ROOT_DIR"

is_running() {
  [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

require_pnpm() {
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "pnpm is not installed or not in PATH."
    exit 1
  fi
}

start() {
  require_pnpm

  if is_running; then
    echo "Service is already running: pid $(cat "$PID_FILE")"
    echo "URL: http://${HOST}:${PORT}"
    return
  fi

  rm -f "$PID_FILE"
  touch "$LOG_FILE"

  echo "Starting service on http://${HOST}:${PORT} ..."
  {
    echo
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting service on http://${HOST}:${PORT}"
  } >>"$LOG_FILE"
  nohup pnpm exec next dev -H "$HOST" -p "$PORT" </dev/null >>"$LOG_FILE" 2>&1 &
  local pid
  pid="$!"
  echo "$pid" >"$PID_FILE"
  disown "$pid" 2>/dev/null || true

  for _ in {1..40}; do
    if ! is_running; then
      echo "Service failed to start. Recent logs:"
      tail -n 40 "$LOG_FILE"
      rm -f "$PID_FILE"
      exit 1
    fi

    if command -v curl >/dev/null 2>&1 && curl -fsS -o /dev/null "http://${HOST}:${PORT}" 2>/dev/null; then
      echo "Service started: pid $pid"
      echo "URL: http://${HOST}:${PORT}"
      echo "Log: $LOG_FILE"
      return
    fi

    sleep 0.5
  done

  echo "Service started: pid $pid"
  echo "URL: http://${HOST}:${PORT}"
  echo "Log: $LOG_FILE"
  echo "Warning: service did not respond within 20 seconds; check logs with ./service.sh logs"
}

stop() {
  if ! is_running; then
    echo "Service is not running."
    rm -f "$PID_FILE"
    return
  fi

  local pid
  pid="$(cat "$PID_FILE")"
  echo "Stopping service: pid $pid ..."
  kill "$pid" 2>/dev/null || true

  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "Service stopped."
      return
    fi
    sleep 0.2
  done

  echo "Service did not stop in time; killing pid $pid ..."
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "Service stopped."
}

restart() {
  stop
  start
}

status() {
  if is_running; then
    echo "Service is running: pid $(cat "$PID_FILE")"
    echo "URL: http://${HOST}:${PORT}"
    echo "Log: $LOG_FILE"
  else
    echo "Service is not running."
    if [[ -f "$PID_FILE" ]]; then
      rm -f "$PID_FILE"
    fi
  fi
}

logs() {
  touch "$LOG_FILE"
  tail -n "${LINES:-80}" -f "$LOG_FILE"
}

usage() {
  cat <<EOF
Usage: ./service.sh <command>

Commands:
  start     Start the Next.js dev server
  stop      Stop the running service
  restart   Restart the service
  status    Show service status
  logs      Follow service logs

Environment:
  HOST      Bind host, default: 127.0.0.1
  PORT      Bind port, default: 3000
  LINES     Initial log lines for logs command, default: 80
EOF
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) restart ;;
  status) status ;;
  logs) logs ;;
  -h|--help|help) usage ;;
  *)
    usage
    exit 1
    ;;
esac
