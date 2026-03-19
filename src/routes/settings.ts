import { Hono } from 'hono'

const settings = new Hono<{ Bindings: { DB: D1Database } }>()

// 월별 설정 조회 (해당 월 없으면 가장 최근 설정을 기본값으로 반환)
settings.get('/:year/:month', async (c) => {
  const user = c.get('user')
  const { year, month } = c.req.param()
  // 관리자는 hospitalId 쿼리 파라미터 허용
  const hospitalId = Number(user.role === 'admin' ? (c.req.query('hospitalId') || user.hospitalId) : user.hospitalId)

  const reqYear = parseInt(year)
  const reqMonth = parseInt(month)

  // 프로그램 최초 기준: 2026년 3월
  const BASE_YEAR = 2026, BASE_MONTH = 3

  // 1) 해당 월 설정 조회
  let data = await c.env.DB.prepare(
    `SELECT * FROM monthly_settings WHERE hospital_id = ? AND year = ? AND month = ?`
  ).bind(hospitalId, year, month).first<any>()

  let isFallback = false
  let fallbackYearMonth: string | null = null

  if (!data) {
    const isBeforeBase = (reqYear < BASE_YEAR) || (reqYear === BASE_YEAR && reqMonth < BASE_MONTH)

    if (isBeforeBase) {
      // 2a) 기준월(3월) 이전 → 3월 설정을 기본값으로 사용
      data = await c.env.DB.prepare(
        `SELECT * FROM monthly_settings WHERE hospital_id = ? AND year = ? AND month = ?`
      ).bind(hospitalId, BASE_YEAR, BASE_MONTH).first<any>()

      // 3월 설정도 없으면 가장 오래된 설정 사용
      if (!data) {
        data = await c.env.DB.prepare(
          `SELECT * FROM monthly_settings
           WHERE hospital_id = ?
           ORDER BY CAST(year AS INTEGER) ASC, CAST(month AS INTEGER) ASC LIMIT 1`
        ).bind(hospitalId).first<any>()
      }
      if (data) {
        isFallback = true
        fallbackYearMonth = `${BASE_YEAR}년 ${BASE_MONTH}월 기준값`
      }
    } else {
      // 2b) 기준월 이후 → 직전에 설정된 값 상속 (가장 가까운 이전 월)
      data = await c.env.DB.prepare(
        `SELECT * FROM monthly_settings
         WHERE hospital_id = ?
           AND (CAST(year AS INTEGER) < CAST(? AS INTEGER)
                OR (CAST(year AS INTEGER) = CAST(? AS INTEGER) AND CAST(month AS INTEGER) < CAST(? AS INTEGER)))
         ORDER BY CAST(year AS INTEGER) DESC, CAST(month AS INTEGER) DESC LIMIT 1`
      ).bind(hospitalId, reqYear, reqYear, reqMonth).first<any>()
      if (data) {
        isFallback = true
        fallbackYearMonth = `${data.year}년 ${data.month}월`
      }
    }
  }

  return c.json({ settings: data || {}, isFallback, fallbackYearMonth })
})

// 월별 설정 저장
settings.post('/save', async (c) => {
  const user = c.get('user')
  const { year, month, totalBudget, eventBudget, mealPrice, foodWasteBudget, workingDays } = await c.req.json()

  await c.env.DB.prepare(
    `INSERT INTO monthly_settings (hospital_id, year, month, total_budget, event_budget, meal_price, food_waste_budget, working_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(hospital_id, year, month) DO UPDATE SET
     total_budget = excluded.total_budget,
     event_budget = excluded.event_budget,
     meal_price = excluded.meal_price,
     food_waste_budget = excluded.food_waste_budget,
     working_days = excluded.working_days,
     updated_at = CURRENT_TIMESTAMP`
  ).bind(user.hospitalId, year, month, totalBudget || 0, eventBudget || 0, mealPrice || 0, foodWasteBudget || 0, workingDays || 0).run()

  return c.json({ success: true })
})

// 병원 정보 조회
settings.get('/hospital', async (c) => {
  const user = c.get('user')
  const data = await c.env.DB.prepare(
    `SELECT * FROM hospitals WHERE id = ?`
  ).bind(user.hospitalId).first<any>()
  return c.json(data || {})
})

// 현재 활성 월 조회 (관리자가 설정한 기준월)
settings.get('/active-month', async (c) => {
  const user = c.get('user')
  const info = await c.env.DB.prepare(
    `SELECT current_year, current_month, closing_status, closing_requested_at FROM hospital_info WHERE hospital_id = ?`
  ).bind(user.hospitalId).first<any>()
  
  // 없으면 현재 날짜 기준
  const now = new Date()
  const activeYear  = info?.current_year  || now.getFullYear()
  const activeMonth = info?.current_month || now.getMonth() + 1

  // 승인 완료된 이전 달 목록 조회 (읽기전용 잠금 기준)
  const approvedRows = await c.env.DB.prepare(
    `SELECT year, month FROM monthly_closings WHERE hospital_id=? AND status='approved' ORDER BY year DESC, month DESC LIMIT 24`
  ).bind(user.hospitalId).all<any>()

  const lockedMonths: string[] = (approvedRows.results || []).map(
    (r: any) => `${r.year}-${String(r.month).padStart(2,'0')}`
  )

  return c.json({
    year: activeYear,
    month: activeMonth,
    closingStatus: info?.closing_status || 'open',
    closingRequestedAt: info?.closing_requested_at || null,
    lockedMonths  // ["2026-02", "2026-01", ...] — 수정 불가 월 목록
  })
})

// 마감 요청
settings.post('/closing-request', async (c) => {
  const user = c.get('user')
  const { year, month, memo } = await c.req.json()

  // monthly_closings upsert
  await c.env.DB.prepare(`
    INSERT INTO monthly_closings (hospital_id, year, month, status, requested_at, requested_by, memo)
    VALUES (?,?,?,'requested',CURRENT_TIMESTAMP,?,?)
    ON CONFLICT(hospital_id,year,month) DO UPDATE SET
      status='requested', requested_at=CURRENT_TIMESTAMP, memo=excluded.memo
  `).bind(user.hospitalId, year, month, user.userId, memo||'').run()

  // hospital_info 상태 업데이트
  await c.env.DB.prepare(`
    UPDATE hospital_info SET closing_status='requested', closing_requested_at=CURRENT_TIMESTAMP
    WHERE hospital_id=?
  `).bind(user.hospitalId).run()

  // 관리자에게 알림 생성
  const hospital = await c.env.DB.prepare(`SELECT name FROM hospitals WHERE id=?`)
    .bind(user.hospitalId).first<any>()
  await c.env.DB.prepare(`
    INSERT INTO notifications (from_hospital_id, type, title, message)
    VALUES (?, 'closing_request', '마감 요청', ?)
  `).bind(user.hospitalId, `${hospital?.name}에서 ${year}년 ${month}월 마감을 요청했습니다.`).run()

  return c.json({ success: true })
})

// 공휴일 조회 (해당 년월)
settings.get('/holidays/:year/:month', async (c) => {
  const { year, month } = c.req.param()
  const mm = month.padStart(2, '0')
  const holidays = await c.env.DB.prepare(`
    SELECT holiday_date, name FROM holidays
    WHERE holiday_date LIKE ? ORDER BY holiday_date
  `).bind(`${year}-${mm}-%`).all<any>()
  return c.json(holidays.results)
})

// ── 세션 heartbeat (활성 상태 + 현재 페이지 업데이트) ──────────
settings.post('/session/heartbeat', async (c) => {
  try {
    const user = c.get('user')
    if (!user || user.role !== 'hospital') return c.json({ ok: true })
    let body: any = {}
    try { body = await c.req.json() } catch {}
    const page = body?.page || 'dashboard'
    const hospitalId = Number(user.hospitalId)
    const userId = Number(user.userId)
    const username = String(user.username || '')
    
    // 최근 세션 업데이트 (10분 내 세션이 있으면 갱신, 없으면 신규)
    const recent = await c.env.DB.prepare(
      `SELECT id FROM hospital_sessions WHERE hospital_id=? AND user_id=? AND last_active_at >= datetime('now', '-10 minutes') ORDER BY last_active_at DESC LIMIT 1`
    ).bind(hospitalId, userId).first<any>()
    
    if (recent?.id) {
      await c.env.DB.prepare(
        `UPDATE hospital_sessions SET last_active_at=datetime('now'), last_page=?, is_active=1 WHERE id=?`
      ).bind(page, Number(recent.id)).run()
    } else {
      await c.env.DB.prepare(
        `INSERT INTO hospital_sessions (hospital_id, user_id, username, last_active_at, last_page, is_active) VALUES (?, ?, ?, datetime('now'), ?, 1)`
      ).bind(hospitalId, userId, username, page).run()
    }
    return c.json({ ok: true })
  } catch (e: any) {
    console.error('Heartbeat error:', e?.message)
    return c.json({ ok: false, error: String(e?.message) })
  }
})

// ── 입력 액션 기록 (실시간 활동 추적) ──────────────────────────
settings.post('/session/activity', async (c) => {
  try {
    const user = c.get('user')
    if (!user || user.role !== 'hospital') return c.json({ ok: true })
    let body: any = {}
    try { body = await c.req.json() } catch {}
    const page = body?.page || ''
    const action = body?.action || ''  // 예: '발주 입력', '식수 저장' 등
    const hospitalId = Number(user.hospitalId)
    const userId = Number(user.userId)
    const username = String(user.username || '')

    // 세션 갱신 + 마지막 액션 업데이트
    const recent = await c.env.DB.prepare(
      `SELECT id FROM hospital_sessions WHERE hospital_id=? AND user_id=? AND last_active_at >= datetime('now', '-10 minutes') ORDER BY last_active_at DESC LIMIT 1`
    ).bind(hospitalId, userId).first<any>()

    const lastAction = action ? `${page} - ${action}` : page

    if (recent?.id) {
      await c.env.DB.prepare(
        `UPDATE hospital_sessions SET last_active_at=datetime('now'), last_page=?, last_action=?, is_active=1 WHERE id=?`
      ).bind(page, lastAction, Number(recent.id)).run()
    } else {
      await c.env.DB.prepare(
        `INSERT INTO hospital_sessions (hospital_id, user_id, username, last_active_at, last_page, last_action, is_active) VALUES (?, ?, ?, datetime('now'), ?, ?, 1)`
      ).bind(hospitalId, userId, username, page, lastAction).run()
    }
    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ ok: false })
  }
})

// ── 잔반 기록 조회 ─────────────────────────────────────────────
settings.get('/food-waste/:year/:month', async (c) => {
  const user = c.get('user')
  const { year, month } = c.req.param()
  const hospitalId = Number(user.role === 'admin' ? (c.req.query('hospitalId') || user.hospitalId) : user.hospitalId)
  const records = await c.env.DB.prepare(`
    SELECT * FROM food_waste_records WHERE hospital_id=? AND year=? AND month=?
    ORDER BY week
  `).bind(hospitalId, year, month).all<any>()
  return c.json(records.results || [])
})

// ── 잔반 기록 저장 ─────────────────────────────────────────────
settings.post('/food-waste', async (c) => {
  const user = c.get('user')
  const { year, month, week, waste_amount, waste_cost, memo } = await c.req.json()
  const hospitalId = Number(user.hospitalId)
  await c.env.DB.prepare(`
    INSERT INTO food_waste_records (hospital_id, year, month, week, waste_amount, waste_cost, memo, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(hospital_id, year, month, week) DO UPDATE SET
      waste_amount=excluded.waste_amount, waste_cost=excluded.waste_cost,
      memo=excluded.memo, updated_at=CURRENT_TIMESTAMP
  `).bind(hospitalId, year, month, week, waste_amount||0, waste_cost||0, memo||'').run()
  return c.json({ success: true })
})

// ── 2.8 잔반 단가 설정 조회 (병원별) ──────────────────────────────
settings.get('/waste-unit-price/:year/:month', async (c) => {
  const user = c.get('user')
  const { year, month } = c.req.param()
  const hospitalId = Number(user.role === 'admin' ? (c.req.query('hospitalId') || user.hospitalId) : user.hospitalId)
  // monthly_settings 의 waste_unit_price 조회 (없으면 최근 설정에서 상속)
  const row = await c.env.DB.prepare(
    `SELECT waste_unit_price FROM monthly_settings WHERE hospital_id=? AND year=? AND month=?`
  ).bind(hospitalId, year, month).first<any>()
  if (row) return c.json({ waste_unit_price: row.waste_unit_price || 0 })
  // 최근 설정 상속
  const fallback = await c.env.DB.prepare(
    `SELECT waste_unit_price FROM monthly_settings WHERE hospital_id=? 
     AND (year < ? OR (year=? AND month < ?))
     ORDER BY year DESC, month DESC LIMIT 1`
  ).bind(hospitalId, year, year, month).first<any>()
  return c.json({ waste_unit_price: fallback?.waste_unit_price || 0 })
})

// ── 2.8 잔반 단가 설정 저장 (병원별, monthly_settings에 upsert) ──
settings.post('/waste-unit-price', async (c) => {
  const user = c.get('user')
  const { year, month, waste_unit_price, hospitalId: bodyHospId } = await c.req.json()
  const hospitalId = Number(user.role === 'admin' ? (bodyHospId || user.hospitalId) : user.hospitalId)
  await c.env.DB.prepare(`
    INSERT INTO monthly_settings (hospital_id, year, month, waste_unit_price)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(hospital_id, year, month) DO UPDATE SET
      waste_unit_price=excluded.waste_unit_price,
      updated_at=CURRENT_TIMESTAMP
  `).bind(hospitalId, year, month, waste_unit_price || 0).run()
  return c.json({ success: true })
})

// ── 2.8 잔반 비용 월별 집계 (kg × unit_price 자동 계산) ───────────
settings.get('/food-waste-summary/:year/:month', async (c) => {
  const user = c.get('user')
  const { year, month } = c.req.param()
  const hospitalId = Number(user.role === 'admin' ? (c.req.query('hospitalId') || user.hospitalId) : user.hospitalId)

  const records = await c.env.DB.prepare(`
    SELECT * FROM food_waste_records WHERE hospital_id=? AND year=? AND month=? ORDER BY week
  `).bind(hospitalId, year, month).all<any>()

  const priceRow = await c.env.DB.prepare(
    `SELECT waste_unit_price FROM monthly_settings WHERE hospital_id=? AND year=? AND month=?`
  ).bind(hospitalId, year, month).first<any>()

  const unitPrice = priceRow?.waste_unit_price || 0
  const rows = records.results || []

  let totalKg = 0, totalCost = 0
  const weeks = rows.map((r: any) => {
    const kg = r.waste_amount || 0
    // waste_cost가 수동 입력된 경우 우선, 없으면 kg × unit_price
    const cost = r.waste_cost > 0 ? r.waste_cost : (unitPrice > 0 ? Math.round(kg * unitPrice) : 0)
    totalKg += kg
    totalCost += cost
    return { week: r.week, kg, cost, memo: r.memo || '' }
  })

  return c.json({ unitPrice, totalKg, totalCost, weeks })
})

// ── 2.7 식재료 단가 조회 ──────────────────────────────────────────
settings.get('/ingredient-prices/:year/:month', async (c) => {
  const user = c.get('user')
  const { year, month } = c.req.param()
  const hospitalId = Number(user.role === 'admin' ? (c.req.query('hospitalId') || user.hospitalId) : user.hospitalId)

  const rows = await c.env.DB.prepare(`
    SELECT * FROM ingredient_prices WHERE hospital_id=? AND year=? AND month=? ORDER BY ingredient_name
  `).bind(hospitalId, year, month).all<any>()

  // 전월 데이터 (비교용)
  const prevMonth = parseInt(month) === 1 ? 12 : parseInt(month) - 1
  const prevYear = parseInt(month) === 1 ? parseInt(year) - 1 : parseInt(year)
  const prevRows = await c.env.DB.prepare(`
    SELECT ingredient_name, unit_price FROM ingredient_prices WHERE hospital_id=? AND year=? AND month=? ORDER BY ingredient_name
  `).bind(hospitalId, prevYear, prevMonth).all<any>()

  // 전년 동월 (비교용)
  const prevYearRows = await c.env.DB.prepare(`
    SELECT ingredient_name, unit_price FROM ingredient_prices WHERE hospital_id=? AND year=? AND month=? ORDER BY ingredient_name
  `).bind(hospitalId, parseInt(year) - 1, month).all<any>()

  const prevMap: Record<string, number> = {}
  const prevYearMap: Record<string, number> = {}
  for (const r of (prevRows.results || [])) prevMap[r.ingredient_name] = r.unit_price
  for (const r of (prevYearRows.results || [])) prevYearMap[r.ingredient_name] = r.unit_price

  const data = (rows.results || []).map((r: any) => ({
    ...r,
    prev_price: prevMap[r.ingredient_name] || 0,
    prev_year_price: prevYearMap[r.ingredient_name] || 0,
    mom_diff: prevMap[r.ingredient_name] ? r.unit_price - prevMap[r.ingredient_name] : null,
    yoy_diff: prevYearMap[r.ingredient_name] ? r.unit_price - prevYearMap[r.ingredient_name] : null,
  }))

  return c.json(data)
})

// ── 2.7 식재료 단가 저장 (수동 입력) ──────────────────────────────
settings.post('/ingredient-prices', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  // body: { year, month, items: [{ingredient_name, unit, unit_price, memo}], hospitalId }
  const { year, month, items, hospitalId: bodyHospId } = body
  const hospitalId = Number(user.role === 'admin' ? (bodyHospId || user.hospitalId) : user.hospitalId)

  if (!Array.isArray(items) || items.length === 0) return c.json({ success: false, error: 'no items' })

  for (const item of items) {
    await c.env.DB.prepare(`
      INSERT INTO ingredient_prices (hospital_id, year, month, ingredient_name, unit, unit_price, memo, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(hospital_id, year, month, ingredient_name) DO UPDATE SET
        unit=excluded.unit, unit_price=excluded.unit_price, memo=excluded.memo,
        updated_at=CURRENT_TIMESTAMP
    `).bind(hospitalId, year, month,
      item.ingredient_name, item.unit || 'kg', item.unit_price || 0, item.memo || ''
    ).run()
  }
  return c.json({ success: true, saved: items.length })
})

// ── 2.7 식재료 단가 연간 추이 조회 (그래프용) ────────────────────
settings.get('/ingredient-prices-annual/:year', async (c) => {
  const user = c.get('user')
  const { year } = c.req.param()
  const hospitalId = Number(user.role === 'admin' ? (c.req.query('hospitalId') || user.hospitalId) : user.hospitalId)

  const rows = await c.env.DB.prepare(`
    SELECT ingredient_name, month, unit_price FROM ingredient_prices
    WHERE hospital_id=? AND year=? ORDER BY ingredient_name, month
  `).bind(hospitalId, year).all<any>()

  // ingredient_name별로 월별 데이터 묶기
  const grouped: Record<string, number[]> = {}
  for (const r of (rows.results || [])) {
    if (!grouped[r.ingredient_name]) grouped[r.ingredient_name] = Array(12).fill(0)
    grouped[r.ingredient_name][r.month - 1] = r.unit_price
  }

  return c.json(grouped)
})

export default settings
