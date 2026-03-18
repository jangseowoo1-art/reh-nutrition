-- ── 거래명세서 분석 시스템 마이그레이션 ─────────────────────────────────────
-- 1단계 MVP: 엑셀/텍스트PDF 업로드, 파싱, 월별 분석, 카테고리, 발주 교차분석 구조
-- 병원별 데이터 완전 분리 (hospital_id 필수)

-- ─────────────────────────────────────────────
-- 1. 품목 카테고리 마스터 테이블
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transaction_item_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,          -- 채소, 육류, 수산, 곡류, 소모품, 기타 등
  code TEXT NOT NULL UNIQUE,          -- VEGGIE, MEAT, SEAFOOD, GRAIN, SUPPLIES, OTHER
  color TEXT DEFAULT '#6b7280',       -- 차트 표시용 색상
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 기본 카테고리 데이터 삽입
INSERT OR IGNORE INTO transaction_item_categories (name, code, color, sort_order) VALUES
  ('채소류', 'VEGGIE',   '#22c55e', 1),
  ('육류',   'MEAT',     '#ef4444', 2),
  ('수산물', 'SEAFOOD',  '#3b82f6', 3),
  ('곡류',   'GRAIN',    '#f59e0b', 4),
  ('유제품', 'DAIRY',    '#a855f7', 5),
  ('가공식품','PROCESSED','#f97316', 6),
  ('소모품', 'SUPPLIES', '#6b7280', 7),
  ('기타',   'OTHER',    '#94a3b8', 8);

-- ─────────────────────────────────────────────
-- 2. 업로드 파일 원본 정보
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transaction_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,            -- 원본 파일명
  file_type TEXT NOT NULL,            -- xlsx, pdf
  file_size INTEGER DEFAULT 0,        -- 바이트 단위
  file_data TEXT,                     -- Base64 인코딩 (소형 파일) or 참조 경로
  vendor_name TEXT,                   -- 업체명 (사용자 입력 또는 자동감지)
  document_year INTEGER,              -- 명세서 연도 (YYYY)
  document_month INTEGER,             -- 명세서 월 (1~12)
  parse_status TEXT DEFAULT 'pending', -- pending/processing/completed/failed
  parse_error TEXT,                   -- 파싱 오류 메시지
  row_count INTEGER DEFAULT 0,        -- 파싱된 항목 수
  uploaded_by TEXT DEFAULT 'admin',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_txfiles_hospital_date
  ON transaction_files(hospital_id, document_year, document_month);
CREATE INDEX IF NOT EXISTS idx_txfiles_vendor
  ON transaction_files(hospital_id, vendor_name);

-- ─────────────────────────────────────────────
-- 3. 파싱된 명세서 문서 정보
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transaction_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL,
  hospital_id INTEGER NOT NULL,
  vendor_name TEXT NOT NULL,          -- 공급 업체명
  document_date TEXT,                 -- 명세서 날짜 (YYYY-MM-DD)
  document_number TEXT,               -- 거래명세서 번호
  document_year INTEGER NOT NULL,
  document_month INTEGER NOT NULL,
  total_amount INTEGER DEFAULT 0,     -- 합계금액 (원)
  taxable_amount INTEGER DEFAULT 0,   -- 과세 금액
  tax_amount INTEGER DEFAULT 0,       -- 세액
  nontaxable_amount INTEGER DEFAULT 0,-- 면세 금액
  item_count INTEGER DEFAULT 0,       -- 품목 수
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (file_id) REFERENCES transaction_files(id) ON DELETE CASCADE,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_txdocs_hospital_date
  ON transaction_documents(hospital_id, document_year, document_month);
CREATE INDEX IF NOT EXISTS idx_txdocs_vendor
  ON transaction_documents(hospital_id, vendor_name);

-- ─────────────────────────────────────────────
-- 4. 개별 품목 상세 (핵심 분석 단위)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transaction_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  file_id INTEGER NOT NULL,
  hospital_id INTEGER NOT NULL,
  vendor_name TEXT NOT NULL,
  document_year INTEGER NOT NULL,
  document_month INTEGER NOT NULL,
  item_name TEXT NOT NULL,            -- 품목명 (정규화 전 원본)
  item_name_normalized TEXT,          -- 정규화된 품목명 (예: 양파 → 양파)
  category_id INTEGER,                -- transaction_item_categories.id
  quantity REAL DEFAULT 0,            -- 수량
  unit TEXT DEFAULT '',               -- 단위 (kg, g, 개, 박스 등)
  unit_price INTEGER DEFAULT 0,       -- 단가 (원)
  amount INTEGER DEFAULT 0,           -- 금액 = quantity × unit_price
  tax_type TEXT DEFAULT 'taxable',    -- taxable(과세) / nontaxable(면세) / exempt(영세)
  tax_amount INTEGER DEFAULT 0,       -- 세액
  raw_row TEXT,                       -- 파싱 원본 행 (JSON 문자열, 검증용)
  is_verified INTEGER DEFAULT 0,      -- 사용자 검증 여부
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES transaction_documents(id) ON DELETE CASCADE,
  FOREIGN KEY (file_id) REFERENCES transaction_files(id) ON DELETE CASCADE,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (category_id) REFERENCES transaction_item_categories(id)
);

CREATE INDEX IF NOT EXISTS idx_txitems_hospital_date
  ON transaction_items(hospital_id, document_year, document_month);
CREATE INDEX IF NOT EXISTS idx_txitems_vendor
  ON transaction_items(hospital_id, vendor_name);
CREATE INDEX IF NOT EXISTS idx_txitems_category
  ON transaction_items(hospital_id, category_id);
CREATE INDEX IF NOT EXISTS idx_txitems_name
  ON transaction_items(hospital_id, item_name_normalized);

-- ─────────────────────────────────────────────
-- 5. AI 분석 결과 저장
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transaction_ai_analysis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  analysis_year INTEGER NOT NULL,
  analysis_month INTEGER NOT NULL,
  analysis_type TEXT NOT NULL,        -- monthly / quarterly / annual / cross_order
  total_amount INTEGER DEFAULT 0,
  taxable_ratio REAL DEFAULT 0,       -- 과세 비율 (0~1)
  top_vendor TEXT,                    -- 최다 발주 업체명
  top_vendor_ratio REAL DEFAULT 0,    -- 최다 업체 집중도 (0~1)
  top_items TEXT,                     -- JSON: [{name, amount, category}]
  category_breakdown TEXT,            -- JSON: {채소류:amount, 육류:amount, ...}
  monthly_comparison TEXT,            -- JSON: 전월 대비 변화율
  -- AI 알림 항목 (규칙 기반)
  alert_price_rise TEXT,              -- JSON: 가격 10%+ 상승 품목 목록
  alert_qty_surge TEXT,               -- JSON: 구매량 2배+ 급증 품목 목록
  alert_vendor_concentration TEXT,    -- JSON: 업체 집중도 경고
  alert_tax_change TEXT,              -- JSON: 과세 구조 변화
  alert_missing_data TEXT,            -- JSON: 누락 데이터 항목
  -- 발주 교차 분석
  cross_analysis_summary TEXT,        -- JSON: 발주 vs 명세서 차이 요약
  cross_discrepancies TEXT,           -- JSON: [{item, ordered_qty, invoice_qty, diff}]
  analysis_text TEXT,                 -- AI 분석 요약 텍스트 (한국어)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_txai_hospital_date
  ON transaction_ai_analysis(hospital_id, analysis_year, analysis_month);

-- ─────────────────────────────────────────────
-- 6. 발주-명세서 교차 분석 상세 (3단계용 구조 선제 생성)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transaction_order_cross (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  cross_year INTEGER NOT NULL,
  cross_month INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  item_name_normalized TEXT,
  vendor_name TEXT,
  -- 발주 데이터 (orders 테이블에서 집계)
  ordered_quantity REAL DEFAULT 0,
  ordered_unit_price INTEGER DEFAULT 0,
  ordered_amount INTEGER DEFAULT 0,
  -- 명세서 데이터 (transaction_items에서 집계)
  invoice_quantity REAL DEFAULT 0,
  invoice_unit_price INTEGER DEFAULT 0,
  invoice_amount INTEGER DEFAULT 0,
  -- 차이 분석
  qty_diff REAL DEFAULT 0,            -- invoice - ordered
  qty_diff_ratio REAL DEFAULT 0,      -- 차이 비율 (%)
  price_diff INTEGER DEFAULT 0,       -- 단가 차이
  price_diff_ratio REAL DEFAULT 0,    -- 단가 차이 비율 (%)
  amount_diff INTEGER DEFAULT 0,      -- 금액 차이
  alert_level TEXT DEFAULT 'normal',  -- normal / warning / critical
  alert_memo TEXT,                    -- 경고 메시지
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_txcross_hospital_date
  ON transaction_order_cross(hospital_id, cross_year, cross_month);
