set -q __fish_config_interactive; or return

abbr .. 'cd ..'
abbr ... 'cd ../..'
abbr --add --position anywhere --function expand_last_command !!
abbr g 'git'
abbr gs 'git status'
abbr ga 'git add'
abbr gc 'git commit -m '
abbr lg 'lazygit'
abbr lzd 'lazydocker'
abbr v 'nvim'
