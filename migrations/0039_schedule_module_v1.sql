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
