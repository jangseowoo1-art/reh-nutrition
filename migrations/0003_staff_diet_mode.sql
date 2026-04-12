-- 직원식 관리 방식 설정 추가
-- SQLite는 ADD COLUMN IF NOT EXISTS 미지원 → 이미 적용된 경우 에러 무시
ALTER TABLE hospital_info ADD COLUMN staff_diet_mode TEXT DEFAULT 'included';
ALTER TABLE hospital_info ADD COLUMN staff_diet_target_price INTEGER DEFAULT 0;
ALTER TABLE hospital_info ADD COLUMN staff_diet_vendor_keys TEXT DEFAULT NULL;
