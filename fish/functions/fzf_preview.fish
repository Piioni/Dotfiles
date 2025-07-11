function fzf_preview -d "Enhanced file preview for FZF"
    set -l item $argv[1]
    
    if test -f "$item"
        bat --color=always --style=numbers --line-range=:500 "$item"
    else if test -d "$item"
        eza -1 --group-directories-first --icons "$item" | head -n 20
    end
end