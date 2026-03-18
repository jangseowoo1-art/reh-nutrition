-- card_expenses에 expense_type 컬럼 추가 (법인카드, 현장구매, 추가발주, 소모품, 기타)
ALTER TABLE card_expenses ADD COLUMN expense_type TEXT NOT NULL DEFAULT '법인카드';
