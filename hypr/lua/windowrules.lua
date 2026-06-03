-- Per-app and special-case window behavior rules.
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
  name = "float-thunar",
  match = { class = "^(thunar)$" },
  float = true,
})

hl.window_rule({
  name = "float-pwvucontrol",
  match = { class = "^(com\\.saivert\\.pwvucontrol)$" },
  float = true,
})

hl.window_rule({
  name = "float-iwgtk",
  match = { class = "^(org\\.twosheds\\.iwgtk)$" },
  float = true,
})

hl.window_rule({
  name = "opacity-emacs",
  match = { class = "^(emacs)$" },
  opacity = "1.0 0.7",
})

hl.window_rule({
  name = "opacity-thunar",
  match = { class = "^(thunar)$" },
  opacity = "0.9 0.7",
})

hl.window_rule({
  name = "opacity-nwg-look",
  match = { class = "^(nwg-look)$" },
  opacity = "0.9 0.7",
})

hl.window_rule({
  name = "opacity-spotify",
  match = { class = "^(spotify)$" },
  opacity = "0.8 0.8",
})

hl.window_rule({
  name = "opacity-vesktop",
  match = { class = "^(vesktop)$" },
  opacity = "1.0 0.9",
})

hl.window_rule({
  name = "opacity-kitty",
  match = { class = "^(kitty)$" },
  opacity = "1.0 0.9",
})

hl.window_rule({
  name = "opacity-firefox",
  match = { class = "^(firefox)$" },
  opacity = "1.0 0.9",
})

hl.window_rule({
  name = "size-thunar",
  match = { class = "^(thunar)$" },
  size = { 826, 800 },
})

hl.window_rule({
  name = "size-move-iwgtk",
  match = { class = "^(org\\.twosheds\\.iwgtk)$" },
  size = { 826, 800 },
  move = { "100%-826", 50 },
})

hl.window_rule({
  name = "size-move-pwvucontrol",
  match = { class = "^(com\\.saivert\\.pwvucontrol)$" },
  size = { 900, 800 },
  move = { "100%-900", 50 },
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
