-- 기본 관리자 계정 (비밀번호: admin1234)
-- SHA256('admin1234') = ac9689e2272427085e35b9d3e3e8bed88cb3434828b43b86fc0596cad4c6e270
INSERT OR IGNORE INTO users (hospital_id, username, password_hash, role) VALUES
  (NULL, 'admin', 'ac9689e2272427085e35b9d3e3e8bed88cb3434828b43b86fc0596cad4c6e270', 'admin');

-- 샘플 병원 7개
INSERT OR IGNORE INTO hospitals (name, code) VALUES
  ('아미나 병원', 'AMINA'),
  ('무이재 한방병원', 'MUIJAE'),
  ('병원3', 'HOSP03'),
  ('병원4', 'HOSP04'),
  ('병원5', 'HOSP05'),
  ('병원6', 'HOSP06'),
  ('병원7', 'HOSP07');

-- 병원별 계정 (비밀번호: hospital1234)
-- SHA256('hospital1234') = 8a0bf7b26c642f3cefe3939c4919163b86fdd10a23328aad4246199b50dbd1b1
INSERT OR IGNORE INTO users (hospital_id, username, password_hash, role) VALUES
  (1, 'amina', '8a0bf7b26c642f3cefe3939c4919163b86fdd10a23328aad4246199b50dbd1b1', 'hospital'),
  (2, 'muijae', '8a0bf7b26c642f3cefe3939c4919163b86fdd10a23328aad4246199b50dbd1b1', 'hospital'),
  (3, 'hosp03', '8a0bf7b26c642f3cefe3939c4919163b86fdd10a23328aad4246199b50dbd1b1', 'hospital'),
  (4, 'hosp04', '8a0bf7b26c642f3cefe3939c4919163b86fdd10a23328aad4246199b50dbd1b1', 'hospital'),
  (5, 'hosp05', '8a0bf7b26c642f3cefe3939c4919163b86fdd10a23328aad4246199b50dbd1b1', 'hospital'),
  (6, 'hosp06', '8a0bf7b26c642f3cefe3939c4919163b86fdd10a23328aad4246199b50dbd1b1', 'hospital'),
  (7, 'hosp07', '8a0bf7b26c642f3cefe3939c4919163b86fdd10a23328aad4246199b50dbd1b1', 'hospital');

-- 아미나 병원 업체 샘플
INSERT OR IGNORE INTO vendors (hospital_id, name, category, tax_type, monthly_budget, sort_order) VALUES
  (1, '삼성 웰스토리', 'major', 'mixed', 33000000, 1),
  (1, '아워홈', 'major', 'mixed', 45000000, 2),
  (1, '하나로미트(육류)', 'meat', 'exempt', 8500000, 3),
  (1, '명진수산(농수산)', 'seafood', 'exempt', 0, 4),
  (1, '한살림', 'organic', 'exempt', 500000, 5),
  (1, '낙원(떡)', 'general', 'exempt', 1000000, 6),
  (1, '청과(사과)', 'fruit', 'exempt', 1500000, 7),
  (1, '돌핀', 'general', 'exempt', 500000, 8),
  (1, '이벤트', 'event', 'mixed', 5000000, 9),
  (1, '인터넷(유튜브)', 'delivery', 'taxable', 0, 10);

-- 무이재 한방병원 업체 샘플
INSERT OR IGNORE INTO vendors (hospital_id, name, category, tax_type, monthly_budget, sort_order) VALUES
  (2, '삼성 웰스토리', 'major', 'mixed', 33000000, 1),
  (2, '아워홈', 'major', 'mixed', 45000000, 2),
  (2, '하나로미트(육류)', 'meat', 'exempt', 8500000, 3),
  (2, '한살림', 'organic', 'exempt', 500000, 4),
  (2, '낙원(떡)', 'general', 'exempt', 1000000, 5),
  (2, '청과(사과)', 'fruit', 'exempt', 1500000, 6),
  (2, '돌핀', 'delivery', 'exempt', 500000, 7),
  (2, '이벤트', 'event', 'mixed', 5000000, 8),
  (2, '유튜브(인터넷)', 'delivery', 'taxable', 0, 9);

-- 2026년 3월 설정 (현재 월)
INSERT OR IGNORE INTO monthly_settings (hospital_id, year, month, total_budget, event_budget, meal_price, food_waste_budget, working_days) VALUES
  (1, 2026, 3, 90000000, 5000000, 7490, 1100000, 31),
  (2, 2026, 3, 90000000, 5000000, 7490, 1100000, 31);
