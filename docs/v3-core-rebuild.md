# v3 core rebuild — Phases 1–2

## Boundary

Phase 1 is an experimental, isolated ingestion slice. It reads one real Vault source, makes one parser-selection decision, produces a versioned parse result, stages one Markdown preview, verifies the preview by reopening it through Obsidian's public Vault API, atomically renames it into the verified-output root, reopens it again, persists the structured parse artifact, and hash-binds both outputs in the current-run manifest.

It does not invoke classification, knowledge atomization/cards, review routing, semantic shadow, legacy workflow orchestration, legacy caches, or legacy checkpoints. The stable 2.20.x commands and business/tender roots are unchanged.

All disposable v3 state is below `Engineering Knowledge Slicer/v3-phase1/state/`. Verified Markdown is below `Engineering Knowledge Slicer/v3-phase1/verified-output/`. Deleting the state namespace cannot delete source files or existing knowledge Markdown. Phase 1 never writes to configured business or tender roots.

## State machine and completion authority

The sole orchestrator is `V3Phase1Orchestrator`. Its typed states are:

`queued → reading → parsing → validating → staging → verifying → committed`

Every nonterminal state may instead transition to `failed`. No transition is inferred from a UI counter.

`Engineering Knowledge Slicer/v3-phase1/state/manifests/current-run.json` is the only completion authority. Completion is true only when that persisted manifest is `committed`, identifies a final Markdown file, that file can be reopened through `Vault.read`, and its SHA-256 matches. This same check runs after the commit and after plugin restart.

## Parse contract

`eks/v3/parse-result/1` contains:

- source path, name, extension, byte size, and SHA-256 identity;
- detected `zh`, `ja`, `en`, or `und` languages;
- an explicit Chinese-normalization placeholder (`not_requested`, no fabricated translation);
- stable content-derived block IDs and locators;
- the single selected parser and a chronological attempted/skipped/succeeded/failed record with reason and duration;
- quality score and measurable metrics, plus warnings;
- visible Markdown and no knowledge-card fields.

TXT/Markdown, DOCX, XLSX, PPTX, MSG, and EML use deterministic local adapters. PDFs first receive a native-text character/replacement-ratio quality probe. Adequate native text skips both external parsing and OCR. Otherwise exactly one configured MinerU adapter is attempted only when a key exists and upload is authorized; local OCR is then attempted only when its executable probe succeeds. Empty output fails closed. Failure text enumerates what was attempted, skipped, or failed and why; skipped engines are never reported as failed.

## Experimental command

`[实验性] v3 Phase 1：选择源文件并生成已验证 Markdown` opens a Vault source picker. It does not replace the stable command. Its completion/failure notice shows actual adapter records and, on success, the verified output path.

## Phase 2 candidate boundary

`V3Phase2CandidateOrchestrator` is the only Phase 2 candidate orchestrator. It reads only the latest `committed` Phase 1 manifest after Phase 1's authority has reopened and hash-validated both the verified Markdown and `eks/v3/parse-result/1` artifact. The exact persisted Phase 1 manifest bytes, parse artifact hash, preview hash, and source hash are bound into the Phase 2 manifest.

Phase 2 uses deterministic source blocks and locators produced by Phase 1. It filters obvious page furniture, tables of contents, empty/short content, and marketing tracking/unsubscribe noise before provider use. Stable batches preserve Phase 1 order. The provider performs only semantic grouping, Chinese normalization, and candidate formulation; it is never asked to rediscover pages, headings, lists, rows, sheets, slides, or email boundaries.

The versioned `eks/v3/candidate/1` contract contains a content-derived ID, Chinese title/body, knowledge kind, reusable scope, source identity, exact block IDs and locators, compact original evidence, detected source languages, translation status, explicit numbers/units/dates/versions/standard clauses, evidence/completeness/translation confidence, and warnings. It deliberately excludes folder routes, approval state, and backlinks. Candidate artifacts use `eks/v3/candidate-artifact/1`.

Numbers, units, dates, versions, and standard clauses are extracted locally from original evidence and must survive validation exactly. Evidence must be a literal substring of the referenced Phase 1 block. Uncertain translations are instructed to use `uncertain_literal`; the prompt prohibits invention and silent rewriting of names, clauses, exceptions, and obligations. Conflicting fact signatures are never consolidated. Compatible candidates consolidate only when kind/scope match, evidence overlaps, and fact signatures are identical. Independent proposals remain separate; no fixed output count is imposed.

Map outputs are resumable under `Engineering Knowledge Slicer/v3-phase2/state/v1/runs/`. Validated model responses may also be cached under the isolated v3 namespace using source hash + candidate schema + prompt version + model identity. Cache and resume hits are recorded as `skipped`, never as provider success, and cannot establish completion.

Only two experimental outputs are written below `Engineering Knowledge Slicer/v3-phase2/experimental-output/v1/`: a machine-readable candidate artifact and a candidate preview Markdown. Rejections remain in the artifact and preview with plain Chinese reasons. No business/tender/knowledge-library path is written.

`Engineering Knowledge Slicer/v3-phase2/state/v1/manifests/current-run.json` is the sole Phase 2 completion authority. It requires an exact valid Phase 1 binding, a committed Phase 2 state, a nonempty valid candidate artifact, and both artifact and preview to reopen with matching hashes. The same authority is evaluated after plugin restart.

`[实验性] v3 Phase 2：处理最新有效 Phase 1 并预览候选` calls only the configured provider's low-level JSON transport, reports accepted/rejected counts and rejection reasons, and opens the preview through the workspace. It neither replaces Phase 1 nor any stable workflow.

The concise generic prompt and response schema live entirely under `src/v3`. Provider attempt records include attempted/skipped/succeeded/failed, duration, model, input/output sizes, and sanitized reason. Tests use deterministic providers and no API keys or network.

## Honest limitations

- The deterministic OOXML reader extracts textual XML parts; it does not reconstruct layout, drawings, formulas, or embedded objects.
- MSG extraction is a minimal deterministic text-stream recovery adapter, not a complete Outlook Compound File implementation.
- Native PDF extraction supports common literal `Tj`/`TJ` operators and deliberately falls back when measurable text quality is insufficient.
- Language detection is script-based and may report both Chinese and Japanese for mixed CJK text.
- Chinese normalization is contract space only in Phase 1; no translation or rewriting is performed.
- MinerU remains a user-authorized network operation and was not used by the offline official-host gate.
- Phase 2 is candidate formulation only. It does not classify into business/tender folders, route review, write final knowledge Markdown, create backlinks, run semantic shadow, or use legacy workflow/cache/checkpoint/atomization modules.
- Literal fact preservation is enforced locally; broader semantic faithfulness still depends on provider output and is exposed through evidence, translation status, confidence, warnings, and rejection records rather than being presented as approved knowledge.

## Test evidence

Evidence recorded on 2026-08-04:

- `npm ci`: passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test` (all existing pretests and tests): passed.
- `npm run test:v3`: passed, covering states, truthful adapter records, TXT/MD/DOCX/XLSX/PPTX/MSG/EML, native/scanned PDF, malformed and empty inputs, Chinese/Japanese/English, missing key, declined upload, cloud timeout/failure, unavailable/failing OCR, staging failure, hash mismatch, reopen failure, restart before/after commit, and repeated-run idempotency.
- `npm run build`: passed.
- `npm run gate:v3-architecture`: passed, proving no forbidden legacy workflow/cache/review/atomization import and exactly one orchestrator/completion authority.
- `npm run gate:v3-obsidian`: passed against official Obsidian 1.12.7 in two launches. The first launch processed local Chinese, Japanese, and native-PDF fixtures through Vault APIs; the second launch revalidated the persisted manifest and final Markdown/hash. Machine-readable evidence is generated at `test-artifacts/v3-real-obsidian-evidence.json`.
- `npm run test:v3-phase2`: covers candidate contracts/source binding/stable IDs, Chinese/Japanese/English/mixed normalization, exact fact preservation, rejection reasons, compatible consolidation/conflict separation, cache invalidation, partial failure/resume, idempotency, completion authority, malformed output, fabricated evidence, drift, write/reopen/hash failures, restart, duplicate run, and quantitative audit fields.
- The official-host v3 gate also runs Phase 2 with a deterministic in-host fake provider, reopens the candidate artifact and preview through public Vault APIs, and revalidates their Phase 1 bindings and hashes after restart. No real provider validation is claimed.

## Phase 3 entry criteria

Phase 3 may begin only after every Phase 1 and Phase 2 gate remains green on representative real Vault fixtures and candidate-contract changes are versioned deliberately. Phase 3 must consume only a committed, reopenable, hash-valid Phase 2 manifest/artifact; define an independent review/decision contract; preserve exact evidence and facts; keep classification/routing separate from candidate formulation; introduce no final knowledge write until approval authority is explicit and restart-safe; and add migrations before changing any persisted v3 contract. Legacy v2 workflow, prompts, cache, checkpoints, routing, review, and atomization remain forbidden dependencies.
