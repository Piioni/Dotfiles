# Relevo terms

## Account
A provider identity with its own usage allowance. Using the same account through several applications or profiles does not create additional quota.

## Launcher
A named way to start an application with a local configuration profile. An account's default launcher is the one marked `default` (else the first that names it): it is what the account opens on its own, such as pull request actions and handoffs with no session to resume. A launcher is not an account, but each Claude or Codex launcher names its default account. When that account is at 100% usage, Relevo asks whether to open a launcher of another Claude account instead: the one of the same profile if there is one, else that account's default launcher. Pi launchers can use different providers as the selected model changes.

## Profile
An application's isolated configuration and session environment, such as normal or SIPOS. Profiles may authenticate to the same provider account.

## Token launcher
A Claude launcher that runs a profile with another account than the one logged in there. `bin/claude-token <account> <folder>` reads that account's token from the keyring (`secret-tool store --label "Claude <account>" service claude account <account>`, made with `claude setup-token`), refuses to start without it, and sets `RELEVO_ACCOUNT` so the hook labels the session with that account. The token only serves model requests: no claude.ai connectors or Remote Control, and usage still comes from each account's own login. A handoff stays in the session's profile and only changes the account.
