-- ================================================================
-- 0055_employee_holiday_policy.sql
-- Phase D: 직원별 공휴일 정책 예외 구조
--
-- 설계 원칙:
--   - 병원 전체 기본값(holiday_policy) 위에 직원별 오버라이드 적용
--   - 오버라이드 없으면 병원 기본값 그대로 사용
--   - holiday_policy_override = NULL  → 병원 기본값 사용 (inherit)
--   - holiday_policy_override = 'off' | 'work_pay' | 'work_substitute'
--                                    → 해당 직원에 개별 적용
--
-- employee_holiday_exceptions 테이블:
--   특정 날짜에 직원별 특수 처리 기록 (수당 지급 확인, 대체일 지정 등)
-- ================================================================

-- ① employees 테이블에 holiday_policy_override 컬럼 추가
ALTER TABLE employees ADD COLUMN holiday_policy_override TEXT DEFAULT NULL;
-- 값: NULL(병원기본값 상속) | 'off' | 'work_pay' | 'work_substitute'

-- ② 직원별 공휴일 예외 처리 이력 테이블
--    특정 공휴일에 개별 직원의 실제 처리 결과를 기록
CREATE TABLE IF NOT EXISTS employee_holiday_exceptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id     INTEGER NOT NULL,
  employee_id     INTEGER NOT NULL,
  holiday_date    TEXT    NOT NULL,   -- YYYY-MM-DD
  holiday_name    TEXT,               -- 공휴일명
  -- 실제 적용 정책 (병원기본 or 직원오버라이드)
  applied_policy  TEXT    NOT NULL DEFAULT 'off',
  -- 'off'            : 공휴일 휴무
  -- 'work_pay'       : 공휴일 근무 + 수당 지급
  -- 'work_substitute': 공휴일 근무 + 대체휴무 생성
  -- 수당/대체 처리 상태
  allowance_paid  INTEGER DEFAULT 0,   -- 수당 지급 여부 (work_pay 시)
  substitute_date TEXT    DEFAULT NULL, -- 대체휴무 날짜 (work_substitute 시)
  -- 메타
  policy_source   TEXT    DEFAULT 'hospital',
  -- 'hospital' : 병원 기본값 그대로 적용
  -- 'override' : 직원 개별 오버라이드 적용
  note            TEXT,
  created_by      TEXT    NOT NULL DEFAULT 'system',
  created_at      DATETIME DEFAULT (datetime('now','localtime')),
  updated_at      DATETIME DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  UNIQUE(hospital_id, employee_id, holiday_date)
);

CREATE INDEX IF NOT EXISTS idx_ehe_hospital_date
  ON employee_holiday_exceptions(hospital_id, holiday_date);
CREATE INDEX IF NOT EXISTS idx_ehe_employee
  ON employee_holiday_exceptions(employee_id, holiday_date);

-- ③ off_grant_history 에 employee_id 인덱스 보강 (이미 있으면 무시)
CREATE INDEX IF NOT EXISTS idx_ogh_emp_date
  ON off_grant_history(employee_id, target_date);
