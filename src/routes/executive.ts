import { Hono } from 'hono'

const executive = new Hono<{ Bindings: { DB: D1Database }; Variables: { user: any } }>()

// ── 운영진 권한 체크 미들웨어 ─────────────────────────────────────
executive.use('/*', async (c, next) => {
  const user = c.get('user')
  if (!user || (user.role !== 'executive' && user.role !== 'admin')) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  return next()
})

// ── 운영진 대시보드 종합 요약 ─────────────────────────────────────
executive.get('/summary/:year/:month', async (c) => {
  const user = c.get('user')
  const { year, month } = c.req.param()
  // 관리자는 hospitalId 쿼리 파라미터로 지정, 운영진은 자신의 병원
  const hospitalId = user.role === 'admin'
    ? (c.req.query('hospitalId') || user.hospitalId)
    : user.hospitalId

  if (!hospitalId) return c.json({ error: 'Hospital not found' }, 400)

  // 1. 병원 기본 정보
  const hospital = await c.env.DB.prepare(
    `SELECT h.*, hi.dietitian_name, hi.admin_memo
     FROM hospitals h
     LEFT JOIN hospital_info hi ON hi.hospital_id = h.id
     WHERE h.id = ?`
  ).bind(hospitalId).first<any>()

  // 2. 월 예산/설정
  const settings = await c.env.DB.prepare(
    `SELECT * FROM monthly_settings WHERE hospital_id = ? AND year = ? AND month = ?`
  ).bind(hospitalId, year, month).first<any>()

  // 3. 총 발주금액
  const totalUsedRow = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(total_amount),0) as total
     FROM daily_orders
     WHERE hospital_id = ?
       AND strftime('%Y', order_date) = ?
       AND strftime('%m', order_date) = printf('%02d', ?)`
  ).bind(hospitalId, year, month).first<any>()
  const totalUsed = totalUsedRow?.total || 0

  // 4. 업체별 발주 현황
  const vendorOrders = await c.env.DB.prepare(
    `SELECT v.id, v.name, v.category,
            COALESCE(SUM(d.total_amount), 0) as total_used,
            v.monthly_budget
     FROM vendors v
     LEFT JOIN daily_orders d ON d.vendor_id = v.id
       AND d.hospital_id = ?
       AND strftime('%Y', d.order_date) = ?
       AND strftime('%m', d.order_date) = printf('%02d', ?)
     WHERE v.hospital_id = ? AND v.is_active = 1
     GROUP BY v.id
     ORDER BY total_used DESC`
  ).bind(hospitalId, year, month, hospitalId).all<any>()

  // 5. 식수 현황
  const mealStats = await c.env.DB.prepare(
    `SELECT
       COALESCE(SUM(breakfast_patient+lunch_patient+dinner_patient),0) as total_patient,
       COALESCE(SUM(breakfast_staff+lunch_staff+dinner_staff),0) as total_staff,
       COALESCE(SUM(breakfast_guardian+lunch_guardian+dinner_guardian),0) as total_guardian,
       COUNT(*) as days_entered
     FROM daily_meals
     WHERE hospital_id = ?
       AND strftime('%Y', meal_date) = ?
       AND strftime('%m', meal_date) = printf('%02d', ?)`
  ).bind(hospitalId, year, month).first<any>()

  // 커스텀 식수 (diet_categories 기반) - dashboard.ts와 동일 기준
  // unit_type 필터 제거: meal_custom_fields 전체 조회 (ea도 field_key 맵에 포함 필요)
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
  const customFieldTotals: Record<string, number> = {}
  ;(customFieldsList.results || []).forEach((f: any) => { customFieldTotals[f.field_key] = 0 })
  ;(mealCustomData.results || []).forEach((row: any) => {
    try {
      const cd = JSON.parse(row.custom_data || '{}')
      ;(customFieldsList.results || []).forEach((f: any) => {
        const fv = cd[f.field_key] || {}
        customFieldTotals[f.field_key] = (customFieldTotals[f.field_key]||0) + (fv.bf||0) + (fv.l||0) + (fv.d||0)
      })
    } catch(e) {}
  })
  // meals_include_keys 기반으로 포함할 field_key 구성 (dashboard.ts와 동일 로직)
  const patientCatsForExec = await c.env.DB.prepare(
    `SELECT id, category_key, meals_include_keys FROM hospital_patient_categories WHERE hospital_id = ? AND is_active = 1 ORDER BY sort_order, id`
  ).bind(hospitalId).all<any>()
  const execAllMealsIncludeKeys = new Set<string>()
  ;(patientCatsForExec.results || []).forEach((cat: any) => {
    try {
      const keys: string[] = JSON.parse(cat.meals_include_keys || '[]')
      keys.forEach((k: string) => execAllMealsIncludeKeys.add(k))
    } catch(e) {}
  })
  const execMealsIncludeFieldKeys = new Set<string>()
  if (execAllMealsIncludeKeys.size > 0) {
    ;(customFieldsList.results || []).forEach((f: any) => {
      const fk: string = f.field_key
      if (execAllMealsIncludeKeys.has(fk)) { execMealsIncludeFieldKeys.add(fk); return }
      if (execAllMealsIncludeKeys.has('cat_' + fk)) { execMealsIncludeFieldKeys.add(fk); return }
      for (const prefix of ['nc_key_', 'th_key_', 'st_key_']) {
        const dietKey = fk.startsWith('diet_') ? fk.slice('diet_'.length) : fk
        if (execAllMealsIncludeKeys.has(prefix + dietKey)) { execMealsIncludeFieldKeys.add(fk); return }
      }
    })
  }
  const execHasIncludeKeys = execAllMealsIncludeKeys.size > 0
  const mealCustomTotal = (customFieldsList.results || [])
    .filter((f: any) => {
      if (f.unit_type === 'ea') return false
      if (execHasIncludeKeys) return execMealsIncludeFieldKeys.has(f.field_key)
      return true
    })
    .reduce((s: number, f: any) => s + (customFieldTotals[f.field_key] || 0), 0)
  const totalMeals = (mealStats?.total_staff||0) + (mealStats?.total_guardian||0) + mealCustomTotal

  // 6. 법인카드 내역
  const cardExpenses = await c.env.DB.prepare(
    `SELECT * FROM card_expenses
     WHERE hospital_id = ?
       AND strftime('%Y', expense_date) = ?
       AND strftime('%m', expense_date) = printf('%02d', ?)
     ORDER BY expense_date DESC`
  ).bind(hospitalId, year, month).all<any>()
  const cardTotal = (cardExpenses.results || []).reduce((s: number, e: any) => s + (e.amount||0), 0)

  // 7. 지출결의서 목록
  const transactions = await c.env.DB.prepare(
    `SELECT id, document_number, document_date, vendor_name, total_amount, memo, created_at
     FROM transaction_documents
     WHERE hospital_id = ?
       AND document_year = ?
       AND document_month = ?
     ORDER BY document_date DESC`
  ).bind(hospitalId, year, month).all<any>()

  // 8. 납품 현황 (이번 달 발주 일자별)
  const schedules = await c.env.DB.prepare(
    `SELECT d.order_date as delivery_date, v.name as vendor_name,
            COALESCE(SUM(d.total_amount),0) as total_amount,
            COUNT(*) as order_count
     FROM daily_orders d
     LEFT JOIN vendors v ON d.vendor_id = v.id
     WHERE d.hospital_id = ?
       AND strftime('%Y', d.order_date) = ?
       AND strftime('%m', d.order_date) = printf('%02d', ?)
     GROUP BY d.order_date, v.id
     ORDER BY d.order_date ASC`
  ).bind(hospitalId, year, month).all<any>()

  // 9. 전월 비교용
  const prevMonth = parseInt(month) === 1 ? 12 : parseInt(month) - 1
  const prevYear = parseInt(month) === 1 ? String(parseInt(year) - 1) : year
  const prevUsedRow = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(total_amount),0) as total FROM daily_orders
     WHERE hospital_id=? AND strftime('%Y',order_date)=? AND strftime('%m',order_date)=printf('%02d',?)`
  ).bind(hospitalId, prevYear, prevMonth).first<any>()
  const prevSettings = await c.env.DB.prepare(
    `SELECT total_budget, meal_price FROM monthly_settings WHERE hospital_id=? AND year=? AND month=?`
  ).bind(hospitalId, prevYear, prevMonth).first<any>()

  // 10. 예산 소진율
  const totalBudget = settings?.total_budget || 0
  const progress = totalBudget > 0 ? parseFloat(((totalUsed / totalBudget) * 100).toFixed(1)) : 0
  const remaining = totalBudget - totalUsed

  // 11. 식단가 (dashboard.ts와 동일한 카테고리 기반 formula 적용)
  const targetMealPrice = settings?.meal_price || 0

  // 12. 카테고리별 발주 현황
  const catOrders = await c.env.DB.prepare(
    `SELECT hpc.id, hpc.category_name, hpc.category_key, hpc.meals_include_keys,
            COALESCE(SUM(do.total_amount), 0) as total
     FROM hospital_patient_categories hpc
     LEFT JOIN daily_orders do ON do.patient_category_id = hpc.id
       AND do.hospital_id = ?
       AND strftime('%Y', do.order_date) = ?
       AND strftime('%m', do.order_date) = printf('%02d', ?)
     WHERE hpc.hospital_id = ? AND hpc.is_active = 1
     GROUP BY hpc.id ORDER BY hpc.sort_order`
  ).bind(hospitalId, year, month, hospitalId).all<any>()

  // 카테고리별 월 식수 집계 (customFieldTotals 기반, meals_include_keys 적용)
  // buildMealsFromKeys 인라인 구현 (dashboard.ts의 buildMealsFromKeys와 동일)
  const execBuildMealsFromKeys = (
    mealsKeys: string[],
    staffTotal: number,
    guardianTotal: number,
    cfTotals: Record<string, number>
  ): number => {
    if (!mealsKeys || mealsKeys.length === 0) return 0
    let total = 0
    if (mealsKeys.includes('staff')) total += staffTotal
    if (mealsKeys.some((k: string) => k.startsWith('st_key_'))) {
      let staffFromCustom = 0
      mealsKeys.filter((k: string) => k.startsWith('st_key_')).forEach((k: string) => {
        const dietKey = k.replace('st_key_', '')
        staffFromCustom += (cfTotals['diet_' + dietKey] || cfTotals[dietKey] || 0)
      })
      total += staffFromCustom > 0 ? staffFromCustom : staffTotal
    }
    if (mealsKeys.includes('guardian')) total += guardianTotal
    mealsKeys.filter((k: string) => k.startsWith('cat_')).forEach((k: string) => { total += (cfTotals[k] || 0) })
    mealsKeys.filter((k: string) => k.startsWith('nc_key_')).forEach((k: string) => {
      const dietKey = k.replace('nc_key_', '')
      total += (cfTotals['diet_' + dietKey] || cfTotals[dietKey] || 0)
    })
    mealsKeys.filter((k: string) => k.startsWith('th_key_')).forEach((k: string) => {
      const dietKey = k.replace('th_key_', '')
      total += (cfTotals['diet_' + dietKey] || cfTotals[dietKey] || 0)
    })
    return total
  }
  const execStaffTotal    = mealStats?.total_staff    || 0
  const execGuardianTotal = mealStats?.total_guardian || 0
  // 카테고리별 월 식수
  const execCatMealMap: Record<number, number> = {}
  ;(patientCatsForExec.results || []).forEach((cat: any) => {
    let mealsKeys: string[] = []
    try { mealsKeys = JSON.parse(cat.meals_include_keys || '[]') } catch(e) {}
    execCatMealMap[cat.id] = execBuildMealsFromKeys(mealsKeys, execStaffTotal, execGuardianTotal, customFieldTotals)
  })
  // catOrders 결과로 카테고리별 발주금액 맵
  const execCatAmtMap: Record<number, number> = {}
  ;(catOrders.results || []).forEach((r: any) => { execCatAmtMap[r.id] = r.total || 0 })
  // 카테고리 중 식수>0 & 발주금액>0인 것만 formula에 사용
  const execActiveCats = (patientCatsForExec.results || []).filter((cat: any) => {
    return (execCatMealMap[cat.id] || 0) > 0 && (execCatAmtMap[cat.id] || 0) > 0
  })
  // catStaffIncluded / catGuardianIncluded 체크
  const execCatStaffIncluded    = execActiveCats.some((cat: any) => {
    try {
      const ks: string[] = JSON.parse(cat.meals_include_keys || '[]')
      return ks.some((k: string) => k.startsWith('st_key_') || k === 'staff')
    } catch { return false }
  })
  const execCatGuardianIncluded = execActiveCats.some((cat: any) => {
    try {
      const ks: string[] = JSON.parse(cat.meals_include_keys || '[]')
      return ks.includes('guardian')
    } catch { return false }
  })
  const execSumCatMeals = execActiveCats.reduce((s: number, cat: any) => s + (execCatMealMap[cat.id] || 0), 0)
  const execExtraStaff    = execCatStaffIncluded    ? 0 : execStaffTotal
  const execExtraGuardian = execCatGuardianIncluded ? 0 : execGuardianTotal
  const execTotalMealsForPrice = execActiveCats.length > 0
    ? execSumCatMeals + execExtraStaff + execExtraGuardian
    : totalMeals  // 카테고리 없으면 totalMeals 기반
  const currentMealPrice = execTotalMealsForPrice > 0 ? Math.round(totalUsed / execTotalMealsForPrice) : 0

  // 13. 검수 현황 (납품 대비 검수 완료)
  const inspectionStats = await c.env.DB.prepare(
    `SELECT
       COUNT(*) as total_orders,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
       SUM(CASE WHEN status = 'issue' THEN 1 ELSE 0 END) as issues
     FROM order_inspections
     WHERE hospital_id = ?
       AND strftime('%Y', inspected_at) = ?
       AND strftime('%m', inspected_at) = printf('%02d', ?)`
  ).bind(hospitalId, year, month).first<any>()

  return c.json({
    hospital,
    period: { year: parseInt(year), month: parseInt(month) },
    budget: {
      totalBudget,
      totalUsed,
      remaining,
      progress,
      targetMealPrice,
      currentMealPrice,
    },
    mealStats: {
      totalMeals,
      customFieldTotals,
      mealCustomFields: customFieldsList.results || [],
      daysEntered: mealStats?.days_entered || 0,
    },
    vendorOrders: vendorOrders.results || [],
    cardExpenses: cardExpenses.results || [],
    cardTotal,
    transactions: transactions.results || [],
    schedules: schedules.results || [],
    catOrders: catOrders.results || [],
    inspectionStats,
    prevMonth: {
      totalUsed: prevUsedRow?.total || 0,
      totalBudget: prevSettings?.total_budget || 0,
      mealPrice: prevSettings?.meal_price || 0,
    }
  })
})

// ── 운영진: 연간 추이 데이터 ─────────────────────────────────────
executive.get('/annual/:year', async (c) => {
  const user = c.get('user')
  const { year } = c.req.param()
  const hospitalId = user.role === 'admin'
    ? (c.req.query('hospitalId') || user.hospitalId)
    : user.hospitalId
  if (!hospitalId) return c.json({ error: 'Hospital not found' }, 400)

  const monthly = await c.env.DB.prepare(
    `SELECT strftime('%m', order_date) as month,
            COALESCE(SUM(total_amount), 0) as total_used
     FROM daily_orders
     WHERE hospital_id = ? AND strftime('%Y', order_date) = ?
     GROUP BY month ORDER BY month`
  ).bind(hospitalId, year).all<any>()

  const budgets = await c.env.DB.prepare(
    `SELECT month, total_budget, meal_price FROM monthly_settings
     WHERE hospital_id = ? AND year = ? ORDER BY month`
  ).bind(hospitalId, year).all<any>()

  // 월별 법인카드 합계
  const cardMonthly = await c.env.DB.prepare(
    `SELECT strftime('%m', expense_date) as month,
            COALESCE(SUM(amount), 0) as total
     FROM card_expenses
     WHERE hospital_id = ? AND strftime('%Y', expense_date) = ?
     GROUP BY month ORDER BY month`
  ).bind(hospitalId, year).all<any>()

  return c.json({
    monthly: monthly.results || [],
    budgets: budgets.results || [],
    cardMonthly: cardMonthly.results || [],
  })
})

export default executive
