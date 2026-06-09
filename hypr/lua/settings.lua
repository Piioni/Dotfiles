-- Baseline compositor policy and behavioral defaults.
hl.config({
  -- Defaults for the master layout when it is enabled.
  master = {
    mfact = 0.62,
    new_status = "slave",
    new_on_top = false,
    new_on_active = "after",
    orientation = "left",
    smart_resizing = true,
    drop_at_cursor = true,
    special_scale_factor = 0.97,
  },

  -- Tiling behavior for the dwindle layout.
  dwindle = {
    preserve_split = true,
    smart_split = false,
    smart_resizing = false,
    special_scale_factor = 0.95,
  },

  -- Global compositor behavior and session policy.
  misc = {
    disable_hyprland_logo = true,
    disable_splash_rendering = true,
    focus_on_activate = false,
    middle_click_paste = false,

    vrr = 1,
    mouse_move_enables_dpms = true,

    -- Only swallow terminal-launched GUI apps from kitty.
    enable_swallow = true,
    swallow_regex = "^(kitty)$",

    -- Keep workspace IDs stable instead of auto-tracking them.
    initial_workspace_tracking = 0,
  },

  binds = {
    workspace_back_and_forth = true,
    allow_workspace_cycles = true,
    pass_mouse_when_bound = false,
  },

  -- Compatibility behavior for XWayland clients.
  xwayland = {
    enabled = true,
    force_zero_scaling = true,
  },

  -- Rendering safeguards.
  render = {
    direct_scanout = 0,
  },
})
