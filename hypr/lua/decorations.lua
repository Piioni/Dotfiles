-- Visual styling for borders, shadows, blur, rounding, and window polish.
hl.config({
  general = {
    gaps_in = 5,
    gaps_out = 8,
    gaps_workspaces = 4,
    border_size = 3,
    col = {
      active_border = "rgb(c6a2f4)",
      inactive_border = "rgb(4c5870)",
    },
    resize_on_border = true,
    allow_tearing = false,
    snap = {
      enabled = true,
    },
    layout = "master",
  },
  decoration = {
    rounding = 20,
    dim_inactive = true,
    dim_strength = 0.14,
    dim_special = 0.25,
    blur = {
      enabled = true,
      size = 10,
      passes = 1,
      new_optimizations = true,
      xray = false,
      noise = 0.01,
      contrast = 1,
      brightness = 1,
      popups_ignorealpha = 0.6,
      input_methods_ignorealpha = 0.8,
    },
    shadow = {
      enabled = true,
      range = 30,
      render_power = 4,
      color = "rgba(00000010)",
      offset = "0 2",
    },
  },
})
