CREATE TABLE note_links (
  id VARCHAR(36) PRIMARY KEY,
  source_note_id VARCHAR(36) NOT NULL,
  target_note_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_note_id, target_note_id)
);

CREATE INDEX idx_note_links_source ON note_links (source_note_id);
CREATE INDEX idx_note_links_target ON note_links (target_note_id);
