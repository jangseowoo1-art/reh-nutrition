-- 카테고리별 소모품/카드 식단가 반영 설정
-- budget_include_supply: 이 카테고리 식단가 계산에 소모품 발주 포함 여부 (0=제외, 1=포함)
-- budget_include_card: 이 카테고리 식단가 계산에 카드 발주 포함 여부 (0=제외, 1=포함)
ALTER TABLE hospital_patient_categories ADD COLUMN budget_include_supply INTEGER DEFAULT 0;
ALTER TABLE hospital_patient_categories ADD COLUMN budget_include_card INTEGER DEFAULT 0;
