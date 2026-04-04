-- 0053: 스케줄 변경 이력 테이블
-- 관리자가 스케줄을 저장할 때 변경된 항목을 기록
CREATE TABLE IF NOT EXISTS schedule_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  work_date TEXT NOT NULL,          -- 'YYYY-MM-DD'
  old_shift_code TEXT,              -- 변경 전 (NULL = 신규 등록)
  new_shift_code TEXT,              -- 변경 후 (NULL = 삭제)
  changed_by INTEGER,               -- 변경한 관리자 user id
  changed_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_change_log_emp ON schedule_change_log(employee_id, work_date);
CREATE INDEX IF NOT EXISTS idx_change_log_hospital ON schedule_change_log(hospital_id, changed_at);
