-- 직원식 세분화: 직원 특식, 직원 야식 추가
-- 기존 '직원 일반식'(preset_staff_regular_1)은 유지하고 2개 항목 추가

-- 직원 특식 추가 (아직 없는 병원에만)
INSERT OR IGNORE INTO diet_categories (
  hospital_id, parent_type, diet_name, diet_key, is_active,
  include_in_meal_price, show_in_input, sort_order, created_at, updated_at
)
SELECT
  h.id,
  'staff',
  '직원 특식',
  'preset_staff_special_1',
  1,
  0,
  1,
  (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM diet_categories WHERE hospital_id = h.id AND parent_type = 'staff'),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM hospitals h
WHERE NOT EXISTS (
  SELECT 1 FROM diet_categories
  WHERE hospital_id = h.id AND diet_key = 'preset_staff_special_1'
);

-- 직원 야식 추가 (아직 없는 병원에만)
INSERT OR IGNORE INTO diet_categories (
  hospital_id, parent_type, diet_name, diet_key, is_active,
  include_in_meal_price, show_in_input, sort_order, created_at, updated_at
)
SELECT
  h.id,
  'staff',
  '직원 야식',
  'preset_staff_night_1',
  1,
  0,
  1,
  (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM diet_categories WHERE hospital_id = h.id AND parent_type = 'staff'),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM hospitals h
WHERE NOT EXISTS (
  SELECT 1 FROM diet_categories
  WHERE hospital_id = h.id AND diet_key = 'preset_staff_night_1'
);
