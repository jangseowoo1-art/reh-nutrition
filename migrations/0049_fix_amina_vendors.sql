-- 아미나 병원(hospital_id=1) 초기 샘플 업체(id 1~10) 비활성화
-- 실제 사용 업체는 id 26~33 (푸드힐, 대동청과, 이산푸드, 하나로미트, 이벤트, 법인카드)
UPDATE vendors 
SET is_active = 0 
WHERE hospital_id = 1 AND id IN (1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
