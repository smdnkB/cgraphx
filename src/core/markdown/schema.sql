-- ============================================================
-- Markdown Knowledge Base Schema
-- Independent of cgraphx main schema. Managed via markdown_schema_versions.
-- Idempotent: all CREATE statements use IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS markdown_schema_versions (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS markdown_documents (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    document_type TEXT NOT NULL,
    status TEXT NOT NULL,
    source_type TEXT NOT NULL,
    summary_text TEXT NOT NULL DEFAULT '',
    owners TEXT NOT NULL DEFAULT '[]',
    aliases TEXT NOT NULL DEFAULT '[]',
    related_code TEXT NOT NULL DEFAULT '[]',
    created TEXT,
    updated TEXT,
    indexed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS markdown_concepts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS markdown_domains (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS markdown_tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS markdown_document_concepts (
    document_id TEXT NOT NULL,
    concept_id TEXT NOT NULL,
    PRIMARY KEY (document_id, concept_id),
    FOREIGN KEY (document_id) REFERENCES markdown_documents(id) ON DELETE CASCADE,
    FOREIGN KEY (concept_id) REFERENCES markdown_concepts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS markdown_document_domains (
    document_id TEXT NOT NULL,
    domain_id TEXT NOT NULL,
    PRIMARY KEY (document_id, domain_id),
    FOREIGN KEY (document_id) REFERENCES markdown_documents(id) ON DELETE CASCADE,
    FOREIGN KEY (domain_id) REFERENCES markdown_domains(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS markdown_document_tags (
    document_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (document_id, tag_id),
    FOREIGN KEY (document_id) REFERENCES markdown_documents(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES markdown_tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS markdown_document_references (
    source_document_id TEXT NOT NULL,
    target_document_id TEXT NOT NULL,
    ref_path TEXT NOT NULL,
    PRIMARY KEY (source_document_id, target_document_id),
    FOREIGN KEY (source_document_id) REFERENCES markdown_documents(id) ON DELETE CASCADE,
    FOREIGN KEY (target_document_id) REFERENCES markdown_documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS markdown_skip_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    path TEXT NOT NULL,
    reason TEXT NOT NULL,
    detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_documents_path ON markdown_documents(path);
CREATE INDEX IF NOT EXISTS idx_documents_status_type ON markdown_documents(status, document_type);
CREATE INDEX IF NOT EXISTS idx_doc_concepts_cid ON markdown_document_concepts(concept_id);
CREATE INDEX IF NOT EXISTS idx_doc_domains_did ON markdown_document_domains(domain_id);
CREATE INDEX IF NOT EXISTS idx_doc_tags_tid ON markdown_document_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_doc_refs_target ON markdown_document_references(target_document_id);
CREATE INDEX IF NOT EXISTS idx_skip_log_run ON markdown_skip_log(run_id);

-- Note: keyword search (q parameter in `find`) uses LIKE on title + summary_text
-- instead of FTS5. Rationale: SQLite's default FTS5 tokenizer (unicode61)
-- treats CJK characters as separators, so Chinese queries ("退订", "订单") match
-- nothing. trigram would need >=3-char queries. For the expected scale (tens to
-- a few hundred documents) LIKE on indexed text columns is well within the
-- <100ms budget (spec §7.4) and supports any Unicode substring.

INSERT OR IGNORE INTO markdown_schema_versions (version, applied_at, description)
VALUES (1, strftime('%s', 'now') * 1000, 'Initial markdown knowledge base schema');

-- ============================================================
-- v2: code-impact-init migration — entry point name dedup
-- Persisted Layer 1 dedup state, replaces the original
-- code-impact-graph HTTP /api/exploration/seen-names endpoint.
-- Isolated by project_path (one .cgraphx/cgraphx.db per project).
-- ============================================================

CREATE TABLE IF NOT EXISTS markdown_explored_entry_names (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    normalized_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    UNIQUE (normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_entry_names_norm ON markdown_explored_entry_names(normalized_name);

INSERT OR IGNORE INTO markdown_schema_versions (version, applied_at, description)
VALUES (2, strftime('%s', 'now') * 1000, 'code-impact-init migration: entry name dedup table');
