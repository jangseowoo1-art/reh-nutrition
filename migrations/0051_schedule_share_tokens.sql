-- 0051: 직원용 스케줄 공유 토큰 테이블
-- QR코드 기반 개인 스케줄 조회에 사용

CREATE TABLE IF NOT EXISTS schedule_share_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,           -- 랜덤 UUID 토큰
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT DEFAULT NULL,         -- NULL = 영구
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_share_tokens_token ON schedule_share_tokens(token);
CREATE INDEX IF NOT EXISTS idx_share_tokens_emp ON schedule_share_tokens(hospital_id, employee_id);
