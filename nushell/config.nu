# Nushell configuration loader.
source ($nu.default-config-dir | path join "autoload" "10-tools.nu")
source ($nu.default-config-dir | path join "autoload" "20-interface.nu")
source ($nu.default-config-dir | path join "autoload" "30-colors.nu")
source ($nu.default-config-dir | path join "autoload" "40-prompt.nu")
source ($nu.default-config-dir | path join "autoload" "50-aliases.nu")
source ($nu.default-config-dir | path join "autoload" "60-functions.nu")
