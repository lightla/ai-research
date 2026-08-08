// Secret/PII redaction for raw hook captures — ported from refs/agentmemory's
// functions/privacy.ts. Applied at the exact point raw tool input/output/prompts get written
// to `~/.smart-memory/events/pending.jsonl` (event-queue.ts), because that file is:
// - read back verbatim by `smem raw` / `smem history`
// - fed into `classifyText` (whose extracted keywords/entities land in candidate memory tags)
// - sent to an LLM provider if the optional LLM classifier is enabled
// A leaked API key in a captured bash command or file diff would otherwise flow through all
// three untouched. This is a pure best-effort filter, not a guarantee — it catches known key
// shapes, not arbitrary secrets.

const PRIVATE_TAG_RE = /<private>[\s\S]*?<\/private>/gi;

const SECRET_PATTERNS: RegExp[] = [
  /(?:api[_-]?key|secret|token|password|credential|auth)[\s]*[=:]\s*["']?[A-Za-z0-9_\-/.+]{20,}["']?/gi,
  /Bearer\s+[A-Za-z0-9._\-+/=]{20,}/gi,
  /sk-proj-[A-Za-z0-9\-_]{20,}/g,
  /(?:sk|pk|rk|ak)-[A-Za-z0-9][A-Za-z0-9\-_]{19,}/g,
  /sk-ant-[A-Za-z0-9\-_]{20,}/g,
  /gh[pus]_[A-Za-z0-9]{36,}/g,
  /github_pat_[A-Za-z0-9_]{22,}/g,
  /xoxb-[A-Za-z0-9\-]+/g,
  /AKIA[0-9A-Z]{16}/g,
  /AIza[A-Za-z0-9\-_]{35}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /npm_[A-Za-z0-9]{36}/g,
  /glpat-[A-Za-z0-9\-_]{20,}/g,
  /dop_v1_[A-Za-z0-9]{64}/g
];

/** Redact known secret shapes in a plain string. Also honors an explicit `<private>...</private>` wrap. */
export function redactText(input: string): string {
  let result = input.replace(PRIVATE_TAG_RE, "[REDACTED]");
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED_SECRET]");
  }
  return result;
}

/**
 * Redact secrets inside an arbitrary JSON-shaped value by round-tripping through
 * JSON.stringify -> redactText -> JSON.parse, so nested tool_input/tool_output fields get
 * covered without hand-walking the object tree. Falls back to the original value if the
 * redacted string is no longer valid JSON (should not happen in practice — redaction only
 * replaces matched substrings with equal-or-shorter placeholders inside string values).
 */
export function redactJsonValue<T>(value: T): T {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return value;
  }
  if (serialized === undefined) {
    return value;
  }

  const redacted = redactText(serialized);
  try {
    return JSON.parse(redacted) as T;
  } catch {
    return value;
  }
}
