-- 스케줄 확정(publish) 인프라 (우선순위4 STEP1)
-- 월별·병원별 스케줄 확정 상태를 저장한다.
-- published_at: 확정 시각(ISO8601), published_by: 확정자 user id
CREATE TABLE IF NOT EXISTS schedule_publish (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_by INTEGER,
  UNIQUE(hospital_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_schedule_publish_hym
  ON schedule_publish(hospital_id, year, month);
