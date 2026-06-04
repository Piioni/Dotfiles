# Show a random buddy brush image on interactive terminals.
if status is-interactive
    if test -x "$HOME/bin/ff-random"
        "$HOME/bin/ff-random"
    end
end
