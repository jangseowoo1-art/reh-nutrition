-- hospital_info 에 주 종목 컬럼 추가
ALTER TABLE hospital_info ADD COLUMN main_specialty TEXT DEFAULT '';
