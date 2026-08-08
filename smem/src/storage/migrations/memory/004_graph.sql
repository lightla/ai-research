-- Domain graph: macro (module) and meso (domain_object) entities plus typed relations between
-- them. Class/file/call-level structure is intentionally not modeled here — see the comment on
-- EntityTypeSchema in core/schema.ts for why.

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'local' CHECK (scope IN ('local', 'global')),
  type TEXT NOT NULL CHECK (type IN ('module', 'domain_object', 'decision', 'constraint')),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  code_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, scope, slug)
);

CREATE INDEX IF NOT EXISTS idx_entities_project_scope ON entities(project_id, scope);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);

CREATE TABLE IF NOT EXISTS relations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'local' CHECK (scope IN ('local', 'global')),
  from_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  to_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (
    relation_type IN ('DEPENDS_ON', 'CONTAINS', 'COMMUNICATES_VIA', 'IMPACTS', 'RESOLVES', 'REFERENCES')
  ),
  detail TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, scope, from_entity_id, to_entity_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_relations_project_scope ON relations(project_id, scope);
CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_entity_id);
