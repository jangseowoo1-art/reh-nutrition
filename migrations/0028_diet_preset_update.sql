-- 환자식 프리셋 이름 변경
UPDATE diet_category_presets SET preset_name='항암식' WHERE preset_key='preset_patient_cancer';
UPDATE diet_category_presets SET preset_name='요양식' WHERE preset_key='preset_patient_nursing';
UPDATE diet_category_presets SET preset_name='재활식' WHERE preset_key='preset_patient_rehab';
UPDATE diet_category_presets SET preset_name='일반식' WHERE preset_key='preset_patient_general';

-- 직원식 중복 프리셋 제거 (preset_staff_regular 삭제, preset_staff_general 유지)
DELETE FROM diet_category_presets WHERE preset_key='preset_staff_regular';

-- 비급여식 프리셋 추가
INSERT OR IGNORE INTO diet_category_presets (parent_type, preset_key, preset_name, sort_order) VALUES
  ('noncovered', 'preset_nc_cancer_guardian',  '항암 보호자식', 8),
  ('noncovered', 'preset_nc_rehab_guardian',   '재활 보호자식', 9),
  ('noncovered', 'preset_nc_nursing_guardian', '요양 보호자식', 10),
  ('noncovered', 'preset_nc_caregiver',        '간병사',        11);
