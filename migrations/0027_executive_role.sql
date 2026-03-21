-- 0027: 운영진(executive) 역할 추가
-- users 테이블의 role에 'executive' 값 허용 (기존 CHECK 없음, TEXT 타입이므로 별도 작업 불필요)
-- executive 전용 메모 컬럼 추가 (운영진 이름/직책)

ALTER TABLE users ADD COLUMN executive_title TEXT DEFAULT ''; -- 직책 (예: 원장, 이사, 부원장)

-- 운영진 세션 추적을 위한 hospital_sessions 확장 (role 컬럼 추가)
ALTER TABLE hospital_sessions ADD COLUMN role TEXT DEFAULT 'hospital';
