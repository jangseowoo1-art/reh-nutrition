-- ════════════════════════════════════════════════════════════════
-- 식이 분류 구조 개편 (diet_categories)
-- 대분류 4개: patient(환자식) / therapy(치료식) / noncovered(비급여식) / staff(직원식)
-- 중분류: 병원별 ON/OFF, 식수입력 노출 여부, 식단가, 목표금액 설정
-- 기존 hospital_patient_categories + meal_custom_fields 하위호환 유지
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS diet_categories (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id   INTEGER NOT NULL,
  parent_type   TEXT NOT NULL CHECK(parent_type IN ('patient','therapy','noncovered','staff')),
  diet_key      TEXT NOT NULL,          -- 내부 키 (예: 'patient_cancer', 'therapy_renal')
  diet_name     TEXT NOT NULL,          -- 표시 이름 (예: '항암 일반식', '신장식')
  is_active     INTEGER DEFAULT 1,      -- 사용 여부 ON/OFF
  show_in_input INTEGER DEFAULT 1,      -- 식수 입력 화면 노출 여부
  sort_order    INTEGER DEFAULT 0,
  target_meal_price INTEGER DEFAULT 0,  -- 목표 식단가
  monthly_budget    INTEGER DEFAULT 0,  -- 월 목표금액
  legacy_field_key  TEXT DEFAULT NULL,  -- 기존 meal_custom_fields.field_key 연결
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, diet_key),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_diet_categories_hospital ON diet_categories(hospital_id, parent_type, sort_order);
CREATE INDEX IF NOT EXISTS idx_diet_categories_active   ON diet_categories(hospital_id, is_active, show_in_input);

-- ════════════════════════════════════════════════════════════════
-- 기존 데이터 자동 이전
-- hospital_patient_categories → diet_categories (patient 또는 therapy)
-- meal_custom_fields (cat_* 아닌 것) → diet_categories (noncovered)
-- ════════════════════════════════════════════════════════════════

-- 1. hospital_patient_categories → diet_categories
--    기존 category_key → parent_type 매핑
--    cancer/nursing/rehab/traffic/pediatric/mental → patient(환자식)
--    단, 이름에 '경관','유동','저염','당뇨','신장','위절제' 등 치료식 키워드가 있으면 therapy로

INSERT OR IGNORE INTO diet_categories
  (hospital_id, parent_type, diet_key, diet_name, is_active, show_in_input, sort_order, legacy_field_key)
SELECT
  hospital_id,
  CASE
    WHEN category_name LIKE '%경관%' OR category_name LIKE '%유동%'
      OR category_name LIKE '%저염%' OR category_name LIKE '%당뇨%'
      OR category_name LIKE '%신장%' OR category_name LIKE '%위절제%'
      OR category_name LIKE '%저잔사%' OR category_name LIKE '%저요오드%'
      OR category_name LIKE '%저칼륨%' OR category_name LIKE '%저지방%'
      OR category_name LIKE '%고단백%' OR category_name LIKE '%무지방%'
      OR category_name LIKE '%연하%' OR category_name LIKE '%검사식%'
      OR category_name LIKE '%치료%'
    THEN 'therapy'
    WHEN category_name LIKE '%보호자%' OR category_name LIKE '%외래%'
      OR category_name LIKE '%VIP%' OR category_name LIKE '%프리미엄%'
      OR category_name LIKE '%보양%' OR category_name LIKE '%간식%'
      OR category_name LIKE '%특식%'
    THEN 'noncovered'
    WHEN category_name LIKE '%직원%'
    THEN 'staff'
    ELSE 'patient'
  END as parent_type,
  'legacy_' || category_key as diet_key,
  category_name,
  is_active,
  1 as show_in_input,
  sort_order,
  'cat_' || category_key as legacy_field_key
FROM hospital_patient_categories;

-- 2. meal_custom_fields (cat_ 아닌 것, 즉 수동 생성된 것) → diet_categories (noncovered)
INSERT OR IGNORE INTO diet_categories
  (hospital_id, parent_type, diet_key, diet_name, is_active, show_in_input, sort_order, legacy_field_key)
SELECT
  hospital_id,
  'noncovered' as parent_type,
  'legacy_mcf_' || field_key as diet_key,
  field_name,
  is_active,
  1 as show_in_input,
  sort_order,
  field_key as legacy_field_key
FROM meal_custom_fields
WHERE field_key NOT LIKE 'cat_%';

-- 3. category_order_settings에서 식단가/목표금액 가져오기
--    (최근 년도 월 기준)
UPDATE diet_categories
SET
  target_meal_price = COALESCE((
    SELECT cos.target_meal_price
    FROM category_order_settings cos
    JOIN hospital_patient_categories hpc ON cos.patient_category_id = hpc.id
    WHERE hpc.hospital_id = diet_categories.hospital_id
      AND 'cat_' || hpc.category_key = diet_categories.legacy_field_key
    ORDER BY cos.year DESC, cos.month DESC
    LIMIT 1
  ), 0),
  monthly_budget = COALESCE((
    SELECT cos.monthly_budget
    FROM category_order_settings cos
    JOIN hospital_patient_categories hpc ON cos.patient_category_id = hpc.id
    WHERE hpc.hospital_id = diet_categories.hospital_id
      AND 'cat_' || hpc.category_key = diet_categories.legacy_field_key
    ORDER BY cos.year DESC, cos.month DESC
    LIMIT 1
  ), 0)
WHERE legacy_field_key LIKE 'cat_%';

-- ════════════════════════════════════════════════════════════════
-- 기본 식이 분류 프리셋 테이블 (병원에서 불러오기용)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS diet_category_presets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_type TEXT NOT NULL,
  preset_key  TEXT NOT NULL UNIQUE,
  preset_name TEXT NOT NULL,
  sort_order  INTEGER DEFAULT 0
);

-- 환자식 프리셋
INSERT OR IGNORE INTO diet_category_presets (parent_type, preset_key, preset_name, sort_order) VALUES
  ('patient', 'preset_patient_cancer',    '항암 일반식',   1),
  ('patient', 'preset_patient_nursing',   '요양 일반식',   2),
  ('patient', 'preset_patient_rehab',     '재활 일반식',   3),
  ('patient', 'preset_patient_general',   '일반 환자식',   4);

-- 치료식 프리셋
INSERT OR IGNORE INTO diet_category_presets (parent_type, preset_key, preset_name, sort_order) VALUES
  ('therapy', 'preset_therapy_gastrectomy', '위절제식',     1),
  ('therapy', 'preset_therapy_lowresidue',  '저잔사식',     2),
  ('therapy', 'preset_therapy_lowiodine',   '저요오드식',   3),
  ('therapy', 'preset_therapy_lowsalt',     '저염식',       4),
  ('therapy', 'preset_therapy_tube',        '경관식',       5),
  ('therapy', 'preset_therapy_diabetes',    '당뇨식',       6),
  ('therapy', 'preset_therapy_renal',       '신장식',       7),
  ('therapy', 'preset_therapy_lowpotassium','저칼륨식',     8),
  ('therapy', 'preset_therapy_lowfat',      '저지방식',     9),
  ('therapy', 'preset_therapy_highprotein', '고단백식',    10),
  ('therapy', 'preset_therapy_fatfree',     '무지방식',    11),
  ('therapy', 'preset_therapy_dysphagia',   '연하곤란식',  12),
  ('therapy', 'preset_therapy_liquid',      '유동식',      13),
  ('therapy', 'preset_therapy_exam',        '검사식',      14);

-- 비급여식 프리셋
INSERT OR IGNORE INTO diet_category_presets (parent_type, preset_key, preset_name, sort_order) VALUES
  ('noncovered', 'preset_nc_guardian',   '보호자식',   1),
  ('noncovered', 'preset_nc_outpatient', '외래환자식', 2),
  ('noncovered', 'preset_nc_special',    '특식',       3),
  ('noncovered', 'preset_nc_vip',        'VIP식',      4),
  ('noncovered', 'preset_nc_premium',    '프리미엄식', 5),
  ('noncovered', 'preset_nc_tonic',      '보양식',     6),
  ('noncovered', 'preset_nc_snack',      '간식',       7);

-- 직원식 프리셋
INSERT OR IGNORE INTO diet_category_presets (parent_type, preset_key, preset_name, sort_order) VALUES
  ('staff', 'preset_staff_regular', '직원 일반식', 1),
  ('staff', 'preset_staff_special', '직원 특식',   2),
  ('staff', 'preset_staff_night',   '직원 야식',   3);
