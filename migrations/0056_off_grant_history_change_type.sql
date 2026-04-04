-- ================================================================
-- 0056_off_grant_history_change_type.sql
-- off_grant_history 테이블에 change_type 컬럼 추가
-- Phase E: lock 이력 타입 구분 (manual | force_recalc | auto)
-- ================================================================

-- off_grant_history에 change_type 컬럼 추가
ALTER TABLE off_grant_history ADD COLUMN change_type TEXT DEFAULT 'manual';

-- work_settings_history에도 change_type 추가 (이미 있을 수 있으므로 확인)
-- (0054에서 정의되었을 수 있으나 실제 컬럼 없는 경우를 위해 조건부 추가는 SQLite에서 지원 안 함)
-- 이미 있으면 오류 무시 (wrangler는 오류 시 중단하지 않을 수 있음)
