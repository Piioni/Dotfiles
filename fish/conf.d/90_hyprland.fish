if test (tty) = "/dev/tty1"
    and not pgrep -x Hyprland > /dev/null
    exec dbus-run-session Hyprland --config "$HOME/.config/hypr/hyprland.lua"
end
