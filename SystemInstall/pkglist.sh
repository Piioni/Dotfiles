#!/bin/bash

# ─── BASE DEL SISTEMA ───
BASE_SYSTEM=(
    base-devel
    git
)

# ─── INTERFAZ/HYPRLAND ───
INTERFACE_HYPRLAND=(
    hyprland xdg-desktop-portal-hyprland
    hypridle hyprlock hyprpicker wlogout
    waybar rofi swaync
    swww
    slurp grim swappy swayimg
    wf-recorder
)

# ─── AUDIO ───
AUDIO=(
    pipewire pipewire-alsa pipewire-jack pipewire-pulse
    wireplumber
    pwvucontrol
    libpulse
)

# ─── TERMINAL/CLI ───
TERMINAL_CLI=(
    kitty
    fish
    zoxide
    starship
    bat eza
    fzf 
    yazi
    lazygit
    btop 
    nvtop
    neovim 
    vim
    fastfetch
)

# ─── UTILIDADES ───
UTILITIES=(
    iwd iwgtk wireless_tools
    thunar thunar-archive-plugin tumbler
    cliphist wl-clipboard
    7zip unzip
    imagemagick ffmpegthumbnailer
    ps_mem
    jq
    zathura
    nwg-look
    xxhash
    man-db
    localsend
    catppuccin-gtk-theme-macchiato
    catppuccin-gtk-theme-mocha
)

# ─── SDDM THEMES ───
SDDM_THEMES=(
    sddm
    qt6-svg qt6-virtualkeyboard qt6-multimedia-ffmpeg
)

# ─── FUENTES/TEMAS ───
FONTS_THEMES=(
    noto-fonts noto-fonts-emoji
    ttf-fira-code ttf-jetbrains-mono-nerd
    ttf-nerd-fonts-symbols
    maplemono-ttf
    catppuccin-gtk-theme-frappe
    rose-pine-hyprcursor
)

# ─── APLICACIONES ───
APPS=(
    celluloid
    zen-browser-bin
    spotify-launcher
    mousepad
)

# ─── DEV ───
DEV=(
    visual-studio-code-bin
    python python-pipenv
    npm
    docker docker-compose
)
