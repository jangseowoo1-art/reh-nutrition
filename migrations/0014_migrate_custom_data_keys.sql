-- ════════════════════════════════════════════════════════════════
-- custom_data JSON 키 변환: custom2 → cat_nursing (hospital_id=3 기준)
-- 이 마이그레이션은 로컬 테스트 데이터용입니다.
-- 실제 운영 환경에서는 아래 쿼리를 각 병원의 매핑 정보에 맞게 실행하세요.
-- ════════════════════════════════════════════════════════════════

-- hospital_id=3, custom2=요양 → cat_nursing 변환
-- SQLite에서 JSON 키 변환: REPLACE 함수 활용
UPDATE daily_meals 
SET custom_data = REPLACE(custom_data, '"custom2":', '"cat_nursing":')
WHERE hospital_id = 3 
  AND custom_data LIKE '%"custom2":%';
