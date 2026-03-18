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

// 필터 WHERE 절 빌더 (공통)
function buildHospitalFilter(
  hospitalType: string, operationType: string, careType: string,
  bedSize: string, hospitalId: string
): { conds: string[]; args: any[] } {
  const conds: string[] = ['1=1']
  const args: any[]     = []

  if (hospitalType)  { conds.push('COALESCE(hi.hospital_type,\'general\') = ?');  args.push(hospitalType) }
  if (operationType) { conds.push('COALESCE(hi.operation_type,\'direct\') = ?');  args.push(operationType) }
  if (careType)      { conds.push('COALESCE(hi.care_type,\'general\') = ?');      args.push(careType) }
  if (hospitalId)    { conds.push('h.id = ?');                                     args.push(parseInt(hospitalId)) }
  if (bedSize) {
    if      (bedSize === 'under30')  conds.push('COALESCE(hi.licensed_beds,0) <= 30')
    else if (bedSize === '31to60')   conds.push('COALESCE(hi.licensed_beds,0) BETWEEN 31 AND 60')
    else if (bedSize === '61to100')  conds.push('COALESCE(hi.licensed_beds,0) BETWEEN 61 AND 100')
    else if (bedSize === 'over100')  conds.push('COALESCE(hi.licensed_beds,0) > 100')
  }
  return { conds, args }
}

// ─── 1. care_type 코드 목록 ──────────────────────────────────
app.get('/care-types', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT code, label_ko, sort_order FROM care_type_codes WHERE is_active=1 ORDER BY sort_order`
  ).all()
  return c.json(rows.results)
})

// ─── 2. KPI 집계 ─────────────────────────────────────────────
app.get('/kpi/:year/:month', async (c) => {
  const year  = parseInt(c.req.param('year'))
  const month = parseInt(c.req.param('month'))
  const { start, end } = ymRange(year, month)

  const hospitalType  = c.req.query('hospital_type')   || ''
  const operationType = c.req.query('operation_type')  || ''
  const careType      = c.req.query('care_type')       || ''
  const bedSize       = c.req.query('bed_size')        || ''
  const hospitalId    = c.req.query('hospital_id')     || ''

  const { conds, args } = buildHospitalFilter(hospitalType, operationType, careType, bedSize, hospitalId)
  const where = conds.join(' AND ')

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

  // 예산 설정
  const budgetR = await c.env.DB.prepare(
    `SELECT hospital_id, total_budget, meal_price FROM monthly_settings
     WHERE year=? AND month=? AND hospital_id IN (${ph})`
  ).bind(year, month, ...hids).all()
  const budgetMap: Record<number, any> = {}
  ;(budgetR.results as any[]).forEach((r: any) => { budgetMap[r.hospital_id] = r })

  // 발주 집계
  const orderR = await c.env.DB.prepare(
    `SELECT hospital_id, SUM(total_amount) AS used
     FROM daily_orders
     WHERE order_date BETWEEN ? AND ? AND hospital_id IN (${ph})
     GROUP BY hospital_id`
  ).bind(start, end, ...hids).all()
  const orderMap: Record<number, number> = {}
  ;(orderR.results as any[]).forEach((r: any) => { orderMap[r.hospital_id] = r.used || 0 })

  // 총 식수 집계
  const mealR = await c.env.DB.prepare(
    `SELECT hospital_id,
            SUM(
              COALESCE(breakfast_patient,0)+COALESCE(lunch_patient,0)+COALESCE(dinner_patient,0)+
              COALESCE(breakfast_staff,0)+COALESCE(lunch_staff,0)+COALESCE(dinner_staff,0)+
              COALESCE(breakfast_guardian,0)+COALESCE(lunch_guardian,0)+COALESCE(dinner_guardian,0)
            ) AS total_meals
     FROM daily_meals
     WHERE meal_date BETWEEN ? AND ? AND hospital_id IN (${ph})
     GROUP BY hospital_id`
  ).bind(start, end, ...hids).all()
  const mealMap: Record<number, number> = {}
  ;(mealR.results as any[]).forEach((r: any) => { mealMap[r.hospital_id] = r.total_meals || 0 })

  // 카테고리별 식단가: daily_orders의 patient_category_id → hospital_patient_categories.category_key
  const catOrdR = await c.env.DB.prepare(
    `SELECT do.hospital_id, hpc.category_key, SUM(do.total_amount) AS amt
     FROM daily_orders do
     JOIN hospital_patient_categories hpc ON hpc.id = do.patient_category_id
     WHERE do.order_date BETWEEN ? AND ? AND do.hospital_id IN (${ph})
       AND do.patient_category_id IS NOT NULL
     GROUP BY do.hospital_id, hpc.category_key`
  ).bind(start, end, ...hids).all().catch(() => ({ results: [] }))

  // 카테고리별 식수: daily_meals의 custom_data JSON에서 cat_xxx 키 합산
  // → 전체 식수에서 비율로 추정 (단순화)
  const catOrdMap: Record<string, number> = {}
  ;(catOrdR.results as any[]).forEach((r: any) => {
    catOrdMap[`${r.hospital_id}__${r.category_key}`] = r.amt || 0
  })

  // 카테고리별 식수 (custom_data JSON 파싱은 SQLite에서 어려우므로, 발주 기준 추정)
  const catMealR = await c.env.DB.prepare(
    `SELECT do.hospital_id, hpc.category_key, COUNT(DISTINCT do.order_date) AS days,
            SUM(do.total_amount) AS amt
     FROM daily_orders do
     JOIN hospital_patient_categories hpc ON hpc.id = do.patient_category_id
     WHERE do.order_date BETWEEN ? AND ? AND do.hospital_id IN (${ph})
       AND do.patient_category_id IS NOT NULL
     GROUP BY do.hospital_id, hpc.category_key`
  ).bind(start, end, ...hids).all().catch(() => ({ results: [] }))

  // category_order_settings에서 목표 식단가 가져오기
  const cosR = await c.env.DB.prepare(
    `SELECT cos.hospital_id, hpc.category_key, cos.target_meal_price, cos.monthly_budget, cos.working_days, cos.daily_meal_count
     FROM category_order_settings cos
     JOIN hospital_patient_categories hpc ON hpc.id = cos.patient_category_id
     WHERE cos.year=? AND cos.month=? AND cos.hospital_id IN (${ph})`
  ).bind(year, month, ...hids).all().catch(() => ({ results: [] }))
  const cosMap: Record<string, any> = {}
  ;(cosR.results as any[]).forEach((r: any) => {
    cosMap[`${r.hospital_id}__${r.category_key}`] = r
  })

  // 카테고리별 평균 식단가 계산
  const mealPriceByCategory: Record<string, { totalOrders: number; targetPrice: number; avgPrice: number }> = {}
  ;(catMealR.results as any[]).forEach((r: any) => {
    const key = r.category_key
    const cos = cosMap[`${r.hospital_id}__${key}`]
    const targetDailyMeals = cos?.daily_meal_count || 0
    const workingDays = cos?.working_days || 1
    const estimatedMeals = targetDailyMeals > 0 ? targetDailyMeals * workingDays : (r.days || 1) * 30 // 추정
    const avgPrice = estimatedMeals > 0 ? Math.round((r.amt || 0) / estimatedMeals) : 0
    if (!mealPriceByCategory[key]) mealPriceByCategory[key] = { totalOrders: 0, targetPrice: cos?.target_meal_price || 0, avgPrice: 0 }
    mealPriceByCategory[key].totalOrders += r.amt || 0
    mealPriceByCategory[key].avgPrice = avgPrice
  })

  // 검수 미완료
  const inspR = await c.env.DB.prepare(
    `SELECT DISTINCT hospital_id FROM order_inspections
     WHERE status='pending' AND hospital_id IN (${ph})`
  ).bind(...hids).all().catch(() => ({ results: [] }))
  const pendingInspectCount = (inspR.results as any[]).length

  // 집계
  let totalBudget = 0, totalUsed = 0
  let budgetPctSum = 0, budgetPctCnt = 0
  let mealPriceSum = 0, mealPriceCnt = 0
  let dangerBudgetCount = 0, dangerMealCount = 0

  hids.forEach((hid: number) => {
    const budget = budgetMap[hid]?.total_budget || 0
    const used   = orderMap[hid] || 0
    const meals  = mealMap[hid]  || 0
    const target = budgetMap[hid]?.meal_price || 0

    totalBudget += budget
    totalUsed   += used

    if (budget > 0) {
      const pct = used / budget * 100
      budgetPctSum += pct; budgetPctCnt++
      if (pct >= 90) dangerBudgetCount++   // ≥90% = 위험
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
app.get('/hospitals/:year/:month', async (c) => {
  const year  = parseInt(c.req.param('year'))
  const month = parseInt(c.req.param('month'))
  const { start, end } = ymRange(year, month)
  const today = new Date().toISOString().slice(0, 10)

  const hospitalType  = c.req.query('hospital_type')   || ''
  const operationType = c.req.query('operation_type')  || ''
  const careType      = c.req.query('care_type')       || ''
  const bedSize       = c.req.query('bed_size')        || ''
  const hospitalId    = c.req.query('hospital_id')     || ''

  const { conds, args } = buildHospitalFilter(hospitalType, operationType, careType, bedSize, hospitalId)
  const where = conds.join(' AND ')

  // 병원 기본 정보
  const hospsR = await c.env.DB.prepare(
    `SELECT h.id, h.name,
            COALESCE(hi.hospital_type,'general')  AS hospital_type,
            COALESCE(hi.care_type,'general')      AS care_type,
            COALESCE(hi.licensed_beds,0)          AS licensed_beds,
            COALESCE(hi.operation_type,'direct')  AS operation_type
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
            SUM(COALESCE(breakfast_patient,0)+COALESCE(lunch_patient,0)+COALESCE(dinner_patient,0)+
                COALESCE(breakfast_staff,0)+COALESCE(lunch_staff,0)+COALESCE(dinner_staff,0)+
                COALESCE(breakfast_guardian,0)+COALESCE(lunch_guardian,0)+COALESCE(dinner_guardian,0)) AS total_meals
     FROM daily_meals WHERE meal_date BETWEEN ? AND ? AND hospital_id IN (${ph})
     GROUP BY hospital_id`
  ).bind(start, end, ...hids).all()
  const mMap: Record<number, number> = {}
  ;(mealR.results as any[]).forEach((r: any) => { mMap[r.hospital_id] = r.total_meals || 0 })

  // 검수 미완료 (건수)
  const inspR = await c.env.DB.prepare(
    `SELECT hospital_id, COUNT(*) AS cnt FROM order_inspections
     WHERE status='pending' AND hospital_id IN (${ph})
     GROUP BY hospital_id`
  ).bind(...hids).all().catch(() => ({ results: [] }))
  const inspMap: Record<number, number> = {}
  ;(inspR.results as any[]).forEach((r: any) => { inspMap[r.hospital_id] = r.cnt || 0 })

  // 업체별 발주 (집중도 계산)
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

  // 카테고리별 발주 (patient_category_id 기준)
  const catOrdR = await c.env.DB.prepare(
    `SELECT do.hospital_id, hpc.category_key, SUM(do.total_amount) AS amt
     FROM daily_orders do
     JOIN hospital_patient_categories hpc ON hpc.id = do.patient_category_id
     WHERE do.order_date BETWEEN ? AND ? AND do.hospital_id IN (${ph})
       AND do.patient_category_id IS NOT NULL
     GROUP BY do.hospital_id, hpc.category_key`
  ).bind(start, end, ...hids).all().catch(() => ({ results: [] }))
  const catOrdMap: Record<string, number> = {}
  ;(catOrdR.results as any[]).forEach((r: any) => {
    catOrdMap[`${r.hospital_id}__${r.category_key}`] = r.amt || 0
  })

  // category_order_settings (카테고리 목표 식단가, 일일 식수)
  const cosR = await c.env.DB.prepare(
    `SELECT cos.hospital_id, hpc.category_key, cos.target_meal_price,
            cos.monthly_budget, cos.working_days, cos.daily_meal_count
     FROM category_order_settings cos
     JOIN hospital_patient_categories hpc ON hpc.id = cos.patient_category_id
     WHERE cos.year=? AND cos.month=? AND cos.hospital_id IN (${ph})`
  ).bind(year, month, ...hids).all().catch(() => ({ results: [] }))
  const cosMap: Record<string, any> = {}
  ;(cosR.results as any[]).forEach((r: any) => {
    cosMap[`${r.hospital_id}__${r.category_key}`] = r
  })

  // 일별 발주 (이상치)
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

  // hospital_patient_categories 목록 (카테고리별 식단가 표시용)
  const hpcR = await c.env.DB.prepare(
    `SELECT hospital_id, category_key, category_name FROM hospital_patient_categories
     WHERE hospital_id IN (${ph}) AND is_active=1`
  ).bind(...hids).all().catch(() => ({ results: [] }))
  const hpcMap: Record<number, {key:string; name:string}[]> = {}
  ;(hpcR.results as any[]).forEach((r: any) => {
    if (!hpcMap[r.hospital_id]) hpcMap[r.hospital_id] = []
    hpcMap[r.hospital_id].push({ key: r.category_key, name: r.category_name })
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

    // 카테고리별 식단가 (category_key 기준)
    const categories = hpcMap[h.id] || []
    const mealPriceByCategory: Record<string, { name: string; price: number; targetPrice: number; budget: number }> = {}
    categories.forEach((cat) => {
      const catOrds = catOrdMap[`${h.id}__${cat.key}`] || 0
      if (!catOrds) return  // 발주 없으면 스킵
      const cos = cosMap[`${h.id}__${cat.key}`]
      const dailyMeals = cos?.daily_meal_count || 0
      const workingDays = cos?.working_days || 0
      // daily_meal_count * working_days가 있으면 식수 기반 계산, 없으면 발주액만 표시
      const estMeals = (dailyMeals > 0 && workingDays > 0) ? dailyMeals * workingDays : 0
      const catPrice = estMeals > 0 ? Math.round(catOrds / estMeals) : 0
      mealPriceByCategory[cat.key] = {
        name: cat.name,
        price: catPrice,           // 식단가 (식수 기반 계산값, 없으면 0)
        targetPrice: cos?.target_meal_price || 0,
        budget: cos?.monthly_budget || 0
      }
    })

    // 업체 집중도
    const vList = vendorMap[h.id] || []
    const vTotal = vList.reduce((s: number, v: any) => s + v.amt, 0)
    const maxVendor = vList.length > 0 ? vList.reduce((a: any, b: any) => a.amt > b.amt ? a : b) : null
    const vendorConcentration = (vTotal > 0 && maxVendor) ? Math.round(maxVendor.amt / vTotal * 100) : 0

    // 발주 이상치
    const dailyAmts = dailyOrdMap[h.id] || []
    const avgDaily  = dailyAmts.length > 0 ? dailyAmts.reduce((a: number, b: number) => a + b, 0) / dailyAmts.length : 0
    const orderAnomaly = (today_o > 0 && avgDaily > 0 && today_o >= avgDaily * 2)

    // 경고 계산
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
app.get('/graphs/:year/:month', async (c) => {
  const year  = parseInt(c.req.param('year'))
  const month = parseInt(c.req.param('month'))
  const { start, end } = ymRange(year, month)

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
    `SELECT hospital_id, SUM(total_amount) AS used FROM daily_orders
     WHERE order_date BETWEEN ? AND ? AND hospital_id IN (${ph}) GROUP BY hospital_id`
  ).bind(start, end, ...hids).all()
  const ordMap: Record<number, number> = {}
  ;(ordR.results as any[]).forEach((r: any) => { ordMap[r.hospital_id] = r.used || 0 })

  // 식수
  const mealR = await c.env.DB.prepare(
    `SELECT hospital_id,
            SUM(COALESCE(breakfast_patient,0)+COALESCE(lunch_patient,0)+COALESCE(dinner_patient,0)+
                COALESCE(breakfast_staff,0)+COALESCE(lunch_staff,0)+COALESCE(dinner_staff,0)+
                COALESCE(breakfast_guardian,0)+COALESCE(lunch_guardian,0)+COALESCE(dinner_guardian,0)) AS total_meals
     FROM daily_meals WHERE meal_date BETWEEN ? AND ? AND hospital_id IN (${ph}) GROUP BY hospital_id`
  ).bind(start, end, ...hids).all()
  const mealMap: Record<number, number> = {}
  ;(mealR.results as any[]).forEach((r: any) => { mealMap[r.hospital_id] = r.total_meals || 0 })

  // 카테고리별 발주 (patient_category_id 기준)
  const catOrdR = await c.env.DB.prepare(
    `SELECT do.hospital_id, hpc.category_key, SUM(do.total_amount) AS amt
     FROM daily_orders do
     JOIN hospital_patient_categories hpc ON hpc.id = do.patient_category_id
     WHERE do.order_date BETWEEN ? AND ? AND do.hospital_id IN (${ph})
       AND do.patient_category_id IS NOT NULL
     GROUP BY do.hospital_id, hpc.category_key`
  ).bind(start, end, ...hids).all().catch(() => ({ results: [] }))
  const catOrdByKey: Record<string, number> = {}
  ;(catOrdR.results as any[]).forEach((r: any) => {
    catOrdByKey[`${r.hospital_id}__${r.category_key}`] = r.amt || 0
  })

  // category_order_settings (일일 식수 * 근무일 = 추정 식수)
  const cosR = await c.env.DB.prepare(
    `SELECT cos.hospital_id, hpc.category_key, cos.target_meal_price,
            cos.working_days, cos.daily_meal_count
     FROM category_order_settings cos
     JOIN hospital_patient_categories hpc ON hpc.id = cos.patient_category_id
     WHERE cos.year=? AND cos.month=? AND cos.hospital_id IN (${ph})`
  ).bind(year, month, ...hids).all().catch(() => ({ results: [] }))
  const cosMap2: Record<string, any> = {}
  ;(cosR.results as any[]).forEach((r: any) => {
    cosMap2[`${r.hospital_id}__${r.category_key}`] = r
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

  // 그래프2: 카테고리별 평균 식단가 (category_key 기준)
  // 모든 카테고리 키 수집
  const allCatKeys = new Set<string>()
  ;(catOrdR.results as any[]).forEach((r: any) => allCatKeys.add(r.category_key))

  const graph2: Record<string, { avgPrice: number; label: string }> = {}
  allCatKeys.forEach(catKey => {
    let totalPrice = 0, cnt = 0
    hids.forEach((hid: number) => {
      const amt = catOrdByKey[`${hid}__${catKey}`] || 0
      const cos = cosMap2[`${hid}__${catKey}`]
      if (!amt || !cos) return
      const dailyMeals = cos.daily_meal_count || 0
      const workDays   = cos.working_days || 0
      const estMeals   = (dailyMeals > 0 && workDays > 0) ? dailyMeals * workDays : 0
      if (estMeals > 0 && amt > 0) { totalPrice += Math.round(amt / estMeals); cnt++ }
    })
    graph2[catKey] = { avgPrice: cnt > 0 ? Math.round(totalPrice / cnt) : 0, label: catKey }
  })

  // graph2에 label 추가 (hospital_patient_categories에서)
  const hpcAllR = await c.env.DB.prepare(
    `SELECT DISTINCT category_key, category_name FROM hospital_patient_categories`
  ).all().catch(() => ({ results: [] }))
  const catNameMap: Record<string, string> = {}
  ;(hpcAllR.results as any[]).forEach((r: any) => { catNameMap[r.category_key] = r.category_name })
  Object.keys(graph2).forEach(k => { graph2[k].label = catNameMap[k] || k })

  // 그래프3: 병원별 식단가 비교
  const graph3 = hosps.map((h: any) => {
    const used   = ordMap[h.id]  || 0
    const meals  = mealMap[h.id] || 0
    const target = budMap[h.id]?.meal_price || 0
    return {
      id: h.id, name: h.name,
      mealPrice: meals > 0 ? Math.round(used / meals) : 0,
      target, hospitalType: h.hospital_type, careType: h.care_type
    }
  }).filter((h: any) => h.mealPrice > 0)

  // 그래프4: 식수 vs 발주금액 (산점도)
  const graph4 = hosps.map((h: any) => {
    const meals     = mealMap[h.id] || 0
    const used      = ordMap[h.id]  || 0
    const mealPrice = meals > 0 ? Math.round(used / meals) : 0
    const target    = budMap[h.id]?.meal_price || 0
    const anomaly   = target > 0 && mealPrice > target * 1.1
    return { id: h.id, name: h.name, meals, used, mealPrice, anomaly }
  }).filter((h: any) => h.meals > 0 || h.used > 0)

  return c.json({ graph1, graph2, graph3, graph4 })
})

// ─── 5. AI 경고 & 인사이트 ────────────────────────────────────
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

  const budR = await c.env.DB.prepare(
    `SELECT hospital_id, total_budget, meal_price FROM monthly_settings WHERE year=? AND month=? AND hospital_id IN (${ph})`
  ).bind(year, month, ...hids).all()
  const budMap: Record<number, any> = {}
  ;(budR.results as any[]).forEach((r: any) => { budMap[r.hospital_id] = r })

  const ordR = await c.env.DB.prepare(
    `SELECT hospital_id, SUM(total_amount) AS used FROM daily_orders
     WHERE order_date BETWEEN ? AND ? AND hospital_id IN (${ph}) GROUP BY hospital_id`
  ).bind(start, end, ...hids).all()
  const ordMap: Record<number, number> = {}
  ;(ordR.results as any[]).forEach((r: any) => { ordMap[r.hospital_id] = r.used || 0 })

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

  const mealR = await c.env.DB.prepare(
    `SELECT hospital_id,
            SUM(COALESCE(breakfast_patient,0)+COALESCE(lunch_patient,0)+COALESCE(dinner_patient,0)+
                COALESCE(breakfast_staff,0)+COALESCE(lunch_staff,0)+COALESCE(dinner_staff,0)+
                COALESCE(breakfast_guardian,0)+COALESCE(lunch_guardian,0)+COALESCE(dinner_guardian,0)) AS total_meals
     FROM daily_meals WHERE meal_date BETWEEN ? AND ? AND hospital_id IN (${ph}) GROUP BY hospital_id`
  ).bind(start, end, ...hids).all()
  const mealMap: Record<number, number> = {}
  ;(mealR.results as any[]).forEach((r: any) => { mealMap[r.hospital_id] = r.total_meals || 0 })

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

  const inspR = await c.env.DB.prepare(
    `SELECT hospital_id, COUNT(*) AS cnt FROM order_inspections WHERE status='pending' AND hospital_id IN (${ph}) GROUP BY hospital_id`
  ).bind(...hids).all().catch(() => ({ results: [] }))
  const inspMap: Record<number, number> = {}
  ;(inspR.results as any[]).forEach((r: any) => { inspMap[r.hospital_id] = r.cnt || 0 })

  const alerts: { level: 'danger' | 'warn' | 'info'; message: string; hospitalId?: number; hospitalName?: string }[] = []

  hids.forEach((hid: number) => {
    const name     = hNameMap[hid]
    const budget   = budMap[hid]?.total_budget || 0
    const target   = budMap[hid]?.meal_price   || 0
    const used     = ordMap[hid]  || 0
    const meals    = mealMap[hid] || 0
    const mealPrice = meals > 0 ? Math.round(used / meals) : 0
    const budgetPct = budget > 0 ? Math.round(used / budget * 100) : 0

    if (budgetPct >= 90)      alerts.push({ level: 'danger', message: `${name} 예산 소진율 ${budgetPct}% – 위험 수준`, hospitalId: hid, hospitalName: name })
    else if (budgetPct >= 80) alerts.push({ level: 'warn',   message: `${name} 예산 소진율 ${budgetPct}% – 주의 필요`, hospitalId: hid, hospitalName: name })

    if (target > 0) {
      const mpPct = Math.round(mealPrice / target * 100)
      if (mpPct >= 110)      alerts.push({ level: 'danger', message: `${name} 식단가 목표 대비 ${mpPct}% – 위험 초과`, hospitalId: hid, hospitalName: name })
      else if (mpPct >= 105) alerts.push({ level: 'warn',   message: `${name} 식단가 목표 대비 ${mpPct}% – 주의 수준`, hospitalId: hid, hospitalName: name })
    }

    const vList  = vMap[hid] || []
    const vTotal = vList.reduce((s: number, v: any) => s + v.amt, 0)
    if (vList.length > 0 && vTotal > 0) {
      const topV = vList.reduce((a: any, b: any) => a.amt > b.amt ? a : b)
      const conc = Math.round(topV.amt / vTotal * 100)
      if (conc >= 60)      alerts.push({ level: 'danger', message: `${name} 특정 업체 발주 집중도 ${conc}% – 공급 리스크`, hospitalId: hid, hospitalName: name })
      else if (conc >= 40) alerts.push({ level: 'warn',   message: `${name} 특정 업체 발주 집중도 ${conc}% – 주의`, hospitalId: hid, hospitalName: name })
    }

    const insp = inspMap[hid] || 0
    if (insp > 0) alerts.push({ level: 'warn', message: `${name} 검수 미완료 ${insp}건 대기 중`, hospitalId: hid, hospitalName: name })

    const dailyAmts = (dailyMap[hid] || []).map((d: any) => d.amt)
    if (dailyAmts.length >= 3) {
      const avg = dailyAmts.slice(0, -1).reduce((a: number, b: number) => a + b, 0) / (dailyAmts.length - 1)
      const last = dailyAmts[dailyAmts.length - 1]
      if (avg > 0 && last >= avg * 2) {
        alerts.push({ level: 'danger', message: `${name} 최근 발주금액 평균 대비 ${Math.round(last/avg*100)}% – 이상치 감지`, hospitalId: hid, hospitalName: name })
      }
    }
  })

  const insights: string[] = []
  const dangerCount = alerts.filter(a => a.level === 'danger').length
  const warnCount   = alerts.filter(a => a.level === 'warn').length

  if (dangerCount === 0 && warnCount === 0) {
    insights.push('이번 달 전체 병원의 운영 상태는 정상 범위입니다.')
  } else {
    if (dangerCount > 0) insights.push(`위험 경고 ${dangerCount}건이 확인됩니다. 즉시 검토가 필요합니다.`)
    if (warnCount > 0)   insights.push(`주의 경고 ${warnCount}건이 확인됩니다. 추이를 모니터링하세요.`)
  }

  const highBudgetHosps = hids.filter((hid: number) => {
    const b = budMap[hid]?.total_budget || 0
    const u = ordMap[hid] || 0
    return b > 0 && u / b >= 0.8
  }).map((hid: number) => hNameMap[hid])
  if (highBudgetHosps.length > 0) {
    insights.push(`${highBudgetHosps.join(', ')} 등 ${highBudgetHosps.length}개 병원은 현재 추세 기준 월말 전 예산 소진 가능성이 있습니다.`)
  }

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

  const totalInsp = Object.values(inspMap).reduce((a: number, b: number) => a + b, 0)
  if (totalInsp > 0) {
    insights.push(`총 ${totalInsp}건의 검수가 미완료 상태입니다. 담당 영양사 확인을 요청하세요.`)
  }

  return c.json({ alerts, insights })
})

// ─── 6. 지출 사용내역 조회 (CEO 열람용) ──────────────────────
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
            ce.vendor_name, ce.amount, ce.item_name,
            ce.purpose AS usage_purpose,
            COALESCE(ce.expense_type,'법인카드') AS expense_type,
            ce.memo
     FROM card_expenses ce
     JOIN hospitals h ON h.id = ce.hospital_id
     WHERE ${conds.join(' AND ')}
     ORDER BY ce.expense_date DESC, h.name
     LIMIT 500`
  ).bind(...args).all()

  return c.json(rows.results)
})

export default app
