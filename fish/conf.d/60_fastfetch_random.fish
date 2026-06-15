# Show fastfetch on interactive terminals.
# Inside Zellij, only show it once per session.

function __fastfetch_cleanup_on_resize --on-signal WINCH
    if not set -q __fastfetch_startup_visible
        return
    end

    printf '\e[2J\e[H'
    commandline -f repaint
    set -e __fastfetch_startup_visible
end

function __fastfetch_clear_startup_flag_on_command --on-event fish_preexec
    set -e __fastfetch_startup_visible
end

if status is-interactive
    set -l should_show_fastfetch 1

    if set -q ZELLIJ
        set should_show_fastfetch 0
    end

    if test "$should_show_fastfetch" -eq 1; and type -q ff-random
        ff-random
        set -g __fastfetch_startup_visible 1
    end
end
