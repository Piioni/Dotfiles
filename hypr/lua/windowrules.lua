hl.window_rule({
  name = "suppress-maximize-events",
  match = { class = ".*" },
  suppress_event = "maximize",
})

hl.window_rule({
  -- Ignore empty XWayland floating shells so they do not steal focus.
  name = "focus-empty-xwayland-floating",
  match = { class = "^$", title = "^$", xwayland = true, float = true, fullscreen = false, pin = false },
  no_focus = true,
})

hl.window_rule({
  name = "float-nwg-look",
  match = { class = "^(nwg-look)$" },
  float = true,
})

hl.window_rule({
  name = "float-pwvucontrol",
  match = { class = "^(com\\.saivert\\.pwvucontrol)$" },
  float = true,
})

hl.window_rule({
  name = "opacity-nwg-look",
  match = { class = "^(nwg-look)$" },
  opacity = "0.9 0.7",
})

hl.window_rule({
  name = "opacity-kitty",
  match = { class = "^(kitty)$" },
  opacity = "0.99 0.99",
})
hl.window_rule({
  name = "size-move-pwvucontrol",
  match = { class = "^(com\\.saivert\\.pwvucontrol)$" },
  size = { 920, 760 },
  move = { "100%-920", 50 },
})

hl.window_rule({
  -- Keep small utility windows away from the main workspace flow.
  name = "float-small-utility-windows",
  match = { class = "^(nwg-look|com\\.saivert\\.pwvucontrol)$" },
  float = true,
})

hl.window_rule({
  name = "float-nautilus",
  match = { class = [[^(org\.gnome\.Nautilus)$]] },
  float = true,
  size = { 1100, 720 },
  center = true,
})

hl.window_rule({
  -- Keep browser PiP on top and parked in the lower-right corner.
  name = "pip-browser",
  match = { title = "^(Picture-in-Picture)$" },
  float = true,
  pin = true,
  move = { "72.5%", "70%" },
  size = { 520, 320 },
})
