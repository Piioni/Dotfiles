-- Neovim setup used only for Herdr's side-by-side diff tabs (loaded through VIMINIT).
-- Catppuccin Mocha palette, no plugins.
local c = {
  fg = "#cdd6f4", dim = "#6c7086", faint = "#45475a", line = "#232336", sep = "#313244",
  red = "#f38ba8", green = "#a6e3a1", blue = "#89b4fa", yellow = "#f9e2af", mauve = "#cba6f7",
  peach = "#fab387", teal = "#94e2d5", pink = "#f5c2e7", sky = "#89dceb", rosewater = "#f5e0dc",
}

local o = vim.opt
o.termguicolors = true
o.number = true
o.wrap = false
o.mouse = "a"
o.cursorline = true
o.signcolumn = "no"
o.laststatus = 0
o.ruler = false
o.showmode = false
o.showcmd = false
o.scrolloff = 6
o.diffopt = { "internal", "filler", "closeoff", "algorithm:histogram", "linematch:60", "context:5", "inline:word" }
o.fillchars = { diff = " ", fold = " ", eob = " ", vert = "│" }
vim.cmd("syntax on")

function _G.diff_foldtext()
  return "   ⋯ " .. (vim.v.foldend - vim.v.foldstart + 1) .. " unchanged lines"
end
o.foldtext = "v:lua.diff_foldtext()"

local hl = function(name, spec) vim.api.nvim_set_hl(0, name, spec) end

hl("Normal", { fg = c.fg, bg = "NONE" })
hl("NormalFloat", { fg = c.fg, bg = "NONE" })
hl("LineNr", { fg = c.faint })
hl("CursorLine", { bg = c.line })
hl("CursorLineNr", { fg = c.rosewater, bold = true })
hl("WinSeparator", { fg = c.sep, bg = "NONE" })
hl("EndOfBuffer", { fg = "NONE" })
hl("Folded", { fg = c.dim, bg = c.line, italic = true })
hl("WinBar", { fg = c.fg, bg = c.line, bold = true })
hl("WinBarNC", { fg = c.dim, bg = c.line })
hl("Visual", { bg = "#313244" })
hl("Search", { fg = "#1e1e2e", bg = c.yellow })

-- Soft tinted bands instead of solid blocks; changed words get a stronger tint.
hl("DiffAdd", { bg = "#1d3328" })
hl("DiffDelete", { fg = "#4a2a3a", bg = "#33212d" })
hl("DiffChange", { bg = "#1f2335" })
hl("DiffText", { bg = "#3b4f86" })
hl("DiffTextAdd", { bg = "#2e6a47" })

hl("Comment", { fg = c.dim, italic = true })
hl("String", { fg = c.green })
hl("Character", { fg = c.green })
hl("Number", { fg = c.peach })
hl("Boolean", { fg = c.peach })
hl("Constant", { fg = c.peach })
hl("Function", { fg = c.blue })
hl("Identifier", { fg = c.fg })
hl("Statement", { fg = c.mauve })
hl("Keyword", { fg = c.mauve })
hl("Conditional", { fg = c.mauve })
hl("Repeat", { fg = c.mauve })
hl("Operator", { fg = c.sky })
hl("Type", { fg = c.yellow })
hl("PreProc", { fg = c.pink })
hl("Special", { fg = c.pink })
hl("Delimiter", { fg = "#9399b2" })
hl("Title", { fg = c.blue, bold = true })

vim.keymap.set("n", "q", "<cmd>qa!<cr>", { silent = true })
vim.keymap.set("n", "n", "]c", { silent = true })
vim.keymap.set("n", "p", "[c", { silent = true })

-- Top labels: the left side is git's temp copy of HEAD, the right one is the file on disk.
vim.api.nvim_create_autocmd("VimEnter", {
  callback = function()
    local wins = vim.api.nvim_tabpage_list_wins(0)
    if #wins == 2 then
      vim.wo[wins[1]].winbar = "  HEAD  %t"
      vim.wo[wins[2]].winbar = "  Working tree  %t%=n/p change · q quit "
    end
  end,
})
