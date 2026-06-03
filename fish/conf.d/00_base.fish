# Environment
set -gx MANPAGER "sh -c 'sed -u -e \"s/\\x1B\[[0-9;]*m//g; s/.\\x08//g\" | bat -p -lman'"
set -gx EDITOR nvim
set -gx TERMINAL kitty
set -gx BROWSER zen-browser

# XDG base directories
set -gx XDG_CONFIG_HOME "$HOME/.config"
set -gx XDG_DATA_HOME "$HOME/.local/share"
set -gx XDG_CACHE_HOME "$HOME/.cache"

# FZF defaults
set -gx FZF_DEFAULT_OPTS "
  --color=bg+:#25394D,bg:-1,spinner:#F5E0DC,hl:#F38BA8
  --color=fg:#CDD6F4,header:#F38BA8,info:#F5E0DC,pointer:#F5E0DC
  --layout=reverse --height=90% --preview-window noborder
"

# PATH
fish_add_path -g ~/.opencode/bin
fish_add_path -g ~/.local/bin
fish_add_path -g ~/.bun/bin
fish_add_path -g ~/.spicetify
fish_add_path -g /var/lib/flatpak/exports/bin

if test -f "$HOME/.local/bin/env.fish"
    source "$HOME/.local/bin/env.fish"
end

if test -f "$HOME/.cargo/env.fish"
    source "$HOME/.cargo/env.fish"
end
