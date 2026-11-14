-- Which passages have a vector in the WIKI_VECTORS index, and for which text (sha256). A passage
-- whose text changed, or that is gone or no longer approved, is re-embedded or removed by the job.
CREATE TABLE kb_vectors (chunk_id INTEGER PRIMARY KEY, sha256 TEXT NOT NULL, at INTEGER NOT NULL);
