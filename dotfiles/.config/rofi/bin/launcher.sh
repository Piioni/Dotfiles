#!/usr/bin/env bash
#  ┓ ┏┓┳┳┳┓┏┓┓┏┏┓┳┓
#  ┃ ┣┫┃┃┃┃┃ ┣┫┣ ┣┫
#  ┗┛┛┗┗┛┛┗┗┛┛┗┗┛┛┗
#                  

# Dirs
style_dir="$HOME/.config/rofi/styles"
style_theme='style-3'

# Run
pkill rofi || true && rofi -show drun -theme ${style_dir}/${style_theme}.rasi
