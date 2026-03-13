import { Hono } from 'hono'

const settings = new Hono<{ Bindings: { DB: D1Database } }>()

// 월별 설정 조회
settings.get('/:year/:month', async (c) => {
  const user = c.get('user')
  const { year, month } = c.req.param()
  // 관리자는 hospitalId 쿼리 파라미터 허용
  const hospitalId = Number(user.role === 'admin' ? (c.req.query('hospitalId') || user.hospitalId) : user.hospitalId)
  const data = await c.env.DB.prepare(
    `SELECT * FROM monthly_settings WHERE hospital_id = ? AND year = ? AND month = ?`
  ).bind(hospitalId, year, month).first<any>()
  return c.json({ settings: data || {} })
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
  return c.json({
    year: info?.current_year || now.getFullYear(),
    month: info?.current_month || now.getMonth() + 1,
    closingStatus: info?.closing_status || 'open',
    closingRequestedAt: info?.closing_requested_at || null
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

export default settings
