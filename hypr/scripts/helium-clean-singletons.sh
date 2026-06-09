#!/usr/bin/env bash

set -euo pipefail

notify() {
    if command -v notify-send >/dev/null 2>&1; then
        notify-send "Helium Cleanup" "$1"
    fi
}

helium_running() {
    pgrep -u "$UID" -x helium >/dev/null 2>&1 || pgrep -u "$UID" -x Helium >/dev/null 2>&1
}

config_dir="$HOME/.config/net.imput.helium"
files=(
    "$config_dir/SingletonLock"
    "$config_dir/SingletonSocket"
    "$config_dir/SingletonCookie"
)

if helium_running; then
    notify "Helium is running; skipped singleton cleanup."
    exit 0
fi

removed_count=0

for file in "${files[@]}"; do
    if [[ -e "$file" ]]; then
        rm -f -- "$file"
        ((removed_count += 1))
    fi
done

if (( removed_count > 0 )); then
    notify "Removed ${removed_count} Helium singleton file(s)."
else
    notify "No Helium singleton files needed cleanup."
fi
