-- ================================================================
-- 0059_initial_setup_columns.sql
-- 초기 도입 셋업용 컬럼 추가
--
-- 📌 목적:
--   초기 도입 병원에서 "발생 자동 세팅 → 사용 보정 → 잔여 확정"
--   3단계 흐름을 지원하기 위한 컬럼
-- ================================================================

-- employee_leaves 에 초기 셋업 관련 컬럼 추가
ALTER TABLE employee_leaves ADD COLUMN initial_used_days REAL NOT NULL DEFAULT 0;
-- 초기 보정 사용분 (관리자가 수동 입력한 과거 사용일수)

ALTER TABLE employee_leaves ADD COLUMN is_initial_setup INTEGER NOT NULL DEFAULT 0;
-- 0 = 일반 운영, 1 = 초기 도입 셋업으로 생성된 레코드

-- hospital_work_settings 에 초기 셋업 완료 여부는
-- setting_key = 'initial_setup_done' / setting_value = '0'|'1' 로 기존 방식 활용
-- (별도 컬럼 추가 불필요)
