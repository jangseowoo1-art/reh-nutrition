-- 커스텀 식수 필드에 단위 타입 추가
-- unit_type: 'meal' (식) = 총식수에 포함, 'ea' (개/ea) = 총식수 미포함 (예: 공기밥)
ALTER TABLE meal_custom_fields ADD COLUMN unit_type TEXT DEFAULT 'meal';
