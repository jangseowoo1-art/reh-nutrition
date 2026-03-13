import { Hono } from 'hono'

const orders = new Hono<{ Bindings: { DB: D1Database } }>()

// 월별 발주 목록 조회
orders.get('/:year/:month', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const { year, month } = c.req.param()

  const data = await c.env.DB.prepare(
    `SELECT d.*, v.name as vendor_name, v.category, v.tax_type
     FROM daily_orders d
     JOIN vendors v ON d.vendor_id = v.id
     WHERE d.hospital_id = ?
       AND strftime('%Y', d.order_date) = ?
       AND strftime('%m', d.order_date) = printf('%02d', ?)
     ORDER BY d.order_date, v.sort_order`
  ).bind(hospitalId, year, month).all<any>()

  return c.json(data.results)
})

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

// 발주 저장/수정 (upsert)
orders.post('/save', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const body = await c.req.json()
  const { vendorId, orderDate, taxableAmount, exemptAmount, vatAmount, note, isMultiDay, multiDayStart, multiDayEnd, multiDayCount } = body

  const totalAmount = (taxableAmount || 0) + (exemptAmount || 0) + (vatAmount || 0)

  const existing = await c.env.DB.prepare(
    `SELECT id FROM daily_orders WHERE hospital_id=? AND vendor_id=? AND order_date=?`
  ).bind(hospitalId, vendorId, orderDate).first<any>()

  if (existing) {
    await c.env.DB.prepare(
      `UPDATE daily_orders SET
       taxable_amount=?, exempt_amount=?, vat_amount=?, total_amount=?,
       note=?, is_multi_day=?, multi_day_start=?, multi_day_end=?,
       updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(taxableAmount||0, exemptAmount||0, vatAmount||0, totalAmount,
           note||null, isMultiDay?1:0, multiDayStart||null, multiDayEnd||null, existing.id).run()
  } else {
    await c.env.DB.prepare(
      `INSERT INTO daily_orders
       (hospital_id,vendor_id,order_date,taxable_amount,exempt_amount,vat_amount,total_amount,note,is_multi_day,multi_day_start,multi_day_end)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(hospitalId, vendorId, orderDate, taxableAmount||0, exemptAmount||0, vatAmount||0, totalAmount,
           note||null, isMultiDay?1:0, multiDayStart||null, multiDayEnd||null).run()
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
  const hospitalId = Number(user.hospitalId)
  if (!hospitalId) return c.json([])

  const cats = await c.env.DB.prepare(`
    SELECT * FROM hospital_patient_categories
    WHERE hospital_id = ? AND is_active = 1
    ORDER BY sort_order, id
  `).bind(hospitalId).all<any>()
  return c.json(cats.results || [])
})

// ── 카테고리별 월간 발주 현황 (영양사용) ────────────────────
orders.get('/category-monthly/:year/:month', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  if (!hospitalId) return c.json({ categories: [], monthly: [], settings: [] })

  const { year, month } = c.req.param()
  const mm = month.padStart(2, '0')

  const cats = await c.env.DB.prepare(`
    SELECT * FROM hospital_patient_categories
    WHERE hospital_id = ? AND is_active = 1
    ORDER BY sort_order, id
  `).bind(hospitalId).all<any>()

  const monthly = await c.env.DB.prepare(`
    SELECT
      patient_category_id,
      COALESCE(SUM(taxable_amount), 0) as taxable,
      COALESCE(SUM(exempt_amount), 0) as exempt,
      COALESCE(SUM(vat_amount), 0) as vat,
      COALESCE(SUM(total_amount), 0) as total
    FROM daily_orders
    WHERE hospital_id = ?
      AND strftime('%Y', order_date) = ?
      AND strftime('%m', order_date) = ?
    GROUP BY patient_category_id
  `).bind(hospitalId, year, mm).all<any>()

  const catSettings = await c.env.DB.prepare(`
    SELECT cos.*, hpc.category_key, hpc.category_name
    FROM category_order_settings cos
    JOIN hospital_patient_categories hpc ON cos.patient_category_id = hpc.id
    WHERE cos.hospital_id = ? AND cos.year = ? AND cos.month = ?
  `).bind(hospitalId, year, month).all<any>()

  return c.json({
    categories: cats.results || [],
    monthly: monthly.results || [],
    settings: catSettings.results || []
  })
})

// ── 카테고리별 일별 발주 조회 ────────────────────────────────
orders.get('/category-daily/:year/:month', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
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
  const { vendorId, orderDate, patientCategoryId, taxableAmount, exemptAmount, vatAmount, note } = body

  const totalAmount = (taxableAmount || 0) + (exemptAmount || 0) + (vatAmount || 0)

  // vendor + date + category 조합으로 upsert
  const existing = await c.env.DB.prepare(`
    SELECT id FROM daily_orders
    WHERE hospital_id=? AND vendor_id=? AND order_date=?
      AND (patient_category_id = ? OR (patient_category_id IS NULL AND ? IS NULL))
  `).bind(hospitalId, vendorId, orderDate, patientCategoryId || null, patientCategoryId || null).first<any>()

  if (existing) {
    await c.env.DB.prepare(`
      UPDATE daily_orders SET
        taxable_amount=?, exempt_amount=?, vat_amount=?, total_amount=?,
        patient_category_id=?, note=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(taxableAmount||0, exemptAmount||0, vatAmount||0, totalAmount,
            patientCategoryId||null, note||null, existing.id).run()
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
  const hospitalId = Number(user.hospitalId)
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

  return c.json({
    categories: cats.results || [],
    annualByCategory: annual.results || [],
    annualSettings: annualSettings.results || []
  })
})

export default orders
