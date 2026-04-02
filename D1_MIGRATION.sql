-- ========== migrations/0001_initial.sql ==========
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

-- ========== migrations/0003_hospital_info.sql ==========
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

-- ========== migrations/0003_online_foodwaste.sql ==========
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

-- ========== migrations/0004_specialty.sql ==========
-- hospital_info 에 주 종목 컬럼 추가
ALTER TABLE hospital_info ADD COLUMN main_specialty TEXT DEFAULT '';

-- ========== migrations/0005_daily_issues_accounts.sql ==========
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

-- ========== migrations/0006_improvements.sql ==========
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

-- ========== migrations/0007_password_plain.sql ==========
-- 계정 테이블에 평문 비밀번호 컬럼 추가
ALTER TABLE users ADD COLUMN password_plain TEXT DEFAULT NULL;

-- ========== migrations/0008_session_activity.sql ==========
-- 세션 테이블에 마지막 액션 컬럼 추가
ALTER TABLE hospital_sessions ADD COLUMN last_action TEXT DEFAULT NULL;

-- ========== migrations/0009_meal_custom_fields.sql ==========
-- 병원별 커스텀 식수 카테고리 정의 테이블
-- 예: 간병인, 외래환자, 보호자2 등 병원마다 다른 식수 유형 추가
CREATE TABLE IF NOT EXISTS meal_custom_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  field_key TEXT NOT NULL,        -- 내부 키 (예: 'custom1', 'caregiver')
  field_name TEXT NOT NULL,       -- 표시 이름 (예: '간병인', '외래환자')
  sort_order INTEGER DEFAULT 0,   -- 표시 순서
  is_active INTEGER DEFAULT 1,    -- 활성화 여부
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, field_key),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- daily_meals에 커스텀 식수 JSON 컬럼 추가
-- 형식: {"custom1": {"bf": 5, "l": 3, "d": 2}, "custom2": {"bf": 1, "l": 1, "d": 0}}
ALTER TABLE daily_meals ADD COLUMN custom_data TEXT DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_meal_custom_fields_hospital ON meal_custom_fields(hospital_id);

-- ========== migrations/0010_custom_field_unit_type.sql ==========
-- 커스텀 식수 필드에 단위 타입 추가
-- unit_type: 'meal' (식) = 총식수에 포함, 'ea' (개/ea) = 총식수 미포함 (예: 공기밥)
ALTER TABLE meal_custom_fields ADD COLUMN unit_type TEXT DEFAULT 'meal';

-- ========== migrations/0011_patient_categories.sql ==========
-- ════════════════════════════════════════════════════════════════
-- 병원별 환자군 카테고리 (주종목) 테이블
-- 관리자 페이지 → 병원관리 → 기본정보에서 설정
-- 설정하면 발주 입력 화면에 열(column)이 자동 생성됨
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS hospital_patient_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  category_key TEXT NOT NULL,        -- 'general','cancer','rehab','nursing','traffic','mental','pediatric','other'
  category_name TEXT NOT NULL,       -- 표시명 (예: '일반', '항암', '재활', '요양', '교통사고')
  order_code TEXT DEFAULT '',        -- 발주 코드 (병원마다 다름)
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, category_key),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- ════════════════════════════════════════════════════════════════
-- 카테고리별 발주 금액 (일별 발주에 카테고리 정보 추가)
-- 기존 daily_orders에 category_id 컬럼 추가
-- ════════════════════════════════════════════════════════════════
ALTER TABLE daily_orders ADD COLUMN patient_category_id INTEGER DEFAULT NULL;

-- ════════════════════════════════════════════════════════════════
-- 카테고리별 월간 목표 예산 설정
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS category_order_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  patient_category_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  monthly_budget INTEGER DEFAULT 0,     -- 해당 카테고리 월 목표금액
  target_meal_price INTEGER DEFAULT 0,  -- 해당 카테고리 목표 식단가
  working_days INTEGER DEFAULT 0,       -- 근무일수
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, patient_category_id, year, month),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (patient_category_id) REFERENCES hospital_patient_categories(id)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_patient_categories_hospital ON hospital_patient_categories(hospital_id);
CREATE INDEX IF NOT EXISTS idx_category_order_settings_hospital ON category_order_settings(hospital_id, year, month);
CREATE INDEX IF NOT EXISTS idx_daily_orders_category ON daily_orders(patient_category_id);

-- ========== migrations/0012_category_daily_meal_count.sql ==========
-- 카테고리별 일일 식수 컬럼 추가 (실시간 식단가 계산에 사용)
-- IF NOT EXISTS는 SQLite ALTER TABLE에서 지원하지 않으므로 아래처럼 처리
ALTER TABLE category_order_settings ADD COLUMN daily_meal_count INTEGER DEFAULT 0;

-- ========== migrations/0013_sync_meal_custom_with_categories.sql ==========
-- ════════════════════════════════════════════════════════════════
-- 식수 커스텀 필드를 환자군 카테고리와 연동 (마이그레이션)
-- 
-- 변경 사항:
-- 1. meal_custom_fields 기존 데이터 비활성화 (custom1, custom2 등)
-- 2. hospital_patient_categories 기반으로 meal_custom_fields 자동 생성
--    - field_key: cat_{category_key} (예: cat_nursing, cat_cancer)
-- 3. daily_meals.custom_data에서 custom2 키를 cat_nursing으로 변환
--    (각 병원별로 매핑 필요 - 여기선 hospital_id=3 기준)
-- ════════════════════════════════════════════════════════════════

-- 1. 기존 수동 생성 커스텀 필드 비활성화 (cat_ 접두어 없는 것)
UPDATE meal_custom_fields 
SET is_active = 0 
WHERE field_key NOT LIKE 'cat_%';

-- 2. hospital_patient_categories에서 meal_custom_fields 자동 생성
-- (cat_ 접두어로 구분하여 환자군 연동)
INSERT OR IGNORE INTO meal_custom_fields 
  (hospital_id, field_key, field_name, sort_order, is_active, unit_type)
SELECT 
  hospital_id,
  'cat_' || category_key as field_key,
  category_name as field_name,
  sort_order,
  1 as is_active,
  'meal' as unit_type
FROM hospital_patient_categories
WHERE is_active = 1;

-- 기존 cat_ 필드가 있다면 이름/활성 상태 동기화
UPDATE meal_custom_fields 
SET 
  field_name = (
    SELECT hpc.category_name 
    FROM hospital_patient_categories hpc 
    WHERE hpc.hospital_id = meal_custom_fields.hospital_id 
      AND 'cat_' || hpc.category_key = meal_custom_fields.field_key
      AND hpc.is_active = 1
  ),
  is_active = 1
WHERE field_key LIKE 'cat_%'
  AND EXISTS (
    SELECT 1 FROM hospital_patient_categories hpc 
    WHERE hpc.hospital_id = meal_custom_fields.hospital_id 
      AND 'cat_' || hpc.category_key = meal_custom_fields.field_key
      AND hpc.is_active = 1
  );

-- ========== migrations/0014_migrate_custom_data_keys.sql ==========
-- ════════════════════════════════════════════════════════════════
-- custom_data JSON 키 변환: custom2 → cat_nursing (hospital_id=3 기준)
-- 이 마이그레이션은 로컬 테스트 데이터용입니다.
-- 실제 운영 환경에서는 아래 쿼리를 각 병원의 매핑 정보에 맞게 실행하세요.
-- ════════════════════════════════════════════════════════════════

-- hospital_id=3, custom2=요양 → cat_nursing 변환
-- SQLite에서 JSON 키 변환: REPLACE 함수 활용
UPDATE daily_meals 
SET custom_data = REPLACE(custom_data, '"custom2":', '"cat_nursing":')
WHERE hospital_id = 3 
  AND custom_data LIKE '%"custom2":%';

-- ========== migrations/0015_category_diet_price_formula.sql ==========
-- 카테고리별 식단가 계산 기준 설정
-- budget_include_keys: JSON 배열 - 예산에 포함할 카테고리 키 목록
--   예: ["cancer","nursing"] (NULL = 전체 예산 포함)
-- meals_include_keys: JSON 배열 - 식수에 포함할 항목 키 목록
--   예: ["cat_cancer","staff","guardian"] (NULL = 전체 식수)
--   가능한 키: cat_{category_key} (환자군별 식수), staff (직원), guardian (보호자), noncovered (비급여)

ALTER TABLE hospital_patient_categories 
ADD COLUMN budget_include_keys TEXT DEFAULT NULL;

ALTER TABLE hospital_patient_categories 
ADD COLUMN meals_include_keys TEXT DEFAULT NULL;

-- ========== migrations/0016_card_expenses.sql ==========
-- ── 법인카드형 업체 지원 마이그레이션 ─────────────────────────
-- vendors 테이블에 is_card_type 컬럼 추가
ALTER TABLE vendors ADD COLUMN is_card_type INTEGER DEFAULT 0;
-- card_type: 'food'(식재료), 'supplies'(소모품), 'online'(온라인), 'other'(기타)
ALTER TABLE vendors ADD COLUMN card_subtype TEXT DEFAULT NULL;

-- 법인카드 상세 지출 내역 테이블
CREATE TABLE IF NOT EXISTS card_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  vendor_id INTEGER NOT NULL,           -- 어떤 법인카드 업체
  expense_date TEXT NOT NULL,           -- YYYY-MM-DD (사용일)
  vendor_name TEXT NOT NULL,            -- 실제 결제 업체명 (예: 이마트, 쿠팡)
  item_name TEXT NOT NULL,              -- 사용 품목 (예: 식재료, 마스크, 세제)
  purpose TEXT NOT NULL,                -- 구매/진행 용도 (예: 환자식 재료, 방역용품)
  amount INTEGER NOT NULL DEFAULT 0,    -- 금액
  memo TEXT,                            -- 메모 (선택)
  receipt_url TEXT,                     -- 영수증 이미지 URL (추후 확장)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);

CREATE INDEX IF NOT EXISTS idx_card_expenses_hospital_date
  ON card_expenses(hospital_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_card_expenses_vendor_date
  ON card_expenses(vendor_id, expense_date);

-- ========== migrations/0017_order_inspection.sql ==========
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

-- ========== migrations/0018_waste_ingredient.sql ==========
-- ── 2.8 잔반 비용 분석: 병원별 잔반 단가 설정 ─────────────────────
-- monthly_settings에 waste_unit_price (kg당 단가) 추가
ALTER TABLE monthly_settings ADD COLUMN waste_unit_price INTEGER DEFAULT 0;
-- waste_unit_price: 잔반 1kg 당 비용 (원), 0이면 수동 입력 방식

-- food_waste_records: waste_kg 컬럼 추가 (kg 단위 입력, 비용은 unit_price*kg 자동계산 or 수동)
-- 이미 waste_amount 컬럼이 있으므로 별도 추가 불필요

-- ── 2.7 주요 식재료 단가 분석: ingredient_prices 테이블 ──────────────
CREATE TABLE IF NOT EXISTS ingredient_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  ingredient_name TEXT NOT NULL,    -- 식재료명 (쌀, 닭고기, 돼지고기, 두부, 계란, 채소류 등)
  unit TEXT DEFAULT 'kg',           -- 단위 (kg, 개, 박스 등)
  unit_price INTEGER DEFAULT 0,     -- 단가 (원)
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, year, month, ingredient_name),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_ingredient_prices_hospital_ym 
  ON ingredient_prices(hospital_id, year, month);

CREATE INDEX IF NOT EXISTS idx_ingredient_prices_name 
  ON ingredient_prices(hospital_id, ingredient_name);

-- ========== migrations/0019_inspection_issue.sql ==========
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

-- ========== migrations/0020_ceo_dashboard.sql ==========
-- ════════════════════════════════════════════════════════════════
-- CEO 대시보드 지원 마이그레이션
-- 1) hospital_info 에 care_type 추가 (항암/요양/재활 운영유형)
-- 2) users 에 sub_role 추가 (추후 경영진 권한 세분화용)
-- ════════════════════════════════════════════════════════════════

-- care_type: 확장형 구조 (기본 6개 + 추후 추가 가능)
-- 허용 값: oncology | nursing_care | rehab |
--          oncology_nursing | oncology_rehab | nursing_rehab | general
ALTER TABLE hospital_info ADD COLUMN care_type TEXT DEFAULT 'general';

-- sub_role: 추후 경영진 권한 세분화용 (현재는 admin 전체 접근)
-- 허용 값: NULL(일반 admin) | representative | executive | ops_manager
ALTER TABLE users ADD COLUMN sub_role TEXT DEFAULT NULL;

-- care_type 코드 참조 테이블 (확장형 지원: 런타임에 추가 가능)
CREATE TABLE IF NOT EXISTS care_type_codes (
  code        TEXT PRIMARY KEY,           -- 내부 코드 (oncology 등)
  label_ko    TEXT NOT NULL,              -- 한글 표시명
  sort_order  INTEGER DEFAULT 99,
  is_active   INTEGER DEFAULT 1,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 기본 6개 + general 시드
INSERT OR IGNORE INTO care_type_codes (code, label_ko, sort_order) VALUES
  ('oncology',         '항암',        1),
  ('nursing_care',     '요양',        2),
  ('rehab',            '재활',        3),
  ('oncology_nursing', '항암+요양',   4),
  ('oncology_rehab',   '항암+재활',   5),
  ('nursing_rehab',    '요양+재활',   6),
  ('general',          '일반',        99);

-- ========== migrations/0021_expense_type.sql ==========
-- card_expenses에 expense_type 컬럼 추가 (법인카드, 현장구매, 추가발주, 소모품, 기타)
ALTER TABLE card_expenses ADD COLUMN expense_type TEXT NOT NULL DEFAULT '법인카드';

-- ========== migrations/0022_transaction_statements.sql ==========
-- ── 거래명세서 분석 시스템 마이그레이션 ─────────────────────────────────────
-- 1단계 MVP: 엑셀/텍스트PDF 업로드, 파싱, 월별 분석, 카테고리, 발주 교차분석 구조
-- 병원별 데이터 완전 분리 (hospital_id 필수)

-- ─────────────────────────────────────────────
-- 1. 품목 카테고리 마스터 테이블
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transaction_item_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,          -- 채소, 육류, 수산, 곡류, 소모품, 기타 등
  code TEXT NOT NULL UNIQUE,          -- VEGGIE, MEAT, SEAFOOD, GRAIN, SUPPLIES, OTHER
  color TEXT DEFAULT '#6b7280',       -- 차트 표시용 색상
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 기본 카테고리 데이터 삽입
INSERT OR IGNORE INTO transaction_item_categories (name, code, color, sort_order) VALUES
  ('채소류', 'VEGGIE',   '#22c55e', 1),
  ('육류',   'MEAT',     '#ef4444', 2),
  ('수산물', 'SEAFOOD',  '#3b82f6', 3),
  ('곡류',   'GRAIN',    '#f59e0b', 4),
  ('유제품', 'DAIRY',    '#a855f7', 5),
  ('가공식품','PROCESSED','#f97316', 6),
  ('소모품', 'SUPPLIES', '#6b7280', 7),
  ('기타',   'OTHER',    '#94a3b8', 8);

-- ─────────────────────────────────────────────
-- 2. 업로드 파일 원본 정보
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transaction_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,            -- 원본 파일명
  file_type TEXT NOT NULL,            -- xlsx, pdf
  file_size INTEGER DEFAULT 0,        -- 바이트 단위
  file_data TEXT,                     -- Base64 인코딩 (소형 파일) or 참조 경로
  vendor_name TEXT,                   -- 업체명 (사용자 입력 또는 자동감지)
  document_year INTEGER,              -- 명세서 연도 (YYYY)
  document_month INTEGER,             -- 명세서 월 (1~12)
  parse_status TEXT DEFAULT 'pending', -- pending/processing/completed/failed
  parse_error TEXT,                   -- 파싱 오류 메시지
  row_count INTEGER DEFAULT 0,        -- 파싱된 항목 수
  uploaded_by TEXT DEFAULT 'admin',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_txfiles_hospital_date
  ON transaction_files(hospital_id, document_year, document_month);
CREATE INDEX IF NOT EXISTS idx_txfiles_vendor
  ON transaction_files(hospital_id, vendor_name);

-- ─────────────────────────────────────────────
-- 3. 파싱된 명세서 문서 정보
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transaction_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL,
  hospital_id INTEGER NOT NULL,
  vendor_name TEXT NOT NULL,          -- 공급 업체명
  document_date TEXT,                 -- 명세서 날짜 (YYYY-MM-DD)
  document_number TEXT,               -- 거래명세서 번호
  document_year INTEGER NOT NULL,
  document_month INTEGER NOT NULL,
  total_amount INTEGER DEFAULT 0,     -- 합계금액 (원)
  taxable_amount INTEGER DEFAULT 0,   -- 과세 금액
  tax_amount INTEGER DEFAULT 0,       -- 세액
  nontaxable_amount INTEGER DEFAULT 0,-- 면세 금액
  item_count INTEGER DEFAULT 0,       -- 품목 수
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (file_id) REFERENCES transaction_files(id) ON DELETE CASCADE,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_txdocs_hospital_date
  ON transaction_documents(hospital_id, document_year, document_month);
CREATE INDEX IF NOT EXISTS idx_txdocs_vendor
  ON transaction_documents(hospital_id, vendor_name);

-- ─────────────────────────────────────────────
-- 4. 개별 품목 상세 (핵심 분석 단위)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transaction_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  file_id INTEGER NOT NULL,
  hospital_id INTEGER NOT NULL,
  vendor_name TEXT NOT NULL,
  document_year INTEGER NOT NULL,
  document_month INTEGER NOT NULL,
  item_name TEXT NOT NULL,            -- 품목명 (정규화 전 원본)
  item_name_normalized TEXT,          -- 정규화된 품목명 (예: 양파 → 양파)
  category_id INTEGER,                -- transaction_item_categories.id
  quantity REAL DEFAULT 0,            -- 수량
  unit TEXT DEFAULT '',               -- 단위 (kg, g, 개, 박스 등)
  unit_price INTEGER DEFAULT 0,       -- 단가 (원)
  amount INTEGER DEFAULT 0,           -- 금액 = quantity × unit_price
  tax_type TEXT DEFAULT 'taxable',    -- taxable(과세) / nontaxable(면세) / exempt(영세)
  tax_amount INTEGER DEFAULT 0,       -- 세액
  raw_row TEXT,                       -- 파싱 원본 행 (JSON 문자열, 검증용)
  is_verified INTEGER DEFAULT 0,      -- 사용자 검증 여부
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES transaction_documents(id) ON DELETE CASCADE,
  FOREIGN KEY (file_id) REFERENCES transaction_files(id) ON DELETE CASCADE,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (category_id) REFERENCES transaction_item_categories(id)
);

CREATE INDEX IF NOT EXISTS idx_txitems_hospital_date
  ON transaction_items(hospital_id, document_year, document_month);
CREATE INDEX IF NOT EXISTS idx_txitems_vendor
  ON transaction_items(hospital_id, vendor_name);
CREATE INDEX IF NOT EXISTS idx_txitems_category
  ON transaction_items(hospital_id, category_id);
CREATE INDEX IF NOT EXISTS idx_txitems_name
  ON transaction_items(hospital_id, item_name_normalized);

-- ─────────────────────────────────────────────
-- 5. AI 분석 결과 저장
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transaction_ai_analysis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  analysis_year INTEGER NOT NULL,
  analysis_month INTEGER NOT NULL,
  analysis_type TEXT NOT NULL,        -- monthly / quarterly / annual / cross_order
  total_amount INTEGER DEFAULT 0,
  taxable_ratio REAL DEFAULT 0,       -- 과세 비율 (0~1)
  top_vendor TEXT,                    -- 최다 발주 업체명
  top_vendor_ratio REAL DEFAULT 0,    -- 최다 업체 집중도 (0~1)
  top_items TEXT,                     -- JSON: [{name, amount, category}]
  category_breakdown TEXT,            -- JSON: {채소류:amount, 육류:amount, ...}
  monthly_comparison TEXT,            -- JSON: 전월 대비 변화율
  -- AI 알림 항목 (규칙 기반)
  alert_price_rise TEXT,              -- JSON: 가격 10%+ 상승 품목 목록
  alert_qty_surge TEXT,               -- JSON: 구매량 2배+ 급증 품목 목록
  alert_vendor_concentration TEXT,    -- JSON: 업체 집중도 경고
  alert_tax_change TEXT,              -- JSON: 과세 구조 변화
  alert_missing_data TEXT,            -- JSON: 누락 데이터 항목
  -- 발주 교차 분석
  cross_analysis_summary TEXT,        -- JSON: 발주 vs 명세서 차이 요약
  cross_discrepancies TEXT,           -- JSON: [{item, ordered_qty, invoice_qty, diff}]
  analysis_text TEXT,                 -- AI 분석 요약 텍스트 (한국어)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_txai_hospital_date
  ON transaction_ai_analysis(hospital_id, analysis_year, analysis_month);

-- ─────────────────────────────────────────────
-- 6. 발주-명세서 교차 분석 상세 (3단계용 구조 선제 생성)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transaction_order_cross (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  cross_year INTEGER NOT NULL,
  cross_month INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  item_name_normalized TEXT,
  vendor_name TEXT,
  -- 발주 데이터 (orders 테이블에서 집계)
  ordered_quantity REAL DEFAULT 0,
  ordered_unit_price INTEGER DEFAULT 0,
  ordered_amount INTEGER DEFAULT 0,
  -- 명세서 데이터 (transaction_items에서 집계)
  invoice_quantity REAL DEFAULT 0,
  invoice_unit_price INTEGER DEFAULT 0,
  invoice_amount INTEGER DEFAULT 0,
  -- 차이 분석
  qty_diff REAL DEFAULT 0,            -- invoice - ordered
  qty_diff_ratio REAL DEFAULT 0,      -- 차이 비율 (%)
  price_diff INTEGER DEFAULT 0,       -- 단가 차이
  price_diff_ratio REAL DEFAULT 0,    -- 단가 차이 비율 (%)
  amount_diff INTEGER DEFAULT 0,      -- 금액 차이
  alert_level TEXT DEFAULT 'normal',  -- normal / warning / critical
  alert_memo TEXT,                    -- 경고 메시지
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_txcross_hospital_date
  ON transaction_order_cross(hospital_id, cross_year, cross_month);

-- ========== migrations/0023_transaction_item_code_spec.sql ==========
-- transaction_items에 품목코드, 규격 컬럼 추가
ALTER TABLE transaction_items ADD COLUMN item_code TEXT DEFAULT '';
ALTER TABLE transaction_items ADD COLUMN spec TEXT DEFAULT '';

-- ========== migrations/0024_diet_categories.sql ==========
-- ════════════════════════════════════════════════════════════════
-- 식이 분류 구조 개편 (diet_categories)
-- 대분류 4개: patient(환자식) / therapy(치료식) / noncovered(비급여식) / staff(직원식)
-- 중분류: 병원별 ON/OFF, 식수입력 노출 여부, 식단가, 목표금액 설정
-- 기존 hospital_patient_categories + meal_custom_fields 하위호환 유지
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS diet_categories (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id   INTEGER NOT NULL,
  parent_type   TEXT NOT NULL CHECK(parent_type IN ('patient','therapy','noncovered','staff')),
  diet_key      TEXT NOT NULL,          -- 내부 키 (예: 'patient_cancer', 'therapy_renal')
  diet_name     TEXT NOT NULL,          -- 표시 이름 (예: '항암 일반식', '신장식')
  is_active     INTEGER DEFAULT 1,      -- 사용 여부 ON/OFF
  show_in_input INTEGER DEFAULT 1,      -- 식수 입력 화면 노출 여부
  sort_order    INTEGER DEFAULT 0,
  target_meal_price INTEGER DEFAULT 0,  -- 목표 식단가
  monthly_budget    INTEGER DEFAULT 0,  -- 월 목표금액
  legacy_field_key  TEXT DEFAULT NULL,  -- 기존 meal_custom_fields.field_key 연결
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, diet_key),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_diet_categories_hospital ON diet_categories(hospital_id, parent_type, sort_order);
CREATE INDEX IF NOT EXISTS idx_diet_categories_active   ON diet_categories(hospital_id, is_active, show_in_input);

-- ════════════════════════════════════════════════════════════════
-- 기존 데이터 자동 이전
-- hospital_patient_categories → diet_categories (patient 또는 therapy)
-- meal_custom_fields (cat_* 아닌 것) → diet_categories (noncovered)
-- ════════════════════════════════════════════════════════════════

-- 1. hospital_patient_categories → diet_categories
--    기존 category_key → parent_type 매핑
--    cancer/nursing/rehab/traffic/pediatric/mental → patient(환자식)
--    단, 이름에 '경관','유동','저염','당뇨','신장','위절제' 등 치료식 키워드가 있으면 therapy로

INSERT OR IGNORE INTO diet_categories
  (hospital_id, parent_type, diet_key, diet_name, is_active, show_in_input, sort_order, legacy_field_key)
SELECT
  hospital_id,
  CASE
    WHEN category_name LIKE '%경관%' OR category_name LIKE '%유동%'
      OR category_name LIKE '%저염%' OR category_name LIKE '%당뇨%'
      OR category_name LIKE '%신장%' OR category_name LIKE '%위절제%'
      OR category_name LIKE '%저잔사%' OR category_name LIKE '%저요오드%'
      OR category_name LIKE '%저칼륨%' OR category_name LIKE '%저지방%'
      OR category_name LIKE '%고단백%' OR category_name LIKE '%무지방%'
      OR category_name LIKE '%연하%' OR category_name LIKE '%검사식%'
      OR category_name LIKE '%치료%'
    THEN 'therapy'
    WHEN category_name LIKE '%보호자%' OR category_name LIKE '%외래%'
      OR category_name LIKE '%VIP%' OR category_name LIKE '%프리미엄%'
      OR category_name LIKE '%보양%' OR category_name LIKE '%간식%'
      OR category_name LIKE '%특식%'
    THEN 'noncovered'
    WHEN category_name LIKE '%직원%'
    THEN 'staff'
    ELSE 'patient'
  END as parent_type,
  'legacy_' || category_key as diet_key,
  category_name,
  is_active,
  1 as show_in_input,
  sort_order,
  'cat_' || category_key as legacy_field_key
FROM hospital_patient_categories;

-- 2. meal_custom_fields (cat_ 아닌 것, 즉 수동 생성된 것) → diet_categories (noncovered)
INSERT OR IGNORE INTO diet_categories
  (hospital_id, parent_type, diet_key, diet_name, is_active, show_in_input, sort_order, legacy_field_key)
SELECT
  hospital_id,
  'noncovered' as parent_type,
  'legacy_mcf_' || field_key as diet_key,
  field_name,
  is_active,
  1 as show_in_input,
  sort_order,
  field_key as legacy_field_key
FROM meal_custom_fields
WHERE field_key NOT LIKE 'cat_%';

-- 3. category_order_settings에서 식단가/목표금액 가져오기
--    (최근 년도 월 기준)
UPDATE diet_categories
SET
  target_meal_price = COALESCE((
    SELECT cos.target_meal_price
    FROM category_order_settings cos
    JOIN hospital_patient_categories hpc ON cos.patient_category_id = hpc.id
    WHERE hpc.hospital_id = diet_categories.hospital_id
      AND 'cat_' || hpc.category_key = diet_categories.legacy_field_key
    ORDER BY cos.year DESC, cos.month DESC
    LIMIT 1
  ), 0),
  monthly_budget = COALESCE((
    SELECT cos.monthly_budget
    FROM category_order_settings cos
    JOIN hospital_patient_categories hpc ON cos.patient_category_id = hpc.id
    WHERE hpc.hospital_id = diet_categories.hospital_id
      AND 'cat_' || hpc.category_key = diet_categories.legacy_field_key
    ORDER BY cos.year DESC, cos.month DESC
    LIMIT 1
  ), 0)
WHERE legacy_field_key LIKE 'cat_%';

-- ════════════════════════════════════════════════════════════════
-- 기본 식이 분류 프리셋 테이블 (병원에서 불러오기용)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS diet_category_presets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_type TEXT NOT NULL,
  preset_key  TEXT NOT NULL UNIQUE,
  preset_name TEXT NOT NULL,
  sort_order  INTEGER DEFAULT 0
);

-- 환자식 프리셋
INSERT OR IGNORE INTO diet_category_presets (parent_type, preset_key, preset_name, sort_order) VALUES
  ('patient', 'preset_patient_cancer',    '항암 일반식',   1),
  ('patient', 'preset_patient_nursing',   '요양 일반식',   2),
  ('patient', 'preset_patient_rehab',     '재활 일반식',   3),
  ('patient', 'preset_patient_general',   '일반 환자식',   4);

-- 치료식 프리셋
INSERT OR IGNORE INTO diet_category_presets (parent_type, preset_key, preset_name, sort_order) VALUES
  ('therapy', 'preset_therapy_gastrectomy', '위절제식',     1),
  ('therapy', 'preset_therapy_lowresidue',  '저잔사식',     2),
  ('therapy', 'preset_therapy_lowiodine',   '저요오드식',   3),
  ('therapy', 'preset_therapy_lowsalt',     '저염식',       4),
  ('therapy', 'preset_therapy_tube',        '경관식',       5),
  ('therapy', 'preset_therapy_diabetes',    '당뇨식',       6),
  ('therapy', 'preset_therapy_renal',       '신장식',       7),
  ('therapy', 'preset_therapy_lowpotassium','저칼륨식',     8),
  ('therapy', 'preset_therapy_lowfat',      '저지방식',     9),
  ('therapy', 'preset_therapy_highprotein', '고단백식',    10),
  ('therapy', 'preset_therapy_fatfree',     '무지방식',    11),
  ('therapy', 'preset_therapy_dysphagia',   '연하곤란식',  12),
  ('therapy', 'preset_therapy_liquid',      '유동식',      13),
  ('therapy', 'preset_therapy_exam',        '검사식',      14);

-- 비급여식 프리셋
INSERT OR IGNORE INTO diet_category_presets (parent_type, preset_key, preset_name, sort_order) VALUES
  ('noncovered', 'preset_nc_guardian',   '보호자식',   1),
  ('noncovered', 'preset_nc_outpatient', '외래환자식', 2),
  ('noncovered', 'preset_nc_special',    '특식',       3),
  ('noncovered', 'preset_nc_vip',        'VIP식',      4),
  ('noncovered', 'preset_nc_premium',    '프리미엄식', 5),
  ('noncovered', 'preset_nc_tonic',      '보양식',     6),
  ('noncovered', 'preset_nc_snack',      '간식',       7);

-- 직원식 프리셋
INSERT OR IGNORE INTO diet_category_presets (parent_type, preset_key, preset_name, sort_order) VALUES
  ('staff', 'preset_staff_regular', '직원 일반식', 1),
  ('staff', 'preset_staff_special', '직원 특식',   2),
  ('staff', 'preset_staff_night',   '직원 야식',   3);

-- ========== migrations/0025_diet_structure_v2.sql ==========
-- ════════════════════════════════════════════════════════════════
-- 식이 분류 구조 v2 개편
-- 핵심 변경:
--   1. patient_group   : 환자군 (항암/요양/재활 등) - 식단가 기준 단위
--   2. diet_level      : 'group'(환자군) | 'normal'(일반식) | 'therapy'(치료식)
--   3. include_in_meal_price : 비급여 항목 중 식단가 계산에 포함할지 여부
-- ════════════════════════════════════════════════════════════════

-- 1. 컬럼 추가
ALTER TABLE diet_categories ADD COLUMN patient_group TEXT DEFAULT NULL;
-- 환자군 소속 (예: 'cancer','nursing','rehab' / therapy인 경우 null)

ALTER TABLE diet_categories ADD COLUMN diet_level TEXT DEFAULT 'group';
-- 'group'  : 환자군 자체 (항암, 요양, 재활 등) - 식단가 설정 대상
-- 'normal' : 환자군 내 일반식 (기존 patient 타입)
-- 'therapy': 치료식 세부 항목
-- 'noncovered_item': 비급여 세부 항목

ALTER TABLE diet_categories ADD COLUMN include_in_meal_price INTEGER DEFAULT 0;
-- 0: 식단가 계산 제외 (기본)
-- 1: 식단가 계산 포함 (비급여 중 선택 항목)

-- 2. 기존 patient 타입 → diet_level 정리
--    기존 parent_type='patient' → diet_level='group' (환자군 그 자체가 식단가 기준)
UPDATE diet_categories SET diet_level = 'group' WHERE parent_type = 'patient';

--    기존 parent_type='therapy' → diet_level='therapy'
UPDATE diet_categories SET diet_level = 'therapy' WHERE parent_type = 'therapy';

--    기존 parent_type='noncovered' → diet_level='noncovered_item'
UPDATE diet_categories SET diet_level = 'noncovered_item' WHERE parent_type = 'noncovered';

--    기존 parent_type='staff' → diet_level='staff_item'
UPDATE diet_categories SET diet_level = 'staff_item' WHERE parent_type = 'staff';

-- 3. 기존 환자군(group) 데이터에 patient_group 자기참조 세팅 (legacy_field_key 기반)
UPDATE diet_categories 
SET patient_group = REPLACE(legacy_field_key, 'cat_', '')
WHERE diet_level = 'group' AND legacy_field_key LIKE 'cat_%';

-- 4. 기존 치료식 → patient_group NULL (치료식은 환자군 미분류)
-- (이미 NULL이므로 그대로)

-- ════════════════════════════════════════════════════════════════
-- 비급여 식단가 반영 설정 테이블
-- 병원별로 어떤 비급여 항목을 식단가에 포함할지 저장
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS hospital_meal_price_settings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id   INTEGER NOT NULL,
  -- 비급여 식단가 포함 항목 (diet_categories.id JSON 배열)
  noncovered_include_ids TEXT DEFAULT '[]',
  -- 식수 계산에 포함할 기본 항목 (staff/guardian 등)
  base_include_keys      TEXT DEFAULT '["staff","guardian"]',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_diet_categories_level ON diet_categories(hospital_id, diet_level, is_active);
CREATE INDEX IF NOT EXISTS idx_diet_categories_group ON diet_categories(hospital_id, patient_group);

-- ========== migrations/0026_diet_v3_patient_group_structure.sql ==========
-- ════════════════════════════════════════════════════════════════
-- 식이 분류 구조 v3 - 환자군별 일반식/치료식 연결 체계
-- 핵심 변경:
--   1. 치료식(therapy)에 linked_patient_group 추가 → 어느 환자군의 치료식인지 연결
--   2. 비급여식 include_in_meal_price 활성화 (이미 컬럼 존재)
--   3. diet_level 체계 정리:
--      'group'          : 환자군 (항암, 요양, 재활 등) - 식단가 기준 단위
--      'group_normal'   : 환자군 내 일반식 (환자군에 속하는 일반 입원식)
--      'group_therapy'  : 환자군 내 치료식 (환자군에 속하는 치료 세부식)
--      'therapy'        : 환자군 비특정 치료식 (공통 치료식)
--      'noncovered_item': 비급여 세부항목
--      'staff_item'     : 직원식 세부항목
--   4. 비급여 기본 항목 프리셋 추가 (보호자식, 외래환자식, 특식, 공기밥추가, 간식, 기타)
--   5. 치료식 프리셋에 내시경식, 기타치료식 추가
-- ════════════════════════════════════════════════════════════════

-- 1. linked_patient_group 컬럼 추가 (치료식이 어느 환자군에 속하는지)
--    NULL = 특정 환자군에 비특정 / 'cancer' = 항암 환자군의 치료식
ALTER TABLE diet_categories ADD COLUMN linked_patient_group TEXT DEFAULT NULL;

-- 2. 기존 therapy 타입 diet_level 재정리
--    (기존 therapy → diet_level 이미 'therapy'로 세팅됨, 그대로 유지)

-- 3. diet_category_presets에 컬럼 추가
ALTER TABLE diet_category_presets ADD COLUMN linked_patient_group TEXT DEFAULT NULL;

-- 4. 비급여 기본 프리셋 추가 (보호자식, 외래환자식, 특식, 공기밥추가, 간식, 기타)
INSERT OR IGNORE INTO diet_category_presets (parent_type, preset_key, preset_name, sort_order) VALUES
  ('noncovered', 'preset_nc_guardian',    '보호자식',     1),
  ('noncovered', 'preset_nc_outpatient',  '외래환자식',   2),
  ('noncovered', 'preset_nc_special',     '특식',         3),
  ('noncovered', 'preset_nc_rice_extra',  '공기밥추가',   4),
  ('noncovered', 'preset_nc_snack',       '간식',         5),
  ('noncovered', 'preset_nc_other',       '기타',         6);

-- 5. 직원식 프리셋 추가
INSERT OR IGNORE INTO diet_category_presets (parent_type, preset_key, preset_name, sort_order) VALUES
  ('staff', 'preset_staff_general', '직원 일반식', 1),
  ('staff', 'preset_staff_special', '직원 특식',   2),
  ('staff', 'preset_staff_night',   '야간식',      3);

-- 6. 치료식 프리셋 추가 (내시경식, 기타치료식)
INSERT OR IGNORE INTO diet_category_presets (parent_type, preset_key, preset_name, sort_order) VALUES
  ('therapy', 'preset_therapy_endoscopy', '내시경식',   8),
  ('therapy', 'preset_therapy_other',     '기타 치료식', 99);

-- 7. 기존 patient 타입 diet_level='group' 데이터에
--    patient_group 값 세팅 확인 (이미 0025에서 처리됨, 누락분 보완)
UPDATE diet_categories
SET patient_group = CASE
  WHEN diet_name LIKE '%항암%' THEN 'cancer'
  WHEN diet_name LIKE '%요양%' THEN 'nursing'
  WHEN diet_name LIKE '%재활%' THEN 'rehab'
  WHEN diet_name LIKE '%교통%' THEN 'traffic'
  WHEN diet_name LIKE '%정신%' THEN 'mental'
  WHEN diet_name LIKE '%소아%' THEN 'pediatric'
  WHEN diet_name LIKE '%척추%' THEN 'spine'
  WHEN diet_name LIKE '%관절%' THEN 'joint'
  WHEN diet_name LIKE '%심장%' THEN 'cardiac'
  WHEN diet_name LIKE '%투석%' THEN 'dialysis'
  WHEN diet_name LIKE '%뇌졸%' THEN 'stroke'
  WHEN diet_name LIKE '%노인%' THEN 'elderly'
  WHEN diet_name LIKE '%산부%' THEN 'maternity'
  ELSE patient_group
END
WHERE diet_level = 'group' AND (patient_group IS NULL OR patient_group = 'null');

-- 8. 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_diet_categories_linked_group
  ON diet_categories(hospital_id, linked_patient_group);

-- ========== migrations/0027_executive_role.sql ==========
-- 0027: 운영진(executive) 역할 추가
-- users 테이블의 role에 'executive' 값 허용 (기존 CHECK 없음, TEXT 타입이므로 별도 작업 불필요)
-- executive 전용 메모 컬럼 추가 (운영진 이름/직책)

ALTER TABLE users ADD COLUMN executive_title TEXT DEFAULT ''; -- 직책 (예: 원장, 이사, 부원장)

-- 운영진 세션 추적을 위한 hospital_sessions 확장 (role 컬럼 추가)
ALTER TABLE hospital_sessions ADD COLUMN role TEXT DEFAULT 'hospital';

-- ========== migrations/0028_diet_preset_update.sql ==========
-- 환자식 프리셋 이름 변경
UPDATE diet_category_presets SET preset_name='항암식' WHERE preset_key='preset_patient_cancer';
UPDATE diet_category_presets SET preset_name='요양식' WHERE preset_key='preset_patient_nursing';
UPDATE diet_category_presets SET preset_name='재활식' WHERE preset_key='preset_patient_rehab';
UPDATE diet_category_presets SET preset_name='일반식' WHERE preset_key='preset_patient_general';

-- 직원식 중복 프리셋 제거 (preset_staff_regular 삭제, preset_staff_general 유지)
DELETE FROM diet_category_presets WHERE preset_key='preset_staff_regular';

-- 비급여식 프리셋 추가
INSERT OR IGNORE INTO diet_category_presets (parent_type, preset_key, preset_name, sort_order) VALUES
  ('noncovered', 'preset_nc_cancer_guardian',  '항암 보호자식', 8),
  ('noncovered', 'preset_nc_rehab_guardian',   '재활 보호자식', 9),
  ('noncovered', 'preset_nc_nursing_guardian', '요양 보호자식', 10),
  ('noncovered', 'preset_nc_caregiver',        '간병사',        11);

-- ========== migrations/0029_invoice_category_analysis.sql ==========
-- ── 거래명세서 분류별 분석 기능 확장 마이그레이션 ────────────────────────

-- 1. 업체별 분류명 매핑 저장 (동일 업체 파일 업로드 시 분류 재활용)
-- 예: 삼성웰스토리 → "가공식품", "농산물류", "수산/건어물류", "육류"
CREATE TABLE IF NOT EXISTS invoice_supplier_classifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  vendor_name TEXT NOT NULL,
  category_name TEXT NOT NULL,        -- 엑셀 파일 내 분류명 (원본 그대로)
  mapped_category_id INTEGER,         -- transaction_item_categories.id 매핑 (선택)
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, vendor_name, category_name),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 2. transaction_items에 supplier_category(원본 분류명) 컬럼 추가
ALTER TABLE transaction_items ADD COLUMN supplier_category TEXT DEFAULT '';

-- 2-1. SQLite는 IF NOT EXISTS를 ALTER TABLE에서 지원 안 하므로 안전하게 처리
-- (이미 있으면 무시됨 - wrangler D1에서는 에러 무시 처리)

-- 3. transaction_documents에 거래기간 컬럼 추가
ALTER TABLE transaction_documents ADD COLUMN trade_period TEXT DEFAULT '';

-- 4. 인덱스
CREATE INDEX IF NOT EXISTS idx_inv_supplier_cat ON invoice_supplier_classifications(hospital_id, vendor_name);
CREATE INDEX IF NOT EXISTS idx_txitems_supplier_cat ON transaction_items(hospital_id, supplier_category);

-- ========== migrations/0030_staff_diet_types.sql ==========
-- 직원식 세분화: 직원 특식, 직원 야식 추가
-- 기존 '직원 일반식'(preset_staff_regular_1)은 유지하고 2개 항목 추가

-- 직원 특식 추가 (아직 없는 병원에만)
INSERT OR IGNORE INTO diet_categories (
  hospital_id, parent_type, diet_name, diet_key, is_active,
  include_in_meal_price, show_in_input, sort_order, created_at, updated_at
)
SELECT
  h.id,
  'staff',
  '직원 특식',
  'preset_staff_special_1',
  1,
  0,
  1,
  (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM diet_categories WHERE hospital_id = h.id AND parent_type = 'staff'),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM hospitals h
WHERE NOT EXISTS (
  SELECT 1 FROM diet_categories
  WHERE hospital_id = h.id AND diet_key = 'preset_staff_special_1'
);

-- 직원 야식 추가 (아직 없는 병원에만)
INSERT OR IGNORE INTO diet_categories (
  hospital_id, parent_type, diet_name, diet_key, is_active,
  include_in_meal_price, show_in_input, sort_order, created_at, updated_at
)
SELECT
  h.id,
  'staff',
  '직원 야식',
  'preset_staff_night_1',
  1,
  0,
  1,
  (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM diet_categories WHERE hospital_id = h.id AND parent_type = 'staff'),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM hospitals h
WHERE NOT EXISTS (
  SELECT 1 FROM diet_categories
  WHERE hospital_id = h.id AND diet_key = 'preset_staff_night_1'
);

-- ========== migrations/0031_hospital_invoice_vendors.sql ==========
-- ── 병원별 거래명세서 업체 등록 테이블 ────────────────────────────────────
-- 병원마다 어떤 업체의 명세서를 사용하는지, 파싱 구조(컬럼 매핑)를 저장
-- 기존 transaction_vendor_templates(글로벌) 대신 병원-업체 단위로 관리

CREATE TABLE IF NOT EXISTS hospital_invoice_vendors (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id         INTEGER NOT NULL,
  vendor_name         TEXT NOT NULL,            -- 업체명 (표시용)
  vendor_name_norm    TEXT NOT NULL,            -- 업체명 정규화 (검색/매칭용)
  description         TEXT DEFAULT '',          -- 업체 설명/메모
  
  -- 파싱 구조 (컬럼 인덱스, 0-based)
  skip_rows           INTEGER DEFAULT 4,        -- 헤더까지 건너뛸 행 수
  col_code            INTEGER DEFAULT 0,        -- 품목코드 열
  col_name            INTEGER DEFAULT 1,        -- 품목명 열
  col_spec            INTEGER DEFAULT 2,        -- 규격 열
  col_unit            INTEGER DEFAULT 3,        -- 단위 열
  col_qty             INTEGER DEFAULT 4,        -- 수량 열
  col_price           INTEGER DEFAULT 5,        -- 단가 열
  col_amount          INTEGER DEFAULT 6,        -- 금액 열
  col_vat             INTEGER DEFAULT 7,        -- 부가세 열
  col_total           INTEGER DEFAULT 8,        -- 합계 열
  
  -- 분류 구분 방식
  cat_mode            TEXT DEFAULT 'subtotal',  -- 'subtotal'|'category_col'|'none'
  col_category        INTEGER DEFAULT NULL,     -- 분류 컬럼 인덱스 (cat_mode='category_col'일 때)
  
  -- 테스트/검증 결과 (샘플 파일 테스트 후 저장)
  test_status         TEXT DEFAULT 'untested',  -- 'untested'|'verified'|'failed'
  test_sample_rows    TEXT DEFAULT NULL,        -- JSON: 테스트 시 파싱된 샘플 행 (최대 3개)
  test_verified_at    DATETIME DEFAULT NULL,    -- 마지막 테스트 통과 시각
  
  -- 최근 업로드 정보
  last_upload_at      DATETIME DEFAULT NULL,    -- 가장 최근 명세서 업로드 시각
  last_upload_year    INTEGER DEFAULT NULL,     -- 가장 최근 업로드 연도
  last_upload_month   INTEGER DEFAULT NULL,     -- 가장 최근 업로드 월
  upload_count        INTEGER DEFAULT 0,        -- 총 업로드 횟수
  
  is_active           INTEGER DEFAULT 1,
  sort_order          INTEGER DEFAULT 0,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(hospital_id, vendor_name_norm),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_hosp_inv_vendors_hospital ON hospital_invoice_vendors(hospital_id);
CREATE INDEX IF NOT EXISTS idx_hosp_inv_vendors_norm ON hospital_invoice_vendors(hospital_id, vendor_name_norm);

-- 기존 transaction_vendor_templates 데이터를 hospital_invoice_vendors로 마이그레이션
-- (hospital_id=1 기본값으로, 나중에 수동 수정 가능)
INSERT OR IGNORE INTO hospital_invoice_vendors 
  (hospital_id, vendor_name, vendor_name_norm, skip_rows,
   col_code, col_name, col_unit, col_qty, col_price, col_amount, col_vat,
   cat_mode)
SELECT 
  1,
  vendor_name,
  vendor_name_normalized,
  skip_rows,
  0,                                        -- col_code (기본값)
  col_item_name,
  col_unit,
  col_qty,
  col_unit_price,
  col_amount,
  col_tax,
  CASE WHEN has_category_rows = 1 THEN 'subtotal' ELSE 'none' END
FROM transaction_vendor_templates;

-- ========== migrations/0032_invoice_vendors_vendor_id.sql ==========
-- hospital_invoice_vendors 테이블에 vendor_id 컬럼 추가
-- 발주 업체(vendors)와 연결하기 위한 외래키

ALTER TABLE hospital_invoice_vendors ADD COLUMN vendor_id INTEGER REFERENCES vendors(id);

-- 기존 데이터: vendor_name_norm으로 vendors 테이블과 매칭 시도
UPDATE hospital_invoice_vendors
SET vendor_id = (
  SELECT v.id FROM vendors v
  WHERE v.hospital_id = hospital_invoice_vendors.hospital_id
    AND LOWER(REPLACE(REPLACE(v.name, ' ', ''), '(주)', '')) = LOWER(REPLACE(REPLACE(hospital_invoice_vendors.vendor_name_norm, ' ', ''), '(주)', ''))
  LIMIT 1
)
WHERE vendor_id IS NULL;

-- 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_hiv_vendor_id ON hospital_invoice_vendors(vendor_id);
CREATE INDEX IF NOT EXISTS idx_hiv_hospital_vendor ON hospital_invoice_vendors(hospital_id, vendor_id);

-- ========== migrations/0033_invoice_period_mode.sql ==========
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

-- ========== migrations/0034_ingredient_auto_source.sql ==========
-- ingredient_prices 테이블에 source 컬럼 추가
-- source: 'manual'(수동입력), 'auto'(거래명세서 자동추출)
ALTER TABLE ingredient_prices ADD COLUMN source TEXT DEFAULT 'manual';
ALTER TABLE ingredient_prices ADD COLUMN total_amount INTEGER DEFAULT 0;
ALTER TABLE ingredient_prices ADD COLUMN total_quantity REAL DEFAULT 0;
ALTER TABLE ingredient_prices ADD COLUMN vendor_name TEXT DEFAULT '';

-- ========== migrations/0035_vendor_ingredient_prices.sql ==========
-- vendor_name 컬럼이 없을 경우 추가 (이미 있으면 무시)
-- ingredient_prices 테이블에 업체별 단가 관리를 위한 vendor_name 지원
-- (0034_ingredient_auto_source.sql에서 이미 추가되었으므로 체크만)

-- 인덱스 추가 (vendor_name 기준 조회 최적화)
CREATE INDEX IF NOT EXISTS idx_ingredient_prices_vendor 
  ON ingredient_prices(hospital_id, vendor_name, year, month);

-- ========== migrations/0036_ref_meal_price.sql ==========
-- category_order_settings에 기준 식단가(배분용) 컬럼 추가
ALTER TABLE category_order_settings ADD COLUMN ref_meal_price INTEGER DEFAULT 0;

-- ========== migrations/0037_order_multiday_settings.sql ==========
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

-- ========== migrations/0038_order_input_source.sql ==========
-- daily_orders 테이블에 입력 출처 컬럼 추가
-- 값: 'direct' (직접입력), 'excel' (엑셀업로드), 'edit' (수정입력)
ALTER TABLE daily_orders ADD COLUMN input_source TEXT DEFAULT 'direct';

-- 기존 데이터: 엑셀자동입력 메모가 있는 것은 excel로, 나머지는 direct로 설정
UPDATE daily_orders SET input_source = 'excel' WHERE note = '엑셀자동입력';
UPDATE daily_orders SET input_source = 'direct' WHERE note != '엑셀자동입력' OR note IS NULL;

-- ========== migrations/0039_schedule_module_v1.sql ==========
-- 0039: 스케줄 모듈 v1 - 인사카드 확장 + 직위 관리 + 근무조 + 휴가 테이블

-- ═══════════════════════════════════════════════════════════════
-- 1. employees 테이블 확장
-- ═══════════════════════════════════════════════════════════════
-- 기존 컬럼: id, hospital_id, name, position, section, phone, 
--            annual_leave_total, sort_order, is_active, created_at

ALTER TABLE employees ADD COLUMN emp_number TEXT DEFAULT '';          -- 직원번호 (내부관리용)
ALTER TABLE employees ADD COLUMN birth_date TEXT DEFAULT '';          -- 생년월일 YYYY-MM-DD
ALTER TABLE employees ADD COLUMN hire_date TEXT DEFAULT '';           -- 입사일 YYYY-MM-DD
ALTER TABLE employees ADD COLUMN resign_date TEXT DEFAULT '';         -- 퇴사일 YYYY-MM-DD (NULL=재직중)
ALTER TABLE employees ADD COLUMN employment_type TEXT DEFAULT 'full'; -- 고용유형: full|part|temp|contract|daily
ALTER TABLE employees ADD COLUMN work_parts TEXT DEFAULT '[]';        -- 근무파트 JSON배열: ["breakfast","lunch","dinner"]
ALTER TABLE employees ADD COLUMN team TEXT DEFAULT 'cook';            -- 팀: cook(조리팀)|nutrition(영양팀)
ALTER TABLE employees ADD COLUMN position_id INTEGER DEFAULT NULL;    -- 직위 FK → employee_positions.id
ALTER TABLE employees ADD COLUMN email TEXT DEFAULT '';               -- 이메일
ALTER TABLE employees ADD COLUMN address TEXT DEFAULT '';             -- 주소
ALTER TABLE employees ADD COLUMN emergency_contact TEXT DEFAULT '';   -- 비상연락처
ALTER TABLE employees ADD COLUMN note TEXT DEFAULT '';                -- 메모
ALTER TABLE employees ADD COLUMN health_cert_expire TEXT DEFAULT '';  -- 보건증 만료일 YYYY-MM-DD
ALTER TABLE employees ADD COLUMN health_exam_date TEXT DEFAULT '';    -- 건강검진일 YYYY-MM-DD
ALTER TABLE employees ADD COLUMN health_exam_status TEXT DEFAULT 'pending'; -- pending|submitted|completed
ALTER TABLE employees ADD COLUMN updated_at TEXT DEFAULT '';

-- ═══════════════════════════════════════════════════════════════
-- 2. 직위(포지션) 테이블
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS employee_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER,                          -- NULL=전체공통, 숫자=병원전용
  team TEXT NOT NULL DEFAULT 'cook',            -- cook | nutrition
  name TEXT NOT NULL,                           -- 직위명
  sort_order INTEGER NOT NULL DEFAULT 0,        -- 정렬순서 (기본직위는 고정)
  is_default INTEGER NOT NULL DEFAULT 0,        -- 1=기본직위(삭제불가), 0=커스텀
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 기본 직위 데이터 삽입 (조리팀)
INSERT OR IGNORE INTO employee_positions (hospital_id, team, name, sort_order, is_default) VALUES
  (NULL, 'cook', '조리장',      10, 1),
  (NULL, 'cook', '부조리장',    20, 1),
  (NULL, 'cook', '부주방장',    30, 1),
  (NULL, 'cook', '조리사',      40, 1),
  (NULL, 'cook', '조리보조',    50, 1),
  (NULL, 'cook', '매니저',      60, 1),
  (NULL, 'cook', '파트타이머',  70, 1);

-- 기본 직위 데이터 삽입 (영양팀)
INSERT OR IGNORE INTO employee_positions (hospital_id, team, name, sort_order, is_default) VALUES
  (NULL, 'nutrition', '영양팀장',  10, 1),
  (NULL, 'nutrition', '영양사',    20, 1);

-- ═══════════════════════════════════════════════════════════════
-- 3. 근무조(Shift) 설정 테이블
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS schedule_shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  shift_code TEXT NOT NULL,              -- 'A', 'B', 'C', 'N', 등
  shift_name TEXT NOT NULL,              -- '주간A', '야간', '오전조'
  start_time TEXT NOT NULL DEFAULT '09:00',  -- HH:MM
  end_time TEXT NOT NULL DEFAULT '18:00',    -- HH:MM
  color TEXT NOT NULL DEFAULT '#3B82F6',     -- 색상 (헥스코드)
  team TEXT DEFAULT NULL,                -- 특정팀 전용 (NULL=전체)
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, shift_code),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- ═══════════════════════════════════════════════════════════════
-- 4. 연차/휴가 관리 테이블
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS employee_leaves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  year INTEGER NOT NULL,                 -- 대상 연도
  leave_type TEXT NOT NULL DEFAULT 'annual',  -- annual(연차)|sick(병가)|event(경조)|comp(대휴)|etc
  total_days REAL NOT NULL DEFAULT 0,    -- 부여일수 (0.5 단위 가능)
  used_days REAL NOT NULL DEFAULT 0,     -- 사용일수
  note TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, employee_id, year, leave_type),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

-- ═══════════════════════════════════════════════════════════════
-- 5. daily_schedules 테이블 확장 (기존 테이블에 컬럼 추가)
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE daily_schedules ADD COLUMN shift_id INTEGER DEFAULT NULL; -- schedule_shifts FK
ALTER TABLE daily_schedules ADD COLUMN leave_type TEXT DEFAULT NULL;  -- 휴가유형 (연/병/경조 등)
ALTER TABLE daily_schedules ADD COLUMN is_overtime INTEGER DEFAULT 0; -- 초과근무 여부
ALTER TABLE daily_schedules ADD COLUMN overtime_hours REAL DEFAULT 0; -- 초과근무 시간
ALTER TABLE daily_schedules ADD COLUMN is_temp_staff INTEGER DEFAULT 0; -- 파출/알바 여부

-- ═══════════════════════════════════════════════════════════════
-- 6. 공휴일 테이블 (기존에 있으면 그냥 유지)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER,                   -- NULL=전국공휴일, 숫자=병원전용
  holiday_date TEXT NOT NULL,            -- YYYY-MM-DD
  holiday_name TEXT NOT NULL DEFAULT '', -- 공휴일명
  holiday_type TEXT NOT NULL DEFAULT 'national', -- national|substitute|hospital
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, holiday_date)
);

-- ═══════════════════════════════════════════════════════════════
-- 7. 최소 인원 설정 테이블
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS schedule_min_staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  position_id INTEGER,                   -- NULL=전체, 숫자=특정직위
  team TEXT DEFAULT NULL,                -- NULL=전체, 'cook'|'nutrition'
  min_count INTEGER NOT NULL DEFAULT 1,  -- 최소 인원
  note TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, position_id, team),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- ═══════════════════════════════════════════════════════════════
-- 8. 인덱스
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_employees_hospital_team ON employees(hospital_id, team);
CREATE INDEX IF NOT EXISTS idx_employees_position ON employees(position_id);
CREATE INDEX IF NOT EXISTS idx_employee_leaves_emp_year ON employee_leaves(employee_id, year);
CREATE INDEX IF NOT EXISTS idx_schedule_shifts_hospital ON schedule_shifts(hospital_id);
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(holiday_date);

-- ========== migrations/0040_monthly_off_grants.sql ==========
-- ═══════════════════════════════════════════════════════════════
-- 0040_monthly_off_grants.sql
-- 월별 부여휴무 & 대체휴무 관리
-- ═══════════════════════════════════════════════════════════════
--
-- [개념]
-- ① 부여휴무 (granted_off)
--    - 해당 월의 토요일 + 일요일 + 공휴일 합산
--    - 서버에서 자동 계산하여 제공 (DB 저장 불필요, API로 반환)
--
-- ② 대체휴무 (substitute_off)
--    - 정부/지자체가 추가로 지정하는 임시 공휴일 / 대체공휴일
--    - 언제 지정될지 불확실 → 수동 추가
--    - 병원별 또는 전체 공통으로 등록 가능
-- ═══════════════════════════════════════════════════════════════

-- ① 대체휴무 테이블 (수동 추가)
CREATE TABLE IF NOT EXISTS substitute_off_days (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER DEFAULT NULL,       -- NULL = 전체 공통, 숫자 = 특정 병원
  off_date    TEXT    NOT NULL,           -- YYYY-MM-DD
  off_name    TEXT    NOT NULL DEFAULT '대체휴무',  -- 명칭
  off_reason  TEXT    DEFAULT '',         -- 사유 (예: '부처님오신날 대체')
  created_by  TEXT    DEFAULT '',         -- 등록자
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, off_date)
);

CREATE INDEX IF NOT EXISTS idx_substitute_off_hospital ON substitute_off_days(hospital_id);
CREATE INDEX IF NOT EXISTS idx_substitute_off_date     ON substitute_off_days(off_date);

-- ② 셰프 직위 기본값 추가 (조리팀)
INSERT OR IGNORE INTO employee_positions (hospital_id, team, name, sort_order, is_default) VALUES
  (NULL, 'cook', '셰프', 5, 1);

-- ========== migrations/0041_fix_positions.sql ==========
-- 부주방장 삭제 (요청서에 없는 직책)
DELETE FROM employee_positions WHERE name = '부주방장';

-- 조리보조 → 조리원으로 이름 변경
UPDATE employee_positions SET name = '조리원' WHERE name = '조리보조';

-- employees 테이블에서도 포지션 이름 참조 업데이트 (혹시 직접 저장된 경우)
UPDATE employees SET position = '조리원' WHERE position = '조리보조';

-- work_parts 컬럼 추가 (근무 가능 파트, 이미 있으면 무시)
-- ALTER TABLE employees ADD COLUMN work_parts TEXT DEFAULT '';

-- ========== migrations/0042_labor_cost_tables.sql ==========
-- ════════════════════════════════════════════════════════════════
-- 0042: 인건비 관련 테이블 추가
-- ════════════════════════════════════════════════════════════════

-- 1. 인건비 단가 설정 (병원별)
CREATE TABLE IF NOT EXISTS labor_cost_settings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id   INTEGER NOT NULL,
  cost_type     TEXT    NOT NULL,
  unit_price    REAL    NOT NULL DEFAULT 0,
  description   TEXT    DEFAULT '',
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, cost_type),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 2. 직원별 OT/야간 수당 설정
CREATE TABLE IF NOT EXISTS employee_ot_settings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id     INTEGER NOT NULL,
  employee_id     INTEGER NOT NULL,
  hourly_wage     REAL    DEFAULT 0,
  ot_rate         REAL    DEFAULT 1.5,
  night_rate      REAL    DEFAULT 0.5,
  note            TEXT    DEFAULT '',
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, employee_id),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

-- 3. daily_schedules 컬럼 추가 (SQLite는 IF NOT EXISTS 미지원 → 오류 무시 방식 사용)
ALTER TABLE daily_schedules ADD COLUMN is_night_work INTEGER DEFAULT 0;
ALTER TABLE daily_schedules ADD COLUMN temp_type TEXT DEFAULT NULL;
ALTER TABLE daily_schedules ADD COLUMN temp_hours REAL DEFAULT 0;

-- ========== migrations/0043_schedule_enhancements.sql ==========
-- ══════════════════════════════════════════════════════
-- 0043: 스케줄 모듈 고도화 - 급여형태·법적경고설정·모듈ON/OFF
-- ══════════════════════════════════════════════════════

-- 1. 직원 테이블에 급여 형태 필드 추가
ALTER TABLE employees ADD COLUMN salary_type TEXT NOT NULL DEFAULT 'monthly';
-- 'hourly' | 'monthly' | 'annual'
ALTER TABLE employees ADD COLUMN base_salary REAL DEFAULT 0;
-- 시급(hourly) or 월급(monthly) or 연봉(annual) 금액
ALTER TABLE employees ADD COLUMN ot_enabled INTEGER NOT NULL DEFAULT 0;
-- OT/연장수당 계산 사용 여부 (직원 단위)
ALTER TABLE employees ADD COLUMN night_allowance_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN holiday_allowance_enabled INTEGER NOT NULL DEFAULT 0;

-- 2. 병원별 법적근무시간 경고 설정 테이블
CREATE TABLE IF NOT EXISTS hospital_work_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  setting_key TEXT NOT NULL,        -- 설정 키
  setting_value TEXT NOT NULL,      -- 설정 값
  description TEXT DEFAULT '',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, setting_key),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 기본 법적 경고 설정값 주석 (애플리케이션에서 없으면 기본값 사용)
-- daily_max_hours: 8          (1일 최대 근무시간, 초과 시 OT 경고)
-- weekly_max_hours: 52        (주 최대 근무시간)
-- consecutive_max_days: 6     (연속근무 최대일수)
-- leave_cluster_threshold: 3  (연차 쏠림 경고 기준 인원수)
-- legal_warning_enabled: 1    (법적 근무시간 경고 ON/OFF)
-- ot_cost_enabled: 1          (OT/수당 계산 기능 ON/OFF)
-- dispatch_enabled: 1         (파출/알바 관리 기능 ON/OFF)

-- 3. 모듈 ON/OFF 설정 (hospital_work_settings에 포함)
-- 위 테이블의 setting_key 로 관리:
--   'legal_warning_enabled'  → '1' or '0'
--   'ot_cost_enabled'        → '1' or '0'
--   'dispatch_enabled'       → '1' or '0'

-- 4. 연차 이력 상세 테이블 (반차/경조사 횟수 추적)
CREATE TABLE IF NOT EXISTS employee_leave_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  leave_date TEXT NOT NULL,         -- YYYY-MM-DD
  leave_subtype TEXT NOT NULL,      -- 'annual'|'half_am'|'half_pm'|'event'|'sick'
  note TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_leave_history_emp_year
  ON employee_leave_history(hospital_id, employee_id, year);

-- ========== migrations/0044_labor_cost_v2.sql ==========
-- ══════════════════════════════════════════════════════════════
-- 0044: 인건비 v2 - 스케줄 기반 자동계산 구조
-- ══════════════════════════════════════════════════════════════

-- 1. daily_schedules에 근무시간 자동계산 컬럼 추가
ALTER TABLE daily_schedules ADD COLUMN basic_work_hours   REAL DEFAULT 0;
-- 기본 근무시간 (shift 기반, 휴게 포함 제외)
ALTER TABLE daily_schedules ADD COLUMN night_work_hours   REAL DEFAULT 0;
-- 22:00~06:00 해당 야간 근무시간
ALTER TABLE daily_schedules ADD COLUMN holiday_work_hours REAL DEFAULT 0;
-- 휴일(토/일/공휴일) 근무시간
ALTER TABLE daily_schedules ADD COLUMN weekly_holiday_pay INTEGER DEFAULT 0;
-- 주휴수당 대상 여부 (주 15h 이상 개근 시 1)

-- 2. 파출/알바 스케줄 테이블 (직원 미등록 외부 인력)
CREATE TABLE IF NOT EXISTS dispatch_schedules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id  INTEGER NOT NULL,
  work_date    TEXT    NOT NULL,   -- YYYY-MM-DD
  disp_type    TEXT    NOT NULL,   -- 'dispatch_morning'|'dispatch_afternoon'|'dispatch_fullday'|'parttime_morning'|'parttime_afternoon'|'parttime_fullday'
  count        INTEGER DEFAULT 1, -- 인원 수
  hours        REAL    DEFAULT 0, -- 실 근무시간 (알바 시급 계산용)
  unit_price   REAL    DEFAULT 0, -- 단가 (당일 기준, 0이면 설정값 사용)
  memo         TEXT    DEFAULT '',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_dispatch_sched_hospital_date
  ON dispatch_schedules(hospital_id, work_date);

-- 3. monthly_work_summary 테이블 (월별 집계 캐시)
CREATE TABLE IF NOT EXISTS monthly_work_summary (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id          INTEGER NOT NULL,
  employee_id          INTEGER NOT NULL,
  year                 INTEGER NOT NULL,
  month                INTEGER NOT NULL,
  work_days            INTEGER DEFAULT 0,   -- 실 근무일
  basic_hours          REAL    DEFAULT 0,   -- 기본 근무시간 합계
  ot_hours             REAL    DEFAULT 0,   -- 연장근로 시간
  night_hours          REAL    DEFAULT 0,   -- 야간근로 시간
  holiday_hours        REAL    DEFAULT 0,   -- 휴일근로 시간
  weekly_holiday_days  INTEGER DEFAULT 0,   -- 주휴수당 지급일수
  annual_leave_used    REAL    DEFAULT 0,   -- 연차 사용일
  ot_cost              REAL    DEFAULT 0,   -- OT 수당
  night_cost           REAL    DEFAULT 0,   -- 야간 수당
  holiday_cost         REAL    DEFAULT 0,   -- 휴일 수당
  weekly_holiday_cost  REAL    DEFAULT 0,   -- 주휴수당
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, employee_id, year, month),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_monthly_work_summary
  ON monthly_work_summary(hospital_id, year, month);

-- ========== migrations/0045_dispatch_unique.sql ==========
-- 0045: dispatch_schedules UNIQUE 제약 추가 (hospital_id, work_date, disp_type)
-- ON CONFLICT upsert를 위해 필요
CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatch_unique
  ON dispatch_schedules(hospital_id, work_date, disp_type);

-- ========== migrations/0046_external_workers.sql ==========
-- ══════════════════════════════════════════════════════════════
-- 0046: 외부인력(파출/알바) 인원 관리 테이블
-- 내부 직원(employees)과 완전 분리, 월간 스케줄에서 직접 관리
-- ══════════════════════════════════════════════════════════════

-- 외부인력 마스터 (이름+타입 저장, 재사용 가능)
CREATE TABLE IF NOT EXISTS external_workers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id  INTEGER NOT NULL,
  name         TEXT    NOT NULL,           -- "김○○", "박○○"
  worker_type  TEXT    NOT NULL DEFAULT 'dispatch',  -- 'dispatch'(파출) | 'parttime'(알바)
  memo         TEXT    DEFAULT '',
  is_active    INTEGER DEFAULT 1,          -- 0=비활성(숨김)
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_ext_workers_hospital
  ON external_workers(hospital_id, is_active);

-- 외부인력 월별 스케줄
-- 하루에 같은 외부인력이 여러 타입으로 올 수 없으므로 UNIQUE
CREATE TABLE IF NOT EXISTS external_schedules (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id     INTEGER NOT NULL,
  worker_id       INTEGER NOT NULL,        -- external_workers.id
  work_date       TEXT    NOT NULL,        -- YYYY-MM-DD
  shift_type      TEXT    NOT NULL,        -- 'morning'|'afternoon'|'full_9h'|'full_12h'
  unit_price      REAL    DEFAULT 0,       -- 0=기본단가설정값 사용
  note            TEXT    DEFAULT '',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, worker_id, work_date),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (worker_id)   REFERENCES external_workers(id)
);

CREATE INDEX IF NOT EXISTS idx_ext_sched_hospital_date
  ON external_schedules(hospital_id, work_date);
CREATE INDEX IF NOT EXISTS idx_ext_sched_worker
  ON external_schedules(worker_id, work_date);

-- 단가 설정 확장: 기존 labor_cost_settings에 새 키 추가 (INSERT OR IGNORE)
-- dispatch_morning / dispatch_afternoon / dispatch_full_9h / dispatch_full_12h
-- parttime_morning / parttime_afternoon / parttime_full_9h / parttime_full_12h
-- (기존 dispatch_9h, dispatch_12h, parttime_hourly 키는 호환 유지)

-- ========== migrations/0047_leave_carryover_allowance.sql ==========
-- 연차 이월/수당 지급 관리 컬럼 추가
-- carried_over_days : 전년도에서 이월된 잔여 연차 일수
-- allowance_paid    : 연차수당 지급 여부 (0=미지급, 1=지급완료)
-- allowance_paid_at : 연차수당 지급일

ALTER TABLE employee_leaves ADD COLUMN carried_over_days REAL NOT NULL DEFAULT 0;
ALTER TABLE employee_leaves ADD COLUMN allowance_paid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE employee_leaves ADD COLUMN allowance_paid_at TEXT;

