-- Programs.lua

local programs = {
  terminal = "kitty",
  fileManager = "nautilus",
  browser = "helium",
  editor = "code",

  deskScripts = os.getenv("HOME") .. "/.config/hypr/scripts",
}

return programs
