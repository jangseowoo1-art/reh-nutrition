-- ════════════════════════════════════════════════════════════════
-- 0042: 인건비 관련 테이블 추가
-- ════════════════════════════════════════════════════════════════

-- 1. 인건비 단가 설정 (병원별)
CREATE TABLE IF NOT EXISTS labor_cost_settings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id   INTEGER NOT NULL,
  cost_type     TEXT    NOT NULL,
  unit_price    REAL    NOT NULL DEFAULT 0,
  description   TEXT    DEFAULT '',
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, cost_type),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 2. 직원별 OT/야간 수당 설정
CREATE TABLE IF NOT EXISTS employee_ot_settings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id     INTEGER NOT NULL,
  employee_id     INTEGER NOT NULL,
  hourly_wage     REAL    DEFAULT 0,
  ot_rate         REAL    DEFAULT 1.5,
  night_rate      REAL    DEFAULT 0.5,
  note            TEXT    DEFAULT '',
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, employee_id),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

-- 3. daily_schedules 컬럼 추가 (SQLite는 IF NOT EXISTS 미지원 → 오류 무시 방식 사용)
ALTER TABLE daily_schedules ADD COLUMN is_night_work INTEGER DEFAULT 0;
ALTER TABLE daily_schedules ADD COLUMN temp_type TEXT DEFAULT NULL;
ALTER TABLE daily_schedules ADD COLUMN temp_hours REAL DEFAULT 0;
