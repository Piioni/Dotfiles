fish_add_path -g ~/.opencode/bin
fish_add_path -g ~/.local/bin
fish_add_path -g ~/.local/share/pnpm/bin
fish_add_path -g ~/.bun/bin
fish_add_path -g /var/lib/flatpak/exports/bin

if test -f "$HOME/.cargo/env.fish"
    source "$HOME/.cargo/env.fish"
end
