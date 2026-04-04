-- 0052: 전체 팀 스케줄 공유 토큰 (직원 전체 근무표 공개용)
CREATE TABLE IF NOT EXISTS team_share_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL UNIQUE,  -- 병원당 1개
  token TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now')),
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_team_tokens_token ON team_share_tokens(token);
