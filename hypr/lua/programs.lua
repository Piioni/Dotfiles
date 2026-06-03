-- Programs.lua

local programs = {
  terminal = "kitty",
  fileManager = "thunar",
  browser = "helium",
  editor = "code",

  deskScripts = os.getenv("HOME") .. "/.config/hypr/scripts",
  rofiScripts = os.getenv("HOME") .. "/.config/rofi/bin",
}

return programs
