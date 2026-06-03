if not status is-interactive
    return
end

# Abbreviations
abbr .. 'cd ..'
abbr ... 'cd ../..'
abbr g 'git'
abbr gs 'git status'
abbr ga 'git add'
abbr gc 'git commit'
abbr lg 'lazygit'
abbr lzd 'lazydocker'
abbr v 'nvim'
abbr pi 'sudo pacman -S '
abbr pc 'sudo pacman -Rns (pacman -Qdtq)'
abbr i 'paru -S'
abbr ic 'paru -Sc'

# Aliases
alias ls='eza --icons --color=always --group-directories-first'
alias l='eza -lh --icons --color=always'
alias la='eza -a --icons --color=always'
alias ll='eza -lga --icons --color=always'
alias lsd='eza -d */ --icons --color=always'
alias lt='eza --tree --icons --color=always'
alias l1='eza -1 --icons --color=always'
alias cat='bat'
alias cp='cp -iv'
alias mv='mv -iv'
alias rm='rm -vI'
alias grep='grep --color=auto'
alias vfzf='nvim (fzf -m --preview="bat --color=always {}")'
alias fzfpr='fzf --preview="bat --color=always {}"'
alias reload='exec fish'
alias q='exit'
alias c='clear'
alias ff='fastfetch'
alias oc='opencode'

# Appearance and bindings
set fish_color_command brgreen
set fish_color_param brwhite
set fish_color_autosuggestion 7f849c
fish_vi_key_bindings
set fish_cursor_default block blink
set fish_cursor_insert line blink

# Interactive tools
type -q starship; and starship init fish | source
functions -q enable_transience; and enable_transience
type -q zoxide; and zoxide init --cmd j fish | source
type -q fzf; and fzf --fish | source
