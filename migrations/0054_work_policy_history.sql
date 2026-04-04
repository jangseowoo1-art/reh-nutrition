-- ================================================================
-- 0054_work_policy_history.sql
-- 근무정책 이력 관리 테이블 추가
-- 목적:
--   1. work_settings_history  : 근무설정 변경 이력
--   2. off_grant_history      : 휴무 수동 수정 이력
--
-- 휴무 유형(off_type) 확정:
--   weekly_off     주5일제 토·일 휴무
--   holiday        공휴일 휴무
--   cycle_rest     순환근무 패턴 휴무
--   monthly_fixed  월고정 자동배치 휴무
--   min_guarantee  최소 보장 자동 추가 휴무
--   substitute     대체휴무 (work_substitute 정책)
--   manual         수동 수정 — base_off_type에 원본 유형 보존
--
-- cycle_holiday_policy 코드값:
--   ignore     순환패턴 그대로 유지 (공휴일 별도 처리 없음)
--   pay        공휴일이 근무일과 겹치면 공휴수당 지급
--   add        공휴일이 근무일과 겹치면 추가 휴무 부여
--   substitute 공휴일이 근무일과 겹치면 대체휴무 자동 생성
-- ================================================================

-- ① 근무설정 변경 이력
CREATE TABLE IF NOT EXISTS work_settings_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id  INTEGER NOT NULL,
  setting_key  TEXT    NOT NULL,
  prev_value   TEXT,
  new_value    TEXT,
  changed_by   TEXT    NOT NULL,
  changed_at   DATETIME DEFAULT (datetime('now','localtime')),
  change_type  TEXT    NOT NULL DEFAULT 'manual',
  -- change_type: 'manual'(수동변경) | 'force_recalc'(강제재계산)
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_wsh_hospital_key
  ON work_settings_history(hospital_id, setting_key);
CREATE INDEX IF NOT EXISTS idx_wsh_changed_at
  ON work_settings_history(hospital_id, changed_at);

-- ② 휴무 수동 수정 이력
--    base_off_type : 자동 배치 당시의 원본 유형 (수동 수정 후에도 보존)
--    is_manual_override : 0=자동, 1=수동수정됨
--    lock_flag     : 0=일반재계산 덮어쓰기 허용, 1=보호(수동잠금)
CREATE TABLE IF NOT EXISTS off_grant_history (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id         INTEGER NOT NULL,
  employee_id         INTEGER,             -- NULL이면 병원 전체 정책 변경
  target_date         TEXT    NOT NULL,    -- YYYY-MM-DD
  prev_off_type       TEXT,               -- 변경 전 off_type
  new_off_type        TEXT,               -- 변경 후 off_type
  base_off_type       TEXT,               -- 자동 배치 원본 유형 (보존)
  prev_is_manual      INTEGER DEFAULT 0,  -- 변경 전 is_manual_override
  new_is_manual       INTEGER DEFAULT 0,  -- 변경 후 is_manual_override
  prev_lock_flag      INTEGER DEFAULT 0,
  new_lock_flag       INTEGER DEFAULT 0,
  changed_by          TEXT    NOT NULL,
  changed_at          DATETIME DEFAULT (datetime('now','localtime')),
  note                TEXT,               -- 변경 사유 (선택)
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_ogh_hospital_date
  ON off_grant_history(hospital_id, target_date);
CREATE INDEX IF NOT EXISTS idx_ogh_employee
  ON off_grant_history(hospital_id, employee_id, target_date);
CREATE INDEX IF NOT EXISTS idx_ogh_changed_at
  ON off_grant_history(hospital_id, changed_at);
