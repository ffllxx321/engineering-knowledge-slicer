# Useful-card generation phase

Production enters at `EngineeringKnowledgeSlicerPlugin.processTask` in the repository-root `main.js`. The owned run parses and canonicalizes adapter blocks, quarantines invalid evidence, then `runStructuredWriterPhase` invokes `runUniversalPipelineMultilingual`. The production chain is:

`canonicalizeDocument → segmentDocument (translation batches only) → translateRegions → extractKnowledgeEvents → planUsefulCards → normalize/route knowledge units → buildStructuredPlan → ProductionCommitService → KnowledgeWritePort`.

`src/v3` remains experimental and is not the production integration point.

## Invariants and contract

The generation contract is `useful-card/2.0`; its required input is the runtime-validated `structure-context/2.0` graph. Unknown event types remain `unknown`, carry uncertainty, and enter grouped review; they never silently become a generic fact. A missing subject becomes an explicit `待确认主题` review item rather than the stored placeholder `未明确主题`. Every plan answers one retrieval intent, has a differentiated search title, retains evidence separately, and records why events were split or combined.

`title` is the short, natural display name used for the heading and safe Markdown filename. `search_title` is the fuller retrieval phrase and may be question-like. `aliases` contains only genuine alternate names that differ from both titles; an empty list is valid. Arabic or Chinese list markers are structural tokens, never subjects or numeric parameters. Stable `record_id` values remain internal identity and are not used as filenames or visible link labels.

Structural boundaries (headings, list items, table rows, parent clauses, scope and hierarchy) define knowledge boundaries. Request/token limits may batch translation or future model proposals, but cannot change event or card boundaries. Independent siblings remain separate and related; conditions, exceptions, parameters and dependent continuations stay with their governing event. Table rows inherit only their headers and units.

The production path is enabled unconditionally as `5.0-structure-aware-useful-card`. A canonical document contains stable structure nodes, validated hierarchy/continuation edges, and the current `pre_generation_semantic_contract` version/fingerprint. Cached `4.x`, `useful-card/1.0`, missing-structure, or missing/mismatched pre-generation-contract outputs are stale and regenerate universal structure/events/plans. Parsed/OCR artifacts and separately validated translation checkpoints remain reusable.

## Structure-loss trace and adapter capability

| Input path | Native structure retained | Parser/inferred structure | Unavailable or intentionally uncertain |
| --- | --- | --- | --- |
| DOCX OOXML | styles/outline headings, numbering IDs and levels, sections, table/row/cell/merge identities, captions when typed | heading from style name is marked inferred with parser confidence | layout-only visual grouping and implicit clause continuation |
| XLSX OOXML | workbook/sheet order, cell coordinates/ranges, rows, merges, table/filter metadata, formulas vs cached values | header paths/row identity only where adapter metadata or deterministic table position supports them | semantic units and visual grouping without metadata |
| PPTX OOXML | slide identity/order, title placeholders, bullets/levels, tables/cells, notes and media captions/alt metadata | title supplies slide context; no bullet merge | animation meaning, image meaning without semantic caption |
| MinerU | supplied pages/locators and Markdown headings, lists, tables and captions | Markdown relations are parser-origin; page markers remain locators | no fabricated hierarchy when the result contains only flat text |
| local OCR / PDF inventory | page, line/block ID, bbox and reading order supplied by the artifact | only explicit adapter continuation metadata; confidence is retained | layout alone does not create heading/list/table/continuation relations |
| MD/TXT | Markdown headings/lists/table rows and stable line spans; TXT paragraphs | Markdown syntax is deterministic native text structure | plain TXT has paragraph order only |
| EML | current message envelope/body and attachment inventory/message identity | quoted history/signature dispositions when the parser marks them | attachment content is never folded into the message |
| MSG | MAPI message/attachment identities exposed by the current read-only adapter | recovered streams carry parser confidence | complete Outlook rendering/thread fidelity is not claimed |
| legacy Block v0 | exact block/locator evidence and reading order | graph nodes are explicitly `inferred`, with limited confidence | no precision is invented for missing hierarchy |

The former loss occurred after `upgradeParsePackage`: `canonicalizeDocument` accepted only a small kind whitelist and copied text, hierarchy, locator, and generic metadata, dropping `parent_id`, parse origin/quality and actionable OOXML/email fields. The planner then joined dependent-looking adjacent clauses regardless of whether a parser asserted continuation. The new canonical graph is built before segmentation and is consumed by the production planner; batching remains downstream and cannot change graph or semantic boundaries.

## Invariants, telemetry, and limitations

Same-level headings, sibling list items, table rows, messages, and attachments are strong boundaries. Page changes are neither split nor merge signals. Cross-block continuation requires an explicit edge with confidence at least `0.8`; weaker edges are counted as ambiguous and remain separate. Parent preambles, heading paths, headers, and units may be inherited, but sibling body text may not. Figures/captions without semantic text remain non-knowledge context. Current-email actions exclude nodes disposed as quote or signature.

Telemetry contains counts only: node/edge kind and origin, confidence buckets, orphan list items, unresolved headers, ambiguous continuations, strong-boundary/sibling/page-only merge counters, inherited-context reason/size, email dispositions, contract version, and adapter name. It never includes source text.

Known limitations are explicit: OCR layout does not yet create hierarchy; MSG thread recovery remains partial; OOXML captions depend on parser metadata; merged/multi-level spreadsheet headers are only complete when the adapter provides header paths. The next seam is richer parser-emitted structure/continuation evidence conforming to `structure-context/2.0`, without changing useful-card semantics.

Generation diagnostics include detected events, planned cards, events per card, accidentally merged independent siblings, orphan conditions, inherited-context size, title/body scope mismatch, unknown types, split/combine reasons, and model batches separately from semantic boundaries.

Quality and review gates are a final safety net. They do not substitute for generating independently useful cards.

The deterministic generation-quality gate enters before card planning and exits after the production structured writer, Markdown parser, hybrid retriever, and evaluator. It covers shared requirement context and exceptions, ordered procedures, table headers/units, bilingual aliases, overlapping pressure topics, repeated marginalia, no-answer behavior, and restart hashes:

```bash
npm run test:useful-card
```

Its sanitized corpus and expected metrics/report hash are committed in `scripts/fixtures/phase3-generation-corpus-v1.json`; runtime Markdown and source documents are not committed.

The bounded production audit corpus is `scripts/test-useful-card-bounded-optimization.js`. Its ten named cases are deliberately offline and sanitized. It asserts atomic table-column facts, exact normalized presentation collisions, independent-clause non-merges, dependent procedure/condition retention, Markdown/frontmatter/filename validity, locators, retrieval terms, and deterministic reruns. `scripts/regression-pre-generation-final-review.js` and the bundled production regression cover selective canonical invalidation and safe translation-checkpoint reuse. Exact semantic identity remains conservative: number, unit, negation, scope, and table column are never discarded or fuzzily matched.
