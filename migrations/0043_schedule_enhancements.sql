-- ══════════════════════════════════════════════════════
-- 0043: 스케줄 모듈 고도화 - 급여형태·법적경고설정·모듈ON/OFF
-- ══════════════════════════════════════════════════════

-- 1. 직원 테이블에 급여 형태 필드 추가
ALTER TABLE employees ADD COLUMN salary_type TEXT NOT NULL DEFAULT 'monthly';
-- 'hourly' | 'monthly' | 'annual'
ALTER TABLE employees ADD COLUMN base_salary REAL DEFAULT 0;
-- 시급(hourly) or 월급(monthly) or 연봉(annual) 금액
ALTER TABLE employees ADD COLUMN ot_enabled INTEGER NOT NULL DEFAULT 0;
-- OT/연장수당 계산 사용 여부 (직원 단위)
ALTER TABLE employees ADD COLUMN night_allowance_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN holiday_allowance_enabled INTEGER NOT NULL DEFAULT 0;

-- 2. 병원별 법적근무시간 경고 설정 테이블
CREATE TABLE IF NOT EXISTS hospital_work_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  setting_key TEXT NOT NULL,        -- 설정 키
  setting_value TEXT NOT NULL,      -- 설정 값
  description TEXT DEFAULT '',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, setting_key),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 기본 법적 경고 설정값 주석 (애플리케이션에서 없으면 기본값 사용)
-- daily_max_hours: 8          (1일 최대 근무시간, 초과 시 OT 경고)
-- weekly_max_hours: 52        (주 최대 근무시간)
-- consecutive_max_days: 6     (연속근무 최대일수)
-- leave_cluster_threshold: 3  (연차 쏠림 경고 기준 인원수)
-- legal_warning_enabled: 1    (법적 근무시간 경고 ON/OFF)
-- ot_cost_enabled: 1          (OT/수당 계산 기능 ON/OFF)
-- dispatch_enabled: 1         (파출/알바 관리 기능 ON/OFF)

-- 3. 모듈 ON/OFF 설정 (hospital_work_settings에 포함)
-- 위 테이블의 setting_key 로 관리:
--   'legal_warning_enabled'  → '1' or '0'
--   'ot_cost_enabled'        → '1' or '0'
--   'dispatch_enabled'       → '1' or '0'

-- 4. 연차 이력 상세 테이블 (반차/경조사 횟수 추적)
CREATE TABLE IF NOT EXISTS employee_leave_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  leave_date TEXT NOT NULL,         -- YYYY-MM-DD
  leave_subtype TEXT NOT NULL,      -- 'annual'|'half_am'|'half_pm'|'event'|'sick'
  note TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_leave_history_emp_year
  ON employee_leave_history(hospital_id, employee_id, year);
