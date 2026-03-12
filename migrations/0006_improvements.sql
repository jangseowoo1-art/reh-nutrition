-- ════════════════════════════════════════════════════════════════
-- 개선 사항 마이그레이션 (2026-03-12)
-- ════════════════════════════════════════════════════════════════

-- hospital_info: 주종목, 월평균예산 컬럼 (이미 0005에서 추가된 경우 무시)
-- main_category, main_category_custom, monthly_avg_budget 는 0005에서 추가됨

-- hospital_sessions 테이블에 영양사명 컬럼 추가 (없을 경우)
CREATE TABLE IF NOT EXISTS hospital_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  nutritionist_name TEXT,
  last_page TEXT,
  last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_hospital ON hospital_sessions(hospital_id);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON hospital_sessions(last_active_at);

-- close_month_requests 이미 0005에서 생성됨 (IF NOT EXISTS로 안전 처리)
CREATE TABLE IF NOT EXISTS close_month_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME,
  note TEXT,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);
CREATE INDEX IF NOT EXISTS idx_close_requests_status2 ON close_month_requests(status);
CREATE INDEX IF NOT EXISTS idx_close_requests_hospital ON close_month_requests(hospital_id);

-- daily_issues 테이블 (이미 0005에서 생성, IF NOT EXISTS로 안전처리)
CREATE TABLE IF NOT EXISTS daily_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  issue_date TEXT NOT NULL,
  issue_type TEXT NOT NULL DEFAULT 'manual',
  issue_level TEXT NOT NULL DEFAULT 'warning',
  message TEXT NOT NULL,
  extra_data TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);
CREATE INDEX IF NOT EXISTS idx_daily_issues_date2 ON daily_issues(issue_date);
CREATE INDEX IF NOT EXISTS idx_daily_issues_hospital2 ON daily_issues(hospital_id);
