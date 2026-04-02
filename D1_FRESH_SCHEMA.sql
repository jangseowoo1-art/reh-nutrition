-- ================================================================
-- Hospital Meal Budget System - Complete Schema (D1 Compatible)
-- Generated: All tables with final column structure
-- ================================================================

-- 병원 테이블
CREATE TABLE IF NOT EXISTS hospitals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 사용자(계정) 테이블
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'hospital',
  nutritionist_name TEXT,
  password_plain TEXT DEFAULT NULL,
  sub_role TEXT DEFAULT NULL,
  executive_title TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 업체 테이블
CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  tax_type TEXT NOT NULL DEFAULT 'mixed',
  monthly_budget INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  is_card_type INTEGER DEFAULT 0,
  card_subtype TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 월별 설정 테이블
CREATE TABLE IF NOT EXISTS monthly_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  total_budget INTEGER DEFAULT 0,
  event_budget INTEGER DEFAULT 0,
  meal_price INTEGER DEFAULT 0,
  food_waste_budget INTEGER DEFAULT 0,
  working_days INTEGER DEFAULT 0,
  supply_budget INTEGER DEFAULT 0,
  card_budget INTEGER DEFAULT 0,
  waste_unit_price INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, year, month),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 일별 발주 테이블
CREATE TABLE IF NOT EXISTS daily_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  vendor_id INTEGER NOT NULL,
  order_date TEXT NOT NULL,
  taxable_amount INTEGER DEFAULT 0,
  exempt_amount INTEGER DEFAULT 0,
  vat_amount INTEGER DEFAULT 0,
  total_amount INTEGER DEFAULT 0,
  memo TEXT,
  patient_category_id INTEGER DEFAULT NULL,
  order_date_actual TEXT,
  received_date TEXT,
  is_inspected INTEGER DEFAULT 0,
  inspection_memo TEXT,
  actual_amount INTEGER DEFAULT 0,
  inspected_at TEXT,
  inspected_by TEXT,
  inspection_status TEXT DEFAULT 'pending',
  deduction_amount INTEGER DEFAULT 0,
  input_source TEXT DEFAULT 'manual',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);

-- 일별 식수 테이블
CREATE TABLE IF NOT EXISTS daily_meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  meal_date TEXT NOT NULL,
  total_patient INTEGER DEFAULT 0,
  total_staff INTEGER DEFAULT 0,
  total_non_covered INTEGER DEFAULT 0,
  total_guardian INTEGER DEFAULT 0,
  memo TEXT,
  custom_data TEXT DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, meal_date),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 직원 테이블
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  position TEXT,
  department TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 일별 스케줄 테이블
CREATE TABLE IF NOT EXISTS daily_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  schedule_date TEXT NOT NULL,
  shift_type TEXT NOT NULL DEFAULT 'day',
  work_hours REAL DEFAULT 8.0,
  is_off INTEGER DEFAULT 0,
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

-- 병원 세션 테이블
CREATE TABLE IF NOT EXISTS hospital_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
  last_action TEXT DEFAULT NULL,
  role TEXT DEFAULT 'hospital',
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 병원 정보 테이블
CREATE TABLE IF NOT EXISTS hospital_info (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL UNIQUE,
  bed_count INTEGER DEFAULT 0,
  patient_type TEXT DEFAULT 'mixed',
  meal_system TEXT DEFAULT 'cafeteria',
  staff_count INTEGER DEFAULT 0,
  notes TEXT,
  main_specialty TEXT DEFAULT '',
  main_category TEXT DEFAULT 'other',
  main_category_custom TEXT,
  monthly_avg_budget INTEGER DEFAULT 0,
  care_type TEXT DEFAULT 'general',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 온라인 잔반 테이블
CREATE TABLE IF NOT EXISTS online_foodwaste (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  waste_date TEXT NOT NULL,
  amount REAL DEFAULT 0,
  unit TEXT DEFAULT 'kg',
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 전문과 테이블
CREATE TABLE IF NOT EXISTS specialties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  code TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 일별 이슈 테이블
CREATE TABLE IF NOT EXISTS daily_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  issue_date TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  content TEXT NOT NULL,
  severity TEXT DEFAULT 'normal',
  is_resolved INTEGER DEFAULT 0,
  resolved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 계정 테이블
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  account_date TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  amount INTEGER DEFAULT 0,
  account_type TEXT DEFAULT 'expense',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 개선사항 테이블
CREATE TABLE IF NOT EXISTS improvements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  improvement_date TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  content TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 마감요청 테이블
CREATE TABLE IF NOT EXISTS close_month_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME,
  reviewed_by TEXT,
  memo TEXT,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 커스텀 필드 테이블
CREATE TABLE IF NOT EXISTS meal_custom_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  field_key TEXT NOT NULL,
  field_name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  unit_type TEXT DEFAULT 'meal',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, field_key),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 환자 카테고리 테이블
CREATE TABLE IF NOT EXISTS hospital_patient_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  category_key TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  color TEXT DEFAULT '#6B7280',
  description TEXT,
  include_in_meal_count INTEGER DEFAULT 1,
  include_in_meal_price INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, category_key),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 카테고리 발주 설정 테이블
CREATE TABLE IF NOT EXISTS category_order_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  patient_category_id INTEGER NOT NULL,
  vendor_id INTEGER NOT NULL,
  monthly_budget INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  daily_meal_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, patient_category_id, vendor_id),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (patient_category_id) REFERENCES hospital_patient_categories(id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);

-- 법인카드 지출 테이블
CREATE TABLE IF NOT EXISTS card_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  vendor_id INTEGER,
  expense_date TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  category TEXT DEFAULT 'general',
  receipt_url TEXT,
  expense_type TEXT NOT NULL DEFAULT '법인카드',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);

-- 잔반 재료 테이블
CREATE TABLE IF NOT EXISTS waste_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  waste_date TEXT NOT NULL,
  ingredient_name TEXT NOT NULL,
  amount REAL DEFAULT 0,
  unit TEXT DEFAULT 'kg',
  cost INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 검수 이슈 테이블
CREATE TABLE IF NOT EXISTS inspection_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  issue_type TEXT NOT NULL,
  description TEXT,
  severity TEXT DEFAULT 'normal',
  is_resolved INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (order_id) REFERENCES daily_orders(id)
);

-- 거래명세서 테이블
CREATE TABLE IF NOT EXISTS transaction_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  vendor_id INTEGER,
  doc_date TEXT NOT NULL,
  doc_number TEXT,
  total_amount INTEGER DEFAULT 0,
  status TEXT DEFAULT 'draft',
  memo TEXT,
  trade_period TEXT DEFAULT '',
  date_from TEXT DEFAULT NULL,
  date_to TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);

-- 거래명세서 항목 테이블
CREATE TABLE IF NOT EXISTS transaction_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  quantity REAL DEFAULT 0,
  unit TEXT DEFAULT 'kg',
  unit_price INTEGER DEFAULT 0,
  total_price INTEGER DEFAULT 0,
  tax_type TEXT DEFAULT 'taxable',
  item_code TEXT DEFAULT '',
  spec TEXT DEFAULT '',
  supplier_category TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES transaction_documents(id)
);

-- 거래 파일 테이블
CREATE TABLE IF NOT EXISTS transaction_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  vendor_id INTEGER,
  file_name TEXT NOT NULL,
  file_url TEXT,
  file_type TEXT DEFAULT 'pdf',
  period TEXT,
  date_from TEXT DEFAULT NULL,
  date_to TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 식단 카테고리 테이블
CREATE TABLE IF NOT EXISTS diet_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  diet_key TEXT NOT NULL,
  diet_name TEXT NOT NULL,
  parent_type TEXT DEFAULT 'patient',
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  is_visible_in_input INTEGER DEFAULT 1,
  include_in_meal_count INTEGER DEFAULT 1,
  patient_group TEXT DEFAULT NULL,
  diet_level TEXT DEFAULT 'group',
  include_in_meal_price INTEGER DEFAULT 0,
  linked_patient_group TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, diet_key),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 식단 카테고리 프리셋 테이블
CREATE TABLE IF NOT EXISTS diet_category_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_key TEXT NOT NULL,
  diet_name TEXT NOT NULL,
  parent_type TEXT DEFAULT 'patient',
  sort_order INTEGER DEFAULT 0,
  is_default INTEGER DEFAULT 0,
  linked_patient_group TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(preset_key)
);

-- 참조 식단가 테이블
CREATE TABLE IF NOT EXISTS ref_meal_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  meal_price INTEGER DEFAULT 0,
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, year, month),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 다일 발주 설정 테이블
CREATE TABLE IF NOT EXISTS order_multiday_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  setting_key TEXT NOT NULL,
  setting_value TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, setting_key),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 스케줄 모듈 관련 테이블들
CREATE TABLE IF NOT EXISTS schedule_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  position_name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE TABLE IF NOT EXISTS schedule_shift_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  shift_name TEXT NOT NULL,
  shift_code TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  work_hours REAL DEFAULT 8.0,
  color TEXT DEFAULT '#6B7280',
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE TABLE IF NOT EXISTS schedule_staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  position_id INTEGER,
  employee_type TEXT DEFAULT 'full_time',
  hire_date TEXT,
  resign_date TEXT,
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (position_id) REFERENCES schedule_positions(id)
);

CREATE TABLE IF NOT EXISTS schedule_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  staff_id INTEGER NOT NULL,
  schedule_date TEXT NOT NULL,
  shift_type_id INTEGER,
  is_off INTEGER DEFAULT 0,
  off_type TEXT,
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (staff_id) REFERENCES schedule_staff(id),
  FOREIGN KEY (shift_type_id) REFERENCES schedule_shift_types(id)
);

CREATE TABLE IF NOT EXISTS monthly_off_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  staff_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  granted_days REAL DEFAULT 0,
  used_days REAL DEFAULT 0,
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, staff_id, year, month),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (staff_id) REFERENCES schedule_staff(id)
);

-- 인건비 관련 테이블
CREATE TABLE IF NOT EXISTS labor_cost_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  base_salary INTEGER DEFAULT 0,
  overtime_rate REAL DEFAULT 1.5,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, year, month),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE TABLE IF NOT EXISTS labor_cost_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  staff_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  base_pay INTEGER DEFAULT 0,
  overtime_pay INTEGER DEFAULT 0,
  bonus INTEGER DEFAULT 0,
  deduction INTEGER DEFAULT 0,
  total_pay INTEGER DEFAULT 0,
  work_days INTEGER DEFAULT 0,
  overtime_hours REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, staff_id, year, month),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (staff_id) REFERENCES schedule_staff(id)
);

-- 외부 근로자 테이블
CREATE TABLE IF NOT EXISTS external_workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  worker_type TEXT DEFAULT 'part_time',
  work_date TEXT NOT NULL,
  work_hours REAL DEFAULT 0,
  hourly_rate INTEGER DEFAULT 0,
  total_pay INTEGER DEFAULT 0,
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 연차 이월 설정 테이블
CREATE TABLE IF NOT EXISTS leave_carryover_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  carryover_days REAL DEFAULT 0,
  max_carryover REAL DEFAULT 0,
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hospital_id, year),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 재고 식재료 가격 테이블
CREATE TABLE IF NOT EXISTS vendor_ingredient_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  vendor_id INTEGER NOT NULL,
  ingredient_name TEXT NOT NULL,
  unit TEXT DEFAULT 'kg',
  unit_price INTEGER DEFAULT 0,
  effective_date TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);

-- 병원 거래처 테이블
CREATE TABLE IF NOT EXISTS hospital_invoice_vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  vendor_name TEXT NOT NULL,
  business_number TEXT,
  contact TEXT,
  address TEXT,
  upload_mode TEXT DEFAULT 'monthly',
  period_type TEXT DEFAULT 'auto',
  vendor_id INTEGER REFERENCES vendors(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 파견 고유 인덱스를 위한 테이블 (schedule_entries에 UNIQUE 제약)
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_entries_unique
  ON schedule_entries(hospital_id, staff_id, schedule_date);

-- 인덱스들
CREATE INDEX IF NOT EXISTS idx_daily_orders_hospital_date ON daily_orders(hospital_id, order_date);
CREATE INDEX IF NOT EXISTS idx_daily_meals_hospital_date ON daily_meals(hospital_id, meal_date);
CREATE INDEX IF NOT EXISTS idx_daily_schedules_hospital ON daily_schedules(hospital_id, schedule_date);
CREATE INDEX IF NOT EXISTS idx_vendors_hospital ON vendors(hospital_id, is_active);
CREATE INDEX IF NOT EXISTS idx_employees_hospital ON employees(hospital_id, is_active);
CREATE INDEX IF NOT EXISTS idx_meal_custom_fields_hospital ON meal_custom_fields(hospital_id);
CREATE INDEX IF NOT EXISTS idx_hospital_patient_categories_hospital ON hospital_patient_categories(hospital_id);
CREATE INDEX IF NOT EXISTS idx_card_expenses_hospital ON card_expenses(hospital_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_diet_categories_hospital ON diet_categories(hospital_id);

