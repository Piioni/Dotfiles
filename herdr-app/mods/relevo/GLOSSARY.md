# Relevo terms

## Account
A provider identity with its own usage allowance. Using the same account through several applications or profiles does not create additional quota.

## Launcher
A named way to start an application with a local configuration profile. A launcher is not an account, but each Claude or Codex launcher names its default account. When that account is at 100% usage, Claude launchers open the first launcher of another Claude account instead. Pi launchers can use different providers as the selected model changes.

## Profile
An application's isolated configuration and session environment, such as normal or SIPOS. Profiles may authenticate to the same provider account.
