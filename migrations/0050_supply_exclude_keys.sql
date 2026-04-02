-- hospital_info: 소모품/카드 제외 식단가 계산 기준 설정
-- supply_exclude_keys: JSON 배열로 제외할 항목 키 저장
-- 가능한 값: "card" (법인카드), "supply" (업체 발주 소모품), "event" (이벤트), "other" (기타 비식재료)
-- 기본값 NULL = 기존 동작 유지 (card + supply 모두 제외)
ALTER TABLE hospital_info ADD COLUMN supply_exclude_keys TEXT DEFAULT NULL;
