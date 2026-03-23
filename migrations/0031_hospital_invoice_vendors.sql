-- ── 병원별 거래명세서 업체 등록 테이블 ────────────────────────────────────
-- 병원마다 어떤 업체의 명세서를 사용하는지, 파싱 구조(컬럼 매핑)를 저장
-- 기존 transaction_vendor_templates(글로벌) 대신 병원-업체 단위로 관리

CREATE TABLE IF NOT EXISTS hospital_invoice_vendors (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id         INTEGER NOT NULL,
  vendor_name         TEXT NOT NULL,            -- 업체명 (표시용)
  vendor_name_norm    TEXT NOT NULL,            -- 업체명 정규화 (검색/매칭용)
  description         TEXT DEFAULT '',          -- 업체 설명/메모
  
  -- 파싱 구조 (컬럼 인덱스, 0-based)
  skip_rows           INTEGER DEFAULT 4,        -- 헤더까지 건너뛸 행 수
  col_code            INTEGER DEFAULT 0,        -- 품목코드 열
  col_name            INTEGER DEFAULT 1,        -- 품목명 열
  col_spec            INTEGER DEFAULT 2,        -- 규격 열
  col_unit            INTEGER DEFAULT 3,        -- 단위 열
  col_qty             INTEGER DEFAULT 4,        -- 수량 열
  col_price           INTEGER DEFAULT 5,        -- 단가 열
  col_amount          INTEGER DEFAULT 6,        -- 금액 열
  col_vat             INTEGER DEFAULT 7,        -- 부가세 열
  col_total           INTEGER DEFAULT 8,        -- 합계 열
  
  -- 분류 구분 방식
  cat_mode            TEXT DEFAULT 'subtotal',  -- 'subtotal'|'category_col'|'none'
  col_category        INTEGER DEFAULT NULL,     -- 분류 컬럼 인덱스 (cat_mode='category_col'일 때)
  
  -- 테스트/검증 결과 (샘플 파일 테스트 후 저장)
  test_status         TEXT DEFAULT 'untested',  -- 'untested'|'verified'|'failed'
  test_sample_rows    TEXT DEFAULT NULL,        -- JSON: 테스트 시 파싱된 샘플 행 (최대 3개)
  test_verified_at    DATETIME DEFAULT NULL,    -- 마지막 테스트 통과 시각
  
  -- 최근 업로드 정보
  last_upload_at      DATETIME DEFAULT NULL,    -- 가장 최근 명세서 업로드 시각
  last_upload_year    INTEGER DEFAULT NULL,     -- 가장 최근 업로드 연도
  last_upload_month   INTEGER DEFAULT NULL,     -- 가장 최근 업로드 월
  upload_count        INTEGER DEFAULT 0,        -- 총 업로드 횟수
  
  is_active           INTEGER DEFAULT 1,
  sort_order          INTEGER DEFAULT 0,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(hospital_id, vendor_name_norm),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_hosp_inv_vendors_hospital ON hospital_invoice_vendors(hospital_id);
CREATE INDEX IF NOT EXISTS idx_hosp_inv_vendors_norm ON hospital_invoice_vendors(hospital_id, vendor_name_norm);

-- 기존 transaction_vendor_templates 데이터를 hospital_invoice_vendors로 마이그레이션
-- (hospital_id=1 기본값으로, 나중에 수동 수정 가능)
INSERT OR IGNORE INTO hospital_invoice_vendors 
  (hospital_id, vendor_name, vendor_name_norm, skip_rows,
   col_code, col_name, col_unit, col_qty, col_price, col_amount, col_vat,
   cat_mode)
SELECT 
  1,
  vendor_name,
  vendor_name_normalized,
  skip_rows,
  0,                                        -- col_code (기본값)
  col_item_name,
  col_unit,
  col_qty,
  col_unit_price,
  col_amount,
  col_tax,
  CASE WHEN has_category_rows = 1 THEN 'subtotal' ELSE 'none' END
FROM transaction_vendor_templates;
