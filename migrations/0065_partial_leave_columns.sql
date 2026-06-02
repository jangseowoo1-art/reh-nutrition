-- ════════════════════════════════════════════════════════════════
-- 0065_partial_leave_columns.sql
-- 부분연차/반차 입력 기능(작업 C) 지원용 컬럼 추가
--
-- 대상 테이블: employee_leave_history
--   기존 컬럼(실측): id, hospital_id, employee_id, year, month,
--                    leave_date, leave_subtype, note, created_at
--   → 부분연차/반차 저장에 필요한 4개 컬럼이 없어 ADD COLUMN 으로 추가.
--
-- ⚠️ 안전 규칙 준수:
--   - ADD COLUMN 만 사용 (DROP/DELETE/UPDATE/RESET 없음)
--   - daily_orders / daily_meals / daily_schedules 미변경
--   - 기존 종일 연차 동작(shift_code='연')에 영향 없음
--
-- 추가 컬럼:
--   leave_hours    : 사용 시간 (예: 4) — REAL
--   leave_ratio    : 차감 비율/일수 (leave_hours / standard_hours, 예: 0.5) — REAL
--   leave_period   : 'am' | 'pm' (오전/오후 반차 구분) — TEXT
--   standard_hours : 해당 날짜 근무조 기준시간 (예: 8) — REAL
-- ════════════════════════════════════════════════════════════════

ALTER TABLE employee_leave_history ADD COLUMN leave_hours REAL DEFAULT 0;
ALTER TABLE employee_leave_history ADD COLUMN leave_ratio REAL DEFAULT 0;
ALTER TABLE employee_leave_history ADD COLUMN leave_period TEXT DEFAULT NULL;
ALTER TABLE employee_leave_history ADD COLUMN standard_hours REAL DEFAULT 8;

-- 부분연차 UPSERT 키: (hospital_id, employee_id, leave_date, leave_period)
-- 동일 (직원, 날짜, 오전/오후) 재입력 시 update 되도록 부분 UNIQUE 인덱스 추가.
-- leave_period 가 NULL 인 기존 행(종일연차/경조/병가 등)은 인덱스 대상에서 제외하여
-- 기존 데이터 무결성에 영향 없음.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_history_partial_unique
  ON employee_leave_history(hospital_id, employee_id, leave_date, leave_period)
  WHERE leave_period IS NOT NULL;
