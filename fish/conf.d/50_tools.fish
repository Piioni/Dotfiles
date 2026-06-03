set -q __fish_config_interactive; or return

type -q starship; and starship init fish | source
functions -q enable_transience; and enable_transience
type -q zoxide; and zoxide init --cmd j fish | source
type -q fzf; and fzf --fish | source
