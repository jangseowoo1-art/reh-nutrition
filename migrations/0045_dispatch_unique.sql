-- 0045: dispatch_schedules UNIQUE 제약 추가 (hospital_id, work_date, disp_type)
-- ON CONFLICT upsert를 위해 필요
CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatch_unique
  ON dispatch_schedules(hospital_id, work_date, disp_type);
