-- 카테고리별 일일 식수 컬럼 추가 (실시간 식단가 계산에 사용)
ALTER TABLE category_order_settings ADD COLUMN daily_meal_count INTEGER NOT NULL DEFAULT 0;
