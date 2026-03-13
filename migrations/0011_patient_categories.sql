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
