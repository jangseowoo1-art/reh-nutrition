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
