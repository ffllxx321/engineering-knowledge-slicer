# Phase 6 production evolution integration

## Measured baseline

At clean commit `49d69f8` on branch `v3-core-rebuild`, repository searches and a read-only inspection of the stable call chain found that `src/v3/evolution-contract.js` was embedded, exported, and covered by the Phase 5 gate, but it had no caller in `processTask`, the universal pipeline, structured writer, `ProductionCommitService`, or retrieval corpus construction. Stable 2.20.x Markdown contained no evolution payload, `as_of`, lifecycle, conflict-peer, or supersession metadata. The Dashboard view was registered unconditionally in `onload`; the acceptance harness could call `loadPlugin` while automatic community-plugin activation was still in flight. These are observations, not release claims.

## Stable integration seam and data flow

The seam is `ProductionCommitService.commit`, after the universal useful-card planner and structured plan have fixed card boundaries, and before the authoritative manifest can authorize the task's `stored` transition. Structured actions now carry the production record snapshot used to render them. Only fields present on that snapshot are passed to the Phase 5 contract: stable source ID/hash/version, block/evidence identity, locator and verbatim, semantic kind, subject, predicate/signature, numeric values/units, standard/clause, revision/version, dates, and project/general scope. Empty or malformed values remain empty/undated and are diagnosed; they are not inferred.

The existing Phase 5 implementation remains the sole relation builder. Exact duplicate facts may share one graph fact while retaining every evidence item, but the authoritative Markdown card set is unchanged. Equivalent, conflict, and supersession relations do not remove cards. Production Markdown receives a versioned base64url JSON payload which the existing Markdown retrieval loader already round-trips. Older Markdown without the payload continues to load as an undated, unrelated record.

## Transaction and binding

The required sidecar is `<artifactsPath>/evolution/production-index-v1.json`, inside the approved production state root. It is a required production artifact, never a knowledge card and never success evidence. The structured transaction writes and reopens card changes, the ID/path index, and this sidecar together. An index write/reopen failure enters the existing rollback path, restoring prior cards, ID/path index, and prior sidecar (or quarantining a newly created sidecar). Consequently Phase 6 treats the index as required: failure cannot produce a fully stored task.

The sidecar binds its schema and stable pipeline identifier to sorted record IDs, managed paths, record content hashes, source hashes, and source-evidence hashes. Loading a prior sidecar validates its binding against the authoritative ID/path index; corruption, mismatch, or missing record targets fails closed with `EVOLUTION_REBUILD_REQUIRED` rather than reusing relations. Unrelated prior graph facts and evidence are retained when another source is processed. Identity contains no wall-clock value; tests inject `as_of` explicitly.

## Startup lifecycle

Activation now owns a small state machine. Concurrent or repeated activation of one instance registers one view and one command set. Unload unregisters the owned view and resets activation state before reload. The official-host acceptance probe no longer calls `loadPlugin`; it waits for the single instance created by Obsidian's community-plugin loader. Acceptance runs five clean host processes plus a restart process and reports duplicate-view failures as machine-readable evidence.

## Limits and migration

This stage does not rewrite existing user Markdown and does not claim a release. Existing 2.20.x cards remain retrieval-compatible as undated/unrelated records. A stale or corrupt sidecar deliberately requires the explicit `[管理] 预览并重建生产演化索引` command before another production commit; the command first computes counts, confines its single write to the approved artifact root, and never rewrites cards. Legacy cards without an exact evolution payload are bound as `undated`/`unrelated`; relations appear after their source is normally reprocessed. Provider-real is `not_run` unless `EKS_ACCEPTANCE_MINIMAX_API_KEY` is supplied and the provider-real command is actually executed.
