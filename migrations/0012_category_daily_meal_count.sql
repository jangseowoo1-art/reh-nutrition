-- 카테고리별 일일 식수 컬럼 추가 (실시간 식단가 계산에 사용)
-- IF NOT EXISTS는 SQLite ALTER TABLE에서 지원하지 않으므로 아래처럼 처리
ALTER TABLE category_order_settings ADD COLUMN daily_meal_count INTEGER DEFAULT 0;
