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
