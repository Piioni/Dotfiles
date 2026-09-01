# Flutter development tooling via FVM
# FVM standalone binary
if test -d "$HOME/fvm/bin"
    contains -- "$HOME/fvm/bin" $PATH; or set -gx PATH "$HOME/fvm/bin" $PATH
end

# FVM manages Flutter and Dart versions per project
# Use: fvm flutter <command> or fvm dart <command>

# Globally activated Dart packages (melos, etc.)
if test -d "$HOME/.pub-cache/bin"
    contains -- "$HOME/.pub-cache/bin" $PATH; or set -gx PATH "$HOME/.pub-cache/bin" $PATH
end
