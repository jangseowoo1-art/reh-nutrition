-- ── 2.8 잔반 비용 분석: 병원별 잔반 단가 설정 ─────────────────────
-- monthly_settings에 waste_unit_price (kg당 단가) 추가
ALTER TABLE monthly_settings ADD COLUMN waste_unit_price INTEGER DEFAULT 0;
-- waste_unit_price: 잔반 1kg 당 비용 (원), 0이면 수동 입력 방식

-- food_waste_records: waste_kg 컬럼 추가 (kg 단위 입력, 비용은 unit_price*kg 자동계산 or 수동)
-- 이미 waste_amount 컬럼이 있으므로 별도 추가 불필요

-- ── 2.7 주요 식재료 단가 분석: ingredient_prices 테이블 ──────────────
CREATE TABLE IF NOT EXISTS ingredient_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  ingredient_name TEXT NOT NULL,    -- 식재료명 (쌀, 닭고기, 돼지고기, 두부, 계란, 채소류 등)
  unit TEXT DEFAULT 'kg',           -- 단위 (kg, 개, 박스 등)
  unit_price INTEGER DEFAULT 0,     -- 단가 (원)
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, year, month, ingredient_name),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_ingredient_prices_hospital_ym 
  ON ingredient_prices(hospital_id, year, month);

CREATE INDEX IF NOT EXISTS idx_ingredient_prices_name 
  ON ingredient_prices(hospital_id, ingredient_name);
