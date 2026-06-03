-- Layer-shell positioning and behavior for panels, overlays, and desktop UI.
hl.layer_rule({
  name = "selection-no-anim",
  match = { namespace = "selection" },
  no_anim = true,
})
