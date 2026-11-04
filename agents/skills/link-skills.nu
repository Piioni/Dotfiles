# Link every skill directory in this folder into Pi and Claude's user skill directories.
# Existing correct links are left alone; conflicting paths are never overwritten.

def main [] {
    let source_dir = $env.FILE_PWD
    let targets = [
        ($env.HOME | path join ".pi" "shared" "skills")
        ($env.HOME | path join ".claude" "skills")
    ]
    let skills = (
        ls $source_dir
        | where type == dir
        | get name
        | where {|dir| ($dir | path join "SKILL.md" | path exists) }
    )

    if ($skills | is-empty) {
        error make {msg: $"No skill directories containing SKILL.md found in ($source_dir)"}
    }

    for target_dir in $targets {
        mkdir $target_dir

        for skill_dir in $skills {
            let skill_name = ($skill_dir | path basename)
            let link_path = ($target_dir | path join $skill_name)

            if ((^test -L $link_path | complete).exit_code == 0) {
                let resolved_link = (^readlink -f $link_path | complete)
                let resolved_skill = (^readlink -f $skill_dir | complete)

                if $resolved_link.exit_code == 0 and $resolved_skill.exit_code == 0 and ($resolved_link.stdout | str trim) == ($resolved_skill.stdout | str trim) {
                    print $"Already linked: ($link_path)"
                } else {
                    error make {msg: $"Refusing to replace conflicting symlink: ($link_path)"}
                }
            } else if ($link_path | path exists) {
                error make {msg: $"Refusing to replace existing path: ($link_path)"}
            } else {
                let link_result = (^ln -s $skill_dir $link_path | complete)
                if $link_result.exit_code != 0 {
                    error make {msg: $"Failed to create symlink ($link_path): ($link_result.stderr | str trim)"}
                }
                print $"Linked: ($link_path) -> ($skill_dir)"
            }
        }
    }
}
