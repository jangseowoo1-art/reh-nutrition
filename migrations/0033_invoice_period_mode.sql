-- ── 거래명세서 기간 관리 개선 ──────────────────────────────────────────
-- hospital_invoice_vendors: 업체별 업로드 방식 설정
--   upload_mode: 'accumulate' (날짜범위 누적) | 'monthly' (월별 단일)
--   period_type: 'auto' (파일에서 자동감지) | 'manual' (사용자 직접 입력)
ALTER TABLE hospital_invoice_vendors ADD COLUMN upload_mode TEXT DEFAULT 'monthly';
ALTER TABLE hospital_invoice_vendors ADD COLUMN period_type TEXT DEFAULT 'auto';

-- transaction_files: 실제 거래 기간 저장
ALTER TABLE transaction_files ADD COLUMN date_from TEXT DEFAULT NULL;  -- 'YYYY-MM-DD'
ALTER TABLE transaction_files ADD COLUMN date_to   TEXT DEFAULT NULL;  -- 'YYYY-MM-DD'

-- transaction_documents: 실제 거래 기간 저장 (분석용)
ALTER TABLE transaction_documents ADD COLUMN date_from TEXT DEFAULT NULL;
ALTER TABLE transaction_documents ADD COLUMN date_to   TEXT DEFAULT NULL;

-- transaction_items: 개별 품목에 날짜 범위 연결 (조회용)
ALTER TABLE transaction_items ADD COLUMN date_from TEXT DEFAULT NULL;
ALTER TABLE transaction_items ADD COLUMN date_to   TEXT DEFAULT NULL;
