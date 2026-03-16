import { Hono } from 'hono'

const orders = new Hono<{ Bindings: { DB: D1Database } }>()

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
    `SELECT id FROM daily_orders WHERE hospital_id=? AND vendor_id=? AND order_date=? AND patient_category_id IS NULL`
  ).bind(hospitalId, vendorId, orderDate).first<any>()

  // 모든 금액이 0이면 기존 레코드 삭제
  if (totalAmount === 0 && !note && !isMultiDay) {
    if (existing) {
      await c.env.DB.prepare(`DELETE FROM daily_orders WHERE id=?`).bind(existing.id).run()
    }
    return c.json({ success: true, totalAmount: 0, deleted: true })
  }

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

  // vendor_id + date + patient_category_id 조합 일별 데이터 (서브행 렌더링용)
  const dailyByVendorCat = await c.env.DB.prepare(`
    SELECT
      order_date,
      vendor_id,
      patient_category_id,
      COALESCE(taxable_amount, 0) as taxable,
      COALESCE(exempt_amount, 0) as exempt,
      COALESCE(vat_amount, 0) as vat,
      COALESCE(total_amount, 0) as total,
      id
    FROM daily_orders
    WHERE hospital_id = ?
      AND patient_category_id IS NOT NULL
      AND strftime('%Y', order_date) = ?
      AND strftime('%m', order_date) = ?
    ORDER BY order_date, vendor_id, patient_category_id
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
    settings: catSettingsRows.results || [],
    todayMeals: todayMeals || { patient_total: 0, staff_total: 0, guardian_total: 0 },
    prevSettings: prevCatSettingsRows.results || []
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
  const { vendorId, orderDate, patientCategoryId, taxableAmount, exemptAmount, vatAmount, totalAmount: directTotal, note } = body

  // mixed_total 타입: directTotal이 직접 전달된 경우 (taxable/exempt/vat 모두 0)
  let totalAmount: number
  if (directTotal !== undefined && directTotal !== null && (taxableAmount || 0) === 0 && (exemptAmount || 0) === 0 && (vatAmount || 0) === 0) {
    totalAmount = directTotal
  } else {
    totalAmount = (taxableAmount || 0) + (exemptAmount || 0) + (vatAmount || 0)
  }

  // vendor + date + category 조합으로 upsert
  const existing = await c.env.DB.prepare(`
    SELECT id FROM daily_orders
    WHERE hospital_id=? AND vendor_id=? AND order_date=?
      AND (patient_category_id = ? OR (patient_category_id IS NULL AND ? IS NULL))
  `).bind(hospitalId, vendorId, orderDate, patientCategoryId || null, patientCategoryId || null).first<any>()

  if (totalAmount === 0 && !note) {
    // 모든 금액이 0이면 기존 레코드 삭제 (빈 입력으로 초기화)
    if (existing) {
      await c.env.DB.prepare(`DELETE FROM daily_orders WHERE id=?`).bind(existing.id).run()
    }
    return c.json({ success: true, totalAmount: 0, deleted: true })
  }

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
        if (mealsKeys.includes('staff')) total += mStaff
        if (mealsKeys.includes('guardian')) total += mGuardian
        mealsKeys.filter(k => k.startsWith('cat_')).forEach(k => { total += (mCustom[k] || 0) })
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

export default orders
