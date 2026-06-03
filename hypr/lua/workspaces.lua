
-- Workspace-to-monitor policy: pin 1-4 to HDMI and reserve 5-6 for the laptop panel.

-- default + persistent keeps empty workspaces alive across restarts.
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
