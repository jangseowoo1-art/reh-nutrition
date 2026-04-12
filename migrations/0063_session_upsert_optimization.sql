-- hospital_sessions 테이블 UPSERT 최적화
-- (hospital_id, user_id) 복합 unique 제약 추가로 D1 write 횟수 절감
-- 기존: SELECT + UPDATE/INSERT = 2회 → UPSERT = 1회

-- 1. 기존 중복 세션 정리 (가장 최신 1건만 남기고 삭제)
DELETE FROM hospital_sessions
WHERE id NOT IN (
  SELECT MAX(id) FROM hospital_sessions
  GROUP BY hospital_id, user_id
);

-- 2. (hospital_id, user_id) unique 제약 추가
-- SQLite는 ADD CONSTRAINT를 직접 지원하지 않으므로 unique index로 대체
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_hospital_user 
ON hospital_sessions(hospital_id, user_id);
