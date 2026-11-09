# Lens: risk

Inspect security, authorization, data exposure or loss, unsafe input handling, secrets, and dependency vulnerabilities.

- Require backend enforcement: a client-side check alone is not a guard.
- Require a reachable exploit path or scanner evidence. Hypothetical risk with no reachable impact is not a finding.
- Check changes to stored data, persisted formats, migrations, permissions, and anything others consume as a contract.
