-- 세션 테이블에 마지막 액션 컬럼 추가
ALTER TABLE hospital_sessions ADD COLUMN last_action TEXT DEFAULT NULL;
