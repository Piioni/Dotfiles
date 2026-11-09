# Lens: reliability

Inspect behavior, tests, boundaries, invalid inputs, failure paths, determinism, and regressions.

- Require externally observable assertions at the cheapest useful test level, through the public interface, covering every observable effect (output, exit code, persisted data).
- Report missing coverage only when it leaves candidate behavior unproved.
- Do existing behaviors that share the changed code (options, parsers, helpers) still hold? Run the differential check when you can.
- Flaky, order-dependent or time-dependent tests are findings when the change introduced them.
