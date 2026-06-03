-- Core keyboard and touchpad behavior preferences.
hl.config({
  input = {
    kb_layout = "us",
    repeat_rate = 50,
    repeat_delay = 300,
    sensitivity = 0.5,
    accel_profile = "flat",
    numlock_by_default = true,
    left_handed = false,
    -- Focus follows the pointer; this feels faster but can surprise on hover.
    follow_mouse = true,
    -- Keep floating windows focused when switching via keybinds.
    float_switch_override_focus = false,
    touchpad = {
      -- Tapping is on, but drag lock is off to avoid sticky drags.
      disable_while_typing = true,
      natural_scroll = true,
      clickfinger_behavior = false,
      middle_button_emulation = true,
      tap_to_click = true,
      drag_lock = false,
    },
  },
})
