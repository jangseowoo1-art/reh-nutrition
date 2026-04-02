-- ── 거래명세서 분류별 분석 기능 확장 마이그레이션 ────────────────────────

-- 1. 업체별 분류명 매핑 저장
CREATE TABLE IF NOT EXISTS invoice_supplier_classifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  vendor_name TEXT NOT NULL,
  category_name TEXT NOT NULL,
  mapped_category_id INTEGER,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, vendor_name, category_name),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 2. transaction_items에 supplier_category 컬럼 추가 (이미 있으면 무시됨)
ALTER TABLE transaction_items ADD COLUMN supplier_category TEXT DEFAULT '';

-- 3. transaction_documents에 거래기간 컬럼 추가 (이미 있으면 무시됨)
ALTER TABLE transaction_documents ADD COLUMN trade_period TEXT DEFAULT '';

-- 4. 인덱스
CREATE INDEX IF NOT EXISTS idx_inv_supplier_cat ON invoice_supplier_classifications(hospital_id, vendor_name);
CREATE INDEX IF NOT EXISTS idx_txitems_supplier_cat ON transaction_items(hospital_id, supplier_category);
