#!/bin/bash

# ─── Configuración ───
set -e  # Detener script en caso de error
source ./utils.sh
source ./pkglist.sh

# ─── Verificar/Instalar paru ───
if ! is_installed paru; then
    echo "Instalando paru (AUR helper)..."
    sudo pacman -S --needed --noconfirm base-devel git
    git clone https://aur.archlinux.org/paru.git /tmp/paru
    (cd /tmp/paru && makepkg -si --noconfirm)
    rm -rf /tmp/paru
fi

# ─── Instalar grupos de paquetes ───
echo "Instalando paquetes del sistema..."
install_packages "${BASE_SYSTEM[@]}"
install_packages "${INTERFACE_HYPRLAND[@]}"
install_packages "${AUDIO[@]}"
install_packages "${TERMINAL_CLI[@]}"
install_packages "${UTILITIES[@]}"
install_packages "${SDDM_THEMES[@]}"
install_packages "${FONTS_THEMES[@]}"
install_packages "${APPS[@]}"
install_packages "${DEV[@]}"

# ─── Habilitar servicios ───
echo "Habilitando servicios..."
enable_service sddm
enable_service iwd

echo "¡Instalación completada!"
