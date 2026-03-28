-- 날짜별 발주일수 설정 테이블 (금액 없이도 발주일수만 저장 가능)
CREATE TABLE IF NOT EXISTS order_multiday_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  order_date TEXT NOT NULL,          -- YYYY-MM-DD (다일치 시작일)
  day_count INTEGER NOT NULL DEFAULT 1, -- 발주일수 (1~7)
  multi_day_end TEXT,                -- 다일치 종료일
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, order_date),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_order_multiday_settings ON order_multiday_settings(hospital_id, order_date);
