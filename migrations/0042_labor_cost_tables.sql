-- ════════════════════════════════════════════════════════════════
-- 0042: 인건비 관련 테이블 추가
--   1) labor_cost_settings  : 파출/알바 단가, OT 기본 수당 설정
--   2) ot_allowance_settings: 직원별(또는 병원별) OT/야간 수당 설정
-- ════════════════════════════════════════════════════════════════

-- 1. 인건비 단가 설정 (병원별)
CREATE TABLE IF NOT EXISTS labor_cost_settings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id   INTEGER NOT NULL,
  cost_type     TEXT    NOT NULL,   -- 'dispatch_morning','dispatch_afternoon','dispatch_9h','dispatch_12h',
                                    -- 'parttime_hourly','ot_basic_rate','ot_night_rate'
  unit_price    REAL    NOT NULL DEFAULT 0,  -- 원 단위
  description   TEXT    DEFAULT '',
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, cost_type),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 2. 직원별 OT/야간 수당 설정 (개인 단가가 다를 경우)
CREATE TABLE IF NOT EXISTS employee_ot_settings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id     INTEGER NOT NULL,
  employee_id     INTEGER NOT NULL,
  hourly_wage     REAL    DEFAULT 0,    -- 시간당 기본급
  ot_rate         REAL    DEFAULT 1.5,  -- OT 배율 (기본 1.5배)
  night_rate      REAL    DEFAULT 0.5,  -- 야간 가산율 (기본 +0.5)
  note            TEXT    DEFAULT '',
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, employee_id),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

-- 3. daily_schedules에 야간근무 플래그, 파출/알바 구분 컬럼 추가
ALTER TABLE daily_schedules ADD COLUMN IF NOT EXISTS is_night_work INTEGER DEFAULT 0;
ALTER TABLE daily_schedules ADD COLUMN IF NOT EXISTS temp_type TEXT DEFAULT NULL; -- 'dispatch_morning','dispatch_afternoon','dispatch_9h','dispatch_12h','parttime'
ALTER TABLE daily_schedules ADD COLUMN IF NOT EXISTS temp_hours REAL DEFAULT 0;   -- 알바 근무시간
