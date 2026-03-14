-- ════════════════════════════════════════════════════════════════
-- 식수 커스텀 필드를 환자군 카테고리와 연동 (마이그레이션)
-- 
-- 변경 사항:
-- 1. meal_custom_fields 기존 데이터 비활성화 (custom1, custom2 등)
-- 2. hospital_patient_categories 기반으로 meal_custom_fields 자동 생성
--    - field_key: cat_{category_key} (예: cat_nursing, cat_cancer)
-- 3. daily_meals.custom_data에서 custom2 키를 cat_nursing으로 변환
--    (각 병원별로 매핑 필요 - 여기선 hospital_id=3 기준)
-- ════════════════════════════════════════════════════════════════

-- 1. 기존 수동 생성 커스텀 필드 비활성화 (cat_ 접두어 없는 것)
UPDATE meal_custom_fields 
SET is_active = 0 
WHERE field_key NOT LIKE 'cat_%';

-- 2. hospital_patient_categories에서 meal_custom_fields 자동 생성
-- (cat_ 접두어로 구분하여 환자군 연동)
INSERT OR IGNORE INTO meal_custom_fields 
  (hospital_id, field_key, field_name, sort_order, is_active, unit_type)
SELECT 
  hospital_id,
  'cat_' || category_key as field_key,
  category_name as field_name,
  sort_order,
  1 as is_active,
  'meal' as unit_type
FROM hospital_patient_categories
WHERE is_active = 1;

-- 기존 cat_ 필드가 있다면 이름/활성 상태 동기화
UPDATE meal_custom_fields 
SET 
  field_name = (
    SELECT hpc.category_name 
    FROM hospital_patient_categories hpc 
    WHERE hpc.hospital_id = meal_custom_fields.hospital_id 
      AND 'cat_' || hpc.category_key = meal_custom_fields.field_key
      AND hpc.is_active = 1
  ),
  is_active = 1
WHERE field_key LIKE 'cat_%'
  AND EXISTS (
    SELECT 1 FROM hospital_patient_categories hpc 
    WHERE hpc.hospital_id = meal_custom_fields.hospital_id 
      AND 'cat_' || hpc.category_key = meal_custom_fields.field_key
      AND hpc.is_active = 1
  );
