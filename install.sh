#!/bin/bash

# ─── Configuración ───
set -e  # Detener script en caso de error
source ./utils.sh
source ./pkglist.sh

# ─── Verificar root ───
check_root

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

# ─── Configurar SDDM ───
echo "Configurando SDDM..."

# Copiar tema SDDM
if [ -d "./sddm/cool-sddm" ]; then
    sudo cp -r ./sddm/cool-sddm /usr/share/sddm/themes/
    echo "Tema SDDM copiado exitosamente"
else
    echo "⚠️  Advertencia: No se encontró el tema SDDM en ./sddm/cool-sddm"
fi

# Crear directorio de configuración si no existe
if [ ! -d /etc/sddm.conf.d ]; then
    sudo mkdir -p /etc/sddm.conf.d
fi

# Configurar teclado virtual
cat <<EOF | sudo tee /etc/sddm.conf.d/virtualkb.conf
[General]
InputMethod=qtvirtualkeyboard
EOF

# Configurar tema
cat <<EOF | sudo tee /etc/sddm.conf
[Theme]
Current=cool-sddm
EOF

# Verificar que stow esté instalado
if ! is_installed stow; then
    echo "Error: GNU Stow no está instalado"
    sudo pacman -S --needed --noconfirm stow || {
        echo "Error al instalar GNU Stow"
        exit 1
    }
fi

# ─── Aplicar dotfiles mediante STOW ───
apply_dotfiles

echo "¡Instalación completada!"