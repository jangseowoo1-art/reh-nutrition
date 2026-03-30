-- ══════════════════════════════════════════════════════════════
-- 0044: 인건비 v2 - 스케줄 기반 자동계산 구조
-- ══════════════════════════════════════════════════════════════

-- 1. daily_schedules에 근무시간 자동계산 컬럼 추가
ALTER TABLE daily_schedules ADD COLUMN basic_work_hours   REAL DEFAULT 0;
-- 기본 근무시간 (shift 기반, 휴게 포함 제외)
ALTER TABLE daily_schedules ADD COLUMN night_work_hours   REAL DEFAULT 0;
-- 22:00~06:00 해당 야간 근무시간
ALTER TABLE daily_schedules ADD COLUMN holiday_work_hours REAL DEFAULT 0;
-- 휴일(토/일/공휴일) 근무시간
ALTER TABLE daily_schedules ADD COLUMN weekly_holiday_pay INTEGER DEFAULT 0;
-- 주휴수당 대상 여부 (주 15h 이상 개근 시 1)

-- 2. 파출/알바 스케줄 테이블 (직원 미등록 외부 인력)
CREATE TABLE IF NOT EXISTS dispatch_schedules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id  INTEGER NOT NULL,
  work_date    TEXT    NOT NULL,   -- YYYY-MM-DD
  disp_type    TEXT    NOT NULL,   -- 'dispatch_morning'|'dispatch_afternoon'|'dispatch_fullday'|'parttime_morning'|'parttime_afternoon'|'parttime_fullday'
  count        INTEGER DEFAULT 1, -- 인원 수
  hours        REAL    DEFAULT 0, -- 실 근무시간 (알바 시급 계산용)
  unit_price   REAL    DEFAULT 0, -- 단가 (당일 기준, 0이면 설정값 사용)
  memo         TEXT    DEFAULT '',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_dispatch_sched_hospital_date
  ON dispatch_schedules(hospital_id, work_date);

-- 3. monthly_work_summary 테이블 (월별 집계 캐시)
CREATE TABLE IF NOT EXISTS monthly_work_summary (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id          INTEGER NOT NULL,
  employee_id          INTEGER NOT NULL,
  year                 INTEGER NOT NULL,
  month                INTEGER NOT NULL,
  work_days            INTEGER DEFAULT 0,   -- 실 근무일
  basic_hours          REAL    DEFAULT 0,   -- 기본 근무시간 합계
  ot_hours             REAL    DEFAULT 0,   -- 연장근로 시간
  night_hours          REAL    DEFAULT 0,   -- 야간근로 시간
  holiday_hours        REAL    DEFAULT 0,   -- 휴일근로 시간
  weekly_holiday_days  INTEGER DEFAULT 0,   -- 주휴수당 지급일수
  annual_leave_used    REAL    DEFAULT 0,   -- 연차 사용일
  ot_cost              REAL    DEFAULT 0,   -- OT 수당
  night_cost           REAL    DEFAULT 0,   -- 야간 수당
  holiday_cost         REAL    DEFAULT 0,   -- 휴일 수당
  weekly_holiday_cost  REAL    DEFAULT 0,   -- 주휴수당
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, employee_id, year, month),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_monthly_work_summary
  ON monthly_work_summary(hospital_id, year, month);
