-- Global behavior
-- hl.window_rule({
--   name = "global-suppress-maximize-events",
--   match = { class = ".*" },
--   suppress_event = "maximize",
-- })

-- Focus / annoyance prevention
hl.window_rule({
  -- Ignore empty XWayland floating shells so they do not steal focus.
  name = "global-no-focus-empty-xwayland-floating",
  match = { class = "^$", title = "^$", xwayland = true, float = true, fullscreen = false, pin = false },
  no_focus = true,
})

-- App-specific rules
hl.window_rule({
  name = "app-nwg-look",
  match = { class = "^(nwg-look)$" },
  float = true,
  opacity = "0.9 0.7",
})

hl.window_rule({
  name = "app-pwvucontrol",
  match = { class = "^(com\\.saivert\\.pwvucontrol)$" },
  float = true,
  size = { 920, 760 },
  move = { "100%-920", 50 },
})

hl.window_rule({
  name = "app-kitty-opacity",
  match = { class = "^(kitty)$" },
  opacity = "0.99 0.99",
})

hl.window_rule({
  name = "app-nautilus-floating",
  match = { class = [[^(org\.gnome\.Nautilus)$]] },
  float = true,
  size = { 1100, 720 },
  center = true,
})

-- Special cases
hl.window_rule({
  -- Keep browser PiP on top and parked in the lower-right corner.
  name = "special-browser-pip",
  match = { title = "^(Picture-in-Picture)$" },
  float = true,
  pin = true,
  move = { "72.5%", "70%" },
  size = { 520, 320 },
})
