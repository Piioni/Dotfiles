-- Baseline compositor policy and behavioral defaults.
hl.config({
  dwindle = {
    preserve_split = true,
    smart_split = false,
    smart_resizing = false,
  },
  master = {
    new_status = "master",
    new_on_top = 1,
    mfact = 0.5,
  },
  misc = {
    disable_hyprland_logo = true,
    disable_splash_rendering = true,
    vrr = 2,
    mouse_move_enables_dpms = true,
    -- Only swallow terminal-launched GUI apps from kitty.
    enable_swallow = true,
    swallow_regex = "^(kitty)$",
    -- Prevent random focus jumps when apps activate themselves.
    focus_on_activate = false,
    -- Keep workspace IDs stable instead of auto-tracking them.
    initial_workspace_tracking = 0,
    middle_click_paste = false,
  },
  binds = {
    -- Workspace switching behaves like a ring.
    workspace_back_and_forth = true,
    -- Allow cycling beyond the first/last workspace.
    allow_workspace_cycles = true,
    pass_mouse_when_bound = false,
  },
  xwayland = {
    enabled = true,
    force_zero_scaling = true,
  },
  render = {
    direct_scanout = false,
  },
})
