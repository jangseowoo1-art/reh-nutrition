-- vendor_name 컬럼이 없을 경우 추가 (이미 있으면 무시)
-- ingredient_prices 테이블에 업체별 단가 관리를 위한 vendor_name 지원
-- (0034_ingredient_auto_source.sql에서 이미 추가되었으므로 체크만)

-- 인덱스 추가 (vendor_name 기준 조회 최적화)
CREATE INDEX IF NOT EXISTS idx_ingredient_prices_vendor 
  ON ingredient_prices(hospital_id, vendor_name, year, month);
