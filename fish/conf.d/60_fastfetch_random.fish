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
        set -l runtime_dir /tmp
        if set -q XDG_RUNTIME_DIR
            set runtime_dir "$XDG_RUNTIME_DIR"
        end

        set -l session_name default
        if set -q ZELLIJ_SESSION_NAME
            set session_name "$ZELLIJ_SESSION_NAME"
        end

        set -l marker_dir "$runtime_dir/fastfetch"
        set -l marker_file "$marker_dir/zellij-session-$session_name"

        if test -e "$marker_file"
            set should_show_fastfetch 0
        else
            mkdir -p "$marker_dir"
            command touch "$marker_file"
        end
    end

    if test "$should_show_fastfetch" -eq 1; and test -x "$HOME/bin/ff-random"
        "$HOME/bin/ff-random"
        set -g __fastfetch_startup_visible 1
    end
end
