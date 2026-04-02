-- 병원별 거래명세서 업체 등록 테이블
CREATE TABLE IF NOT EXISTS hospital_invoice_vendors (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id         INTEGER NOT NULL,
  vendor_name         TEXT NOT NULL,
  vendor_name_norm    TEXT NOT NULL DEFAULT '',
  description         TEXT DEFAULT '',
  skip_rows           INTEGER DEFAULT 4,
  col_code            INTEGER DEFAULT 0,
  col_name            INTEGER DEFAULT 1,
  col_spec            INTEGER DEFAULT 2,
  col_unit            INTEGER DEFAULT 3,
  col_qty             INTEGER DEFAULT 4,
  col_price           INTEGER DEFAULT 5,
  col_amount          INTEGER DEFAULT 6,
  col_vat             INTEGER DEFAULT 7,
  col_total           INTEGER DEFAULT 8,
  cat_mode            TEXT DEFAULT 'subtotal',
  col_category        INTEGER DEFAULT NULL,
  test_status         TEXT DEFAULT 'untested',
  test_sample_rows    TEXT DEFAULT NULL,
  test_verified_at    DATETIME DEFAULT NULL,
  last_upload_at      DATETIME DEFAULT NULL,
  last_upload_year    INTEGER DEFAULT NULL,
  last_upload_month   INTEGER DEFAULT NULL,
  upload_count        INTEGER DEFAULT 0,
  is_active           INTEGER DEFAULT 1,
  sort_order          INTEGER DEFAULT 0,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, vendor_name_norm),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_hosp_inv_vendors_hospital ON hospital_invoice_vendors(hospital_id);
CREATE INDEX IF NOT EXISTS idx_hosp_inv_vendors_norm ON hospital_invoice_vendors(hospital_id, vendor_name_norm);
