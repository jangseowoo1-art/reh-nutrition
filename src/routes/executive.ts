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

  // 전달 커스텀 필드 식수 합계 (필드별 전달 대비용)
  const prevMealCustomData = await c.env.DB.prepare(
    `SELECT custom_data FROM daily_meals
     WHERE hospital_id = ?
       AND strftime('%Y', meal_date) = ?
       AND strftime('%m', meal_date) = printf('%02d', ?)
       AND custom_data IS NOT NULL AND custom_data != '{}'`
  ).bind(hospitalId, prevYear, prevMonth).all<any>()
  const prevCustomFieldTotals: Record<string, number> = {}
  ;(customFieldsList.results || []).forEach((f: any) => { prevCustomFieldTotals[f.field_key] = 0 })
  ;(prevMealCustomData.results || []).forEach((row: any) => {
    try {
      const cd = JSON.parse(row.custom_data || '{}')
      ;(customFieldsList.results || []).forEach((f: any) => {
        const fv = cd[f.field_key] || {}
        prevCustomFieldTotals[f.field_key] = (prevCustomFieldTotals[f.field_key]||0) + (fv.bf||0) + (fv.l||0) + (fv.d||0)
      })
    } catch(e) {}
  })

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

  // 소모품 발주 합계 (식단가 제외 업체)
  const supplyTotal = (vendorOrders.results || [])
    .filter((v: any) => v.category === 'supply')
    .reduce((s: number, v: any) => s + (v.total_used || 0), 0)
  // 총 운영원가: 식재료 + 소모품 + 카드
  const mealPriceOperating = execTotalMealsForPrice > 0
    ? Math.round((totalUsed + supplyTotal + cardTotal) / execTotalMealsForPrice)
    : 0

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
      mealPriceOperating,  // 총 운영원가 (식재료+소모품+카드) ÷ 식수
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
    },
    // ── 식수 분류별 상세 breakdown (운영진 분류별 식수 확인 및 전달 대비용) ──
    mealFieldBreakdown: (customFieldsList.results || []).map((f: any) => ({
      field_key: f.field_key,
      field_name: f.field_name,
      unit_type: f.unit_type,
      sort_order: f.sort_order,
      thisMonth: customFieldTotals[f.field_key] || 0,
      prevMonth: prevCustomFieldTotals[f.field_key] || 0,
      diff: (customFieldTotals[f.field_key] || 0) - (prevCustomFieldTotals[f.field_key] || 0)
    }))
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

// ════════════════════════════════════════════════════════════════
// 운영진 대시보드: 인력 & 인건비 현황 API
// GET /api/executive/staff-labor/:year/:month
// ════════════════════════════════════════════════════════════════
executive.get('/staff-labor/:year/:month', async (c) => {
  const user = c.get('user')
  const { year, month } = c.req.param()
  const hospitalId = user.role === 'admin'
    ? (c.req.query('hospitalId') || user.hospitalId)
    : user.hospitalId

  if (!hospitalId) return c.json({ error: 'Hospital not found' }, 400)

  const y = parseInt(year)
  const m = parseInt(month)

  // ── 1. 정규/계약 직원 현황 ────────────────────────────────────
  const employees = await c.env.DB.prepare(
    `SELECT id, name, employment_type, section, base_salary, salary_type, ot_enabled,
            night_allowance_enabled, holiday_allowance_enabled
     FROM employees
     WHERE hospital_id = ? AND is_active = 1`
  ).bind(hospitalId).all<any>()
  const empList = employees.results || []

  const totalEmp     = empList.length
  const fullTimeEmp  = empList.filter((e: any) => e.employment_type === 'full').length
  const partEmp      = empList.filter((e: any) => e.employment_type === 'part').length
  const contractEmp  = empList.filter((e: any) => e.employment_type === 'contract').length

  // ── 2. 이번 달 출근 일수 / OT / 휴가 집계 ────────────────────
  const schedRows = await c.env.DB.prepare(
    `SELECT ds.employee_id,
            COUNT(*) as total_days,
            SUM(CASE WHEN ds.is_overtime = 1 THEN 1 ELSE 0 END) as ot_days,
            SUM(COALESCE(ds.overtime_hours, 0)) as ot_hours,
            SUM(CASE WHEN ds.shift_code IN ('연차','반차','병가','경조','공가') THEN 1 ELSE 0 END) as leave_days,
            SUM(CASE WHEN ds.shift_code NOT IN ('연차','반차','병가','경조','공가','휴','무급') THEN 1 ELSE 0 END) as work_days
     FROM daily_schedules ds
     WHERE ds.hospital_id = ?
       AND strftime('%Y', ds.work_date) = ?
       AND strftime('%m', ds.work_date) = printf('%02d', ?)
     GROUP BY ds.employee_id`
  ).bind(hospitalId, String(y), m).all<any>()
  const schedMap: Record<number, any> = {}
  ;(schedRows.results || []).forEach((r: any) => { schedMap[r.employee_id] = r })

  const totalWorkDays  = (schedRows.results || []).reduce((s: number, r: any) => s + (r.work_days || 0), 0)
  const totalOtDays    = (schedRows.results || []).reduce((s: number, r: any) => s + (r.ot_days   || 0), 0)
  const totalOtHours   = (schedRows.results || []).reduce((s: number, r: any) => s + (r.ot_hours  || 0), 0)
  const totalLeaveDays = (schedRows.results || []).reduce((s: number, r: any) => s + (r.leave_days|| 0), 0)

  // 출근한 직원 수 (이번 달 1회 이상 출근)
  const activeEmpCount = (schedRows.results || []).filter((r: any) => (r.work_days || 0) > 0).length

  // ── 3. 외부인력 (파출/알바) 현황 ─────────────────────────────
  const extSchedules = await c.env.DB.prepare(
    `SELECT es.worker_id, es.shift_type, es.unit_price,
            ew.name as worker_name, ew.worker_type
     FROM external_schedules es
     JOIN external_workers ew ON ew.id = es.worker_id
     WHERE es.hospital_id = ?
       AND strftime('%Y', es.work_date) = ?
       AND strftime('%m', es.work_date) = printf('%02d', ?)`
  ).bind(hospitalId, String(y), m).all<any>()
  const extList = extSchedules.results || []

  const dispatchList  = extList.filter((e: any) => e.worker_type === 'dispatch')
  const parttimeList  = extList.filter((e: any) => e.worker_type === 'parttime')
  const dispatchDays  = dispatchList.length
  const parttimeDays  = parttimeList.length

  // 파출/알바 고유 인원수
  const dispatchWorkerIds = new Set(dispatchList.map((e: any) => e.worker_id))
  const parttimeWorkerIds = new Set(parttimeList.map((e: any) => e.worker_id))

  // ── 4. 인건비 단가 설정 로드 ──────────────────────────────────
  const laborCostRows = await c.env.DB.prepare(
    `SELECT cost_type, unit_price FROM labor_cost_settings WHERE hospital_id = ?`
  ).bind(hospitalId).all<any>()
  const costMap: Record<string, number> = {}
  ;(laborCostRows.results || []).forEach((r: any) => { costMap[r.cost_type] = r.unit_price || 0 })

  // shift_type → cost_type 매핑
  const shiftToCostType: Record<string, string> = {
    morning:   'dispatch_morning',
    afternoon: 'dispatch_afternoon',
    '9h':      'dispatch_9h',
    '12h':     'dispatch_12h',
  }
  const partTimeToCostType: Record<string, string> = {
    morning:   'parttime_morning',
    afternoon: 'parttime_afternoon',
    '9h':      'parttime_9h',
    '12h':     'parttime_12h',
  }

  // ── 5. 파출/알바 인건비 계산 ─────────────────────────────────
  let dispatchCost = 0
  dispatchList.forEach((e: any) => {
    const price = e.unit_price > 0
      ? e.unit_price
      : (costMap[shiftToCostType[e.shift_type] || ''] || 0)
    dispatchCost += price
  })

  let parttimeCost = 0
  parttimeList.forEach((e: any) => {
    const price = e.unit_price > 0
      ? e.unit_price
      : (costMap[partTimeToCostType[e.shift_type] || ''] || 0)
    parttimeCost += price
  })

  // ── 6. 정규 인건비 (기본급 합계, salary_type 반영) ────────────
  const baseSalaryTotal = empList.reduce((s: number, e: any) => {
    const sal = e.base_salary || 0
    if (e.salary_type === 'annual') return s + Math.round(sal / 12)
    if (e.salary_type === 'monthly') return s + sal
    return s // hourly: 별도 계산
  }, 0)

  // OT 비용: employee_ot_settings 에서 hourly_wage × ot_rate 로 계산
  const otSettingsRows = await c.env.DB.prepare(
    `SELECT employee_id, hourly_wage, ot_rate FROM employee_ot_settings WHERE hospital_id = ?`
  ).bind(hospitalId).all<any>()
  const otRateMap: Record<number, number> = {}
  ;(otSettingsRows.results || []).forEach((r: any) => {
    // OT 시간당 금액 = hourly_wage × ot_rate (기본 1.5배)
    otRateMap[r.employee_id] = (r.hourly_wage || 0) * (r.ot_rate || 1.5)
  })

  let otCost = 0
  ;(schedRows.results || []).forEach((r: any) => {
    const rate = otRateMap[r.employee_id] || 0
    otCost += (r.ot_hours || 0) * rate
  })

  const totalLaborCost = baseSalaryTotal + otCost + dispatchCost + parttimeCost

  // ── 7. 전월 비교 ──────────────────────────────────────────────
  const prevM = m === 1 ? 12 : m - 1
  const prevY = m === 1 ? y - 1 : y

  const prevExtSchedules = await c.env.DB.prepare(
    `SELECT es.shift_type, es.unit_price, ew.worker_type
     FROM external_schedules es
     JOIN external_workers ew ON ew.id = es.worker_id
     WHERE es.hospital_id = ?
       AND strftime('%Y', es.work_date) = ?
       AND strftime('%m', es.work_date) = printf('%02d', ?)`
  ).bind(hospitalId, String(prevY), prevM).all<any>()
  const prevExtList = prevExtSchedules.results || []
  const prevDispatchDays = prevExtList.filter((e: any) => e.worker_type === 'dispatch').length
  const prevParttimeDays = prevExtList.filter((e: any) => e.worker_type === 'parttime').length

  // ── 8. 팀별 최소인력 대비 현황 ───────────────────────────────
  const minStaffRows = await c.env.DB.prepare(
    `SELECT team, min_count FROM schedule_min_staff WHERE hospital_id = ?`
  ).bind(hospitalId).all<any>()
  const minStaffMap: Record<string, number> = {}
  ;(minStaffRows.results || []).forEach((r: any) => { minStaffMap[r.team] = r.min_count || 0 })

  // 팀별 실제 재직 인원
  const teamCountMap: Record<string, number> = {}
  empList.forEach((e: any) => {
    const team = e.team || 'cook'
    teamCountMap[team] = (teamCountMap[team] || 0) + 1
  })

  // ── 9. 경고 생성 ──────────────────────────────────────────────
  const warnings: Array<{ type: string; level: string; message: string }> = []

  // 파출 과다 투입 경고 (월 15회 초과)
  if (dispatchDays > 15) {
    warnings.push({ type: 'dispatch_overuse', level: 'warning', message: `파출 투입이 ${dispatchDays}회로 과다합니다 (권장: 15회 이하)` })
  }
  // 알바 과다 투입 경고 (월 20회 초과)
  if (parttimeDays > 20) {
    warnings.push({ type: 'parttime_overuse', level: 'warning', message: `알바 투입이 ${parttimeDays}회로 과다합니다 (권장: 20회 이하)` })
  }
  // OT 과다 경고 (월 40시간 초과)
  if (totalOtHours > 40) {
    warnings.push({ type: 'ot_overuse', level: 'danger', message: `초과근무가 ${totalOtHours}시간으로 법정 한도를 초과할 수 있습니다` })
  }
  // 외부인력 비용이 전체 인건비의 30% 초과
  const extCostRatio = totalLaborCost > 0 ? ((dispatchCost + parttimeCost) / totalLaborCost * 100) : 0
  if (extCostRatio > 30) {
    warnings.push({ type: 'ext_cost_high', level: 'warning', message: `외부인력 비용 비중이 ${extCostRatio.toFixed(1)}%로 높습니다 (권장: 30% 이하)` })
  }

  // ── 10. 급여 공개 설정 로드 ───────────────────────────────────
  const workSettingsForSalary = await c.env.DB.prepare(
    `SELECT setting_value FROM hospital_work_settings WHERE hospital_id = ? AND setting_key = 'show_base_salary'`
  ).bind(hospitalId).first<any>()
  const showBaseSalary = (workSettingsForSalary?.setting_value ?? '0') === '1'

  // ── 11. 직원별 수당 명세 집계 ────────────────────────────────
  // (OT 시간·비용 / 야간수당 / 휴일수당 / 기본급) — 스케줄 일별 데이터 기반
  const dailySchedsForEmp = await c.env.DB.prepare(
    `SELECT ds.employee_id, ds.work_date, ds.shift_code, ds.overtime_hours,
            ds.night_work_hours, ds.basic_work_hours, ds.holiday_work_hours,
            ds.is_night_work, ds.leave_type,
            e.name as emp_name, e.base_salary, e.salary_type,
            e.ot_enabled, e.night_allowance_enabled, e.holiday_allowance_enabled
     FROM daily_schedules ds
     JOIN employees e ON ds.employee_id = e.id
     WHERE ds.hospital_id = ?
       AND strftime('%Y', ds.work_date) = ?
       AND strftime('%m', ds.work_date) = printf('%02d', ?)
     ORDER BY ds.employee_id, ds.work_date`
  ).bind(hospitalId, String(y), m).all<any>()

  const dailyList = dailySchedsForEmp.results || []

  // 공휴일 Set
  const holidayRows2 = await c.env.DB.prepare(
    `SELECT holiday_date FROM holidays WHERE holiday_date LIKE ?`
  ).bind(`${y}-${String(m).padStart(2,'0')}-%`).all<any>()
  const holidaySet2 = new Set((holidayRows2.results || []).map((h: any) => h.holiday_date))

  const REST_CODES2 = new Set(['휴','연','경조','병가','반차','대체'])

  type EmpAllowance = {
    empId: number; empName: string; baseSalary: number; salaryType: string
    workDays: number; basicHours: number
    otHours: number; otCost: number
    nightHours: number; nightCost: number
    holidayHours: number; holidayCost: number
    weeklyHolidayDays: number; weeklyHolidayCost: number
    totalAddCost: number; estimatedMonthly: number
  }
  const byEmpMap: Record<number, EmpAllowance> = {}

  for (const emp of empList) {
    const sal = emp.base_salary || 0
    const estimated = emp.salary_type === 'annual' ? Math.round(sal / 12)
                    : emp.salary_type === 'monthly' ? sal : 0
    byEmpMap[emp.id] = {
      empId: emp.id, empName: emp.name, baseSalary: sal, salaryType: emp.salary_type || 'monthly',
      workDays: 0, basicHours: 0,
      otHours: 0, otCost: 0, nightHours: 0, nightCost: 0,
      holidayHours: 0, holidayCost: 0, weeklyHolidayDays: 0, weeklyHolidayCost: 0,
      totalAddCost: 0, estimatedMonthly: estimated
    }
  }

  // 일별 근무시간 맵 (주휴수당 계산용)
  const dailyHoursForWeekly: Record<number, Record<string, number>> = {}

  for (const s of dailyList) {
    const rec = byEmpMap[s.employee_id]
    if (!rec) continue
    const code = s.shift_code || ''
    if (s.leave_type || REST_CODES2.has(code)) continue

    const otRate = otRateMap[s.employee_id] || 0
    const hourly = otSettingsRows.results?.find((r: any) => r.employee_id === s.employee_id)?.hourly_wage || 0
    const otRateVal = otSettingsRows.results?.find((r: any) => r.employee_id === s.employee_id)?.ot_rate || 1.5
    const nightRateVal = otSettingsRows.results?.find((r: any) => r.employee_id === s.employee_id)?.night_rate || 0.5

    const dow = new Date(s.work_date).getDay()
    const isHoliday = dow === 0 || dow === 6 || holidaySet2.has(s.work_date)

    const basicH   = s.basic_work_hours   > 0 ? s.basic_work_hours   : 8
    const otH      = s.overtime_hours     > 0 ? s.overtime_hours      : 0
    const nightH   = s.night_work_hours   > 0 ? s.night_work_hours    : (s.is_night_work ? 2 : 0)
    const holidayH = s.holiday_work_hours > 0 ? s.holiday_work_hours  : (isHoliday ? basicH : 0)

    rec.workDays++
    rec.basicHours    += basicH
    rec.otHours       += otH
    rec.nightHours    += nightH
    rec.holidayHours  += holidayH

    if (otH > 0 && s.ot_enabled !== 0 && hourly > 0)
      rec.otCost += Math.round(otH * hourly * otRateVal)
    if (nightH > 0 && s.night_allowance_enabled !== 0 && hourly > 0)
      rec.nightCost += Math.round(nightH * hourly * nightRateVal)
    if (isHoliday && holidayH > 0 && s.holiday_allowance_enabled !== 0 && hourly > 0)
      rec.holidayCost += Math.round(holidayH * hourly * 0.5)

    if (!dailyHoursForWeekly[s.employee_id]) dailyHoursForWeekly[s.employee_id] = {}
    dailyHoursForWeekly[s.employee_id][s.work_date] = basicH
  }

  // 주휴수당 계산 (calcWeeklyHolidayPay는 schedule.ts에 있으므로 여기서 직접 계산)
  for (const empId of Object.keys(byEmpMap).map(Number)) {
    const rec = byEmpMap[empId]
    const dmap = dailyHoursForWeekly[empId] || {}
    const hourly = otSettingsRows.results?.find((r: any) => r.employee_id === empId)?.hourly_wage || 0
    // 주별 총 근무시간 15h 이상이면 주휴 1일 발생
    let wkDays = 0
    const daysInMonth = new Date(y, m, 0).getDate()
    let weekHrs = 0
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
      weekHrs += dmap[ds] || 0
      const dow = new Date(ds).getDay()
      if (dow === 0) { // 일요일 = 주 끝
        if (weekHrs >= 15) wkDays++
        weekHrs = 0
      }
    }
    if (weekHrs >= 15) wkDays++ // 마지막 주 처리
    rec.weeklyHolidayDays = wkDays
    if (wkDays > 0 && hourly > 0)
      rec.weeklyHolidayCost = Math.round(wkDays * 8 * hourly)
    rec.totalAddCost = rec.otCost + rec.nightCost + rec.holidayCost + rec.weeklyHolidayCost
  }

  const byEmployee = Object.values(byEmpMap).filter(r => r.workDays > 0 || r.otHours > 0)

  return c.json({
    period: { year: y, month: m },
    // 급여 공개 설정
    showBaseSalary,
    // 인력 현황
    staffSummary: {
      total: totalEmp,
      fullTime: fullTimeEmp,
      partTime: partEmp,
      contract: contractEmp,
      activeThisMonth: activeEmpCount,
    },
    // 근무 현황
    workSummary: {
      totalWorkDays,
      totalOtDays,
      totalOtHours,
      totalLeaveDays,
    },
    // 외부인력 현황
    externalSummary: {
      dispatchDays,
      parttimeDays,
      dispatchWorkerCount: dispatchWorkerIds.size,
      parttimeWorkerCount: parttimeWorkerIds.size,
      prevDispatchDays,
      prevParttimeDays,
    },
    // 인건비 내역
    laborCost: {
      baseSalary: baseSalaryTotal,
      otCost,
      dispatchCost,
      parttimeCost,
      total: totalLaborCost,
    },
    // 직원별 수당 명세
    byEmployee,
    // 경고
    warnings,
  })
})

// ══════════════════════════════════════════════════════════════════
// ── CSV Export 라우트 (운영진 DETAIL 뷰 다운로드) ─────────────────
// ══════════════════════════════════════════════════════════════════
// 공통 헬퍼: hospitalId 결정
function resolveHospitalId(c: any): string | number | null {
  const user = c.get('user')
  const hid = user?.role === 'admin'
    ? (c.req.query('hospitalId') || user?.hospitalId)
    : user?.hospitalId
  return hid || null
}

// 공통 헬퍼: CSV 셀 escape (큰따옴표 처리)
function csvCell(v: any): string {
  const s = (v === null || v === undefined) ? '' : String(v)
  return '"' + s.replace(/"/g, '""') + '"'
}

// 공통 헬퍼: 천단위 콤마
function nf(n: any): string {
  const num = Number(n) || 0
  return num.toLocaleString('en-US')
}

// 공통 헬퍼: CSV 응답 생성 (UTF-8 BOM + CRLF + 한글 파일명)
function csvResponse(c: any, rows: string[][], baseFileName: string) {
  const BOM = '\uFEFF'
  const body = BOM + rows.map(r => r.map(csvCell).join(',')).join('\r\n')
  const encodedName = encodeURIComponent(baseFileName + '.csv')
  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`)
  c.header('Access-Control-Allow-Origin', '*')
  return c.body(body)
}

// vendors.category → CSV 분류 표기 매핑 (배포본 형식 유지)
function categoryLabel(cat: string): string {
  const map: Record<string, string> = {
    card: '카드', event: '이벤트', supply: '소모품',
  }
  return map[cat] || cat || '-'
}

// ── 1. 예산 CSV (업체별 사용금액 + 카드합계 + 총예산) ─────────────
executive.get('/export/budget/:year/:month', async (c) => {
  const hospitalId = resolveHospitalId(c)
  if (!hospitalId) return c.json({ error: 'Hospital not found' }, 400)
  const { year, month } = c.req.param()

  const vendorRows = await c.env.DB.prepare(
    `SELECT v.name, v.category,
            COALESCE(SUM(d.total_amount), 0) as total_used
     FROM vendors v
     LEFT JOIN daily_orders d ON d.vendor_id = v.id
       AND d.hospital_id = ?
       AND strftime('%Y', d.order_date) = ?
       AND strftime('%m', d.order_date) = printf('%02d', ?)
     WHERE v.hospital_id = ? AND v.is_active = 1
     GROUP BY v.id
     HAVING total_used > 0
     ORDER BY total_used DESC`
  ).bind(hospitalId, year, month, hospitalId).all<any>()
  const vendors = vendorRows.results || []

  const settings = await c.env.DB.prepare(
    `SELECT total_budget FROM monthly_settings WHERE hospital_id = ? AND year = ? AND month = ?`
  ).bind(hospitalId, year, month).first<any>()
  const totalBudget = settings?.total_budget || 0

  const cardTotalRow = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(amount),0) as total FROM card_expenses
     WHERE hospital_id = ?
       AND strftime('%Y', expense_date) = ?
       AND strftime('%m', expense_date) = printf('%02d', ?)`
  ).bind(hospitalId, year, month).first<any>()
  const cardTotal = cardTotalRow?.total || 0

  const rows: string[][] = [['업체명', '분류', '비용유형', '사용금액(원)']]
  if (vendors.length === 0) {
    rows.push(['데이터 없음', '-', '-', '0'])
  } else {
    vendors.forEach((v: any) => {
      const costType = v.category === 'supply' ? 'supply' : 'food'
      rows.push([v.name, categoryLabel(v.category), costType, nf(v.total_used)])
    })
  }
  rows.push(['법인카드 합계', '카드', '-', nf(cardTotal)])
  rows.push(['총 예산', '-', '-', nf(totalBudget)])

  const hospital = await c.env.DB.prepare(`SELECT name FROM hospitals WHERE id = ?`).bind(hospitalId).first<any>()
  const fname = `${hospital?.name || '병원'}_${year}년${String(month).padStart(2,'0')}월_예산상세`
  return csvResponse(c, rows, fname)
})

// ── 2. 발주 CSV (업체별 발주금액·횟수·월예산) ────────────────────
executive.get('/export/vendors/:year/:month', async (c) => {
  const hospitalId = resolveHospitalId(c)
  if (!hospitalId) return c.json({ error: 'Hospital not found' }, 400)
  const { year, month } = c.req.param()

  const vendorRows = await c.env.DB.prepare(
    `SELECT v.name, v.category, v.monthly_budget,
            COALESCE(SUM(d.total_amount), 0) as total_used,
            COUNT(d.id) as order_count
     FROM vendors v
     LEFT JOIN daily_orders d ON d.vendor_id = v.id
       AND d.hospital_id = ?
       AND strftime('%Y', d.order_date) = ?
       AND strftime('%m', d.order_date) = printf('%02d', ?)
     WHERE v.hospital_id = ? AND v.is_active = 1
     GROUP BY v.id
     HAVING total_used > 0
     ORDER BY total_used DESC`
  ).bind(hospitalId, year, month, hospitalId).all<any>()
  const vendors = vendorRows.results || []

  const rows: string[][] = [['업체명', '분류', '발주금액(원)', '발주횟수', '월예산(원)']]
  if (vendors.length === 0) {
    rows.push(['데이터 없음', '-', '0', '0', '0'])
  } else {
    vendors.forEach((v: any) => {
      rows.push([v.name, categoryLabel(v.category), nf(v.total_used), String(v.order_count || 0), nf(v.monthly_budget || 0)])
    })
  }

  const hospital = await c.env.DB.prepare(`SELECT name FROM hospitals WHERE id = ?`).bind(hospitalId).first<any>()
  const fname = `${hospital?.name || '병원'}_${year}년${String(month).padStart(2,'0')}월_발주현황`
  return csvResponse(c, rows, fname)
})

// ── 3. 인건비 CSV (정규직 + 외부인력) ────────────────────────────
executive.get('/export/labor/:year/:month', async (c) => {
  const hospitalId = resolveHospitalId(c)
  if (!hospitalId) return c.json({ error: 'Hospital not found' }, 400)
  const { year, month } = c.req.param()
  const y = parseInt(year), m = parseInt(month)

  // 정규/계약 직원
  const empRows = await c.env.DB.prepare(
    `SELECT id, name, position, employment_type
     FROM employees
     WHERE hospital_id = ? AND is_active = 1
     ORDER BY sort_order, id`
  ).bind(hospitalId).all<any>()
  const emps = empRows.results || []

  // 직원별 근무일수 / OT일수
  const schedRows = await c.env.DB.prepare(
    `SELECT ds.employee_id,
            SUM(CASE WHEN ds.shift_code NOT IN ('연차','반차','병가','경조','공가','휴','무급') THEN 1 ELSE 0 END) as work_days,
            SUM(CASE WHEN ds.is_overtime = 1 THEN 1 ELSE 0 END) as ot_days
     FROM daily_schedules ds
     WHERE ds.hospital_id = ?
       AND strftime('%Y', ds.work_date) = ?
       AND strftime('%m', ds.work_date) = printf('%02d', ?)
     GROUP BY ds.employee_id`
  ).bind(hospitalId, String(y), m).all<any>()
  const schedMap: Record<number, any> = {}
  ;(schedRows.results || []).forEach((r: any) => { schedMap[r.employee_id] = r })

  // 외부인력 (파출/알바) 투입일수
  const extRows = await c.env.DB.prepare(
    `SELECT ew.name, ew.worker_type, COUNT(es.id) as days
     FROM external_workers ew
     LEFT JOIN external_schedules es ON es.worker_id = ew.id
       AND es.hospital_id = ?
       AND strftime('%Y', es.work_date) = ?
       AND strftime('%m', es.work_date) = printf('%02d', ?)
     WHERE ew.hospital_id = ? AND ew.is_active = 1
     GROUP BY ew.id
     HAVING days > 0
     ORDER BY ew.worker_type, ew.name`
  ).bind(hospitalId, String(y), m, hospitalId).all<any>()
  const exts = extRows.results || []

  const empTypeLabel: Record<string, string> = { full: 'full', part: 'part', contract: 'contract', temp: 'temp', daily: 'daily' }

  const rows: string[][] = [['구분', '이름', '고용형태', '직책', '근무/투입일수', '비고']]
  if (emps.length === 0 && exts.length === 0) {
    rows.push(['데이터 없음', '-', '-', '-', '0', '-'])
  } else {
    emps.forEach((e: any) => {
      const s = schedMap[e.id] || {}
      rows.push([
        '정규직', e.name || '', empTypeLabel[e.employment_type] || (e.employment_type || 'full'),
        e.position || '-', String(s.work_days || 0), `OT ${s.ot_days || 0}일`
      ])
    })
    exts.forEach((x: any) => {
      const typeLabel = x.worker_type === 'dispatch' ? '파출' : x.worker_type === 'parttime' ? '알바' : x.worker_type
      rows.push(['외부인력', x.name || '', typeLabel, '-', String(x.days || 0), '-'])
    })
  }

  const hospital = await c.env.DB.prepare(`SELECT name FROM hospitals WHERE id = ?`).bind(hospitalId).first<any>()
  const fname = `${hospital?.name || '병원'}_${year}년${String(month).padStart(2,'0')}월_인건비`
  return csvResponse(c, rows, fname)
})

// ── 4. 카드 CSV (법인카드 지출 내역) ─────────────────────────────
executive.get('/export/card/:year/:month', async (c) => {
  const hospitalId = resolveHospitalId(c)
  if (!hospitalId) return c.json({ error: 'Hospital not found' }, 400)
  const { year, month } = c.req.param()

  const cardRows = await c.env.DB.prepare(
    `SELECT ce.expense_date, ce.vendor_name, ce.item_name, ce.purpose,
            ce.expense_type, ce.amount, ce.memo,
            v.name as card_vendor_name
     FROM card_expenses ce
     LEFT JOIN vendors v ON v.id = ce.vendor_id
     WHERE ce.hospital_id = ?
       AND strftime('%Y', ce.expense_date) = ?
       AND strftime('%m', ce.expense_date) = printf('%02d', ?)
     ORDER BY ce.expense_date DESC, ce.id DESC`
  ).bind(hospitalId, year, month).all<any>()
  const cards = cardRows.results || []

  const rows: string[][] = [['날짜', '사용처', '품목', '용도', '비용유형', '금액(원)', '메모']]
  if (cards.length === 0) {
    rows.push(['데이터 없음', '-', '-', '-', '-', '0', '-'])
  } else {
    cards.forEach((ce: any) => {
      rows.push([
        ce.expense_date || '',
        ce.card_vendor_name || ce.vendor_name || '',
        ce.vendor_name || ce.item_name || '',
        ce.purpose || ce.item_name || '',
        ce.expense_type || '법인카드',
        nf(ce.amount),
        ce.memo || '-'
      ])
    })
  }

  const hospital = await c.env.DB.prepare(`SELECT name FROM hospitals WHERE id = ?`).bind(hospitalId).first<any>()
  const fname = `${hospital?.name || '병원'}_${year}년${String(month).padStart(2,'0')}월_법인카드`
  return csvResponse(c, rows, fname)
})

export default executive
