-- 2.1 발주 검수 완료 관리 기능
-- daily_orders 테이블에 검수 관련 컬럼 추가

ALTER TABLE daily_orders ADD COLUMN order_date_actual TEXT; -- 발주일 (기존 order_date와 별도, 원래 order_date를 입고일로 재정의)
ALTER TABLE daily_orders ADD COLUMN received_date TEXT;      -- 입고일
ALTER TABLE daily_orders ADD COLUMN is_inspected INTEGER DEFAULT 0; -- 검수 완료 여부 (0=미완료, 1=완료)
ALTER TABLE daily_orders ADD COLUMN inspection_memo TEXT;    -- 검수 메모
ALTER TABLE daily_orders ADD COLUMN actual_amount INTEGER DEFAULT 0; -- 실제 입고 금액 (검수 후 확정)
ALTER TABLE daily_orders ADD COLUMN inspected_at TEXT;       -- 검수 완료 시각
ALTER TABLE daily_orders ADD COLUMN inspected_by TEXT;       -- 검수자 (사용자명)

-- 검수 이력 별도 테이블 (선택적 상세 이력용)
CREATE TABLE IF NOT EXISTS order_inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,         -- daily_orders.id
  hospital_id INTEGER NOT NULL,
  inspected_at TEXT NOT NULL,        -- 검수 일시
  inspected_by TEXT,                 -- 검수자
  original_amount INTEGER DEFAULT 0, -- 원래 발주 금액
  actual_amount INTEGER DEFAULT 0,   -- 실제 입고 금액
  difference INTEGER DEFAULT 0,      -- 차이 금액
  memo TEXT,                         -- 검수 메모
  status TEXT DEFAULT 'completed',   -- completed / partial / rejected
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES daily_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_order_inspections_hospital ON order_inspections(hospital_id);
CREATE INDEX IF NOT EXISTS idx_order_inspections_order ON order_inspections(order_id);
CREATE INDEX IF NOT EXISTS idx_daily_orders_inspected ON daily_orders(hospital_id, is_inspected);
