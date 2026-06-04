-- Active swayimg config for current releases.
-- The legacy ~/.config/swayimg/config file is kept for reference, but swayimg
-- now reads init.lua.

swayimg.set_mode("viewer")
swayimg.enable_overlay(false)
swayimg.enable_decoration(false)

swayimg.viewer.set_default_scale("optimal")
swayimg.viewer.set_default_position("center")
swayimg.viewer.enable_centering(true)

-- Use an opaque background so Hyprland doesn't show windows behind while the
-- image viewer repaints during resize.
swayimg.viewer.set_window_background(0xff1e1e2e)
swayimg.viewer.set_image_background(0xff1e1e2e)

-- Re-apply a stable fit whenever the window is resized.
swayimg.on_window_resize(function()
  swayimg.viewer.set_fix_scale("optimal")
end)
