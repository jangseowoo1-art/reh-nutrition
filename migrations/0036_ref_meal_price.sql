-- category_order_settings에 기준 식단가(배분용) 컬럼 추가
ALTER TABLE category_order_settings ADD COLUMN ref_meal_price INTEGER DEFAULT 0;
