/**
 * ══════════════════════════════════════════════════════════════════
 * hospitalCalc.ts — 병원 식단가/예산 계산 공통 서비스
 * ══════════════════════════════════════════════════════════════════
 *
 * 설계 원칙:
 *   관리자 병원설정 = 해당 병원 모든 계산의 Single Source of Truth
 *   이 파일의 함수를 사용하면 대시보드/발주/보고서가 항상 동일한 숫자를 냄
 *
 * 비용 유형(cost_type) 표준:
 *   'food'    → 식재료비 (식단가 계산 핵심)
 *   'supply'  → 소모품비 (세제, 위생용품)
 *   'event'   → 이벤트/운영비 (행사, 특별식)
 *   'utility' → 공과금/인터넷 등 고정비
 *   'other'   → 기타
 *
 * 결제수단(payment_method) 표준:
 *   'invoice' → 세금계산서 (현금/계좌이체)
 *   'card'    → 법인카드
 *   'cash'    → 현금영수증
 */

// ──────────────────────────────────────────────────────────────────
// 타입 정의
// ──────────────────────────────────────────────────────────────────

/** 환자군별 마스터 설정 (관리자 병원설정의 식단가설정 탭) */
export interface CategoryMasterConfig {
  id: number
  category_key: string
  category_name: string
  /** KPI 목표 식단가 — 관리자 직접 입력값 (ref_meal_price) */
  target_meal_price: number
  /** 예산 포함 환자군 키 목록 (budget_include_keys) */
  budget_include_keys: string[]
  /** 식수 포함 항목 키 목록 (meals_include_keys) */
  meals_include_keys: string[]
  /** 소모품 발주 포함 여부 */
  budget_include_supply: boolean
  /** 이벤트/운영비 발주 포함 여부 (신규) */
  budget_include_event: boolean
  /** 법인카드 식재료 포함 여부 */
  card_food_include: boolean
  /** 법인카드 소모품 포함 여부 (신규) */
  card_supply_include: boolean
  /** 법인카드 이벤트 포함 여부 (신규) */
  card_event_include: boolean
  /** 기존 budget_include_card 하위호환 (= card_food_include) */
  budget_include_card: boolean
}

/** cost_type별 발주 합계 */
export interface OrderAmountByCostType {
  food: number      // 식재료비
  supply: number    // 소모품비
  event: number     // 이벤트/운영비
  utility: number   // 공과금/인터넷
  other: number     // 기타
  total: number     // 전체 합계
}

/** cost_type별 카드 지출 합계 */
export interface CardAmountByCostType {
  food: number
  supply: number
  event: number
  other: number
  total: number
}

/** 식수 구성 */
export interface MealCounts {
  total_staff: number
  total_guardian: number
  customTotals: Record<string, number>   // field_key → 합계
}

/** 식단가 계산 결과 */
export interface DietPriceResult {
  monthAmt: number          // 포함 기준 발주 합계
  monthAmtBreakdown: {      // 금액 구성 명세
    food: number
    supply: number
    event: number
    card_food: number
    card_supply: number
    card_event: number
  }
  monthMeals: number        // 총 식수
  dietPrice: number         // 식단가 (monthAmt ÷ monthMeals)
  targetPrice: number       // KPI 목표 식단가
  monthBudget: number       // 목표 예산 (targetPrice × monthMeals)
  diff: number              // 식단가 - 목표 (양수: 초과, 음수: 절감)
  isOver: boolean           // 목표 초과 여부
  isDanger: boolean         // 목표 110% 이상 위험
  progressPct: number       // 실제 / 목표 비율 (%)
  mealsBreakdown: MealsBreakdown
}

/** 식수 구성 세부 */
export interface MealsBreakdown {
  patientMeals: number
  staffMeals: number
  guardianMeals: number
  therapyMeals: number
  ncMeals: number
  hasStaff: boolean
  hasGuardian: boolean
}

// ──────────────────────────────────────────────────────────────────
// DB 행 → CategoryMasterConfig 변환 헬퍼
// ──────────────────────────────────────────────────────────────────

/**
 * DB에서 읽어온 hospital_patient_categories 행을 CategoryMasterConfig로 변환
 * category_order_settings(cos) JOIN 결과가 있으면 ref_meal_price 포함
 */
export function rowToCategoryConfig(catRow: any, cosRow?: any): CategoryMasterConfig {
  let budgetKeys: string[] = []
  let mealsKeys: string[] = []
  try { budgetKeys = JSON.parse(catRow.budget_include_keys || 'null') || [] } catch {}
  try { mealsKeys = JSON.parse(catRow.meals_include_keys || 'null') || [] } catch {}

  const budgetIncludeCard = catRow.budget_include_card === 1
  const cardFoodInclude = catRow.card_food_include === 1
    || (budgetIncludeCard && catRow.card_food_include !== 0)

  return {
    id: catRow.id,
    category_key: catRow.category_key,
    category_name: catRow.category_name,
    // ★ ref_meal_price 우선 (관리자 직접 입력), target_meal_price는 fallback
    target_meal_price: cosRow
      ? (cosRow.ref_meal_price || cosRow.target_meal_price || 0)
      : 0,
    budget_include_keys: budgetKeys,
    meals_include_keys: mealsKeys,
    budget_include_supply: catRow.budget_include_supply === 1,
    budget_include_event: catRow.budget_include_event === 1,
    card_food_include: cardFoodInclude,
    card_supply_include: catRow.card_supply_include === 1,
    card_event_include: catRow.card_event_include === 1,
    budget_include_card: budgetIncludeCard,
  }
}

// ──────────────────────────────────────────────────────────────────
// 식수 계산 헬퍼
// ──────────────────────────────────────────────────────────────────

/**
 * meals_include_keys 목록과 실제 식수 맵을 받아 총 식수를 계산
 * 대시보드/발주/보고서 모든 화면에서 동일하게 호출
 *
 * 키 패턴:
 *   'staff'         → legacy 직원식 (total_staff 컬럼)
 *   'guardian'      → legacy 보호자식 (total_guardian 컬럼)
 *   'st_key_{key}'  → 커스텀 직원식 필드
 *   'cat_{key}'     → 환자군 커스텀 필드
 *   'nc_key_{key}'  → 비급여식 커스텀 필드
 *   'th_key_{key}'  → 치료식 커스텀 필드
 */
export function buildMealsFromKeys(
  mealsKeys: string[],
  mealCounts: MealCounts
): number {
  if (!mealsKeys || mealsKeys.length === 0) return 0
  const { total_staff, total_guardian, customTotals } = mealCounts
  let total = 0

  if (mealsKeys.includes('staff')) total += total_staff

  if (mealsKeys.some(k => k.startsWith('st_key_'))) {
    let staffFromCustom = 0
    mealsKeys.filter(k => k.startsWith('st_key_')).forEach(k => {
      const dk = k.replace('st_key_', '')
      staffFromCustom += customTotals['diet_' + dk] || customTotals[dk] || 0
    })
    total += staffFromCustom > 0 ? staffFromCustom : total_staff
  }

  if (mealsKeys.includes('guardian')) total += total_guardian

  mealsKeys.filter(k => k.startsWith('cat_')).forEach(k => {
    total += customTotals[k] || 0
  })

  mealsKeys.filter(k => k.startsWith('nc_key_')).forEach(k => {
    const dk = k.replace('nc_key_', '')
    const legacyKey = dk.startsWith('legacy_') ? 'cat_' + dk.replace('legacy_', '') : null
    total += customTotals['diet_' + dk] || customTotals[dk] || (legacyKey ? customTotals[legacyKey] : 0) || 0
  })

  mealsKeys.filter(k => k.startsWith('th_key_')).forEach(k => {
    const dk = k.replace('th_key_', '')
    const legacyKey = dk.startsWith('legacy_') ? 'cat_' + dk.replace('legacy_', '') : null
    total += customTotals['diet_' + dk] || customTotals[dk] || (legacyKey ? customTotals[legacyKey] : 0) || 0
  })

  return total
}

/**
 * 식수 구성 세분화 (직원식/보호자식/환자식/치료식/비급여 각각 계산)
 */
export function buildMealsBreakdown(
  mealsKeys: string[],
  mealCounts: MealCounts
): MealsBreakdown {
  const { total_staff, total_guardian, customTotals } = mealCounts
  let patientMeals = 0, staffMeals = 0, guardianMeals = 0, therapyMeals = 0, ncMeals = 0
  let hasStaff = false, hasGuardian = false

  if (!mealsKeys || mealsKeys.length === 0) {
    return { patientMeals, staffMeals, guardianMeals, therapyMeals, ncMeals, hasStaff, hasGuardian }
  }

  if (mealsKeys.includes('staff')) { staffMeals += total_staff; hasStaff = true }

  if (mealsKeys.some(k => k.startsWith('st_key_'))) {
    hasStaff = true
    let fromCustom = 0
    mealsKeys.filter(k => k.startsWith('st_key_')).forEach(k => {
      const dk = k.replace('st_key_', '')
      fromCustom += customTotals['diet_' + dk] || customTotals[dk] || 0
    })
    staffMeals += fromCustom > 0 ? fromCustom : total_staff
  }

  if (mealsKeys.includes('guardian')) { guardianMeals += total_guardian; hasGuardian = true }

  mealsKeys.filter(k => k.startsWith('cat_')).forEach(k => {
    patientMeals += customTotals[k] || 0
  })

  mealsKeys.filter(k => k.startsWith('nc_key_')).forEach(k => {
    const dk = k.replace('nc_key_', '')
    const legacyKey = dk.startsWith('legacy_') ? 'cat_' + dk.replace('legacy_', '') : null
    const v = customTotals['diet_' + dk] || customTotals[dk] || (legacyKey ? customTotals[legacyKey] : 0) || 0
    guardianMeals += v; hasGuardian = true
  })

  mealsKeys.filter(k => k.startsWith('th_key_')).forEach(k => {
    const dk = k.replace('th_key_', '')
    const legacyKey = dk.startsWith('legacy_') ? 'cat_' + dk.replace('legacy_', '') : null
    therapyMeals += customTotals['diet_' + dk] || customTotals[dk] || (legacyKey ? customTotals[legacyKey] : 0) || 0
  })

  return { patientMeals, staffMeals, guardianMeals, therapyMeals, ncMeals, hasStaff, hasGuardian }
}

// ──────────────────────────────────────────────────────────────────
// 핵심 계산 함수 — 모든 화면이 이 함수를 사용
// ──────────────────────────────────────────────────────────────────

/**
 * 카테고리별 월 식단가 계산 (관리자 병원설정 마스터 기준)
 *
 * @param config      CategoryMasterConfig (관리자 설정에서 읽은 마스터)
 * @param catMonthMap 카테고리 ID → 발주합계 맵 (cost_type='food' 기준)
 * @param catKeyToId  category_key → id 맵
 * @param ordersByType cost_type별 발주 합계 (monthSupplyTotal, monthEventTotal 등)
 * @param cardByType  cost_type별 카드 지출 합계
 * @param mealCounts  식수 데이터
 */
export function calcCategoryDietPrice(params: {
  config: CategoryMasterConfig
  catMonthMap: Record<number, number>       // catId → 식재료 발주합계
  catKeyToId: Record<string, number>        // category_key → id
  ordersByType: OrderAmountByCostType       // cost_type별 월 발주합계
  cardByType: CardAmountByCostType          // cost_type별 카드 지출합계
  mealCounts: MealCounts                   // 식수 데이터
  workingDays: number
}): DietPriceResult {
  const {
    config, catMonthMap, catKeyToId,
    ordersByType, cardByType, mealCounts, workingDays
  } = params

  const hasFormula = config.budget_include_keys.length > 0 || config.meals_include_keys.length > 0

  // ── 1. 발주 금액 계산 (budget_include_keys 기반 식재료만 먼저) ──
  let foodAmt = 0
  if (hasFormula && config.budget_include_keys.length > 0) {
    foodAmt = config.budget_include_keys.reduce((sum, key) => {
      const catId = catKeyToId[key]
      return sum + (catId ? catMonthMap[catId] || 0 : 0)
    }, 0)
  } else {
    foodAmt = catMonthMap[config.id] || 0
  }

  // ── 2. 비용유형별 가산 (관리자 설정 기준) ──
  const supplyAmt  = config.budget_include_supply ? ordersByType.supply : 0
  const eventAmt   = config.budget_include_event  ? ordersByType.event  : 0
  const cardFoodAmt    = config.card_food_include    ? cardByType.food    : 0
  const cardSupplyAmt  = config.card_supply_include  ? cardByType.supply  : 0
  const cardEventAmt   = config.card_event_include   ? cardByType.event   : 0

  const monthAmt = foodAmt + supplyAmt + eventAmt + cardFoodAmt + cardSupplyAmt + cardEventAmt

  // ── 3. 식수 계산 ──
  const monthMeals = buildMealsFromKeys(config.meals_include_keys, mealCounts)
  const mealsBreakdown = buildMealsBreakdown(config.meals_include_keys, mealCounts)

  // ── 4. 식단가 계산 ──
  const dietPrice = monthMeals > 0 ? Math.round(monthAmt / monthMeals) : 0

  // ── 5. 목표 예산 계산 (목표 식단가 × 실제 식수) ──
  const targetPrice = config.target_meal_price
  const monthBudget = targetPrice > 0 && monthMeals > 0
    ? Math.round(targetPrice * monthMeals) : 0

  const diff = dietPrice - targetPrice
  const isOver = targetPrice > 0 && dietPrice > targetPrice
  const isDanger = targetPrice > 0 && dietPrice >= targetPrice * 1.1
  const progressPct = monthBudget > 0 ? Math.round(monthAmt / monthBudget * 100) : 0

  return {
    monthAmt,
    monthAmtBreakdown: {
      food: foodAmt,
      supply: supplyAmt,
      event: eventAmt,
      card_food: cardFoodAmt,
      card_supply: cardSupplyAmt,
      card_event: cardEventAmt,
    },
    monthMeals,
    dietPrice,
    targetPrice,
    monthBudget,
    diff,
    isOver,
    isDanger,
    progressPct,
    mealsBreakdown,
  }
}

// ──────────────────────────────────────────────────────────────────
// DB 집계 결과 → OrderAmountByCostType 변환 헬퍼
// ──────────────────────────────────────────────────────────────────

/**
 * DB 쿼리 결과 배열을 cost_type별 합계로 변환
 * 쿼리 예: SELECT cost_type, SUM(total_amount) as total FROM daily_orders ...
 */
export function aggregateByCostType(
  rows: Array<{ cost_type: string; total: number }>
): OrderAmountByCostType {
  const map: Record<string, number> = {}
  rows.forEach(r => { map[r.cost_type] = (map[r.cost_type] || 0) + (r.total || 0) })
  return {
    food:    map['food']    || 0,
    supply:  map['supply']  || 0,
    event:   map['event']   || 0,
    utility: map['utility'] || 0,
    other:   map['other']   || 0,
    total: Object.values(map).reduce((s, v) => s + v, 0),
  }
}

export function aggregateCardByCostType(
  rows: Array<{ cost_type: string; total: number }>
): CardAmountByCostType {
  const map: Record<string, number> = {}
  rows.forEach(r => { map[r.cost_type] = (map[r.cost_type] || 0) + (r.total || 0) })
  return {
    food:   map['food']   || 0,
    supply: map['supply'] || 0,
    event:  map['event']  || 0,
    other:  map['other']  || 0,
    total: Object.values(map).reduce((s, v) => s + v, 0),
  }
}

// ──────────────────────────────────────────────────────────────────
// 업체 카테고리 검증 — 신규 등록 차단 로직
// ──────────────────────────────────────────────────────────────────

/** 업체로 등록 불가한 비용유형 카테고리 목록 */
export const BLOCKED_VENDOR_CATEGORIES = ['event', 'supply', 'utility'] as const
export type BlockedVendorCategory = typeof BLOCKED_VENDOR_CATEGORIES[number]

/** 해당 카테고리가 업체로 등록 차단 대상인지 확인 */
export function isBlockedVendorCategory(category: string): boolean {
  return (BLOCKED_VENDOR_CATEGORIES as readonly string[]).includes(category)
}

/** 차단 카테고리의 한국어 설명 */
export const BLOCKED_CATEGORY_LABELS: Record<string, string> = {
  event:   '이벤트/운영비 → 발주 입력 시 cost_type으로 관리하세요',
  supply:  '소모품비 → 발주 입력 시 cost_type으로 관리하세요',
  utility: '공과금/인터넷 → 발주 입력 시 cost_type으로 관리하세요',
}

// ──────────────────────────────────────────────────────────────────
// 전체 식단가 통합 계산 (전 화면 공통)
// ──────────────────────────────────────────────────────────────────

/**
 * 전체 식단가 3종 계산 (기존 대시보드 mealPriceTotal / mealPriceNoStaff / mealPriceNoSupply)
 * catDietPrices가 있으면 그 기반, 없으면 기존 방식
 */
export function calcOverallDietPrices(params: {
  totalUsed: number                       // 전체 발주 합계 (daily_orders)
  ordersByType: OrderAmountByCostType     // cost_type별 분류
  cardByType: CardAmountByCostType        // 카드 cost_type별 분류
  totalMealsForPrice: number              // 식수 합계 (비급여 제외)
  staffMealsForCalc: number              // 직원식 식수
  supplyExcludeKeys: string[]            // 제외 항목 ['supply', 'card', 'event', ...]
}): {
  mealPriceTotal: number       // 전체 식단가
  mealPriceNoStaff: number     // 직원식 제외 식단가
  mealPriceNoSupply: number    // 소모품/카드 제외 식단가
  supplyCardUsed: number       // 제외 금액 합계
} {
  const { totalUsed, ordersByType, cardByType, totalMealsForPrice, staffMealsForCalc, supplyExcludeKeys } = params

  const supplyUsed   = supplyExcludeKeys.includes('supply')  ? ordersByType.supply  : 0
  const eventUsed    = supplyExcludeKeys.includes('event')   ? ordersByType.event   : 0
  const utilityUsed  = supplyExcludeKeys.includes('utility') ? ordersByType.utility : 0
  const cardExcluded = supplyExcludeKeys.includes('card')
    ? cardByType.total : 0
  const supplyCardUsed = supplyUsed + eventUsed + utilityUsed + cardExcluded

  const mealPriceTotal = totalMealsForPrice > 0
    ? Math.round(totalUsed / totalMealsForPrice) : 0

  const mealsNoStaff = totalMealsForPrice - staffMealsForCalc
  const mealPriceNoStaff = mealsNoStaff > 0
    ? Math.round(totalUsed / mealsNoStaff) : 0

  const mealPriceNoSupply = totalMealsForPrice > 0
    ? Math.round((totalUsed - supplyCardUsed) / totalMealsForPrice) : 0

  return { mealPriceTotal, mealPriceNoStaff, mealPriceNoSupply, supplyCardUsed }
}

// ──────────────────────────────────────────────────────────────────
// DB 쿼리 빌더 — 공통 SQL 패턴
// ──────────────────────────────────────────────────────────────────

/**
 * cost_type별 카테고리 발주 집계 SQL
 * 기존: supply/card/event 업체 제외 WHERE 절
 * 개선: cost_type='food' 조건으로 식재료만 집계
 */
export function buildCatOrdersSQL(useNewCostType: boolean): string {
  if (useNewCostType) {
    // 신규 구조: cost_type='food' 기준 (명시적이고 정확)
    return `
      SELECT d.patient_category_id, COALESCE(SUM(d.total_amount), 0) as total
      FROM daily_orders d
      WHERE d.hospital_id = ?
        AND d.patient_category_id IS NOT NULL
        AND d.cost_type = 'food'
        AND d.order_date BETWEEN ? AND ?
      GROUP BY d.patient_category_id`
  }
  // 구버전 호환: vendor category 기반 제외
  return `
    SELECT d.patient_category_id, COALESCE(SUM(d.total_amount), 0) as total
    FROM daily_orders d
    JOIN vendors v ON d.vendor_id = v.id
    WHERE d.hospital_id = ?
      AND d.patient_category_id IS NOT NULL
      AND v.category NOT IN ('supply', 'card', 'event')
      AND d.order_date BETWEEN ? AND ?
    GROUP BY d.patient_category_id`
}

/**
 * cost_type별 월 합계 집계 SQL
 */
export const ORDERS_BY_COST_TYPE_SQL = `
  SELECT cost_type, COALESCE(SUM(total_amount), 0) as total
  FROM daily_orders
  WHERE hospital_id = ? AND order_date BETWEEN ? AND ?
  GROUP BY cost_type`

export const CARD_BY_COST_TYPE_SQL = `
  SELECT cost_type, COALESCE(SUM(amount), 0) as total
  FROM card_expenses
  WHERE hospital_id = ? AND expense_date BETWEEN ? AND ?
  GROUP BY cost_type`

export const ORDERS_BY_COST_TYPE_TODAY_SQL = `
  SELECT cost_type, COALESCE(SUM(total_amount), 0) as total
  FROM daily_orders
  WHERE hospital_id = ? AND order_date = ?
  GROUP BY cost_type`

export const CARD_BY_COST_TYPE_TODAY_SQL = `
  SELECT cost_type, COALESCE(SUM(amount), 0) as total
  FROM card_expenses
  WHERE hospital_id = ? AND expense_date = ?
  GROUP BY cost_type`
