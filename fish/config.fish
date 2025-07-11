#  ┏┓┳┏┓┓┏  ┏┓┏┓┳┓┏┓┳┏┓
#  ┣ ┃┗┓┣┫━━┃ ┃┃┃┃┣ ┃┃┓
#  ┻ ┻┗┛┛┗  ┗┛┗┛┛┗┻ ┻┗┛
#                      


### EVERYTHING IS IN conf.d folder ###


# ~/.config/fish/config.fish

# Carga configuraciones básicas
if status is-interactive
    # Carga archivos de conf.d en orden
    for f in $__fish_config_dir/conf.d/*.fish
        source $f
    end
end


