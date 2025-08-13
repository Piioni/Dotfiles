#!/usr/bin/env bash
#  ┏┓┏┓┓ ┏┓┳┓┏┓┳┏┓┓┏┓┏┓┳┓  
#  ┃ ┃┃┃ ┃┃┣┫┃┃┃┃ ┃┫ ┣ ┣┫  
#  ┗┛┗┛┗┛┗┛┛┗┣┛┻┗┛┛┗┛┗┛┛┗  
#                          

# Enhanced Color Picker for Hyprland with History and Waybar Integration
# Dependencies: hyprpicker, wl-copy, notify-send, jq (for Waybar JSON)

# Configuration
CACHE_DIR="$HOME/.cache/colorpicker"
COLORS_FILE="$CACHE_DIR/colors"
HISTORY_LIMIT=10
NOTIFY_ICON="$HOME/.local/share/bg"  # Fallback icon

# Create cache directory if not exists
mkdir -p "$CACHE_DIR"
touch "$COLORS_FILE"

# Check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Validate hex color format
validate_color() {
  [[ "$1" =~ ^#?[0-9A-Fa-f]{6}$ ]]
}

# Normalize color format (add # if missing)
normalize_color() {
  local color="${1^^}"  # Convert to uppercase
  [[ "$color" != \#* ]] && color="#$color"
  echo "$color"
}

# List saved colors
list_colors() {
  if [[ -s "$COLORS_FILE" ]]; then
    cat "$COLORS_FILE"
  else
    echo "No colors in history"
  fi
}

# Generate Waybar JSON output
waybar_output() {
  local current_color=$(head -n 1 "$COLORS_FILE" 2>/dev/null || echo "#FFFFFF")
  local tooltip="<b>   COLOR HISTORY</b>\n\n"
  tooltip+="→ <b>$current_color</b>  <span color='$current_color'></span>\n"

  if [[ -s "$COLORS_FILE" ]]; then
    while IFS= read -r color; do
      [[ "$color" == "$current_color" ]] && continue
      tooltip+="   <b>$color</b>  <span color='$color'></span>\n"
    done < <(tail -n +2 "$COLORS_FILE")
  fi

  jq -n \
    --arg text "$current_color" \
    --arg tooltip "$tooltip" \
    '{text: "", tooltip: $tooltip, alt: $text}'
}

# Main color picker function
pick_color() {
  # Check dependencies
  if ! command_exists hyprpicker; then
    notify-send -u critical "Color Picker" "❌ hyprpicker is not installed"
    return 1
  fi

  # Kill any existing hyprpicker instance
  killall -q hyprpicker

  # Pick color (auto-select mode)
  local color=$(hyprpicker -a | tr -d '[:space:]')

  # Validate color
  if ! validate_color "$color"; then
    notify-send -u critical "Color Picker" "❌ Invalid color format: ${color:-empty}"
    return 1
  fi

  color=$(normalize_color "$color")

  # Copy to clipboard
  if command_exists wl-copy; then
    echo -n "$color" | wl-copy
  fi

  # Update color history (unique and limited)
  local temp_file=$(mktemp)
  {
    echo "$color"  # Add new color at top
    grep -vFx "$color" "$COLORS_FILE" | head -n $((HISTORY_LIMIT - 1))
  } > "$temp_file"
  mv "$temp_file" "$COLORS_FILE"

  # Notification
  local notify_icon=""
  [[ -f "$NOTIFY_ICON" ]] && notify_icon="-i $NOTIFY_ICON"
  notify-send $notify_icon "Color Picker" "Selected: $color"

  # Update Waybar if running
  if pgrep -x waybar >/dev/null; then
    pkill -RTMIN+1 waybar
  fi

  echo "$color"
}

# Handle command line arguments
case "$1" in
  "-l"|"--list")
    list_colors
    ;;
  "-j"|"--json")
    waybar_output
    ;;
  "-c"|"--current")
    head -n 1 "$COLORS_FILE" 2>/dev/null || echo "#FFFFFF"
    ;;
  *)
    pick_color
    ;;
esac