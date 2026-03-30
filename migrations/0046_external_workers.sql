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
