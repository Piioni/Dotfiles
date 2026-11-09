# Lens: readability

Inspect maintainability defects that obscure behavior: misleading names, duplicated or dead logic, unexplained business constants, unsafe complexity, missing change context, and review size.

- Report style only when it hides a concrete defect or makes the change unsafe to maintain, naming the concrete place that misleads.
- Public API, command output, messages and docs that changed without being updated together are in scope.
- Pure taste is a SUGGESTION at most.
