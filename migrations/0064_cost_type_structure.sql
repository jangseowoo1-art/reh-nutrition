-- ══════════════════════════════════════════════════════════════════
-- Migration 0064: 비용 유형(cost_type) 구조 개편
-- 목적: 업체(vendor)와 비용유형(cost_type)을 완전 분리
--       관리자 병원설정 = 모든 계산의 Single Source of Truth
-- ══════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- 1. daily_orders에 cost_type 컬럼 추가
--    food    = 식재료비 (식단가 계산 핵심, 기본값)
--    supply  = 소모품비 (세제, 위생용품, 소모성 자재)
--    event   = 이벤트/운영비 (행사, 특별식, 운영 이벤트)
--    utility = 공과금/인터넷 등 고정 운영비
--    other   = 기타
-- ────────────────────────────────────────────────────────────────
ALTER TABLE daily_orders ADD COLUMN cost_type TEXT NOT NULL DEFAULT 'food';

-- 기존 데이터: vendors.category 기반으로 cost_type 자동 매핑
-- event 카테고리 업체 발주 → cost_type='event'
UPDATE daily_orders SET cost_type = 'event'
WHERE vendor_id IN (SELECT id FROM vendors WHERE category = 'event');

-- supply 카테고리 업체 발주 → cost_type='supply'
UPDATE daily_orders SET cost_type = 'supply'
WHERE vendor_id IN (SELECT id FROM vendors WHERE category = 'supply');

-- delivery 카테고리 중 명칭에 "인터넷" 포함 → cost_type='utility'
UPDATE daily_orders SET cost_type = 'utility'
WHERE vendor_id IN (SELECT id FROM vendors WHERE category = 'delivery' AND name LIKE '%인터넷%');

-- ────────────────────────────────────────────────────────────────
-- 2. card_expenses에 cost_type + payment_method 추가
--    payment_method: 결제수단 (법인카드는 결제수단, 비용유형 아님)
-- ────────────────────────────────────────────────────────────────
ALTER TABLE card_expenses ADD COLUMN cost_type TEXT NOT NULL DEFAULT 'food';
ALTER TABLE card_expenses ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'card';

-- 기존 card_expenses 데이터: vendor category 기반 매핑
UPDATE card_expenses SET cost_type = 'event'
WHERE vendor_id IN (SELECT id FROM vendors WHERE category = 'event');

UPDATE card_expenses SET cost_type = 'supply'
WHERE vendor_id IN (SELECT id FROM vendors WHERE category = 'supply');

-- ────────────────────────────────────────────────────────────────
-- 3. vendors에 cost_type_default 추가
--    실제 거래 업체의 기본 비용유형 (발주 입력 시 자동 적용)
--    event/supply 카테고리 업체는 레거시 호환용으로만 유지
-- ────────────────────────────────────────────────────────────────
ALTER TABLE vendors ADD COLUMN cost_type_default TEXT NOT NULL DEFAULT 'food';
ALTER TABLE vendors ADD COLUMN is_legacy_cost_type INTEGER NOT NULL DEFAULT 0;

-- 기존 event/supply 카테고리 업체를 레거시로 표시
UPDATE vendors SET cost_type_default = 'event', is_legacy_cost_type = 1
WHERE category = 'event';

UPDATE vendors SET cost_type_default = 'supply', is_legacy_cost_type = 1
WHERE category = 'supply';

UPDATE vendors SET cost_type_default = 'utility', is_legacy_cost_type = 1
WHERE category = 'delivery' AND name LIKE '%인터넷%';

-- ────────────────────────────────────────────────────────────────
-- 4. hospital_patient_categories에 이벤트 포함 여부 추가
--    budget_include_event: 해당 환자군 식단가에 이벤트 비용 포함 여부
--    card_food_include:    법인카드 식재료 비용 포함 여부 (세분화)
--    card_supply_include:  법인카드 소모품 비용 포함 여부 (신규)
--    card_event_include:   법인카드 이벤트 비용 포함 여부 (신규)
-- ────────────────────────────────────────────────────────────────
ALTER TABLE hospital_patient_categories ADD COLUMN budget_include_event INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hospital_patient_categories ADD COLUMN card_food_include INTEGER NOT NULL DEFAULT 1;
ALTER TABLE hospital_patient_categories ADD COLUMN card_supply_include INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hospital_patient_categories ADD COLUMN card_event_include INTEGER NOT NULL DEFAULT 0;

-- 기존 budget_include_card=1 데이터 마이그레이션
-- (기존에 카드 전체 포함으로 설정된 카테고리 → 카드 식재료만 포함으로 전환)
UPDATE hospital_patient_categories 
SET card_food_include = 1
WHERE budget_include_card = 1;

-- ────────────────────────────────────────────────────────────────
-- 5. category_order_settings 컬럼 역할 최종 정의
--    ref_meal_price  = 관리자 직접 입력한 목표 식단가 (KPI 유일 기준)
--    target_meal_price = deprecated (역산값, 더 이상 사용 안 함)
-- ────────────────────────────────────────────────────────────────
-- ref_meal_price가 비어있으면 target_meal_price 값으로 채움 (데이터 복원)
UPDATE category_order_settings
SET ref_meal_price = target_meal_price
WHERE (ref_meal_price IS NULL OR ref_meal_price = 0)
  AND target_meal_price > 0;

-- target_meal_price는 ref_meal_price와 동일값으로 통일 (deprecated 표시)
UPDATE category_order_settings
SET target_meal_price = ref_meal_price
WHERE ref_meal_price > 0;

-- ────────────────────────────────────────────────────────────────
-- 6. 인덱스 추가 (cost_type 기반 집계 쿼리 성능)
-- ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_daily_orders_cost_type 
  ON daily_orders(hospital_id, cost_type, order_date);

CREATE INDEX IF NOT EXISTS idx_card_expenses_cost_type 
  ON card_expenses(hospital_id, cost_type, expense_date);
