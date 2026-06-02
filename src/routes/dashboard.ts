import { Hono } from 'hono'
import {
  rowToCategoryConfig,
  buildMealsFromKeys as calcMealsFromKeys,
  buildMealsBreakdown as calcMealsBreakdown,
  calcCategoryDietPrice,
  aggregateByCostType,
  aggregateCardByCostType,
  calcOverallDietPrices,
  ORDERS_BY_COST_TYPE_SQL,
  CARD_BY_COST_TYPE_SQL,
  ORDERS_BY_COST_TYPE_TODAY_SQL,
  CARD_BY_COST_TYPE_TODAY_SQL,
} from '../lib/hospitalCalc'

const dashboard = new Hono<{ Bindings: { DB: D1Database } }>()

// 월별 대시보드 요약
dashboard.get('/summary/:year/:month', async (c) => {
  try {
  const user = c.get('user')
  const rawId = user.role === 'admin' ? c.req.query('hospitalId') : user.hospitalId
  const hospitalId = rawId ? Number(rawId) : null
  if (!hospitalId) return c.json({ error: 'hospitalId required' }, 400)
  const { year, month } = c.req.param()

  // 월 설정 조회: 기준월(2026.3) 이전 → 3월 값, 이후 → 직전 설정 상속
  const DB_BASE_YEAR = 2026, DB_BASE_MONTH = 3
  const dashReqYear = parseInt(year), dashReqMonth = parseInt(month)

  let settings = await c.env.DB.prepare(
    `SELECT * FROM monthly_settings WHERE hospital_id = ? AND year = ? AND month = ?`
  ).bind(hospitalId, year, month).first<any>()
  if (!settings) {
    const isBeforeBaseDash = (dashReqYear < DB_BASE_YEAR) || (dashReqYear === DB_BASE_YEAR && dashReqMonth < DB_BASE_MONTH)
    if (isBeforeBaseDash) {
      // 3월 기준값 사용
      settings = await c.env.DB.prepare(
        `SELECT * FROM monthly_settings WHERE hospital_id = ? AND year = ? AND month = ?`
      ).bind(hospitalId, DB_BASE_YEAR, DB_BASE_MONTH).first<any>()
      if (!settings) {
        settings = await c.env.DB.prepare(
          `SELECT * FROM monthly_settings WHERE hospital_id = ?
           ORDER BY CAST(year AS INTEGER) ASC, CAST(month AS INTEGER) ASC LIMIT 1`
        ).bind(hospitalId).first<any>()
      }
    } else {
      settings = await c.env.DB.prepare(
        `SELECT * FROM monthly_settings
         WHERE hospital_id = ?
           AND (CAST(year AS INTEGER) < CAST(? AS INTEGER)
                OR (CAST(year AS INTEGER) = CAST(? AS INTEGER) AND CAST(month AS INTEGER) < CAST(? AS INTEGER)))
         ORDER BY CAST(year AS INTEGER) DESC, CAST(month AS INTEGER) DESC LIMIT 1`
      ).bind(hospitalId, dashReqYear, dashReqYear, dashReqMonth).first<any>()
    }
  }

  // ── 1단계: settings 이후 독립 쿼리 병렬 실행 ─────────────────────
  const today = new Date().toISOString().split('T')[0]
  const prevMonth = parseInt(month) === 1 ? 12 : parseInt(month) - 1
  const prevYear2 = parseInt(month) === 1 ? String(parseInt(year) - 1) : year

  // BETWEEN 방식으로 인덱스 활용 (strftime보다 훨씬 빠름)
  const monthPadded = String(parseInt(month)).padStart(2, '0')
  const dateStart = `${year}-${monthPadded}-01`
  const lastDay = new Date(parseInt(year as string), parseInt(month as string), 0).getDate()
  const dateEnd = `${year}-${monthPadded}-${String(lastDay).padStart(2, '0')}`
  const prevMonthPadded = String(prevMonth).padStart(2, '0')
  const prevDateStart = `${prevYear2}-${prevMonthPadded}-01`
  const prevLastDay = new Date(parseInt(prevYear2), prevMonth, 0).getDate()
  const prevDateEnd = `${prevYear2}-${prevMonthPadded}-${String(prevLastDay).padStart(2, '0')}`

  const [
    vendors,
    dailyOrders,
    mealStats,
    customFieldsList,
    mealCustomData,
    patientCatsForMeals,
    todayOrders,
    weekOrdersRaw,
    totalUsedRow,
    cardExpensesTotal,
    prevMealStats,
    prevOrders,
    prevSupply,
    prevCardExpenses,
    prevSettings,
    prevMealCustomData,
    patientCatsDash,
    catMonthlyOrders,
    nullCatMonthlyOrder,
    catTodayOrders,
    nullCatTodayOrder,
    todayMealRow,
    orderDayCountRow,
    prev3MonthsData,
    supplyExcludeConfig,
    todaySupplyRow,
    todayCardRow,
    // ★ cost_type별 집계 (공통 계산 서비스용)
    ordersByCostTypeRaw,
    cardByCostTypeRaw,
    ordersByCostTypeTodayRaw,
    cardByCostTypeTodayRaw
  ] = await Promise.all([
    // 업체별 발주 합계 (BETWEEN으로 인덱스 활용)
    c.env.DB.prepare(
      `SELECT v.id, v.name, v.category, v.tax_type, v.monthly_budget,
              COALESCE(SUM(d.taxable_amount), 0) as total_taxable,
              COALESCE(SUM(d.exempt_amount), 0) as total_exempt,
              COALESCE(SUM(d.vat_amount), 0) as total_vat,
              COALESCE(SUM(d.total_amount), 0) as total_used
       FROM vendors v
       LEFT JOIN daily_orders d ON v.id = d.vendor_id 
         AND d.order_date BETWEEN ? AND ?
       WHERE v.hospital_id = ? AND v.is_active = 1
       GROUP BY v.id
       ORDER BY v.sort_order`
    ).bind(dateStart, dateEnd, hospitalId).all<any>(),

    // 일별 총 발주액
    c.env.DB.prepare(
      `SELECT order_date, SUM(total_amount) as daily_total
       FROM daily_orders
       WHERE hospital_id = ? AND order_date BETWEEN ? AND ?
       GROUP BY order_date
       ORDER BY order_date`
    ).bind(hospitalId, dateStart, dateEnd).all<any>(),

    // 식수 합계
    c.env.DB.prepare(
      `SELECT 
         COALESCE(SUM(breakfast_patient + lunch_patient + dinner_patient), 0) as total_patient,
         COALESCE(SUM(breakfast_staff + lunch_staff + dinner_staff), 0) as total_staff,
         COALESCE(SUM(breakfast_noncovered + lunch_noncovered + dinner_noncovered), 0) as total_noncovered,
         COALESCE(SUM(breakfast_guardian + lunch_guardian + dinner_guardian), 0) as total_guardian,
         COUNT(*) as days_entered
       FROM daily_meals
       WHERE hospital_id = ? AND meal_date BETWEEN ? AND ?`
    ).bind(hospitalId, dateStart, dateEnd).first<any>(),

    // 커스텀 식수 필드 목록
    c.env.DB.prepare(
      `SELECT * FROM meal_custom_fields WHERE hospital_id = ? AND is_active = 1 ORDER BY sort_order, id`
    ).bind(hospitalId).all<any>(),

    // 월별 custom_data
    c.env.DB.prepare(
      `SELECT custom_data FROM daily_meals
       WHERE hospital_id = ? AND meal_date BETWEEN ? AND ?
         AND custom_data IS NOT NULL AND custom_data != '{}'`
    ).bind(hospitalId, dateStart, dateEnd).all<any>(),

    // meals_include_keys
    c.env.DB.prepare(
      `SELECT meals_include_keys FROM hospital_patient_categories WHERE hospital_id = ? AND is_active = 1`
    ).bind(hospitalId).all<any>(),

    // 오늘 발주액
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(total_amount), 0) as today_total
       FROM daily_orders WHERE hospital_id = ? AND order_date = ?`
    ).bind(hospitalId, today).first<any>(),

    // 이번 주 발주액 (해당 월 내 날짜만 포함 - 주가 두 달에 걸친 경우 조회 월 데이터만 집계)
    (() => {
      const nowDate = new Date()
      const dayOfWeek = nowDate.getDay()
      const weekStart = new Date(nowDate); weekStart.setDate(nowDate.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6)
      // 이번 주와 해당 월의 교집합 날짜 범위
      const effStart = weekStart.toISOString().split('T')[0] > dateStart ? weekStart.toISOString().split('T')[0] : dateStart
      const effEnd   = weekEnd.toISOString().split('T')[0] < dateEnd     ? weekEnd.toISOString().split('T')[0]   : dateEnd
      return c.env.DB.prepare(
        `SELECT COALESCE(SUM(total_amount), 0) as week_total
         FROM daily_orders WHERE hospital_id = ? AND order_date >= ? AND order_date <= ?`
      ).bind(hospitalId, effStart, effEnd).first<any>()
    })(),

    // totalUsed
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(total_amount),0) as total
       FROM daily_orders
       WHERE hospital_id = ? AND order_date BETWEEN ? AND ?`
    ).bind(hospitalId, dateStart, dateEnd).first<any>(),

    // 법인카드 월 합계
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM card_expenses
       WHERE hospital_id = ? AND expense_date BETWEEN ? AND ?`
    ).bind(hospitalId, dateStart, dateEnd).first<any>(),

    // 전월 식수
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(breakfast_patient+lunch_patient+dinner_patient),0) as total_patient,
              COALESCE(SUM(breakfast_staff+lunch_staff+dinner_staff),0) as total_staff,
              COALESCE(SUM(breakfast_noncovered+lunch_noncovered+dinner_noncovered),0) as total_noncovered,
              COALESCE(SUM(breakfast_guardian+lunch_guardian+dinner_guardian),0) as total_guardian
       FROM daily_meals WHERE hospital_id=? AND meal_date BETWEEN ? AND ?`
    ).bind(hospitalId, prevDateStart, prevDateEnd).first<any>(),

    // 전월 발주액
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(total_amount),0) as total_used FROM daily_orders
       WHERE hospital_id=? AND order_date BETWEEN ? AND ?`
    ).bind(hospitalId, prevDateStart, prevDateEnd).first<any>(),

    // 전월 소모품
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(d.total_amount),0) as supply_used
       FROM daily_orders d JOIN vendors v ON d.vendor_id=v.id
       WHERE d.hospital_id=? AND d.order_date BETWEEN ? AND ? AND v.category='supply'`
    ).bind(hospitalId, prevDateStart, prevDateEnd).first<any>(),

    // 전월 법인카드
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(amount),0) as total
       FROM card_expenses
       WHERE hospital_id=? AND expense_date BETWEEN ? AND ?`
    ).bind(hospitalId, prevDateStart, prevDateEnd).first<any>(),

    // 전월 설정
    c.env.DB.prepare(
      `SELECT total_budget, meal_price FROM monthly_settings WHERE hospital_id=? AND year=? AND month=?`
    ).bind(hospitalId, prevYear2, String(prevMonth)).first<any>(),

    // 전월 커스텀 식수
    c.env.DB.prepare(
      `SELECT custom_data FROM daily_meals
       WHERE hospital_id = ? AND meal_date BETWEEN ? AND ?
         AND custom_data IS NOT NULL AND custom_data != '{}'`
    ).bind(hospitalId, prevDateStart, prevDateEnd).all<any>(),

    // 카테고리 목록
    c.env.DB.prepare(`
      SELECT * FROM hospital_patient_categories
      WHERE hospital_id = ? AND is_active = 1
      ORDER BY sort_order, id
    `).bind(hospitalId).all<any>(),

    // 카테고리별 월 발주 (소모품/카드/이벤트 업체 제외: 식단가 오염 방지)
    c.env.DB.prepare(`
      SELECT d.patient_category_id, COALESCE(SUM(d.total_amount), 0) as total
      FROM daily_orders d
      JOIN vendors v ON d.vendor_id = v.id
      WHERE d.hospital_id = ?
        AND d.patient_category_id IS NOT NULL
        AND v.category NOT IN ('supply', 'card', 'event')
        AND d.order_date BETWEEN ? AND ?
      GROUP BY d.patient_category_id
    `).bind(hospitalId, dateStart, dateEnd).all<any>(),

    // NULL 카테고리 월 발주 (소모품/카드/이벤트 업체 제외)
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(d.total_amount), 0) as total
      FROM daily_orders d
      JOIN vendors v ON d.vendor_id = v.id
      WHERE d.hospital_id = ?
        AND d.patient_category_id IS NULL
        AND v.category NOT IN ('supply', 'card', 'event')
        AND d.order_date BETWEEN ? AND ?
    `).bind(hospitalId, dateStart, dateEnd).first<any>(),

    // 카테고리별 오늘 발주 (소모품/카드/이벤트 업체 제외)
    c.env.DB.prepare(`
      SELECT d.patient_category_id, COALESCE(SUM(d.total_amount), 0) as total
      FROM daily_orders d
      JOIN vendors v ON d.vendor_id = v.id
      WHERE d.hospital_id = ?
        AND d.patient_category_id IS NOT NULL
        AND v.category NOT IN ('supply', 'card', 'event')
        AND d.order_date = ?
      GROUP BY d.patient_category_id
    `).bind(hospitalId, today).all<any>(),

    // NULL 카테고리 오늘 발주 (소모품/카드/이벤트 업체 제외)
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(d.total_amount), 0) as total
      FROM daily_orders d
      JOIN vendors v ON d.vendor_id = v.id
      WHERE d.hospital_id = ?
        AND d.patient_category_id IS NULL
        AND v.category NOT IN ('supply', 'card', 'event')
        AND d.order_date = ?
    `).bind(hospitalId, today).first<any>(),

    // 오늘 식수
    c.env.DB.prepare(`
      SELECT COALESCE(breakfast_staff,0)+COALESCE(lunch_staff,0)+COALESCE(dinner_staff,0) as staff_total,
             COALESCE(breakfast_guardian,0)+COALESCE(lunch_guardian,0)+COALESCE(dinner_guardian,0) as guardian_total,
             custom_data
      FROM daily_meals WHERE hospital_id = ? AND meal_date = ?
    `).bind(hospitalId, today).first<any>(),

    // 발주 경과일
    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT order_date) as cnt FROM daily_orders
       WHERE hospital_id = ? AND order_date BETWEEN ? AND ?`
    ).bind(hospitalId, dateStart, dateEnd).first<any>(),

    // 최근 3개월 평균
    c.env.DB.prepare(
      `SELECT strftime('%Y', order_date) as y, strftime('%m', order_date) as m,
              SUM(total_amount) as total
       FROM daily_orders
       WHERE hospital_id = ?
         AND order_date < date(? || '-' || printf('%02d', ?) || '-01')
       GROUP BY y, m
       ORDER BY y DESC, m DESC
       LIMIT 3`
    ).bind(hospitalId, year, month).all<any>(),

    // 소모품/카드 제외 계산 기준 설정
    c.env.DB.prepare(
      `SELECT supply_exclude_keys FROM hospital_info WHERE hospital_id = ?`
    ).bind(hospitalId).first<any>(),

    // 오늘 소모품 발주 합계 (레거시 호환)
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(d.total_amount),0) as total
       FROM daily_orders d JOIN vendors v ON d.vendor_id=v.id
       WHERE d.hospital_id=? AND d.order_date=? AND v.category='supply'`
    ).bind(hospitalId, today).first<any>(),

    // 오늘 카드 발주 합계 (레거시 호환)
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(amount),0) as total FROM card_expenses
       WHERE hospital_id=? AND expense_date=?`
    ).bind(hospitalId, today).first<any>(),

    // ★ cost_type별 월 발주 집계 (공통 계산 서비스 신규)
    c.env.DB.prepare(ORDERS_BY_COST_TYPE_SQL).bind(hospitalId, dateStart, dateEnd).all<any>(),
    c.env.DB.prepare(CARD_BY_COST_TYPE_SQL).bind(hospitalId, dateStart, dateEnd).all<any>(),
    c.env.DB.prepare(ORDERS_BY_COST_TYPE_TODAY_SQL).bind(hospitalId, today).all<any>(),
    c.env.DB.prepare(CARD_BY_COST_TYPE_TODAY_SQL).bind(hospitalId, today).all<any>()
  ])

  // 커스텀 필드별 월 합계 계산
  const customFieldTotals: Record<string, number> = {}
  ;(customFieldsList.results || []).forEach((f: any) => { customFieldTotals[f.field_key] = 0 })
  ;(mealCustomData.results || []).forEach((row: any) => {
    try {
      const cd = JSON.parse(row.custom_data || '{}')
      ;(customFieldsList.results || []).forEach((f: any) => {
        const fv = cd[f.field_key] || {}
        customFieldTotals[f.field_key] = (customFieldTotals[f.field_key] || 0) + (fv.bf || 0) + (fv.l || 0) + (fv.d || 0)
      })
    } catch(e) {}
  })

  // 관리자 meals_include_keys 기반으로 포함할 field_key Set 구성
  // hospital_patient_categories.meals_include_keys: ["cat_cancer","nc_key_preset_nc_guardian_2","st_key_...","th_key_..."]
  const allMealsIncludeKeys = new Set<string>()
  ;(patientCatsForMeals.results || []).forEach((cat: any) => {
    try {
      const keys: string[] = JSON.parse(cat.meals_include_keys || '[]')
      keys.forEach(k => allMealsIncludeKeys.add(k))
    } catch(e) {}
  })

  // diet_categories에서 diet_key → legacy_field_key 매핑 로드
  // nc_key_legacy_xxx / th_key_legacy_xxx 같은 legacy 키를 field_key로 변환하기 위해 필요
  const dietKeyToLegacyFieldKey: Record<string, string> = {}
  if (allMealsIncludeKeys.size > 0) {
    const dietCatsList = await c.env.DB.prepare(
      `SELECT diet_key, legacy_field_key FROM diet_categories WHERE hospital_id = ? AND legacy_field_key IS NOT NULL AND legacy_field_key != 'null'`
    ).bind(hospitalId).all<any>()
    ;(dietCatsList.results || []).forEach((dc: any) => {
      if (dc.diet_key && dc.legacy_field_key) {
        dietKeyToLegacyFieldKey[dc.diet_key] = dc.legacy_field_key
      }
    })
  }

  // meals_include_keys를 field_key로 변환하는 헬퍼
  // meals_include_keys의 키 패턴:
  //   cat_{legacy_field_key or diet_key}  → 환자식 (meal_custom_fields.field_key 직접 매칭)
  //   nc_key_{diet_key}  → 비급여식 (field_key = 'diet_' + diet_key 또는 diet_key 또는 legacy_field_key)
  //   th_key_{diet_key}  → 치료식 (field_key = 'diet_' + diet_key 또는 diet_key 또는 legacy_field_key)
  //   st_key_{diet_key}  → 직원식 (field_key = 'diet_' + diet_key 또는 diet_key 또는 legacy_field_key)
  const mealsIncludeFieldKeys = new Set<string>()
  if (allMealsIncludeKeys.size > 0) {
    ;(customFieldsList.results || []).forEach((f: any) => {
      const fk: string = f.field_key
      // cat_ 으로 시작하는 키: cat_{field_key} 직접 매칭
      if (allMealsIncludeKeys.has(fk)) { mealsIncludeFieldKeys.add(fk); return }
      if (allMealsIncludeKeys.has('cat_' + fk)) { mealsIncludeFieldKeys.add(fk); return }
      // nc_key_/th_key_/st_key_ 접두사 제거 후 'diet_' 접두사 붙이거나 그대로 매칭
      // + diet_categories.legacy_field_key를 통한 legacy 키 매핑 지원
      for (const prefix of ['nc_key_', 'th_key_', 'st_key_']) {
        const dietKey = fk.startsWith('diet_') ? fk.slice('diet_'.length) : fk
        if (allMealsIncludeKeys.has(prefix + dietKey)) { mealsIncludeFieldKeys.add(fk); return }
        // legacy_field_key 역방향 매핑: fk가 legacy_field_key일 경우 diet_key를 찾아 접두사 붙여 확인
        for (const [dk, lfk] of Object.entries(dietKeyToLegacyFieldKey)) {
          if (lfk === fk && allMealsIncludeKeys.has(prefix + dk)) {
            mealsIncludeFieldKeys.add(fk); return
          }
        }
      }
    })
  }

  // meals_include_keys 설정이 없는 병원은 기존 방식 (ea 제외만) 사용
  const hasIncludeKeys = allMealsIncludeKeys.size > 0
  // ea 단위 필드는 식수 합산에서 제외 (unit_type='ea')
  // meals_include_keys가 있는 병원: 해당 키에 포함된 필드만 합산
  const mealCustomTotal = (customFieldsList.results || [])
    .filter((f: any) => {
      if (f.unit_type === 'ea') return false
      if (hasIncludeKeys) return mealsIncludeFieldKeys.has(f.field_key)
      return true
    })
    .reduce((s: number, f: any) => s + (customFieldTotals[f.field_key] || 0), 0)

  // ★ cost_type별 집계 변환 (공통 계산 서비스)
  const ordersByCostType = aggregateByCostType(ordersByCostTypeRaw?.results || [])
  const cardByCostType = aggregateCardByCostType(cardByCostTypeRaw?.results || [])
  const ordersByCostTypeToday = aggregateByCostType(ordersByCostTypeTodayRaw?.results || [])
  const cardByCostTypeToday = aggregateCardByCostType(cardByCostTypeTodayRaw?.results || [])

  // totalUsed: daily_orders 직접 집계 (vendor_id가 다른 병원 업체를 참조해도 포함)
  // vendors 집계와 별도로 계산해야 정확한 발주 합계 산출 가능
  const totalUsed = totalUsedRow?.total || 0
  const totalBudget = settings?.total_budget || 0
  const eventBudget = settings?.event_budget || 0
  // working_days 미설정 시 해당 월의 실제 일수로 fallback (30일 고정값 대신)
  const workingDays = settings?.working_days || new Date(parseInt(year as string), parseInt(month as string), 0).getDate()
  const progress = totalBudget > 0 ? ((totalUsed / totalBudget) * 100).toFixed(2) : '0.00'
  
  // 주간 날짜 계산 (weekStartStr/weekEndStr을 먼저 선언해야 아래 for문에서 사용 가능)
  const nowDate = new Date()
  const nowYear = nowDate.getFullYear()
  const nowMonth = nowDate.getMonth() + 1
  // 요청한 월이 현재 월인지 확인 → 다른 달을 조회하면 주간 데이터는 의미없음
  const isCurrentMonth = (dashReqYear === nowYear && dashReqMonth === nowMonth)
  // 월요일 기준 주 범위 계산 (일요일=0 → 6일 전, 월요일=1 → 0일 전, ...)
  const dayOfWeek2 = nowDate.getDay()
  const weekStart2 = new Date(nowDate); weekStart2.setDate(nowDate.getDate() - (dayOfWeek2 === 0 ? 6 : dayOfWeek2 - 1))
  const weekEnd2 = new Date(weekStart2); weekEnd2.setDate(weekStart2.getDate() + 6)
  const weekStartStr = weekStart2.toISOString().split('T')[0]
  const weekEndStr = weekEnd2.toISOString().split('T')[0]
  const weekOrders = isCurrentMonth ? weekOrdersRaw : null

  // 일/주/월 목표
  const dailyBudget = workingDays > 0 ? Math.round(totalBudget / workingDays) : 0
  // 주간 예산: 현재 월이면 실제 이번 주 날짜 기반, 과거/미래 달이면 5일(평균 주) 기준으로 계산
  const monthStr = `${year}-${String(parseInt(month)).padStart(2,'0')}`
  let weekDaysInMonth = 0
  if (isCurrentMonth) {
    for (let d = new Date(weekStartStr); d <= new Date(weekEndStr); d.setDate(d.getDate()+1)) {
      const ds = d.toISOString().split('T')[0]
      if (ds.startsWith(monthStr)) weekDaysInMonth++
    }
    if (weekDaysInMonth === 0) weekDaysInMonth = 7  // fallback
  } else {
    // 과거/미래 달: 평균 주 5일 기준
    weekDaysInMonth = 5
  }
  const weeklyBudget = dailyBudget * weekDaysInMonth

  // 과거 달 조회 시: 일평균/주평균 실적 계산 (totalUsed / workingDays 기반)
  // → 실제 주/일 발주는 의미없으므로 월 실적으로 역산한 평균값 사용
  const avgDailyUsed = !isCurrentMonth && workingDays > 0 ? Math.round(totalUsed / workingDays) : (todayOrders?.today_total || 0)
  const avgWeeklyUsed = !isCurrentMonth && workingDays > 0 ? Math.round(totalUsed / workingDays * weekDaysInMonth) : (weekOrders?.week_total || 0)

  // 예산 초과 업체
  const overBudgetVendors = (vendors.results || []).filter((v: any) => 
    v.monthly_budget > 0 && v.total_used > v.monthly_budget
  )

  const cardExpensesUsed = cardExpensesTotal?.total || 0

  // 식단가 3종 계산
  const ms = mealStats || { total_patient:0, total_staff:0, total_noncovered:0, total_guardian:0 }

  // 직원식 커스텀 필드 식수 별도 계산 (직원식 제외 식단가 분모 계산용)
  // st_key_ 매핑에 해당하는 field_key를 찾아 직원식 커스텀 식수 합산
  const staffFieldKeySet = new Set<string>()
  if (allMealsIncludeKeys.size > 0) {
    allMealsIncludeKeys.forEach((k: string) => {
      if (k.startsWith('st_key_')) {
        const dietKey = k.replace('st_key_', '')
        ;(customFieldsList.results || []).forEach((f: any) => {
          if (f.field_key === 'diet_' + dietKey || f.field_key === dietKey) {
            staffFieldKeySet.add(f.field_key)
          }
        })
      }
    })
  }
  // 직원식 커스텀 필드 식수 합계
  const mealCustomStaffTotal = (customFieldsList.results || [])
    .filter((f: any) => f.unit_type !== 'ea' && staffFieldKeySet.has(f.field_key))
    .reduce((s: number, f: any) => s + (customFieldTotals[f.field_key] || 0), 0)
  // 레거시 방식(total_staff 컬럼)을 사용하는지 확인
  const hasStCustomKeys = [...allMealsIncludeKeys].some((k: string) => k.startsWith('st_key_'))
  const staffMealsForCalc = hasStCustomKeys
    ? (mealCustomStaffTotal > 0 ? mealCustomStaffTotal : (ms.total_staff||0))
    : (ms.total_staff||0)
  // 화면 표시용 전체 식수: 비급여 제외, 환자(patient) 제외(환자군 커스텀 필드로 대체) - 직원+보호자+커스텀
  const totalMeals = (ms.total_staff||0) + (ms.total_guardian||0) + mealCustomTotal
  // 식단가 계산용 식수: 비급여 제외, 환자 제외 → 직원+보호자+환자군(커스텀, ea 제외)
  const totalMealsForPrice = (ms.total_staff||0) + (ms.total_guardian||0) + mealCustomTotal
  // 소모품 제외 금액 (daily_orders 기준 소모품 업체 + card_expenses 법인카드)
  // supply_exclude_keys 설정에 따라 병원별로 제외 항목 다르게 적용
  let supplyExcludeKeys: string[] = []
  if (supplyExcludeConfig?.supply_exclude_keys) {
    try { supplyExcludeKeys = JSON.parse(supplyExcludeConfig.supply_exclude_keys) } catch(e) {}
  } else {
    // 설정 없으면 기존 기본값: card + supply 모두 제외
    supplyExcludeKeys = ['card', 'supply']
  }

  // 업체 발주 소모품 제외 금액 (category='supply')
  const supplyUsed = supplyExcludeKeys.includes('supply')
    ? (vendors.results || [])
        .filter((v: any) => v.category === 'supply')
        .reduce((s: number, v: any) => s + v.total_used, 0)
    : 0
  // 법인카드 제외 금액
  const cardExcluded = supplyExcludeKeys.includes('card') ? cardExpensesUsed : 0
  // 이벤트 제외 금액
  const eventExcluded = supplyExcludeKeys.includes('event')
    ? (vendors.results || [])
        .filter((v: any) => v.category === 'event')
        .reduce((s: number, v: any) => s + v.total_used, 0)
    : 0
  // 기타 비식재료 제외 금액 (category='general' 외 기타)
  const otherExcluded = supplyExcludeKeys.includes('other')
    ? (vendors.results || [])
        .filter((v: any) => v.category === 'general' || v.category === 'other')
        .reduce((s: number, v: any) => s + v.total_used, 0)
    : 0

  const supplyCardUsed = supplyUsed + cardExcluded + eventExcluded + otherExcluded

  // ★ cost_type 기반 월별·오늘 합계 (공통 계산 서비스 연동)
  // 기존 vendor.category 기반 집계와 병행 유지 (하위호환)
  const monthSupplyTotal = ordersByCostType.supply
  const monthEventTotal  = ordersByCostType.event
  const monthCardTotal   = cardByCostType.total
  const todaySupplyTotal = ordersByCostTypeToday.supply
  const todayEventTotal  = ordersByCostTypeToday.event
  const todayCardTotal   = cardByCostTypeToday.total

  // ★ 공통 계산 서비스로 전체 식단가 3종 계산
  const overallPrices = calcOverallDietPrices({
    totalUsed,
    ordersByType: ordersByCostType,
    cardByType: cardByCostType,
    totalMealsForPrice,
    staffMealsForCalc,
    supplyExcludeKeys
  })
  // ① 전체 식단가
  const mealPriceTotal = overallPrices.mealPriceTotal
  // ② 직원식 제외 식단가
  const mealPriceNoStaff = overallPrices.mealPriceNoStaff
  // ③ 소모품/카드 제외 식단가
  const mealPriceNoSupply = overallPrices.mealPriceNoSupply

  // 전월 식단가 비교용 데이터 (Promise.all에서 이미 조회됨)
  const prevCustomFieldTotals: Record<string, number> = {}
  ;(customFieldsList.results || []).forEach((f: any) => { prevCustomFieldTotals[f.field_key] = 0 })
  ;(prevMealCustomData.results || []).forEach((row: any) => {
    try {
      const cd = JSON.parse(row.custom_data || '{}')
      ;(customFieldsList.results || []).forEach((f: any) => {
        const fv = cd[f.field_key] || {}
        prevCustomFieldTotals[f.field_key] = (prevCustomFieldTotals[f.field_key] || 0) + (fv.bf || 0) + (fv.l || 0) + (fv.d || 0)
      })
    } catch(e) {}
  })
  // 전월도 meals_include_keys 기준 적용
  const prevMealCustomTotal = (customFieldsList.results || [])
    .filter((f: any) => {
      if (f.unit_type === 'ea') return false
      if (hasIncludeKeys) return mealsIncludeFieldKeys.has(f.field_key)
      return true
    })
    .reduce((s: number, f: any) => s + (prevCustomFieldTotals[f.field_key] || 0), 0)

  // ── 카테고리별 식단가 계산 (Promise.all에서 이미 조회됨) ──────────────────────────────────

  // 카테고리 설정 조회: 기준월(2026.3) 이전 → 3월 값, 이후 → 직전 설정 상속
  let catSettingsDash = await c.env.DB.prepare(`
    SELECT cos.*, hpc.category_key, hpc.category_name
    FROM category_order_settings cos
    JOIN hospital_patient_categories hpc ON cos.patient_category_id = hpc.id
    WHERE cos.hospital_id = ? AND cos.year = ? AND cos.month = ?
  `).bind(hospitalId, year, month).all<any>()
  if (!catSettingsDash.results || catSettingsDash.results.length === 0) {
    const isBeforeBaseCat = (dashReqYear < DB_BASE_YEAR) || (dashReqYear === DB_BASE_YEAR && dashReqMonth < DB_BASE_MONTH)
    if (isBeforeBaseCat) {
      catSettingsDash = await c.env.DB.prepare(`
        SELECT cos.*, hpc.category_key, hpc.category_name
        FROM category_order_settings cos
        JOIN hospital_patient_categories hpc ON cos.patient_category_id = hpc.id
        WHERE cos.hospital_id = ? AND cos.year = ? AND cos.month = ?
        ORDER BY hpc.sort_order
      `).bind(hospitalId, DB_BASE_YEAR, DB_BASE_MONTH).all<any>()
      if (!catSettingsDash.results || catSettingsDash.results.length === 0) {
        catSettingsDash = await c.env.DB.prepare(`
          SELECT cos.*, hpc.category_key, hpc.category_name
          FROM category_order_settings cos
          JOIN hospital_patient_categories hpc ON cos.patient_category_id = hpc.id
          WHERE cos.hospital_id = ?
            AND cos.id IN (SELECT MIN(id) FROM category_order_settings WHERE hospital_id = ? GROUP BY patient_category_id)
          ORDER BY hpc.sort_order
        `).bind(hospitalId, hospitalId).all<any>()
      }
    } else {
      catSettingsDash = await c.env.DB.prepare(`
        SELECT cos.*, hpc.category_key, hpc.category_name
        FROM category_order_settings cos
        JOIN hospital_patient_categories hpc ON cos.patient_category_id = hpc.id
        WHERE cos.hospital_id = ?
          AND cos.id IN (
            SELECT MAX(id) FROM category_order_settings
            WHERE hospital_id = ?
              AND (CAST(year AS INTEGER) < CAST(? AS INTEGER)
                   OR (CAST(year AS INTEGER) = CAST(? AS INTEGER) AND CAST(month AS INTEGER) < CAST(? AS INTEGER)))
            GROUP BY patient_category_id
          )
        ORDER BY hpc.sort_order
      `).bind(hospitalId, hospitalId, dashReqYear, dashReqYear, dashReqMonth).all<any>()
    }
  }

  let prevCatSettingsDash = await c.env.DB.prepare(`
    SELECT cos.*, hpc.category_key, hpc.category_name
    FROM category_order_settings cos
    JOIN hospital_patient_categories hpc ON cos.patient_category_id = hpc.id
    WHERE cos.hospital_id = ? AND cos.year = ? AND cos.month = ?
  `).bind(hospitalId, prevYear2, prevMonth).all<any>()
  // 전월도 없으면 전월 이전 중 가장 가까운 설정 사용
  if (!prevCatSettingsDash.results || prevCatSettingsDash.results.length === 0) {
    prevCatSettingsDash = await c.env.DB.prepare(`
      SELECT cos.*, hpc.category_key, hpc.category_name
      FROM category_order_settings cos
      JOIN hospital_patient_categories hpc ON cos.patient_category_id = hpc.id
      WHERE cos.hospital_id = ?
        AND cos.id IN (
          SELECT MAX(id) FROM category_order_settings
          WHERE hospital_id = ?
            AND (CAST(year AS INTEGER) < CAST(? AS INTEGER)
                 OR (CAST(year AS INTEGER) = CAST(? AS INTEGER) AND CAST(month AS INTEGER) < CAST(? AS INTEGER)))
          GROUP BY patient_category_id
        )
      ORDER BY hpc.sort_order
    `).bind(hospitalId, hospitalId, prevYear2, prevYear2, prevMonth).all<any>()
  }

  // 오늘 전체 식수: 직원+보호자+환자군 커스텀 (meals_include_keys 기준 적용, Promise.all에서 조회됨)
  let todayCustomMeals = 0
  if (todayMealRow?.custom_data) {
    try {
      const todayCustomData = JSON.parse(todayMealRow.custom_data || '{}')
      ;(customFieldsList.results || []).filter((f:any) => {
        if (f.unit_type === 'ea') return false
        if (hasIncludeKeys) return mealsIncludeFieldKeys.has(f.field_key)
        return true
      }).forEach((f:any) => {
        const fv = todayCustomData[f.field_key] || {}
        todayCustomMeals += (fv.bf||0) + (fv.l||0) + (fv.d||0)
      })
    } catch(e) {}
  }
  const todayPatientMeals = (todayMealRow?.staff_total || 0) + (todayMealRow?.guardian_total || 0) + todayCustomMeals
  const catMonthMap2: Record<number, number> = {}
  ;(catMonthlyOrders.results||[]).forEach((r:any) => { catMonthMap2[r.patient_category_id] = r.total })
  const catTodayMap2: Record<number, number> = {}
  ;(catTodayOrders.results||[]).forEach((r:any) => { catTodayMap2[r.patient_category_id] = r.total })

  // NULL 발주 분배: 카테고리가 1개인 병원은 미분류 발주를 해당 카테고리에 포함
  // 카테고리가 2개 이상인 병원은 NULL 발주를 별도 처리 (catDietPrices 합산에서 제외되므로)
  const nullMonthAmt = nullCatMonthlyOrder?.total || 0
  const nullTodayAmt = nullCatTodayOrder?.total || 0
  if (nullMonthAmt > 0 || nullTodayAmt > 0) {
    const catCount = (patientCatsDash.results||[]).length
    if (catCount === 1) {
      // 단일 카테고리: NULL 발주를 해당 카테고리에 합산
      const singleCatId = (patientCatsDash.results||[])[0]?.id
      if (singleCatId) {
        if (nullMonthAmt > 0) catMonthMap2[singleCatId] = (catMonthMap2[singleCatId]||0) + nullMonthAmt
        if (nullTodayAmt > 0) catTodayMap2[singleCatId] = (catTodayMap2[singleCatId]||0) + nullTodayAmt
      }
    }
    // 카테고리가 2개 이상인 경우: NULL 발주는 catMonthMap2에 -1 키로 저장 (전체 합산 시 포함용)
    if (catCount > 1) {
      catMonthMap2[-1] = nullMonthAmt
      catTodayMap2[-1] = nullTodayAmt
    }
  }
  const catSetMap3: Record<number, any> = {}
  ;(catSettingsDash.results||[]).forEach((s3:any) => { catSetMap3[s3.patient_category_id] = s3 })
  const prevCatSetMap3: Record<number, any> = {}
  ;(prevCatSettingsDash.results||[]).forEach((s3:any) => { prevCatSetMap3[s3.patient_category_id] = s3 })

  const totalCatBudgetDash = (catSettingsDash.results||[]).reduce((s3:number, c3:any) => s3+(c3.monthly_budget||0), 0)

  // ── 카테고리별 식단가 독립 계산을 위한 헬퍼 ────────────────────
  // meals_include_keys: ['staff','guardian','cat_cancer','nc_key_diet_key_xxx'] 중 선택
  // budget_include_keys: ['cancer','nursing',...] = category_key 목록 (해당 카테고리 발주금액 합산)
  //
  // buildMealsFromKeys: 특정 키 목록에 해당하는 식수 합계 반환
  //   mealStatsRow: { total_staff, total_guardian }
  //   customTotalsMap: { cat_cancer: N, cat_nursing: N, diet_key_xxx: N, ... }  (month 또는 today용)
  // st_key_{diet_key}: 직원식 개별항목 - 커스텀 필드에 직원식 데이터가 있으면 그 값 사용
  //   커스텀 필드로 입력한 경우(ms.total_staff=0): customTotalsMap에서 직원식 키로 조회
  //   레거시 방식(breakfast_staff 등 컬럼): total_staff로 폴백
  const buildMealsFromKeys = (mealsKeys: string[], mealStatsRow: {total_staff?:number,total_guardian?:number}|null, customTotalsMap: Record<string,number>): number => {
    if (!mealsKeys || mealsKeys.length === 0) return 0
    let total = 0
    // 구버전 호환: 'staff' 단일 키
    if (mealsKeys.includes('staff')) total += (mealStatsRow?.total_staff || 0)
    // 신버전: st_key_{diet_key} - 커스텀 필드 우선, 없으면 legacy total_staff 사용
    if (mealsKeys.some(k => k.startsWith('st_key_'))) {
      let staffFromCustom = 0
      mealsKeys.filter(k => k.startsWith('st_key_')).forEach(k => {
        const dietKey = k.replace('st_key_', '')  // e.g. 'preset_staff_general_2'
        staffFromCustom += (customTotalsMap['diet_' + dietKey] || customTotalsMap[dietKey] || 0)
      })
      // 커스텀 필드에 직원식 데이터가 있으면 사용, 없으면 legacy total_staff 사용
      total += staffFromCustom > 0 ? staffFromCustom : (mealStatsRow?.total_staff || 0)
    }
    if (mealsKeys.includes('guardian')) total += (mealStatsRow?.total_guardian || 0)
    mealsKeys.filter(k => k.startsWith('cat_')).forEach(k => { total += (customTotalsMap[k] || 0) })
    // 비급여식 식수: nc_key_{diet_key} 형식
    // diet_categories.diet_key = 'preset_nc_guardian_1'
    // meal_custom_fields.field_key = 'diet_preset_nc_guardian_1' (앞에 'diet_' 추가)
    // customTotalsMap 키는 field_key 기준이므로 'diet_' 접두사를 붙여 조회
    mealsKeys.filter(k => k.startsWith('nc_key_')).forEach(k => {
      const dietKey = k.replace('nc_key_', '')  // e.g. 'preset_nc_guardian_1' or 'legacy_other'
      // legacy_ 패턴: 'legacy_other' → field_key='cat_other' (legacy_ 제거 후 cat_ 붙임)
      const legacyKey = dietKey.startsWith('legacy_') ? 'cat_' + dietKey.replace('legacy_', '') : null
      total += (customTotalsMap['diet_' + dietKey] || customTotalsMap[dietKey] || (legacyKey ? customTotalsMap[legacyKey] : 0) || 0)
    })
    // 치료식 식수: th_key_{diet_key} 형식
    // diet_categories.diet_key = 'preset_therapy_gastrectomy_1' or 'legacy_general'
    // meal_custom_fields.field_key = 'diet_preset_therapy_gastrectomy_1' or 'cat_general'
    mealsKeys.filter(k => k.startsWith('th_key_')).forEach(k => {
      const dietKey = k.replace('th_key_', '')  // e.g. 'preset_therapy_gastrectomy_1' or 'legacy_general'
      // legacy_ 패턴: 'legacy_general' → field_key='cat_general' (legacy_ 제거 후 cat_ 붙임)
      const legacyKey = dietKey.startsWith('legacy_') ? 'cat_' + dietKey.replace('legacy_', '') : null
      total += (customTotalsMap['diet_' + dietKey] || customTotalsMap[dietKey] || (legacyKey ? customTotalsMap[legacyKey] : 0) || 0)
    })
    return total
  }

  // ★ 식수 구성 세분화: mealsKeys에서 환자/직원/보호자/기타 식수를 각각 계산해 반환
  const buildMealsBreakdown = (mealsKeys: string[], mealStatsRow: {total_staff?:number,total_guardian?:number}|null, customTotalsMap: Record<string,number>): {
    patientMeals: number, staffMeals: number, guardianMeals: number, therapyMeals: number, ncMeals: number,
    hasStaff: boolean, hasGuardian: boolean
  } => {
    let patientMeals = 0, staffMeals = 0, guardianMeals = 0, therapyMeals = 0, ncMeals = 0
    let hasStaff = false, hasGuardian = false
    if (!mealsKeys || mealsKeys.length === 0) return { patientMeals, staffMeals, guardianMeals, therapyMeals, ncMeals, hasStaff, hasGuardian }
    // 직원식
    if (mealsKeys.includes('staff')) {
      staffMeals += (mealStatsRow?.total_staff || 0)
      hasStaff = true
    }
    if (mealsKeys.some(k => k.startsWith('st_key_'))) {
      hasStaff = true
      let staffFromCustom = 0
      mealsKeys.filter(k => k.startsWith('st_key_')).forEach(k => {
        const dk = k.replace('st_key_', '')
        staffFromCustom += (customTotalsMap['diet_' + dk] || customTotalsMap[dk] || 0)
      })
      staffMeals += staffFromCustom > 0 ? staffFromCustom : (mealStatsRow?.total_staff || 0)
    }
    // 보호자식 (legacy guardian key)
    if (mealsKeys.includes('guardian')) {
      guardianMeals += (mealStatsRow?.total_guardian || 0)
      hasGuardian = true
    }
    // 환자식 (cat_ 키)
    mealsKeys.filter(k => k.startsWith('cat_')).forEach(k => { patientMeals += (customTotalsMap[k] || 0) })
    // 비급여식 (nc_key_): 보호자식 포함 가능
    mealsKeys.filter(k => k.startsWith('nc_key_')).forEach(k => {
      const dk = k.replace('nc_key_', '')
      const legacyKey = dk.startsWith('legacy_') ? 'cat_' + dk.replace('legacy_', '') : null
      const v = (customTotalsMap['diet_' + dk] || customTotalsMap[dk] || (legacyKey ? customTotalsMap[legacyKey] : 0) || 0)
      // nc_key는 보호자/비급여 통합 - 보호자식으로 분류
      guardianMeals += v
      hasGuardian = true
    })
    // 치료식 (th_key_)
    mealsKeys.filter(k => k.startsWith('th_key_')).forEach(k => {
      const dk = k.replace('th_key_', '')
      const legacyKey = dk.startsWith('legacy_') ? 'cat_' + dk.replace('legacy_', '') : null
      therapyMeals += (customTotalsMap['diet_' + dk] || customTotalsMap[dk] || (legacyKey ? customTotalsMap[legacyKey] : 0) || 0)
    })
    return { patientMeals, staffMeals, guardianMeals, therapyMeals, ncMeals, hasStaff, hasGuardian }
  }

  // 이번 달 직원/보호자 식수 맵 (mealStats에서)
  const monthMealStatsRow = { total_staff: ms.total_staff||0, total_guardian: ms.total_guardian||0 }
  // customFieldTotals는 이미 계산되어 있음 (월별 필드별 합계)

  // 오늘 커스텀 필드별 식수 맵 (cat_{key} → 합계)
  const todayCatCustomMap: Record<string, number> = {}
  // 오늘 직원/보호자 식수
  const todayMealStatsRow = { total_staff: todayMealRow?.staff_total||0, total_guardian: todayMealRow?.guardian_total||0 }
  if (todayMealRow?.custom_data) {
    try {
      const todayCustomData = JSON.parse(todayMealRow.custom_data || '{}')
      ;(customFieldsList.results || []).filter((f:any) => f.unit_type !== 'ea').forEach((f:any) => {
        const fv = todayCustomData[f.field_key] || {}
        todayCatCustomMap[f.field_key] = (fv.bf||0) + (fv.l||0) + (fv.d||0)
      })
    } catch(e) {}
  }

  // category_key → id 맵
  const catKeyToIdMap: Record<string, number> = {}
  ;(patientCatsDash.results||[]).forEach((cat:any) => { catKeyToIdMap[cat.category_key] = cat.id })

  const catDietPrices = (patientCatsDash.results||[]).map((cat:any) => {
    const s3 = catSetMap3[cat.id] || {}
    // formula 설정 파싱 (먼저 budgetKeys 확인해야 targetPrice 폴백 결정에 사용)
    let budgetKeys: string[] = []
    let mealsKeys: string[] = []
    let extraIncludeKeys: string[] = []
    try { budgetKeys = JSON.parse(cat.budget_include_keys || 'null') || [] } catch(e) {}
    try { mealsKeys = JSON.parse(cat.meals_include_keys || 'null') || [] } catch(e) {}
    try { extraIncludeKeys = JSON.parse(cat.extra_include_keys || 'null') || [] } catch(e) {}

    // ★ 공통 계산 서비스: CategoryMasterConfig 변환
    const catConfig = rowToCategoryConfig(cat, s3)
    // settings.meal_price fallback (budgetKeys가 있는 주요 환자군만)
    if (catConfig.target_meal_price === 0 && budgetKeys.length > 0 && settings?.meal_price) {
      catConfig.target_meal_price = settings.meal_price
    }
    // extra_include_keys 하위호환 (구버전 데이터)
    if (extraIncludeKeys.includes('supply')) catConfig.budget_include_supply = true
    if (extraIncludeKeys.includes('card'))   catConfig.card_food_include = true
    if (extraIncludeKeys.includes('event'))  catConfig.budget_include_event = true

    const catIncludeSupply = catConfig.budget_include_supply
    const catIncludeCard   = catConfig.budget_include_card
    const isMainCategory   = budgetKeys.length > 0

    const dbMonthBudget = s3?.monthly_budget || 0
    const workDays = s3?.working_days || workingDays
    const catRatio = totalCatBudgetDash > 0 ? (dbMonthBudget / totalCatBudgetDash) : (1 / Math.max((patientCatsDash.results||[]).length, 1))

    // ★ 공통 계산 함수로 이번 달 식단가 계산
    const monthCalc = calcCategoryDietPrice({
      config: catConfig,
      catMonthMap: catMonthMap2,
      catKeyToId: catKeyToIdMap,
      ordersByType: ordersByCostType,
      cardByType: cardByCostType,
      mealCounts: { total_staff: ms.total_staff||0, total_guardian: ms.total_guardian||0, customTotals: customFieldTotals },
      workingDays: workDays
    })

    const monthAmt       = monthCalc.monthAmt
    const monthMeals     = monthCalc.monthMeals
    const monthDietPrice = monthCalc.dietPrice
    const monthBudget    = monthCalc.monthBudget || dbMonthBudget
    const targetPrice    = monthCalc.targetPrice
    const mealsBreakdown = monthCalc.mealsBreakdown

    // 환자식 단독 식수 (직원식/보호자식 제외)
    const patientOnlyMeals = mealsBreakdown.patientMeals + mealsBreakdown.therapyMeals
    const patientOnlyDietPrice = patientOnlyMeals > 0 ? Math.round(monthAmt / patientOnlyMeals) : 0

    // ── 오늘 발주금액 계산 (budget_include_keys 기반) ──
    const todayCalc = calcCategoryDietPrice({
      config: catConfig,
      catMonthMap: catTodayMap2,
      catKeyToId: catKeyToIdMap,
      ordersByType: ordersByCostTypeToday,
      cardByType: cardByCostTypeToday,
      mealCounts: { total_staff: todayMealStatsRow.total_staff||0, total_guardian: todayMealStatsRow.total_guardian||0, customTotals: todayCatCustomMap },
      workingDays: workDays
    })
    const todayAmt      = todayCalc.monthAmt
    const todayCatMeals = todayCalc.monthMeals
    const todayDietPrice = todayCalc.dietPrice

    const prevSet = prevCatSetMap3[cat.id] || {}
    const prevTargetPrice = prevSet.ref_meal_price || prevSet.target_meal_price || 0
    const prevMonthBudget = prevSet.monthly_budget || 0
    return {
      id: cat.id, category_key: cat.category_key, category_name: cat.category_name,
      monthAmt, todayAmt, monthBudget, targetPrice, workDays,
      monthMeals, monthDietPrice,
      mealPrice: monthDietPrice,  // 보고서 PAGE3 호환 필드 (monthDietPrice와 동일)
      todayCatMeals, todayDietPrice, catRatio,
      prevTargetPrice, prevMonthBudget,
      budgetKeys, mealsKeys, extraIncludeKeys,
      catIncludeSupply, catIncludeCard,
      catIncludeEvent: catConfig.budget_include_event,   // ★ 신규
      catCardFoodInclude: catConfig.card_food_include,   // ★ 신규
      catCardSupplyInclude: catConfig.card_supply_include, // ★ 신규
      catCardEventInclude: catConfig.card_event_include,   // ★ 신규
      refMealPrice: s3?.ref_meal_price || 0,  // 관리자 설정 기준 식단가 (= targetPrice)
      settingsMealPrice: settings?.meal_price || 0,
      // 금액 구성 명세 (관리자 설정 검증용)
      monthAmtBreakdown: monthCalc.monthAmtBreakdown,
      // ★ 식수 구성 breakdown
      mealsBreakdown: {
        patientMeals: mealsBreakdown.patientMeals,
        staffMeals: mealsBreakdown.staffMeals,
        guardianMeals: mealsBreakdown.guardianMeals,
        therapyMeals: mealsBreakdown.therapyMeals,
        hasStaff: mealsBreakdown.hasStaff,
        hasGuardian: mealsBreakdown.hasGuardian
      },
      patientOnlyMeals,
      patientOnlyDietPrice
    }
  })

  // 전월 식단가 계산 (현재 월과 동일 로직)
  const pms = prevMealStats || { total_patient:0, total_staff:0, total_noncovered:0, total_guardian:0 }
  // 전월 총식수: 직원+보호자+커스텀 필드 합계 (새 방식 - total_patient는 항상 0)
  const prevTotalMeals = (pms.total_staff||0) + (pms.total_guardian||0) + prevMealCustomTotal
  // 전월 식단가 계산용 식수: 비급여 제외 (직원+보호자+환자군 커스텀)
  const prevMealsForPrice = (pms.total_staff||0) + (pms.total_guardian||0) + prevMealCustomTotal
  const prevTotalUsed = prevOrders?.total_used || 0
  const prevSupplyUsed = prevSupply?.supply_used || 0
  const prevCardExpensesUsed = prevCardExpenses?.total || 0
  // ① 전월 전체 식단가
  const prevMealPriceTotal = prevMealsForPrice > 0 ? Math.round(prevTotalUsed / prevMealsForPrice) : 0
  // ② 전월 직원식 제외: 총금액 ÷ (전체식수 - 직원식수)
  const prevMealCustomStaffTotal = (customFieldsList.results || [])
    .filter((f: any) => f.unit_type !== 'ea' && staffFieldKeySet.has(f.field_key))
    .reduce((s: number, f: any) => s + (prevCustomFieldTotals[f.field_key] || 0), 0)
  const prevStaffMealsForCalc = hasStCustomKeys
    ? (prevMealCustomStaffTotal > 0 ? prevMealCustomStaffTotal : (pms.total_staff||0))
    : (pms.total_staff||0)
  const prevMealsNoStaff = prevMealsForPrice - prevStaffMealsForCalc
  const prevMealPriceNoStaff = prevMealsNoStaff > 0
    ? Math.round(prevTotalUsed / prevMealsNoStaff) : 0
  // ③ 전월 소모품/카드 제외 (소모품 발주 + 법인카드 실지출)
  const prevSupplyCardUsed = prevSupplyUsed + prevCardExpensesUsed
  const prevMealPriceNoSupply = prevMealsForPrice > 0
    ? Math.round((prevTotalUsed - prevSupplyCardUsed) / prevMealsForPrice) : 0

  // ── 현재 식단가: 전체발주 ÷ 전체식수(카테고리+직원+보호자) ────────────
  // admin.ts와 동일 기준: 영양사 페이지 기준으로 통일
  // 카테고리 식수만으로 나누면 직원/보호자 식분 발주가 분모에 빠져 과대계상됨
  let formulaMealPriceTotal = mealPriceTotal  // 기본값: 기존 계산 (카테고리 없는 병원)
  const activeCatDietPrices = catDietPrices.filter(c => c.monthMeals > 0 && c.monthAmt > 0)
  if (activeCatDietPrices.length >= 1) {
    // 카테고리별 monthMeals에 이미 직원식(st_key_)·보호자·비급여가 포함될 수 있음
    // → 중복 방지를 위해 catDietPrices의 meals_include_keys를 확인
    // meals_include_keys에 'st_key_' 가 포함된 카테고리는 직원식을 이미 가산함
    const catStaffIncluded = activeCatDietPrices.some(c => (c.mealsKeys || []).some((k: string) => k.startsWith('st_key_') || k === 'staff'))
    const catGuardianIncluded = activeCatDietPrices.some(c => (c.mealsKeys || []).includes('guardian'))
    // 카테고리 식수 합산 (meals_include_keys 기반으로 이미 직원/보호자 포함 가능)
    const totalCatMeals = activeCatDietPrices.reduce((s, c) => s + c.monthMeals, 0)
    // 전체 식수 = 카테고리 식수 + (직원 - 이미 포함된 경우 제외) + (보호자 - 이미 포함된 경우 제외)
    const extraStaff = catStaffIncluded ? 0 : (ms.total_staff || 0)
    const extraGuardian = catGuardianIncluded ? 0 : (ms.total_guardian || 0)
    const totalMealsForFormula = totalCatMeals + extraStaff + extraGuardian
    // 전체 발주금액 ÷ 전체 식수 (영양사/어드민 페이지와 동일 기준)
    if (totalMealsForFormula > 0) {
      formulaMealPriceTotal = Math.round(totalUsed / totalMealsForFormula)
    }
  }

  // ── 총 운영원가: 식재료 + 소모품 + 카드 (카테고리 수 관계없이 항상 계산) ────
  // mealPriceOperating = (전체발주 + 소모품 + 카드) ÷ 전체식수
  // catDietPrices에서 소모품/카드를 포함한 카테고리는 이미 monthAmt에 반영됨
  // 여기서는 catIncludeSupply/catIncludeCard가 없는 경우를 위한 별도 총 운영원가 계산
  const operatingTotalUsed = totalUsed + monthSupplyTotal + monthCardTotal
  const totalMealsForOp = activeCatDietPrices.length >= 1
    ? (() => {
        const catStaffInc = activeCatDietPrices.some(c => (c.mealsKeys || []).some((k: string) => k.startsWith('st_key_') || k === 'staff'))
        const catGuardInc = activeCatDietPrices.some(c => (c.mealsKeys || []).includes('guardian'))
        const totalCatMeals2 = activeCatDietPrices.reduce((s, c) => s + c.monthMeals, 0)
        return totalCatMeals2 + (catStaffInc ? 0 : (ms.total_staff||0)) + (catGuardInc ? 0 : (ms.total_guardian||0))
      })()
    : (totalMealsForPrice || 0)
  const mealPriceOperating = totalMealsForOp > 0 ? Math.round(operatingTotalUsed / totalMealsForOp) : 0
  // 카테고리별 운영원가 (카테고리 식단가 + 소모품/카드가 미반영된 카테고리에 대한 보조 지표)
  const catOperatingPrices = catDietPrices.map(c => {
    if (c.catIncludeSupply || c.catIncludeCard) return { ...c, operatingDietPrice: c.monthDietPrice }
    // 소모품/카드 미포함 카테고리: 운영원가 = (catAmt + 소모품비례 + 카드비례) / catMeals
    const supplyShare = totalMealsForOp > 0 ? Math.round(monthSupplyTotal * (c.monthMeals / totalMealsForOp)) : 0
    const cardShare = totalMealsForOp > 0 ? Math.round(monthCardTotal * (c.monthMeals / totalMealsForOp)) : 0
    const opAmt = c.monthAmt + supplyShare + cardShare
    const opPrice = c.monthMeals > 0 ? Math.round(opAmt / c.monthMeals) : 0
    return { ...c, operatingDietPrice: opPrice }
  })

  // ══════════════════════════════════════════════════════════════
  // 2.2 월말 예상 식단가 자동 계산
  // ══════════════════════════════════════════════════════════════
  // 로직:
  //   경과일 = 현재 발주 데이터가 있는 일수 (daily_orders distinct dates)
  //   현재 일평균 발주액 = 총 사용금액 ÷ 경과일
  //   현재 일평균 식수 = 총 식수 ÷ 식수 입력 일수
  //   월말 예상 총 발주액 = 일평균 발주액 × 해당 월 전체 근무일수
  //   월말 예상 총 식수 = 일평균 식수 × 해당 월 전체 근무일수
  //   월말 예상 식단가 = 월말 예상 총 발주액 ÷ 월말 예상 총 식수

  // 해당 월의 총 일수
  const reqYearInt = parseInt(year)
  const reqMonthInt = parseInt(month)
  const daysInMonth = new Date(reqYearInt, reqMonthInt, 0).getDate()
  // 오늘 날짜와 비교해 현재 경과일 계산
  const todayDate = new Date()
  const isCurrentMonthForProj = (todayDate.getFullYear() === reqYearInt && todayDate.getMonth() + 1 === reqMonthInt)
  const elapsedDays = isCurrentMonthForProj ? todayDate.getDate() : daysInMonth

  // 발주 경과일 (Promise.all에서 이미 조회됨)
  const orderDayCnt = orderDayCountRow?.cnt || 0

  // 식수 입력 일수
  const mealDayCnt = mealStats?.days_entered || 0

  // 일평균 발주액
  const dailyAvgUsed = orderDayCnt > 0 ? totalUsed / orderDayCnt : (elapsedDays > 0 ? totalUsed / elapsedDays : 0)

  // 월말 예상 총 발주액 (현재 추세 × 남은 일수 반영)
  const projectedTotalUsed = isCurrentMonthForProj && elapsedDays < daysInMonth
    ? totalUsed + dailyAvgUsed * (daysInMonth - elapsedDays)
    : totalUsed

  // 일평균 식수
  const dailyAvgMeals = mealDayCnt > 0 ? totalMeals / mealDayCnt : 0

  // 월말 예상 총 식수
  // 식수 데이터 없을 때는 목표 식단가 기준으로 식수 역산 (발주액 ÷ 목표 식단가)
  const projectedTotalMeals = isCurrentMonthForProj && mealDayCnt > 0 && elapsedDays < daysInMonth
    ? totalMeals + dailyAvgMeals * (daysInMonth - elapsedDays)
    : totalMeals

  // 월말 예상 식단가
  // ① 식수 데이터 있으면: 예상 발주액 ÷ 예상 식수
  // ② 식수 데이터 없지만 목표 식단가 있으면: 현재 식단가(formulaMealPriceTotal) 기준 추세 사용
  let projectedMonthEndMealPrice = 0
  if (projectedTotalMeals > 0) {
    projectedMonthEndMealPrice = Math.round(projectedTotalUsed / projectedTotalMeals)
  } else if (formulaMealPriceTotal > 0 && totalUsed > 0) {
    // 식수 없는 경우: 현재 식단가를 월말 예상값으로 사용
    projectedMonthEndMealPrice = formulaMealPriceTotal
  }

  // 목표 식단가 (settings에서)
  const targetMealPrice = settings?.meal_price || 0

  // ── 카테고리별 가중평균 목표 식단가 계산 ──
  // 병원 설정의 카테고리별 목표 식단가(ref_meal_price) 기준
  // 가중평균 = Σ(카테고리별목표 × 해당예산비중)
  const activeCatDietPricesForTarget = catDietPrices.filter(c =>
    (c.budgetKeys||[]).length > 0  // 예산 포함 키가 있는 주요 카테고리만
  )
  const totalCatBudgetForTarget = activeCatDietPricesForTarget.reduce((s, c) => s + (c.monthBudget||0), 0)
  let weightedAvgTargetPrice = 0
  if (activeCatDietPricesForTarget.length > 0) {
    if (totalCatBudgetForTarget > 0) {
      weightedAvgTargetPrice = Math.round(
        activeCatDietPricesForTarget.reduce((s, c) => {
          const w = (c.monthBudget||0) / totalCatBudgetForTarget
          return s + (c.targetPrice||0) * w
        }, 0)
      )
    } else if (activeCatDietPricesForTarget.length > 0) {
      // 예산 없을 때: 단순 평균
      weightedAvgTargetPrice = Math.round(
        activeCatDietPricesForTarget.reduce((s, c) => s + (c.targetPrice||0), 0)
        / activeCatDietPricesForTarget.length
      )
    }
  }
  // 가중평균 목표 없으면 settings.meal_price 폴백
  const effectiveTargetMealPrice = weightedAvgTargetPrice > 0 ? weightedAvgTargetPrice : targetMealPrice

  // ── 카테고리별 월말 예상 식단가 계산 ──
  const catProjections = activeCatDietPricesForTarget.map(cat => {
    // 카테고리별 일평균 발주액
    const catDailyAvgUsed = orderDayCnt > 0 ? (cat.monthAmt || 0) / orderDayCnt
      : (elapsedDays > 0 ? (cat.monthAmt || 0) / elapsedDays : 0)
    // 카테고리별 월말 예상 발주액
    const catProjectedAmt = isCurrentMonthForProj && elapsedDays < daysInMonth
      ? (cat.monthAmt || 0) + catDailyAvgUsed * (daysInMonth - elapsedDays)
      : (cat.monthAmt || 0)
    // 카테고리별 일평균 식수
    const catDailyAvgMeals = mealDayCnt > 0 ? (cat.monthMeals || 0) / mealDayCnt : 0
    // 카테고리별 월말 예상 식수
    const catProjectedMeals = isCurrentMonthForProj && mealDayCnt > 0 && elapsedDays < daysInMonth
      ? (cat.monthMeals || 0) + catDailyAvgMeals * (daysInMonth - elapsedDays)
      : (cat.monthMeals || 0)
    // 카테고리별 월말 예상 식단가
    const catProjectedMealPrice = catProjectedMeals > 0
      ? Math.round(catProjectedAmt / catProjectedMeals)
      : (cat.monthDietPrice || 0)
    return {
      id: cat.id,
      category_key: cat.category_key,
      category_name: cat.category_name,
      targetPrice: cat.targetPrice || 0,
      projectedMealPrice: catProjectedMealPrice,
      projectedAmt: Math.round(catProjectedAmt),
      projectedMeals: Math.round(catProjectedMeals)
    }
  })

  // 예상 식단가 vs 목표 차이 (가중평균 목표 기준)
  const projectedMealPriceDiff = effectiveTargetMealPrice > 0
    ? Math.round(projectedMonthEndMealPrice - effectiveTargetMealPrice) : 0
  const projectedMealPriceDiffPct = effectiveTargetMealPrice > 0
    ? parseFloat(((projectedMonthEndMealPrice - effectiveTargetMealPrice) / effectiveTargetMealPrice * 100).toFixed(1)) : 0

  // ══════════════════════════════════════════════════════════════
  // 2.3 예산 소진 예상일
  // ══════════════════════════════════════════════════════════════
  // 로직:
  //   일평균 사용금액 = 총 사용금액 ÷ 경과일
  //   잔여 예산 = 총 예산 - 총 사용금액
  //   소진까지 남은 일수 = 잔여 예산 ÷ 일평균 사용금액
  //   예산 소진 예상일 = 오늘 + 남은 일수
  let budgetDepletionDate: string | null = null
  let budgetDepletionDaysLeft: number | null = null
  let budgetDepletionStatus: 'normal' | 'warning' | 'exceeded' | 'no_data' = 'no_data'

  if (totalBudget > 0 && totalUsed > 0 && dailyAvgUsed > 0) {
    const remaining = totalBudget - totalUsed
    if (remaining <= 0) {
      budgetDepletionStatus = 'exceeded'
      budgetDepletionDaysLeft = 0
      budgetDepletionDate = `${reqYearInt}년 ${reqMonthInt}월 이미 초과`
    } else {
      const daysLeft = Math.ceil(remaining / dailyAvgUsed)
      budgetDepletionDaysLeft = daysLeft
      const depletionDate = new Date(todayDate)
      depletionDate.setDate(todayDate.getDate() + daysLeft)
      const depMonth = depletionDate.getMonth() + 1
      const depDay = depletionDate.getDate()
      budgetDepletionDate = `${depMonth}월 ${depDay}일`
      // 월말 이전 소진 예상이면 warning
      const monthEndDate = new Date(reqYearInt, reqMonthInt - 1, daysInMonth)
      budgetDepletionStatus = depletionDate <= monthEndDate ? 'warning' : 'normal'
    }
  } else if (totalBudget === 0) {
    budgetDepletionStatus = 'no_data'
  }

  // ══════════════════════════════════════════════════════════════
  // 2.5 발주 이상 탐지
  // ══════════════════════════════════════════════════════════════
  // 3개월 이동 평균 대비 이번 달 발주 급증 탐지
  // 업체별 발주 비중 편중 탐지
  // 식수 감소 + 발주 증가 패턴 탐지

  // 최근 3개월 평균 발주액 계산 (Promise.all에서 이미 조회됨)
  const prev3Avg = prev3MonthsData.results && prev3MonthsData.results.length > 0
    ? prev3MonthsData.results.reduce((s: number, r: any) => s + r.total, 0) / prev3MonthsData.results.length
    : 0

  const anomalies: Array<{type: string, message: string, severity: 'high'|'medium'|'low'}> = []

  // ① 총 발주 급증 탐지 (전월 평균 대비 +50% 이상, 경과일 기준 월말 예상치로 비교)
  if (prev3Avg > 0 && projectedTotalUsed > 0) {
    const increaseRatio = (projectedTotalUsed - prev3Avg) / prev3Avg * 100
    if (increaseRatio >= 100) {
      anomalies.push({ type: 'total_surge', message: `이번 달 발주가 최근 3개월 평균 대비 ${Math.round(increaseRatio)}% 증가 예상`, severity: 'high' })
    } else if (increaseRatio >= 50) {
      anomalies.push({ type: 'total_surge', message: `이번 달 발주가 최근 3개월 평균 대비 ${Math.round(increaseRatio)}% 증가 예상`, severity: 'medium' })
    }
  }

  // ② 특정 업체 발주 비중 편중 탐지
  if (totalUsed > 0 && vendors.results) {
    const vendorRatios = vendors.results
      .filter((v: any) => v.total_used > 0)
      .map((v: any) => ({ name: v.name, ratio: v.total_used / totalUsed * 100, used: v.total_used }))
      .sort((a: any, b: any) => b.ratio - a.ratio)

    if (vendorRatios.length > 0 && vendorRatios[0].ratio >= 60) {
      anomalies.push({ type: 'vendor_concentration', message: `${vendorRatios[0].name} 발주 비중 ${Math.round(vendorRatios[0].ratio)}%로 집중`, severity: 'medium' })
    }
    if (vendorRatios.length >= 2) {
      const top2Ratio = vendorRatios[0].ratio + vendorRatios[1].ratio
      if (top2Ratio >= 80) {
        anomalies.push({ type: 'vendor_concentration_top2', message: `상위 2개 업체(${vendorRatios[0].name}, ${vendorRatios[1].name}) 발주 비중 ${Math.round(top2Ratio)}%`, severity: 'low' })
      }
    }
  }

  // ③ 업체별 전월 대비 급증 탐지 (단일 쿼리로 최적화)
  if (vendors.results) {
    const prevVendorTotals = await c.env.DB.prepare(
      `SELECT vendor_id, COALESCE(SUM(total_amount),0) as total FROM daily_orders
       WHERE hospital_id=? AND order_date BETWEEN ? AND ?
       GROUP BY vendor_id`
    ).bind(hospitalId, prevDateStart, prevDateEnd).all<any>()
    const prevVendorMap: Record<number, number> = {}
    ;(prevVendorTotals.results||[]).forEach((r:any) => { prevVendorMap[r.vendor_id] = r.total })
    for (const v of (vendors.results as any[])) {
      const prevUsed = prevVendorMap[v.id] || 0
      if (prevUsed > 0 && v.total_used > 0) {
        const vendorIncRatio = (v.total_used - prevUsed) / prevUsed * 100
        if (vendorIncRatio >= 150) {
          anomalies.push({ type: 'vendor_surge', message: `${v.name} 발주 전월 대비 ${Math.round(vendorIncRatio)}% 증가`, severity: 'high' })
        } else if (vendorIncRatio >= 80) {
          anomalies.push({ type: 'vendor_surge', message: `${v.name} 발주 전월 대비 ${Math.round(vendorIncRatio)}% 증가`, severity: 'medium' })
        }
      }
    }
  }

  // ④ 식수 감소 + 발주 증가 탐지
  if (prevTotalMeals > 0 && totalMeals > 0 && prevTotalUsed > 0 && totalUsed > 0) {
    const mealChange = (totalMeals - prevTotalMeals) / prevTotalMeals * 100
    const usedChange = (totalUsed - prevTotalUsed) / prevTotalUsed * 100
    if (mealChange < -5 && usedChange > 10) {
      anomalies.push({ type: 'meal_used_mismatch', message: `식수 ${Math.abs(Math.round(mealChange))}% 감소했으나 발주금액 ${Math.round(usedChange)}% 증가 — 원가 관리 필요`, severity: 'high' })
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 2.4 식수 대비 발주 적정성 분석
  // ══════════════════════════════════════════════════════════════
  // 카테고리별 목표 식단가가 있으면 카테고리별 합산으로 적정 발주액 계산
  // (전체 평균 단가 × 총식수 방식은 단가 차이가 큰 다중 카테고리 병원에서 왜곡 발생)
  const catBasedAppropriateAmt = catDietPrices
    .filter(c => (c.targetPrice || 0) > 0 && (c.monthMeals || 0) > 0)
    .reduce((sum: number, c: any) => sum + (c.targetPrice * c.monthMeals), 0)
  const appropriateMealPrice = settings?.meal_price || 0  // 목표 식단가 = 폴백용
  // 카테고리별 합산이 있으면 우선 사용, 없으면 전체 목표 × 총식수 폴백
  const appropriateOrderAmt = catBasedAppropriateAmt > 0
    ? catBasedAppropriateAmt
    : (appropriateMealPrice > 0 && totalMeals > 0 ? appropriateMealPrice * totalMeals : 0)
  const orderAppropriatenessRatio = appropriateOrderAmt > 0
    ? parseFloat(((totalUsed - appropriateOrderAmt) / appropriateOrderAmt * 100).toFixed(1)) : 0

  // 예산 대비 사용률 (progress)
  const budgetProgressPct = totalBudget > 0 ? (totalUsed / totalBudget * 100) : 0

  // 식수 입력 신뢰도 판정
  // - 식수 입력 일수(mealDayCnt)가 발주 일수(orderDayCnt)의 25% 미만이거나
  //   절대 일수가 3일 미만이면 식수 데이터가 불충분하므로 diffRatio 기반 판정 제외
  const mealDataSufficient = mealDayCnt >= 3 && orderDayCnt > 0
    && (mealDayCnt / orderDayCnt) >= 0.25

  // label 판정: 식수×단가 기준과 예산 대비 기준을 모두 고려
  // 1) 예산 초과(105% 이상)이면 무조건 'over'
  // 2) 식수 데이터가 충분하고, 식수×단가 기준으로 +10% 초과이면 'over'
  // 3) 식수 데이터가 충분하고, 식수×단가 기준으로 -10% 미만이면 'under'
  // 4) 나머지(식수 불충분 포함)는 예산 범위 내이면 'normal'
  let orderAppropriatenessLabel: 'over' | 'under' | 'normal'
  if (budgetProgressPct >= 105) {
    orderAppropriatenessLabel = 'over'
  } else if (mealDataSufficient && orderAppropriatenessRatio >= 10) {
    orderAppropriatenessLabel = 'over'
  } else if (mealDataSufficient && orderAppropriatenessRatio <= -10) {
    orderAppropriatenessLabel = 'under'
  } else {
    orderAppropriatenessLabel = 'normal'
  }

  // ══════════════════════════════════════════════════════════════
  // 자동 분석 문장 생성 (규칙 기반)
  // ══════════════════════════════════════════════════════════════
  const autoAnalysis: string[] = []

  // 사용금액 분석 (전월 대비)
  if (prevTotalUsed > 0 && totalUsed > 0) {
    const usedChangePct = (totalUsed - prevTotalUsed) / prevTotalUsed * 100
    if (usedChangePct > 10) {
      autoAnalysis.push(`전월 대비 사용금액이 ${Math.round(usedChangePct)}% 증가했습니다.`)
    } else if (usedChangePct < -10) {
      autoAnalysis.push(`전월 대비 사용금액이 ${Math.abs(Math.round(usedChangePct))}% 감소했습니다.`)
    } else {
      autoAnalysis.push(`전월 대비 사용금액이 큰 변화 없이 유지되었습니다. (${usedChangePct > 0 ? '+' : ''}${Math.round(usedChangePct)}%)`)
    }
  }

  // 식단가 분석
  const currentDietPrice = formulaMealPriceTotal
  if (currentDietPrice > 0 && targetMealPrice > 0) {
    if (currentDietPrice > targetMealPrice) {
      const overPct = ((currentDietPrice - targetMealPrice) / targetMealPrice * 100).toFixed(1)
      autoAnalysis.push(`현재 식단가(${currentDietPrice.toLocaleString()}원)는 목표 대비 ${overPct}% 초과 상태입니다.`)
    } else {
      const underPct = ((targetMealPrice - currentDietPrice) / targetMealPrice * 100).toFixed(1)
      autoAnalysis.push(`현재 식단가(${currentDietPrice.toLocaleString()}원)는 목표 범위 내에서 유지되고 있습니다. (${underPct}% 여유)`)
    }
  }

  // 월말 예상 식단가 분석
  if (projectedMonthEndMealPrice > 0 && targetMealPrice > 0) {
    if (projectedMonthEndMealPrice > targetMealPrice) {
      autoAnalysis.push(`현재 추세 기준 월말 식단가(${projectedMonthEndMealPrice.toLocaleString()}원) 상승 가능성이 있습니다.`)
    } else {
      autoAnalysis.push(`현재 추세 기준 월말 식단가는 목표 범위 내 유지가 예상됩니다.`)
    }
  }

  // 식수 분석 (전월 대비)
  if (prevTotalMeals > 0 && totalMeals > 0 && prevTotalUsed > 0 && totalUsed > 0) {
    const mealChgPct = (totalMeals - prevTotalMeals) / prevTotalMeals * 100
    const usedChgPct2 = (totalUsed - prevTotalUsed) / prevTotalUsed * 100
    if (mealChgPct > 5 && usedChgPct2 > 5) {
      autoAnalysis.push(`식수 증가에 따라 사용금액이 함께 증가했습니다.`)
    } else if (mealChgPct < -5 && usedChgPct2 > 10) {
      autoAnalysis.push(`식수 감소 대비 비용이 증가하여 원가 관리가 필요합니다.`)
    }
  }

  // 업체 편중 분석
  if (totalUsed > 0 && vendors.results && vendors.results.length > 0) {
    const vendorRatiosSorted = (vendors.results as any[])
      .filter((v: any) => v.total_used > 0)
      .map((v: any) => ({ name: v.name, ratio: v.total_used / totalUsed * 100 }))
      .sort((a: any, b: any) => b.ratio - a.ratio)
    if (vendorRatiosSorted.length > 0 && vendorRatiosSorted[0].ratio >= 60) {
      autoAnalysis.push(`${vendorRatiosSorted[0].name} 발주 비중이 ${Math.round(vendorRatiosSorted[0].ratio)}%로 높습니다. 발주 다양화를 검토하세요.`)
    } else if (vendorRatiosSorted.length >= 2) {
      const top2Ratio = vendorRatiosSorted[0].ratio + vendorRatiosSorted[1].ratio
      if (top2Ratio >= 80) {
        autoAnalysis.push(`상위 2개 업체 발주 비중이 ${Math.round(top2Ratio)}%로 편중되어 있습니다.`)
      }
    }
  }

  // 예산 소진 예상
  if (budgetDepletionStatus === 'warning' && budgetDepletionDate) {
    autoAnalysis.push(`현재 지출 속도 기준 예산 소진 예상일은 ${budgetDepletionDate}입니다. 지출 조정이 필요합니다.`)
  } else if (budgetDepletionStatus === 'exceeded') {
    autoAnalysis.push(`이미 예산이 초과된 상태입니다.`)
  }

  return c.json({
    totalUsed,
    settings,
    vendors: vendors.results,
    dailyOrders: dailyOrders.results,
    // mealStats: 기존 고정 컬럼(total_staff/total_patient/total_guardian/total_noncovered/days_entered)을
    // 모두 보존하면서, custom_data 기반 식수를 반영한 totalMeals/customFieldTotals/daysEntered를 추가(additive).
    // 운영진(executive.ts) mealStats 형식과 동일 기준으로 totalMeals 제공.
    mealStats: {
      ...mealStats,
      totalMeals,                 // 직원 + 보호자 + 커스텀(환자군, ea 제외) = 운영진 totalMeals와 동일 기준
      customFieldTotals,          // 커스텀 필드별 월 합계 (환자군 등 custom_data 기반)
      mealCustomFields: customFieldsList.results || [],
      daysEntered: mealStats?.days_entered || 0,
    },
    mealCustomFields: customFieldsList.results || [],
    mealCustomTotals: customFieldTotals,
    // 식수 분류별 상세 breakdown (이번달 + 전달 + 증감) - 보고서/운영진 페이지용
    mealFieldBreakdown: (customFieldsList.results || []).map((f: any) => ({
      field_key: f.field_key,
      field_name: f.field_name,
      unit_type: f.unit_type,
      sort_order: f.sort_order,
      thisMonth: customFieldTotals[f.field_key] || 0,
      prevMonth: prevCustomFieldTotals[f.field_key] || 0,
      diff: (customFieldTotals[f.field_key] || 0) - (prevCustomFieldTotals[f.field_key] || 0)
    })),
    overBudgetVendors,
    mealPriceTotal: formulaMealPriceTotal,  // formula 기반 가중평균 (카테고리 없으면 기존 방식)
    mealPriceRaw: mealPriceTotal,            // 기존 총발주÷총식수 방식 (참고용)
    mealPriceNoStaff,
    mealPriceNoSupply,
    supplyCardUsed,     // 소모품+카드 제외 금액 합계 (프론트엔드 mp3 비율 보정용)
    mealPriceOperating,                      // 총 운영원가 (식재료+소모품+카드) ÷ 식수
    supplyExcludeKeys,  // 병원별 소모품 제외 설정 (프론트엔드 라벨 표시용)
    totalMeals,
    catDietPrices: catOperatingPrices,       // catIncludeSupply/catIncludeCard + operatingDietPrice 포함
    todayMeals: todayPatientMeals,  // 오늘 전체 식수 (직원+보호자+환자군)
    prevMonth: {
      month: prevMonth, year: parseInt(prevYear2),
      totalUsed: prevTotalUsed, totalMeals: prevTotalMeals,
      mealPriceTotal: prevMealPriceTotal,
      mealPriceNoStaff: prevMealPriceNoStaff,
      mealPriceNoSupply: prevMealPriceNoSupply,
      totalBudget: prevSettings?.total_budget || 0,
      targetMealPrice: prevSettings?.meal_price || 0
    },
    // ── 2.2 월말 예상 식단가 ──
    projection: {
      projectedTotalUsed: Math.round(projectedTotalUsed),
      projectedTotalMeals: Math.round(projectedTotalMeals),
      projectedMonthEndMealPrice,      // 월말 예상 식단가 (전체 가중평균)
      targetMealPrice: effectiveTargetMealPrice,  // 목표 식단가 (가중평균 목표 우선)
      weightedAvgTargetPrice,          // 카테고리 가중평균 목표 식단가
      settingsTargetMealPrice: targetMealPrice,   // monthly_settings.meal_price (원본)
      projectedMealPriceDiff,          // 목표 대비 차이 (원)
      projectedMealPriceDiffPct,       // 목표 대비 차이 (%)
      elapsedDays,                     // 경과일
      daysInMonth,                     // 월 총일수
      dailyAvgUsed: Math.round(dailyAvgUsed),   // 일평균 발주액
      dailyAvgMeals: Math.round(dailyAvgMeals), // 일평균 식수
      isCurrentMonth: isCurrentMonthForProj,
      catProjections                   // 카테고리별 월말 예상 식단가
    },
    // ── 2.3 예산 소진 예상일 ──
    budgetDepletion: {
      budgetDepletionDate,       // "3월 26일" 또는 null
      budgetDepletionDaysLeft,   // 남은 일수 (숫자)
      budgetDepletionStatus,     // 'normal' | 'warning' | 'exceeded' | 'no_data'
      remaining: totalBudget - totalUsed,
      dailyAvgUsed: Math.round(dailyAvgUsed)
    },
    // ── 2.4 식수 대비 발주 적정성 ──
    orderAppropriateness: {
      totalMeals,
      targetMealPrice: appropriateMealPrice,
      appropriateOrderAmt: Math.round(appropriateOrderAmt),
      actualOrderAmt: totalUsed,
      diffAmt: Math.round(totalUsed - appropriateOrderAmt),
      diffRatio: orderAppropriatenessRatio,
      budgetProgressPct: parseFloat(budgetProgressPct.toFixed(1)),  // 예산 대비 사용률
      label: orderAppropriatenessLabel,  // 'over' | 'under' | 'normal'
      usedCatBased: catBasedAppropriateAmt > 0  // 카테고리별 합산 기준 사용 여부
    },
    // ── 2.5 발주 이상 탐지 ──
    anomalies,
    // ── 자동 분석 문장 ──
    autoAnalysis,
    summary: {
      totalUsed,
      totalBudget,
      eventBudget,
      totalWithEvent: totalBudget + eventBudget,
      progress,
      remaining: totalBudget - totalUsed,
      dailyBudget,
      weeklyBudget,
      // 현재 달: 실제 오늘/이번 주 발주액, 과거 달: 일평균/주평균 실적(역산)
      todayUsed: avgDailyUsed,
      weekUsed: avgWeeklyUsed,
      todayProgress: dailyBudget > 0 ? (avgDailyUsed / dailyBudget * 100).toFixed(1) : '0.0',
      weekProgress: weeklyBudget > 0 ? (avgWeeklyUsed / weeklyBudget * 100).toFixed(1) : '0.0',
      // 과거 달 여부 플래그 (프론트에서 레이블 구분에 사용)
      isCurrentMonth,
      isPastMonth: !isCurrentMonth && (dashReqYear < nowYear || (dashReqYear === nowYear && dashReqMonth < nowMonth))
    }
  })
  } catch(err: any) {
    console.error('[dashboard/summary] ERROR:', err?.message || err, err?.stack)
    return c.json({ error: 'dashboard summary error: ' + (err?.message || String(err)) }, 500)
  }
})

// 연간 월별 비교
dashboard.get('/annual/:year', async (c) => {
  const user = c.get('user')
  const { year } = c.req.param()
  
  // admin은 hospitalId 쿼리 파라미터 필수, 없으면 첫 번째 병원 사용
  let hospitalId: any = user.role === 'admin' ? Number(c.req.query('hospitalId') || 0) : Number(user.hospitalId)
  if (user.role === 'admin' && !hospitalId) {
    // hospitalId 없으면 첫 번째 병원 ID 사용
    const firstHospital = await c.env.DB.prepare(`SELECT id FROM hospitals ORDER BY id LIMIT 1`).first<any>()
    hospitalId = firstHospital?.id
  }
  if (!hospitalId) return c.json({ monthly: [], mealMonthly: [], settings: [], vendorAnnual: [] })

  const monthly = await c.env.DB.prepare(
    `SELECT 
       strftime('%m', order_date) as month,
       SUM(total_amount) as total_used,
       SUM(taxable_amount) as total_taxable,
       SUM(exempt_amount) as total_exempt,
       SUM(vat_amount) as total_vat
     FROM daily_orders
     WHERE hospital_id = ? AND strftime('%Y', order_date) = ?
     GROUP BY month
     ORDER BY month`
  ).bind(hospitalId, year).all<any>()

  const mealMonthly = await c.env.DB.prepare(
    `SELECT 
       strftime('%m', meal_date) as month,
       SUM(breakfast_patient + lunch_patient + dinner_patient +
           breakfast_staff + lunch_staff + dinner_staff +
           breakfast_noncovered + lunch_noncovered + dinner_noncovered +
           breakfast_guardian + lunch_guardian + dinner_guardian) as total_meals,
       SUM(breakfast_patient + lunch_patient + dinner_patient) as total_patient,
       SUM(breakfast_staff + lunch_staff + dinner_staff) as total_staff,
       SUM(breakfast_noncovered + lunch_noncovered + dinner_noncovered) as total_noncovered,
       SUM(breakfast_guardian + lunch_guardian + dinner_guardian) as total_guardian
     FROM daily_meals
     WHERE hospital_id = ? AND strftime('%Y', meal_date) = ?
     GROUP BY month
     ORDER BY month`
  ).bind(hospitalId, year).all<any>()

  const settings = await c.env.DB.prepare(
    `SELECT month, total_budget, event_budget, meal_price, working_days FROM monthly_settings
     WHERE hospital_id = ? AND year = ?
     ORDER BY month`
  ).bind(hospitalId, year).all<any>()

  // 업체별 연간 합계
  const vendorAnnual = await c.env.DB.prepare(
    `SELECT v.id, v.name, v.category,
            strftime('%m', d.order_date) as month,
            SUM(d.total_amount) as total_used
     FROM daily_orders d
     JOIN vendors v ON d.vendor_id = v.id
     WHERE d.hospital_id = ? AND strftime('%Y', d.order_date) = ?
     GROUP BY v.id, month
     ORDER BY v.sort_order, month`
  ).bind(hospitalId, year).all<any>()

  // 잔반 연간 합계
  const wasteAnnual = await c.env.DB.prepare(
    `SELECT month, SUM(waste_amount) as total_waste, SUM(waste_cost) as total_cost
     FROM food_waste_records
     WHERE hospital_id = ? AND year = ?
     GROUP BY month ORDER BY month`
  ).bind(hospitalId, year).all<any>()

  // 전년도 같은 기간 식단가 비교용
  const prevYear = String(parseInt(year) - 1)
  const prevYearMeals = await c.env.DB.prepare(
    `SELECT strftime('%m', meal_date) as month,
            SUM(breakfast_patient+lunch_patient+dinner_patient+breakfast_staff+lunch_staff+dinner_staff+breakfast_noncovered+lunch_noncovered+dinner_noncovered+breakfast_guardian+lunch_guardian+dinner_guardian) as total_meals,
            SUM(breakfast_patient+lunch_patient+dinner_patient) as total_patient,
            SUM(breakfast_staff+lunch_staff+dinner_staff) as total_staff
     FROM daily_meals WHERE hospital_id=? AND strftime('%Y',meal_date)=?
     GROUP BY month ORDER BY month`
  ).bind(hospitalId, prevYear).all<any>()

  const prevYearOrders = await c.env.DB.prepare(
    `SELECT strftime('%m',order_date) as month, SUM(total_amount) as total_used
     FROM daily_orders WHERE hospital_id=? AND strftime('%Y',order_date)=?
     GROUP BY month ORDER BY month`
  ).bind(hospitalId, prevYear).all<any>()

  // supply/card 카테고리 연간 월별
  const supplyAnnual = await c.env.DB.prepare(
    `SELECT strftime('%m',d.order_date) as month, SUM(d.total_amount) as total_supply
     FROM daily_orders d JOIN vendors v ON d.vendor_id=v.id
     WHERE d.hospital_id=? AND strftime('%Y',d.order_date)=? AND (v.category='supply' OR v.category='card')
     GROUP BY month ORDER BY month`
  ).bind(hospitalId, year).all<any>()

  const staffAnnual = await c.env.DB.prepare(
    `SELECT strftime('%m',meal_date) as month,
            SUM(breakfast_staff+lunch_staff+dinner_staff) as total_staff,
            SUM(breakfast_patient+lunch_patient+dinner_patient+breakfast_staff+lunch_staff+dinner_staff+breakfast_noncovered+lunch_noncovered+dinner_noncovered+breakfast_guardian+lunch_guardian+dinner_guardian) as total_meals
     FROM daily_meals WHERE hospital_id=? AND strftime('%Y',meal_date)=?
     GROUP BY month ORDER BY month`
  ).bind(hospitalId, year).all<any>()

  // ── 연간 카테고리별 formula 기반 식단가 계산을 위한 추가 데이터 ──

  // 활성 카테고리 목록 (formula 포함)
  const annualCats = await c.env.DB.prepare(`
    SELECT * FROM hospital_patient_categories
    WHERE hospital_id = ? AND is_active = 1 ORDER BY sort_order, id
  `).bind(hospitalId).all<any>()

  // 커스텀 식수 필드 목록 (카테고리 식수 필드 확인용)
  const annualCustomFields = await c.env.DB.prepare(
    `SELECT * FROM meal_custom_fields WHERE hospital_id = ? AND is_active = 1 ORDER BY sort_order, id`
  ).bind(hospitalId).all<any>()

  // 월별 카테고리 발주금액 (patient_category_id 기반)
  const annualCatOrders = await c.env.DB.prepare(`
    SELECT patient_category_id,
           strftime('%m', order_date) as month,
           COALESCE(SUM(total_amount), 0) as total
    FROM daily_orders
    WHERE hospital_id = ?
      AND patient_category_id IS NOT NULL
      AND strftime('%Y', order_date) = ?
    GROUP BY patient_category_id, month
    ORDER BY patient_category_id, month
  `).bind(hospitalId, year).all<any>()

  // 월별 직원/보호자 식수 (mealMonthly에 이미 있지만 formula 계산 시 필요)
  // 월별 커스텀 필드 식수 집계 (cat_{key} 형태)
  const annualMealCustomData = await c.env.DB.prepare(
    `SELECT strftime('%m', meal_date) as month,
            custom_data,
            COALESCE(breakfast_staff+lunch_staff+dinner_staff, 0) as total_staff,
            COALESCE(breakfast_guardian+lunch_guardian+dinner_guardian, 0) as total_guardian
     FROM daily_meals
     WHERE hospital_id = ? AND strftime('%Y', meal_date) = ?
       AND custom_data IS NOT NULL AND custom_data != '{}'`
  ).bind(hospitalId, year).all<any>()

  // 월별 커스텀 필드 합계 집계: monthCustomTotals[month][fieldKey] = sum
  const monthCustomTotals: Record<string, Record<string,number>> = {}
  const monthStaffTotals: Record<string, number> = {}
  const monthGuardianTotals: Record<string, number> = {}
  ;(annualMealCustomData.results || []).forEach((row: any) => {
    const m = String(parseInt(row.month))  // '01' → '1'
    if (!monthCustomTotals[m]) monthCustomTotals[m] = {}
    monthStaffTotals[m] = (monthStaffTotals[m] || 0) + (row.total_staff || 0)
    monthGuardianTotals[m] = (monthGuardianTotals[m] || 0) + (row.total_guardian || 0)
    try {
      const cd = JSON.parse(row.custom_data || '{}')
      ;(annualCustomFields.results || []).filter((f: any) => f.unit_type !== 'ea').forEach((f: any) => {
        const fv = cd[f.field_key] || {}
        monthCustomTotals[m][f.field_key] = (monthCustomTotals[m][f.field_key] || 0) + (fv.bf||0) + (fv.l||0) + (fv.d||0)
      })
    } catch(e) {}
  })

  // 월별 카테고리 발주 맵: catOrderMap[catId][month] = total
  const annualCatKeyToIdMap: Record<string, number> = {}
  ;(annualCats.results || []).forEach((cat: any) => { annualCatKeyToIdMap[cat.category_key] = cat.id })
  const catOrderMap: Record<number, Record<string, number>> = {}
  ;(annualCatOrders.results || []).forEach((r: any) => {
    if (!catOrderMap[r.patient_category_id]) catOrderMap[r.patient_category_id] = {}
    catOrderMap[r.patient_category_id][String(parseInt(r.month))] = r.total
  })

  // 연간 카테고리별 월별 식단가 계산
  const annualCatDietPrices = (annualCats.results || []).map((cat: any) => {
    let budgetKeys: string[] = []
    let mealsKeys: string[] = []
    let extraIncludeKeys: string[] = []
    try { budgetKeys = JSON.parse(cat.budget_include_keys || 'null') || [] } catch(e) {}
    try { mealsKeys = JSON.parse(cat.meals_include_keys || 'null') || [] } catch(e) {}
    try { extraIncludeKeys = JSON.parse(cat.extra_include_keys || 'null') || [] } catch(e) {}
    // 카테고리별 소모품/카드 반영 여부
    const catIncludeSupply = cat.budget_include_supply === 1
    const catIncludeCard = cat.budget_include_card === 1
    const hasFormula = budgetKeys.length > 0 || mealsKeys.length > 0

    // extra_include_keys용 연간 소모품/카드 월별 합계 맵
    const annualSupplyMap: Record<string, number> = {}
    ;(supplyAnnual.results || []).forEach((r: any) => {
      annualSupplyMap[String(parseInt(r.month))] = r.total_supply || 0
    })
    // 연간 카드 월별 합계 맵 (supplyAnnual에 card_total이 있으면 사용)
    const annualCardMap: Record<string, number> = {}
    ;(supplyAnnual.results || []).forEach((r: any) => {
      annualCardMap[String(parseInt(r.month))] = r.total_card || 0
    })

    const monthlyDietPrices: Array<{month: number, monthAmt: number, monthMeals: number, dietPrice: number, operatingDietPrice: number}> = []
    for (let m = 1; m <= 12; m++) {
      const mStr = String(m)
      // 발주금액
      let monthAmt: number
      if (hasFormula && budgetKeys.length > 0) {
        monthAmt = budgetKeys.reduce((sum: number, key: string) => {
          const catId = annualCatKeyToIdMap[key]
          return sum + (catId ? (catOrderMap[catId]?.[mStr] || 0) : 0)
        }, 0)
      } else {
        monthAmt = catOrderMap[cat.id]?.[mStr] || 0
      }
      // extra_include_keys 및 catIncludeSupply/catIncludeCard 가산 (연간)
      if (extraIncludeKeys.includes('supply') || catIncludeSupply) monthAmt += (annualSupplyMap[mStr] || 0)
      if (extraIncludeKeys.includes('card') || catIncludeCard) monthAmt += (annualCardMap[mStr] || 0)
      // 식수
      let monthMeals: number
      const mCustom = monthCustomTotals[mStr] || {}
      const mStaff = monthStaffTotals[mStr] || 0
      const mGuardian = monthGuardianTotals[mStr] || 0
      if (hasFormula && mealsKeys.length > 0) {
        let total = 0
        // 구버전 'staff' 단일키 호환 + 신버전 st_key_ 개별항목 (하나라도 있으면 total_staff)
        if (mealsKeys.includes('staff') || mealsKeys.some(k => k.startsWith('st_key_'))) total += mStaff
        if (mealsKeys.includes('guardian')) total += mGuardian
        // noncovered는 항상 제외 (설정에 포함되어도 무시)
        mealsKeys.filter(k => k.startsWith('cat_')).forEach(k => { total += (mCustom[k] || 0) })
        monthMeals = total
      } else {
        const defaultCatKey = `cat_${cat.category_key}`
        // 기존 방식도 noncovered 제외: 카테고리 식수 + 직원 + 보호자
        monthMeals = (mCustom[defaultCatKey] || 0) + mStaff + mGuardian
      }
      const dietPrice = monthMeals > 0 ? Math.round(monthAmt / monthMeals) : 0
      // 운영원가: 소모품/카드 미반영 카테고리는 식재료+소모품+카드 합산
      const opSupply = (catIncludeSupply || extraIncludeKeys.includes('supply')) ? 0 : (annualSupplyMap[mStr] || 0)
      const opCard = (catIncludeCard || extraIncludeKeys.includes('card')) ? 0 : (annualCardMap[mStr] || 0)
      const opAmt = monthAmt + opSupply + opCard
      const operatingDietPrice = monthMeals > 0 ? Math.round(opAmt / monthMeals) : 0
      monthlyDietPrices.push({ month: m, monthAmt, monthMeals, dietPrice, operatingDietPrice })
    }
    return {
      id: cat.id,
      category_key: cat.category_key,
      category_name: cat.category_name,
      monthlyBudget: cat.monthly_budget || 0,
      budgetKeys,
      mealsKeys,
      extraIncludeKeys,
      catIncludeSupply,
      catIncludeCard,
      monthlyDietPrices
    }
  })

  return c.json({
    monthly: monthly.results,
    mealMonthly: mealMonthly.results,
    settings: settings.results,
    vendorAnnual: vendorAnnual.results,
    wasteAnnual: wasteAnnual.results || [],
    prevYearMeals: prevYearMeals.results || [],
    prevYearOrders: prevYearOrders.results || [],
    supplyAnnual: supplyAnnual.results || [],
    staffAnnual: staffAnnual.results || [],
    annualCatDietPrices: annualCatDietPrices || [],
    // 월별 카테고리별 식수 집계 (PAGE 7 세분화용)
    // monthCatMeals: { "1": { "cat_항암": 120, "cat_요양": 340, staff: 95, guardian: 30 }, ... }
    monthCatMeals: (() => {
      const result: Record<string, Record<string,number>> = {}
      for (let m = 1; m <= 12; m++) {
        const mStr = String(m)
        const custom = monthCustomTotals[mStr] || {}
        result[mStr] = {
          ...custom,
          staff: monthStaffTotals[mStr] || 0,
          guardian: monthGuardianTotals[mStr] || 0
        }
      }
      return result
    })(),
    // 카테고리 목록 (이름/키 매핑용)
    annualCats: (annualCats.results || []).map((c: any) => ({
      id: c.id, category_key: c.category_key, category_name: c.category_name
    }))
  })
})

// 관리자용 - 전체 병원 현황
dashboard.get('/admin/overview/:year/:month', async (c) => {
  const { year, month } = c.req.param()

  const hospitals = await c.env.DB.prepare(`SELECT * FROM hospitals ORDER BY id`).all<any>()

  // 주간 범위 계산 (월요일 기준)
  const nowDate = new Date()
  const dayOfWeek = nowDate.getDay()
  const weekStartDate = new Date(nowDate)
  weekStartDate.setDate(nowDate.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
  const weekEndDate = new Date(weekStartDate)
  weekEndDate.setDate(weekStartDate.getDate() + 6)
  const weekStartStr = weekStartDate.toISOString().split('T')[0]
  const weekEndStr = weekEndDate.toISOString().split('T')[0]
  const today = nowDate.toISOString().split('T')[0]

  // 조회 월이 현재 월인지 확인 (다른 월 조회 시 주간 데이터 의미 없음)
  const overviewNowYear = String(nowDate.getFullYear())
  const overviewNowMonth = String(nowDate.getMonth() + 1)
  const isOverviewCurrentMonth = (year === overviewNowYear && month === overviewNowMonth)
  
  const results = await Promise.all(
    (hospitals.results || []).map(async (h: any) => {
      const settings = await c.env.DB.prepare(
        `SELECT * FROM monthly_settings WHERE hospital_id = ? AND year = ? AND month = ?`
      ).bind(h.id, year, month).first<any>()

      const totalUsed = await c.env.DB.prepare(
        `SELECT COALESCE(SUM(total_amount), 0) as total
         FROM daily_orders
         WHERE hospital_id = ? AND strftime('%Y', order_date) = ? AND strftime('%m', order_date) = printf('%02d', ?)`
      ).bind(h.id, year, month).first<any>()

      const mealStats = await c.env.DB.prepare(
        `SELECT
           COALESCE(SUM(breakfast_patient + lunch_patient + dinner_patient), 0) as total_patient,
           COALESCE(SUM(breakfast_staff + lunch_staff + dinner_staff), 0) as total_staff,
           COALESCE(SUM(breakfast_noncovered + lunch_noncovered + dinner_noncovered), 0) as total_noncovered,
           COALESCE(SUM(breakfast_guardian + lunch_guardian + dinner_guardian), 0) as total_guardian
         FROM daily_meals
         WHERE hospital_id = ? AND strftime('%Y', meal_date) = ? AND strftime('%m', meal_date) = printf('%02d', ?)`
      ).bind(h.id, year, month).first<any>()

      // 커스텀 식수 합계 (ea 제외)
      const customFieldsList = await c.env.DB.prepare(
        `SELECT field_key FROM meal_custom_fields WHERE hospital_id = ? AND is_active = 1 AND unit_type != 'ea'`
      ).bind(h.id).all<any>()
      const mealCustomData = await c.env.DB.prepare(
        `SELECT custom_data FROM daily_meals WHERE hospital_id = ? AND strftime('%Y', meal_date) = ? AND strftime('%m', meal_date) = printf('%02d', ?) AND custom_data IS NOT NULL AND custom_data != '{}'`
      ).bind(h.id, year, month).all<any>()
      const customFieldTotals: Record<string, number> = {}
      ;(customFieldsList.results || []).forEach((f: any) => { customFieldTotals[f.field_key] = 0 })
      ;(mealCustomData.results || []).forEach((row: any) => {
        try {
          const cd = JSON.parse(row.custom_data || '{}')
          ;(customFieldsList.results || []).forEach((f: any) => {
            const fv = cd[f.field_key] || {}
            customFieldTotals[f.field_key] = (customFieldTotals[f.field_key] || 0) + (fv.bf || 0) + (fv.l || 0) + (fv.d || 0)
          })
        } catch(e) {}
      })
      const mealCustomTotal = Object.values(customFieldTotals).reduce((s: number, v: number) => s + v, 0)

      // 소모품 업체 발주 합계
      const supplyUsedRow = await c.env.DB.prepare(
        `SELECT COALESCE(SUM(d.total_amount), 0) as supply_used
         FROM daily_orders d JOIN vendors v ON d.vendor_id = v.id
         WHERE d.hospital_id = ? AND strftime('%Y', d.order_date) = ? AND strftime('%m', d.order_date) = printf('%02d', ?)
           AND v.category = 'supply'`
      ).bind(h.id, year, month).first<any>()
      const supplyUsed = supplyUsedRow?.supply_used || 0

      // 법인카드 합계
      const cardRow = await c.env.DB.prepare(
        `SELECT COALESCE(SUM(amount), 0) as total FROM card_expenses WHERE hospital_id = ? AND strftime('%Y', expense_date) = ? AND strftime('%m', expense_date) = printf('%02d', ?)`
      ).bind(h.id, year, month).first<any>()
      const cardUsed = cardRow?.total || 0

      // 오늘 발주
      const todayUsed = await c.env.DB.prepare(
        `SELECT COALESCE(SUM(total_amount), 0) as today_total FROM daily_orders WHERE hospital_id = ? AND order_date = ?`
      ).bind(h.id, today).first<any>()

      // 이번주 발주 (현재 월 조회 시에만 의미 있음, 해당 월 교집합만 집계)
      let weekUsedAmount = 0
      if (isOverviewCurrentMonth) {
        const mPadded2 = String(parseInt(month)).padStart(2,'0')
        const mLastDay2 = new Date(parseInt(year), parseInt(month), 0).getDate()
        const mDateStart2 = `${year}-${mPadded2}-01`
        const mDateEnd2   = `${year}-${mPadded2}-${String(mLastDay2).padStart(2,'0')}`
        const effWS = weekStartStr > mDateStart2 ? weekStartStr : mDateStart2
        const effWE = weekEndStr   < mDateEnd2   ? weekEndStr   : mDateEnd2
        const weekUsedRow = await c.env.DB.prepare(
          `SELECT COALESCE(SUM(total_amount), 0) as week_total FROM daily_orders WHERE hospital_id = ? AND order_date >= ? AND order_date <= ?`
        ).bind(h.id, effWS, effWE).first<any>()
        weekUsedAmount = weekUsedRow?.week_total || 0
      }

      const totalBudget = settings?.total_budget || 0
      const workingDays = settings?.working_days || new Date(parseInt(year), parseInt(month), 0).getDate()
      const dailyBudget = workingDays > 0 ? Math.round(totalBudget / workingDays) : 0
      // 주간 예산: 현재 월 조회 시에만 계산, 다른 월이면 0
      let weekBudget = 0
      if (isOverviewCurrentMonth) {
        const mStr2 = `${year}-${String(parseInt(month)).padStart(2,'0')}`
        let wDaysInMonth2 = 0
        for (let d2 = new Date(weekStartStr); d2 <= new Date(weekEndStr); d2.setDate(d2.getDate()+1)) {
          const ds2 = d2.toISOString().split('T')[0]
          if (ds2.startsWith(mStr2)) wDaysInMonth2++
        }
        if (wDaysInMonth2 === 0) wDaysInMonth2 = 5
        weekBudget = dailyBudget * wDaysInMonth2
      }
      const used = totalUsed?.total || 0
      const progress = totalBudget > 0 ? ((used / totalBudget) * 100).toFixed(1) : '0.0'

      // 식수 계산 (커스텀 필드 기반)
      const ms = mealStats || { total_patient: 0, total_staff: 0, total_noncovered: 0, total_guardian: 0 }
      const totalMealsForPrice = (ms.total_staff || 0) + (ms.total_guardian || 0) + mealCustomTotal
      const totalMealsAll = totalMealsForPrice  // 관리자 overview용

      // 식단가 3종 계산
      const mealPriceTotal = totalMealsAll > 0 ? Math.round(used / totalMealsAll) : 0
      const mealsNoStaff = totalMealsAll - (ms.total_staff || 0)
      const mealPriceNoStaff = mealsNoStaff > 0 ? Math.round(used / mealsNoStaff) : 0
      const supplyCardUsed = supplyUsed + cardUsed
      const mealPriceNoSupply = totalMealsAll > 0 ? Math.round((used - supplyCardUsed) / totalMealsAll) : 0

      return {
        hospital: h,
        totalBudget,
        totalUsed: used,
        progress,
        remaining: totalBudget - used,
        mealPrice: settings?.meal_price || 0,
        totalMeals: totalMealsAll,
        mealPriceTotal,
        mealPriceNoStaff,
        mealPriceNoSupply,
        todayUsed: isOverviewCurrentMonth ? (todayUsed?.today_total || 0) : 0,
        weekUsed: weekUsedAmount,
        dailyBudget: isOverviewCurrentMonth ? dailyBudget : 0,
        weekBudget
      }
    })
  )

  return c.json({ hospitals: results, year, month })
})

// ════════════════════════════════════════════════════════════════
// 영양사 대시보드: 인력 & 인건비 요약 API
// GET /api/dashboard/staff-labor/:year/:month
// ════════════════════════════════════════════════════════════════
dashboard.get('/staff-labor/:year/:month', async (c) => {
  const user = c.get('user')
  const { year, month } = c.req.param()
  const hospitalId = user.hospitalId || c.req.query('hospitalId')
  if (!hospitalId) return c.json({ error: 'Hospital not found' }, 400)

  const y = parseInt(year)
  const m = parseInt(month)

  // 1. 직원 수 (재직 중)
  const empCountRow = await c.env.DB.prepare(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN employment_type='full' THEN 1 ELSE 0 END) as full_time,
       SUM(CASE WHEN employment_type='part' THEN 1 ELSE 0 END) as part_time,
       SUM(CASE WHEN employment_type='contract' THEN 1 ELSE 0 END) as contract
     FROM employees WHERE hospital_id = ? AND is_active = 1`
  ).bind(hospitalId).first<any>()

  // 2. 이번 달 OT / 출근 집계
  const schedStats = await c.env.DB.prepare(
    `SELECT
       COUNT(DISTINCT employee_id) as active_emp,
       SUM(CASE WHEN is_overtime=1 THEN 1 ELSE 0 END) as ot_count,
       SUM(COALESCE(overtime_hours, 0)) as ot_hours,
       SUM(CASE WHEN shift_code NOT IN ('연차','반차','병가','경조','공가','휴','무급') THEN 1 ELSE 0 END) as work_days
     FROM daily_schedules
     WHERE hospital_id = ?
       AND strftime('%Y', work_date) = ?
       AND strftime('%m', work_date) = printf('%02d', ?)`
  ).bind(hospitalId, String(y), m).first<any>()

  // 3. 외부인력 현황
  const extStats = await c.env.DB.prepare(
    `SELECT ew.worker_type,
            COUNT(*) as day_count,
            COUNT(DISTINCT es.worker_id) as worker_count
     FROM external_schedules es
     JOIN external_workers ew ON ew.id = es.worker_id
     WHERE es.hospital_id = ?
       AND strftime('%Y', es.work_date) = ?
       AND strftime('%m', es.work_date) = printf('%02d', ?)
     GROUP BY ew.worker_type`
  ).bind(hospitalId, String(y), m).all<any>()
  const extMap: Record<string, { day_count: number; worker_count: number }> = {}
  ;(extStats.results || []).forEach((r: any) => { extMap[r.worker_type] = r })

  // 4. 인건비 단가
  const costRows = await c.env.DB.prepare(
    `SELECT cost_type, unit_price FROM labor_cost_settings WHERE hospital_id = ?`
  ).bind(hospitalId).all<any>()
  const costMap: Record<string, number> = {}
  ;(costRows.results || []).forEach((r: any) => { costMap[r.cost_type] = r.unit_price || 0 })

  // 5. 파출/알바 인건비
  const extCostRows = await c.env.DB.prepare(
    `SELECT es.shift_type, es.unit_price, ew.worker_type
     FROM external_schedules es
     JOIN external_workers ew ON ew.id = es.worker_id
     WHERE es.hospital_id = ?
       AND strftime('%Y', es.work_date) = ?
       AND strftime('%m', es.work_date) = printf('%02d', ?)`
  ).bind(hospitalId, String(y), m).all<any>()

  // BUGFIX: DB 실제 저장값은 full_9h/full_12h (구 키 '9h'/'12h'는 미사용 dead key).
  //         executive.ts P1 수정과 동일하게 full_9h/full_12h 매핑 추가 (additive).
  const dispatchShiftMap: Record<string, string> = {
    morning:'dispatch_morning', afternoon:'dispatch_afternoon',
    '9h':'dispatch_9h', '12h':'dispatch_12h',
    full_9h:'dispatch_9h', full_12h:'dispatch_12h',   // BUGFIX
  }
  const partShiftMap:     Record<string, string> = {
    morning:'parttime_morning',  afternoon:'parttime_afternoon',
    '9h':'parttime_9h',  '12h':'parttime_12h',
    full_9h:'parttime_9h', full_12h:'parttime_12h',   // BUGFIX
  }

  let dispatchCost = 0, parttimeCost = 0
  ;(extCostRows.results || []).forEach((e: any) => {
    const price = e.unit_price > 0
      ? e.unit_price
      : e.worker_type === 'dispatch'
        ? (costMap[dispatchShiftMap[e.shift_type] || ''] || 0)
        : (costMap[partShiftMap[e.shift_type]     || ''] || 0)
    if (e.worker_type === 'dispatch') dispatchCost += price
    else parttimeCost += price
  })

  // 6. 기본급 합계 (salary_type 반영: annual=연봉÷12, monthly=월급, hourly=별도)
  const salaryRows = await c.env.DB.prepare(
    `SELECT base_salary, salary_type FROM employees WHERE hospital_id=? AND is_active=1`
  ).bind(hospitalId).all<any>()

  let baseSalary = 0
  ;(salaryRows.results || []).forEach((r: any) => {
    const sal = r.base_salary || 0
    if (r.salary_type === 'annual') baseSalary += Math.round(sal / 12)
    else if (r.salary_type === 'monthly') baseSalary += sal
    // hourly: 기본급 0으로 처리 (시간 기록 기반 별도 계산 필요)
  })
  const totalLaborCost = baseSalary + dispatchCost + parttimeCost

  return c.json({
    period: { year: y, month: m },
    staffSummary: {
      total:      empCountRow?.total    || 0,
      fullTime:   empCountRow?.full_time || 0,
      partTime:   empCountRow?.part_time || 0,
      contract:   empCountRow?.contract  || 0,
      activeThisMonth: schedStats?.active_emp || 0,
    },
    workSummary: {
      workDays: schedStats?.work_days || 0,
      otCount:  schedStats?.ot_count  || 0,
      otHours:  schedStats?.ot_hours  || 0,
    },
    externalSummary: {
      dispatchDays:        extMap['dispatch']?.day_count    || 0,
      dispatchWorkerCount: extMap['dispatch']?.worker_count || 0,
      parttimeDays:        extMap['parttime']?.day_count    || 0,
      parttimeWorkerCount: extMap['parttime']?.worker_count || 0,
    },
    laborCost: {
      baseSalary,
      dispatchCost,
      parttimeCost,
      total: totalLaborCost,
    },
  })
})

export default dashboard
