-- 업체 발주주기 설정 컬럼 추가
-- order_cycle: 'daily'(매일 발주) / 'weekly'(주 1회 발주)
-- 기본값: 'daily' (기존 업체 모두 매일 발주로 처리)
ALTER TABLE vendors ADD COLUMN order_cycle TEXT DEFAULT 'daily';
