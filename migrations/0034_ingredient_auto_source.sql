-- ingredient_prices 테이블에 source 컬럼 추가
-- source: 'manual'(수동입력), 'auto'(거래명세서 자동추출)
ALTER TABLE ingredient_prices ADD COLUMN source TEXT DEFAULT 'manual';
ALTER TABLE ingredient_prices ADD COLUMN total_amount INTEGER DEFAULT 0;
ALTER TABLE ingredient_prices ADD COLUMN total_quantity REAL DEFAULT 0;
ALTER TABLE ingredient_prices ADD COLUMN vendor_name TEXT DEFAULT '';
