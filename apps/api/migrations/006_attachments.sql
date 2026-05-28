CREATE TABLE attachments (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  note_id VARCHAR(36) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120),
  size_bytes INTEGER DEFAULT 0,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_attachments_note_id ON attachments (note_id);
CREATE INDEX idx_attachments_user_id ON attachments (user_id);
