-- ════════════════════════════════════════════════════════════════
-- 식이 분류 구조 v2 개편
-- 핵심 변경:
--   1. patient_group   : 환자군 (항암/요양/재활 등) - 식단가 기준 단위
--   2. diet_level      : 'group'(환자군) | 'normal'(일반식) | 'therapy'(치료식)
--   3. include_in_meal_price : 비급여 항목 중 식단가 계산에 포함할지 여부
-- ════════════════════════════════════════════════════════════════

-- 1. 컬럼 추가
ALTER TABLE diet_categories ADD COLUMN patient_group TEXT DEFAULT NULL;
-- 환자군 소속 (예: 'cancer','nursing','rehab' / therapy인 경우 null)

ALTER TABLE diet_categories ADD COLUMN diet_level TEXT DEFAULT 'group';
-- 'group'  : 환자군 자체 (항암, 요양, 재활 등) - 식단가 설정 대상
-- 'normal' : 환자군 내 일반식 (기존 patient 타입)
-- 'therapy': 치료식 세부 항목
-- 'noncovered_item': 비급여 세부 항목

ALTER TABLE diet_categories ADD COLUMN include_in_meal_price INTEGER DEFAULT 0;
-- 0: 식단가 계산 제외 (기본)
-- 1: 식단가 계산 포함 (비급여 중 선택 항목)

-- 2. 기존 patient 타입 → diet_level 정리
--    기존 parent_type='patient' → diet_level='group' (환자군 그 자체가 식단가 기준)
UPDATE diet_categories SET diet_level = 'group' WHERE parent_type = 'patient';

--    기존 parent_type='therapy' → diet_level='therapy'
UPDATE diet_categories SET diet_level = 'therapy' WHERE parent_type = 'therapy';

--    기존 parent_type='noncovered' → diet_level='noncovered_item'
UPDATE diet_categories SET diet_level = 'noncovered_item' WHERE parent_type = 'noncovered';

--    기존 parent_type='staff' → diet_level='staff_item'
UPDATE diet_categories SET diet_level = 'staff_item' WHERE parent_type = 'staff';

-- 3. 기존 환자군(group) 데이터에 patient_group 자기참조 세팅 (legacy_field_key 기반)
UPDATE diet_categories 
SET patient_group = REPLACE(legacy_field_key, 'cat_', '')
WHERE diet_level = 'group' AND legacy_field_key LIKE 'cat_%';

-- 4. 기존 치료식 → patient_group NULL (치료식은 환자군 미분류)
-- (이미 NULL이므로 그대로)

-- ════════════════════════════════════════════════════════════════
-- 비급여 식단가 반영 설정 테이블
-- 병원별로 어떤 비급여 항목을 식단가에 포함할지 저장
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS hospital_meal_price_settings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id   INTEGER NOT NULL,
  -- 비급여 식단가 포함 항목 (diet_categories.id JSON 배열)
  noncovered_include_ids TEXT DEFAULT '[]',
  -- 식수 계산에 포함할 기본 항목 (staff/guardian 등)
  base_include_keys      TEXT DEFAULT '["staff","guardian"]',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_diet_categories_level ON diet_categories(hospital_id, diet_level, is_active);
CREATE INDEX IF NOT EXISTS idx_diet_categories_group ON diet_categories(hospital_id, patient_group);
