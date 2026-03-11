import { Hono } from 'hono'
import { hashPassword } from '../utils/auth'

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
    workingDays, supplyBudget, cardBudget, vendorBudgets, categoryBudgets
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

  // 업체별 목표금액 저장 (vendors 테이블의 monthly_budget 업데이트)
  if (vendorBudgets && Array.isArray(vendorBudgets)) {
    for (const vb of vendorBudgets) {
      await c.env.DB.prepare(`
        UPDATE vendors SET monthly_budget=? WHERE id=? AND hospital_id=?
      `).bind(vb.budget||0, vb.vendorId, id).run()
    }
  }

  // category_budgets upsert (하위 호환성 유지)
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
  // 관리자 배지는 병원이 보낸 마감 요청(closing_request)만 카운트
  // closing_approved는 병원에게 보내는 알림이므로 관리자 배지에서 제외
  const unread = await c.env.DB.prepare(`
    SELECT COUNT(*) as cnt FROM notifications WHERE is_read=0 AND type='closing_request'
  `).first<any>()
  return c.json({ notifications: notifs.results, unreadCount: unread?.cnt || 0 })
})

// ── 알림 읽음 처리 ─────────────────────────────────────────────
adminRouter.post('/notifications/read-all', async (c) => {
  await c.env.DB.prepare(`UPDATE notifications SET is_read=1`).run()
  return c.json({ success: true })
})

// ── 온라인 중인 병원 목록 ─────────────────────────────────────
adminRouter.get('/online-hospitals', async (c) => {
  try {
    const sessions = await c.env.DB.prepare(`
      SELECT hs.hospital_id, hs.username, hs.last_page, hs.last_active_at,
             h.name as hospital_name
      FROM hospital_sessions hs
      JOIN hospitals h ON hs.hospital_id = h.id
      WHERE hs.last_active_at >= datetime('now', '-5 minutes')
      GROUP BY hs.hospital_id
      ORDER BY hs.last_active_at DESC
    `).all<any>()
    return c.json(sessions.results || [])
  } catch (e: any) {
    console.error('online-hospitals error:', e?.message)
    return c.json([])
  }
})

// ── 전체 현황 상세 (식단가, 이슈 포함) ───────────────────────
adminRouter.get('/dashboard/:year/:month', async (c) => {
  const { year, month } = c.req.param()
  const today = new Date().toISOString().split('T')[0]
  const nowDate = new Date()
  const dayOfWeek = nowDate.getDay()
  const weekStartDate = new Date(nowDate)
  weekStartDate.setDate(nowDate.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
  const weekEndDate = new Date(weekStartDate)
  weekEndDate.setDate(weekStartDate.getDate() + 6)
  const weekStartStr = weekStartDate.toISOString().split('T')[0]
  const weekEndStr = weekEndDate.toISOString().split('T')[0]

  const hospitals = await c.env.DB.prepare(`
    SELECT h.*, hi.closing_status, hi.current_year, hi.current_month,
           hi.licensed_beds, hi.hospital_type, hi.target_meal_price,
           hi.meals_per_day, hi.supply_method
    FROM hospitals h
    LEFT JOIN hospital_info hi ON h.id = hi.hospital_id
    ORDER BY h.id
  `).all<any>()

  // 온라인 세션 (5분 기준)
  const onlineSessions = await c.env.DB.prepare(`
    SELECT hospital_id, username, last_page, last_active_at
    FROM hospital_sessions
    WHERE last_active_at >= datetime('now', '-5 minutes')
    GROUP BY hospital_id
  `).all<any>()
  const onlineMap: Record<number, any> = {}
  for (const s of (onlineSessions.results || [])) {
    onlineMap[s.hospital_id] = s
  }

  const results = await Promise.all(
    (hospitals.results || []).map(async (h: any) => {
      const settings = await c.env.DB.prepare(
        `SELECT * FROM monthly_settings WHERE hospital_id=? AND year=? AND month=?`
      ).bind(h.id, year, month).first<any>()

      // 업체별 사용액 (이슈 분석용)
      const vendors = await c.env.DB.prepare(`
        SELECT v.id, v.name, v.category, v.monthly_budget,
               COALESCE(SUM(d.total_amount),0) as used
        FROM vendors v
        LEFT JOIN daily_orders d ON v.id=d.vendor_id
          AND strftime('%Y',d.order_date)=? AND strftime('%m',d.order_date)=printf('%02d',?)
        WHERE v.hospital_id=? AND v.is_active=1
        GROUP BY v.id
      `).bind(year, month, h.id).all<any>()

      // 식수 통계
      const mealStats = await c.env.DB.prepare(`
        SELECT
          COALESCE(SUM(breakfast_patient+lunch_patient+dinner_patient),0) as total_patient,
          COALESCE(SUM(breakfast_staff+lunch_staff+dinner_staff),0) as total_staff,
          COALESCE(SUM(breakfast_noncovered+lunch_noncovered+dinner_noncovered),0) as total_noncovered,
          COALESCE(SUM(breakfast_guardian+lunch_guardian+dinner_guardian),0) as total_guardian
        FROM daily_meals
        WHERE hospital_id=? AND strftime('%Y',meal_date)=? AND strftime('%m',meal_date)=printf('%02d',?)
      `).bind(h.id, year, month).first<any>()

      // 오늘 식수 상세 (조식/중식/석식 × 환자/직원/비급여/보호자)
      const todayMeals = await c.env.DB.prepare(`
        SELECT
          COALESCE(SUM(breakfast_patient),0) as bp,
          COALESCE(SUM(lunch_patient),0) as lp,
          COALESCE(SUM(dinner_patient),0) as dp,
          COALESCE(SUM(breakfast_staff),0) as bs,
          COALESCE(SUM(lunch_staff),0) as ls,
          COALESCE(SUM(dinner_staff),0) as ds,
          COALESCE(SUM(breakfast_noncovered),0) as bn,
          COALESCE(SUM(lunch_noncovered),0) as ln,
          COALESCE(SUM(dinner_noncovered),0) as dn,
          COALESCE(SUM(breakfast_guardian),0) as bg,
          COALESCE(SUM(lunch_guardian),0) as lg,
          COALESCE(SUM(dinner_guardian),0) as dg
        FROM daily_meals
        WHERE hospital_id=? AND meal_date=?
      `).bind(h.id, today).first<any>()

      // 오늘/이번주 발주
      const todayUsed = await c.env.DB.prepare(
        `SELECT COALESCE(SUM(total_amount),0) as t FROM daily_orders WHERE hospital_id=? AND order_date=?`
      ).bind(h.id, today).first<any>()
      const weekUsed = await c.env.DB.prepare(
        `SELECT COALESCE(SUM(total_amount),0) as t FROM daily_orders WHERE hospital_id=? AND order_date>=? AND order_date<=?`
      ).bind(h.id, weekStartStr, weekEndStr).first<any>()

      // 일별 발주 (최근 7일 이슈 분석용)
      const dailyOrders = await c.env.DB.prepare(`
        SELECT order_date, COALESCE(SUM(total_amount),0) as daily_total
        FROM daily_orders
        WHERE hospital_id=? AND strftime('%Y',order_date)=? AND strftime('%m',order_date)=printf('%02d',?)
        GROUP BY order_date ORDER BY order_date
      `).bind(h.id, year, month).all<any>()

      // 잔반 기록
      const foodWaste = await c.env.DB.prepare(`
        SELECT SUM(waste_amount) as total_waste, SUM(waste_cost) as total_cost
        FROM food_waste_records WHERE hospital_id=? AND year=? AND month=?
      `).bind(h.id, year, month).first<any>()

      const totalBudget = settings?.total_budget || 0
      const workingDays = settings?.working_days || 30
      const dailyBudget = workingDays > 0 ? Math.round(totalBudget / workingDays) : 0
      const weekBudget = dailyBudget * 5

      const totalUsed = (vendors.results || []).reduce((s: number, v: any) => s + v.used, 0)
      const progress = totalBudget > 0 ? ((totalUsed / totalBudget) * 100) : 0

      // 식단가 계산 (3종)
      const ms = mealStats || { total_patient:0, total_staff:0, total_noncovered:0, total_guardian:0 }
      const totalMeals = ms.total_patient + ms.total_staff + ms.total_noncovered + ms.total_guardian
      // supply/card 카테고리 제외 금액
      const supplyCardUsed = (vendors.results || [])
        .filter((v: any) => v.category === 'supply' || v.category === 'card')
        .reduce((s: number, v: any) => s + v.used, 0)
      const staffUsed = Math.round(totalUsed * (totalMeals > 0 ? ms.total_staff / totalMeals : 0))

      const mealPriceTotal = totalMeals > 0 ? Math.round(totalUsed / totalMeals) : 0
      const mealPriceNoStaff = (totalMeals - ms.total_staff) > 0
        ? Math.round((totalUsed - staffUsed) / (totalMeals - ms.total_staff)) : 0
      const mealPriceNoSupply = totalMeals > 0
        ? Math.round((totalUsed - supplyCardUsed) / totalMeals) : 0

      const targetMealPrice = h.target_meal_price || settings?.meal_price || 0

      // 전월 식단가 계산
      const prevMonthNum = parseInt(month) === 1 ? 12 : parseInt(month) - 1
      const prevYearStr  = parseInt(month) === 1 ? String(parseInt(year) - 1) : year
      const prevMealStats = await c.env.DB.prepare(`
        SELECT COALESCE(SUM(breakfast_patient+lunch_patient+dinner_patient),0) as total_patient,
               COALESCE(SUM(breakfast_staff+lunch_staff+dinner_staff),0) as total_staff,
               COALESCE(SUM(breakfast_noncovered+lunch_noncovered+dinner_noncovered),0) as total_noncovered,
               COALESCE(SUM(breakfast_guardian+lunch_guardian+dinner_guardian),0) as total_guardian
        FROM daily_meals WHERE hospital_id=? AND strftime('%Y',meal_date)=? AND strftime('%m',meal_date)=printf('%02d',?)
      `).bind(h.id, prevYearStr, prevMonthNum).first<any>()
      const prevOrders = await c.env.DB.prepare(`
        SELECT COALESCE(SUM(total_amount),0) as total_used FROM daily_orders
        WHERE hospital_id=? AND strftime('%Y',order_date)=? AND strftime('%m',order_date)=printf('%02d',?)
      `).bind(h.id, prevYearStr, prevMonthNum).first<any>()
      const prevSupply = await c.env.DB.prepare(`
        SELECT COALESCE(SUM(d.total_amount),0) as supply_used
        FROM daily_orders d JOIN vendors v ON d.vendor_id=v.id
        WHERE d.hospital_id=? AND strftime('%Y',d.order_date)=? AND strftime('%m',d.order_date)=printf('%02d',?)
          AND (v.category='supply' OR v.category='card')
      `).bind(h.id, prevYearStr, prevMonthNum).first<any>()
      const pms = prevMealStats || { total_patient:0, total_staff:0, total_noncovered:0, total_guardian:0 }
      const prevTotalMeals = (pms.total_patient||0)+(pms.total_staff||0)+(pms.total_noncovered||0)+(pms.total_guardian||0)
      const prevTotalUsed  = prevOrders?.total_used || 0
      const prevSupplyUsed = prevSupply?.supply_used || 0
      const prevStaffRatio = prevTotalMeals > 0 ? (pms.total_staff||0) / prevTotalMeals : 0
      const prevStaffCost  = Math.round(prevTotalUsed * prevStaffRatio)
      const prevMealPriceTotal   = prevTotalMeals > 0 ? Math.round(prevTotalUsed / prevTotalMeals) : 0
      const prevMealPriceNoStaff = (prevTotalMeals-(pms.total_staff||0)) > 0
        ? Math.round((prevTotalUsed-prevStaffCost)/(prevTotalMeals-(pms.total_staff||0))) : 0
      const prevMealPriceNoSupply= prevTotalMeals > 0
        ? Math.round((prevTotalUsed-prevSupplyUsed)/prevTotalMeals) : 0

      // 이슈 목록 생성
      const issues: any[] = []
      // 1. 예산 초과 업체
      for (const v of (vendors.results || [])) {
        if (v.monthly_budget > 0 && v.used > v.monthly_budget) {
          const pct = ((v.used - v.monthly_budget) / v.monthly_budget * 100).toFixed(1)
          issues.push({ type: 'vendor_over', level: 'danger',
            msg: `[업체초과] ${v.name} ${pct}% 초과` })
        } else if (v.monthly_budget > 0 && v.used > v.monthly_budget * 0.9) {
          const pct = (v.used / v.monthly_budget * 100).toFixed(1)
          issues.push({ type: 'vendor_warn', level: 'warning',
            msg: `[업체경고] ${v.name} 목표의 ${pct}% 사용` })
        }
      }
      // 2. 월 예산 초과
      if (totalBudget > 0 && totalUsed > totalBudget) {
        const pct = ((totalUsed - totalBudget) / totalBudget * 100).toFixed(1)
        issues.push({ type: 'budget_over', level: 'danger', msg: `[예산초과] 월 예산 ${pct}% 초과` })
      } else if (totalBudget > 0 && totalUsed > totalBudget * 0.9) {
        issues.push({ type: 'budget_warn', level: 'warning',
          msg: `[예산경고] 월 예산 ${(totalUsed/totalBudget*100).toFixed(1)}% 사용` })
      }
      // 3. 하루 발주 초과 (100% 초과 = warning, 110% 초과 = danger)
      for (const d of (dailyOrders.results || [])) {
        if (dailyBudget > 0 && d.daily_total > dailyBudget) {
          const pct = ((d.daily_total - dailyBudget) / dailyBudget * 100).toFixed(1)
          const level = d.daily_total > dailyBudget * 1.1 ? 'danger' : 'warning'
          issues.push({ type: 'daily_over', level,
            msg: `[일발주초과] ${d.order_date} 일예산 ${pct}% 초과 (${(d.daily_total/10000).toFixed(0)}만원)` })
        }
      }
      // 4. 식단가 초과
      if (targetMealPrice > 0 && mealPriceTotal > targetMealPrice) {
        const pct = ((mealPriceTotal - targetMealPrice) / targetMealPrice * 100).toFixed(1)
        issues.push({ type: 'meal_price_over', level: 'danger',
          msg: `[식단가초과] 실제 ${mealPriceTotal.toLocaleString()}원 (목표대비 ${pct}% 초과)` })
      }

      return {
        hospital: h,
        totalBudget,
        totalUsed,
        progress: progress.toFixed(1),
        remaining: totalBudget - totalUsed,
        mealPriceTotal,
        mealPriceNoStaff,
        mealPriceNoSupply,
        targetMealPrice,
        totalMeals,
        mealStats: ms,
        todayUsed: todayUsed?.t || 0,
        weekUsed: weekUsed?.t || 0,
        dailyBudget,
        weekBudget,
        vendors: vendors.results || [],
        dailyOrders: dailyOrders.results || [],
        foodWaste: { totalWaste: foodWaste?.total_waste||0, totalCost: foodWaste?.total_cost||0 },
        todayMeals: todayMeals || { bp:0, lp:0, dp:0, bs:0, ls:0, ds:0, bn:0, ln:0, dn:0, bg:0, lg:0, dg:0 },
        issues,
        online: onlineMap[h.id] || null,
        closingStatus: h.closing_status || 'open',
        activeYear: h.current_year || parseInt(year),
        activeMonth: h.current_month || parseInt(month),
        prevMonth: {
          month: prevMonthNum, year: parseInt(prevYearStr),
          mealPriceTotal: prevMealPriceTotal,
          mealPriceNoStaff: prevMealPriceNoStaff,
          mealPriceNoSupply: prevMealPriceNoSupply,
          totalMeals: prevTotalMeals,
          totalUsed: prevTotalUsed
        }
      }
    })
  )

  return c.json({ hospitals: results, year, month, today })
})

// ── 병원별 업체 목록 (관리자용) ───────────────────────────────
adminRouter.get('/hospitals/:id/vendors', async (c) => {
  const id = c.req.param('id')
  const vendors = await c.env.DB.prepare(`
    SELECT id, name, category, tax_type, monthly_budget, sort_order
    FROM vendors
    WHERE hospital_id=? AND is_active=1
    ORDER BY sort_order, id
  `).bind(id).all<any>()
  return c.json(vendors.results || [])
})

// ── 병원별 업체 추가 (관리자용) ───────────────────────────────
adminRouter.post('/hospitals/:id/vendors', async (c) => {
  const hospitalId = c.req.param('id')
  const { name, category, taxType, monthlyBudget, sortOrder } = await c.req.json()
  if (!name?.trim()) return c.json({ error: '업체명을 입력하세요' }, 400)
  await c.env.DB.prepare(`
    INSERT INTO vendors (hospital_id, name, category, tax_type, monthly_budget, sort_order, is_active)
    VALUES (?,?,?,?,?,?,1)
  `).bind(
    hospitalId, name.trim(), category||'general',
    taxType||'mixed', monthlyBudget||0, sortOrder||99
  ).run()
  return c.json({ success: true })
})

// ── 병원별 업체 수정 (관리자용) ───────────────────────────────
adminRouter.put('/hospitals/:id/vendors/:vid', async (c) => {
  const { id: hospitalId, vid } = c.req.param()
  const { name, category, taxType, monthlyBudget, sortOrder } = await c.req.json()
  await c.env.DB.prepare(`
    UPDATE vendors SET name=?, category=?, tax_type=?, monthly_budget=?, sort_order=?
    WHERE id=? AND hospital_id=?
  `).bind(
    name, category||'general', taxType||'mixed',
    monthlyBudget||0, sortOrder||99, vid, hospitalId
  ).run()
  return c.json({ success: true })
})

// ── 병원별 업체 삭제 (관리자용) ───────────────────────────────
adminRouter.delete('/hospitals/:id/vendors/:vid', async (c) => {
  const { id: hospitalId, vid } = c.req.param()
  await c.env.DB.prepare(`
    UPDATE vendors SET is_active=0 WHERE id=? AND hospital_id=?
  `).bind(vid, hospitalId).run()
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

// ── 병원 계정 목록 조회 ────────────────────────────────────────
adminRouter.get('/hospitals/:id/accounts', async (c) => {
  const id = c.req.param('id')
  const accounts = await c.env.DB.prepare(`
    SELECT id, username, role, created_at FROM users
    WHERE hospital_id = ? ORDER BY id
  `).bind(id).all<any>()
  return c.json(accounts.results || [])
})

// ── 병원 계정 생성 ─────────────────────────────────────────────
adminRouter.post('/hospitals/:id/accounts', async (c) => {
  const hospitalId = c.req.param('id')
  const { username, password } = await c.req.json()
  if (!username?.trim() || !password?.trim())
    return c.json({ error: '아이디와 비밀번호를 입력하세요' }, 400)

  // 중복 아이디 체크
  const exists = await c.env.DB.prepare(
    `SELECT id FROM users WHERE username = ?`
  ).bind(username.trim()).first<any>()
  if (exists) return c.json({ error: '이미 사용 중인 아이디입니다' }, 409)

  const hash = await hashPassword(password)
  await c.env.DB.prepare(`
    INSERT INTO users (hospital_id, username, password_hash, role)
    VALUES (?, ?, ?, 'hospital')
  `).bind(hospitalId, username.trim(), hash).run()
  return c.json({ success: true })
})

// ── 병원 계정 비밀번호 변경 ────────────────────────────────────
adminRouter.put('/hospitals/:id/accounts/:uid', async (c) => {
  const { id: hospitalId, uid } = c.req.param()
  const { password, username } = await c.req.json()

  if (username) {
    // 중복 체크 (자기 자신 제외)
    const exists = await c.env.DB.prepare(
      `SELECT id FROM users WHERE username = ? AND id != ?`
    ).bind(username.trim(), uid).first<any>()
    if (exists) return c.json({ error: '이미 사용 중인 아이디입니다' }, 409)
    await c.env.DB.prepare(
      `UPDATE users SET username = ? WHERE id = ? AND hospital_id = ?`
    ).bind(username.trim(), uid, hospitalId).run()
  }

  if (password?.trim()) {
    const hash = await hashPassword(password)
    await c.env.DB.prepare(
      `UPDATE users SET password_hash = ? WHERE id = ? AND hospital_id = ?`
    ).bind(hash, uid, hospitalId).run()
  }
  return c.json({ success: true })
})

// ── 병원 계정 삭제 ─────────────────────────────────────────────
adminRouter.delete('/hospitals/:id/accounts/:uid', async (c) => {
  const { id: hospitalId, uid } = c.req.param()
  await c.env.DB.prepare(
    `DELETE FROM users WHERE id = ? AND hospital_id = ? AND role != 'admin'`
  ).bind(uid, hospitalId).run()
  return c.json({ success: true })
})

export default adminRouter
