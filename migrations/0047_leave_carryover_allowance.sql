-- 연차 이월/수당 지급 관리 컬럼 추가
-- carried_over_days : 전년도에서 이월된 잔여 연차 일수
-- allowance_paid    : 연차수당 지급 여부 (0=미지급, 1=지급완료)
-- allowance_paid_at : 연차수당 지급일

ALTER TABLE employee_leaves ADD COLUMN carried_over_days REAL NOT NULL DEFAULT 0;
ALTER TABLE employee_leaves ADD COLUMN allowance_paid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE employee_leaves ADD COLUMN allowance_paid_at TEXT;
