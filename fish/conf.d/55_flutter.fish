# Flutter development tooling
# Dart SDK (standalone)
if test -d "$HOME/.local/dart-sdk/bin"
    contains -- "$HOME/.local/dart-sdk/bin" $PATH; or set -gx PATH "$HOME/.local/dart-sdk/bin" $PATH
end

# Dart pub global packages (includes FVM)
if test -d "$HOME/.pub-cache/bin"
    contains -- "$HOME/.pub-cache/bin" $PATH; or set -gx PATH "$HOME/.pub-cache/bin" $PATH
end

# FVM Flutter SDK paths
# When using `fvm flutter` commands, FVM handles the version automatically
# To use Flutter directly without `fvm` prefix: `fvm global 3.24.2` in project
