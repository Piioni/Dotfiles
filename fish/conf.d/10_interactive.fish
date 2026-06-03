# Mark interactive shells so later modules can opt out cleanly.
if status is-interactive
    set -g __fish_config_interactive 1
else
    set -e __fish_config_interactive
end
