# Shell functions.
def --env yy [...args] {
    let tmp = (mktemp -t "yazi-cwd.XXXXX")
    ^yazi ...$args --cwd-file $tmp
    let cwd = (open $tmp)

    if $cwd != "" and $cwd != $env.PWD {
        cd $cwd
    }

    ^rm -fp $tmp
}

def reload [] {
    exec nu
}

# Claude Code for Sipos work, isolated from the personal ~/.claude setup.
def --wrapped claude-sipos [...args] {
    with-env { CLAUDE_CONFIG_DIR: ($env.HOME | path join ".claude-sipos") } {
        ^claude ...$args
    }
}
