-- ================================================================
-- 0058_monthly_leave_system.sql
-- 월차(1년 미만 근무자 월별 유급휴가) 자동 생성 시스템
--
-- 📌 설계 원칙:
--   · employee_leaves 테이블의 leave_type = 'monthly' 로 저장
--   · 월차 발생 이력을 monthly_leave_grants 에 별도 기록
--   · 병원별 월차 정책은 hospital_work_settings 에 키-값으로 저장
--   · 감사 로그(audit log)는 monthly_leave_audit 에 기록
-- ================================================================

-- ─────────────────────────────────────────────────────────────────
-- 1. monthly_leave_grants : 월차 발생 이력 테이블
--    언제, 어느 달의 개근에 대해, 어느 직원에게 월차가 발생했는지
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monthly_leave_grants (
  id                INTEGER  PRIMARY KEY AUTOINCREMENT,
  hospital_id       INTEGER  NOT NULL,
  employee_id       INTEGER  NOT NULL,

  -- 발생 기준 연도/월 (해당 달 개근 확인 후 발생한 달)
  grant_year        INTEGER  NOT NULL,   -- 발생 연도 (예: 2025)
  grant_month       INTEGER  NOT NULL,  -- 발생 월   (예: 3)

  -- 개근 확인 대상 연도/월
  target_year       INTEGER  NOT NULL,  -- 개근 확인 연도
  target_month      INTEGER  NOT NULL, -- 개근 확인 월

  days_granted      REAL     NOT NULL DEFAULT 1,   -- 부여일수 (보통 1.0)
  grant_type        TEXT     NOT NULL DEFAULT 'auto',  -- 'auto' | 'manual'
  status            TEXT     NOT NULL DEFAULT 'active', -- 'active' | 'cancelled' | 'adjusted'

  -- 자동 발생 근거
  attendance_days   INTEGER  DEFAULT NULL,  -- 해당 월 실제 근무일수
  working_days      INTEGER  DEFAULT NULL,  -- 해당 월 소정근로일수
  absence_days      INTEGER  DEFAULT NULL,  -- 결근일수

  note              TEXT     DEFAULT '',
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(hospital_id, employee_id, target_year, target_month),
  FOREIGN KEY (hospital_id)  REFERENCES hospitals(id),
  FOREIGN KEY (employee_id)  REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_monthly_leave_grants_emp
  ON monthly_leave_grants(employee_id, grant_year, grant_month);

CREATE INDEX IF NOT EXISTS idx_monthly_leave_grants_hospital
  ON monthly_leave_grants(hospital_id, grant_year);

-- ─────────────────────────────────────────────────────────────────
-- 2. monthly_leave_audit : 감사 로그
--    월차 발생·사용·수동조정·취소 모든 이벤트 기록
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monthly_leave_audit (
  id            INTEGER  PRIMARY KEY AUTOINCREMENT,
  hospital_id   INTEGER  NOT NULL,
  employee_id   INTEGER  NOT NULL,
  grant_id      INTEGER  DEFAULT NULL,  -- monthly_leave_grants.id

  action        TEXT     NOT NULL,
  -- 'auto_grant'    : 자동 월차 발생
  -- 'manual_grant'  : 수동 월차 발생
  -- 'manual_adjust' : 수동 조정 (일수 변경)
  -- 'cancel'        : 취소
  -- 'used'          : 사용 (스케줄에 연차코드 입력 시)
  -- 'policy_change' : 병원 정책 변경으로 재계산

  before_value  TEXT     DEFAULT NULL,  -- 변경 전 값 (JSON)
  after_value   TEXT     DEFAULT NULL,  -- 변경 후 값 (JSON)
  actor_id      INTEGER  DEFAULT NULL,  -- 실행한 사용자 ID (NULL=시스템)
  actor_role    TEXT     DEFAULT NULL,  -- 'system'|'admin'|'hospital'
  reason        TEXT     DEFAULT '',    -- 변경 사유

  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (hospital_id)  REFERENCES hospitals(id),
  FOREIGN KEY (employee_id)  REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_monthly_leave_audit_emp
  ON monthly_leave_audit(employee_id, created_at);

CREATE INDEX IF NOT EXISTS idx_monthly_leave_audit_hospital
  ON monthly_leave_audit(hospital_id, created_at);

-- ─────────────────────────────────────────────────────────────────
-- 3. employee_leaves 에 monthly leave_type 이미 허용됨
--    (leave_type TEXT NOT NULL DEFAULT 'annual')
--    'monthly' 값 추가 사용 — 스키마 변경 불필요
--
--    단, 월차용 연도는 입사연도를 기준으로 하므로
--    (입사 첫 해 = 1, 두 번째 해 = 2...) 가 아니라
--    실제 calendar year 사용
-- ─────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────
-- 4. hospital_work_settings 에 월차 정책 키 추가
--    (기존 키-값 방식 그대로 활용)
--    키 목록:
--      monthly_leave_enabled      : '1' | '0'  (월차 자동 생성 ON/OFF)
--      monthly_leave_attendance_rule : 'full'(개근필수) | 'partial'(결근 0일) | 'ratio'(출근율%)
--      monthly_leave_attendance_ratio : 숫자(%) (ratio 방식일 때)
--      monthly_leave_max_days     : '11' (최대 발생일수, 보통 11일)
--      monthly_leave_auto_transition : '1' | '0' (1년 도달 시 연차로 자동 전환)
-- ─────────────────────────────────────────────────────────────────
-- 별도 INSERT 없음 — saveWorkSettings API 에서 upsert 처리

-- ─────────────────────────────────────────────────────────────────
-- 5. 월차 정보 조회 뷰 (편의용)
-- ─────────────────────────────────────────────────────────────────
CREATE VIEW IF NOT EXISTS v_monthly_leave_summary AS
SELECT
  el.hospital_id,
  el.employee_id,
  e.name                   AS emp_name,
  e.hire_date,
  el.year,
  el.total_days            AS monthly_total,
  el.used_days             AS monthly_used,
  (el.total_days - el.used_days) AS monthly_remain,
  el.note,
  el.updated_at
FROM employee_leaves el
JOIN employees e ON e.id = el.employee_id
WHERE el.leave_type = 'monthly';
