#!/bin/sh
# Toggle: first call records a region, second call stops and saves.
if pkill -SIGINT -f '^gpu-screen-recorder'; then
	exit 0
fi

region=$(slurp -f "%wx%h+%x+%y") || exit 0
dir="$HOME/Videos/Recordings"
mkdir -p "$dir"
out="$dir/Recording from $(date '+%Y-%m-%d %H-%M-%S').mp4"

notify-send -a Recorder "Recording started" "Run the shortcut again to stop"
gpu-screen-recorder -w region -region "$region" -f 60 -q high -o "$out" &&
	notify-send -a Recorder "Recording saved" "$out"
