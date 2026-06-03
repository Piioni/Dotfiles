-- Session startup hooks for shell services, clipboard sync, and environment export.
hl.on("hyprland.start", function()
  -- Start the shell UI, then sync clipboard history and user-session env.
  hl.exec_cmd("caelestia shell -d")
  hl.exec_cmd("wl-paste --type text --watch cliphist store")
  hl.exec_cmd("wl-paste --type image --watch cliphist store")
  hl.exec_cmd("dbus-update-activation-environment --systemd WAYLAND_DISPLAY XDG_CURRENT_DESKTOP")
  hl.exec_cmd("dbus-update-activation-environment --systemd --all")
  hl.exec_cmd("systemctl --user import-environment WAYLAND_DISPLAY XDG_CURRENT_DESKTOP")
  hl.exec_cmd("gnome-keyring-daemon --start --components=secrets")
end)
