
local hdmi = "HDMI-A-1"
local edp = "eDP-1"

if hl.get_monitor(hdmi) ~= nil then
  for _, ws in ipairs({ "1", "2", "3", "4" }) do
    hl.workspace_rule({ workspace = ws, monitor = hdmi, default = true, persistent = true })
  end
end

for _, ws in ipairs({ "5", "6" }) do
  hl.workspace_rule({ workspace = ws, monitor = edp, default = true, persistent = true })
end

hl.workspace_rule({
  workspace = "special:magic",
  gaps_in = 1,
  gaps_out = 1,
  border_size = 3,
  animation = "slidevert",
})
