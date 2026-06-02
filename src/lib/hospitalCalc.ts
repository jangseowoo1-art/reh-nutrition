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

// ══════════════════════════════════════════════════════════════════
// [계산 엔진 일원화] 식수·식단가·운영비·재분류 공용 모듈
//   영양사(dashboard.ts) 계산 결과를 정답 기준으로,
//   운영진(executive.ts)·KPI(ceo-dashboard.ts)가 동일 결과를 내도록 공유.
// ══════════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────────
// STEP 1. 식수 일원화 — custom_data 합계 → meals_include_keys 필터 → 총 식수
// ──────────────────────────────────────────────────────────────────

/** meal_custom_fields 행 (필요한 필드만) */
export interface MealCustomFieldRow {
  field_key: string
  unit_type?: string | null
}

/**
 * daily_meals.custom_data 행들을 field_key별 월 합계로 집계.
 * (bf + l + d 합산)
 */
export function aggregateCustomFieldTotals(
  customFields: MealCustomFieldRow[],
  mealCustomDataRows: Array<{ custom_data?: string | null }>
): Record<string, number> {
  const totals: Record<string, number> = {}
  customFields.forEach(f => { totals[f.field_key] = 0 })
  mealCustomDataRows.forEach(row => {
    try {
      const cd = JSON.parse(row.custom_data || '{}')
      customFields.forEach(f => {
        const fv = cd[f.field_key] || {}
        totals[f.field_key] = (totals[f.field_key] || 0) + (fv.bf || 0) + (fv.l || 0) + (fv.d || 0)
      })
    } catch (e) { /* skip malformed */ }
  })
  return totals
}

/**
 * hospital_patient_categories.meals_include_keys 들을 합쳐 키 Set 구성.
 */
export function collectMealsIncludeKeys(
  patientCats: Array<{ meals_include_keys?: string | null }>
): Set<string> {
  const set = new Set<string>()
  patientCats.forEach(cat => {
    try {
      const keys: string[] = JSON.parse(cat.meals_include_keys || '[]')
      keys.forEach(k => set.add(k))
    } catch (e) { /* skip */ }
  })
  return set
}

/**
 * meals_include_keys(Set) → 실제 합산 대상 field_key Set 구성.
 * dashboard.ts L383-403 의 매칭 규칙과 동일.
 *   - cat_{fk} / fk 직접 매칭
 *   - nc_key_/th_key_/st_key_ 접두사 제거 후 diet_{key} 또는 key 매칭
 *   - dietKeyToLegacyFieldKey 로 legacy_field_key 역매핑 (옵션)
 */
export function buildMealsIncludeFieldKeySet(
  customFields: MealCustomFieldRow[],
  allMealsIncludeKeys: Set<string>,
  dietKeyToLegacyFieldKey: Record<string, string> = {}
): Set<string> {
  const result = new Set<string>()
  if (allMealsIncludeKeys.size === 0) return result
  customFields.forEach(f => {
    const fk = f.field_key
    if (allMealsIncludeKeys.has(fk)) { result.add(fk); return }
    if (allMealsIncludeKeys.has('cat_' + fk)) { result.add(fk); return }
    for (const prefix of ['nc_key_', 'th_key_', 'st_key_']) {
      const dietKey = fk.startsWith('diet_') ? fk.slice('diet_'.length) : fk
      if (allMealsIncludeKeys.has(prefix + dietKey)) { result.add(fk); return }
      for (const [dk, lfk] of Object.entries(dietKeyToLegacyFieldKey)) {
        if (lfk === fk && allMealsIncludeKeys.has(prefix + dk)) { result.add(fk); return }
      }
    }
  })
  return result
}

/** 식수 일원화 입력 */
export interface UnifiedMealsInput {
  totalStaff: number          // mealStats.total_staff
  totalGuardian: number       // mealStats.total_guardian
  customFields: MealCustomFieldRow[]
  customFieldTotals: Record<string, number>
  allMealsIncludeKeys: Set<string>
  dietKeyToLegacyFieldKey?: Record<string, string>
}

/** 식수 일원화 결과 */
export interface UnifiedMealsResult {
  totalMeals: number          // 직원 + 보호자 + 커스텀(ea 제외)
  totalMealsForPrice: number  // 식단가 계산용 (현재 totalMeals 와 동일)
  mealCustomTotal: number
  mealsIncludeFieldKeys: Set<string>
}

/**
 * 영양사(dashboard.ts) L353-511 과 동일 규칙의 총 식수 계산.
 *   totalMeals = total_staff + total_guardian + mealCustomTotal
 *   mealCustomTotal = (ea 제외) ∩ (meals_include_keys 있으면 해당 키만) 커스텀 필드 합
 */
export function calcUnifiedMeals(input: UnifiedMealsInput): UnifiedMealsResult {
  const {
    totalStaff, totalGuardian, customFields, customFieldTotals,
    allMealsIncludeKeys, dietKeyToLegacyFieldKey = {},
  } = input

  const hasIncludeKeys = allMealsIncludeKeys.size > 0
  const mealsIncludeFieldKeys = buildMealsIncludeFieldKeySet(
    customFields, allMealsIncludeKeys, dietKeyToLegacyFieldKey
  )

  const mealCustomTotal = customFields
    .filter(f => {
      if (f.unit_type === 'ea') return false
      if (hasIncludeKeys) return mealsIncludeFieldKeys.has(f.field_key)
      return true
    })
    .reduce((s, f) => s + (customFieldTotals[f.field_key] || 0), 0)

  const totalMeals = (totalStaff || 0) + (totalGuardian || 0) + mealCustomTotal
  return {
    totalMeals,
    totalMealsForPrice: totalMeals,
    mealCustomTotal,
    mealsIncludeFieldKeys,
  }
}

// ──────────────────────────────────────────────────────────────────
// STEP 5. 식단가 반영 로직 통합 — cost_type_default 끌어올림(food → 운영비)
// ──────────────────────────────────────────────────────────────────

/**
 * 운영비로 재분류할 식재료 발주 집계 SQL.
 *   cost_type='food' 로 발주됐으나 업체 비용구분(cost_type_default)이
 *   운영비성(supply/event/card/utility) 인 발주만 대상.
 *   (food → 운영비 끌어올림만, 강등 없음. daily_orders 원본 무변경)
 */
export const RECLASS_TO_OPERATING_SQL = `
  SELECT d.vendor_id AS vendorId, v.name AS vendorName, v.category AS category,
         v.cost_type_default AS vdef,
         COALESCE(SUM(d.total_amount), 0) AS used
  FROM daily_orders d
  JOIN vendors v ON d.vendor_id = v.id
  WHERE d.hospital_id = ?
    AND d.order_date BETWEEN ? AND ?
    AND d.cost_type = 'food'
    AND v.cost_type_default IN ('supply','event','card','utility')
  GROUP BY d.vendor_id, v.name, v.category, v.cost_type_default
  HAVING used > 0
  ORDER BY used DESC`

export interface ReclassVendor {
  vendorId: number
  vendorName: string
  category: string
  vdef: string
  used: number
}

export interface ReclassResult {
  reclassSupply: number
  reclassEvent: number
  reclassCard: number
  reclassUtility: number
  reclassToOperating: number     // 합계 (대표 식단가 분자에서 제외 + costBreakdown food→operating 이동)
  reclassVendors: ReclassVendor[]
}

/** RECLASS_TO_OPERATING_SQL 결과 행들을 cost_type_default별 합계로 집계 */
export function aggregateReclass(rows: any[]): ReclassResult {
  const reclassVendors: ReclassVendor[] = (rows || []).map((r: any) => ({
    vendorId: r.vendorId, vendorName: r.vendorName, category: r.category,
    vdef: r.vdef, used: r.used || 0,
  }))
  let reclassSupply = 0, reclassEvent = 0, reclassCard = 0, reclassUtility = 0
  reclassVendors.forEach(r => {
    if (r.vdef === 'supply') reclassSupply += r.used
    else if (r.vdef === 'event') reclassEvent += r.used
    else if (r.vdef === 'card') reclassCard += r.used
    else if (r.vdef === 'utility') reclassUtility += r.used
  })
  return {
    reclassSupply, reclassEvent, reclassCard, reclassUtility,
    reclassToOperating: reclassSupply + reclassEvent + reclassCard + reclassUtility,
    reclassVendors,
  }
}

// ──────────────────────────────────────────────────────────────────
// STEP 2·3. 대표/운영반영 식단가 일원화 (재분류 반영 포함)
// ──────────────────────────────────────────────────────────────────

export interface UnifiedDietPriceInput {
  totalUsed: number                    // 전체 발주 합계 (daily_orders)
  ordersByType: OrderAmountByCostType  // cost_type별 발주
  cardByType: CardAmountByCostType     // 카드 cost_type별
  totalMealsForPrice: number
  staffMealsForCalc: number
  supplyExcludeKeys: string[]
  reclassToOperating: number           // STEP 5 재분류 합계
}

export interface UnifiedDietPriceResult {
  mealPriceTotal: number       // 운영반영 식단가 = totalUsed ÷ 식수
  mealPriceNoStaff: number
  mealPriceNoSupply: number    // 대표 식단가 = (totalUsed − supplyCardUsed − reclass) ÷ 식수
  supplyCardUsed: number       // supplyExcludeKeys 기준 제외 금액 (재분류 제외)
  effSupplyCardUsed: number    // supplyCardUsed + reclassToOperating
}

/**
 * 영양사(dashboard.ts) L599-617 과 동일한 대표/운영반영 식단가 계산.
 *   - 운영반영(mealPriceTotal) = totalUsed ÷ 식수  (재분류 영향 없음)
 *   - 대표(mealPriceNoSupply)  = (totalUsed − supplyCardUsed − reclassToOperating) ÷ 식수
 */
export function calcUnifiedDietPrices(input: UnifiedDietPriceInput): UnifiedDietPriceResult {
  const {
    totalUsed, ordersByType, cardByType, totalMealsForPrice,
    staffMealsForCalc, supplyExcludeKeys, reclassToOperating,
  } = input

  const overall = calcOverallDietPrices({
    totalUsed, ordersByType, cardByType,
    totalMealsForPrice, staffMealsForCalc, supplyExcludeKeys,
  })
  const effSupplyCardUsed = overall.supplyCardUsed + reclassToOperating
  const mealPriceNoSupply = totalMealsForPrice > 0
    ? Math.round((totalUsed - effSupplyCardUsed) / totalMealsForPrice) : 0

  return {
    mealPriceTotal: overall.mealPriceTotal,
    mealPriceNoStaff: overall.mealPriceNoStaff,
    mealPriceNoSupply,
    supplyCardUsed: overall.supplyCardUsed,
    effSupplyCardUsed,
  }
}

// ──────────────────────────────────────────────────────────────────
// STEP 4. 운영비 일원화 — costBreakdown (식재료비 vs 운영비)
// ──────────────────────────────────────────────────────────────────

export interface CostBreakdownInput {
  ordersByType: OrderAmountByCostType  // cost_type별 발주
  cardByType: CardAmountByCostType     // card_expenses cost_type별
  ordersCardUsed: number               // daily_orders cost_type='card' 합계
  reclass: ReclassResult
  budgets?: {
    total?: number
    supply?: number
    event?: number
    card?: number
  }
  foodDietPrice: number                // 대표 식단가 (mealPriceNoSupply)
}

export interface CostBreakdownResult {
  food: { used: number; budget: number; ratio: number | null }
  operating: { used: number; budget: number; ratio: number | null }
  items: {
    supply: { used: number; budget: number }
    event: { used: number; budget: number }
    card: { used: number; budget: number }
    utility: { used: number }
    other: { used: number; vendors: Array<{ vendorId: number; vendorName: string; category: string; used: number }> }
  }
  foodDietPrice: number
  foodVendorIds: number[]
}

/**
 * 영양사(dashboard.ts) L1403-1457 과 동일한 costBreakdown 구성.
 *   운영비 = (cost_type 운영비) + (카드 cost_type) + 재분류분
 *   식재료비 = cost_type='food' − 재분류
 */
export function buildCostBreakdown(input: CostBreakdownInput): CostBreakdownResult {
  const { ordersByType, cardByType, ordersCardUsed, reclass, budgets = {}, foodDietPrice } = input

  const cbSupplyUsed  = (ordersByType.supply  || 0) + (cardByType.supply || 0) + reclass.reclassSupply
  const cbEventUsed   = (ordersByType.event   || 0) + (cardByType.event  || 0) + reclass.reclassEvent
  const cbUtilityUsed = (ordersByType.utility || 0) + reclass.reclassUtility
  const cbCardUsed    = ordersCardUsed + (cardByType.total || 0) + reclass.reclassCard
  const cbOperatingUsed = cbSupplyUsed + cbEventUsed + cbUtilityUsed + cbCardUsed
  const cbFoodUsed = Math.max(0, (ordersByType.food || 0) - reclass.reclassToOperating)

  const cbSupplyBudget = budgets.supply || 0
  const cbEventBudget  = budgets.event  || 0
  const cbCardBudget   = budgets.card   || 0
  const cbOperatingBudget = cbSupplyBudget + cbEventBudget + cbCardBudget
  const cbFoodBudget = Math.max(0, (budgets.total || 0) - cbOperatingBudget)

  const _ratio = (used: number, budget: number) =>
    budget > 0 ? parseFloat(((used / budget) * 100).toFixed(1)) : null

  const cbOtherVendors = reclass.reclassVendors.map(r => ({
    vendorId: r.vendorId, vendorName: r.vendorName, category: r.category, used: r.used || 0,
  }))

  return {
    food:      { used: cbFoodUsed, budget: cbFoodBudget, ratio: _ratio(cbFoodUsed, cbFoodBudget) },
    operating: { used: cbOperatingUsed, budget: cbOperatingBudget, ratio: _ratio(cbOperatingUsed, cbOperatingBudget) },
    items: {
      supply:  { used: cbSupplyUsed,  budget: cbSupplyBudget },
      event:   { used: cbEventUsed,   budget: cbEventBudget  },
      card:    { used: cbCardUsed,    budget: cbCardBudget   },
      utility: { used: cbUtilityUsed },
      other:   { used: reclass.reclassToOperating, vendors: cbOtherVendors },
    },
    foodDietPrice: foodDietPrice || 0,
    foodVendorIds: [],
  }
}
