// JS's `\b` anchors on `\w`, which is ASCII-only ([A-Za-z0-9_]) even with the `u` flag — it does
// NOT extend to Unicode letters. That means `\b` silently fails to match right next to a
// Vietnamese diacritic character: in "thay vì cần", the boundary right after "vì" never fires,
// because "ì" isn't a `\w` character, so JS sees a non-word→non-word transition there (not a
// boundary) even though a human reads "vì" as a whole word ending cleanly before a space.
//
// `\p{L}`/`\p{N}` cover the full Unicode letter/number set (Vietnamese included), so a manual
// lookaround using them is the correct replacement anywhere a pattern's boundary can sit next to
// non-ASCII text. Requires the regex's `u` flag.
export const UNICODE_BOUNDARY_BEFORE = "(?<![\\p{L}\\p{N}_])";
export const UNICODE_BOUNDARY_AFTER = "(?![\\p{L}\\p{N}_])";

/** Wrap `inner` with Unicode-safe word boundaries on both sides, e.g. for a compiled alternation. */
export function withUnicodeWordBoundary(inner: string): string {
  return `${UNICODE_BOUNDARY_BEFORE}(${inner})${UNICODE_BOUNDARY_AFTER}`;
}
