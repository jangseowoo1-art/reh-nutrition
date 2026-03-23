-- ── 거래명세서 분류별 분석 기능 확장 마이그레이션 ────────────────────────

-- 1. 업체별 분류명 매핑 저장 (동일 업체 파일 업로드 시 분류 재활용)
-- 예: 삼성웰스토리 → "가공식품", "농산물류", "수산/건어물류", "육류"
CREATE TABLE IF NOT EXISTS invoice_supplier_classifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  vendor_name TEXT NOT NULL,
  category_name TEXT NOT NULL,        -- 엑셀 파일 내 분류명 (원본 그대로)
  mapped_category_id INTEGER,         -- transaction_item_categories.id 매핑 (선택)
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, vendor_name, category_name),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 2. transaction_items에 supplier_category(원본 분류명) 컬럼 추가
ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS supplier_category TEXT DEFAULT '';

-- 2-1. SQLite는 IF NOT EXISTS를 ALTER TABLE에서 지원 안 하므로 안전하게 처리
-- (이미 있으면 무시됨 - wrangler D1에서는 에러 무시 처리)

-- 3. transaction_documents에 거래기간 컬럼 추가
ALTER TABLE transaction_documents ADD COLUMN IF NOT EXISTS trade_period TEXT DEFAULT '';

-- 4. 인덱스
CREATE INDEX IF NOT EXISTS idx_inv_supplier_cat ON invoice_supplier_classifications(hospital_id, vendor_name);
CREATE INDEX IF NOT EXISTS idx_txitems_supplier_cat ON transaction_items(hospital_id, supplier_category);
