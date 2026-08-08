// Bilingual, dependency-free keyword/entity extraction — no POS tagger.
//
// wink-nlp's English statistical model mistags Vietnamese syllables: feeding
// "phụ thuộc vào" (depends on) through its lemmatizer/POS tagger produces garbage
// fragments like "thu" and "vào" as standalone "keywords", because the model has no
// concept of Vietnamese morphology. Ported from neural-memory's extraction/keywords.py
// and extraction/entities.py (refs/neural-memory), which sidestep this by never asking
// "what part of speech is this" — only "is this a stopword, and does it sit next to
// another non-stopword". That position+bigram heuristic reassembles multi-syllable
// Vietnamese compounds ("xác thực", "phụ thuộc") into bigrams without any segmentation
// model, and works identically for English.

import { withUnicodeWordBoundary } from "./regex-utils";

const STOP_WORDS_EN = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "will", "would", "could", "should", "may", "might", "must", "shall",
  "can", "need", "dare", "ought", "used", "to", "of", "in", "for", "on", "with", "at", "by",
  "from", "as", "into", "through", "during", "before", "after", "above", "below", "between",
  "under", "again", "further", "then", "once", "here", "there", "when", "where", "why", "how",
  "all", "each", "few", "more", "most", "other", "some", "such", "no", "nor", "not", "only",
  "own", "same", "so", "than", "too", "very", "just", "and", "but", "if", "or", "because",
  "until", "while", "this", "that", "these", "those", "i", "me", "my", "myself", "we", "our",
  "ours", "ourselves", "you", "your", "yours", "yourself", "he", "him", "his", "himself", "she",
  "her", "hers", "herself", "it", "its", "itself", "they", "them", "their", "theirs", "what",
  "which", "who", "whom"
]);

// Filler/conversational noise that carries no topical signal — kept separate from the core
// stopword list so a caller could opt out of filtering it if that ever matters.
const STOP_WORDS_CONVERSATIONAL_EN = new Set([
  "dont", "doesnt", "didnt", "wont", "wouldnt", "couldnt", "shouldnt", "cant", "isnt", "arent",
  "wasnt", "werent", "hasnt", "havent", "hadnt", "im", "ive", "id", "youre", "youve", "youll",
  "youd", "hes", "shes", "theyre", "theyve", "theyll", "thats", "theres", "heres", "whats",
  "lets", "like", "really", "actually", "basically", "literally", "honestly", "seriously",
  "obviously", "suppose", "guess", "thing", "things", "something", "anything", "everything",
  "nothing", "kinda", "sorta", "gonna", "gotta", "wanna", "dunno", "yeah", "nah", "yep", "nope",
  "hey", "oh", "ugh", "lol", "lmao", "idk", "tbh", "imo", "imho", "fucking", "fuck", "shit",
  "damn", "hell", "crap", "think", "know", "want", "make", "go", "going", "come", "take",
  "give", "tell", "say", "said", "get", "got", "went", "put", "look", "looking"
]);

const STOP_WORDS_VI = new Set([
  "và", "của", "là", "có", "được", "cho", "với", "này", "trong", "để", "các", "những", "một",
  "đã", "tôi", "bạn", "anh", "chị", "em", "ở", "tại", "khi", "thì", "mà", "nếu", "vì", "cũng",
  "như", "từ", "đến", "lại", "ra", "vào", "lên", "xuống", "rồi", "sẽ", "đang", "vẫn", "còn",
  "chỉ", "rất", "quá", "làm", "gì", "sao", "nào", "đâu", "ai", "bao", "nhiêu"
]);

const STOP_WORDS = new Set([...STOP_WORDS_EN, ...STOP_WORDS_CONVERSATIONAL_EN, ...STOP_WORDS_VI]);

// Full Vietnamese diacritic vowel set. An earlier draft only matched the subset unique to
// Vietnamese (ă/â/đ/ê/ô/ơ/ư and their toned forms), reasoning that those don't collide with
// French/Portuguese — true, but it meant a plain-toned sentence like "Tại sao lại chọn..."
// (à/á/ì/ọ only, no ă/â/đ/ê/ô/ơ/ư) tested as "not Vietnamese". This user writes Vietnamese, not
// French, so a false negative on real Vietnamese text is the only failure mode that matters —
// the full set is the correct trade-off here.
const VI_DIACRITICS =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

export function detectVietnamese(text: string): boolean {
  return VI_DIACRITICS.test(text.toLowerCase());
}

export type WeightedKeyword = { text: string; weight: number };

// Case-sensitive code-identifier patterns, matched BEFORE lowercasing so identifiers like
// "AuthService" or "ConnectionRefusedError" stay intact instead of being shredded by the
// natural-language tokenizer below. These double as entity candidates (see extractEntities).
const PASCAL_CASE = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g;
const CAMEL_CASE = /\b([a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)+)\b/g;
const SNAKE_CASE = /\b([a-z][a-z0-9]*(?:_[a-z][a-z0-9]*){1,})\b/g;
const DOTTED_MODULE = /\b([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){1,})\b/g;
const ERROR_TYPE = /\b([A-Z][a-zA-Z]*(?:Error|Exception))\b/g;
// A Vietnamese proper noun can start/end on a diacritic letter ("Đông", "Ưng") — plain \b fails
// there (see regex-utils.ts), so this uses a Unicode-safe lookaround instead of \b.
const CAPITALIZED_RUN = new RegExp(
  withUnicodeWordBoundary("\\p{Lu}[\\p{Ll}\\p{M}]*(?:\\s+\\p{Lu}[\\p{Ll}\\p{M}]*){0,2}"),
  "gu"
);

function extractCodeIdentifiers(text: string): Map<string, number> {
  const identifiers = new Map<string, number>();
  const add = (key: string, weight: number): void => {
    identifiers.set(key, Math.max(identifiers.get(key) ?? 0, weight));
  };

  for (const match of text.matchAll(PASCAL_CASE)) {
    const ident = match[1]!;
    add(ident, 1.2);
    for (const part of ident.match(/[A-Z][a-z]+/g) ?? []) {
      add(part.toLowerCase(), 0.7);
    }
  }
  for (const match of text.matchAll(CAMEL_CASE)) {
    const ident = match[1]!;
    add(ident, 1.2);
    for (const part of ident.match(/[a-z][a-z0-9]*|[A-Z][a-z0-9]+/g) ?? []) {
      add(part.toLowerCase(), 0.7);
    }
  }
  for (const match of text.matchAll(SNAKE_CASE)) {
    const ident = match[1]!;
    add(ident, 1.2);
    for (const part of ident.split("_")) {
      if (part.length >= 2) {
        add(part, 0.7);
      }
    }
  }
  for (const match of text.matchAll(DOTTED_MODULE)) {
    add(match[1]!, 1.2);
  }
  for (const match of text.matchAll(ERROR_TYPE)) {
    add(match[1]!, 1.1);
  }

  return identifiers;
}

/**
 * Extract keywords ranked by importance, with bigram support.
 *
 * Scoring:
 * - Position: earlier content words score higher (1.0 -> 0.5 linear decay)
 * - Bigrams: adjacent non-stopword pairs (within 3 tokens) get an averaged-weight * 1.2 boost —
 *   this is what reassembles a Vietnamese compound like "xác thực" without a segmentation model
 * - Code identifiers (PascalCase/camelCase/snake_case/dotted-module/ErrorType) are seeded at
 *   high weight and kept case-sensitive
 */
export function extractWeightedKeywords(text: string, minLength = 2): WeightedKeyword[] {
  const weighted = new Map<string, number>(extractCodeIdentifiers(text));

  // \p{L}\p{M} matches Vietnamese letters + combining diacritics correctly under Unicode mode —
  // no need for an explicit character-range hack.
  const tokens = text.toLowerCase().match(/[\p{L}\p{M}]+/gu) ?? [];
  const filtered: Array<{ word: string; index: number }> = [];
  tokens.forEach((word, index) => {
    if (word.length >= minLength && !STOP_WORDS.has(word)) {
      filtered.push({ word, index });
    }
  });

  const total = Math.max(filtered.length, 1);
  filtered.forEach(({ word }, rank) => {
    const positionWeight = 1.0 - 0.5 * (rank / Math.max(1, total - 1));
    weighted.set(word, Math.max(weighted.get(word) ?? 0, positionWeight));
  });

  for (let i = 0; i < filtered.length - 1; i += 1) {
    const a = filtered[i]!;
    const b = filtered[i + 1]!;
    if (b.index - a.index <= 3) {
      const bigram = `${a.word} ${b.word}`;
      const bigramWeight = ((weighted.get(a.word) ?? 0.5) + (weighted.get(b.word) ?? 0.5)) * 0.6;
      weighted.set(bigram, Math.max(weighted.get(bigram) ?? 0, bigramWeight));
    }
  }

  return [...weighted.entries()]
    .map(([keyword, weight]) => ({ text: keyword, weight }))
    .sort((a, b) => b.weight - a.weight || a.text.localeCompare(b.text));
}

export function extractKeywords(text: string, minLength = 2, limit = 12): string[] {
  return extractWeightedKeywords(text, minLength)
    .slice(0, limit)
    .map((keyword) => keyword.text);
}

/**
 * Entity candidates: case-preserved code identifiers plus capitalized word runs (proper nouns
 * read the same way in English and Vietnamese — both capitalize names). This is a cheap stand-in
 * for NER, not a claim of full entity recognition — good enough to seed `smem entity add`
 * suggestions or memory tags without an LLM call.
 */
export function extractEntities(text: string, limit = 8): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const push = (value: string): void => {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push(value);
    }
  };

  for (const pattern of [PASCAL_CASE, DOTTED_MODULE, ERROR_TYPE]) {
    for (const match of text.matchAll(pattern)) {
      push(match[1]!);
    }
  }
  for (const match of text.matchAll(CAPITALIZED_RUN)) {
    const value = match[1]!;
    if (!STOP_WORDS_EN.has(value.toLowerCase()) && value.length >= 2) {
      push(value);
    }
  }

  return ordered.slice(0, limit);
}
