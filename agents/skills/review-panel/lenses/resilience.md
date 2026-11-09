# Lens: resilience

Inspect failure handling, rollback or fix-forward behavior, retry safety, graceful degradation, observability, latency, and load.

- Require a concrete production failure mode or measured impact. Generic operational speculation is not a finding.
- Check partial writes, retries that are not idempotent, missing timeouts, swallowed errors, and concurrency or ordering assumptions.
- A failure that cannot be diagnosed afterwards (no log, no signal) counts when the change introduced it.
