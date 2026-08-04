# v3 core rebuild — Phase 1

## Boundary

Phase 1 is an experimental, isolated ingestion slice. It reads one real Vault source, makes one parser-selection decision, produces a versioned parse result, stages one Markdown preview, verifies the preview by reopening it through Obsidian's public Vault API, atomically renames it into the verified-output root, reopens it again, and persists the current-run manifest.

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

## Honest limitations

- The deterministic OOXML reader extracts textual XML parts; it does not reconstruct layout, drawings, formulas, or embedded objects.
- MSG extraction is a minimal deterministic text-stream recovery adapter, not a complete Outlook Compound File implementation.
- Native PDF extraction supports common literal `Tj`/`TJ` operators and deliberately falls back when measurable text quality is insufficient.
- Language detection is script-based and may report both Chinese and Japanese for mixed CJK text.
- Chinese normalization is contract space only in Phase 1; no translation or rewriting is performed.
- MinerU remains a user-authorized network operation and was not used by the offline official-host gate.

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

## Phase 2 entry criteria

Phase 2 may begin only after Phase 1 remains green on representative user vaults and the parse contract is versioned deliberately. Phase 2 must consume verified Phase 1 output through a new boundary, preserve manifest authority and adapter truthfulness, define migrations before changing the contract, and add classification/atomization/review capabilities without importing legacy caches or writing Phase 1 output into business/tender roots.
