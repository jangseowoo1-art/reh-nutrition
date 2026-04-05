-- ================================================================
-- 0057_employee_work_policy.sql
-- 직원별 근무정책 구조 확장
--
-- 📌 설계 원칙:
--   근무정책 = (근무유형 work_type) + (운영방식 schedule_type)
--
-- ① work_type  — 근무 유형 (WHAT)
--   NULL          : 병원 전체 설정 상속 (기본값)
--   'weekly5'     : 주 5일 근무
--   'cycle'       : 순환근무 (N일근무/M일휴무)
--   'monthly_fixed': 월 고정 휴무제
--   'mixed'       : 혼합형
--
-- ② schedule_type  — 운영 방식 (HOW)
--   'flexible'    : 스케줄형 — 자동배치 후 조정 가능 (기본값, 기존 동작)
--   'fixed'       : 고정형  — 패턴 우선, 변경 최소화
--
-- 동작 차이:
--   fixed    → 패턴 유지 우선. 인력기준보다 규칙 고정.
--              재계산 시 수동잠금(lock_flag=1) 자동 적용
--   flexible → 인력기준 우선. 필요 시 패턴 일부 조정 허용.
--              재계산 시 자유롭게 변경 가능
--
-- ③ work_cycle_start_date — 직원 개인 순환 시작일
--   병원 전체 off_cycle_start_date 대신 개인 기준일 사용
--   NULL이면 병원 전체 기준일 사용
--
-- ④ cycle_work_days, cycle_rest_days — 직원 개인 순환 패턴
--   병원 전체 off_cycle_work_days/off_cycle_rest_days 대신 개인 설정
--   NULL이면 병원 전체 설정 사용
-- ================================================================

-- ① 근무 유형 (WHAT): NULL = 병원 설정 상속
ALTER TABLE employees ADD COLUMN work_type TEXT DEFAULT NULL;
-- NULL(상속) | 'weekly5' | 'cycle' | 'monthly_fixed' | 'mixed'

-- ② 운영 방식 (HOW): 'flexible' = 기본(기존 동작 유지)
ALTER TABLE employees ADD COLUMN schedule_type TEXT DEFAULT 'flexible';
-- 'flexible'(스케줄형, 기본) | 'fixed'(고정형)

-- ③ 직원 개인 순환 시작일 (NULL = 병원 기준일 사용)
ALTER TABLE employees ADD COLUMN work_cycle_start_date TEXT DEFAULT NULL;

-- ④ 직원 개인 순환 패턴 일수 (NULL = 병원 설정 사용)
ALTER TABLE employees ADD COLUMN cycle_work_days INTEGER DEFAULT NULL;
ALTER TABLE employees ADD COLUMN cycle_rest_days INTEGER DEFAULT NULL;

-- 인덱스: 근무유형/운영방식 기준 조회 최적화
CREATE INDEX IF NOT EXISTS idx_employees_work_type
  ON employees(hospital_id, work_type);
CREATE INDEX IF NOT EXISTS idx_employees_schedule_type
  ON employees(hospital_id, schedule_type);
