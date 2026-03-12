-- 데일리 이슈 저장 테이블 (3일 자동삭제)
CREATE TABLE IF NOT EXISTS daily_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  issue_date TEXT NOT NULL,         -- YYYY-MM-DD (등록일)
  issue_type TEXT NOT NULL,         -- 'budget_over','vendor_over','daily_over','meal_price_over','manual'
  issue_level TEXT NOT NULL DEFAULT 'warning',  -- 'danger','warning','info'
  message TEXT NOT NULL,
  extra_data TEXT,                  -- JSON 형태 추가 데이터
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);
CREATE INDEX IF NOT EXISTS idx_daily_issues_date ON daily_issues(issue_date);
CREATE INDEX IF NOT EXISTS idx_daily_issues_hospital ON daily_issues(hospital_id);

-- 마감 승인 요청 테이블
CREATE TABLE IF NOT EXISTS close_month_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending','approved','rejected'
  requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME,
  note TEXT,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);
CREATE INDEX IF NOT EXISTS idx_close_requests_status ON close_month_requests(status);

-- 사용자 테이블에 nutritioist_name 컬럼 추가
ALTER TABLE users ADD COLUMN nutritionist_name TEXT;

-- hospital_info에 주종목 및 월평균 예산 컬럼 추가
ALTER TABLE hospital_info ADD COLUMN main_category TEXT DEFAULT 'other';
ALTER TABLE hospital_info ADD COLUMN main_category_custom TEXT;
ALTER TABLE hospital_info ADD COLUMN monthly_avg_budget INTEGER DEFAULT 0;
