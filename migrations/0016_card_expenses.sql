-- ── 법인카드형 업체 지원 마이그레이션 ─────────────────────────
-- vendors 테이블에 is_card_type 컬럼 추가
ALTER TABLE vendors ADD COLUMN is_card_type INTEGER DEFAULT 0;
-- card_type: 'food'(식재료), 'supplies'(소모품), 'online'(온라인), 'other'(기타)
ALTER TABLE vendors ADD COLUMN card_subtype TEXT DEFAULT NULL;

-- 법인카드 상세 지출 내역 테이블
CREATE TABLE IF NOT EXISTS card_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  vendor_id INTEGER NOT NULL,           -- 어떤 법인카드 업체
  expense_date TEXT NOT NULL,           -- YYYY-MM-DD (사용일)
  vendor_name TEXT NOT NULL,            -- 실제 결제 업체명 (예: 이마트, 쿠팡)
  item_name TEXT NOT NULL,              -- 사용 품목 (예: 식재료, 마스크, 세제)
  purpose TEXT NOT NULL,                -- 구매/진행 용도 (예: 환자식 재료, 방역용품)
  amount INTEGER NOT NULL DEFAULT 0,    -- 금액
  memo TEXT,                            -- 메모 (선택)
  receipt_url TEXT,                     -- 영수증 이미지 URL (추후 확장)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);

CREATE INDEX IF NOT EXISTS idx_card_expenses_hospital_date
  ON card_expenses(hospital_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_card_expenses_vendor_date
  ON card_expenses(vendor_id, expense_date);
