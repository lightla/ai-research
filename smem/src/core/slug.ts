// Canonical slug for graph entities. Unlike a free-form tag, a slug is the identity key an
// entity is deduped and looked up by — two declarations of the same name must resolve to the
// same entity row instead of silently forking into near-duplicate nodes.
export function slugify(input: string): string {
  const normalized = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics (handles Vietnamese, accents, ...)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "entity";
}
