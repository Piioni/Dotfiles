-- Core keyboard and touchpad behavior preferences.
hl.config({
    input = {
        -- Keyboard
        kb_layout = "us",
        repeat_rate = 50,
        repeat_delay = 300,
        numlock_by_default = true,

        -- Mouse
        sensitivity = 0.1,
        accel_profile = "flat",
        left_handed = false,
        follow_mouse = true,
        float_switch_override_focus = false,

        -- Touchpad
        touchpad = {
            -- Tapping is on, but drag lock is off to avoid sticky drags.
            tap_to_click = true,
            disable_while_typing = true,
            natural_scroll = true,
            clickfinger_behavior = true,
        },
    },
})
