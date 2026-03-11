import { Hono } from 'hono'

const adminRouter = new Hono<{ Bindings: { DB: D1Database } }>()

// ── 병원 목록 (기본정보 포함) ──────────────────────────────────
adminRouter.get('/hospitals', async (c) => {
  const hospitals = await c.env.DB.prepare(`
    SELECT h.*, hi.hospital_type, hi.licensed_beds, hi.avg_inpatients,
           hi.staff_count, hi.main_specialty, hi.operation_type,
           hi.consignment_company, hi.meals_per_day, hi.current_meal_price,
           hi.target_meal_price, hi.supply_method, hi.annual_budget,
           hi.dietitian_name, hi.dietitian_phone, hi.admin_memo,
           hi.current_year, hi.current_month, hi.closing_status,
           hi.closing_requested_at, hi.address
    FROM hospitals h
    LEFT JOIN hospital_info hi ON h.id = hi.hospital_id
    ORDER BY h.id
  `).all<any>()
  return c.json(hospitals.results)
})

// ── 병원 상세정보 조회 ─────────────────────────────────────────
adminRouter.get('/hospitals/:id', async (c) => {
  const id = c.req.param('id')
  const hospital = await c.env.DB.prepare(`
    SELECT h.*, hi.*
    FROM hospitals h
    LEFT JOIN hospital_info hi ON h.id = hi.hospital_id
    WHERE h.id = ?
  `).bind(id).first<any>()
  if (!hospital) return c.json({ error: 'Not found' }, 404)
  return c.json(hospital)
})

// ── 병원 기본정보 저장 ─────────────────────────────────────────
adminRouter.put('/hospitals/:id/info', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const {
    name, address, hospital_type,
    licensed_beds, avg_inpatients, staff_count, main_specialty,
    operation_type, consignment_company, meals_per_day,
    current_meal_price, target_meal_price, supply_method,
    annual_budget, dietitian_name, dietitian_phone, admin_memo
  } = body

  // hospitals 테이블 업데이트
  await c.env.DB.prepare(`UPDATE hospitals SET name=?, address=? WHERE id=?`)
    .bind(name, address, id).run()

  // hospital_info upsert
  await c.env.DB.prepare(`
    INSERT INTO hospital_info (
      hospital_id, hospital_type, address, licensed_beds, avg_inpatients,
      staff_count, main_specialty, operation_type, consignment_company,
      meals_per_day, current_meal_price, target_meal_price, supply_method,
      annual_budget, dietitian_name, dietitian_phone, admin_memo,
      current_year, current_month, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,2026,3,CURRENT_TIMESTAMP)
    ON CONFLICT(hospital_id) DO UPDATE SET
      hospital_type=excluded.hospital_type, address=excluded.address,
      licensed_beds=excluded.licensed_beds, avg_inpatients=excluded.avg_inpatients,
      staff_count=excluded.staff_count, main_specialty=excluded.main_specialty,
      operation_type=excluded.operation_type, consignment_company=excluded.consignment_company,
      meals_per_day=excluded.meals_per_day, current_meal_price=excluded.current_meal_price,
      target_meal_price=excluded.target_meal_price, supply_method=excluded.supply_method,
      annual_budget=excluded.annual_budget, dietitian_name=excluded.dietitian_name,
      dietitian_phone=excluded.dietitian_phone, admin_memo=excluded.admin_memo,
      updated_at=CURRENT_TIMESTAMP
  `).bind(
    id, hospital_type, address, licensed_beds||0, avg_inpatients||0,
    staff_count||0, main_specialty||'', operation_type, consignment_company||'',
    meals_per_day||3, current_meal_price||0, target_meal_price||0, supply_method,
    annual_budget||0, dietitian_name||'', dietitian_phone||'', admin_memo||''
  ).run()

  return c.json({ success: true })
})

// ── 병원별 월 예산 설정 조회 ───────────────────────────────────
adminRouter.get('/hospitals/:id/budget/:year/:month', async (c) => {
  const { id, year, month } = c.req.param()
  const settings = await c.env.DB.prepare(`
    SELECT * FROM monthly_settings WHERE hospital_id=? AND year=? AND month=?
  `).bind(id, year, month).first<any>()

  const catBudgets = await c.env.DB.prepare(`
    SELECT category, monthly_budget FROM category_budgets
    WHERE hospital_id=? AND year=? AND month=?
  `).bind(id, year, month).all<any>()

  const vendors = await c.env.DB.prepare(`
    SELECT id, name, category, monthly_budget FROM vendors
    WHERE hospital_id=? AND is_active=1 ORDER BY sort_order
  `).bind(id).all<any>()

  return c.json({
    settings: settings || {},
    categoryBudgets: catBudgets.results || [],
    vendors: vendors.results || []
  })
})

// ── 병원별 월 예산 설정 저장 ───────────────────────────────────
adminRouter.post('/hospitals/:id/budget/:year/:month', async (c) => {
  const { id, year, month } = c.req.param()
  const body = await c.req.json()
  const {
    totalBudget, eventBudget, mealPrice, foodWasteBudget,
    workingDays, supplyBudget, cardBudget, categoryBudgets
  } = body

  // monthly_settings upsert
  await c.env.DB.prepare(`
    INSERT INTO monthly_settings (
      hospital_id, year, month, total_budget, event_budget,
      meal_price, food_waste_budget, working_days, supply_budget, card_budget,
      created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(hospital_id,year,month) DO UPDATE SET
      total_budget=excluded.total_budget, event_budget=excluded.event_budget,
      meal_price=excluded.meal_price, food_waste_budget=excluded.food_waste_budget,
      working_days=excluded.working_days, supply_budget=excluded.supply_budget,
      card_budget=excluded.card_budget, updated_at=CURRENT_TIMESTAMP
  `).bind(id, year, month, totalBudget||0, eventBudget||0, mealPrice||0,
    foodWasteBudget||0, workingDays||0, supplyBudget||0, cardBudget||0).run()

  // category_budgets upsert
  if (categoryBudgets && Array.isArray(categoryBudgets)) {
    for (const cb of categoryBudgets) {
      await c.env.DB.prepare(`
        INSERT INTO category_budgets (hospital_id, year, month, category, monthly_budget, updated_at)
        VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(hospital_id,year,month,category) DO UPDATE SET
          monthly_budget=excluded.monthly_budget, updated_at=CURRENT_TIMESTAMP
      `).bind(id, year, month, cb.category, cb.budget||0).run()
    }
  }

  return c.json({ success: true })
})

// ── 월 마감 요청 목록 (알림) ──────────────────────────────────
adminRouter.get('/closing-requests', async (c) => {
  const requests = await c.env.DB.prepare(`
    SELECT mc.*, h.name as hospital_name
    FROM monthly_closings mc
    JOIN hospitals h ON mc.hospital_id = h.id
    WHERE mc.status = 'requested'
    ORDER BY mc.requested_at DESC
  `).all<any>()
  return c.json(requests.results)
})

// ── 월 마감 승인 ──────────────────────────────────────────────
adminRouter.post('/closing-approve/:hospitalId', async (c) => {
  const hospitalId = c.req.param('hospitalId')
  const { year, month } = await c.req.json()

  // monthly_closings 업데이트
  await c.env.DB.prepare(`
    UPDATE monthly_closings SET status='approved', approved_at=CURRENT_TIMESTAMP
    WHERE hospital_id=? AND year=? AND month=?
  `).bind(hospitalId, year, month).run()

  // hospital_info 다음 달로 전환
  const nextYear = month == 12 ? year + 1 : year
  const nextMonth = month == 12 ? 1 : parseInt(month) + 1
  await c.env.DB.prepare(`
    UPDATE hospital_info SET
      current_year=?, current_month=?, closing_status='open',
      closing_requested_at=NULL, updated_at=CURRENT_TIMESTAMP
    WHERE hospital_id=?
  `).bind(nextYear, nextMonth, hospitalId).run()

  // 승인 알림 생성
  const hospital = await c.env.DB.prepare(`SELECT name FROM hospitals WHERE id=?`)
    .bind(hospitalId).first<any>()
  await c.env.DB.prepare(`
    INSERT INTO notifications (from_hospital_id, type, title, message)
    VALUES (?, 'closing_approved', '마감 승인 완료', ?)
  `).bind(hospitalId, `${hospital?.name} ${year}년 ${month}월 마감이 승인되어 ${nextMonth}월로 전환되었습니다.`).run()

  return c.json({ success: true, nextYear, nextMonth })
})

// ── 알림 목록 ─────────────────────────────────────────────────
adminRouter.get('/notifications', async (c) => {
  const notifs = await c.env.DB.prepare(`
    SELECT n.*, h.name as hospital_name
    FROM notifications n
    LEFT JOIN hospitals h ON n.from_hospital_id = h.id
    ORDER BY n.created_at DESC
    LIMIT 50
  `).all<any>()
  const unread = await c.env.DB.prepare(`
    SELECT COUNT(*) as cnt FROM notifications WHERE is_read=0
  `).first<any>()
  return c.json({ notifications: notifs.results, unreadCount: unread?.cnt || 0 })
})

// ── 알림 읽음 처리 ─────────────────────────────────────────────
adminRouter.post('/notifications/read-all', async (c) => {
  await c.env.DB.prepare(`UPDATE notifications SET is_read=1`).run()
  return c.json({ success: true })
})

// ── 공휴일 목록 ───────────────────────────────────────────────
adminRouter.get('/holidays/:year', async (c) => {
  const year = c.req.param('year')
  const holidays = await c.env.DB.prepare(`
    SELECT * FROM holidays
    WHERE holiday_date LIKE ? ORDER BY holiday_date
  `).bind(`${year}-%`).all<any>()
  return c.json(holidays.results)
})

// ── 공휴일 추가 ───────────────────────────────────────────────
adminRouter.post('/holidays', async (c) => {
  const { date, name } = await c.req.json()
  await c.env.DB.prepare(`
    INSERT OR REPLACE INTO holidays (holiday_date, name, is_auto) VALUES (?,?,0)
  `).bind(date, name).run()
  return c.json({ success: true })
})

// ── 공휴일 삭제 ───────────────────────────────────────────────
adminRouter.delete('/holidays/:date', async (c) => {
  const date = c.req.param('date')
  await c.env.DB.prepare(`DELETE FROM holidays WHERE holiday_date=?`).bind(date).run()
  return c.json({ success: true })
})

// ── 관리자 전체 현황 (기존 admin/overview 통합) ────────────────
adminRouter.get('/overview/:year/:month', async (c) => {
  const { year, month } = c.req.param()
  const hospitals = await c.env.DB.prepare(`
    SELECT h.*, hi.closing_status, hi.current_year, hi.current_month,
           hi.licensed_beds, hi.hospital_type
    FROM hospitals h
    LEFT JOIN hospital_info hi ON h.id = hi.hospital_id
    ORDER BY h.id
  `).all<any>()

  const results = await Promise.all(
    (hospitals.results || []).map(async (h: any) => {
      const settings = await c.env.DB.prepare(
        `SELECT * FROM monthly_settings WHERE hospital_id=? AND year=? AND month=?`
      ).bind(h.id, year, month).first<any>()

      const totalUsed = await c.env.DB.prepare(`
        SELECT COALESCE(SUM(total_amount),0) as total FROM daily_orders
        WHERE hospital_id=? AND strftime('%Y',order_date)=? AND strftime('%m',order_date)=printf('%02d',?)
      `).bind(h.id, year, month).first<any>()

      const today = new Date().toISOString().split('T')[0]
      const todayUsed = await c.env.DB.prepare(`
        SELECT COALESCE(SUM(total_amount),0) as today_total FROM daily_orders
        WHERE hospital_id=? AND order_date=?
      `).bind(h.id, today).first<any>()

      const closingReq = await c.env.DB.prepare(`
        SELECT status, requested_at FROM monthly_closings
        WHERE hospital_id=? AND year=? AND month=?
      `).bind(h.id, year, month).first<any>()

      const totalBudget = settings?.total_budget || 0
      const used = totalUsed?.total || 0
      const progress = totalBudget > 0 ? ((used/totalBudget)*100).toFixed(1) : '0.0'

      return {
        hospital: h,
        totalBudget, totalUsed: used, progress,
        remaining: totalBudget - used,
        mealPrice: settings?.meal_price || 0,
        todayUsed: todayUsed?.today_total || 0,
        closingStatus: closingReq?.status || 'open',
        activeYear: h.current_year || parseInt(year),
        activeMonth: h.current_month || parseInt(month)
      }
    })
  )
  return c.json({ hospitals: results, year, month })
})

export default adminRouter
