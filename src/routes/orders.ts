import { Hono } from 'hono'

const orders = new Hono<{ Bindings: { DB: D1Database } }>()

// ── admin은 query/body의 hospitalId 사용, 일반 사용자는 user.hospitalId 사용
function getHospId(user: any, c: any): number {
  if (user.role === 'admin' || user.role === 'hq') {
    const qId = c.req.query('hospitalId')
    return qId ? Number(qId) : Number(user.hospitalId)
  }
  return Number(user.hospitalId)
}

// ── 고정 경로 라우트를 동적 경로(/:year/:month)보다 먼저 등록해야 충돌을 방지할 수 있습니다 ──
// Hono는 등록 순서대로 매칭하므로 /patient-categories, /category-monthly/:y/:m 등은
// /:year/:month 보다 반드시 먼저 등록되어야 합니다.

// 특정 날짜의 발주 조회 (업체 목록 포함)
orders.get('/date/:date', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const { date } = c.req.param()

  const data = await c.env.DB.prepare(
    `SELECT d.*, v.name as vendor_name, v.category, v.tax_type, v.monthly_budget
     FROM daily_orders d
     RIGHT JOIN vendors v ON d.vendor_id = v.id AND d.order_date = ? AND d.hospital_id = ?
     WHERE v.hospital_id = ? AND v.is_active = 1
     ORDER BY v.sort_order`
  ).bind(date, hospitalId, hospitalId).all<any>()

  return c.json(data.results)
})

// ── 데일리 예산 현황 요약 (일/주/월 실시간) ──────────────────
orders.get('/budget-status/:year/:month/:date', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const { year, month, date } = c.req.param()

  // 월 설정
  const settings = await c.env.DB.prepare(
    `SELECT total_budget, working_days FROM monthly_settings
     WHERE hospital_id=? AND year=? AND month=?`
  ).bind(hospitalId, year, month).first<any>()

  const totalBudget = settings?.total_budget || 0
  const workingDays = settings?.working_days || new Date(parseInt(year), parseInt(month), 0).getDate()
  const dailyBudget = workingDays > 0 ? Math.round(totalBudget / workingDays) : 0

  // 해당 월 전체 공휴일
  const mm = month.padStart(2,'0')
  const holidayRows = await c.env.DB.prepare(
    `SELECT holiday_date FROM holidays WHERE holiday_date LIKE ?`
  ).bind(`${year}-${mm}-%`).all<any>()
  const holidaySet = new Set((holidayRows.results||[]).map((h:any) => h.holiday_date))

  // 이번 주 범위 (월~일)
  const targetDate = new Date(date)
  const dow = targetDate.getDay()
  const weekStart = new Date(targetDate)
  weekStart.setDate(targetDate.getDate() - (dow === 0 ? 6 : dow - 1))
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  const weekStartStr = weekStart.toISOString().split('T')[0]
  const weekEndStr = weekEnd.toISOString().split('T')[0]

  // 오늘 발주
  const todayRow = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(total_amount),0) as total FROM daily_orders
     WHERE hospital_id=? AND order_date=?`
  ).bind(hospitalId, date).first<any>()

  // 이번 주 발주
  const weekRow = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(total_amount),0) as total FROM daily_orders
     WHERE hospital_id=? AND order_date>=? AND order_date<=?
       AND strftime('%Y',order_date)=? AND strftime('%m',order_date)=printf('%02d',?)`
  ).bind(hospitalId, weekStartStr, weekEndStr, year, month).first<any>()

  // 이번 월 누적
  const monthRow = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(total_amount),0) as total FROM daily_orders
     WHERE hospital_id=?
       AND strftime('%Y',order_date)=?
       AND strftime('%m',order_date)=printf('%02d',?)`
  ).bind(hospitalId, year, month).first<any>()

  // 이번 주 영업일 수 계산 (주말/공휴일 제외)
  let weekWorkDays = 0
  for (let d = new Date(weekStart); d <= weekEnd; d.setDate(d.getDate()+1)) {
    const ds = d.toISOString().split('T')[0]
    const dow2 = d.getDay()
    if (dow2 !== 0 && !holidaySet.has(ds)) weekWorkDays++
  }
  const weekBudget = dailyBudget * weekWorkDays

  // 남은 일수 계산
  const daysInMonth = new Date(parseInt(year), parseInt(month), 0).getDate()
  const todayNum = targetDate.getDate()
  let remainWorkDays = 0
  for (let d = todayNum; d <= daysInMonth; d++) {
    const ds = `${year}-${mm}-${String(d).padStart(2,'0')}`
    const dow2 = new Date(ds).getDay()
    if (dow2 !== 0 && !holidaySet.has(ds)) remainWorkDays++
  }

  const todayUsed = todayRow?.total || 0
  const weekUsed = weekRow?.total || 0
  const monthUsed = monthRow?.total || 0
  const monthRemain = totalBudget - monthUsed

  return c.json({
    totalBudget, dailyBudget, weekBudget, workingDays, weekWorkDays,
    todayUsed,  todayPct: dailyBudget > 0 ? (todayUsed/dailyBudget*100).toFixed(1) : '0.0',
    weekUsed,   weekPct: weekBudget > 0 ? (weekUsed/weekBudget*100).toFixed(1) : '0.0',
    monthUsed,  monthPct: totalBudget > 0 ? (monthUsed/totalBudget*100).toFixed(1) : '0.0',
    monthRemain, remainWorkDays,
    dailyAvailBudget: remainWorkDays > 0 ? Math.round(monthRemain/remainWorkDays) : 0
  })
})

// ── 엑셀 자동입력: 기존 데이터 조회 (사전 경고용) ──────────────
orders.get('/excel-check/:vendorId/:year/:month', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const { vendorId, year, month } = c.req.param()
  const mm = month.padStart(2, '0')

  const rows = await c.env.DB.prepare(`
    SELECT id, order_date, total_amount, input_source, note
    FROM daily_orders
    WHERE hospital_id=? AND vendor_id=? 
      AND strftime('%Y', order_date)=? AND strftime('%m', order_date)=?
    ORDER BY order_date
  `).bind(hospitalId, vendorId, year, mm).all<any>()

  const results = rows.results || []
  const totalAmount = results.reduce((s: number, r: any) => s + (r.total_amount || 0), 0)
  const dateList = results.map((r: any) => r.order_date)
  const sourceCounts = results.reduce((acc: any, r: any) => {
    const src = r.input_source || 'direct'
    acc[src] = (acc[src] || 0) + 1
    return acc
  }, {})

  return c.json({
    count: results.length,
    totalAmount,
    dateList,
    sourceCounts,
    rows: results
  })
})

// ── 엑셀 자동입력: 월 전체 교체 저장 (기존 삭제 후 새 데이터 일괄 INSERT) ──
orders.post('/excel-replace', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const body = await c.req.json()
  const { vendorId, year, month, items } = body
  // items: [{ orderDate, taxableAmount, exemptAmount, vatAmount, totalAmount }]

  if (!vendorId || !year || !month || !Array.isArray(items)) {
    return c.json({ success: false, error: 'invalid params' }, 400)
  }
  const mm = String(month).padStart(2, '0')

  // 1) 해당 업체 + 해당 월 기존 데이터 전체 삭제
  await c.env.DB.prepare(`
    DELETE FROM daily_orders
    WHERE hospital_id=? AND vendor_id=?
      AND strftime('%Y', order_date)=? AND strftime('%m', order_date)=?
  `).bind(hospitalId, vendorId, String(year), mm).run()

  // 2) 새 데이터 일괄 INSERT
  let success = 0, fail = 0
  const errors: string[] = []

  for (const it of items) {
    try {
      const isMixedTotal = it.totalAmount !== undefined && (it.taxableAmount || 0) === 0 && (it.exemptAmount || 0) === 0 && (it.vatAmount || 0) === 0
      const totalAmount = isMixedTotal
        ? it.totalAmount
        : (it.taxableAmount || 0) + (it.exemptAmount || 0) + (it.vatAmount || 0)

      if (!it.orderDate || totalAmount <= 0) {
        fail++
        errors.push(`날짜(${it.orderDate}) 또는 금액(${totalAmount}) 오류`)
        continue
      }

      await c.env.DB.prepare(`
        INSERT INTO daily_orders
          (hospital_id, vendor_id, order_date,
           taxable_amount, exempt_amount, vat_amount, total_amount,
           note, input_source)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).bind(
        hospitalId, vendorId, it.orderDate,
        it.taxableAmount || 0, it.exemptAmount || 0, it.vatAmount || 0, totalAmount,
        '엑셀자동입력', 'excel'
      ).run()
      success++
    } catch (e: any) {
      fail++
      errors.push(e?.message || '저장 오류')
    }
  }

  // 3) 결과 요약 반환
  const savedRows = await c.env.DB.prepare(`
    SELECT order_date, total_amount FROM daily_orders
    WHERE hospital_id=? AND vendor_id=?
      AND strftime('%Y', order_date)=? AND strftime('%m', order_date)=?
    ORDER BY order_date
  `).bind(hospitalId, vendorId, String(year), mm).all<any>()

  const savedList = savedRows.results || []
  const savedTotal = savedList.reduce((s: number, r: any) => s + (r.total_amount || 0), 0)
  const savedDates = [...new Set(savedList.map((r: any) => r.order_date))]

  return c.json({
    success: fail === 0,
    saved: success,
    failed: fail,
    errors,
    savedTotal,
    savedDates,
    dateMin: savedDates[0] || null,
    dateMax: savedDates[savedDates.length - 1] || null
  })
})

// 발주 저장/수정 (upsert)
orders.post('/save', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const body = await c.req.json()
  const { vendorId, orderDate, taxableAmount, exemptAmount, vatAmount, totalAmount: directTotal, note, isMultiDay, multiDayStart, multiDayEnd, multiDayCount } = body

  // mixed_total 타입: directTotal이 직접 전달된 경우 그대로 사용
  // 일반 과세/면세 타입: taxable+exempt+vat 합산
  let totalAmount: number
  if (directTotal !== undefined && directTotal !== null && (taxableAmount || 0) === 0 && (exemptAmount || 0) === 0 && (vatAmount || 0) === 0) {
    // mixed_total: 합산 총액 직접 입력 (과세+면세+vat 모두 0이고 totalAmount만 있는 경우)
    totalAmount = directTotal
  } else {
    // VAT 반올림 보정
    const roundedVat = Math.round((taxableAmount || 0) * 0.1)
    totalAmount = (taxableAmount || 0) + (exemptAmount || 0) + (vatAmount !== undefined ? vatAmount : roundedVat)
  }

  const existing = await c.env.DB.prepare(
    `SELECT id, input_source FROM daily_orders WHERE hospital_id=? AND vendor_id=? AND order_date=? AND patient_category_id IS NULL`
  ).bind(hospitalId, vendorId, orderDate).first<any>()

  // 모든 금액이 0이면 기존 레코드 삭제
  if (totalAmount === 0 && !note && !isMultiDay) {
    if (existing) {
      await c.env.DB.prepare(`DELETE FROM daily_orders WHERE id=?`).bind(existing.id).run()
    }
    return c.json({ success: true, totalAmount: 0, deleted: true })
  }

  // 입력 출처 결정: 엑셀자동입력 note면 excel, 기존이 excel이면 edit, 나머지는 direct
  const inputSource = note === '엑셀자동입력' ? 'excel'
    : (existing?.input_source === 'excel' ? 'edit' : 'direct')

  if (existing) {
    await c.env.DB.prepare(
      `UPDATE daily_orders SET
       taxable_amount=?, exempt_amount=?, vat_amount=?, total_amount=?,
       note=?, is_multi_day=?, multi_day_start=?, multi_day_end=?,
       input_source=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(taxableAmount||0, exemptAmount||0, vatAmount||0, totalAmount,
           note||null, isMultiDay?1:0, multiDayStart||null, multiDayEnd||null,
           inputSource, existing.id).run()
  } else {
    await c.env.DB.prepare(
      `INSERT INTO daily_orders
       (hospital_id,vendor_id,order_date,taxable_amount,exempt_amount,vat_amount,total_amount,note,is_multi_day,multi_day_start,multi_day_end,input_source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(hospitalId, vendorId, orderDate, taxableAmount||0, exemptAmount||0, vatAmount||0, totalAmount,
           note||null, isMultiDay?1:0, multiDayStart||null, multiDayEnd||null, inputSource).run()
  }

  return c.json({ success: true, totalAmount })
})

// 발주 일괄 저장
orders.post('/save-batch', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const { orderDate, orders: orderList, multiDayCount, multiDayNote } = await c.req.json()

  const stmts = orderList.map((order: any) => {
    const totalAmount = (order.taxableAmount||0) + (order.exemptAmount||0) + (order.vatAmount||0)
    const noteStr = multiDayCount && multiDayCount > 1
      ? `${multiDayCount}일치${order.note ? ' '+order.note : ''}`
      : (order.note || null)
    return c.env.DB.prepare(
      `INSERT INTO daily_orders (hospital_id,vendor_id,order_date,taxable_amount,exempt_amount,vat_amount,total_amount,note,is_multi_day)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(hospital_id,vendor_id,order_date) DO UPDATE SET
       taxable_amount=excluded.taxable_amount, exempt_amount=excluded.exempt_amount,
       vat_amount=excluded.vat_amount, total_amount=excluded.total_amount,
       note=excluded.note, is_multi_day=excluded.is_multi_day,
       updated_at=CURRENT_TIMESTAMP`
    ).bind(hospitalId, order.vendorId, orderDate,
           order.taxableAmount||0, order.exemptAmount||0, order.vatAmount||0, totalAmount,
           noteStr, (multiDayCount && multiDayCount > 1) ? 1 : 0)
  })

  if (stmts.length > 0) await c.env.DB.batch(stmts)
  return c.json({ success: true })
})

// 발주 삭제
orders.delete('/:id', async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  await c.env.DB.prepare(
    `DELETE FROM daily_orders WHERE id=? AND hospital_id=?`
  ).bind(id, user.hospitalId).run()
  return c.json({ success: true })
})

// ── 환자군 카테고리 목록 조회 (영양사용) ────────────────────
orders.get('/patient-categories', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospId(user, c)
  if (!hospitalId) return c.json([])

  const cats = await c.env.DB.prepare(`
    SELECT *, category_name as name FROM hospital_patient_categories
    WHERE hospital_id = ? AND is_active = 1
    ORDER BY sort_order, id
  `).bind(hospitalId).all<any>()
  return c.json(cats.results || [])
})

// ── 카테고리별 월간 발주 현황 (영양사용) ────────────────────
orders.get('/category-monthly/:year/:month', async (c) => {
  try {
  const user = c.get('user')
  const hospitalId = getHospId(user, c)
  if (!hospitalId) return c.json({ categories: [], monthly: [], settings: [] })

  const { year, month } = c.req.param()
  const mm = month.padStart(2, '0')

  const cats = await c.env.DB.prepare(`
    SELECT *, category_name as name FROM hospital_patient_categories
    WHERE hospital_id = ? AND is_active = 1
    ORDER BY sort_order, id
  `).bind(hospitalId).all<any>()

  // 소모품(supply)/카드(card)/이벤트(event) 업체는 카테고리 진행률 계산에서 제외
  // 이들을 포함하면 catMonthTotals에 소모품 금액이 들어가 진행률이 비정상적으로 높아짐
  const monthly = await c.env.DB.prepare(`
    SELECT
      d.patient_category_id,
      COALESCE(SUM(d.taxable_amount), 0) as taxable,
      COALESCE(SUM(d.exempt_amount), 0) as exempt,
      COALESCE(SUM(d.vat_amount), 0) as vat,
      COALESCE(SUM(d.total_amount), 0) as total
    FROM daily_orders d
    JOIN vendors v ON d.vendor_id = v.id
    WHERE d.hospital_id = ?
      AND strftime('%Y', d.order_date) = ?
      AND strftime('%m', d.order_date) = ?
      AND v.category NOT IN ('supply', 'card', 'event')
    GROUP BY d.patient_category_id
  `).bind(hospitalId, year, mm).all<any>()

  // 소모품(supply) 업체별 월 합계 (진행률 바 표시용 - 카테고리 구분 없이 전체 합산)
  const supplyVendorMonthly = await c.env.DB.prepare(`
    SELECT
      d.vendor_id,
      COALESCE(SUM(d.total_amount), 0) as total
    FROM daily_orders d
    JOIN vendors v ON d.vendor_id = v.id
    WHERE d.hospital_id = ?
      AND strftime('%Y', d.order_date) = ?
      AND strftime('%m', d.order_date) = ?
      AND v.category IN ('supply', 'card', 'event')
    GROUP BY d.vendor_id
  `).bind(hospitalId, year, mm).all<any>()

  // 소모품(supply) 업체별 일별 발주 데이터 (날짜별 누적 계산용)
  // 소모품은 dailyByVendorCat에 포함되지 않으므로 별도 조회
  // 중요: GROUP BY order_date, vendor_id 로 patient_category_id 중복 합산 방지
  // (동일 날짜에 여러 patient_category_id로 저장된 경우 날짜+업체별로 단일 합산)
  const supplyDailyByVendor = await c.env.DB.prepare(`
    SELECT
      d.order_date,
      d.vendor_id,
      SUM(COALESCE(d.taxable_amount, 0)) as taxable,
      SUM(COALESCE(d.exempt_amount, 0)) as exempt,
      SUM(COALESCE(d.total_amount, 0)) as total
    FROM daily_orders d
    JOIN vendors v ON d.vendor_id = v.id
    WHERE d.hospital_id = ?
      AND strftime('%Y', d.order_date) = ?
      AND strftime('%m', d.order_date) = ?
      AND v.category IN ('supply', 'card', 'event')
    GROUP BY d.order_date, d.vendor_id
    ORDER BY d.order_date, d.vendor_id
  `).bind(hospitalId, year, mm).all<any>()

  // vendor_id + date + patient_category_id 조합 일별 데이터 (서브행 렌더링용)
  // supply/card/event 업체도 포함: 소모품 카드 초기 표시를 위해 필요
  // (프론트엔드에서 supply 업체는 식단가 계산에서 별도 제외 처리함)
  const dailyByVendorCat = await c.env.DB.prepare(`
    SELECT
      d.order_date,
      d.vendor_id,
      d.patient_category_id,
      COALESCE(d.taxable_amount, 0) as taxable,
      COALESCE(d.exempt_amount, 0) as exempt,
      COALESCE(d.vat_amount, 0) as vat,
      COALESCE(d.total_amount, 0) as total,
      d.id
    FROM daily_orders d
    JOIN vendors v ON d.vendor_id = v.id
    WHERE d.hospital_id = ?
      AND strftime('%Y', d.order_date) = ?
      AND strftime('%m', d.order_date) = ?
    ORDER BY d.order_date, d.vendor_id, d.patient_category_id
  `).bind(hospitalId, year, mm).all<any>()

  // ── 해당 월 카테고리 설정 조회 ──────────────────────────────
  // 상속 규칙: 기준월(2026.3) 이전 → 3월 값 사용, 이후 → 직전 설정 상속
  const BASE_YEAR = 2026, BASE_MONTH = 3
  const reqYear = parseInt(year), reqMonth = parseInt(month)

  let catSettingsRows = await c.env.DB.prepare(`
    SELECT cos.*, hpc.category_key, hpc.category_name
    FROM category_order_settings cos
    JOIN hospital_patient_categories hpc ON cos.patient_category_id = hpc.id
    WHERE cos.hospital_id = ? AND cos.year = ? AND cos.month = ?
  `).bind(hospitalId, year, month).all<any>()

  if (!catSettingsRows.results || catSettingsRows.results.length === 0) {
    const isBeforeBase = (reqYear < BASE_YEAR) || (reqYear === BASE_YEAR && reqMonth < BASE_MONTH)

    if (isBeforeBase) {
      // 기준월(3월) 설정을 기본값으로
      catSettingsRows = await c.env.DB.prepare(`
        SELECT cos.*, hpc.category_key, hpc.category_name
        FROM category_order_settings cos
        JOIN hospital_patient_categories hpc ON cos.patient_category_id = hpc.id
        WHERE cos.hospital_id = ? AND cos.year = ? AND cos.month = ?
        ORDER BY hpc.sort_order
      `).bind(hospitalId, BASE_YEAR, BASE_MONTH).all<any>()

      // 3월 설정도 없으면 가장 오래된 설정
      if (!catSettingsRows.results || catSettingsRows.results.length === 0) {
        catSettingsRows = await c.env.DB.prepare(`
          SELECT cos.*, hpc.category_key, hpc.category_name
          FROM category_order_settings cos
          JOIN hospital_patient_categories hpc ON cos.patient_category_id = hpc.id
          WHERE cos.hospital_id = ?
            AND cos.id IN (
              SELECT MIN(id) FROM category_order_settings
              WHERE hospital_id = ?
              GROUP BY patient_category_id
            )
          ORDER BY hpc.sort_order
        `).bind(hospitalId, hospitalId).all<any>()
      }
    } else {
      // 직전 설정 상속
      catSettingsRows = await c.env.DB.prepare(`
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
      `).bind(hospitalId, hospitalId, reqYear, reqYear, reqMonth).all<any>()
    }
  }

  // ── 오늘자 식수 조회 (카테고리별 식단가 계산용) ──
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
  const todayMeals = await c.env.DB.prepare(`
    SELECT
      COALESCE(breakfast_patient,0)+COALESCE(lunch_patient,0)+COALESCE(dinner_patient,0) as patient_total,
      COALESCE(breakfast_staff,0)+COALESCE(lunch_staff,0)+COALESCE(dinner_staff,0) as staff_total,
      COALESCE(breakfast_guardian,0)+COALESCE(lunch_guardian,0)+COALESCE(dinner_guardian,0) as guardian_total
    FROM daily_meals
    WHERE hospital_id = ? AND meal_date = ?
  `).bind(hospitalId, todayStr).first<any>()

  // ── 전월 카테고리 설정 조회 (전월 목표 식단가 비교용 - 동일하게 fallback 적용) ──
  const prevMonthNum = parseInt(month) === 1 ? 12 : parseInt(month) - 1
  const prevYearNum  = parseInt(month) === 1 ? parseInt(year) - 1 : parseInt(year)
  let prevCatSettingsRows = await c.env.DB.prepare(`
    SELECT cos.*, hpc.category_key, hpc.category_name
    FROM category_order_settings cos
    JOIN hospital_patient_categories hpc ON cos.patient_category_id = hpc.id
    WHERE cos.hospital_id = ? AND cos.year = ? AND cos.month = ?
  `).bind(hospitalId, prevYearNum, prevMonthNum).all<any>()

  // 전월도 없으면 전월 이전 중 가장 가까운 설정 사용
  if (!prevCatSettingsRows.results || prevCatSettingsRows.results.length === 0) {
    prevCatSettingsRows = await c.env.DB.prepare(`
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
    `).bind(hospitalId, hospitalId, prevYearNum, prevYearNum, prevMonthNum).all<any>()
  }

  return c.json({
    categories: cats.results || [],
    monthly: monthly.results || [],
    dailyByVendorCat: dailyByVendorCat.results || [],
    supplyVendorMonthly: supplyVendorMonthly.results || [],
    supplyDailyByVendor: supplyDailyByVendor.results || [],
    settings: catSettingsRows.results || [],
    todayMeals: todayMeals || { patient_total: 0, staff_total: 0, guardian_total: 0 },
    prevSettings: prevCatSettingsRows.results || []
  })
  } catch(e: any) {
    console.error('[category-monthly] ERROR:', e?.message || e)
    return c.json({ error: e?.message || 'unknown', categories: [], monthly: [], dailyByVendorCat: [], settings: [], todayMeals: null, prevSettings: [] }, 200)
  }
})

// ── 카테고리별 일별 발주 조회 ────────────────────────────────
orders.get('/category-daily/:year/:month', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospId(user, c)
  if (!hospitalId) return c.json([])

  const { year, month } = c.req.param()
  const mm = month.padStart(2, '0')

  const data = await c.env.DB.prepare(`
    SELECT
      order_date,
      patient_category_id,
      COALESCE(SUM(taxable_amount), 0) as taxable,
      COALESCE(SUM(exempt_amount), 0) as exempt,
      COALESCE(SUM(vat_amount), 0) as vat,
      COALESCE(SUM(total_amount), 0) as total
    FROM daily_orders
    WHERE hospital_id = ?
      AND strftime('%Y', order_date) = ?
      AND strftime('%m', order_date) = ?
    GROUP BY order_date, patient_category_id
    ORDER BY order_date, patient_category_id
  `).bind(hospitalId, year, mm).all<any>()

  return c.json(data.results || [])
})

// ── 카테고리별 발주 저장 ─────────────────────────────────────
orders.post('/save-category', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const body = await c.req.json()
  const { vendorId, orderDate, patientCategoryId, taxableAmount, exemptAmount, vatAmount, totalAmount: directTotal, note } = body

  // mixed_total 타입: directTotal이 직접 전달된 경우 (taxable/exempt/vat 모두 0)
  let totalAmount: number
  if (directTotal !== undefined && directTotal !== null && (taxableAmount || 0) === 0 && (exemptAmount || 0) === 0 && (vatAmount || 0) === 0) {
    totalAmount = directTotal
  } else {
    totalAmount = (taxableAmount || 0) + (exemptAmount || 0) + (vatAmount || 0)
  }

  // vendor + date 조합으로 기존 레코드 조회 (patient_category_id 무관)
  // 소모품/카드 업체는 날짜+업체 기준으로 단일 레코드만 유지 (중복 방지)
  const existingAny = await c.env.DB.prepare(`
    SELECT id, patient_category_id FROM daily_orders
    WHERE hospital_id=? AND vendor_id=? AND order_date=?
    ORDER BY id DESC LIMIT 1
  `).bind(hospitalId, vendorId, orderDate).first<any>()

  // patient_category_id가 일치하는 레코드도 별도 확인
  const existing = await c.env.DB.prepare(`
    SELECT id FROM daily_orders
    WHERE hospital_id=? AND vendor_id=? AND order_date=?
      AND (patient_category_id = ? OR (patient_category_id IS NULL AND ? IS NULL))
  `).bind(hospitalId, vendorId, orderDate, patientCategoryId || null, patientCategoryId || null).first<any>()

  if (totalAmount === 0 && !note) {
    // 모든 금액이 0이면 해당 날짜+업체의 모든 레코드 삭제 (빈 입력으로 초기화)
    await c.env.DB.prepare(`DELETE FROM daily_orders WHERE hospital_id=? AND vendor_id=? AND order_date=?`)
      .bind(hospitalId, vendorId, orderDate).run()
    return c.json({ success: true, totalAmount: 0, deleted: true })
  }

  if (existing) {
    // 동일 patient_category_id 레코드 업데이트
    await c.env.DB.prepare(`
      UPDATE daily_orders SET
        taxable_amount=?, exempt_amount=?, vat_amount=?, total_amount=?,
        patient_category_id=?, note=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(taxableAmount||0, exemptAmount||0, vatAmount||0, totalAmount,
            patientCategoryId||null, note||null, existing.id).run()
  } else if (existingAny) {
    // 다른 patient_category_id로 저장된 레코드가 있으면 업데이트 (중복 방지)
    await c.env.DB.prepare(`
      UPDATE daily_orders SET
        taxable_amount=?, exempt_amount=?, vat_amount=?, total_amount=?,
        patient_category_id=?, note=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(taxableAmount||0, exemptAmount||0, vatAmount||0, totalAmount,
            patientCategoryId||null, note||null, existingAny.id).run()
  } else {
    await c.env.DB.prepare(`
      INSERT INTO daily_orders
        (hospital_id, vendor_id, order_date, patient_category_id,
         taxable_amount, exempt_amount, vat_amount, total_amount, note)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).bind(hospitalId, vendorId, orderDate, patientCategoryId||null,
            taxableAmount||0, exemptAmount||0, vatAmount||0, totalAmount, note||null).run()
  }

  return c.json({ success: true, totalAmount })
})

// ── 카테고리별 연간 발주 현황 (영양사용) ────────────────────
orders.get('/category-annual/:year', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospId(user, c)
  if (!hospitalId) return c.json({ categories: [], annualByCategory: [], annualSettings: [] })

  const { year } = c.req.param()

  const cats = await c.env.DB.prepare(`
    SELECT * FROM hospital_patient_categories
    WHERE hospital_id = ? AND is_active = 1
    ORDER BY sort_order, id
  `).bind(hospitalId).all<any>()

  const annual = await c.env.DB.prepare(`
    SELECT
      d.patient_category_id,
      strftime('%m', d.order_date) as month,
      COALESCE(SUM(d.taxable_amount), 0) as taxable,
      COALESCE(SUM(d.exempt_amount), 0) as exempt,
      COALESCE(SUM(d.total_amount), 0) as total
    FROM daily_orders d
    WHERE d.hospital_id = ?
      AND strftime('%Y', d.order_date) = ?
      AND d.patient_category_id IS NOT NULL
    GROUP BY d.patient_category_id, strftime('%m', d.order_date)
    ORDER BY d.patient_category_id, month
  `).bind(hospitalId, year).all<any>()

  const annualSettings = await c.env.DB.prepare(`
    SELECT cos.*, hpc.category_key, hpc.category_name
    FROM category_order_settings cos
    JOIN hospital_patient_categories hpc ON cos.patient_category_id = hpc.id
    WHERE cos.hospital_id = ? AND cos.year = ?
    ORDER BY hpc.sort_order, cos.month
  `).bind(hospitalId, year).all<any>()

  // ── formula 기반 카테고리 식단가 계산을 위한 월별 식수 데이터 ──
  const customFields = await c.env.DB.prepare(
    `SELECT * FROM meal_custom_fields WHERE hospital_id = ? AND is_active = 1 ORDER BY sort_order, id`
  ).bind(hospitalId).all<any>()

  const mealCustomRows = await c.env.DB.prepare(
    `SELECT strftime('%m', meal_date) as month,
            custom_data,
            COALESCE(breakfast_staff+lunch_staff+dinner_staff, 0) as total_staff,
            COALESCE(breakfast_guardian+lunch_guardian+dinner_guardian, 0) as total_guardian
     FROM daily_meals
     WHERE hospital_id = ? AND strftime('%Y', meal_date) = ?`
  ).bind(hospitalId, year).all<any>()

  // 월별 커스텀 필드 식수 집계
  const catMealMonthMap: Record<string, Record<string,number>> = {}
  const staffMonthMap: Record<string, number> = {}
  const guardianMonthMap: Record<string, number> = {}
  ;(mealCustomRows.results || []).forEach((row: any) => {
    const m = String(parseInt(row.month))
    staffMonthMap[m] = (staffMonthMap[m] || 0) + (row.total_staff || 0)
    guardianMonthMap[m] = (guardianMonthMap[m] || 0) + (row.total_guardian || 0)
    if (!catMealMonthMap[m]) catMealMonthMap[m] = {}
    try {
      const cd = JSON.parse(row.custom_data || '{}')
      ;(customFields.results || []).filter((f: any) => f.unit_type !== 'ea').forEach((f: any) => {
        const fv = cd[f.field_key] || {}
        catMealMonthMap[m][f.field_key] = (catMealMonthMap[m][f.field_key] || 0) + (fv.bf||0) + (fv.l||0) + (fv.d||0)
      })
    } catch(e) {}
  })

  // 카테고리 key → id 맵
  const catKeyIdMap: Record<string, number> = {}
  ;(cats.results || []).forEach((cat: any) => { catKeyIdMap[cat.category_key] = cat.id })

  // 카테고리별 월 발주맵: catOrderMonthMap[catId][month] = total
  const catOrderMonthMap: Record<number, Record<string,number>> = {}
  ;(annual.results || []).forEach((r: any) => {
    if (!catOrderMonthMap[r.patient_category_id]) catOrderMonthMap[r.patient_category_id] = {}
    catOrderMonthMap[r.patient_category_id][String(parseInt(r.month))] = r.total
  })

  // 카테고리별 월별 formula 식단가 계산
  const catDietPriceAnnual = (cats.results || []).map((cat: any) => {
    let budgetKeys: string[] = []
    let mealsKeys: string[] = []
    try { budgetKeys = JSON.parse(cat.budget_include_keys || 'null') || [] } catch(e) {}
    try { mealsKeys = JSON.parse(cat.meals_include_keys || 'null') || [] } catch(e) {}
    const hasFormula = budgetKeys.length > 0 || mealsKeys.length > 0

    const monthly: Array<{month: number, monthAmt: number, monthMeals: number, dietPrice: number}> = []
    for (let m = 1; m <= 12; m++) {
      const mStr = String(m)
      let monthAmt: number
      if (hasFormula && budgetKeys.length > 0) {
        monthAmt = budgetKeys.reduce((sum: number, key: string) => {
          const catId = catKeyIdMap[key]
          return sum + (catId ? (catOrderMonthMap[catId]?.[mStr] || 0) : 0)
        }, 0)
      } else {
        monthAmt = catOrderMonthMap[cat.id]?.[mStr] || 0
      }
      const mCustom = catMealMonthMap[mStr] || {}
      const mStaff = staffMonthMap[mStr] || 0
      const mGuardian = guardianMonthMap[mStr] || 0
      let monthMeals: number
      if (hasFormula && mealsKeys.length > 0) {
        let total = 0
        if (mealsKeys.includes('staff') || mealsKeys.some((k: string) => k.startsWith('st_key_'))) total += mStaff
        if (mealsKeys.includes('guardian')) total += mGuardian
        mealsKeys.filter((k: string) => k.startsWith('cat_')).forEach((k: string) => { total += (mCustom[k] || 0) })
        // nc_key_/th_key_ 처리: diet_categories.diet_key 기반 → meal_custom_fields.field_key는 'diet_' 접두사 추가
        // nc_key_preset_nc_guardian_1 → dietKey='preset_nc_guardian_1' → field_key='diet_preset_nc_guardian_1'
        mealsKeys.filter((k: string) => k.startsWith('nc_key_')).forEach((k: string) => {
          const dietKey = k.replace('nc_key_', '')
          total += (mCustom['diet_' + dietKey] || mCustom[dietKey] || 0)
        })
        mealsKeys.filter((k: string) => k.startsWith('th_key_')).forEach((k: string) => {
          const dietKey = k.replace('th_key_', '')
          total += (mCustom['diet_' + dietKey] || mCustom[dietKey] || 0)
        })
        monthMeals = total
      } else {
        const defaultCatKey = `cat_${cat.category_key}`
        monthMeals = (mCustom[defaultCatKey] || 0) + mStaff + mGuardian
      }
      const dietPrice = monthMeals > 0 ? Math.round(monthAmt / monthMeals) : 0
      monthly.push({ month: m, monthAmt, monthMeals, dietPrice })
    }
    return {
      id: cat.id,
      category_key: cat.category_key,
      category_name: cat.category_name,
      budgetKeys,
      mealsKeys,
      monthly
    }
  })

  return c.json({
    categories: cats.results || [],
    annualByCategory: annual.results || [],
    annualSettings: annualSettings.results || [],
    catDietPriceAnnual
  })
})

// ── 월별 발주 목록 조회 (동적 경로 - 반드시 모든 고정 경로 라우트 이후에 위치해야 함) ──
// 주의: /:year/:month 는 /patient-categories, /category-monthly/... 등과 충돌하므로
// 반드시 파일의 마지막 GET 라우트여야 합니다.
orders.get('/:year/:month', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospId(user, c)
  const { year, month } = c.req.param()

  // BETWEEN을 사용해 인덱스 활용 (strftime보다 빠름)
  const monthPadded = String(parseInt(month)).padStart(2, '0')
  const dateStart = `${year}-${monthPadded}-01`
  const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate()
  const dateEnd = `${year}-${monthPadded}-${String(lastDay).padStart(2, '0')}`

  const [data, multidaySettings] = await Promise.all([
    c.env.DB.prepare(
      `SELECT d.*, v.name as vendor_name, v.category, v.tax_type
       FROM daily_orders d
       JOIN vendors v ON d.vendor_id = v.id
       WHERE d.hospital_id = ?
         AND d.order_date BETWEEN ? AND ?
       ORDER BY d.order_date, v.sort_order`
    ).bind(hospitalId, dateStart, dateEnd).all<any>(),

    // 해당 월 발주일수 설정도 함께 반환
    c.env.DB.prepare(
      `SELECT order_date, day_count, multi_day_end
       FROM order_multiday_settings
       WHERE hospital_id = ?
         AND order_date BETWEEN ? AND ?`
    ).bind(hospitalId, dateStart, dateEnd).all<any>()
  ])

  return c.json({ orders: data.results, multidaySettings: multidaySettings.results || [] })
})

// 발주일수 설정 저장 (금액 없어도 저장 가능)
orders.post('/multiday-setting', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const { orderDate, dayCount } = await c.req.json()

  if (!orderDate || !dayCount) return c.json({ error: 'invalid params' }, 400)

  const endDate = new Date(orderDate)
  endDate.setDate(endDate.getDate() + dayCount - 1)
  const multiDayEnd = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}-${String(endDate.getDate()).padStart(2,'0')}`

  if (dayCount <= 1) {
    // 1일치면 설정 삭제
    await c.env.DB.prepare(
      `DELETE FROM order_multiday_settings WHERE hospital_id=? AND order_date=?`
    ).bind(hospitalId, orderDate).run()
  } else {
    await c.env.DB.prepare(
      `INSERT INTO order_multiday_settings (hospital_id, order_date, day_count, multi_day_end, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(hospital_id, order_date) DO UPDATE SET
         day_count=excluded.day_count, multi_day_end=excluded.multi_day_end, updated_at=CURRENT_TIMESTAMP`
    ).bind(hospitalId, orderDate, dayCount, multiDayEnd).run()
  }

  return c.json({ success: true, orderDate, dayCount, multiDayEnd })
})

// ══════════════════════════════════════════════════════════════
// 2.1 발주 검수 완료 관리 API
// ══════════════════════════════════════════════════════════════

// 미검수 발주 목록 조회
orders.get('/inspection/pending/:year/:month', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospId(user, c)
  const { year, month } = c.req.param()

  const data = await c.env.DB.prepare(
    `SELECT d.id, d.order_date, d.total_amount, d.taxable_amount, d.exempt_amount,
            d.is_inspected, d.actual_amount, d.inspection_memo, d.received_date,
            d.inspected_at, d.inspected_by, d.inspection_status,
            COALESCE(v.name, '미등록 업체(ID:'||d.vendor_id||')') as vendor_name,
            v.category, v.tax_type
     FROM daily_orders d
     LEFT JOIN vendors v ON d.vendor_id = v.id
     WHERE d.hospital_id = ?
       AND strftime('%Y', d.order_date) = ?
       AND strftime('%m', d.order_date) = printf('%02d', ?)
     ORDER BY d.order_date DESC, v.sort_order`
  ).bind(hospitalId, year, month).all<any>()

  const all = data.results || []
  const pending = all.filter((r: any) => !r.is_inspected)
  const completed = all.filter((r: any) => r.is_inspected)

  return c.json({
    all,
    pending,
    completed,
    summary: {
      total: all.length,
      pendingCount: pending.length,
      completedCount: completed.length,
      pendingAmount: pending.reduce((s: number, r: any) => s + r.total_amount, 0),
      completedAmount: completed.reduce((s: number, r: any) => s + r.total_amount, 0),
      actualAmount: completed.reduce((s: number, r: any) => s + (r.actual_amount || r.total_amount), 0),
      pendingList: pending.slice(0, 10)
    }
  })
})

// 일괄 검수 완료 처리 (반드시 /inspection/:orderId 보다 앞에 위치해야 함)
orders.put('/inspection/batch', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const body = await c.req.json()
  const { orderIds, inspection_memo, received_date } = body

  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return c.json({ error: 'orderIds 필요' }, 400)
  }

  const now = new Date().toISOString()
  const username = user.username || user.name || 'unknown'
  let updated = 0

  for (const orderId of orderIds) {
    const existing = await c.env.DB.prepare(
      `SELECT id, total_amount FROM daily_orders WHERE id = ? AND hospital_id = ?`
    ).bind(orderId, hospitalId).first<any>()
    if (!existing) continue

    await c.env.DB.prepare(
      `UPDATE daily_orders SET is_inspected=1, actual_amount=total_amount,
         inspection_status='completed_ok',
         inspection_memo=?, received_date=?, inspected_at=?, inspected_by=?
       WHERE id = ? AND hospital_id = ?`
    ).bind(inspection_memo ?? null, received_date ?? null, now, username, orderId, hospitalId).run()

    await c.env.DB.prepare(
      `INSERT INTO order_inspections (order_id, hospital_id, inspected_at, inspected_by,
         original_amount, actual_amount, difference, memo, status)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'completed')`
    ).bind(orderId, hospitalId, now, username, existing.total_amount, existing.total_amount, inspection_memo ?? null).run()
    updated++
  }

  return c.json({ success: true, updated })
})

// 검수 완료 처리 (단건)
orders.put('/inspection/:orderId', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const orderId = c.req.param('orderId')
  const body = await c.req.json()
  const { is_inspected, actual_amount, inspection_memo, received_date, status } = body

  // 권한 확인: 해당 발주가 이 병원 것인지
  const existing = await c.env.DB.prepare(
    `SELECT id, total_amount FROM daily_orders WHERE id = ? AND hospital_id = ?`
  ).bind(orderId, hospitalId).first<any>()
  if (!existing) return c.json({ error: '발주를 찾을 수 없습니다' }, 404)

  const now = new Date().toISOString()
  await c.env.DB.prepare(
    `UPDATE daily_orders SET
       is_inspected = ?,
       actual_amount = ?,
       inspection_memo = ?,
       received_date = ?,
       inspected_at = ?,
       inspected_by = ?
     WHERE id = ? AND hospital_id = ?`
  ).bind(
    is_inspected ? 1 : 0,
    actual_amount ?? existing.total_amount,
    inspection_memo ?? null,
    received_date ?? null,
    is_inspected ? now : null,
    is_inspected ? (user.username || user.name || 'unknown') : null,
    orderId, hospitalId
  ).run()

  // 검수 이력 저장
  if (is_inspected) {
    await c.env.DB.prepare(
      `INSERT INTO order_inspections (order_id, hospital_id, inspected_at, inspected_by,
         original_amount, actual_amount, difference, memo, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      orderId, hospitalId, now,
      user.username || user.name || 'unknown',
      existing.total_amount,
      actual_amount ?? existing.total_amount,
      (actual_amount ?? existing.total_amount) - existing.total_amount,
      inspection_memo ?? null,
      status ?? 'completed'
    ).run()
  }

  return c.json({ success: true, orderId })
})

// #1 검수 이슈 저장 (단건)
orders.post('/inspection/issue', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const body = await c.req.json()
  const { order_id, vendor_name, item_name, issue_type, issue_detail,
          deduction_amount, order_amount, actual_amount, inspection_status } = body

  if (!order_id || !issue_type) {
    return c.json({ error: 'order_id, issue_type 필요' }, 400)
  }

  const existing = await c.env.DB.prepare(
    `SELECT id, total_amount FROM daily_orders WHERE id = ? AND hospital_id = ?`
  ).bind(order_id, hospitalId).first<any>()
  if (!existing) return c.json({ error: '발주를 찾을 수 없습니다' }, 404)

  const now = new Date().toISOString()
  const username = user.username || user.name || 'unknown'

  // inspection_issues 테이블에 이슈 저장
  await c.env.DB.prepare(
    `INSERT INTO inspection_issues (order_id, hospital_id, vendor_name, item_name,
       issue_type, issue_detail, deduction_amount, order_amount, actual_amount, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    order_id, hospitalId, vendor_name ?? null, item_name ?? null,
    issue_type, issue_detail ?? null,
    deduction_amount ?? 0, order_amount ?? existing.total_amount,
    actual_amount ?? (existing.total_amount - (deduction_amount ?? 0)),
    username
  ).run()

  // daily_orders 상태 업데이트
  const newStatus = inspection_status || 'completed_issue'
  const newActual = actual_amount ?? (existing.total_amount - (deduction_amount ?? 0))
  await c.env.DB.prepare(
    `UPDATE daily_orders SET
       is_inspected = 1, inspection_status = ?,
       actual_amount = ?, deduction_amount = ?,
       inspection_memo = ?, inspected_at = ?, inspected_by = ?
     WHERE id = ? AND hospital_id = ?`
  ).bind(
    newStatus, newActual, deduction_amount ?? 0,
    issue_detail ?? null, now, username,
    order_id, hospitalId
  ).run()

  return c.json({ success: true })
})

// #1 검수 이슈 목록 조회
orders.get('/inspection/issues/:year/:month', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const { year, month } = c.req.param()

  const data = await c.env.DB.prepare(
    `SELECT ii.*, d.order_date, d.total_amount as order_total,
            d.inspection_status, v.name as vendor_name_actual
     FROM inspection_issues ii
     JOIN daily_orders d ON ii.order_id = d.id
     JOIN vendors v ON d.vendor_id = v.id
     WHERE ii.hospital_id = ?
       AND strftime('%Y', d.order_date) = ?
       AND strftime('%m', d.order_date) = printf('%02d', ?)
     ORDER BY d.order_date DESC, ii.created_at DESC`
  ).bind(hospitalId, year, month).all<any>()

  return c.json(data.results || [])
})

export default orders
