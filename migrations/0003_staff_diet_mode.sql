-- 직원식 관리 방식 설정 추가
ALTER TABLE hospital_info ADD COLUMN IF NOT EXISTS staff_diet_mode TEXT DEFAULT 'included';
ALTER TABLE hospital_info ADD COLUMN IF NOT EXISTS staff_diet_target_price INTEGER DEFAULT 0;
ALTER TABLE hospital_info ADD COLUMN IF NOT EXISTS staff_diet_vendor_keys TEXT DEFAULT NULL;
