# Phase 5 cross-document evolution

## Measured baseline at `b2f8891`

A read-only probe ran in a detached worktree and the worktree was removed before implementation. On one record containing source, standard/clause, revision, dates, scope, signature, typed relation and exact evidence, `canonicalRecord` changed the verbatim bytes, removed evidence/block IDs, and omitted all 13 probed evolution fields. Reloading the Markdown emitted by the v3 writer recovered zero evidence items and no source ID. Retrieval collapsed the same text from two independent sources and exposed neither `as_of` nor lifecycle behavior.

The production-chain audit found the losses at these boundaries:

- Phase 2 candidates retain block ID, locator, original evidence, scope and locally extracted facts, but do not define cross-document fact identity or typed evolution relations.
- Phase 3 record construction keys knowledge records by candidate ID and serializes evidence for reading, but the search Markdown parser does not parse that list format. Standard/clause, revision/version, dates, parameter signatures and typed relation metadata are not frontmatter fields.
- `canonicalRecord` previously normalized evidence itself and retained only a single optional source ID plus basic search fields. `markdownRecord` therefore could not round-trip exact evidence or evolution metadata.
- Retrieval dedup used normalized evidence/title similarity, ignored independent source identity and scope, and had no explicit date, revision, conflict-peer or historical ranking semantics.

## Design

`eks/v3/evolution-graph/1` consumes source documents with stable source/block identities and source-bound knowledge units. Stable facts use semantic type, normalized subject/entity aliases, predicate/signature, explicit numbers and units, standard/clause, revision/version, scope, source/evidence identity, and literal-copy identity as appropriate. Matching normalization never replaces `raw_verbatim`.

The deterministic graph distinguishes `exact_duplicate`, `equivalent`, `related`, `contradicts`, and `supersedes`. Literal copies collapse only when semantic identity, signature, revision and scope also agree; all source evidence remains attached. Equivalence retains separate facts and evidence in a common cluster. Scope is a hard relation boundary. Supersession requires explicit replacement or adjacent, unambiguous effective ordering for the same standard/clause/revision chain in identical scope. Dates, ingest order, mtime and confidence alone never establish precedence.

Each Markdown record embeds the complete versioned fact payload as base64url JSON and also renders human-readable evidence and relations. Corpus reload restores exact verbatim text, evidence IDs, block IDs, locators, sources, signatures, lifecycle and typed relations. `HybridRetriever.search` accepts an explicit `as_of` plus `historical`/`include_historical`; current applicable facts rank ahead by default, an exact revision query receives priority, and contradiction peers are returned together rather than deduplicated away.

Run the lexical-only, network-free production-path fixture with:

```sh
npm run test:v3-phase5
```

It exercises documents/units → graph → Markdown → corpus reload → `HybridRetriever` → machine-readable report. Reviewed thresholds are in `scripts/fixtures/phase5-expected-metrics-v1.json`; observed metrics print as `eks/v3/phase5-observed-metrics/1` and fail below threshold.

## Limitations

These local deterministic semantics cannot infer unstated legal precedence. Alias maps and semantic signatures must be explicit and source-grounded; near names intentionally remain separate. “Related” is conservative, contradictions remain unresolved, and malformed dates fail closed to `undated` with a diagnostic. Provider quality claims require a separate, reviewed provider cohort; this fixture uses no provider, network, keys or private documents.
