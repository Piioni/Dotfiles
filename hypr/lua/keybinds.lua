local programs = require("lua.programs")

local function layout_bind(bind_table)
  return function()
    local workspace = hl.get_active_special_workspace() or hl.get_active_workspace()
    if not workspace then
      return
    end

    local layout = workspace.tiled_layout
    if bind_table[layout] then
      hl.dispatch(bind_table[layout])
    end
  end
end

local function bind_workspace_keys()
  for i = 1, 9 do
    hl.bind(string.format("SUPER + %d", i), hl.dsp.focus({ workspace = i }))
    hl.bind(string.format("SUPER + SHIFT + %d", i), hl.dsp.window.move({ workspace = i }))
  end

  hl.bind("SUPER + 0", hl.dsp.focus({ workspace = 10 }))
  hl.bind("SUPER + SHIFT + 0", hl.dsp.window.move({ workspace = 10 }))
end

-- Mouse draggin and resizing
hl.bind("SUPER + mouse:272", hl.dsp.window.drag(), { mouse = true })
hl.bind("SUPER + mouse:273", hl.dsp.window.resize(), { mouse = true })

-- Shell binds
hl.bind("SUPER + SPACE", hl.dsp.exec_cmd("caelestia shell drawers toggle launcher"))
hl.bind("SUPER + N", hl.dsp.exec_cmd("caelestia shell drawers toggle sidebar"))
hl.bind("SUPER + C", hl.dsp.exec_cmd("caelestia shell controlCenter open"))
hl.bind("SUPER + D", hl.dsp.exec_cmd("caelestia shell drawers toggle dashboard"))
hl.bind("SUPER + ESCAPE", hl.dsp.exec_cmd("caelestia shell drawers toggle session"))
hl.bind("SUPER + SHIFT + ESCAPE", hl.dsp.exec_cmd("caelestia shell lock lock"))
hl.bind("SUPER + SHIFT + C", hl.dsp.exec_cmd(programs.deskScripts .. "/colorpicker.sh"))
hl.bind("SUPER + SHIFT + V", hl.dsp.exec_cmd("caelestia clipboard"))
hl.bind("SUPER + SHIFT + period", hl.dsp.exec_cmd("caelestia emoji --picker"))


-- Hypr binds
hl.bind("SUPER + S", hl.dsp.workspace.toggle_special("magic"))
hl.bind("SUPER + SHIFT + grave", hl.dsp.window.move({ workspace = "special:magic" }))
hl.bind("SUPER + SHIFT + R", hl.dsp.exec_cmd("hyprctl reload"))

-- Application binds
hl.bind("SUPER + Return", hl.dsp.exec_cmd(programs.terminal))
hl.bind("SUPER + Q", hl.dsp.window.close())
hl.bind("SUPER + B", hl.dsp.exec_cmd(programs.browser))
hl.bind("SUPER + SHIFT + B", hl.dsp.exec_cmd(programs.deskScripts .. "/helium-clean-singletons.sh"))
hl.bind("SUPER + E", hl.dsp.exec_cmd(programs.fileManager))

hl.bind("SUPER + SHIFT + S", hl.dsp.exec_cmd([[grim -g "$(slurp)" - | swappy -f -]]))

-- Window management binds
hl.bind("SUPER + P", hl.dsp.window.pseudo())
hl.bind("SUPER + V", hl.dsp.window.float({ action = "toggle" }))
hl.bind("SUPER + F", hl.dsp.exec_cmd("hyprctl dispatch fullscreen 1"))
hl.bind("SUPER + W", hl.dsp.exec_cmd([[hyprctl eval 'hl.config({ general = { layout = "dwindle" } })']]))
hl.bind("SUPER + SHIFT + W", hl.dsp.exec_cmd([[hyprctl eval 'hl.config({ general = { layout = "master" } })']]))
hl.bind("SUPER + TAB", layout_bind({
  dwindle = hl.dsp.layout("togglesplit"),
  master = hl.dsp.layout("orientationnext"),
}))


bind_workspace_keys()


-- Directional focus and movement for tiling windows. Binds inspired by vim keybinds
hl.bind("SUPER + H", hl.dsp.focus({ direction = "l" }))
hl.bind("SUPER + L", hl.dsp.focus({ direction = "r" }))
hl.bind("SUPER + K", hl.dsp.focus({ direction = "u" }))
hl.bind("SUPER + J", hl.dsp.focus({ direction = "d" }))

hl.bind("SUPER + SHIFT + H", hl.dsp.window.move({ direction = "l" }))
hl.bind("SUPER + SHIFT + L", hl.dsp.window.move({ direction = "r" }))
hl.bind("SUPER + SHIFT + K", hl.dsp.window.move({ direction = "u" }))
hl.bind("SUPER + SHIFT + J", hl.dsp.window.move({ direction = "d" }))


-- Multimedia keys for volume and brightness control using wpctl and brightnessctl
hl.bind("XF86AudioRaiseVolume", hl.dsp.exec_cmd("wpctl set-volume -l 1 @DEFAULT_AUDIO_SINK@ 5%+"))
hl.bind("XF86AudioLowerVolume", hl.dsp.exec_cmd("wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%-"))
hl.bind("XF86AudioMute", hl.dsp.exec_cmd("wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle"))
hl.bind("XF86AudioMicMute", hl.dsp.exec_cmd("wpctl set-mute @DEFAULT_AUDIO_SOURCE@ toggle"))
hl.bind("XF86MonBrightnessUp", hl.dsp.exec_cmd("brightnessctl -e4 -n2 set 5%+"))
hl.bind("XF86MonBrightnessDown", hl.dsp.exec_cmd("brightnessctl -e4 -n2 set 5%-"))
