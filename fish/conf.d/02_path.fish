# Clean PATH first
set -e fish_user_paths

# Add common paths
fish_add_path ~/.local/bin
fish_add_path ~/.bun/bin
fish_add_path ~/.spicetify
fish_add_path /var/lib/flatpak/exports/bin