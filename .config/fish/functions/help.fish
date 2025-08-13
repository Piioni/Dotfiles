function help --wraps help
    set -l cmd (string trim -- $argv[1])
    if test -n "$cmd"
        $cmd --help | bat -pl help --color=always
    else
        command help | bat -pl help --color=always
    end
end
