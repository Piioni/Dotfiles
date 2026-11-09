#!/usr/bin/env bash
# Keeps the named workspaces on the right monitor, in order.
# HDMI connected: HDMI owns the first four, the laptop owns the rest.
# Laptop alone: the laptop owns all of them, in the same order.
set -u

HDMI=HDMI-A-1
LAPTOP=eDP-1
HDMI_WS=(browser coding herdr extra)
LAPTOP_WS=(social music)

ws_json() { niri msg --json workspaces; }

place() { # <output> <workspace>...
	local out=$1 i=1 name state
	shift
	for name in "$@"; do
		state=$(ws_json | jq -r --arg n "$name" '.[] | select(.name == $n) | "\(.output) \(.idx)"')
		[ -z "$state" ] && continue
		if [ "${state% *}" != "$out" ]; then
			niri msg action move-workspace-to-monitor --reference "$name" "$out"
			state=$(ws_json | jq -r --arg n "$name" '.[] | select(.name == $n) | "\(.output) \(.idx)"')
		fi
		[ "${state#* }" != "$i" ] && niri msg action move-workspace-to-index --reference "$name" "$i"
		i=$((i + 1))
	done
}

reconcile() {
	if niri msg --json outputs | jq -e --arg h "$HDMI" 'has($h)' >/dev/null; then
		place "$HDMI" "${HDMI_WS[@]}"
		place "$LAPTOP" "${LAPTOP_WS[@]}"
	else
		place "$LAPTOP" "${HDMI_WS[@]}" "${LAPTOP_WS[@]}"
	fi
}

reconcile
# Idempotent: once placed, the events it causes change nothing.
niri msg event-stream | while read -r line; do
	case $line in
	*"Workspaces changed"*) reconcile ;;
	esac
done
