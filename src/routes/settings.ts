import { Hono } from 'hono'

const settings = new Hono<{ Bindings: { DB: D1Database } }>()

// 월별 설정 조회
settings.get('/:year/:month', async (c) => {
  const user = c.get('user')
  const { year, month } = c.req.param()
  // 관리자는 hospitalId 쿼리 파라미터 허용
  const hospitalId = user.role === 'admin' ? (c.req.query('hospitalId') || user.hospitalId) : user.hospitalId
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

export default settings
