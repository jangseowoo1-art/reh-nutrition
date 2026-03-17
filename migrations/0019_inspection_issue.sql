-- #1 검수 이슈 기록 + 차감 관리 기능
-- daily_orders에 검수 상태 세분화 + 이슈 관련 컬럼 추가

ALTER TABLE daily_orders ADD COLUMN inspection_status TEXT DEFAULT 'pending';
-- pending: 미검수, completed_ok: 검수완료(이슈없음), completed_issue: 검수완료(이슈발생), returned: 반품발생

ALTER TABLE daily_orders ADD COLUMN deduction_amount INTEGER DEFAULT 0;
-- 차감 금액 (발주금액 - 실제입고금액)

-- 검수 이슈 상세 테이블
CREATE TABLE IF NOT EXISTS inspection_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,         -- daily_orders.id
  hospital_id INTEGER NOT NULL,
  vendor_name TEXT,                  -- 업체명 (denormalized)
  item_name TEXT,                    -- 품목명
  issue_type TEXT NOT NULL,          -- 미입고/품질불량/반품/수량부족/단가오류/기타
  issue_detail TEXT,                 -- 이슈 상세 내용
  deduction_amount INTEGER DEFAULT 0,-- 차감 금액
  order_amount INTEGER DEFAULT 0,    -- 발주 금액
  actual_amount INTEGER DEFAULT 0,   -- 실제 입고 금액
  created_at TEXT DEFAULT (datetime('now')),
  created_by TEXT,
  FOREIGN KEY (order_id) REFERENCES daily_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_inspection_issues_hospital ON inspection_issues(hospital_id);
CREATE INDEX IF NOT EXISTS idx_inspection_issues_order ON inspection_issues(order_id);
