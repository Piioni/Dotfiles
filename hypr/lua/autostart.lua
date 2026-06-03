-- Session startup hooks for shell services, clipboard sync, and environment export.
hl.on("hyprland.start", function()
  -- Set Qt platform theme so all Qt apps (Caelestia included) inherit consistent styling.
  hl.exec_cmd("systemctl --user set-environment QT_QPA_PLATFORMTHEME=qt6ct")
  hl.exec_cmd("QT_QPA_PLATFORMTHEME=qt6ct ")
  hl.exec_cmd("caelestia shell -d")
  hl.exec_cmd("wl-paste --type text --watch cliphist store")
  hl.exec_cmd("wl-paste --type image --watch cliphist store")
  hl.exec_cmd("dbus-update-activation-environment --systemd WAYLAND_DISPLAY XDG_CURRENT_DESKTOP QT_QPA_PLATFORMTHEME")
  hl.exec_cmd("dbus-update-activation-environment --systemd --all")
  hl.exec_cmd("systemctl --user import-environment WAYLAND_DISPLAY XDG_CURRENT_DESKTOP QT_QPA_PLATFORMTHEME")
  hl.exec_cmd("gnome-keyring-daemon --start --components=secrets")
end)
