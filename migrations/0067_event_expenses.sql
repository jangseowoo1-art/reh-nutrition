-- ════════════════════════════════════════════════════════════════
--  이벤트(행사성) 비용 상세 지출 테이블 — 형상관리 편입
-- ----------------------------------------------------------------
--  주의: prod 에는 이미 동일 구조의 event_expenses 테이블이 존재한다.
--  (수동 생성되어 형상관리에서 누락되어 있었음 → 이번에 정식 마이그레이션으로 편입)
--  반드시 CREATE TABLE IF NOT EXISTS 방식으로 적용하여
--  prod 기존 테이블/데이터(아미나 4건, 리엔에이치한방 4건 등)에 영향을 주지 않는다.
--  local / 신규 환경에서는 새로 생성되어 prod 와 동일한 스키마를 갖게 된다.
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS event_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  vendor_id INTEGER NOT NULL,            -- 이벤트 버튼 업체 (모달 주체)
  expense_date TEXT NOT NULL,            -- YYYY-MM-DD (사용일)
  vendor_name TEXT NOT NULL,             -- 실제 구매 업체명 (표시용)
  item_name TEXT NOT NULL,               -- 사용 품목 (예: 특식 재료, 행사 물품)
  purpose TEXT,                          -- 용도 (NULL 허용 — prod 동일)
  amount INTEGER NOT NULL DEFAULT 0,     -- 금액
  memo TEXT,                             -- 메모 (선택)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  row_vendor_id INTEGER REFERENCES vendors(id),  -- 실제 구매 업체 ID (업체 원금 분석용)
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);

CREATE INDEX IF NOT EXISTS idx_event_expenses_hospital_date
  ON event_expenses(hospital_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_event_expenses_vendor_date
  ON event_expenses(vendor_id, expense_date);
