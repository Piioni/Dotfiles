#!/usr/bin/env bash

set -euo pipefail

if command -v uwsm >/dev/null 2>&1 && [[ -n "${UWSM_APP_UNIT:-}${UWSM_SESSION_SLICE:-}${UWSM_FINALIZE_VARNAMES:-}" ]]; then
    exec uwsm stop
fi

if [[ -n "${XDG_SESSION_ID:-}" ]] && command -v loginctl >/dev/null 2>&1; then
    exec loginctl terminate-session "$XDG_SESSION_ID"
fi

if command -v hyprctl >/dev/null 2>&1; then
    exec hyprctl dispatch exit
fi

exit 1
