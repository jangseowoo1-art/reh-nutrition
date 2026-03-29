-- 부주방장 삭제 (요청서에 없는 직책)
DELETE FROM employee_positions WHERE name = '부주방장';

-- 조리보조 → 조리원으로 이름 변경
UPDATE employee_positions SET name = '조리원' WHERE name = '조리보조';

-- employees 테이블에서도 포지션 이름 참조 업데이트 (혹시 직접 저장된 경우)
UPDATE employees SET position = '조리원' WHERE position = '조리보조';

-- work_parts 컬럼 추가 (근무 가능 파트, 이미 있으면 무시)
-- ALTER TABLE employees ADD COLUMN work_parts TEXT DEFAULT '';
