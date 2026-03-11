-- 병원 온라인 세션 추적 테이블
CREATE TABLE IF NOT EXISTS hospital_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_page TEXT DEFAULT 'dashboard',   -- 현재 보고 있는 페이지
  is_active INTEGER DEFAULT 1,          -- 1: 온라인, 0: 오프라인
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_hospital ON hospital_sessions(hospital_id);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON hospital_sessions(is_active, last_active_at);

-- 잔반 월별 기록 테이블
CREATE TABLE IF NOT EXISTS food_waste_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  week INTEGER NOT NULL DEFAULT 1,      -- 주차 (1~5)
  waste_amount REAL DEFAULT 0,          -- 잔반량 (kg)
  waste_cost INTEGER DEFAULT 0,         -- 잔반 비용 (원)
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, year, month, week),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_food_waste_hospital_ym ON food_waste_records(hospital_id, year, month);
