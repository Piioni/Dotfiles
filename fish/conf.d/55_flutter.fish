# Flutter development tooling via FVM
# FVM standalone binary
if test -d "$HOME/fvm/bin"
    contains -- "$HOME/fvm/bin" $PATH; or set -gx PATH "$HOME/fvm/bin" $PATH
end

# FVM manages Flutter and Dart versions per project
# Use: fvm flutter <command> or fvm dart <command>
