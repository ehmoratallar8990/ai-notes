ALTER TABLE notes ADD COLUMN pinned BOOLEAN DEFAULT FALSE;
ALTER TABLE notes ADD COLUMN tags JSON;

CREATE INDEX idx_notes_pinned ON notes (user_id, pinned, updated_at DESC);