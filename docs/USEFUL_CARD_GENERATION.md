# Useful-card generation phase

Production enters at `EngineeringKnowledgeSlicerPlugin.processTask` in the repository-root `main.js`. The owned run parses and canonicalizes adapter blocks, quarantines invalid evidence, then `runStructuredWriterPhase` invokes `runUniversalPipelineMultilingual`. The production chain is:

`canonicalizeDocument → segmentDocument (translation batches only) → translateRegions → extractKnowledgeEvents → planUsefulCards → normalize/route knowledge units → buildStructuredPlan → ProductionCommitService → KnowledgeWritePort`.

`src/v3` remains experimental and is not the production integration point.

## Invariants and contract

The generation contract is `useful-card/1.0`, with runtime validation for `KnowledgeEvent` and `CardPlan`. Unknown event types remain `unknown`, carry uncertainty, and enter grouped review; they never silently become a generic fact. Every plan answers one retrieval intent, has a differentiated search title, retains evidence separately, and records why events were split or combined.

Structural boundaries (headings, list items, table rows, parent clauses, scope and hierarchy) define knowledge boundaries. Request/token limits may batch translation or future model proposals, but cannot change event or card boundaries. Independent siblings remain separate and related; conditions, exceptions, parameters and dependent continuations stay with their governing event. Table rows inherit only their headers and units.

The production path is enabled unconditionally as `4.0-useful-card`. Cached pre-migration universal artifacts are rejected unless they contain validated `knowledge_events` and `card_plans`, forcing regeneration while preserving translation checkpoints. A future structure-graph adapter should populate canonical block hierarchy, `parent_clause_id`, `list_id`, `table_headers`, unit, scope and temporal metadata; the extractor already consumes that seam without depending on a file format.

Generation diagnostics include detected events, planned cards, events per card, accidentally merged independent siblings, orphan conditions, inherited-context size, title/body scope mismatch, unknown types, split/combine reasons, and model batches separately from semantic boundaries.

Quality and review gates are a final safety net. They do not substitute for generating independently useful cards.
