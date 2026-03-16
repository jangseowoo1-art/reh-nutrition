import { Hono } from 'hono'

const dashboard = new Hono<{ Bindings: { DB: D1Database } }>()

// 월별 대시보드 요약
dashboard.get('/summary/:year/:month', async (c) => {
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

  // 업체별 발주 합계
  const vendors = await c.env.DB.prepare(
    `SELECT v.id, v.name, v.category, v.tax_type, v.monthly_budget,
            COALESCE(SUM(d.taxable_amount), 0) as total_taxable,
            COALESCE(SUM(d.exempt_amount), 0) as total_exempt,
            COALESCE(SUM(d.vat_amount), 0) as total_vat,
            COALESCE(SUM(d.total_amount), 0) as total_used
     FROM vendors v
     LEFT JOIN daily_orders d ON v.id = d.vendor_id 
       AND strftime('%Y', d.order_date) = ? 
       AND strftime('%m', d.order_date) = printf('%02d', ?)
     WHERE v.hospital_id = ? AND v.is_active = 1
     GROUP BY v.id
     ORDER BY v.sort_order`
  ).bind(year, month, hospitalId).all<any>()

  // 일별 총 발주액
  const dailyOrders = await c.env.DB.prepare(
    `SELECT order_date, SUM(total_amount) as daily_total
     FROM daily_orders
     WHERE hospital_id = ? 
       AND strftime('%Y', order_date) = ?
       AND strftime('%m', order_date) = printf('%02d', ?)
     GROUP BY order_date
     ORDER BY order_date`
  ).bind(hospitalId, year, month).all<any>()

  // 식수 합계
  const mealStats = await c.env.DB.prepare(
    `SELECT 
       COALESCE(SUM(breakfast_patient + lunch_patient + dinner_patient), 0) as total_patient,
       COALESCE(SUM(breakfast_staff + lunch_staff + dinner_staff), 0) as total_staff,
       COALESCE(SUM(breakfast_noncovered + lunch_noncovered + dinner_noncovered), 0) as total_noncovered,
       COALESCE(SUM(breakfast_guardian + lunch_guardian + dinner_guardian), 0) as total_guardian,
       COUNT(*) as days_entered
     FROM daily_meals
     WHERE hospital_id = ?
       AND strftime('%Y', meal_date) = ?
       AND strftime('%m', meal_date) = printf('%02d', ?)`
  ).bind(hospitalId, year, month).first<any>()

  // 커스텀 식수 필드 목록 + 월별 custom_data 합계 계산
  const customFieldsList = await c.env.DB.prepare(
    `SELECT * FROM meal_custom_fields WHERE hospital_id = ? AND is_active = 1 ORDER BY sort_order, id`
  ).bind(hospitalId).all<any>()

  const mealCustomData = await c.env.DB.prepare(
    `SELECT custom_data FROM daily_meals
     WHERE hospital_id = ?
       AND strftime('%Y', meal_date) = ?
       AND strftime('%m', meal_date) = printf('%02d', ?)
       AND custom_data IS NOT NULL AND custom_data != '{}'`
  ).bind(hospitalId, year, month).all<any>()

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
  // ea 단위 필드는 식수 합산에서 제외 (unit_type='ea')
  const mealCustomTotal = (customFieldsList.results || [])
    .filter((f: any) => f.unit_type !== 'ea')
    .reduce((s: number, f: any) => s + (customFieldTotals[f.field_key] || 0), 0)


  const today = new Date().toISOString().split('T')[0]
  const todayOrders = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(total_amount), 0) as today_total
     FROM daily_orders WHERE hospital_id = ? AND order_date = ?`
  ).bind(hospitalId, today).first<any>()

  // 이번 주 발주액 (일요일 기준)
  const nowDate = new Date()
  const dayOfWeek = nowDate.getDay()
  const weekStart = new Date(nowDate)
  weekStart.setDate(nowDate.getDate() - dayOfWeek)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  const weekStartStr = weekStart.toISOString().split('T')[0]
  const weekEndStr = weekEnd.toISOString().split('T')[0]

  const weekOrders = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(total_amount), 0) as week_total
     FROM daily_orders WHERE hospital_id = ? AND order_date >= ? AND order_date <= ?`
  ).bind(hospitalId, weekStartStr, weekEndStr).first<any>()

  const totalUsed = vendors.results?.reduce((sum: number, v: any) => sum + v.total_used, 0) || 0
  const totalBudget = settings?.total_budget || 0
  const eventBudget = settings?.event_budget || 0
  const workingDays = settings?.working_days || 30
  const progress = totalBudget > 0 ? ((totalUsed / totalBudget) * 100).toFixed(2) : '0.00'
  
  // 일/주/월 목표
  const dailyBudget = workingDays > 0 ? Math.round(totalBudget / workingDays) : 0
  const weeklyBudget = dailyBudget * 7

  // 예산 초과 업체
  const overBudgetVendors = (vendors.results || []).filter((v: any) => 
    v.monthly_budget > 0 && v.total_used > v.monthly_budget
  )

  // 식단가 3종 계산
  const ms = mealStats || { total_patient:0, total_staff:0, total_noncovered:0, total_guardian:0 }
  // 화면 표시용 전체 식수: 비급여 제외, 환자(patient) 제외(환자군 커스텀 필드로 대체) - 직원+보호자+커스텀
  const totalMeals = (ms.total_staff||0) + (ms.total_guardian||0) + mealCustomTotal
  // 식단가 계산용 식수: 비급여 제외, 환자 제외 → 직원+보호자+환자군(커스텀, ea 제외)
  const totalMealsForPrice = (ms.total_staff||0) + (ms.total_guardian||0) + mealCustomTotal
  // 소모품/카드 제외 금액
  const supplyCardUsed = (vendors.results || [])
    .filter((v: any) => v.category === 'supply' || v.category === 'card')
    .reduce((s: number, v: any) => s + v.total_used, 0)
  // ① 전체 식단가: 총금액 ÷ (환자+직원+보호자) — 비급여 제외
  const mealPriceTotal = totalMealsForPrice > 0 ? Math.round(totalUsed / totalMealsForPrice) : 0
  // ② 직원식 제외 식단가:
  //    의의: 직원식에 든 예산이 자동 수식에 포함되므로,
  //    분모만 직원식수를 제외 → 화자 1인당 실질 식리 확인 가능
  //    분자: 월 총 발주금액 그대로
  //    분모: 환자 + 보호자 (직원식수 제외)
  //    예: 아미나 20,880,000원 ÷ 110명 = 189,818원/식 (전체 130,500원보다 높음)
  const mealsNoStaff = (ms.total_guardian||0) + mealCustomTotal  // 보호자 + 환자군 (직원 제외)
  const mealPriceNoStaff = mealsNoStaff > 0
    ? Math.round(totalUsed / mealsNoStaff) : 0
  // ③ 소모품/카드 제외 식단가: (총금액 - 소모품/카드) ÷ (환자+직원+보호자) — 비급여 제외
  const mealPriceNoSupply = totalMealsForPrice > 0
    ? Math.round((totalUsed - supplyCardUsed) / totalMealsForPrice) : 0

  // 전월 식단가 비교용 데이터
  const prevMonth = parseInt(month) === 1 ? 12 : parseInt(month) - 1
  const prevYear2 = parseInt(month) === 1 ? String(parseInt(year) - 1) : year
  const prevMealStats = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(breakfast_patient+lunch_patient+dinner_patient),0) as total_patient,
            COALESCE(SUM(breakfast_staff+lunch_staff+dinner_staff),0) as total_staff,
            COALESCE(SUM(breakfast_noncovered+lunch_noncovered+dinner_noncovered),0) as total_noncovered,
            COALESCE(SUM(breakfast_guardian+lunch_guardian+dinner_guardian),0) as total_guardian
     FROM daily_meals WHERE hospital_id=? AND strftime('%Y',meal_date)=? AND strftime('%m',meal_date)=printf('%02d',?)`
  ).bind(hospitalId, prevYear2, prevMonth).first<any>()

  const prevOrders = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(total_amount),0) as total_used FROM daily_orders
     WHERE hospital_id=? AND strftime('%Y',order_date)=? AND strftime('%m',order_date)=printf('%02d',?)`
  ).bind(hospitalId, prevYear2, prevMonth).first<any>()

  const prevSupply = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(d.total_amount),0) as supply_used
     FROM daily_orders d JOIN vendors v ON d.vendor_id=v.id
     WHERE d.hospital_id=? AND strftime('%Y',d.order_date)=? AND strftime('%m',d.order_date)=printf('%02d',?)
       AND (v.category='supply' OR v.category='card')`
  ).bind(hospitalId, prevYear2, prevMonth).first<any>()

  const prevSettings = await c.env.DB.prepare(
    `SELECT total_budget, meal_price FROM monthly_settings WHERE hospital_id=? AND year=? AND month=?`
  ).bind(hospitalId, prevYear2, prevMonth).first<any>()

  // ── 카테고리별 식단가 계산 ──────────────────────────────────
  const patientCatsDash = await c.env.DB.prepare(`
    SELECT * FROM hospital_patient_categories
    WHERE hospital_id = ? AND is_active = 1
    ORDER BY sort_order, id
  `).bind(hospitalId).all<any>()

  const catMonthlyOrders = await c.env.DB.prepare(`
    SELECT patient_category_id, COALESCE(SUM(total_amount), 0) as total
    FROM daily_orders
    WHERE hospital_id = ?
      AND patient_category_id IS NOT NULL
      AND strftime('%Y', order_date) = ?
      AND strftime('%m', order_date) = printf('%02d', ?)
    GROUP BY patient_category_id
  `).bind(hospitalId, year, month).all<any>()

  const catTodayOrders = await c.env.DB.prepare(`
    SELECT patient_category_id, COALESCE(SUM(total_amount), 0) as total
    FROM daily_orders
    WHERE hospital_id = ?
      AND patient_category_id IS NOT NULL
      AND order_date = ?
    GROUP BY patient_category_id
  `).bind(hospitalId, today).all<any>()

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

  // 오늘 식수: 커스텀 필드(환자군)의 식수 합산
  const todayMealRow = await c.env.DB.prepare(`
    SELECT COALESCE(breakfast_staff,0)+COALESCE(lunch_staff,0)+COALESCE(dinner_staff,0) as staff_total,
           COALESCE(breakfast_guardian,0)+COALESCE(lunch_guardian,0)+COALESCE(dinner_guardian,0) as guardian_total,
           custom_data
    FROM daily_meals WHERE hospital_id = ? AND meal_date = ?
  `).bind(hospitalId, today).first<any>()

  // 오늘 전체 식수: 직원+보호자+환자군 커스텀
  let todayCustomMeals = 0
  if (todayMealRow?.custom_data) {
    try {
      const todayCustomData = JSON.parse(todayMealRow.custom_data || '{}')
      ;(customFieldsList.results || []).filter((f:any) => f.unit_type !== 'ea').forEach((f:any) => {
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
  const catSetMap3: Record<number, any> = {}
  ;(catSettingsDash.results||[]).forEach((s3:any) => { catSetMap3[s3.patient_category_id] = s3 })
  const prevCatSetMap3: Record<number, any> = {}
  ;(prevCatSettingsDash.results||[]).forEach((s3:any) => { prevCatSetMap3[s3.patient_category_id] = s3 })

  const totalCatBudgetDash = (catSettingsDash.results||[]).reduce((s3:number, c3:any) => s3+(c3.monthly_budget||0), 0)

  // ── 카테고리별 식단가 독립 계산을 위한 헬퍼 ────────────────────
  // meals_include_keys: ['staff','guardian','cat_cancer','cat_nursing'] 중 선택
  // budget_include_keys: ['cancer','nursing',...] = category_key 목록 (해당 카테고리 발주금액 합산)
  //
  // buildMealsFromKeys: 특정 키 목록에 해당하는 식수 합계 반환
  //   mealStatsRow: { total_staff, total_guardian }
  //   customTotalsMap: { cat_cancer: N, cat_nursing: N, ... }  (month 또는 today용)
  // ⚠️ 비급여(noncovered)는 식단가 계산 분모에서 항상 제외 — 별도 선택 불가
  const buildMealsFromKeys = (mealsKeys: string[], mealStatsRow: {total_staff?:number,total_guardian?:number}|null, customTotalsMap: Record<string,number>): number => {
    if (!mealsKeys || mealsKeys.length === 0) return 0
    let total = 0
    if (mealsKeys.includes('staff')) total += (mealStatsRow?.total_staff || 0)
    if (mealsKeys.includes('guardian')) total += (mealStatsRow?.total_guardian || 0)
    // noncovered는 명시적으로 제외 (설정에 포함되어 있어도 무시)
    mealsKeys.filter(k => k.startsWith('cat_')).forEach(k => { total += (customTotalsMap[k] || 0) })
    return total
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
    const targetPrice = s3.target_meal_price || 0
    const monthBudget = s3.monthly_budget || 0
    const workDays = s3.working_days || workingDays
    const catRatio = totalCatBudgetDash > 0 ? (monthBudget / totalCatBudgetDash) : (1 / Math.max((patientCatsDash.results||[]).length, 1))

    // formula 설정 파싱
    let budgetKeys: string[] = []
    let mealsKeys: string[] = []
    try { budgetKeys = JSON.parse(cat.budget_include_keys || 'null') || [] } catch(e) {}
    try { mealsKeys = JSON.parse(cat.meals_include_keys || 'null') || [] } catch(e) {}

    // formula 설정이 없으면 기존 방식 (해당 카테고리 발주 ÷ 카테고리+직원+보호자)
    const hasFormula = budgetKeys.length > 0 || mealsKeys.length > 0

    // ── 이번 달 발주금액 계산 (budget_include_keys 기반) ──
    let monthAmt: number
    if (hasFormula && budgetKeys.length > 0) {
      monthAmt = budgetKeys.reduce((sum: number, key: string) => {
        const catId = catKeyToIdMap[key]
        return sum + (catId ? (catMonthMap2[catId] || 0) : 0)
      }, 0)
    } else {
      monthAmt = catMonthMap2[cat.id] || 0
    }

    // ── 이번 달 식수 계산 (meals_include_keys 기반) ──
    let monthMeals: number
    if (hasFormula && mealsKeys.length > 0) {
      monthMeals = buildMealsFromKeys(mealsKeys, monthMealStatsRow, customFieldTotals)
    } else {
      // 기존 방식: 카테고리 식수 + 직원 + 보호자
      const defaultCatKey = `cat_${cat.category_key}`
      monthMeals = (customFieldTotals[defaultCatKey] || 0) + (ms.total_staff||0) + (ms.total_guardian||0)
    }

    // ── 이번 달 식단가 계산 ──
    const monthDietPrice = monthMeals > 0 ? Math.round(monthAmt / monthMeals) : 0

    // ── 오늘 발주금액 계산 (budget_include_keys 기반) ──
    let todayAmt: number
    if (hasFormula && budgetKeys.length > 0) {
      todayAmt = budgetKeys.reduce((sum: number, key: string) => {
        const catId = catKeyToIdMap[key]
        return sum + (catId ? (catTodayMap2[catId] || 0) : 0)
      }, 0)
    } else {
      todayAmt = catTodayMap2[cat.id] || 0
    }

    // ── 오늘 식수 계산 (meals_include_keys 기반) ──
    let todayCatMeals: number
    if (hasFormula && mealsKeys.length > 0) {
      todayCatMeals = buildMealsFromKeys(mealsKeys, todayMealStatsRow, todayCatCustomMap)
    } else {
      // 기존 방식: 카테고리 식수 + 직원 + 보호자
      const defaultCatKey = `cat_${cat.category_key}`
      todayCatMeals = (todayCatCustomMap[defaultCatKey] || 0) + (todayMealRow?.staff_total || 0) + (todayMealRow?.guardian_total || 0)
    }

    const todayDietPrice = todayCatMeals > 0 ? Math.round(todayAmt / todayCatMeals) : 0
    const prevSet = prevCatSetMap3[cat.id] || {}
    const prevTargetPrice = prevSet.target_meal_price || 0
    const prevMonthBudget = prevSet.monthly_budget || 0
    return {
      id: cat.id, category_key: cat.category_key, category_name: cat.category_name,
      monthAmt, todayAmt, monthBudget, targetPrice, workDays,
      monthMeals, monthDietPrice,
      todayCatMeals, todayDietPrice, catRatio,
      prevTargetPrice, prevMonthBudget,
      budgetKeys, mealsKeys
    }
  })

  // 전월 식단가 계산 (현재 월과 동일 로직)
  const pms = prevMealStats || { total_patient:0, total_staff:0, total_noncovered:0, total_guardian:0 }
  // 전월 총식수: 비급여 제외, 환자 제외(환자군 커스텀으로 대체)
  const prevTotalMeals = (pms.total_staff||0)+(pms.total_guardian||0)
  // 전월 식단가 계산용 식수: 비급여 제외, 환자 제외 (전월 커스텀 필드 합계는 별도 조회 필요하지만 간소화)
  const prevMealsForPrice = (pms.total_staff||0)+(pms.total_guardian||0)
  const prevTotalUsed = prevOrders?.total_used || 0
  const prevSupplyUsed = prevSupply?.supply_used || 0
  // ① 전월 전체 식단가
  const prevMealPriceTotal = prevMealsForPrice > 0 ? Math.round(prevTotalUsed / prevMealsForPrice) : 0
  // ② 전월 직원식 제외: 총금액 ÷ (환자+보호자) — 분모에서만 직원식수 제외
  const prevMealsNoStaff = (pms.total_guardian||0)  // 보호자만 (직원+환자 제외)
  const prevMealPriceNoStaff = prevMealsNoStaff > 0
    ? Math.round(prevTotalUsed / prevMealsNoStaff) : 0
  // ③ 전월 소모품 제외 (비급여 제외 분모)
  const prevMealPriceNoSupply = prevMealsForPrice > 0
    ? Math.round((prevTotalUsed - prevSupplyUsed) / prevMealsForPrice) : 0

  // ── formula 기반 가중평균 전체 식단가 계산 ──────────────────────
  // 카테고리가 있는 병원: 예산 비중 가중평균으로 전체 식단가 계산
  // - 카테고리 1개: 해당 카테고리 식단가 = 전체 식단가
  // - 카테고리 2개 이상: (각 카테고리 식단가 × 예산비중) 합산
  let formulaMealPriceTotal = mealPriceTotal  // 기본값: 기존 계산
  const activeCatDietPrices = catDietPrices.filter(c => c.monthDietPrice > 0 && c.monthAmt > 0)
  if (activeCatDietPrices.length === 1) {
    // 카테고리 1개: 해당 카테고리 식단가 = 전체 식단가
    formulaMealPriceTotal = activeCatDietPrices[0].monthDietPrice
  } else if (activeCatDietPrices.length >= 2) {
    // 카테고리 2개 이상: 예산(발주금액) 비중 가중평균
    const totalCatAmt = activeCatDietPrices.reduce((s, c) => s + c.monthAmt, 0)
    if (totalCatAmt > 0) {
      formulaMealPriceTotal = Math.round(
        activeCatDietPrices.reduce((s, c) => s + (c.monthDietPrice * (c.monthAmt / totalCatAmt)), 0)
      )
    }
  }

  return c.json({
    settings,
    vendors: vendors.results,
    dailyOrders: dailyOrders.results,
    mealStats,
    mealCustomFields: customFieldsList.results || [],
    mealCustomTotals: customFieldTotals,
    overBudgetVendors,
    mealPriceTotal: formulaMealPriceTotal,  // formula 기반 가중평균 (카테고리 없으면 기존 방식)
    mealPriceRaw: mealPriceTotal,            // 기존 총발주÷총식수 방식 (참고용)
    mealPriceNoStaff,
    mealPriceNoSupply,
    totalMeals,
    catDietPrices,
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
    summary: {
      totalUsed,
      totalBudget,
      eventBudget,
      totalWithEvent: totalBudget + eventBudget,
      progress,
      remaining: totalBudget - totalUsed,
      dailyBudget,
      weeklyBudget,
      todayUsed: todayOrders?.today_total || 0,
      weekUsed: weekOrders?.week_total || 0,
      todayProgress: dailyBudget > 0 ? ((todayOrders?.today_total || 0) / dailyBudget * 100).toFixed(1) : '0.0',
      weekProgress: weeklyBudget > 0 ? ((weekOrders?.week_total || 0) / weeklyBudget * 100).toFixed(1) : '0.0'
    }
  })
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
    try { budgetKeys = JSON.parse(cat.budget_include_keys || 'null') || [] } catch(e) {}
    try { mealsKeys = JSON.parse(cat.meals_include_keys || 'null') || [] } catch(e) {}
    const hasFormula = budgetKeys.length > 0 || mealsKeys.length > 0

    const monthlyDietPrices: Array<{month: number, monthAmt: number, monthMeals: number, dietPrice: number}> = []
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
      // 식수
      let monthMeals: number
      const mCustom = monthCustomTotals[mStr] || {}
      const mStaff = monthStaffTotals[mStr] || 0
      const mGuardian = monthGuardianTotals[mStr] || 0
      if (hasFormula && mealsKeys.length > 0) {
        let total = 0
        if (mealsKeys.includes('staff')) total += mStaff
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
      monthlyDietPrices.push({ month: m, monthAmt, monthMeals, dietPrice })
    }
    return {
      id: cat.id,
      category_key: cat.category_key,
      category_name: cat.category_name,
      monthlyBudget: cat.monthly_budget || 0,
      budgetKeys,
      mealsKeys,
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
    annualCatDietPrices: annualCatDietPrices || []
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
        `SELECT COALESCE(SUM(
           breakfast_patient + lunch_patient + dinner_patient +
           breakfast_staff + lunch_staff + dinner_staff +
           breakfast_noncovered + lunch_noncovered + dinner_noncovered +
           breakfast_guardian + lunch_guardian + dinner_guardian), 0) as total_meals
         FROM daily_meals
         WHERE hospital_id = ? AND strftime('%Y', meal_date) = ? AND strftime('%m', meal_date) = printf('%02d', ?)`
      ).bind(h.id, year, month).first<any>()

      // 오늘 발주
      const todayUsed = await c.env.DB.prepare(
        `SELECT COALESCE(SUM(total_amount), 0) as today_total FROM daily_orders WHERE hospital_id = ? AND order_date = ?`
      ).bind(h.id, today).first<any>()

      // 이번주 발주
      const weekUsed = await c.env.DB.prepare(
        `SELECT COALESCE(SUM(total_amount), 0) as week_total FROM daily_orders WHERE hospital_id = ? AND order_date >= ? AND order_date <= ?`
      ).bind(h.id, weekStartStr, weekEndStr).first<any>()

      const totalBudget = settings?.total_budget || 0
      const workingDays = settings?.working_days || new Date(parseInt(year), parseInt(month), 0).getDate()
      const dailyBudget = workingDays > 0 ? Math.round(totalBudget / workingDays) : 0
      const weekBudget = dailyBudget * 5
      const used = totalUsed?.total || 0
      const progress = totalBudget > 0 ? ((used / totalBudget) * 100).toFixed(1) : '0.0'

      return {
        hospital: h,
        totalBudget,
        totalUsed: used,
        progress,
        remaining: totalBudget - used,
        mealPrice: settings?.meal_price || 0,
        totalMeals: mealStats?.total_meals || 0,
        todayUsed: todayUsed?.today_total || 0,
        weekUsed: weekUsed?.week_total || 0,
        dailyBudget,
        weekBudget
      }
    })
  )

  return c.json({ hospitals: results, year, month })
})

export default dashboard
