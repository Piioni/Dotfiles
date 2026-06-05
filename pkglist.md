# Package list for this setup

This file lists the important packages and tools used by this setup, organized by usage.
It is curated from the real `.config` files, not from the distro package manager.

## Window manager / session

- `hyprland` — main compositor and window manager.
- `uwsm` — session management around the Hyprland session.
- `hyprland-uwsm` — integration between Hyprland and UWSM.
- `xdg-desktop-portal-hyprland` — portal support expected by the Wayland session.
- `hyprpicker` — color picker used by `hypr/scripts/colorpicker.sh`.
- `brightnessctl` — brightness control from Hyprland keybinds.

## Shell / desktop layer

- `quickshell` — runtime for the shell UI.
- `caelestia` / `caelestia-shell` — launcher, dashboard, lock screen, control center, clipboard, emoji, and shell actions.
- `fuzzel` — launcher-related workflow in this setup.
- `wl-clipboard` — clipboard integration used by Wayland tools.
- `cliphist` — clipboard history integration started on login.

## Terminal / CLI workflow

- `kitty` — default terminal.
- `fish` — interactive shell.
- `neovim` — editor exported in the shell environment.
- `starship` — shell prompt.
- `zoxide` — directory jumping.
- `fzf` — fuzzy finder.
- `bat` — pager / cat replacement in shell helpers.
- `eza` — `ls` replacement in aliases.
- `fastfetch` — shell startup/system info workflow.
- `btop` — terminal system monitor.
- `yazi` — terminal file manager.
- `lazygit` — git TUI.
- `zellij` — terminal multiplexer present in the workflow.

## Core desktop apps

- `nautilus` — default file manager.
- `helium` — default browser.
- `code` — editor in the Hyprland program map.
- `swayimg` — image viewer.
- `mpv` — playback app configured in Caelestia.
- `pavucontrol` — audio control app configured in Caelestia.
- `Zathura` — PDF viewer configured in Caelestia.

## Notifications / secrets / control center

- `swaync` / `swaynotificationcenter` — notification center config exists and is part of the intended setup.
- `libnotify` — provides `notify-send` used by scripts.
- `iwgtk` — quick action from the notification center.

## Screenshots / recording / image utilities

- `grim` — screenshots.
- `slurp` — region selection.
- `swappy` — screenshot annotation/editing.
- `wf-recorder` — recording script dependency.
- `gpu-screen-recorder` — screen recording stack also referenced by the setup.
- `jq` — helper for scripts and JSON processing.

## Audio / media / network

- `pipewire` — media/audio backend.
- `pipewire-pulseaudio` — PulseAudio compatibility layer.
- `wireplumber` — session manager and source of `wpctl`.
- `playerctl` — media control helper.
- `NetworkManager` — network stack behind `nmcli`-based shell services.
- `ddcutil` — external monitor brightness support expected by the shell brightness service.
- `qalc` / `qalculate` — calculator integration for the launcher.

## Theming / fonts / visuals

- `qt6ct` — Qt theming control.
- `kvantum` — Qt theme engine.
- `papirus-icon-theme` — icon theme.
- `Maple Mono NF` — main monospace font used by Kitty and Caelestia.
- `JetBrains Mono Nerd Font` — font used in other tools like Fuzzel/Swayimg.
- `material-symbols-fonts` — icon/font support for shell UI.
- `catppuccin-mocha-dark-cursors` — cursor theme used by the session.

## Notes

- This file is organized by how the setup uses things, not by package source.
- Some names are written as the tool/app you actually think about day to day, even when the underlying package name may differ.
- If something is only incidental or weakly referenced, it is intentionally left out.
