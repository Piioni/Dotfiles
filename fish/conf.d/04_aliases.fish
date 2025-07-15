#   ┏┓┓ ┳┏┓┏┓┏┓┏┓
#   ┣┫┃ ┃┣┫┗┓┣ ┗┓
#   ┛┗┗┛┻┛┗┗┛┗┛┗┛
#                     

# ── File Management & Navigation with eza ────────────────
alias ls='eza --icons --color=always --group-directories-first'
alias l='eza -lh --icons --color=always'                   # long + human-readable
alias la='eza -a --icons --color=always'                   # show hidden
alias ll='eza -lga --icons --color=always'                 # long + git + all + icons
alias lsd='eza -d */ --icons --color=always'               # directories only
alias lt='eza --tree --icons --color=always'               # tree view
alias l1='eza -1 --icons --color=always'                   # one entry per line
alias cat='bat'	              			           # bat for cat

# ── File Utilities ────────────────────────────────────────
alias cp='cp -iv'
alias mv='mv -iv'
alias rm='rm -vI'

alias grep='grep --color=auto'
alias egrep='egrep --color=auto'
alias fgrep='fgrep --color=auto'

alias vfzf='nvim $(fzf -m --preview="bat --color=always {}")'
alias fzfpr='fzf --preview="bat --color=always {}"'

# ── Misc Utilities ────────────────────────────────────────
alias reload='exec fish'
alias q='exit'
alias c='clear'

alias ff='fastfetch -c ~/.config/fastfetch/material.jsonc'

#  Pacman shit
alias pacmanclean='sudo pacman -Rns $(pacman -Qdtq)'
alias p='pacman' 
alias i='yay -S'
alias yayclean='yay -Yc'


