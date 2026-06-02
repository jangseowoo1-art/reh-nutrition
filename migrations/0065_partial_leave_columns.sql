-- ════════════════════════════════════════════════════════════════
-- 0065_partial_leave_columns.sql
-- 부분연차/반차 입력 기능(작업 C) 지원용 인덱스 보강
--
-- 대상 테이블: employee_leave_history
--
-- ⚠️ 중요 — 컬럼 추가는 이 마이그레이션에서 수행하지 않습니다.
--   실측 결과(2026-06-02 --remote PRAGMA 확인):
--     로컬/프로덕션 D1 모두 아래 4개 컬럼이 이미 존재합니다.
--       - leave_hours    (REAL)  : 사용 시간 (예: 4)
--       - standard_hours (REAL)  : 해당 날짜 근무조 기준시간 (예: 8)
--       - leave_ratio    (REAL)  : 차감 비율/일수 (leave_hours / standard_hours, 예: 0.5)
--       - leave_period   (TEXT)  : 'am' | 'pm' (오전/오후 반차 구분)
--   프로덕션에는 위 컬럼이 과거 경로로 이미 추가되어 있었고,
--   d1_migrations 기준 0065 는 프로덕션에 아직 미적용 상태였습니다.
--   SQLite 는 `ADD COLUMN IF NOT EXISTS` 를 지원하지 않으므로,
--   plain `ADD COLUMN` 을 프로덕션에 적용하면 중복 컬럼 오류로
--   마이그레이션 전체가 실패합니다.
--   → 따라서 이 마이그레이션에서는 ADD COLUMN 을 제거하고,
--     양쪽 모두 미존재인 부분 UNIQUE 인덱스만 IF NOT EXISTS 로 생성합니다.
--
-- ✅ 안전 규칙 준수:
--   - ADD COLUMN / DROP / DELETE / UPDATE / RESET / SEED 없음
--   - 운영 데이터 미수정
--   - daily_orders / daily_meals / daily_schedules 미변경
--   - 기존 종일 연차 동작(shift_code='연')에 영향 없음
-- ════════════════════════════════════════════════════════════════

-- 부분연차 UPSERT 키: (hospital_id, employee_id, leave_date, leave_period)
-- 동일 (직원, 날짜, 오전/오후) 재입력 시 update 되도록 부분 UNIQUE 인덱스 추가.
-- leave_period 가 NULL 인 기존 행(종일연차/경조/병가 등)은 인덱스 대상에서 제외하여
-- 기존 데이터 무결성에 영향 없음.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_history_partial_unique
  ON employee_leave_history(hospital_id, employee_id, leave_date, leave_period)
  WHERE leave_period IS NOT NULL;
