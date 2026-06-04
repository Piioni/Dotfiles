-- Session startup hooks for shell services, clipboard sync, and environment export.
hl.on("hyprland.start", function()
  hl.exec_cmd("caelestia shell -d")
  hl.exec_cmd("wl-paste --type text --watch cliphist store")
  hl.exec_cmd("wl-paste --type image --watch cliphist store")
  hl.exec_cmd("gnome-keyring-daemon --start --components=secrets")
end)
