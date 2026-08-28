# Bounded useful-card audit: pre-change failing fixtures

Captured before the bounded production change on 2026-08-25:

1. `condition_sentence_method`: a leading condition could become a mechanical long-clause title and repeat in the body.
2. `same_heading_independent_numeric`: same-block requirements with the same inferred type/subject could merge.
3. `governing_scope_siblings`: independent siblings sharing a governing scope could merge by type/subject.
4. `ordered_procedure`: protected as a positive compatibility case.
5. `table_two_columns_units`: a row flattened two parameter columns into one event/card.
6. `bilingual_real_alias`: aliases were compared to titles as raw strings.
7. `normalized_collisions`: width, punctuation, and case-only title/search/alias collisions survived filtering.
8. `body_title_prefix_cleanup`: bodies could repeat labels, title text, conditions, or parameters.
9. `condition_exception`: condition/exception attachment was vulnerable to redundant rendering.
10. `legacy_checkpoint_canonical`: reused legacy canonical units did not consistently receive current presentation normalization.

These fixtures are regression assertions, not evidence of fuzzy equivalence. Numeric value, unit, negation, scope, and table-column differences remain negative non-merge cases.
