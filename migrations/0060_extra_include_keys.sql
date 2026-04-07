-- 카테고리별 추가 포함 항목 설정
-- 특정 카테고리 식단가 계산 시 소모품(supply), 카드(card) 등을 포함할 수 있는 설정
-- 예: 요양 카테고리에 소모품 포함 → extra_include_keys = '["supply"]'
ALTER TABLE hospital_patient_categories ADD COLUMN extra_include_keys TEXT DEFAULT NULL;
