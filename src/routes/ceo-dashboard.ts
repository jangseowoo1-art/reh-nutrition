import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const app = new Hono<{ Bindings: Bindings }>()

// ─── 공통 헬퍼 ───────────────────────────────────────────────
function ym(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}
function ymRange(year: number, month: number) {
  const start = `${ym(year, month)}-01`
  const end   = `${ym(year, month)}-31`
  return { start, end }
}

// ─── 1. care_type 코드 목록 ──────────────────────────────────
// GET /api/ceo-dashboard/care-types
app.get('/care-types', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT code, label_ko, sort_order FROM care_type_codes WHERE is_active=1 ORDER BY sort_order`
  ).all()
  return c.json(rows.results)
})

// ─── 2. KPI 집계 ─────────────────────────────────────────────
// GET /api/ceo-dashboard/kpi/:year/:month?hospital_type=&care_type=&bed_size=&hospital_id=
app.get('/kpi/:year/:month', async (c) => {
  const year  = parseInt(c.req.param('year'))
  const month = parseInt(c.req.param('month'))
  const { start, end } = ymRange(year, month)

  const hospitalType = c.req.query('hospital_type') || ''
  const careType     = c.req.query('care_type')     || ''
  const bedSize      = c.req.query('bed_size')      || ''
  const hospitalId   = c.req.query('hospital_id')   || ''

  // 필터 조건 빌드
  const conds: string[] = ['h.id IS NOT NULL']
  const args: any[]     = []

  if (hospitalType) { conds.push('hi.hospital_type = ?'); args.push(hospitalType) }
  if (careType)     { conds.push('hi.care_type = ?');     args.push(careType) }
  if (hospitalId)   { conds.push('h.id = ?');             args.push(parseInt(hospitalId)) }
  if (bedSize) {
    if      (bedSize === 'under30')  { conds.push('COALESCE(hi.licensed_beds,0) <= 30') }
    else if (bedSize === '31to60')   { conds.push('COALESCE(hi.licensed_beds,0) BETWEEN 31 AND 60') }
    else if (bedSize === '61to100')  { conds.push('COALESCE(hi.licensed_beds,0) BETWEEN 61 AND 100') }
    else if (bedSize === 'over100')  { conds.push('COALESCE(hi.licensed_beds,0) > 100') }
  }
  const where = conds.join(' AND ')

  // 필터된 병원 목록
  const hospsR = await c.env.DB.prepare(
    `SELECT h.id, h.name FROM hospitals h
     LEFT JOIN hospital_info hi ON hi.hospital_id = h.id
     WHERE ${where}`
  ).bind(...args).all()
  const hosps = hospsR.results as any[]
  const hids  = hosps.map((h: any) => h.id)
  if (hids.length === 0) {
    return c.json({ hospitalCount: 0, totalBudget: 0, totalUsed: 0, avgBudgetPct: 0,
                    avgMealPrice: 0, dangerBudgetCount: 0, dangerMealCount: 0,
                    pendingInspectCount: 0, mealPriceByCategory: {} })
  }

  const ph = hids.map(() => '?').join(',')

  // 예산 집계
  const budgetR = await c.env.DB.prepare(
    `SELECT hospital_id, total_budget FROM monthly_settings
     WHERE year=? AND month=? AND hospital_id IN (${ph})`
  ).bind(year, month, ...hids).all()
  const budgetMap: Record<number, number> = {}
  ;(budgetR.results as any[]).forEach((r: any) => { budgetMap[r.hospital_id] = r.total_budget || 0 })

  // 발주 집계
  const orderR = await c.env.DB.prepare(
    `SELECT hospital_id, SUM(total_amount) AS used
     FROM daily_orders
     WHERE order_date BETWEEN ? AND ? AND hospital_id IN (${ph})
     GROUP BY hospital_id`
  ).bind(start, end, ...hids).all()
  const orderMap: Record<number, number> = {}
  ;(orderR.results as any[]).forEach((r: any) => { orderMap[r.hospital_id] = r.used || 0 })

  // 식수 집계 (전체 + 카테고리별)
  const mealR = await c.env.DB.prepare(
    `SELECT hospital_id,
            SUM(patient_count + COALESCE(staff_count,0) + COALESCE(guardian_count,0)) AS total_meals
     FROM daily_meals
     WHERE meal_date BETWEEN ? AND ? AND hospital_id IN (${ph})
     GROUP BY hospital_id`
  ).bind(start, end, ...hids).all()
  const mealMap: Record<number, number> = {}
  ;(mealR.results as any[]).forEach((r: any) => { mealMap[r.hospital_id] = r.total_meals || 0 })

  // 카테고리별 식수
  const catMealR = await c.env.DB.prepare(
    `SELECT dc.hospital_id, pc.care_type AS cat_care, SUM(dc.total_count) AS cnt
     FROM daily_category_meal_counts dc
     JOIN patient_categories pc ON pc.id = dc.patient_category_id
     WHERE dc.meal_date BETWEEN ? AND ? AND dc.hospital_id IN (${ph})
       AND pc.care_type IS NOT NULL
     GROUP BY dc.hospital_id, pc.care_type`
  ).bind(start, end, ...hids).all().catch(() => ({ results: [] }))

  // 카테고리별 식단가 집계
  const mealPriceByCategory: Record<string, { totalMeals: number; totalOrders: number; avgPrice: number }> = {}
  ;(catMealR.results as any[]).forEach((r: any) => {
    if (!mealPriceByCategory[r.cat_care]) mealPriceByCategory[r.cat_care] = { totalMeals: 0, totalOrders: 0, avgPrice: 0 }
    mealPriceByCategory[r.cat_care].totalMeals += r.cnt || 0
  })
  // 카테고리별 발주 (patient_category_id 기준)
  const catOrderR = await c.env.DB.prepare(
    `SELECT dc.hospital_id, pc.care_type AS cat_care, SUM(dc.total_amount) AS amt
     FROM daily_category_orders dc
     JOIN patient_categories pc ON pc.id = dc.patient_category_id
     WHERE dc.order_date BETWEEN ? AND ? AND dc.hospital_id IN (${ph})
       AND pc.care_type IS NOT NULL
     GROUP BY dc.hospital_id, pc.care_type`
  ).bind(start, end, ...hids).all().catch(() => ({ results: [] }))
  ;(catOrderR.results as any[]).forEach((r: any) => {
    if (!mealPriceByCategory[r.cat_care]) mealPriceByCategory[r.cat_care] = { totalMeals: 0, totalOrders: 0, avgPrice: 0 }
    mealPriceByCategory[r.cat_care].totalOrders += r.amt || 0
  })
  Object.keys(mealPriceByCategory).forEach(k => {
    const d = mealPriceByCategory[k]
    d.avgPrice = d.totalMeals > 0 ? Math.round(d.totalOrders / d.totalMeals) : 0
  })

  // 검수 미완료 (병원별)
  const inspR = await c.env.DB.prepare(
    `SELECT DISTINCT hospital_id FROM order_inspections
     WHERE status='pending' AND hospital_id IN (${ph})`
  ).bind(...hids).all().catch(() => ({ results: [] }))
  const pendingInspectCount = (inspR.results as any[]).length

  // 목표 식단가
  const targetR = await c.env.DB.prepare(
    `SELECT hospital_id, meal_price FROM monthly_settings
     WHERE year=? AND month=? AND hospital_id IN (${ph})`
  ).bind(year, month, ...hids).all()
  const targetMealMap: Record<number, number> = {}
  ;(targetR.results as any[]).forEach((r: any) => { targetMealMap[r.hospital_id] = r.meal_price || 0 })

  // 집계
  let totalBudget = 0, totalUsed = 0
  let budgetPctSum = 0, budgetPctCnt = 0
  let mealPriceSum = 0, mealPriceCnt = 0
  let dangerBudgetCount = 0, dangerMealCount = 0

  hids.forEach((hid: number) => {
    const budget = budgetMap[hid] || 0
    const used   = orderMap[hid]  || 0
    const meals  = mealMap[hid]   || 0
    const target = targetMealMap[hid] || 0

    totalBudget += budget
    totalUsed   += used

    if (budget > 0) {
      const pct = used / budget * 100
      budgetPctSum += pct; budgetPctCnt++
      if (pct >= 90) dangerBudgetCount++
    }
    if (meals > 0) {
      const mp = Math.round(used / meals)
      mealPriceSum += mp; mealPriceCnt++
      if (target > 0 && mp > target * 1.1) dangerMealCount++
    }
  })

  return c.json({
    hospitalCount:        hids.length,
    totalBudget,
    totalUsed,
    avgBudgetPct:         budgetPctCnt > 0 ? Math.round(budgetPctSum / budgetPctCnt) : 0,
    avgMealPrice:         mealPriceCnt  > 0 ? Math.round(mealPriceSum / mealPriceCnt) : 0,
    dangerBudgetCount,
    dangerMealCount,
    pendingInspectCount,
    mealPriceByCategory
  })
})

// ─── 3. 병원별 운영 상태 카드 데이터 ─────────────────────────
// GET /api/ceo-dashboard/hospitals/:year/:month?...filters...
app.get('/hospitals/:year/:month', async (c) => {
  const year  = parseInt(c.req.param('year'))
  const month = parseInt(c.req.param('month'))
  const { start, end } = ymRange(year, month)
  const today = new Date().toISOString().slice(0, 10)

  const hospitalType = c.req.query('hospital_type') || ''
  const careType     = c.req.query('care_type')     || ''
  const bedSize      = c.req.query('bed_size')      || ''
  const hospitalId   = c.req.query('hospital_id')   || ''

  const conds: string[] = ['1=1']
  const args: any[]     = []
  if (hospitalType) { conds.push('hi.hospital_type = ?'); args.push(hospitalType) }
  if (careType)     { conds.push('hi.care_type = ?');     args.push(careType) }
  if (hospitalId)   { conds.push('h.id = ?');             args.push(parseInt(hospitalId)) }
  if (bedSize) {
    if      (bedSize === 'under30') conds.push('COALESCE(hi.licensed_beds,0) <= 30')
    else if (bedSize === '31to60')  conds.push('COALESCE(hi.licensed_beds,0) BETWEEN 31 AND 60')
    else if (bedSize === '61to100') conds.push('COALESCE(hi.licensed_beds,0) BETWEEN 61 AND 100')
    else if (bedSize === 'over100') conds.push('COALESCE(hi.licensed_beds,0) > 100')
  }
  const where = conds.join(' AND ')

  // 병원 기본 정보
  const hospsR = await c.env.DB.prepare(
    `SELECT h.id, h.name,
            COALESCE(hi.hospital_type,'general') AS hospital_type,
            COALESCE(hi.care_type,'general')     AS care_type,
            COALESCE(hi.licensed_beds,0)         AS licensed_beds,
            COALESCE(hi.operation_type,'direct') AS operation_type
     FROM hospitals h
     LEFT JOIN hospital_info hi ON hi.hospital_id = h.id
     WHERE ${where}
     ORDER BY h.name`
  ).bind(...args).all()
  const hosps = hospsR.results as any[]
  if (hosps.length === 0) return c.json([])

  const hids = hosps.map((h: any) => h.id)
  const ph   = hids.map(() => '?').join(',')

  // 예산 설정
  const budgetR = await c.env.DB.prepare(
    `SELECT hospital_id, total_budget, meal_price
     FROM monthly_settings WHERE year=? AND month=? AND hospital_id IN (${ph})`
  ).bind(year, month, ...hids).all()
  const bMap: Record<number, any> = {}
  ;(budgetR.results as any[]).forEach((r: any) => { bMap[r.hospital_id] = r })

  // 발주 합계
  const ordR = await c.env.DB.prepare(
    `SELECT hospital_id, SUM(total_amount) AS used FROM daily_orders
     WHERE order_date BETWEEN ? AND ? AND hospital_id IN (${ph})
     GROUP BY hospital_id`
  ).bind(start, end, ...hids).all()
  const oMap: Record<number, number> = {}
  ;(ordR.results as any[]).forEach((r: any) => { oMap[r.hospital_id] = r.used || 0 })

  // 오늘 발주
  const todayOrdR = await c.env.DB.prepare(
    `SELECT hospital_id, SUM(total_amount) AS today_used FROM daily_orders
     WHERE order_date=? AND hospital_id IN (${ph})
     GROUP BY hospital_id`
  ).bind(today, ...hids).all()
  const todayMap: Record<number, number> = {}
  ;(todayOrdR.results as any[]).forEach((r: any) => { todayMap[r.hospital_id] = r.today_used || 0 })

  // 총 식수
  const mealR = await c.env.DB.prepare(
    `SELECT hospital_id,
            SUM(patient_count + COALESCE(staff_count,0) + COALESCE(guardian_count,0)) AS total_meals
     FROM daily_meals WHERE meal_date BETWEEN ? AND ? AND hospital_id IN (${ph})
     GROUP BY hospital_id`
  ).bind(start, end, ...hids).all()
  const mMap: Record<number, number> = {}
  ;(mealR.results as any[]).forEach((r: any) => { mMap[r.hospital_id] = r.total_meals || 0 })

  // 검수 미완료
  const inspR = await c.env.DB.prepare(
    `SELECT hospital_id, COUNT(*) AS cnt FROM order_inspections
     WHERE status='pending' AND hospital_id IN (${ph})
     GROUP BY hospital_id`
  ).bind(...hids).all().catch(() => ({ results: [] }))
  const inspMap: Record<number, number> = {}
  ;(inspR.results as any[]).forEach((r: any) => { inspMap[r.hospital_id] = r.cnt || 0 })

  // 업체별 발주 (집중도 계산용)
  const vendorOrdR = await c.env.DB.prepare(
    `SELECT do.hospital_id, do.vendor_id, SUM(do.total_amount) AS amt
     FROM daily_orders do
     WHERE do.order_date BETWEEN ? AND ? AND do.hospital_id IN (${ph})
     GROUP BY do.hospital_id, do.vendor_id`
  ).bind(start, end, ...hids).all()
  const vendorMap: Record<number, {id: number; amt: number}[]> = {}
  ;(vendorOrdR.results as any[]).forEach((r: any) => {
    if (!vendorMap[r.hospital_id]) vendorMap[r.hospital_id] = []
    vendorMap[r.hospital_id].push({ id: r.vendor_id, amt: r.amt || 0 })
  })

  // 카테고리별 식단가 (patient_categories care_type 기반)
  const catMealR = await c.env.DB.prepare(
    `SELECT dc.hospital_id, pc.care_type AS ct, SUM(dc.total_count) AS cnt
     FROM daily_category_meal_counts dc
     JOIN patient_categories pc ON pc.id = dc.patient_category_id
     WHERE dc.meal_date BETWEEN ? AND ? AND dc.hospital_id IN (${ph})
     GROUP BY dc.hospital_id, pc.care_type`
  ).bind(start, end, ...hids).all().catch(() => ({ results: [] }))
  const catMealMap: Record<string, number> = {}
  ;(catMealR.results as any[]).forEach((r: any) => {
    catMealMap[`${r.hospital_id}__${r.ct}`] = (catMealMap[`${r.hospital_id}__${r.ct}`] || 0) + (r.cnt || 0)
  })

  const catOrdR = await c.env.DB.prepare(
    `SELECT dc.hospital_id, pc.care_type AS ct, SUM(dc.total_amount) AS amt
     FROM daily_category_orders dc
     JOIN patient_categories pc ON pc.id = dc.patient_category_id
     WHERE dc.order_date BETWEEN ? AND ? AND dc.hospital_id IN (${ph})
     GROUP BY dc.hospital_id, pc.care_type`
  ).bind(start, end, ...hids).all().catch(() => ({ results: [] }))
  const catOrdMap: Record<string, number> = {}
  ;(catOrdR.results as any[]).forEach((r: any) => {
    catOrdMap[`${r.hospital_id}__${r.ct}`] = (catOrdMap[`${r.hospital_id}__${r.ct}`] || 0) + (r.amt || 0)
  })

  // 일별 발주 (이상치 계산용)
  const dailyOrdR = await c.env.DB.prepare(
    `SELECT hospital_id, order_date, SUM(total_amount) AS amt
     FROM daily_orders WHERE order_date BETWEEN ? AND ? AND hospital_id IN (${ph})
     GROUP BY hospital_id, order_date`
  ).bind(start, end, ...hids).all()
  const dailyOrdMap: Record<number, number[]> = {}
  ;(dailyOrdR.results as any[]).forEach((r: any) => {
    if (!dailyOrdMap[r.hospital_id]) dailyOrdMap[r.hospital_id] = []
    dailyOrdMap[r.hospital_id].push(r.amt || 0)
  })

  // 조립
  const result = hosps.map((h: any) => {
    const budget  = bMap[h.id]?.total_budget || 0
    const target  = bMap[h.id]?.meal_price   || 0
    const used    = oMap[h.id]  || 0
    const meals   = mMap[h.id]  || 0
    const today_o = todayMap[h.id] || 0
    const pendInsp = inspMap[h.id] || 0
    const budgetPct = budget > 0 ? Math.round(used / budget * 100) : 0
    const mealPrice = meals > 0 ? Math.round(used / meals) : 0

    // 업체 집중도
    const vList = vendorMap[h.id] || []
    const vTotal = vList.reduce((s: number, v: any) => s + v.amt, 0)
    const maxVendor = vList.length > 0 ? vList.reduce((a: any, b: any) => a.amt > b.amt ? a : b) : null
    const vendorConcentration = (vTotal > 0 && maxVendor) ? Math.round(maxVendor.amt / vTotal * 100) : 0

    // 발주 이상치 (오늘 발주가 최근 평균의 2배 이상)
    const dailyAmts = dailyOrdMap[h.id] || []
    const avgDaily  = dailyAmts.length > 0 ? dailyAmts.reduce((a: number, b: number) => a + b, 0) / dailyAmts.length : 0
    const orderAnomaly = (today_o > 0 && avgDaily > 0 && today_o >= avgDaily * 2)

    // 카테고리별 식단가
    const catTypes = ['oncology', 'nursing_care', 'rehab']
    const mealPriceByCategory: Record<string, number> = {}
    catTypes.forEach(ct => {
      const m = catMealMap[`${h.id}__${ct}`] || 0
      const o = catOrdMap[`${h.id}__${ct}`]  || 0
      mealPriceByCategory[ct] = m > 0 ? Math.round(o / m) : 0
    })

    // 경고 수 계산
    let alertCount = 0
    const alerts: string[] = []
    if (budgetPct >= 90)           { alertCount++; alerts.push(`예산 ${budgetPct}% 소진`) }
    else if (budgetPct >= 80)      { alertCount++; alerts.push(`예산 주의 ${budgetPct}%`) }
    if (target > 0) {
      const mpPct = Math.round(mealPrice / target * 100)
      if (mpPct >= 110)            { alertCount++; alerts.push(`식단가 ${mpPct}% 초과`) }
      else if (mpPct >= 105)       { alertCount++; alerts.push(`식단가 주의 ${mpPct}%`) }
    }
    if (vendorConcentration >= 60) { alertCount++; alerts.push(`업체집중도 위험 ${vendorConcentration}%`) }
    else if (vendorConcentration >= 40) { alertCount++; alerts.push(`업체집중도 주의 ${vendorConcentration}%`) }
    if (pendInsp > 0)              { alertCount++; alerts.push(`검수 미완료 ${pendInsp}건`) }
    if (orderAnomaly)              { alertCount++; alerts.push(`발주 이상치 감지`) }

    // 위험 등급
    const riskLevel = alertCount === 0 ? 'safe' : alertCount === 1 ? 'warn' : 'danger'

    return {
      id: h.id, name: h.name,
      hospitalType: h.hospital_type, careType: h.care_type,
      licensedBeds: h.licensed_beds, operationType: h.operation_type,
      budget, used, remaining: budget - used, budgetPct, target,
      mealPrice, meals, todayOrder: today_o,
      pendingInspections: pendInsp, vendorConcentration, orderAnomaly,
      mealPriceByCategory,
      alertCount, alerts, riskLevel
    }
  })

  return c.json(result)
})

// ─── 4. 그래프 데이터 ─────────────────────────────────────────
// GET /api/ceo-dashboard/graphs/:year/:month
app.get('/graphs/:year/:month', async (c) => {
  const year  = parseInt(c.req.param('year'))
  const month = parseInt(c.req.param('month'))
  const { start, end } = ymRange(year, month)

  // 모든 병원 기본 정보
  const hospsR = await c.env.DB.prepare(
    `SELECT h.id, h.name,
            COALESCE(hi.hospital_type,'general') AS hospital_type,
            COALESCE(hi.care_type,'general')     AS care_type,
            COALESCE(hi.licensed_beds,0)         AS licensed_beds
     FROM hospitals h LEFT JOIN hospital_info hi ON hi.hospital_id=h.id ORDER BY h.name`
  ).all()
  const hosps = hospsR.results as any[]
  if (hosps.length === 0) return c.json({ graph1: [], graph2: {}, graph3: [], graph4: [] })

  const hids = hosps.map((h: any) => h.id)
  const ph   = hids.map(() => '?').join(',')

  // 예산
  const budR = await c.env.DB.prepare(
    `SELECT hospital_id, total_budget, meal_price FROM monthly_settings WHERE year=? AND month=? AND hospital_id IN (${ph})`
  ).bind(year, month, ...hids).all()
  const budMap: Record<number, any> = {}
  ;(budR.results as any[]).forEach((r: any) => { budMap[r.hospital_id] = r })

  // 발주
  const ordR = await c.env.DB.prepare(
    `SELECT hospital_id, SUM(total_amount) AS used FROM daily_orders WHERE order_date BETWEEN ? AND ? AND hospital_id IN (${ph}) GROUP BY hospital_id`
  ).bind(start, end, ...hids).all()
  const ordMap: Record<number, number> = {}
  ;(ordR.results as any[]).forEach((r: any) => { ordMap[r.hospital_id] = r.used || 0 })

  // 식수
  const mealR = await c.env.DB.prepare(
    `SELECT hospital_id, SUM(patient_count + COALESCE(staff_count,0) + COALESCE(guardian_count,0)) AS total_meals
     FROM daily_meals WHERE meal_date BETWEEN ? AND ? AND hospital_id IN (${ph}) GROUP BY hospital_id`
  ).bind(start, end, ...hids).all()
  const mealMap: Record<number, number> = {}
  ;(mealR.results as any[]).forEach((r: any) => { mealMap[r.hospital_id] = r.total_meals || 0 })

  // 카테고리별 식단가 (그래프2)
  const catMealR = await c.env.DB.prepare(
    `SELECT dc.hospital_id, pc.care_type AS ct, SUM(dc.total_count) AS cnt
     FROM daily_category_meal_counts dc JOIN patient_categories pc ON pc.id=dc.patient_category_id
     WHERE dc.meal_date BETWEEN ? AND ? AND dc.hospital_id IN (${ph}) AND pc.care_type IS NOT NULL
     GROUP BY dc.hospital_id, pc.care_type`
  ).bind(start, end, ...hids).all().catch(() => ({ results: [] }))
  const catMMap: Record<string, number> = {}
  ;(catMealR.results as any[]).forEach((r: any) => {
    catMMap[`${r.hospital_id}__${r.ct}`] = (catMMap[`${r.hospital_id}__${r.ct}`] || 0) + (r.cnt || 0)
  })

  const catOrdR = await c.env.DB.prepare(
    `SELECT dc.hospital_id, pc.care_type AS ct, SUM(dc.total_amount) AS amt
     FROM daily_category_orders dc JOIN patient_categories pc ON pc.id=dc.patient_category_id
     WHERE dc.order_date BETWEEN ? AND ? AND dc.hospital_id IN (${ph}) AND pc.care_type IS NOT NULL
     GROUP BY dc.hospital_id, pc.care_type`
  ).bind(start, end, ...hids).all().catch(() => ({ results: [] }))
  const catOMap: Record<string, number> = {}
  ;(catOrdR.results as any[]).forEach((r: any) => {
    catOMap[`${r.hospital_id}__${r.ct}`] = (catOMap[`${r.hospital_id}__${r.ct}`] || 0) + (r.amt || 0)
  })

  // 그래프1: 병원유형별 평균 예산 사용률
  const typeMap: Record<string, { pctSum: number; cnt: number }> = {}
  hosps.forEach((h: any) => {
    const budget = budMap[h.id]?.total_budget || 0
    const used   = ordMap[h.id] || 0
    const pct    = budget > 0 ? used / budget * 100 : 0
    const key    = h.hospital_type
    if (!typeMap[key]) typeMap[key] = { pctSum: 0, cnt: 0 }
    typeMap[key].pctSum += pct; typeMap[key].cnt++
  })
  const graph1 = Object.entries(typeMap).map(([type, d]) => ({
    type, avgBudgetPct: Math.round(d.pctSum / d.cnt)
  }))

  // 그래프2: care_type별 평균 식단가
  const careTypes = ['oncology', 'nursing_care', 'rehab']
  const graph2: Record<string, number> = {}
  careTypes.forEach(ct => {
    let total = 0, cnt = 0
    hids.forEach((hid: number) => {
      const m = catMMap[`${hid}__${ct}`] || 0
      const o = catOMap[`${hid}__${ct}`] || 0
      if (m > 0) { total += Math.round(o / m); cnt++ }
    })
    graph2[ct] = cnt > 0 ? Math.round(total / cnt) : 0
  })

  // 그래프3: 병원별 식단가 비교
  const graph3 = hosps.map((h: any) => {
    const used  = ordMap[h.id]  || 0
    const meals = mealMap[h.id] || 0
    const target = budMap[h.id]?.meal_price || 0
    return {
      id: h.id, name: h.name,
      mealPrice: meals > 0 ? Math.round(used / meals) : 0,
      target, hospitalType: h.hospital_type, careType: h.care_type
    }
  }).filter((h: any) => h.mealPrice > 0)

  // 그래프4: 식수 vs 발주금액 (산점도)
  const graph4 = hosps.map((h: any) => {
    const meals = mealMap[h.id] || 0
    const used  = ordMap[h.id]  || 0
    const mealPrice = meals > 0 ? Math.round(used / meals) : 0
    const target    = budMap[h.id]?.meal_price || 0
    const anomaly   = target > 0 && mealPrice > target * 1.1
    return { id: h.id, name: h.name, meals, used, mealPrice, anomaly }
  }).filter((h: any) => h.meals > 0 || h.used > 0)

  return c.json({ graph1, graph2, graph3, graph4 })
})

// ─── 5. AI 경고 & 인사이트 ────────────────────────────────────
// GET /api/ceo-dashboard/alerts/:year/:month
app.get('/alerts/:year/:month', async (c) => {
  const year  = parseInt(c.req.param('year'))
  const month = parseInt(c.req.param('month'))
  const { start, end } = ymRange(year, month)
  const today = new Date().toISOString().slice(0, 10)

  const hospsR = await c.env.DB.prepare(
    `SELECT h.id, h.name FROM hospitals h ORDER BY h.name`
  ).all()
  const hosps = hospsR.results as any[]
  if (hosps.length === 0) return c.json({ alerts: [], insights: [] })

  const hids = hosps.map((h: any) => h.id)
  const ph   = hids.map(() => '?').join(',')
  const hNameMap: Record<number, string> = {}
  hosps.forEach((h: any) => { hNameMap[h.id] = h.name })

  // 예산
  const budR = await c.env.DB.prepare(
    `SELECT hospital_id, total_budget, meal_price FROM monthly_settings WHERE year=? AND month=? AND hospital_id IN (${ph})`
  ).bind(year, month, ...hids).all()
  const budMap: Record<number, any> = {}
  ;(budR.results as any[]).forEach((r: any) => { budMap[r.hospital_id] = r })

  // 발주 월합계
  const ordR = await c.env.DB.prepare(
    `SELECT hospital_id, SUM(total_amount) AS used FROM daily_orders
     WHERE order_date BETWEEN ? AND ? AND hospital_id IN (${ph}) GROUP BY hospital_id`
  ).bind(start, end, ...hids).all()
  const ordMap: Record<number, number> = {}
  ;(ordR.results as any[]).forEach((r: any) => { ordMap[r.hospital_id] = r.used || 0 })

  // 일별 발주 (이상치)
  const dailyR = await c.env.DB.prepare(
    `SELECT hospital_id, order_date, SUM(total_amount) AS amt FROM daily_orders
     WHERE order_date BETWEEN ? AND ? AND hospital_id IN (${ph})
     GROUP BY hospital_id, order_date ORDER BY order_date`
  ).bind(start, end, ...hids).all()
  const dailyMap: Record<number, { date: string; amt: number }[]> = {}
  ;(dailyR.results as any[]).forEach((r: any) => {
    if (!dailyMap[r.hospital_id]) dailyMap[r.hospital_id] = []
    dailyMap[r.hospital_id].push({ date: r.order_date, amt: r.amt || 0 })
  })

  // 식수
  const mealR = await c.env.DB.prepare(
    `SELECT hospital_id, SUM(patient_count + COALESCE(staff_count,0) + COALESCE(guardian_count,0)) AS total_meals
     FROM daily_meals WHERE meal_date BETWEEN ? AND ? AND hospital_id IN (${ph}) GROUP BY hospital_id`
  ).bind(start, end, ...hids).all()
  const mealMap: Record<number, number> = {}
  ;(mealR.results as any[]).forEach((r: any) => { mealMap[r.hospital_id] = r.total_meals || 0 })

  // 업체 집중도
  const vOrdR = await c.env.DB.prepare(
    `SELECT hospital_id, vendor_id, SUM(total_amount) AS amt FROM daily_orders
     WHERE order_date BETWEEN ? AND ? AND hospital_id IN (${ph})
     GROUP BY hospital_id, vendor_id`
  ).bind(start, end, ...hids).all()
  const vMap: Record<number, { id: number; amt: number }[]> = {}
  ;(vOrdR.results as any[]).forEach((r: any) => {
    if (!vMap[r.hospital_id]) vMap[r.hospital_id] = []
    vMap[r.hospital_id].push({ id: r.vendor_id, amt: r.amt || 0 })
  })

  // 검수 미완료
  const inspR = await c.env.DB.prepare(
    `SELECT hospital_id, COUNT(*) AS cnt FROM order_inspections WHERE status='pending' AND hospital_id IN (${ph}) GROUP BY hospital_id`
  ).bind(...hids).all().catch(() => ({ results: [] }))
  const inspMap: Record<number, number> = {}
  ;(inspR.results as any[]).forEach((r: any) => { inspMap[r.hospital_id] = r.cnt || 0 })

  // 경고 생성
  const alerts: { level: 'danger' | 'warn' | 'info'; message: string; hospitalId?: number; hospitalName?: string }[] = []

  hids.forEach((hid: number) => {
    const name    = hNameMap[hid]
    const budget  = budMap[hid]?.total_budget || 0
    const target  = budMap[hid]?.meal_price   || 0
    const used    = ordMap[hid]  || 0
    const meals   = mealMap[hid] || 0
    const mealPrice = meals > 0 ? Math.round(used / meals) : 0
    const budgetPct = budget > 0 ? Math.round(used / budget * 100) : 0

    // 예산 경고
    if (budgetPct >= 90)      alerts.push({ level: 'danger', message: `${name} 예산 소진율 ${budgetPct}% – 위험 수준`, hospitalId: hid, hospitalName: name })
    else if (budgetPct >= 80) alerts.push({ level: 'warn',   message: `${name} 예산 소진율 ${budgetPct}% – 주의 필요`, hospitalId: hid, hospitalName: name })

    // 식단가 경고
    if (target > 0) {
      const mpPct = Math.round(mealPrice / target * 100)
      if (mpPct >= 110)      alerts.push({ level: 'danger', message: `${name} 식단가 목표 대비 ${mpPct}% – 위험 초과`, hospitalId: hid, hospitalName: name })
      else if (mpPct >= 105) alerts.push({ level: 'warn',   message: `${name} 식단가 목표 대비 ${mpPct}% – 주의 수준`, hospitalId: hid, hospitalName: name })
    }

    // 업체 집중도
    const vList  = vMap[hid] || []
    const vTotal = vList.reduce((s: number, v: any) => s + v.amt, 0)
    if (vList.length > 0 && vTotal > 0) {
      const topV = vList.reduce((a: any, b: any) => a.amt > b.amt ? a : b)
      const conc = Math.round(topV.amt / vTotal * 100)
      if (conc >= 60)      alerts.push({ level: 'danger', message: `${name} 특정 업체 발주 집중도 ${conc}% – 공급 리스크`, hospitalId: hid, hospitalName: name })
      else if (conc >= 40) alerts.push({ level: 'warn',   message: `${name} 특정 업체 발주 집중도 ${conc}% – 주의`, hospitalId: hid, hospitalName: name })
    }

    // 검수 미완료
    const insp = inspMap[hid] || 0
    if (insp > 0) alerts.push({ level: 'warn', message: `${name} 검수 미완료 ${insp}건 대기 중`, hospitalId: hid, hospitalName: name })

    // 발주 이상치 (최근 평균 대비 2배)
    const dailyAmts = (dailyMap[hid] || []).map((d: any) => d.amt)
    if (dailyAmts.length >= 3) {
      const avg = dailyAmts.slice(0, -1).reduce((a: number, b: number) => a + b, 0) / (dailyAmts.length - 1)
      const last = dailyAmts[dailyAmts.length - 1]
      if (avg > 0 && last >= avg * 2) {
        alerts.push({ level: 'danger', message: `${name} 최근 발주금액 평균 대비 ${Math.round(last/avg*100)}% – 이상치 감지`, hospitalId: hid, hospitalName: name })
      }
    }
  })

  // 인사이트 생성 (데이터 패턴 기반 문장)
  const insights: string[] = []
  const dangerCount = alerts.filter(a => a.level === 'danger').length
  const warnCount   = alerts.filter(a => a.level === 'warn').length

  if (dangerCount === 0 && warnCount === 0) {
    insights.push('이번 달 전체 병원의 운영 상태는 정상 범위입니다.')
  } else {
    if (dangerCount > 0) insights.push(`위험 경고 ${dangerCount}건이 확인됩니다. 즉시 검토가 필요합니다.`)
    if (warnCount > 0)   insights.push(`주의 경고 ${warnCount}건이 확인됩니다. 추이를 모니터링하세요.`)
  }

  // 예산 소진 빠른 병원
  const highBudgetHosps = hids.filter((hid: number) => {
    const b = budMap[hid]?.total_budget || 0
    const u = ordMap[hid] || 0
    return b > 0 && u / b >= 0.8
  }).map((hid: number) => hNameMap[hid])
  if (highBudgetHosps.length > 0) {
    insights.push(`${highBudgetHosps.join(', ')} 등 ${highBudgetHosps.length}개 병원은 현재 추세 기준 월말 전 예산 소진 가능성이 있습니다.`)
  }

  // 업체 집중도 높은 병원
  const concHosps = hids.filter((hid: number) => {
    const vList = vMap[hid] || []
    const vTotal = vList.reduce((s: number, v: any) => s + v.amt, 0)
    if (vList.length === 0 || vTotal === 0) return false
    const top = vList.reduce((a: any, b: any) => a.amt > b.amt ? a : b)
    return top.amt / vTotal >= 0.4
  })
  if (concHosps.length > 0) {
    insights.push(`${concHosps.length}개 병원에서 상위 업체 발주 비중이 높게 나타나고 있습니다. 공급처 분산을 검토하세요.`)
  }

  // 전체 평균 식단가 추이
  const mpList = hids.map((hid: number) => {
    const u = ordMap[hid] || 0; const m = mealMap[hid] || 0
    return m > 0 ? Math.round(u / m) : 0
  }).filter((p: number) => p > 0)
  if (mpList.length > 0) {
    const avgMp = Math.round(mpList.reduce((a: number, b: number) => a + b, 0) / mpList.length)
    const overTargetCount = hids.filter((hid: number) => {
      const t = budMap[hid]?.meal_price || 0
      const u = ordMap[hid] || 0; const m = mealMap[hid] || 0
      const mp = m > 0 ? Math.round(u / m) : 0
      return t > 0 && mp > t * 1.05
    }).length
    if (overTargetCount > 0) {
      insights.push(`${overTargetCount}개 병원의 식단가가 목표를 초과하고 있으며, 전체 평균은 ${avgMp.toLocaleString()}원입니다.`)
    } else {
      insights.push(`전체 평균 식단가는 ${avgMp.toLocaleString()}원으로 안정적인 수준입니다.`)
    }
  }

  // 검수 미완료 총합
  const totalInsp = Object.values(inspMap).reduce((a: number, b: number) => a + b, 0)
  if (totalInsp > 0) {
    insights.push(`총 ${totalInsp}건의 검수가 미완료 상태입니다. 담당 영양사 확인을 요청하세요.`)
  }

  return c.json({ alerts, insights })
})

// ─── 6. 지출 사용내역 조회 ────────────────────────────────────
// GET /api/ceo-dashboard/expenses/:year/:month?hospital_id=&expense_type=
app.get('/expenses/:year/:month', async (c) => {
  const year  = parseInt(c.req.param('year'))
  const month = parseInt(c.req.param('month'))
  const start = `${ym(year, month)}-01`
  const end   = `${ym(year, month)}-31`

  const hospitalId   = c.req.query('hospital_id')   || ''
  const expenseType  = c.req.query('expense_type')  || ''

  const conds: string[] = ['ce.expense_date BETWEEN ? AND ?']
  const args: any[]     = [start, end]

  if (hospitalId)  { conds.push('ce.hospital_id = ?');   args.push(parseInt(hospitalId)) }
  if (expenseType) { conds.push('ce.expense_type = ?');  args.push(expenseType) }

  const rows = await c.env.DB.prepare(
    `SELECT ce.id, ce.expense_date, h.name AS hospital_name,
            ce.vendor_name, ce.amount, ce.item_name, ce.usage_purpose,
            COALESCE(ce.expense_type,'법인카드') AS expense_type, ce.memo
     FROM card_expenses ce
     JOIN hospitals h ON h.id = ce.hospital_id
     WHERE ${conds.join(' AND ')}
     ORDER BY ce.expense_date DESC, h.name
     LIMIT 500`
  ).bind(...args).all()

  return c.json(rows.results)
})

export default app
