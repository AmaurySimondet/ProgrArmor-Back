# AI Memory: Verified Equivalent Variation Priority

## Context
Users can build the same real exercise using multiple variation IDs.  
Example: a verified variation (single ID) can be equivalent to a user-composed set of multiple variations.

## Rule to preserve
In both `getMyExercicesAll` and `getMyExercicesSearch`, each grouped exercise (based on `variations.variation`) must be auto-normalized to a verified variation when possible.

## Matching logic
- Take the grouped variation ID array for one `myExercise`.
- Match against `Variation` documents where:
  - `verified === true`
  - `equivalentTo` contains exactly the same IDs (same set, order-agnostic, same length).
- If multiple verified matches exist, keep a deterministic priority (currently by highest `popularity`, then oldest `createdAt`).

## Replacement behavior
If a verified equivalent exists:
- Replace output `_id` with `[verifiedVariationId]`.
- Replace output `variations` with `[verifiedVariationDocument]` (single element).

If no verified equivalent exists:
- Keep the original multi-variation output unchanged.

## Why this matters
- Preserves user flexibility when logging exercises with multiple variations.
- Automatically promotes canonical/verified exercise variants in "my exercises" results.
- Keeps verified taxonomy prioritized without removing custom composition capability.

## Implementation notes
- Current implementation is shared through helper functions in `lib/set.js`:
  - `getSortedVariationIds`
  - `getVariationSignature`
  - `getEquivalentVerifiedMapFromGroups`
- The behavior is intentionally applied in both retrieval paths:
  - `getMyExercicesAll`
  - `getMyExercicesSearch`
