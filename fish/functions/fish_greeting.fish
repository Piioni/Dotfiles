function fish_greeting
    if set -q __fish_fastfetch_shown
        return
    end

    set -g __fish_fastfetch_shown 1
    fastfetch
end
