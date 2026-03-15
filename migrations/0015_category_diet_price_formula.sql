-- 카테고리별 식단가 계산 기준 설정
-- budget_include_keys: JSON 배열 - 예산에 포함할 카테고리 키 목록
--   예: ["cancer","nursing"] (NULL = 전체 예산 포함)
-- meals_include_keys: JSON 배열 - 식수에 포함할 항목 키 목록
--   예: ["cat_cancer","staff","guardian"] (NULL = 전체 식수)
--   가능한 키: cat_{category_key} (환자군별 식수), staff (직원), guardian (보호자), noncovered (비급여)

ALTER TABLE hospital_patient_categories 
ADD COLUMN budget_include_keys TEXT DEFAULT NULL;

ALTER TABLE hospital_patient_categories 
ADD COLUMN meals_include_keys TEXT DEFAULT NULL;
