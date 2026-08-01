# Decision: Offline Text Classification Options

## Status

Approved and implemented for Phase 1.5.

## Context

Smart Memory should classify raw captured text without spending LLM tokens when possible. The goal is not perfect semantic understanding; the goal is cheap, auditable labels such as topic, intent, raw input/output, possible decision, possible todo, or error signal.

## Options

### Rule-based classifier

Use plain TypeScript rules and regex first.

Good for:

- raw-input/raw-output/tool-event
- `/smem` commands
- error/failure signals
- obvious decision words such as "chốt", "quyết định", "from now on"

This is already implemented for hook events.

### wink-nlp / wink classifiers

Good offline Node.js option for tokenization, entities, bag-of-words, and classifier pipelines. It is production-oriented and fast. Useful if smem needs topic/intent classification without large model files.

### natural

Classic Node.js NLP toolkit. Useful for TF-IDF, stemmers, classifiers, string similarity. Good boring option, but APIs feel older.

### compromise

Lightweight rule-based NLP. Good for extracting nouns/entities/dates from English text. Less suitable for multilingual semantic topic classification.

### Transformers.js

Best option for true offline semantic embeddings/classification in Node.js. It can run local feature-extraction and zero-shot classification models, but model downloads/runtime size are much heavier than rule-based NLP.

## Decision

Use `wink-nlp` as the default offline text classification/NLP helper after the current rule-based classifier.

Keep `Transformers.js` as an optional offline semantic/vector provider, not the default capture classifier.

Do not use `natural` or `compromise` as the primary classifier for Smart Memory.

## Rationale

`wink-nlp` is the best fit for smem's default offline classifier because:

- It is Node/JavaScript native and fits the TypeScript stack.
- It is designed for performance and production NLP pipelines.
- It supports tokenization, sentence detection, POS, NER, sentiment, entities, and custom entities.
- It is much lighter than local transformer models.
- It gives enough structure for topic/intent/signal classification without LLM cost.

`natural` is useful but older and broader in a toolkit style. It is good for TF-IDF/classic classifiers/string similarity, but less ideal as the main event classification layer.

`compromise` is very lightweight and pleasant for English rule-based parsing, but weaker for general classification and multilingual/project-console text.

`Transformers.js` is the strongest for offline semantic embeddings/classification, but it is too heavy for default install because it requires model downloads and larger runtime cost. It should be opt-in for users who want offline vector search.

## Implementation

Implemented command:

```bash
smem classify "chốt dùng SQLite cho database storage"
```

Hook capture now stores `classification` metadata generated offline by `wink-nlp`.

Future optional offline semantic mode:

```text
smem index --provider transformers
smem recall --mode semantic --provider transformers "..."
```

Do not force heavy offline ML models into the default install.

## Planned Classifier Metadata

When `wink-nlp` classifies an event, derived metadata should be marked:

```json
{
  "classifier": {
    "kind": "wink-nlp",
    "version": "<package-version>",
    "confidence": 0.0
  }
}
```

This keeps it distinct from:

```text
smem-rule       -> simple TypeScript rules
llm-extractor   -> future AI/LLM extraction
user-authored   -> explicit smem store
```

## Commands

Current:

```text
smem classify "text to classify"
```

Possible later:

```text
smem classify --provider rules "text"
smem classify --provider wink "text"
smem index --provider transformers
```
