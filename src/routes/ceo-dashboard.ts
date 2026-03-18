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
  if (hospitalType)  { conds.push("COALESCE(hi.hospital_type,'general') = ?");  args.push(hospitalType) }
  if (operationType) { conds.push("COALESCE(hi.operation_type,'direct') = ?");  args.push(operationType) }
  if (hospitalId)    { conds.push('h.id = ?');                                   args.push(parseInt(hospitalId)) }
  if (bedSize) {
    if      (bedSize === 'under30')  conds.push('COALESCE(hi.licensed_beds,0) <= 30')
    else if (bedSize === '31to60')   conds.push('COALESCE(hi.licensed_beds,0) BETWEEN 31 AND 60')
    else if (bedSize === '61to100')  conds.push('COALESCE(hi.licensed_beds,0) BETWEEN 61 AND 100')
    else if (bedSize === 'over100')  conds.push('COALESCE(hi.licensed_beds,0) > 100')
  }
  // careType 필터: hospital_patient_categories에 해당 category_key가 있는 병원만
  // → 별도 서브쿼리로 처리하므로 여기서는 생략하고 caller에서 처리
  return { conds, args }
}

/**
 * 카테고리별 식수 계산
 * meals_include_keys: ["staff","guardian","cat_cancer"] 형태
 * daily_meals 행 하나에서 해당 카테고리 식수 합산
 *
 * - "staff"    → breakfast_staff + lunch_staff + dinner_staff
 * - "guardian" → breakfast_guardian + lunch_guardian + dinner_guardian
 * - "patient"  → breakfast_patient + lunch_patient + dinner_patient
 * - "cat_xxx"  → custom_data.cat_xxx.bf + l + d
 */
function calcCategoryMeals(
  mealRow: any,
  mealsIncludeKeys: string[]
): number {
  let total = 0
  for (const key of mealsIncludeKeys) {
    if (key === 'staff') {
      total += (mealRow.breakfast_staff || 0) + (mealRow.lunch_staff || 0) + (mealRow.dinner_staff || 0)
    } else if (key === 'guardian') {
      total += (mealRow.breakfast_guardian || 0) + (mealRow.lunch_guardian || 0) + (mealRow.dinner_guardian || 0)
    } else if (key === 'patient') {
      total += (mealRow.breakfast_patient || 0) + (mealRow.lunch_patient || 0) + (mealRow.dinner_patient || 0)
    } else if (key.startsWith('cat_')) {
      try {
        const cd = mealRow._customData || (mealRow._customData = JSON.parse(mealRow.custom_data || '{}'))
        const cat = cd[key]
        if (cat) total += (cat.bf || 0) + (cat.l || 0) + (cat.d || 0)
      } catch {}
    }
  }
  return total
}

/**
 * daily_meals 데이터 + hospital_patient_categories 기반으로
 * 카테고리별 식수를 집계합니다.
 * 반환: { [hospitalId__categoryKey]: mealCount }
 */
function buildCatMealMap(
  mealRows: any[],
  hpcList: { hospital_id: number; category_key: string; meals_include_keys: string }[]
): Record<string, number> {
  // hpc를 hospitalId → [{ key, includes }] 로 인덱스
  const hpcByHosp: Record<number, { key: string; includes: string[] }[]> = {}
  for (const hpc of hpcList) {
    if (!hpcByHosp[hpc.hospital_id]) hpcByHosp[hpc.hospital_id] = []
    let keys: string[] = []
    try { keys = JSON.parse(hpc.meals_include_keys || '[]') } catch {}
    hpcByHosp[hpc.hospital_id].push({ key: hpc.category_key, includes: keys })
  }

  const result: Record<string, number> = {}
  for (const row of mealRows) {
    const hid = row.hospital_id
    const cats = hpcByHosp[hid] || []
    // custom_data 파싱 캐시
    try { row._customData = JSON.parse(row.custom_data || '{}') } catch { row._customData = {} }

    for (const cat of cats) {
      const mapKey = `${hid}__${cat.key}`
      if (!result[mapKey]) result[mapKey] = 0
      result[mapKey] += calcCategoryMeals(row, cat.includes)
    }
  }
  return result
}

// ─── 1. 케어유형 코드 목록 (hospital_patient_categories 기반) ──
// GET /api/ceo-dashboard/care-types
app.get('/care-types', async (c) => {
  // 전체 병원에서 실제 사용 중인 category_key / category_name 목록
  const rows = await c.env.DB.prepare(
    `SELECT DISTINCT category_key AS code, category_name AS label_ko
     FROM hospital_patient_categories
     WHERE is_active=1
     ORDER BY category_key`
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

  // care_type 필터: 해당 category_key를 가진 병원만
  if (careType) {
    conds.push('h.id IN (SELECT hospital_id FROM hospital_patient_categories WHERE category_key=? AND is_active=1)')
    args.push(careType)
  }

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

  // 예산
  const budgetR = await c.env.DB.prepare(
    `SELECT hospital_id, total_budget, meal_price FROM monthly_settings
     WHERE year=? AND month=? AND hospital_id IN (${ph})`
  ).bind(year, month, ...hids).all()
  const budgetMap: Record<number, any> = {}
  ;(budgetR.results as any[]).forEach((r: any) => { budgetMap[r.hospital_id] = r })

  // 발주 합계
  const orderR = await c.env.DB.prepare(
    `SELECT hospital_id, SUM(total_amount) AS used
     FROM daily_orders WHERE order_date BETWEEN ? AND ? AND hospital_id IN (${ph})
     GROUP BY hospital_id`
  ).bind(start, end, ...hids).all()
  const orderMap: Record<number, number> = {}
  ;(orderR.results as any[]).forEach((r: any) => { orderMap[r.hospital_id] = r.used || 0 })

  // daily_meals 전체 (custom_data 파싱용)
  const mealRowsR = await c.env.DB.prepare(
    `SELECT hospital_id, meal_date,
            breakfast_patient, lunch_patient, dinner_patient,
            breakfast_staff, lunch_staff, dinner_staff,
            breakfast_guardian, lunch_guardian, dinner_guardian,
            custom_data
     FROM daily_meals WHERE meal_date BETWEEN ? AND ? AND hospital_id IN (${ph})`
  ).bind(start, end, ...hids).all()
  const mealRows = mealRowsR.results as any[]

  // hospital_patient_categories
  const hpcR = await c.env.DB.prepare(
    `SELECT hospital_id, category_key, category_name, meals_include_keys
     FROM hospital_patient_categories WHERE hospital_id IN (${ph}) AND is_active=1`
  ).bind(...hids).all()
  const hpcList = hpcR.results as any[]

  // category_order_settings (목표 식단가)
  const cosR = await c.env.DB.prepare(
    `SELECT cos.hospital_id, hpc.category_key, hpc.category_name,
            cos.target_meal_price, cos.monthly_budget
     FROM category_order_settings cos
     JOIN hospital_patient_categories hpc ON hpc.id = cos.patient_category_id
     WHERE cos.year=? AND cos.month=? AND cos.hospital_id IN (${ph})`
  ).bind(year, month, ...hids).all().catch(() => ({ results: [] }))
  const cosMap: Record<string, any> = {}
  ;(cosR.results as any[]).forEach((r: any) => {
    cosMap[`${r.hospital_id}__${r.category_key}`] = r
  })

  // 카테고리별 식수 맵 (buildCatMealMap)
  const catMealMap = buildCatMealMap(mealRows, hpcList)

  // 카테고리별 발주 맵
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

  // 검수 미완료 (daily_orders.inspection_status='pending' 또는 is_inspected=0)
  const inspR = await c.env.DB.prepare(
    `SELECT hospital_id, COUNT(*) AS cnt FROM daily_orders
     WHERE (inspection_status='pending' OR is_inspected=0)
       AND order_date BETWEEN ? AND ? AND hospital_id IN (${ph})
     GROUP BY hospital_id`
  ).bind(start, end, ...hids).all().catch(() => ({ results: [] }))
  const inspCountMap: Record<number, number> = {}
  ;(inspR.results as any[]).forEach((r: any) => { inspCountMap[r.hospital_id] = r.cnt || 0 })
  const pendingInspectCount = Object.values(inspCountMap).filter(v => v > 0).length

  // 집계
  let totalBudget = 0, totalUsed = 0
  let budgetPctSum = 0, budgetPctCnt = 0
  let mealPriceSum = 0, mealPriceCnt = 0
  let dangerBudgetCount = 0, dangerMealCount = 0

  // KPI용 카테고리별 전체 합산 (모든 병원)
  const kpiCatMeals: Record<string, number> = {}
  const kpiCatOrds:  Record<string, number> = {}

  hids.forEach((hid: number) => {
    const budget = budgetMap[hid]?.total_budget || 0
    const used   = orderMap[hid] || 0
    totalBudget += budget; totalUsed += used

    // 카테고리별 식수 집계
    const cats = hpcList.filter((h: any) => h.hospital_id === hid)
    const hospTotalMeals = cats.reduce((s: number, cat: any) => s + (catMealMap[`${hid}__${cat.category_key}`] || 0), 0)
    let totalMeals = 0
    let weightedOrd = 0

    cats.forEach((cat: any) => {
      const mk  = `${hid}__${cat.category_key}`
      const m   = catMealMap[mk] || 0
      let   o   = catOrdMap[mk]  || 0
      // 카테고리 발주 없으면 전체 발주를 식수 비율로 배분
      if (o === 0 && m > 0 && hospTotalMeals > 0 && used > 0) {
        o = Math.round(used * m / hospTotalMeals)
      }
      const cos = cosMap[mk]
      totalMeals   += m
      weightedOrd  += o
      if (!kpiCatMeals[cat.category_key]) kpiCatMeals[cat.category_key] = 0
      if (!kpiCatOrds[cat.category_key])  kpiCatOrds[cat.category_key]  = 0
      kpiCatMeals[cat.category_key] += m
      kpiCatOrds[cat.category_key]  += o
    })

    if (budget > 0) {
      const pct = used / budget * 100
      budgetPctSum += pct; budgetPctCnt++
      if (pct >= 90) dangerBudgetCount++
    }
    if (totalMeals > 0) {
      const mp = Math.round(weightedOrd / totalMeals)
      mealPriceSum += mp; mealPriceCnt++
      // 목표 가중평균 식단가
      let wTarget = 0
      cats.forEach((cat: any) => {
        const mk  = `${hid}__${cat.category_key}`
        const m   = catMealMap[mk] || 0
        const cos = cosMap[mk]
        if (cos) wTarget += m * (cos.target_meal_price || 0)
      })
      const targetMp = totalMeals > 0 ? wTarget / totalMeals : 0
      if (targetMp > 0 && mp > targetMp * 1.1) dangerMealCount++
    }
  })

  // 카테고리별 평균 식단가 (전체 병원 합산 기반) - 목표 식단가 평균도 함께 반환
  const kpiCatTargets: Record<string, { sum: number; cnt: number }> = {}
  ;(cosR.results as any[]).forEach((r: any) => {
    if (!kpiCatTargets[r.category_key]) kpiCatTargets[r.category_key] = { sum: 0, cnt: 0 }
    if (r.target_meal_price > 0) {
      kpiCatTargets[r.category_key].sum += r.target_meal_price
      kpiCatTargets[r.category_key].cnt++
    }
  })
  const mealPriceByCategory: Record<string, { avgPrice: number; label: string; targetPrice: number }> = {}
  const catNameMap: Record<string, string> = {}
  hpcList.forEach((h: any) => { catNameMap[h.category_key] = h.category_name })
  Object.keys(kpiCatMeals).forEach(k => {
    const m = kpiCatMeals[k]; const o = kpiCatOrds[k]
    const tData = kpiCatTargets[k] || { sum: 0, cnt: 0 }
    mealPriceByCategory[k] = {
      avgPrice: m > 0 ? Math.round(o / m) : 0,
      label: catNameMap[k] || k,
      targetPrice: tData.cnt > 0 ? Math.round(tData.sum / tData.cnt) : 0
    }
  })

  return c.json({
    hospitalCount:    hids.length,
    totalBudget,      totalUsed,
    avgBudgetPct:     budgetPctCnt > 0 ? Math.round(budgetPctSum / budgetPctCnt) : 0,
    avgMealPrice:     mealPriceCnt  > 0 ? Math.round(mealPriceSum / mealPriceCnt) : 0,
    dangerBudgetCount, dangerMealCount, pendingInspectCount,
    mealPriceByCategory  // { cancer: {avgPrice:8400, label:'항암', targetPrice:8000}, nursing: {...} }
  })
})

// ─── 3. 병원별 운영 상태 카드 ─────────────────────────────────
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
  if (careType) {
    conds.push('h.id IN (SELECT hospital_id FROM hospital_patient_categories WHERE category_key=? AND is_active=1)')
    args.push(careType)
  }
  const where = conds.join(' AND ')

  const hospsR = await c.env.DB.prepare(
    `SELECT h.id, h.name,
            COALESCE(hi.hospital_type,'general')  AS hospital_type,
            COALESCE(hi.care_type,'general')      AS care_type,
            COALESCE(hi.licensed_beds,0)          AS licensed_beds,
            COALESCE(hi.operation_type,'direct')  AS operation_type
     FROM hospitals h
     LEFT JOIN hospital_info hi ON hi.hospital_id = h.id
     WHERE ${where} ORDER BY h.name`
  ).bind(...args).all()
  const hosps = hospsR.results as any[]
  if (hosps.length === 0) return c.json([])

  const hids = hosps.map((h: any) => h.id)
  const ph   = hids.map(() => '?').join(',')

  // 예산
  const budgetR = await c.env.DB.prepare(
    `SELECT hospital_id, total_budget, meal_price
     FROM monthly_settings WHERE year=? AND month=? AND hospital_id IN (${ph})`
  ).bind(year, month, ...hids).all()
  const bMap: Record<number, any> = {}
  ;(budgetR.results as any[]).forEach((r: any) => { bMap[r.hospital_id] = r })

  // 발주 합계
  const ordR = await c.env.DB.prepare(
    `SELECT hospital_id, SUM(total_amount) AS used FROM daily_orders
     WHERE order_date BETWEEN ? AND ? AND hospital_id IN (${ph}) GROUP BY hospital_id`
  ).bind(start, end, ...hids).all()
  const oMap: Record<number, number> = {}
  ;(ordR.results as any[]).forEach((r: any) => { oMap[r.hospital_id] = r.used || 0 })

  // 오늘 발주
  const todayOrdR = await c.env.DB.prepare(
    `SELECT hospital_id, SUM(total_amount) AS today_used FROM daily_orders
     WHERE order_date=? AND hospital_id IN (${ph}) GROUP BY hospital_id`
  ).bind(today, ...hids).all()
  const todayMap: Record<number, number> = {}
  ;(todayOrdR.results as any[]).forEach((r: any) => { todayMap[r.hospital_id] = r.today_used || 0 })

  // daily_meals (custom_data 포함)
  const mealRowsR = await c.env.DB.prepare(
    `SELECT hospital_id, meal_date,
            breakfast_patient, lunch_patient, dinner_patient,
            breakfast_staff, lunch_staff, dinner_staff,
            breakfast_guardian, lunch_guardian, dinner_guardian,
            custom_data
     FROM daily_meals WHERE meal_date BETWEEN ? AND ? AND hospital_id IN (${ph})`
  ).bind(start, end, ...hids).all()
  const mealRows = mealRowsR.results as any[]

  // hospital_patient_categories
  const hpcR = await c.env.DB.prepare(
    `SELECT hospital_id, category_key, category_name, meals_include_keys
     FROM hospital_patient_categories WHERE hospital_id IN (${ph}) AND is_active=1`
  ).bind(...hids).all()
  const hpcList = hpcR.results as any[]

  // 카테고리별 식수 맵
  const catMealMap = buildCatMealMap(mealRows, hpcList)

  // 카테고리별 발주
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

  // category_order_settings (목표 식단가)
  const cosR = await c.env.DB.prepare(
    `SELECT cos.hospital_id, hpc.category_key, hpc.category_name,
            cos.target_meal_price, cos.monthly_budget
     FROM category_order_settings cos
     JOIN hospital_patient_categories hpc ON hpc.id = cos.patient_category_id
     WHERE cos.year=? AND cos.month=? AND cos.hospital_id IN (${ph})`
  ).bind(year, month, ...hids).all().catch(() => ({ results: [] }))
  const cosMap: Record<string, any> = {}
  ;(cosR.results as any[]).forEach((r: any) => {
    cosMap[`${r.hospital_id}__${r.category_key}`] = r
  })

  // 검수 미완료 건수 (daily_orders.inspection_status='pending' 또는 is_inspected=0)
  const inspR = await c.env.DB.prepare(
    `SELECT hospital_id, COUNT(*) AS cnt FROM daily_orders
     WHERE (inspection_status='pending' OR is_inspected=0)
       AND order_date BETWEEN ? AND ? AND hospital_id IN (${ph})
     GROUP BY hospital_id`
  ).bind(start, end, ...hids).all().catch(() => ({ results: [] }))
  const inspMap: Record<number, number> = {}
  ;(inspR.results as any[]).forEach((r: any) => { inspMap[r.hospital_id] = r.cnt || 0 })

  // 업체 집중도
  const vendorOrdR = await c.env.DB.prepare(
    `SELECT hospital_id, vendor_id, SUM(total_amount) AS amt
     FROM daily_orders WHERE order_date BETWEEN ? AND ? AND hospital_id IN (${ph})
     GROUP BY hospital_id, vendor_id`
  ).bind(start, end, ...hids).all()
  const vendorMap: Record<number, {id:number;amt:number}[]> = {}
  ;(vendorOrdR.results as any[]).forEach((r: any) => {
    if (!vendorMap[r.hospital_id]) vendorMap[r.hospital_id] = []
    vendorMap[r.hospital_id].push({ id: r.vendor_id, amt: r.amt || 0 })
  })

  // 발주 이상치
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

  // 병원별 hpc 맵
  const hpcByHosp: Record<number, any[]> = {}
  hpcList.forEach((h: any) => {
    if (!hpcByHosp[h.hospital_id]) hpcByHosp[h.hospital_id] = []
    hpcByHosp[h.hospital_id].push(h)
  })

  const result = hosps.map((h: any) => {
    const budget  = bMap[h.id]?.total_budget || 0
    const used    = oMap[h.id] || 0
    const today_o = todayMap[h.id] || 0
    const pendInsp = inspMap[h.id] || 0

    // ── 카테고리별 식수·식단가 계산 ──
    const cats = hpcByHosp[h.id] || []
    let totalMeals = 0
    let weightedOrd = 0
    let weightedTarget = 0

    const mealPriceByCategory: Record<string, {
      name: string; meals: number; price: number; targetPrice: number; budget: number
    }> = {}

    // 병원 전체 발주 (카테고리 미분류 포함) 배분용
    const hospTotalOrd   = oMap[h.id] || 0
    const hospTotalMeals = cats.reduce((s: number, cat: any) => s + (catMealMap[`${h.id}__${cat.category_key}`] || 0), 0)

    cats.forEach((cat: any) => {
      const mk    = `${h.id}__${cat.category_key}`
      const meals = catMealMap[mk] || 0
      let   ord   = catOrdMap[mk]  || 0
      const cos   = cosMap[mk]
      const tgt   = cos?.target_meal_price || 0
      // 카테고리 발주 없으면 전체 발주를 식수 비율로 배분
      if (ord === 0 && meals > 0 && hospTotalMeals > 0 && hospTotalOrd > 0) {
        ord = Math.round(hospTotalOrd * meals / hospTotalMeals)
      }
      const price = meals > 0 ? Math.round(ord / meals) : 0

      totalMeals    += meals
      weightedOrd   += ord
      weightedTarget += meals * tgt

      mealPriceByCategory[cat.category_key] = {
        name: cat.category_name, meals, price, targetPrice: tgt,
        budget: cos?.monthly_budget || 0
      }
    })

    // 가중평균 식단가
    const mealPrice  = totalMeals > 0 ? Math.round(weightedOrd / totalMeals) : 0
    // 가중평균 목표 식단가
    const targetMp   = totalMeals > 0 ? weightedTarget / totalMeals : (bMap[h.id]?.meal_price || 0)
    const budgetPct  = budget > 0 ? Math.round(used / budget * 100) : 0
    const mpPct      = targetMp > 0 ? Math.round(mealPrice / targetMp * 100) : 0

    // 업체 집중도
    const vList = vendorMap[h.id] || []
    const vTotal = vList.reduce((s: number, v: any) => s + v.amt, 0)
    const maxV  = vList.length > 0 ? vList.reduce((a: any, b: any) => a.amt > b.amt ? a : b) : null
    const vendorConcentration = (vTotal > 0 && maxV) ? Math.round(maxV.amt / vTotal * 100) : 0

    // 발주 이상치
    const dailyAmts = dailyOrdMap[h.id] || []
    const avgDaily  = dailyAmts.length > 0 ? dailyAmts.reduce((a: number, b: number) => a + b, 0) / dailyAmts.length : 0
    const orderAnomaly = today_o > 0 && avgDaily > 0 && today_o >= avgDaily * 2

    // 경고
    let alertCount = 0; const alerts: string[] = []
    if (budgetPct >= 90)                   { alertCount++; alerts.push(`예산 ${budgetPct}% 소진`) }
    else if (budgetPct >= 80)              { alertCount++; alerts.push(`예산 주의 ${budgetPct}%`) }
    if (targetMp > 0 && mpPct >= 110)      { alertCount++; alerts.push(`식단가 ${mpPct}% 초과`) }
    else if (targetMp > 0 && mpPct >= 105) { alertCount++; alerts.push(`식단가 주의 ${mpPct}%`) }
    if (vendorConcentration >= 60)         { alertCount++; alerts.push(`업체집중도 위험 ${vendorConcentration}%`) }
    else if (vendorConcentration >= 40)    { alertCount++; alerts.push(`업체집중도 주의 ${vendorConcentration}%`) }
    if (pendInsp > 0)                      { alertCount++; alerts.push(`검수 미완료 ${pendInsp}건`) }
    if (orderAnomaly)                      { alertCount++; alerts.push('발주 이상치 감지') }

    const riskLevel = alertCount === 0 ? 'safe' : alertCount === 1 ? 'warn' : 'danger'

    return {
      id: h.id, name: h.name,
      hospitalType: h.hospital_type, careType: h.care_type,
      licensedBeds: h.licensed_beds, operationType: h.operation_type,
      budget, used, remaining: budget - used, budgetPct,
      mealPrice, totalMeals, targetMealPrice: Math.round(targetMp), mpPct,
      todayOrder: today_o, pendingInspections: pendInsp,
      vendorConcentration, orderAnomaly,
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
            COALESCE(hi.care_type,'general')     AS care_type
     FROM hospitals h LEFT JOIN hospital_info hi ON hi.hospital_id=h.id ORDER BY h.name`
  ).all()
  const hosps = hospsR.results as any[]
  if (hosps.length === 0) return c.json({ graph1: [], graph2: {}, graph3: [], graph4: [] })

  const hids = hosps.map((h: any) => h.id)
  const ph   = hids.map(() => '?').join(',')

  // 예산·발주
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

  // daily_meals (custom_data)
  const mealRowsR = await c.env.DB.prepare(
    `SELECT hospital_id, breakfast_patient, lunch_patient, dinner_patient,
            breakfast_staff, lunch_staff, dinner_staff,
            breakfast_guardian, lunch_guardian, dinner_guardian, custom_data
     FROM daily_meals WHERE meal_date BETWEEN ? AND ? AND hospital_id IN (${ph})`
  ).bind(start, end, ...hids).all()
  const mealRows = mealRowsR.results as any[]

  // hospital_patient_categories
  const hpcR = await c.env.DB.prepare(
    `SELECT hospital_id, category_key, category_name, meals_include_keys
     FROM hospital_patient_categories WHERE hospital_id IN (${ph}) AND is_active=1`
  ).bind(...hids).all()
  const hpcList = hpcR.results as any[]
  const catMealMap = buildCatMealMap(mealRows, hpcList)

  // category_order_settings
  const cosR = await c.env.DB.prepare(
    `SELECT cos.hospital_id, hpc.category_key, cos.target_meal_price
     FROM category_order_settings cos
     JOIN hospital_patient_categories hpc ON hpc.id=cos.patient_category_id
     WHERE cos.year=? AND cos.month=? AND cos.hospital_id IN (${ph})`
  ).bind(year, month, ...hids).all().catch(() => ({ results: [] }))
  const cosMap2: Record<string, any> = {}
  ;(cosR.results as any[]).forEach((r: any) => { cosMap2[`${r.hospital_id}__${r.category_key}`] = r })

  // 카테고리별 발주
  const catOrdR = await c.env.DB.prepare(
    `SELECT do.hospital_id, hpc.category_key, SUM(do.total_amount) AS amt
     FROM daily_orders do
     JOIN hospital_patient_categories hpc ON hpc.id=do.patient_category_id
     WHERE do.order_date BETWEEN ? AND ? AND do.hospital_id IN (${ph})
       AND do.patient_category_id IS NOT NULL
     GROUP BY do.hospital_id, hpc.category_key`
  ).bind(start, end, ...hids).all().catch(() => ({ results: [] }))
  const catOrdMap: Record<string, number> = {}
  ;(catOrdR.results as any[]).forEach((r: any) => {
    catOrdMap[`${r.hospital_id}__${r.category_key}`] = r.amt || 0
  })

  // 병원별 총 식수·가중평균 식단가
  const hpcByHosp: Record<number, any[]> = {}
  hpcList.forEach((h: any) => {
    if (!hpcByHosp[h.hospital_id]) hpcByHosp[h.hospital_id] = []
    hpcByHosp[h.hospital_id].push(h)
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

  // 그래프2: 카테고리별 평균 식단가 (가중평균 방식)
  // 전체 병원에서 같은 category_key를 가진 병원들의 식단가 평균
  const allCatKeys = new Set<string>()
  hpcList.forEach((h: any) => allCatKeys.add(h.category_key))

  const catNameMap: Record<string, string> = {}
  hpcList.forEach((h: any) => { catNameMap[h.category_key] = h.category_name })

  // 그래프2: 카테고리별 평균 식단가 계산
  // patient_category_id가 있는 발주 → catOrdMap 사용
  // patient_category_id 없는 발주 → 병원 내 카테고리 식수 비율로 배분
  const graph2: Record<string, { avgPrice: number; label: string; count: number; targetPrice: number }> = {}
  allCatKeys.forEach(catKey => {
    let totalMeals = 0, totalOrd = 0, cnt = 0, targetSum = 0
    hids.forEach((hid: number) => {
      const mk    = `${hid}__${catKey}`
      const meals = catMealMap[mk] || 0
      if (meals === 0) return
      // 카테고리별 직접 발주가 있으면 사용, 없으면 전체 발주를 식수 비율로 배분
      let catOrd = catOrdMap[mk] || 0
      if (catOrd === 0) {
        // 해당 병원 전체 식수 합산
        const hospCats = hpcByHosp[hid] || []
        const hospTotalMeals = hospCats.reduce((s: number, c: any) => s + (catMealMap[`${hid}__${c.category_key}`] || 0), 0)
        const hospTotalOrd   = ordMap[hid] || 0
        if (hospTotalMeals > 0 && hospTotalOrd > 0) {
          catOrd = Math.round(hospTotalOrd * meals / hospTotalMeals)
        }
      }
      if (catOrd > 0) { totalMeals += meals; totalOrd += catOrd; cnt++ }
      const tgt = cosMap2[mk]?.target_meal_price || 0
      if (tgt > 0) targetSum += tgt
    })
    const avgPrice   = totalMeals > 0 ? Math.round(totalOrd / totalMeals) : 0
    const targetPrice = cnt > 0 ? Math.round(targetSum / cnt) : 0
    graph2[catKey] = { avgPrice, label: catNameMap[catKey] || catKey, count: cnt, targetPrice }
  })

  // 그래프3: 병원별 식단가 비교 (가중평균)
  const graph3 = hosps.map((h: any) => {
    const cats = hpcByHosp[h.id] || []
    const hospTotalM3 = cats.reduce((s: number, cat: any) => s + (catMealMap[`${h.id}__${cat.category_key}`] || 0), 0)
    const hospTotalO3 = ordMap[h.id] || 0
    let totalM = 0, totalO = 0, weightedTgt = 0
    cats.forEach((cat: any) => {
      const mk = `${h.id}__${cat.category_key}`
      const m  = catMealMap[mk] || 0
      let   o  = catOrdMap[mk]  || 0
      if (o === 0 && m > 0 && hospTotalM3 > 0 && hospTotalO3 > 0) {
        o = Math.round(hospTotalO3 * m / hospTotalM3)
      }
      const cos = cosMap2[mk]
      totalM += m; totalO += o
      if (cos) weightedTgt += m * (cos.target_meal_price || 0)
    })
    const mealPrice = totalM > 0 ? Math.round(totalO / totalM) : 0
    const targetMp  = totalM > 0 ? weightedTgt / totalM : (budMap[h.id]?.meal_price || 0)
    return {
      id: h.id, name: h.name,
      mealPrice, target: Math.round(targetMp),
      hospitalType: h.hospital_type, careType: h.care_type,
      totalMeals: totalM
    }
  }).filter((h: any) => h.mealPrice > 0 || h.totalMeals > 0)

  // 그래프4: 식수 vs 발주금액 (산점도)
  const graph4 = hosps.map((h: any) => {
    const cats = hpcByHosp[h.id] || []
    const hospTotalM4 = cats.reduce((s: number, cat: any) => s + (catMealMap[`${h.id}__${cat.category_key}`] || 0), 0)
    const used = ordMap[h.id] || 0
    let totalM = 0, totalO = 0, weightedTgt = 0
    cats.forEach((cat: any) => {
      const mk = `${h.id}__${cat.category_key}`
      const m  = catMealMap[mk] || 0
      let   o  = catOrdMap[mk]  || 0
      if (o === 0 && m > 0 && hospTotalM4 > 0 && used > 0) {
        o = Math.round(used * m / hospTotalM4)
      }
      totalM += m; totalO += o
      const cos = cosMap2[mk]
      if (cos) weightedTgt += m * (cos.target_meal_price || 0)
    })
    const mealPrice = totalM > 0 ? Math.round(totalO / totalM) : 0
    const targetMp  = totalM > 0 ? weightedTgt / totalM : 0
    const anomaly   = targetMp > 0 && mealPrice > targetMp * 1.1
    return { id: h.id, name: h.name, meals: totalM, used, mealPrice, anomaly }
  }).filter((h: any) => h.meals > 0 || h.used > 0)

  return c.json({ graph1, graph2, graph3, graph4 })
})

// ─── 5. AI 경고 & 인사이트 ────────────────────────────────────
app.get('/alerts/:year/:month', async (c) => {
  const year  = parseInt(c.req.param('year'))
  const month = parseInt(c.req.param('month'))
  const { start, end } = ymRange(year, month)

  const hospsR = await c.env.DB.prepare(`SELECT h.id, h.name FROM hospitals h ORDER BY h.name`).all()
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

  // daily_meals + custom_data
  const mealRowsR = await c.env.DB.prepare(
    `SELECT hospital_id, breakfast_patient, lunch_patient, dinner_patient,
            breakfast_staff, lunch_staff, dinner_staff,
            breakfast_guardian, lunch_guardian, dinner_guardian, custom_data
     FROM daily_meals WHERE meal_date BETWEEN ? AND ? AND hospital_id IN (${ph})`
  ).bind(start, end, ...hids).all()
  const mealRows = mealRowsR.results as any[]

  const hpcR = await c.env.DB.prepare(
    `SELECT hospital_id, category_key, category_name, meals_include_keys
     FROM hospital_patient_categories WHERE hospital_id IN (${ph}) AND is_active=1`
  ).bind(...hids).all()
  const hpcList = hpcR.results as any[]
  const catMealMap = buildCatMealMap(mealRows, hpcList)

  const catOrdR = await c.env.DB.prepare(
    `SELECT do.hospital_id, hpc.category_key, SUM(do.total_amount) AS amt
     FROM daily_orders do
     JOIN hospital_patient_categories hpc ON hpc.id=do.patient_category_id
     WHERE do.order_date BETWEEN ? AND ? AND do.hospital_id IN (${ph})
       AND do.patient_category_id IS NOT NULL
     GROUP BY do.hospital_id, hpc.category_key`
  ).bind(start, end, ...hids).all().catch(() => ({ results: [] }))
  const catOrdMap: Record<string, number> = {}
  ;(catOrdR.results as any[]).forEach((r: any) => {
    catOrdMap[`${r.hospital_id}__${r.category_key}`] = r.amt || 0
  })

  const cosR = await c.env.DB.prepare(
    `SELECT cos.hospital_id, hpc.category_key, cos.target_meal_price
     FROM category_order_settings cos
     JOIN hospital_patient_categories hpc ON hpc.id=cos.patient_category_id
     WHERE cos.year=? AND cos.month=? AND cos.hospital_id IN (${ph})`
  ).bind(year, month, ...hids).all().catch(() => ({ results: [] }))
  const cosMap: Record<string, any> = {}
  ;(cosR.results as any[]).forEach((r: any) => { cosMap[`${r.hospital_id}__${r.category_key}`] = r })

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

  const vOrdR = await c.env.DB.prepare(
    `SELECT hospital_id, vendor_id, SUM(total_amount) AS amt FROM daily_orders
     WHERE order_date BETWEEN ? AND ? AND hospital_id IN (${ph})
     GROUP BY hospital_id, vendor_id`
  ).bind(start, end, ...hids).all()
  const vMap: Record<number, { id:number; amt:number }[]> = {}
  ;(vOrdR.results as any[]).forEach((r: any) => {
    if (!vMap[r.hospital_id]) vMap[r.hospital_id] = []
    vMap[r.hospital_id].push({ id: r.vendor_id, amt: r.amt || 0 })
  })

  const inspR = await c.env.DB.prepare(
    `SELECT hospital_id, COUNT(*) AS cnt FROM daily_orders
     WHERE (inspection_status='pending' OR is_inspected=0)
       AND order_date BETWEEN ? AND ? AND hospital_id IN (${ph})
     GROUP BY hospital_id`
  ).bind(start, end, ...hids).all().catch(() => ({ results: [] }))
  const inspMap: Record<number, number> = {}
  ;(inspR.results as any[]).forEach((r: any) => { inspMap[r.hospital_id] = r.cnt || 0 })

  const hpcByHosp: Record<number, any[]> = {}
  hpcList.forEach((h: any) => {
    if (!hpcByHosp[h.hospital_id]) hpcByHosp[h.hospital_id] = []
    hpcByHosp[h.hospital_id].push(h)
  })

  const alerts: { level: 'danger'|'warn'|'info'; message: string; hospitalId?: number; hospitalName?: string }[] = []

  hids.forEach((hid: number) => {
    const name   = hNameMap[hid]
    const budget = budMap[hid]?.total_budget || 0
    const used   = ordMap[hid] || 0
    const budgetPct = budget > 0 ? Math.round(used / budget * 100) : 0

    // 가중평균 식단가
    const cats = hpcByHosp[hid] || []
    const hospTotalMealsA = cats.reduce((s: number, cat: any) => s + (catMealMap[`${hid}__${cat.category_key}`] || 0), 0)
    let totalM = 0, weightedO = 0, weightedTgt = 0
    cats.forEach((cat: any) => {
      const mk = `${hid}__${cat.category_key}`
      const m  = catMealMap[mk] || 0
      let   o  = catOrdMap[mk] || 0
      if (o === 0 && m > 0 && hospTotalMealsA > 0 && used > 0) {
        o = Math.round(used * m / hospTotalMealsA)
      }
      const cos = cosMap[mk]
      totalM += m; weightedO += o
      if (cos) weightedTgt += m * (cos.target_meal_price || 0)
    })
    const mealPrice = totalM > 0 ? Math.round(weightedO / totalM) : 0
    const targetMp  = totalM > 0 ? weightedTgt / totalM : (budMap[hid]?.meal_price || 0)
    const mpPct = targetMp > 0 ? Math.round(mealPrice / targetMp * 100) : 0

    if (budgetPct >= 90)      alerts.push({ level: 'danger', message: `${name} 예산 소진율 ${budgetPct}% – 위험 수준`, hospitalId: hid, hospitalName: name })
    else if (budgetPct >= 80) alerts.push({ level: 'warn',   message: `${name} 예산 소진율 ${budgetPct}% – 주의 필요`, hospitalId: hid, hospitalName: name })

    if (targetMp > 0) {
      if (mpPct >= 110)      alerts.push({ level: 'danger', message: `${name} 식단가 목표 대비 ${mpPct}% – 위험 초과`, hospitalId: hid, hospitalName: name })
      else if (mpPct >= 105) alerts.push({ level: 'warn',   message: `${name} 식단가 목표 대비 ${mpPct}% – 주의 수준`, hospitalId: hid, hospitalName: name })
    }

    const vList = vMap[hid] || []; const vTotal = vList.reduce((s: number, v: any) => s + v.amt, 0)
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
    if (warnCount   > 0) insights.push(`주의 경고 ${warnCount}건이 확인됩니다. 추이를 모니터링하세요.`)
  }

  const highBudgetHosps = hids.filter((hid: number) => {
    const b = budMap[hid]?.total_budget||0; const u = ordMap[hid]||0
    return b > 0 && u/b >= 0.8
  }).map((hid: number) => hNameMap[hid])
  if (highBudgetHosps.length > 0)
    insights.push(`${highBudgetHosps.join(', ')} 등 ${highBudgetHosps.length}개 병원은 월말 전 예산 소진 가능성이 있습니다.`)

  const concHosps = hids.filter((hid: number) => {
    const vList = vMap[hid]||[]; const vTotal = vList.reduce((s: number, v: any)=>s+v.amt,0)
    if (!vList.length||!vTotal) return false
    return vList.reduce((a: any,b: any)=>a.amt>b.amt?a:b).amt/vTotal >= 0.4
  })
  if (concHosps.length > 0)
    insights.push(`${concHosps.length}개 병원에서 상위 업체 발주 비중이 높습니다. 공급처 분산을 검토하세요.`)

  const mpList = hids.map((hid: number) => {
    const cats = hpcByHosp[hid]||[]; let tM=0,tO=0
    cats.forEach((cat: any)=>{ tM+=catMealMap[`${hid}__${cat.category_key}`]||0; tO+=catOrdMap[`${hid}__${cat.category_key}`]||0 })
    return tM > 0 ? Math.round(tO/tM) : 0
  }).filter((p: number)=>p>0)
  if (mpList.length > 0) {
    const avgMp = Math.round(mpList.reduce((a: number,b: number)=>a+b,0)/mpList.length)
    const overCount = hids.filter((hid: number)=>{
      const cats = hpcByHosp[hid]||[]; let tM=0,tO=0,wTgt=0
      cats.forEach((cat: any)=>{const mk=`${hid}__${cat.category_key}`;const m=catMealMap[mk]||0;const o=catOrdMap[mk]||0;const cos=cosMap[mk];tM+=m;tO+=o;if(cos)wTgt+=m*(cos.target_meal_price||0)})
      const mp=tM>0?Math.round(tO/tM):0; const tgt=tM>0?wTgt/tM:0
      return tgt>0&&mp>tgt*1.05
    }).length
    if (overCount > 0) insights.push(`${overCount}개 병원의 식단가가 목표를 초과, 전체 평균 ${avgMp.toLocaleString()}원입니다.`)
    else               insights.push(`전체 평균 식단가는 ${avgMp.toLocaleString()}원으로 안정적입니다.`)
  }

  const totalInsp = Object.values(inspMap).reduce((a: number,b: number)=>a+b,0)
  if (totalInsp > 0) insights.push(`총 ${totalInsp}건의 검수가 미완료 상태입니다.`)

  return c.json({ alerts, insights })
})

// ─── 6. 지출 사용내역 (CEO 열람) ─────────────────────────────
app.get('/expenses/:year/:month', async (c) => {
  const year  = parseInt(c.req.param('year'))
  const month = parseInt(c.req.param('month'))
  const start = `${ym(year, month)}-01`
  const end   = `${ym(year, month)}-31`

  const hospitalId  = c.req.query('hospital_id')  || ''
  const expenseType = c.req.query('expense_type') || ''

  const conds: string[] = ['ce.expense_date BETWEEN ? AND ?']
  const args: any[]     = [start, end]
  if (hospitalId)  { conds.push('ce.hospital_id = ?');  args.push(parseInt(hospitalId)) }
  if (expenseType) { conds.push('ce.expense_type = ?'); args.push(expenseType) }

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
