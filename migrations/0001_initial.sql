-- 병원 테이블
CREATE TABLE IF NOT EXISTS hospitals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 사용자(계정) 테이블 - 병원당 1계정 + 관리자
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'hospital', -- 'admin' | 'hospital'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 업체 테이블 (병원별, 추가/수정/삭제 가능)
CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general', -- 'major'(대기업급식) | 'meat'(육류) | 'seafood'(해산물) | 'fruit'(청과) | 'market'(시장) | 'organic'(유기농) | 'delivery'(인터넷배송) | 'card'(법인카드) | 'event'(이벤트) | 'general'(기타)
  tax_type TEXT NOT NULL DEFAULT 'mixed', -- 'taxable'(과세만) | 'exempt'(면세만) | 'mixed'(과세+면세)
  monthly_budget INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 월별 설정 테이블 (목표금액, 식단가 등)
CREATE TABLE IF NOT EXISTS monthly_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  total_budget INTEGER DEFAULT 0,         -- 월 총 목표금액
  event_budget INTEGER DEFAULT 0,         -- 이벤트 예산
  meal_price INTEGER DEFAULT 0,           -- 식단가(원)
  food_waste_budget INTEGER DEFAULT 0,    -- 잔반 목표금액
  working_days INTEGER DEFAULT 0,         -- 해당월 근무일수
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, year, month),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 일별 발주 테이블 (업체별 과세/면세/VAT)
CREATE TABLE IF NOT EXISTS daily_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  vendor_id INTEGER NOT NULL,
  order_date TEXT NOT NULL,               -- YYYY-MM-DD
  taxable_amount INTEGER DEFAULT 0,       -- 과세 금액
  exempt_amount INTEGER DEFAULT 0,        -- 면세 금액
  vat_amount INTEGER DEFAULT 0,           -- 부가세 금액
  total_amount INTEGER DEFAULT 0,         -- 합계 (자동계산)
  note TEXT,                              -- 비고 (주말/명절 다일치 등)
  is_multi_day INTEGER DEFAULT 0,         -- 다일치 발주 여부
  multi_day_start TEXT,                   -- 다일치 시작일
  multi_day_end TEXT,                     -- 다일치 종료일
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);

-- 일별 식수 테이블
CREATE TABLE IF NOT EXISTS daily_meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  meal_date TEXT NOT NULL,                -- YYYY-MM-DD
  -- 조식
  breakfast_patient INTEGER DEFAULT 0,    -- 조식 환자식
  breakfast_staff INTEGER DEFAULT 0,      -- 조식 직원
  breakfast_noncovered INTEGER DEFAULT 0, -- 조식 비급여
  breakfast_guardian INTEGER DEFAULT 0,   -- 조식 보호자
  -- 중식
  lunch_patient INTEGER DEFAULT 0,
  lunch_staff INTEGER DEFAULT 0,
  lunch_noncovered INTEGER DEFAULT 0,
  lunch_guardian INTEGER DEFAULT 0,
  -- 석식
  dinner_patient INTEGER DEFAULT 0,
  dinner_staff INTEGER DEFAULT 0,
  dinner_noncovered INTEGER DEFAULT 0,
  dinner_guardian INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, meal_date),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 직원 테이블 (스케줄 관리용)
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  position TEXT NOT NULL,                 -- 직책 (총분/조리장/부조리장/비프/조리사/매니저/전포 등)
  section TEXT NOT NULL DEFAULT 'cook',   -- 'cook'(세프) | 'manager' | 'hall'(홀/전포) | 'part'(파트타임)
  phone TEXT,
  annual_leave_total INTEGER DEFAULT 15,  -- 연차 총일수
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 일별 스케줄 테이블
CREATE TABLE IF NOT EXISTS daily_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  work_date TEXT NOT NULL,                -- YYYY-MM-DD
  shift_code TEXT NOT NULL DEFAULT 'a',   -- 'a'|'b'|'c'|'za'|'zb'|'F'|'연'|'휴'|'반'
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, employee_id, work_date),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_daily_orders_hospital_date ON daily_orders(hospital_id, order_date);
CREATE INDEX IF NOT EXISTS idx_daily_meals_hospital_date ON daily_meals(hospital_id, meal_date);
CREATE INDEX IF NOT EXISTS idx_daily_schedules_hospital_date ON daily_schedules(hospital_id, work_date);
CREATE INDEX IF NOT EXISTS idx_vendors_hospital ON vendors(hospital_id);
CREATE INDEX IF NOT EXISTS idx_employees_hospital ON employees(hospital_id);
