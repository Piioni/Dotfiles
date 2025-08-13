#!/bin/bash

# ─── Colores ───
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ─── Función para verificar root ───
check_root() {
    if [[ $EUID -ne 0 ]]; then
        echo -e "${RED}Error: Este script debe ejecutarse como root${NC}" >&2
        exit 1
    fi
}

# ─── Verificar si un paquete está instalado ───
is_installed() {
    if pacman -Qi "$1" &>/dev/null || pacman -Qg "$1" &>/dev/null; then
        return 0
    else
        return 1
    fi
}

# ─── Instalar paquetes si no están instalados ───
install_packages() {
    local packages=("$@")
    local to_install=()

    for pkg in "${packages[@]}"; do
        if ! is_installed "$pkg"; then
            to_install+=("$pkg")
        else
            echo -e "${GREEN}[✓]${NC} $pkg ya está instalado"
        fi
    done

    if [ ${#to_install[@]} -ne 0 ]; then
        echo -e "${YELLOW}[!]${NC} Instalando: ${to_install[*]}"
        paru -S --needed --noconfirm "${to_install[@]}" || {
            echo -e "${RED}[X] Error al instalar paquetes${NC}"
            return 1
        }
    fi
}

# ─── Habilitar servicio ───
enable_service() {
    local service=$1
    if ! systemctl is-enabled "$service" &>/dev/null; then
        echo -e "${YELLOW}[!]${NC} Habilitando servicio $service"
        systemctl enable "$service" || {
            echo -e "${RED}[X] Error al habilitar $service${NC}"
            return 1
        }
    else
        echo -e "${GREEN}[✓]${NC} Servicio $service ya está habilitado"
    fi
}

# ─── Aplicar dotfiles con Stow ───
apply_dotfiles() {
    echo -e "${YELLOW}[!] Aplicando dotfiles con Stow...${NC}"
    cd ./dotfiles/
    stow --target="$HOME" --restow .  # El punto (.) indica "todo en este directorio"
}

cleanup() {
    echo -e "\n${YELLOW}Instalación interrumpida${NC}"
    exit 1
}
trap cleanup INT TERM