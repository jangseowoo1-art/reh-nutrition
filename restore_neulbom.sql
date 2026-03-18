-- =====================================================
-- 늘봄요양병원 복원 SQL
-- 대상: hospital_id = 3 (기존 병원3/HOSP03 재활용)
-- =====================================================

-- 1. 병원 기본정보 업데이트
UPDATE hospitals
SET name = '늘봄요양병원',
    address = '경기 용인시 수지구 포은대로59번길 17'
WHERE id = 3;

-- 2. 계정 비밀번호 변경 (hosp03 → 12324)
-- SHA256('12324') = 95d245f3eb25eb695e980c0591c16a4c818e609cd2aac265580749c877848926
UPDATE users
SET password_hash = '95d245f3eb25eb695e980c0591c16a4c818e609cd2aac265580749c877848926',
    password_plain = '12324'
WHERE username = 'hosp03' AND hospital_id = 3;

-- 3. hospital_info upsert (활성 연/월 = 2026년 3월)
INSERT INTO hospital_info (
  hospital_id, hospital_type, address,
  current_year, current_month, closing_status,
  updated_at
) VALUES (
  3, '요양병원', '경기 용인시 수지구 포은대로59번길 17',
  2026, 3, 'open',
  CURRENT_TIMESTAMP
)
ON CONFLICT(hospital_id) DO UPDATE SET
  hospital_type = '요양병원',
  address = '경기 용인시 수지구 포은대로59번길 17',
  current_year = 2026,
  current_month = 3,
  closing_status = 'open',
  updated_at = CURRENT_TIMESTAMP;

-- 4. 기존 병원3 업체 삭제 (있을 경우)
DELETE FROM vendors WHERE hospital_id = 3;

-- 5. 업체 목록 등록 (6개)
-- 삼성웰스토리: 대기업급식, mixed
INSERT INTO vendors (hospital_id, name, category, tax_type, monthly_budget, sort_order, is_active)
VALUES (3, '삼성웰스토리', 'major', 'mixed', 0, 1, 1);

-- 현지 육류업체: 육류, 면세
INSERT INTO vendors (hospital_id, name, category, tax_type, monthly_budget, sort_order, is_active)
VALUES (3, '현지 육류업체', 'meat', 'exempt', 0, 2, 1);

-- 이산유통: 일반(청과/농산), 면세
INSERT INTO vendors (hospital_id, name, category, tax_type, monthly_budget, sort_order, is_active)
VALUES (3, '이산유통', 'fruit', 'exempt', 0, 3, 1);

-- 호일헬스케어(뉴케어): 소모품/의료용품
INSERT INTO vendors (hospital_id, name, category, tax_type, monthly_budget, sort_order, is_active)
VALUES (3, '호일헬스케어(뉴케어)', 'supply', 'taxable', 684000, 4, 1);

-- 경기메디칼(그린비아): 소모품/의료용품
INSERT INTO vendors (hospital_id, name, category, tax_type, monthly_budget, sort_order, is_active)
VALUES (3, '경기메디칼(그린비아)', 'supply', 'taxable', 0, 5, 1);

-- 신진세척기: 소모품/세척
INSERT INTO vendors (hospital_id, name, category, tax_type, monthly_budget, sort_order, is_active)
VALUES (3, '신진세척기', 'supply', 'taxable', 0, 6, 1);

-- 6. 2026년 3월 월 설정
-- 총목표: 6,870,000 / 소모품: 684,000 / 목표식단가: 3,593 / 잔반목표: 1,400,000
INSERT INTO monthly_settings (
  hospital_id, year, month,
  total_budget, event_budget, meal_price,
  food_waste_budget, working_days,
  supply_budget, card_budget,
  created_at, updated_at
) VALUES (
  3, 2026, 3,
  6870000, 0, 3593,
  1400000, 31,
  684000, 0,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT(hospital_id, year, month) DO UPDATE SET
  total_budget    = 6870000,
  event_budget    = 0,
  meal_price      = 3593,
  food_waste_budget = 1400000,
  working_days    = 31,
  supply_budget   = 684000,
  card_budget     = 0,
  updated_at      = CURRENT_TIMESTAMP;

-- 7. 환자군 카테고리 등록 (항암 / 요양)
-- 기존 병원3 카테고리 비활성화
UPDATE hospital_patient_categories SET is_active = 0 WHERE hospital_id = 3;

INSERT INTO hospital_patient_categories
  (hospital_id, category_key, category_name, order_code, sort_order, is_active)
VALUES
  (3, 'cancer',  '항암',  'C', 0, 1),
  (3, 'nursing', '요양',  'N', 1, 1)
ON CONFLICT(hospital_id, category_key) DO UPDATE SET
  category_name = excluded.category_name,
  order_code    = excluded.order_code,
  sort_order    = excluded.sort_order,
  is_active     = 1;

-- 8. meal_custom_fields 동기화 (환자군 → cat_cancer, cat_nursing)
UPDATE meal_custom_fields SET is_active = 0
WHERE hospital_id = 3 AND field_key LIKE 'cat_%';

INSERT INTO meal_custom_fields
  (hospital_id, field_key, field_name, sort_order, is_active, unit_type)
VALUES
  (3, 'cat_cancer',  '항암', 0, 1, 'meal'),
  (3, 'cat_nursing', '요양', 1, 1, 'meal')
ON CONFLICT(hospital_id, field_key) DO UPDATE SET
  field_name = excluded.field_name,
  sort_order = excluded.sort_order,
  is_active  = 1;

-- 9. 카테고리별 월 목표 설정 (2026년 3월)
-- 항암: 목표금액 22,500,000 / 목표식단가 6,000
-- 요양: 목표금액 34,000,000 / 목표식단가 2,000
INSERT INTO category_order_settings
  (hospital_id, patient_category_id, year, month, monthly_budget, target_meal_price, working_days, updated_at)
SELECT
  3,
  hpc.id,
  2026, 3,
  CASE hpc.category_key
    WHEN 'cancer'  THEN 22500000
    WHEN 'nursing' THEN 34000000
  END,
  CASE hpc.category_key
    WHEN 'cancer'  THEN 6000
    WHEN 'nursing' THEN 2000
  END,
  31,
  CURRENT_TIMESTAMP
FROM hospital_patient_categories hpc
WHERE hpc.hospital_id = 3 AND hpc.category_key IN ('cancer', 'nursing')
ON CONFLICT(hospital_id, patient_category_id, year, month) DO UPDATE SET
  monthly_budget    = excluded.monthly_budget,
  target_meal_price = excluded.target_meal_price,
  working_days      = excluded.working_days,
  updated_at        = CURRENT_TIMESTAMP;

-- 10. 테스트 발주 데이터 (모두 삼성웰스토리 vendor_id=20 기준)
-- 삭제 후 재삽입
DELETE FROM daily_orders WHERE hospital_id = 3 AND strftime('%Y-%m', order_date) = '2026-03';

INSERT INTO daily_orders
  (hospital_id, order_date, vendor_id, patient_category_id,
   taxable_amount, exempt_amount, vat_amount, total_amount,
   is_inspected, inspection_status)
SELECT
  3, '2026-03-10', v.id, hpc.id,
  200000, 0, 20000, 220000, 1, 'approved'
FROM vendors v, hospital_patient_categories hpc
WHERE v.hospital_id=3 AND v.name='삼성웰스토리'
  AND hpc.hospital_id=3 AND hpc.category_key='cancer';

INSERT INTO daily_orders
  (hospital_id, order_date, vendor_id, patient_category_id,
   taxable_amount, exempt_amount, vat_amount, total_amount,
   is_inspected, inspection_status)
SELECT
  3, '2026-03-10', v.id, hpc.id,
  800000, 0, 80000, 880000, 1, 'approved'
FROM vendors v, hospital_patient_categories hpc
WHERE v.hospital_id=3 AND v.name='삼성웰스토리'
  AND hpc.hospital_id=3 AND hpc.category_key='nursing';

INSERT INTO daily_orders
  (hospital_id, order_date, vendor_id, patient_category_id,
   taxable_amount, exempt_amount, vat_amount, total_amount,
   is_inspected, inspection_status)
SELECT
  3, '2026-03-16', v.id, hpc.id,
  1363636, 0, 136364, 1500000, 0, 'pending'
FROM vendors v, hospital_patient_categories hpc
WHERE v.hospital_id=3 AND v.name='삼성웰스토리'
  AND hpc.hospital_id=3 AND hpc.category_key='cancer';

INSERT INTO daily_orders
  (hospital_id, order_date, vendor_id, patient_category_id,
   taxable_amount, exempt_amount, vat_amount, total_amount,
   is_inspected, inspection_status)
SELECT
  3, '2026-03-16', v.id, hpc.id,
  4545455, 0, 454545, 5000000, 0, 'pending'
FROM vendors v, hospital_patient_categories hpc
WHERE v.hospital_id=3 AND v.name='삼성웰스토리'
  AND hpc.hospital_id=3 AND hpc.category_key='nursing';

INSERT INTO daily_orders
  (hospital_id, order_date, vendor_id, patient_category_id,
   taxable_amount, exempt_amount, vat_amount, total_amount,
   is_inspected, inspection_status)
SELECT
  3, '2026-03-17', v.id, hpc.id,
  3000000, 0, 0, 3000000, 0, 'pending'
FROM vendors v, hospital_patient_categories hpc
WHERE v.hospital_id=3 AND v.name='현지 육류업체'
  AND hpc.hospital_id=3 AND hpc.category_key='cancer';

INSERT INTO daily_orders
  (hospital_id, order_date, vendor_id, patient_category_id,
   taxable_amount, exempt_amount, vat_amount, total_amount,
   is_inspected, inspection_status)
SELECT
  3, '2026-03-17', v.id, hpc.id,
  1000000, 0, 0, 1000000, 0, 'pending'
FROM vendors v, hospital_patient_categories hpc
WHERE v.hospital_id=3 AND v.name='이산유통'
  AND hpc.hospital_id=3 AND hpc.category_key='nursing';
