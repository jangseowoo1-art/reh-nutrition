-- ════════════════════════════════════════════════════════════════
-- 병원 상세정보 테이블
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS hospital_info (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER UNIQUE NOT NULL,
  -- 기본 정보
  hospital_type TEXT DEFAULT 'general',  -- general(종합)/oriental(한방)/nursing(요양)/rehab(재활)/clinic(의원)/care_facility(요양원)
  address TEXT,
  -- 규모 정보
  licensed_beds INTEGER DEFAULT 0,       -- 허가 병상수
  avg_inpatients INTEGER DEFAULT 0,      -- 평균 입원 환자수
  staff_count INTEGER DEFAULT 0,         -- 급식 대상 직원수
  guardian_ratio REAL DEFAULT 0,         -- 보호자 동반 비율(%)
  -- 급식 운영
  operation_type TEXT DEFAULT 'direct',  -- direct(직영)/consignment(위탁)
  consignment_company TEXT,              -- 위탁업체명
  meals_per_day INTEGER DEFAULT 3,       -- 1일 급식횟수
  current_meal_price INTEGER DEFAULT 0,  -- 현재 식단가
  target_meal_price INTEGER DEFAULT 0,   -- 목표 식단가
  supply_method TEXT DEFAULT 'mixed',    -- direct(직납)/market(시장)/mixed(혼합)
  -- 예산 기준
  annual_budget INTEGER DEFAULT 0,       -- 연간 총 급식예산
  -- 담당자
  dietitian_name TEXT,                   -- 영양사 이름
  dietitian_phone TEXT,                  -- 영양사 연락처
  admin_memo TEXT,                       -- 관리자 메모
  -- 월 마감 상태
  current_year INTEGER,                  -- 현재 활성 년도
  current_month INTEGER,                 -- 현재 활성 월
  closing_status TEXT DEFAULT 'open',    -- open/requested/closed
  closing_requested_at DATETIME,         -- 마감 요청 시각
  closing_approved_at DATETIME,          -- 마감 승인 시각
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- ════════════════════════════════════════════════════════════════
-- 병원별 카테고리 예산 목표 테이블 (월별)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS category_budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  category TEXT NOT NULL,               -- major/meat/seafood/fruit/organic/delivery/market/event/card/supply/general
  monthly_budget INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, year, month, category),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- ════════════════════════════════════════════════════════════════
-- 월 마감 이력 테이블
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS monthly_closings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  status TEXT DEFAULT 'open',           -- open/requested/approved
  requested_at DATETIME,
  requested_by INTEGER,                 -- user_id
  approved_at DATETIME,
  approved_by INTEGER,                  -- admin user_id
  memo TEXT,
  UNIQUE(hospital_id, year, month),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- ════════════════════════════════════════════════════════════════
-- 공휴일 테이블
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  holiday_date TEXT NOT NULL UNIQUE,    -- YYYY-MM-DD
  name TEXT NOT NULL,                   -- 공휴일명
  is_auto INTEGER DEFAULT 1,            -- 1=자동(API), 0=수동
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ════════════════════════════════════════════════════════════════
-- 시스템 알림 테이블
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_user_id INTEGER,                   -- NULL이면 전체 관리자
  from_hospital_id INTEGER,
  type TEXT NOT NULL,                   -- closing_request/closing_approved/budget_over/system
  title TEXT NOT NULL,
  message TEXT,
  is_read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (from_hospital_id) REFERENCES hospitals(id)
);

-- ════════════════════════════════════════════════════════════════
-- monthly_settings 에 소모품/법인카드 예산 컬럼 추가
-- ════════════════════════════════════════════════════════════════
ALTER TABLE monthly_settings ADD COLUMN supply_budget INTEGER DEFAULT 0;
ALTER TABLE monthly_settings ADD COLUMN card_budget INTEGER DEFAULT 0;

-- ════════════════════════════════════════════════════════════════
-- hospital_info 기본값 삽입 (기존 병원들)
-- ════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO hospital_info (hospital_id, current_year, current_month)
SELECT id, 2026, 3 FROM hospitals;

-- 2026년 3월 공휴일 (한국)
INSERT OR IGNORE INTO holidays (holiday_date, name, is_auto) VALUES
  ('2026-01-01', '신정', 1),
  ('2026-01-28', '설날 연휴', 1),
  ('2026-01-29', '설날', 1),
  ('2026-01-30', '설날 연휴', 1),
  ('2026-03-01', '삼일절', 1),
  ('2026-05-05', '어린이날', 1),
  ('2026-05-25', '부처님오신날', 1),
  ('2026-06-06', '현충일', 1),
  ('2026-08-15', '광복절', 1),
  ('2026-09-24', '추석 연휴', 1),
  ('2026-09-25', '추석', 1),
  ('2026-09-26', '추석 연휴', 1),
  ('2026-10-03', '개천절', 1),
  ('2026-10-09', '한글날', 1),
  ('2026-12-25', '크리스마스', 1);
