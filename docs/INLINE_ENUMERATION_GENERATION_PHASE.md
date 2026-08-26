# Inline enumeration generation phase

## Pre-change evidence

At clean HEAD `737d6e0`, an executable production-path probe passed a flat local-text paragraph through canonicalization, event extraction and card planning:

`室内泵组应符合下列要求：（1）操作员必须检查接地；（2）操作员必须记录绝缘电阻。`

The pipeline emitted two cards, but the first predicate was `室内泵组应符合下列要求:(1)操作员必须检查接地;`. The governing preamble was treated as the first fact, and neither sibling had explicit inherited scope. Chinese `一、…；二、…` showed the same failure. A numeric paragraph containing `1.6 MPa` and `2.4 MPa` correctly remained one fact.

## Bounded scope and earliest seam

The fix is in `preparePreGenerationBlocks`, before canonical structure and events. A flat paragraph is expanded only when it contains at least two explicit parenthesized, Arabic, or Chinese inline markers, every item body has a supported normative modality signal, and any preamble is empty or syntactically governing. Supported Chinese signals include obligations, prohibitions, guidance and permission (`应`/`应当`/`必须`/`须`, `不应`/`不得`/`禁止`/`严禁`, `宜`/`不宜`, `可以`/`允许`). English `must`/`shall` and their negative forms are intrinsically normative; English permission including `may` additionally requires an explicit normative governing preamble and actor/action item form. This prevents explanatory or epistemic `may` prose from becoming requirements. The preamble becomes a context-only parent clause; each item becomes an ordered `list_item` with a stable derived ID and exact trimmed character-span locator.

This phase does not infer semantic equivalence, merge facts, change request/token batching, call a provider, or alter review thresholds. Existing native list blocks, decimal prose, clause references, tables, multiline Markdown, and ambiguous marker-like prose remain unchanged.

## Invariants and compatibility

- Source order is marker order; IDs and `chars=start-end` fragments depend only on immutable source identity and offsets. Slicing the original source with a derived half-open span equals its verbatim text, including punctuation after Markdown serialization and reload.
- Each sibling requirement remains an independent event/card. The shared preamble is inherited as scope, not emitted as a fact.
- Conditions and exceptions inside an item remain inside that item's span and card.
- Verbatim evidence retains original punctuation and text; normalization is only for semantic matching/presentation.
- Numeric value, unit, negation, modality, applicability, and evidence meaning are never used for fuzzy merging.
- Canonical output carries `pre_generation_semantic_contract.version` and a deterministic fingerprint. Production reuses `universal-canonical` only when both match. Artifacts produced at `737d6e0` have no fingerprint and are selectively regenerated because their structure/events/plans may be stale; parsed/OCR artifacts and the separately validated translation checkpoint/cache remain reusable.

## Offline production-path regression

`scripts/test-inline-enumeration-generation.js` and `scripts/regression-pre-generation-final-review.js` run sanitized corpora through canonicalization → structure/events → plans → structured writer → Markdown parser → hybrid retrieval/evaluation and the bundled production retry seam. They assert concrete titles, bodies, scope, modality, negation-bearing predicates and natural-query facts. Counterexamples cover decimals, versions, dates, clause references, IP addresses, citations, explanatory English `may`, explanatory Chinese `可以`, no-space markers and mixed punctuation. The production regression proves that a pre-contract canonical is rejected, its safe translation cache is retained, and the refreshed canonical is reused on retry.

## Remaining limits

The recovery deliberately does not split marker sequences lacking obligation/modality evidence, single-marker prose, alphabetic enumerations, prose whose preamble is not clearly governing, or multiline/layout-only OCR without existing parser evidence. Those cases remain flat rather than risking invented boundaries.
