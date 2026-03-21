-- ════════════════════════════════════════════════════════════════
-- 식이 분류 구조 v3 - 환자군별 일반식/치료식 연결 체계
-- 핵심 변경:
--   1. 치료식(therapy)에 linked_patient_group 추가 → 어느 환자군의 치료식인지 연결
--   2. 비급여식 include_in_meal_price 활성화 (이미 컬럼 존재)
--   3. diet_level 체계 정리:
--      'group'          : 환자군 (항암, 요양, 재활 등) - 식단가 기준 단위
--      'group_normal'   : 환자군 내 일반식 (환자군에 속하는 일반 입원식)
--      'group_therapy'  : 환자군 내 치료식 (환자군에 속하는 치료 세부식)
--      'therapy'        : 환자군 비특정 치료식 (공통 치료식)
--      'noncovered_item': 비급여 세부항목
--      'staff_item'     : 직원식 세부항목
--   4. 비급여 기본 항목 프리셋 추가 (보호자식, 외래환자식, 특식, 공기밥추가, 간식, 기타)
--   5. 치료식 프리셋에 내시경식, 기타치료식 추가
-- ════════════════════════════════════════════════════════════════

-- 1. linked_patient_group 컬럼 추가 (치료식이 어느 환자군에 속하는지)
--    NULL = 특정 환자군에 비특정 / 'cancer' = 항암 환자군의 치료식
ALTER TABLE diet_categories ADD COLUMN linked_patient_group TEXT DEFAULT NULL;

-- 2. 기존 therapy 타입 diet_level 재정리
--    (기존 therapy → diet_level 이미 'therapy'로 세팅됨, 그대로 유지)

-- 3. diet_category_presets에 컬럼 추가
ALTER TABLE diet_category_presets ADD COLUMN linked_patient_group TEXT DEFAULT NULL;

-- 4. 비급여 기본 프리셋 추가 (보호자식, 외래환자식, 특식, 공기밥추가, 간식, 기타)
INSERT OR IGNORE INTO diet_category_presets (parent_type, preset_key, preset_name, sort_order) VALUES
  ('noncovered', 'preset_nc_guardian',    '보호자식',     1),
  ('noncovered', 'preset_nc_outpatient',  '외래환자식',   2),
  ('noncovered', 'preset_nc_special',     '특식',         3),
  ('noncovered', 'preset_nc_rice_extra',  '공기밥추가',   4),
  ('noncovered', 'preset_nc_snack',       '간식',         5),
  ('noncovered', 'preset_nc_other',       '기타',         6);

-- 5. 직원식 프리셋 추가
INSERT OR IGNORE INTO diet_category_presets (parent_type, preset_key, preset_name, sort_order) VALUES
  ('staff', 'preset_staff_general', '직원 일반식', 1),
  ('staff', 'preset_staff_special', '직원 특식',   2),
  ('staff', 'preset_staff_night',   '야간식',      3);

-- 6. 치료식 프리셋 추가 (내시경식, 기타치료식)
INSERT OR IGNORE INTO diet_category_presets (parent_type, preset_key, preset_name, sort_order) VALUES
  ('therapy', 'preset_therapy_endoscopy', '내시경식',   8),
  ('therapy', 'preset_therapy_other',     '기타 치료식', 99);

-- 7. 기존 patient 타입 diet_level='group' 데이터에
--    patient_group 값 세팅 확인 (이미 0025에서 처리됨, 누락분 보완)
UPDATE diet_categories
SET patient_group = CASE
  WHEN diet_name LIKE '%항암%' THEN 'cancer'
  WHEN diet_name LIKE '%요양%' THEN 'nursing'
  WHEN diet_name LIKE '%재활%' THEN 'rehab'
  WHEN diet_name LIKE '%교통%' THEN 'traffic'
  WHEN diet_name LIKE '%정신%' THEN 'mental'
  WHEN diet_name LIKE '%소아%' THEN 'pediatric'
  WHEN diet_name LIKE '%척추%' THEN 'spine'
  WHEN diet_name LIKE '%관절%' THEN 'joint'
  WHEN diet_name LIKE '%심장%' THEN 'cardiac'
  WHEN diet_name LIKE '%투석%' THEN 'dialysis'
  WHEN diet_name LIKE '%뇌졸%' THEN 'stroke'
  WHEN diet_name LIKE '%노인%' THEN 'elderly'
  WHEN diet_name LIKE '%산부%' THEN 'maternity'
  ELSE patient_group
END
WHERE diet_level = 'group' AND (patient_group IS NULL OR patient_group = 'null');

-- 8. 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_diet_categories_linked_group
  ON diet_categories(hospital_id, linked_patient_group);
