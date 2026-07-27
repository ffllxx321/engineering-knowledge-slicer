# Timestamp policy

The plugin separates durable business dates from internal operational instants.

- Knowledge-card and other user-facing durable record dates are written as the stable local calendar date `YYYY-MM-DD`.
- An ISO instant from legacy data is converted into the configured `businessTimeZone`, or the Obsidian/runtime local IANA timezone when unset, before its calendar date is derived. UTC text is never blindly truncated.
- Existing ISO card values remain readable and are normalized lazily when rendered or next written. The plugin does not bulk-rewrite historical records.
- Task ledger checkpoints, progress heartbeats, artifact completion, review persistence, rollback ledger entries, service-test state, cache/index generation, errors, performance metrics, and diagnostic logs retain full ISO instants where ordering, recovery, concurrency, cache validity, or auditability requires them.
- Dashboard elapsed/last-update and service-test status are operational UI, so they display those internal instants as localized human date/time. They are not presented as business record dates.

Central helpers live in the bundled `src/core/time-policy.js` module: `formatBusinessDate`, `formatOperationalLocalDateTime`, `preciseIsoInstant`, and `resolveRuntimeTimeZone`.
