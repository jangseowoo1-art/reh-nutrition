-- 계정 테이블에 평문 비밀번호 컬럼 추가
ALTER TABLE users ADD COLUMN password_plain TEXT DEFAULT NULL;
