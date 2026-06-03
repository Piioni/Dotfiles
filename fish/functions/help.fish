function help --description 'Show help output with sensible fallbacks'
    set -l topic (string trim -- "$argv[1]")

    if test (count $argv) -eq 0
        fish --help | bat -pl help --color=always
        return
    end

    if not type -q -- $topic
        printf "help: unknown command '%s'\n" $topic >&2
        return 127
    end

    set -l help_output (begin
        $topic --help 2>/dev/null
    end)
    set -l help_status $status

    if test $help_status -eq 0 -a -n "$help_output"
        printf "%s\n" $help_output | bat -pl help --color=always
        return 0
    end

    if man -w -- $topic >/dev/null 2>&1
        man $topic
        return $status
    end

    printf "help: no --help or man page found for '%s'\n" $topic >&2
    return 1
end
