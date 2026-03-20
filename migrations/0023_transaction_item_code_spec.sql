-- transaction_items에 품목코드, 규격 컬럼 추가
ALTER TABLE transaction_items ADD COLUMN item_code TEXT DEFAULT '';
ALTER TABLE transaction_items ADD COLUMN spec TEXT DEFAULT '';
