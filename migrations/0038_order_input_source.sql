-- daily_orders 테이블에 입력 출처 컬럼 추가
-- 값: 'direct' (직접입력), 'excel' (엑셀업로드), 'edit' (수정입력)
ALTER TABLE daily_orders ADD COLUMN input_source TEXT DEFAULT 'direct';

-- 기존 데이터: 엑셀자동입력 메모가 있는 것은 excel로, 나머지는 direct로 설정
UPDATE daily_orders SET input_source = 'excel' WHERE note = '엑셀자동입력';
UPDATE daily_orders SET input_source = 'direct' WHERE note != '엑셀자동입력' OR note IS NULL;
