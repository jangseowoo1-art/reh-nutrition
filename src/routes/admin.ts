import { Hono } from 'hono'
import { hashPassword } from '../utils/auth'

const adminRouter = new Hono<{ Bindings: { DB: D1Database } }>()

// ── 병원 목록 (기본정보 포함) ──────────────────────────────────
adminRouter.get('/hospitals', async (c) => {
  const hospitals = await c.env.DB.prepare(`
    SELECT h.*, hi.hospital_type, hi.licensed_beds, hi.avg_inpatients,
           hi.staff_count, hi.main_specialty, hi.operation_type, hi.care_type,
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
    name, address, hospital_type, care_type,
    licensed_beds, avg_inpatients, staff_count, main_specialty,
    operation_type, consignment_company, meals_per_day,
    current_meal_price, target_meal_price, supply_method,
    annual_budget, dietitian_name, dietitian_phone, admin_memo
  } = body

  // hospitals 테이블 업데이트
  await c.env.DB.prepare(`UPDATE hospitals SET name=?, address=? WHERE id=?`)
    .bind(name || '', address || '', id).run()

  // hospital_info upsert (care_type 포함)
  await c.env.DB.prepare(`
    INSERT INTO hospital_info (
      hospital_id, hospital_type, care_type, address, licensed_beds, avg_inpatients,
      staff_count, main_specialty, operation_type, consignment_company,
      meals_per_day, current_meal_price, target_meal_price, supply_method,
      annual_budget, dietitian_name, dietitian_phone, admin_memo,
      current_year, current_month, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,2026,3,CURRENT_TIMESTAMP)
    ON CONFLICT(hospital_id) DO UPDATE SET
      hospital_type=excluded.hospital_type, care_type=excluded.care_type,
      address=excluded.address,
      licensed_beds=excluded.licensed_beds, avg_inpatients=excluded.avg_inpatients,
      staff_count=excluded.staff_count, main_specialty=excluded.main_specialty,
      operation_type=excluded.operation_type, consignment_company=excluded.consignment_company,
      meals_per_day=excluded.meals_per_day, current_meal_price=excluded.current_meal_price,
      target_meal_price=excluded.target_meal_price, supply_method=excluded.supply_method,
      annual_budget=excluded.annual_budget, dietitian_name=excluded.dietitian_name,
      dietitian_phone=excluded.dietitian_phone, admin_memo=excluded.admin_memo,
      updated_at=CURRENT_TIMESTAMP
  `).bind(
    id, hospital_type || 'general', care_type || 'general',
    address || '', licensed_beds || 0, avg_inpatients || 0,
    staff_count || 0, main_specialty || '', operation_type || 'direct',
    consignment_company || '',
    meals_per_day || 3, current_meal_price || 0, target_meal_price || 0,
    supply_method || 'direct',
    annual_budget || 0, dietitian_name || '', dietitian_phone || '', admin_memo || ''
  ).run()

  return c.json({ success: true })
})

// ── 병원별 월 예산 설정 조회 ───────────────────────────────────
adminRouter.get('/hospitals/:id/budget/:year/:month', async (c) => {
  const { id, year, month } = c.req.param()
  const reqYear = parseInt(year), reqMonth = parseInt(month)

  // 프로그램 최초 기준: 2026년 3월
  const BASE_YEAR = 2026, BASE_MONTH = 3

  // 1) 해당 월 설정 조회
  let settings = await c.env.DB.prepare(`
    SELECT * FROM monthly_settings WHERE hospital_id=? AND year=? AND month=?
  `).bind(id, year, month).first<any>()

  let isFallback = false
  let fallbackYearMonth: string | null = null

  if (!settings) {
    const isBeforeBase = (reqYear < BASE_YEAR) || (reqYear === BASE_YEAR && reqMonth < BASE_MONTH)

    if (isBeforeBase) {
      // 2) 기준월(3월) 이전 → 기준월(3월) 설정을 기본값으로 사용
      settings = await c.env.DB.prepare(`
        SELECT * FROM monthly_settings
        WHERE hospital_id=? AND year=? AND month=?
      `).bind(id, BASE_YEAR, BASE_MONTH).first<any>()

      // 기준월도 없으면 가장 오래된 설정 사용
      if (!settings) {
        settings = await c.env.DB.prepare(`
          SELECT * FROM monthly_settings
          WHERE hospital_id=?
          ORDER BY CAST(year AS INTEGER) ASC, CAST(month AS INTEGER) ASC LIMIT 1
        `).bind(id).first<any>()
      }
      if (settings) {
        isFallback = true
        fallbackYearMonth = `${BASE_YEAR}년 ${BASE_MONTH}월 기준값`
      }
    } else {
      // 3) 기준월 이후 → 직전에 설정된 값을 상속 (가장 가까운 이전 월)
      settings = await c.env.DB.prepare(`
        SELECT * FROM monthly_settings
        WHERE hospital_id=?
          AND (CAST(year AS INTEGER) < ? 
               OR (CAST(year AS INTEGER) = ? AND CAST(month AS INTEGER) < ?))
        ORDER BY CAST(year AS INTEGER) DESC, CAST(month AS INTEGER) DESC LIMIT 1
      `).bind(id, reqYear, reqYear, reqMonth).first<any>()
      if (settings) {
        isFallback = true
        fallbackYearMonth = `${settings.year}년 ${settings.month}월`
      }
    }
  }

  // category_budgets: 해당 월 없으면 동일 상속 규칙 적용
  let catBudgets = await c.env.DB.prepare(`
    SELECT category, monthly_budget FROM category_budgets
    WHERE hospital_id=? AND year=? AND month=?
  `).bind(id, year, month).all<any>()

  if (!catBudgets.results?.length) {
    const isBeforeBase = (reqYear < BASE_YEAR) || (reqYear === BASE_YEAR && reqMonth < BASE_MONTH)
    if (isBeforeBase) {
      catBudgets = await c.env.DB.prepare(`
        SELECT category, monthly_budget FROM category_budgets
        WHERE hospital_id=? AND year=? AND month=?
      `).bind(id, BASE_YEAR, BASE_MONTH).all<any>()
    } else {
      catBudgets = await c.env.DB.prepare(`
        SELECT category, monthly_budget FROM category_budgets
        WHERE hospital_id=?
          AND (CAST(year AS INTEGER) < ?
               OR (CAST(year AS INTEGER) = ? AND CAST(month AS INTEGER) < ?))
        ORDER BY CAST(year AS INTEGER) DESC, CAST(month AS INTEGER) DESC LIMIT 1
      `).bind(id, reqYear, reqYear, reqMonth).all<any>()
    }
  }

  const vendors = await c.env.DB.prepare(`
    SELECT id, name, category, monthly_budget FROM vendors
    WHERE hospital_id=? AND is_active=1 ORDER BY sort_order
  `).bind(id).all<any>()

  return c.json({
    settings: settings || {},
    categoryBudgets: catBudgets.results || [],
    vendors: vendors.results || [],
    isFallback,
    fallbackYearMonth
  })
})

// ── 병원별 월 예산 설정 저장 ───────────────────────────────────
adminRouter.post('/hospitals/:id/budget/:year/:month', async (c) => {
  const { id, year, month } = c.req.param()
  const body = await c.req.json()
  const {
    totalBudget, eventBudget, mealPrice, foodWasteBudget,
    workingDays, supplyBudget, cardBudget, vendorBudgets, categoryBudgets,
    waste_unit_price, _partial
  } = body

  if (_partial) {
    // 부분 업데이트: waste_unit_price만 저장
    await c.env.DB.prepare(`
      INSERT INTO monthly_settings (hospital_id, year, month, waste_unit_price, created_at, updated_at)
      VALUES (?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(hospital_id,year,month) DO UPDATE SET
        waste_unit_price=excluded.waste_unit_price, updated_at=CURRENT_TIMESTAMP
    `).bind(id, year, month, waste_unit_price||0).run()
    return c.json({ success: true })
  }

  // monthly_settings upsert
  await c.env.DB.prepare(`
    INSERT INTO monthly_settings (
      hospital_id, year, month, total_budget, event_budget,
      meal_price, food_waste_budget, working_days, supply_budget, card_budget,
      waste_unit_price, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(hospital_id,year,month) DO UPDATE SET
      total_budget=excluded.total_budget, event_budget=excluded.event_budget,
      meal_price=excluded.meal_price, food_waste_budget=excluded.food_waste_budget,
      working_days=excluded.working_days, supply_budget=excluded.supply_budget,
      card_budget=excluded.card_budget, updated_at=CURRENT_TIMESTAMP
  `).bind(id, year, month, totalBudget||0, eventBudget||0, mealPrice||0,
    foodWasteBudget||0, workingDays||0, supplyBudget||0, cardBudget||0, waste_unit_price||0).run()

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

  // ── 예산 이월 (자동) ──────────────────────────────
  try {
    // 현재 달 예산 설정 가져오기
    const currentBudget = await c.env.DB.prepare(`
      SELECT * FROM monthly_settings WHERE hospital_id=? AND year=? AND month=?
    `).bind(hospitalId, year, month).first<any>()

    if (currentBudget) {
      // 다음 달 영업일 계산 (대략 계산: 해당 월 평일 수)
      const daysInNextMonth = new Date(nextYear, nextMonth, 0).getDate()
      let workingDays = 0
      for (let d = 1; d <= daysInNextMonth; d++) {
        const dow = new Date(nextYear, nextMonth - 1, d).getDay()
        if (dow !== 0 && dow !== 6) workingDays++
      }

      // 다음 달 설정 존재 여부 확인
      const existing = await c.env.DB.prepare(`
        SELECT id FROM monthly_settings WHERE hospital_id=? AND year=? AND month=?
      `).bind(hospitalId, nextYear, nextMonth).first<any>()

      if (existing) {
        // 기존 설정 업데이트 (영업일만 갱신, 나머지는 유지)
        await c.env.DB.prepare(`
          UPDATE monthly_settings SET working_days=?, updated_at=CURRENT_TIMESTAMP
          WHERE hospital_id=? AND year=? AND month=?
        `).bind(workingDays, hospitalId, nextYear, nextMonth).run()
      } else {
        // 이월 생성
        await c.env.DB.prepare(`
          INSERT INTO monthly_settings (
            hospital_id, year, month, total_budget, event_budget,
            supply_budget, card_budget, meal_price, food_waste_budget, working_days
          ) VALUES (?,?,?,?,?,?,?,?,?,?)
        `).bind(
          hospitalId, nextYear, nextMonth,
          currentBudget.total_budget || 0,
          currentBudget.event_budget || 0,
          currentBudget.supply_budget || 0,
          currentBudget.card_budget || 0,
          currentBudget.meal_price || 0,
          currentBudget.food_waste_budget || 0,
          workingDays
        ).run()
      }
    }
  } catch (e: any) {
    console.error('budget carryover error:', e?.message)
  }

  // ── 업체 이월 (자동) ──────────────────────────────
  try {
    const vendors = await c.env.DB.prepare(`
      SELECT v.*, vm.monthly_budget
      FROM vendors v
      LEFT JOIN vendor_monthly_budgets vm ON vm.vendor_id=v.id AND vm.year=? AND vm.month=?
      WHERE v.hospital_id=?
    `).bind(year, month, hospitalId).all<any>()

    for (const v of (vendors.results || [])) {
      if (!v.monthly_budget) continue
      const existingVb = await c.env.DB.prepare(`
        SELECT id FROM vendor_monthly_budgets WHERE vendor_id=? AND year=? AND month=?
      `).bind(v.id, nextYear, nextMonth).first<any>()
      if (!existingVb) {
        await c.env.DB.prepare(`
          INSERT INTO vendor_monthly_budgets (vendor_id, hospital_id, year, month, monthly_budget)
          VALUES (?,?,?,?,?)
        `).bind(v.id, hospitalId, nextYear, nextMonth, v.monthly_budget).run()
      }
    }
  } catch (e: any) {
    console.error('vendor carryover error:', e?.message)
  }

  // 승인 알림 생성
  const hospital = await c.env.DB.prepare(`SELECT name FROM hospitals WHERE id=?`)
    .bind(hospitalId).first<any>()
  await c.env.DB.prepare(`
    INSERT INTO notifications (from_hospital_id, type, title, message)
    VALUES (?, 'closing_approved', '마감 승인 완료', ?)
  `).bind(hospitalId, `${hospital?.name} ${year}년 ${month}월 마감이 승인되어 ${nextMonth}월로 전환되었습니다.`).run()

  return c.json({ success: true, nextYear, nextMonth })
})

// ── 마감 승인 롤백 (테스트/실수 취소용) ──────────────────────────
adminRouter.post('/closing-rollback/:hospitalId', async (c) => {
  const hospitalId = c.req.param('hospitalId')
  const { year, month } = await c.req.json()

  // monthly_closings 상태를 다시 'requested' 또는 삭제
  await c.env.DB.prepare(`
    UPDATE monthly_closings SET status='requested', approved_at=NULL
    WHERE hospital_id=? AND year=? AND month=?
  `).bind(hospitalId, year, month).run()

  // hospital_info를 다시 해당 월로 되돌리기
  await c.env.DB.prepare(`
    UPDATE hospital_info SET
      current_year=?, current_month=?, closing_status='requested',
      closing_requested_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
    WHERE hospital_id=?
  `).bind(year, month, hospitalId).run()

  const hospital = await c.env.DB.prepare(`SELECT name FROM hospitals WHERE id=?`)
    .bind(hospitalId).first<any>()

  return c.json({ 
    success: true, 
    message: `${hospital?.name} ${year}년 ${month}월 마감 승인이 취소되었습니다. 다시 ${month}월로 되돌아갔습니다.` 
  })
})
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
      SELECT hs.hospital_id, hs.username, hs.last_page, hs.last_action, hs.last_active_at,
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

  // 온라인 세션 (5분 기준) - 액션 정보 포함
  const onlineSessions = await c.env.DB.prepare(`
    SELECT hospital_id, username, last_page, last_active_at, last_action
    FROM hospital_sessions
    WHERE last_active_at >= datetime('now', '-5 minutes')
    GROUP BY hospital_id
    HAVING MAX(last_active_at)
  `).all<any>()
  const onlineMap: Record<number, any> = {}
  for (const s of (onlineSessions.results || [])) {
    onlineMap[s.hospital_id] = s
  }

  const results = await Promise.all(
    (hospitals.results || []).map(async (h: any) => {
      // ★ 핵심: 각 병원의 실제 활성 연/월을 우선 사용 (영양사가 입력한 데이터와 일치)
      const hYear  = String(h.current_year  || year)
      const hMonth = String(h.current_month || month)

      // 해당 월 설정 없으면 해당 월 이전 중 가장 가까운 설정 fallback (소급 방지)
      let settings = await c.env.DB.prepare(
        `SELECT * FROM monthly_settings WHERE hospital_id=? AND year=? AND month=?`
      ).bind(h.id, hYear, hMonth).first<any>()
      if (!settings) {
        settings = await c.env.DB.prepare(
          `SELECT * FROM monthly_settings
           WHERE hospital_id=?
             AND (CAST(year AS INTEGER) < CAST(? AS INTEGER)
                  OR (CAST(year AS INTEGER) = CAST(? AS INTEGER) AND CAST(month AS INTEGER) < CAST(? AS INTEGER)))
           ORDER BY CAST(year AS INTEGER) DESC, CAST(month AS INTEGER) DESC LIMIT 1`
        ).bind(h.id, hYear, hYear, hMonth).first<any>()
      }

      // 업체별 사용액 (이슈 분석용)
      const vendors = await c.env.DB.prepare(`
        SELECT v.id, v.name, v.category, v.monthly_budget,
               COALESCE(SUM(d.total_amount),0) as used
        FROM vendors v
        LEFT JOIN daily_orders d ON v.id=d.vendor_id
          AND strftime('%Y',d.order_date)=? AND strftime('%m',d.order_date)=printf('%02d',?)
        WHERE v.hospital_id=? AND v.is_active=1
        GROUP BY v.id
      `).bind(hYear, hMonth, h.id).all<any>()

      // 식수 통계
      const mealStats = await c.env.DB.prepare(`
        SELECT
          COALESCE(SUM(breakfast_patient+lunch_patient+dinner_patient),0) as total_patient,
          COALESCE(SUM(breakfast_staff+lunch_staff+dinner_staff),0) as total_staff,
          COALESCE(SUM(breakfast_noncovered+lunch_noncovered+dinner_noncovered),0) as total_noncovered,
          COALESCE(SUM(breakfast_guardian+lunch_guardian+dinner_guardian),0) as total_guardian
        FROM daily_meals
        WHERE hospital_id=? AND strftime('%Y',meal_date)=? AND strftime('%m',meal_date)=printf('%02d',?)
      `).bind(h.id, hYear, hMonth).first<any>()

      // 커스텀 식수 필드 목록 및 월별 합계
      const customFieldsList = await c.env.DB.prepare(
        `SELECT * FROM meal_custom_fields WHERE hospital_id = ? AND is_active = 1 ORDER BY sort_order, id`
      ).bind(h.id).all<any>()
      const mealCustomDataRows = await c.env.DB.prepare(
        `SELECT custom_data FROM daily_meals
         WHERE hospital_id=? AND strftime('%Y',meal_date)=? AND strftime('%m',meal_date)=printf('%02d',?)
           AND custom_data IS NOT NULL AND custom_data != '{}'`
      ).bind(h.id, hYear, hMonth).all<any>()
      const customFieldTotals: Record<string, number> = {}
      ;(customFieldsList.results || []).forEach((f: any) => { customFieldTotals[f.field_key] = 0 })
      ;(mealCustomDataRows.results || []).forEach((row: any) => {
        try {
          const cd = JSON.parse(row.custom_data || '{}')
          ;(customFieldsList.results || []).forEach((f: any) => {
            const fv = cd[f.field_key] || {}
            customFieldTotals[f.field_key] = (customFieldTotals[f.field_key] || 0) + (fv.bf||0) + (fv.l||0) + (fv.d||0)
          })
        } catch(e) {}
      })
      const customMealTotal = (customFieldsList.results || [])
        .filter((f: any) => f.unit_type !== 'ea')
        .reduce((s: number, f: any) => s + (customFieldTotals[f.field_key] || 0), 0)

      // ── 카테고리 목록 먼저 조회 (오늘 식수 custom_data 파싱에 필요) ──
      const patientCatsListEarly = await c.env.DB.prepare(`
        SELECT * FROM hospital_patient_categories
        WHERE hospital_id = ? AND is_active = 1
        ORDER BY sort_order, id
      `).bind(h.id).all<any>()

      // 오늘 식수 상세 (조식/중식/석식 × 환자/직원/비급여/보호자) + custom_data
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
          COALESCE(SUM(dinner_guardian),0) as dg,
          custom_data
        FROM daily_meals
        WHERE hospital_id=? AND meal_date=?
      `).bind(h.id, today).first<any>()

      // 오늘 환자군별 실제 식수 (custom_data에서 집계)
      const todayCatMealMap: Record<string, number> = {}
      let todayCustomTotal = 0
      if (todayMeals?.custom_data) {
        try {
          const cd = JSON.parse(todayMeals.custom_data || '{}')
          ;(patientCatsListEarly.results||[]).forEach((cat:any) => {
            const fk = `cat_${cat.category_key}`
            const fv = cd[fk] || {}
            const cnt = (fv.bf||0) + (fv.l||0) + (fv.d||0)
            todayCatMealMap[cat.id] = cnt
            todayCustomTotal += cnt
          })
        } catch(e) {}
      }

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
      `).bind(h.id, hYear, hMonth).all<any>()

      // 잔반 기록
      const foodWaste = await c.env.DB.prepare(`
        SELECT SUM(waste_amount) as total_waste, SUM(waste_cost) as total_cost
        FROM food_waste_records WHERE hospital_id=? AND year=? AND month=?
      `).bind(h.id, hYear, hMonth).first<any>()

      // 법인카드 월별 사용 현황 (구분별 합계)
      const cardExpensesRaw = await c.env.DB.prepare(`
        SELECT v.card_subtype, COALESCE(SUM(ce.amount),0) as total, COUNT(ce.id) as cnt
        FROM card_expenses ce
        JOIN vendors v ON ce.vendor_id = v.id
        WHERE ce.hospital_id = ? AND ce.expense_date LIKE ?
        GROUP BY v.card_subtype
      `).bind(h.id, `${hYear}-${hMonth.padStart(2,'0')}%`).all<any>()
      const subtypeLabels: Record<string,string> = { food:'식재료', supplies:'소모품', online:'온라인', other:'기타' }
      const cardBySubtype = (cardExpensesRaw.results || []).map((r: any) => ({
        subtype: r.card_subtype || 'other',
        label: subtypeLabels[r.card_subtype] || '기타',
        total: r.total || 0,
        count: r.cnt || 0
      }))
      const cardMonthTotal = cardBySubtype.reduce((s: number, r: any) => s + r.total, 0)

      const totalBudget = settings?.total_budget || 0
      const workingDays = settings?.working_days || 30
      const dailyBudget = workingDays > 0 ? Math.round(totalBudget / workingDays) : 0
      const weekBudget = dailyBudget * 5

      // totalUsed: daily_orders 직접 집계 (vendor_id가 다른 병원 업체를 참조해도 포함)
      const totalUsedRow2 = await c.env.DB.prepare(
        `SELECT COALESCE(SUM(total_amount),0) as total FROM daily_orders
         WHERE hospital_id=?
           AND strftime('%Y',order_date)=?
           AND strftime('%m',order_date)=printf('%02d',?)`
      ).bind(h.id, hYear, hMonth).first<any>()
      const totalUsed = totalUsedRow2?.total || 0
      const progress = totalBudget > 0 ? ((totalUsed / totalBudget) * 100) : 0

      // 식단가 계산 (3종) - 커스텀 식수 포함
      const ms = mealStats || { total_patient:0, total_staff:0, total_noncovered:0, total_guardian:0 }
      // 총식수: 비급여 제외 (환자+직원+보호자) + 커스텀
      const totalMeals = ms.total_patient + ms.total_staff + ms.total_guardian + customMealTotal
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

      // 전월 식단가 계산 (병원 활성 월 기준)
      const prevMonthNum = parseInt(hMonth) === 1 ? 12 : parseInt(hMonth) - 1
      const prevYearStr  = parseInt(hMonth) === 1 ? String(parseInt(hYear) - 1) : hYear
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
      // 전월 총식수: 비급여 제외
      const prevTotalMeals = (pms.total_patient||0)+(pms.total_staff||0)+(pms.total_guardian||0)
      const prevTotalUsed  = prevOrders?.total_used || 0
      const prevSupplyUsed = prevSupply?.supply_used || 0
      const prevStaffRatio = prevTotalMeals > 0 ? (pms.total_staff||0) / prevTotalMeals : 0
      const prevStaffCost  = Math.round(prevTotalUsed * prevStaffRatio)
      const prevMealPriceTotal   = prevTotalMeals > 0 ? Math.round(prevTotalUsed / prevTotalMeals) : 0
      const prevMealPriceNoStaff = (prevTotalMeals-(pms.total_staff||0)) > 0
        ? Math.round((prevTotalUsed-prevStaffCost)/(prevTotalMeals-(pms.total_staff||0))) : 0
      const prevMealPriceNoSupply= prevTotalMeals > 0
        ? Math.round((prevTotalUsed-prevSupplyUsed)/prevTotalMeals) : 0

      // ── 카테고리별 식단가 계산 ──────────────────────────────────
      // 카테고리 목록 (위에서 미리 조회한 patientCatsListEarly 재사용)
      const patientCatsList = patientCatsListEarly

      // 카테고리별 월 발주금액
      const catMonthlyOrders = await c.env.DB.prepare(`
        SELECT
          patient_category_id,
          COALESCE(SUM(total_amount), 0) as total
        FROM daily_orders
        WHERE hospital_id = ?
          AND patient_category_id IS NOT NULL
          AND strftime('%Y', order_date) = ?
          AND strftime('%m', order_date) = printf('%02d', ?)
        GROUP BY patient_category_id
      `).bind(h.id, hYear, hMonth).all<any>()

      // 카테고리별 오늘 발주금액
      const catTodayOrders = await c.env.DB.prepare(`
        SELECT
          patient_category_id,
          COALESCE(SUM(total_amount), 0) as total
        FROM daily_orders
        WHERE hospital_id = ?
          AND patient_category_id IS NOT NULL
          AND order_date = ?
        GROUP BY patient_category_id
      `).bind(h.id, today).all<any>()

      // 카테고리별 목표 설정 (fallback: 해당 월 이전 중 가장 가까운 설정, 소급 방지)
      let catSettingsForDash = await c.env.DB.prepare(`
        SELECT cos.*, hpc.category_key, hpc.category_name
        FROM category_order_settings cos
        JOIN hospital_patient_categories hpc ON cos.patient_category_id = hpc.id
        WHERE cos.hospital_id = ? AND cos.year = ? AND cos.month = ?
      `).bind(h.id, hYear, hMonth).all<any>()
      if (!catSettingsForDash.results || catSettingsForDash.results.length === 0) {
        catSettingsForDash = await c.env.DB.prepare(`
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
        `).bind(h.id, h.id, hYear, hYear, hMonth).all<any>()
      }

      // 전월 카테고리별 목표 설정 (fallback 포함)
      let prevCatSettingsForDash = await c.env.DB.prepare(`
        SELECT cos.*, hpc.category_key, hpc.category_name
        FROM category_order_settings cos
        JOIN hospital_patient_categories hpc ON cos.patient_category_id = hpc.id
        WHERE cos.hospital_id = ? AND cos.year = ? AND cos.month = ?
      `).bind(h.id, prevYearStr, prevMonthNum).all<any>()
      if (!prevCatSettingsForDash.results || prevCatSettingsForDash.results.length === 0) {
        prevCatSettingsForDash = await c.env.DB.prepare(`
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
        `).bind(h.id, h.id, prevYearStr, prevYearStr, prevMonthNum).all<any>()
      }

      // 카테고리별 오늘 식수: custom_data에서 직접 집계 (이전의 환자 비중 추정 제거)
      const totalCatBudget2 = (catSettingsForDash.results||[]).reduce((s:number, c2:any) => s+(c2.monthly_budget||0), 0)

      // ── 카테고리별 월 식수 집계 (custom_data의 cat_ 키 기반) ──
      const catMonthMealMap: Record<number, number> = {}
      ;(patientCatsList.results||[]).forEach((cat:any) => {
        const fk = `cat_${cat.category_key}`
        catMonthMealMap[cat.id] = customFieldTotals[fk] || 0
      })

      // 카테고리별 발주금액 맵
      const catMonthMap: Record<number, number> = {}
      ;(catMonthlyOrders.results||[]).forEach((r:any) => { catMonthMap[r.patient_category_id] = r.total })
      const catTodayMap: Record<number, number> = {}
      ;(catTodayOrders.results||[]).forEach((r:any) => { catTodayMap[r.patient_category_id] = r.total })
      const catSetMap2: Record<number, any> = {}
      ;(catSettingsForDash.results||[]).forEach((s2:any) => { catSetMap2[s2.patient_category_id] = s2 })
      const prevCatSetMap2: Record<number, any> = {}
      ;(prevCatSettingsForDash.results||[]).forEach((s2:any) => { prevCatSetMap2[s2.patient_category_id] = s2 })

      // 카테고리별 식단가 계산
      const catDietPrices = (patientCatsList.results||[]).map((cat:any) => {
        const monthAmt = catMonthMap[cat.id] || 0
        const todayAmt = catTodayMap[cat.id] || 0
        const settings2 = catSetMap2[cat.id] || {}
        const targetPrice = settings2.target_meal_price || 0
        const monthBudget = settings2.monthly_budget || 0
        const workDays = settings2.working_days || workingDays

        // 카테고리 식수 배분 비중 (예산 기준) - 월간 식단가 계산용
        const catRatio = totalCatBudget2 > 0 ? (monthBudget / totalCatBudget2) : (1 / Math.max((patientCatsList.results||[]).length, 1))
        // 오늘 카테고리별 식수: custom_data에서 직접 읽은 실제 값
        const todayCatMeals = todayCatMealMap[cat.id] || 0
        const todayDietPrice = todayCatMeals > 0 ? Math.round(todayAmt / todayCatMeals) : 0

        // ── 월 식수 (custom_data 집계) 및 월 식단가 계산 ──
        const monthMeals = catMonthMealMap[cat.id] || 0
        // 식단가: 월 발주금액 ÷ 월 식수 (식수가 없으면 workDays로 추정)
        const mealPrice = monthMeals > 0
          ? Math.round(monthAmt / monthMeals)
          : (monthBudget > 0 && workDays > 0 && settings2.daily_meal_count > 0)
            ? Math.round(monthBudget / (workDays * settings2.daily_meal_count))
            : 0
        // 월 식단가 (백엔드 직접 계산값, formula 기반)
        const monthDietPrice = mealPrice

        // 전월 데이터
        const prevSet = prevCatSetMap2[cat.id] || {}
        const prevTargetPrice = prevSet.target_meal_price || 0
        const prevMonthBudget = prevSet.monthly_budget || 0

        return {
          id: cat.id,
          category_key: cat.category_key,
          category_name: cat.category_name,
          monthAmt,
          todayAmt,
          monthBudget,
          targetPrice,
          workDays,
          todayCatMeals,
          todayDietPrice,
          catRatio,
          prevTargetPrice,
          prevMonthBudget,
          // 보고서 PAGE3 식단가 표시에 필요한 필드
          monthMeals,
          mealPrice,
          monthDietPrice
        }
      })

      // ── 전체 식단가: 총발주÷총식수 방식 (카테고리 있으면 카테고리 합산, 없으면 기존 방식) ──
      // 올바른 방식: (항암발주+요양발주) / (항암식수+요양식수)
      let formulaMealPriceTotal = mealPriceTotal  // 기본값 (카테고리 없는 병원)
      const activeCatPricesAdmin = catDietPrices.filter((c: any) => c.monthMeals > 0 && c.monthAmt > 0)
      if (activeCatPricesAdmin.length >= 1) {
        const sumAmt   = activeCatPricesAdmin.reduce((s: number, c: any) => s + c.monthAmt,   0)
        const sumMeals = activeCatPricesAdmin.reduce((s: number, c: any) => s + c.monthMeals, 0)
        if (sumMeals > 0) formulaMealPriceTotal = Math.round(sumAmt / sumMeals)
      }

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
      if (targetMealPrice > 0 && formulaMealPriceTotal > targetMealPrice) {
        const pct = ((formulaMealPriceTotal - targetMealPrice) / targetMealPrice * 100).toFixed(1)
        issues.push({ type: 'meal_price_over', level: 'danger',
          msg: `[식단가초과] 실제 ${formulaMealPriceTotal.toLocaleString()}원 (목표대비 ${pct}% 초과)` })
      }

      return {
        hospital: h,
        totalBudget,
        totalUsed,
        progress: progress.toFixed(1),
        remaining: totalBudget - totalUsed,
        mealPriceTotal: formulaMealPriceTotal,  // 총발주÷총식수 (카테고리 가중평균)
        mealPriceRaw: mealPriceTotal,            // 기존 방식 (전체발주÷전체식수) 참고용
        mealPriceNoStaff,
        mealPriceNoSupply,
        targetMealPrice,
        totalMeals,
        mealStats: ms,
        mealCustomFields: customFieldsList.results || [],
        mealCustomTotals: customFieldTotals,
        todayUsed: todayUsed?.t || 0,
        weekUsed: weekUsed?.t || 0,
        dailyBudget,
        weekBudget,
        vendors: vendors.results || [],
        dailyOrders: dailyOrders.results || [],
        foodWaste: { totalWaste: foodWaste?.total_waste||0, totalCost: foodWaste?.total_cost||0 },
        todayMeals: todayMeals || { bp:0, lp:0, dp:0, bs:0, ls:0, ds:0, bn:0, ln:0, dn:0, bg:0, lg:0, dg:0 },
        todayTotalMeals: (todayMeals?.bs||0)+(todayMeals?.ls||0)+(todayMeals?.ds||0)
                       + (todayMeals?.bg||0)+(todayMeals?.lg||0)+(todayMeals?.dg||0)
                       + todayCustomTotal,  // 직원+보호자+환자군 합계 (비급여 제외)
        todayCatMeals: todayCatMealMap,  // 카테고리별 실제 오늘 식수
        issues,
        online: onlineMap[h.id] || null,
        closingStatus: h.closing_status || 'open',
        activeYear: parseInt(hYear),
        activeMonth: parseInt(hMonth),
        catDietPrices,
        cardExpenses: {
          monthTotal: cardMonthTotal,
          bySubtype: cardBySubtype
        },
        prevMonth: {
          month: prevMonthNum, year: parseInt(prevYearStr),
          mealPriceTotal: prevMealPriceTotal,
          mealPriceNoStaff: prevMealPriceNoStaff,
          mealPriceNoSupply: prevMealPriceNoSupply,
          totalMeals: prevTotalMeals,
          totalUsed: prevTotalUsed
        },
        // ── 2.3 예산 소진 예상일 (관리자 카드용) ──
        // 계산: (남은 예산) / (일평균 사용액) = 남은 일수 → 오늘 + 남은 일수 = 소진 예상일
        // 조건: 소진 예상일이 이번 달 말일 이전일 때만 ⚠️ 표시 (연도 일치 필수)
        budgetDepletionDate: (() => {
          if (totalBudget <= 0 || totalUsed <= 0) return null
          const todayD = new Date(); const elapsed = todayD.getDate()
          if (elapsed <= 0) return null
          const avgDaily = totalUsed / elapsed
          const rem = totalBudget - totalUsed
          if (rem <= 0) return '이미 초과'
          const daysLeft = Math.ceil(rem / avgDaily)
          const depDate = new Date(todayD.getFullYear(), todayD.getMonth(), todayD.getDate() + daysLeft)
          const lastDayOfMonth = new Date(todayD.getFullYear(), todayD.getMonth()+1, 0)
          // 연도·월 모두 일치해야 이달 내 소진으로 판단
          const isThisMonth = depDate.getFullYear() === todayD.getFullYear()
                           && depDate.getMonth() === todayD.getMonth()
          if (!isThisMonth) return null  // 이달 내 소진 아니면 표시 안 함
          const daysToEnd = lastDayOfMonth.getDate() - todayD.getDate()
          // 말일까지 남은 날수보다 소진일이 빠르면 위험 경고
          const status = daysLeft <= Math.ceil(daysToEnd * 0.5) ? '🚨' : '⚠️'
          return `${depDate.getMonth()+1}월 ${depDate.getDate()}일 ${status}`
        })(),
        // ── 2.2 월말 예상 식단가 (관리자 카드용) ──
        // 계산: (현재까지 일평균 사용액) × 월말일 → 월말 예상 총 사용액 / 월말 예상 총 식수 = 월말 예상 식단가
        // 단, 입력된 식수 데이터(days_entered)가 없으면 현재 식단가 그대로 반환
        projectedMonthEndMealPrice: (() => {
          if (totalUsed <= 0) return 0
          const todayD = new Date(); const elapsed = todayD.getDate()
          const dim = new Date(todayD.getFullYear(), todayD.getMonth()+1, 0).getDate()
          if (elapsed <= 0 || elapsed >= dim) return mealPriceTotal > 0 ? mealPriceTotal : 0
          const avgDailyUsed = totalUsed / elapsed
          const projUsed = totalUsed + avgDailyUsed * (dim - elapsed)
          if (totalMeals > 0) {
            const daysWithMeals = mealStats?.days_entered && mealStats.days_entered > 0
              ? mealStats.days_entered
              : elapsed  // 입력일 기록 없으면 경과일로 대체
            const avgMeals = totalMeals / daysWithMeals
            const projMeals = totalMeals + avgMeals * (dim - elapsed)
            return projMeals > 0 ? Math.round(projUsed / projMeals) : 0
          }
          return mealPriceTotal > 0 ? mealPriceTotal : 0
        })()
      }
    })
  )

  return c.json({ hospitals: results, year, month, today })
})

// ── 병원별 업체 목록 (관리자용) ───────────────────────────────
adminRouter.get('/hospitals/:id/vendors', async (c) => {
  const id = c.req.param('id')
  const vendors = await c.env.DB.prepare(`
    SELECT id, name, category, tax_type, monthly_budget, sort_order,
           COALESCE(is_card_type, 0) as is_card_type, card_subtype
    FROM vendors
    WHERE hospital_id=? AND is_active=1
    ORDER BY sort_order, id
  `).bind(id).all<any>()
  return c.json(vendors.results || [])
})

// ── 병원별 업체 추가 (관리자용) ───────────────────────────────
adminRouter.post('/hospitals/:id/vendors', async (c) => {
  const hospitalId = c.req.param('id')
  const { name, category, taxType, monthlyBudget, sortOrder, isCardType, cardSubtype } = await c.req.json()
  if (!name?.trim()) return c.json({ error: '업체명을 입력하세요' }, 400)
  await c.env.DB.prepare(`
    INSERT INTO vendors (hospital_id, name, category, tax_type, monthly_budget, sort_order, is_active, is_card_type, card_subtype)
    VALUES (?,?,?,?,?,?,1,?,?)
  `).bind(
    hospitalId, name.trim(), category||'general',
    taxType||'mixed', monthlyBudget||0, sortOrder||99,
    isCardType ? 1 : 0, cardSubtype || null
  ).run()
  // ── 발주 업체 등록 시 거래명세서 업체도 자동 생성 (미설정 상태로) ──
  const norm = name.trim().replace(/\s+/g, '')
  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO hospital_invoice_vendors
      (hospital_id, vendor_name, vendor_name_norm, test_status)
    VALUES (?, ?, ?, 'untested')
  `).bind(hospitalId, name.trim(), norm).run()
  return c.json({ success: true })
})

// ── 업체 순서 일괄 변경 (반드시 :vid 라우트보다 위에 있어야 함) ───
adminRouter.put('/hospitals/:id/vendors/reorder', async (c) => {
  const hospitalId = c.req.param('id')
  const { order } = await c.req.json() // order: [{id, sort_order}]
  if (!Array.isArray(order)) return c.json({ error: 'invalid' }, 400)
  const stmts = order.map((item: any) =>
    c.env.DB.prepare(`UPDATE vendors SET sort_order=? WHERE id=? AND hospital_id=?`)
      .bind(item.sort_order, item.id, hospitalId)
  )
  await c.env.DB.batch(stmts)
  return c.json({ success: true })
})

// ── 병원별 업체 수정 (관리자용) ───────────────────────────────
adminRouter.put('/hospitals/:id/vendors/:vid', async (c) => {
  const { id: hospitalId, vid } = c.req.param()
  const { name, category, taxType, monthlyBudget, sortOrder, isCardType, cardSubtype } = await c.req.json()
  await c.env.DB.prepare(`
    UPDATE vendors SET name=?, category=?, tax_type=?, monthly_budget=?, sort_order=?,
                       is_card_type=?, card_subtype=?
    WHERE id=? AND hospital_id=?
  `).bind(
    name, category||'general', taxType||'mixed',
    monthlyBudget||0, sortOrder||99,
    isCardType ? 1 : 0, cardSubtype || null,
    vid, hospitalId
  ).run()
  return c.json({ success: true })
})

// ── 병원별 업체 삭제 (관리자용) ───────────────────────────────
adminRouter.delete('/hospitals/:id/vendors/:vid', async (c) => {
  const { id: hospitalId, vid } = c.req.param()
  // 업체명 조회 후 명세서 업체도 soft-delete
  const vendor = await c.env.DB.prepare(
    `SELECT name FROM vendors WHERE id=? AND hospital_id=?`
  ).bind(vid, hospitalId).first<any>()
  await c.env.DB.prepare(`
    UPDATE vendors SET is_active=0 WHERE id=? AND hospital_id=?
  `).bind(vid, hospitalId).run()
  if (vendor?.name) {
    const norm = vendor.name.replace(/\s+/g, '')
    await c.env.DB.prepare(`
      UPDATE hospital_invoice_vendors SET is_active=0
      WHERE hospital_id=? AND vendor_name_norm=?
    `).bind(hospitalId, norm).run()
  }
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
      // ★ 각 병원의 실제 활성 연/월 기준으로 조회
      const hYear  = String(h.current_year  || year)
      const hMonth = String(h.current_month || month)

      // 해당 월 설정 없으면 해당 월 이전 중 가장 가까운 설정 fallback (소급 방지)
      let settings = await c.env.DB.prepare(
        `SELECT * FROM monthly_settings WHERE hospital_id=? AND year=? AND month=?`
      ).bind(h.id, hYear, hMonth).first<any>()
      if (!settings) {
        settings = await c.env.DB.prepare(
          `SELECT * FROM monthly_settings
           WHERE hospital_id=?
             AND (CAST(year AS INTEGER) < CAST(? AS INTEGER)
                  OR (CAST(year AS INTEGER) = CAST(? AS INTEGER) AND CAST(month AS INTEGER) < CAST(? AS INTEGER)))
           ORDER BY CAST(year AS INTEGER) DESC, CAST(month AS INTEGER) DESC LIMIT 1`
        ).bind(h.id, hYear, hYear, hMonth).first<any>()
      }

      const totalUsed = await c.env.DB.prepare(`
        SELECT COALESCE(SUM(total_amount),0) as total FROM daily_orders
        WHERE hospital_id=? AND strftime('%Y',order_date)=? AND strftime('%m',order_date)=printf('%02d',?)
      `).bind(h.id, hYear, hMonth).first<any>()

      const today = new Date().toISOString().split('T')[0]
      const todayUsed = await c.env.DB.prepare(`
        SELECT COALESCE(SUM(total_amount),0) as today_total FROM daily_orders
        WHERE hospital_id=? AND order_date=?
      `).bind(h.id, today).first<any>()

      const closingReq = await c.env.DB.prepare(`
        SELECT status, requested_at FROM monthly_closings
        WHERE hospital_id=? AND year=? AND month=?
      `).bind(h.id, hYear, hMonth).first<any>()

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
        activeYear: parseInt(hYear),
        activeMonth: parseInt(hMonth)
      }
    })
  )
  return c.json({ hospitals: results, year, month })
})

// ── 병원 계정 목록 조회 ────────────────────────────────────────
adminRouter.get('/hospitals/:id/accounts', async (c) => {
  const id = c.req.param('id')
  const accounts = await c.env.DB.prepare(`
    SELECT u.id, u.username, u.role, u.nutritionist_name, u.created_at,
           u.password_plain,
           hs.last_active_at as last_active, hs.last_page as current_page,
           hs.last_action
    FROM users u
    LEFT JOIN (
      SELECT hospital_id, username, last_active_at, last_page, last_action
      FROM hospital_sessions
      WHERE last_active_at >= datetime('now', '-5 minutes')
      ORDER BY last_active_at DESC
    ) hs ON hs.username = u.username AND hs.hospital_id = u.hospital_id
    WHERE u.hospital_id = ? ORDER BY u.id
  `).bind(id).all<any>()
  return c.json(accounts.results || [])
})

// ── 병원 계정 생성 ─────────────────────────────────────────────
adminRouter.post('/hospitals/:id/accounts', async (c) => {
  const hospitalId = c.req.param('id')
  const { username, password, nutritionistName } = await c.req.json()
  if (!username?.trim() || !password?.trim())
    return c.json({ error: '아이디와 비밀번호를 입력하세요' }, 400)

  // 중복 아이디 체크
  const exists = await c.env.DB.prepare(
    `SELECT id FROM users WHERE username = ?`
  ).bind(username.trim()).first<any>()
  if (exists) return c.json({ error: '이미 사용 중인 아이디입니다' }, 409)

  const hash = await hashPassword(password)
  await c.env.DB.prepare(`
    INSERT INTO users (hospital_id, username, password_hash, password_plain, role, nutritionist_name)
    VALUES (?, ?, ?, ?, 'hospital', ?)
  `).bind(hospitalId, username.trim(), hash, password, nutritionistName?.trim()||'').run()
  return c.json({ success: true, username: username.trim(), password, nutritionistName: nutritionistName?.trim()||'' })
})

// ── 병원 계정 비밀번호/영양사이름 변경 ────────────────────────
adminRouter.put('/hospitals/:id/accounts/:uid', async (c) => {
  const { id: hospitalId, uid } = c.req.param()
  const { password, username, nutritionistName } = await c.req.json()

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
      `UPDATE users SET password_hash = ?, password_plain = ? WHERE id = ? AND hospital_id = ?`
    ).bind(hash, password, uid, hospitalId).run()
  }

  // 영양사 이름 변경 (값이 있을 때만)
  if (nutritionistName !== undefined && nutritionistName !== null) {
    await c.env.DB.prepare(
      `UPDATE users SET nutritionist_name = ? WHERE id = ? AND hospital_id = ?`
    ).bind(nutritionistName, uid, hospitalId).run()
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

// ── 병원 계정 생성 (영양사 이름 포함) ──────────────────────────
adminRouter.post('/hospitals/:id/accounts/v2', async (c) => {
  const hospitalId = c.req.param('id')
  const { username, password, nutritionistName } = await c.req.json()
  if (!username?.trim() || !password?.trim())
    return c.json({ error: '아이디와 비밀번호를 입력하세요' }, 400)
  const exists = await c.env.DB.prepare(
    `SELECT id FROM users WHERE username = ?`
  ).bind(username.trim()).first<any>()
  if (exists) return c.json({ error: '이미 사용 중인 아이디입니다' }, 409)
  const hash = await hashPassword(password)
  await c.env.DB.prepare(`
    INSERT INTO users (hospital_id, username, password_hash, password_plain, role, nutritionist_name)
    VALUES (?, ?, ?, ?, 'hospital', ?)
  `).bind(hospitalId, username.trim(), hash, password, nutritionistName?.trim()||'').run()
  return c.json({ success: true, username: username.trim(), password, nutritionistName: nutritionistName?.trim()||'' })
})

// ── 계정 목록 조회 (영양사 이름 포함) ─────────────────────────
adminRouter.get('/hospitals/:id/accounts/v2', async (c) => {
  const id = c.req.param('id')
  const accounts = await c.env.DB.prepare(`
    SELECT id, username, role, nutritionist_name, created_at, password_plain FROM users
    WHERE hospital_id = ? ORDER BY id
  `).bind(id).all<any>()
  return c.json(accounts.results || [])
})

// ── 운영진 계정 목록 조회 ─────────────────────────────────────
adminRouter.get('/hospitals/:id/executive-accounts', async (c) => {
  const id = c.req.param('id')
  const accounts = await c.env.DB.prepare(`
    SELECT u.id, u.username, u.role, u.executive_title, u.nutritionist_name as display_name,
           u.created_at, u.password_plain
    FROM users u
    WHERE u.hospital_id = ? AND u.role = 'executive'
    ORDER BY u.id
  `).bind(id).all<any>()
  return c.json(accounts.results || [])
})

// ── 운영진 계정 생성 ──────────────────────────────────────────
adminRouter.post('/hospitals/:id/executive-accounts', async (c) => {
  const hospitalId = c.req.param('id')
  const { username, password, displayName, executiveTitle } = await c.req.json()
  if (!username?.trim() || !password?.trim())
    return c.json({ error: '아이디와 비밀번호를 입력하세요' }, 400)

  const exists = await c.env.DB.prepare(
    `SELECT id FROM users WHERE username = ?`
  ).bind(username.trim()).first<any>()
  if (exists) return c.json({ error: '이미 사용 중인 아이디입니다' }, 409)

  const hash = await hashPassword(password)
  await c.env.DB.prepare(`
    INSERT INTO users (hospital_id, username, password_hash, password_plain, role, nutritionist_name, executive_title)
    VALUES (?, ?, ?, ?, 'executive', ?, ?)
  `).bind(hospitalId, username.trim(), hash, password, displayName?.trim()||'', executiveTitle?.trim()||'').run()
  return c.json({ success: true })
})

// ── 운영진 계정 수정 ──────────────────────────────────────────
adminRouter.put('/hospitals/:id/executive-accounts/:uid', async (c) => {
  const { id: hospitalId, uid } = c.req.param()
  const { username, password, displayName, executiveTitle } = await c.req.json()

  if (username) {
    const exists = await c.env.DB.prepare(
      `SELECT id FROM users WHERE username = ? AND id != ?`
    ).bind(username.trim(), uid).first<any>()
    if (exists) return c.json({ error: '이미 사용 중인 아이디입니다' }, 409)
    await c.env.DB.prepare(
      `UPDATE users SET username = ? WHERE id = ? AND hospital_id = ? AND role = 'executive'`
    ).bind(username.trim(), uid, hospitalId).run()
  }
  if (password?.trim()) {
    const hash = await hashPassword(password)
    await c.env.DB.prepare(
      `UPDATE users SET password_hash = ?, password_plain = ? WHERE id = ? AND hospital_id = ?`
    ).bind(hash, password, uid, hospitalId).run()
  }
  if (displayName !== undefined) {
    await c.env.DB.prepare(
      `UPDATE users SET nutritionist_name = ? WHERE id = ? AND hospital_id = ?`
    ).bind(displayName, uid, hospitalId).run()
  }
  if (executiveTitle !== undefined) {
    await c.env.DB.prepare(
      `UPDATE users SET executive_title = ? WHERE id = ? AND hospital_id = ?`
    ).bind(executiveTitle, uid, hospitalId).run()
  }
  return c.json({ success: true })
})

// ── 운영진 계정 삭제 ──────────────────────────────────────────
adminRouter.delete('/hospitals/:id/executive-accounts/:uid', async (c) => {
  const { id: hospitalId, uid } = c.req.param()
  await c.env.DB.prepare(
    `DELETE FROM users WHERE id = ? AND hospital_id = ? AND role = 'executive'`
  ).bind(uid, hospitalId).run()
  return c.json({ success: true })
})

// ── 데일리 이슈 목록 조회 (3일 이내) ──────────────────────────
adminRouter.get('/daily-issues', async (c) => {
  // 3일 이상 지난 이슈 자동 삭제 (등록일 포함 3일째 자정 기준)
  await c.env.DB.prepare(`
    DELETE FROM daily_issues
    WHERE issue_date < date('now', '-2 days')
  `).run()

  const issues = await c.env.DB.prepare(`
    SELECT di.*, h.name as hospital_name
    FROM daily_issues di
    JOIN hospitals h ON di.hospital_id = h.id
    ORDER BY di.issue_date DESC, di.id DESC
  `).all<any>()
  return c.json(issues.results || [])
})

// ── 데일리 이슈 수동 저장 ─────────────────────────────────────
adminRouter.post('/daily-issues', async (c) => {
  const { hospital_id, issue_type, issue_level, message, extra_data } = await c.req.json()
  const today = new Date().toISOString().split('T')[0]
  await c.env.DB.prepare(`
    INSERT INTO daily_issues (hospital_id, issue_date, issue_type, issue_level, message, extra_data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(hospital_id, today, issue_type||'manual', issue_level||'warning', message, extra_data||null).run()
  return c.json({ success: true })
})

// ── 이슈 자동 저장 (대시보드 로드 시 현재 이슈를 DB에 기록) ───
adminRouter.post('/daily-issues/auto-save/:year/:month', async (c) => {
  const { year, month } = c.req.param()
  const { hospitalId, issues } = await c.req.json()
  const today = new Date().toISOString().split('T')[0]
  // 오늘 해당 병원 이슈 초기화 후 재삽입
  await c.env.DB.prepare(`
    DELETE FROM daily_issues WHERE hospital_id=? AND issue_date=?
  `).bind(hospitalId, today).run()
  for (const issue of (issues || [])) {
    await c.env.DB.prepare(`
      INSERT INTO daily_issues (hospital_id, issue_date, issue_type, issue_level, message)
      VALUES (?, ?, ?, ?, ?)
    `).bind(hospitalId, today, issue.type, issue.level, issue.msg).run()
  }
  return c.json({ success: true })
})

// ── 마감 승인 요청 목록 (사이드바 배지용) ─────────────────────
adminRouter.get('/close-requests/pending', async (c) => {
  const requests = await c.env.DB.prepare(`
    SELECT cr.*, h.name as hospital_name
    FROM close_month_requests cr
    JOIN hospitals h ON cr.hospital_id = h.id
    WHERE cr.status = 'pending'
    ORDER BY cr.requested_at DESC
  `).all<any>()
  // monthly_closings 기반 요청도 포함
  const legacyReqs = await c.env.DB.prepare(`
    SELECT mc.*, h.name as hospital_name
    FROM monthly_closings mc
    JOIN hospitals h ON mc.hospital_id = h.id
    WHERE mc.status = 'requested'
    ORDER BY mc.requested_at DESC
  `).all<any>()
  const allReqs = [...(requests.results||[]), ...(legacyReqs.results||[])]
  return c.json({ requests: allReqs, count: allReqs.length })
})

// ── 마감 요청 전체 목록 (병원 관리 페이지용) ─────────────────
adminRouter.get('/closing-requests', async (c) => {
  const reqs = await c.env.DB.prepare(`
    SELECT mc.*, h.name as hospital_name
    FROM monthly_closings mc
    JOIN hospitals h ON mc.hospital_id = h.id
    WHERE mc.status = 'requested'
    ORDER BY mc.requested_at DESC
  `).all<any>()
  return c.json(reqs.results || [])
})

// ── 최근 승인된 마감 이력 (롤백용, 7일 이내) ─────────────────
adminRouter.get('/closing-requests/recent-approved', async (c) => {
  const reqs = await c.env.DB.prepare(`
    SELECT mc.hospital_id, mc.year, mc.month, mc.approved_at, h.name as hospital_name
    FROM monthly_closings mc
    JOIN hospitals h ON mc.hospital_id = h.id
    WHERE mc.status = 'approved'
      AND mc.approved_at >= datetime('now', '-7 days')
    ORDER BY mc.approved_at DESC
    LIMIT 10
  `).all<any>()
  return c.json(reqs.results || [])
})

// ── 업체별 월별 사용금액 (비교분석용) ─────────────────────────
adminRouter.get('/vendor-monthly/:hospitalId/:year', async (c) => {
  const { hospitalId, year } = c.req.param()
  const data = await c.env.DB.prepare(`
    SELECT
      v.id, v.name, v.category,
      strftime('%m', d.order_date) as month,
      COALESCE(SUM(d.total_amount), 0) as total
    FROM vendors v
    LEFT JOIN daily_orders d ON v.id = d.vendor_id
      AND strftime('%Y', d.order_date) = ?
    WHERE v.hospital_id = ? AND v.is_active = 1
    GROUP BY v.id, strftime('%m', d.order_date)
    ORDER BY v.sort_order, v.id, month
  `).bind(year, hospitalId).all<any>()
  return c.json(data.results || [])
})

// ── 연간 분석 데이터 (월별 총발주) ───────────────────────────
adminRouter.get('/annual/:hospitalId/:year', async (c) => {
  const { hospitalId, year } = c.req.param()
  const monthly = await c.env.DB.prepare(`
    SELECT
      strftime('%m', order_date) as month,
      COALESCE(SUM(total_amount), 0) as total
    FROM daily_orders
    WHERE hospital_id = ? AND strftime('%Y', order_date) = ?
    GROUP BY strftime('%m', order_date)
    ORDER BY month
  `).bind(hospitalId, year).all<any>()

  const budgets = await c.env.DB.prepare(`
    SELECT month, total_budget FROM monthly_settings
    WHERE hospital_id = ? AND year = ?
    ORDER BY month
  `).bind(hospitalId, year).all<any>()

  return c.json({
    monthly: monthly.results || [],
    budgets: budgets.results || []
  })
})

// ── 예산 이월 (마감 승인 후 다음 달로 복사) ───────────────────
adminRouter.post('/budget-carryover/:hospitalId', async (c) => {
  const hospitalId = c.req.param('hospitalId')
  const { fromYear, fromMonth, toYear, toMonth } = await c.req.json()

  // 이전 달 설정 조회
  const prevSettings = await c.env.DB.prepare(`
    SELECT * FROM monthly_settings WHERE hospital_id=? AND year=? AND month=?
  `).bind(hospitalId, fromYear, fromMonth).first<any>()

  if (!prevSettings) return c.json({ error: '이전 달 설정 없음' }, 404)

  // 영업일수는 다음 달 자동 계산
  const daysInNextMonth = new Date(toYear, toMonth, 0).getDate()
  let workingDays = 0
  for (let d = 1; d <= daysInNextMonth; d++) {
    const dow = new Date(toYear, toMonth-1, d).getDay()
    if (dow !== 0 && dow !== 6) workingDays++
  }

  // 다음 달 설정 존재 여부 확인
  const exists = await c.env.DB.prepare(`
    SELECT id FROM monthly_settings WHERE hospital_id=? AND year=? AND month=?
  `).bind(hospitalId, toYear, toMonth).first<any>()

  if (!exists) {
    // 없으면 이월 데이터로 새로 생성
    await c.env.DB.prepare(`
      INSERT INTO monthly_settings (
        hospital_id, year, month, total_budget, event_budget, meal_price,
        food_waste_budget, working_days, supply_budget, card_budget,
        created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    `).bind(
      hospitalId, toYear, toMonth,
      prevSettings.total_budget||0, prevSettings.event_budget||0,
      prevSettings.meal_price||0, prevSettings.food_waste_budget||0,
      workingDays,
      prevSettings.supply_budget||0, prevSettings.card_budget||0
    ).run()
  }

  return c.json({ success: true, workingDays, message: `${toYear}년 ${toMonth}월로 예산 이월 완료` })
})

// ── 업체 이월 (마감 승인 후 다음 달 업체 유지) ─────────────────
adminRouter.post('/vendor-carryover/:hospitalId', async (c) => {
  const hospitalId = c.req.param('hospitalId')
  // 업체는 hospital_id 기반으로 이미 공유되므로 특별한 처리 불필요
  // 단지 현재 활성 업체를 확인해서 반환
  const vendors = await c.env.DB.prepare(`
    SELECT id, name, category, tax_type, monthly_budget, sort_order
    FROM vendors WHERE hospital_id=? AND is_active=1
    ORDER BY sort_order, id
  `).bind(hospitalId).all<any>()
  return c.json({ success: true, vendors: vendors.results || [] })
})

// ══════════════════════════════════════════════════════════════
// 병원별 환자군 카테고리 (주종목) CRUD
// ══════════════════════════════════════════════════════════════

// 카테고리 목록 조회
adminRouter.get('/hospitals/:id/patient-categories', async (c) => {
  const id = c.req.param('id')
  const cats = await c.env.DB.prepare(`
    SELECT * FROM hospital_patient_categories
    WHERE hospital_id = ? AND is_active = 1
    ORDER BY sort_order, id
  `).bind(id).all<any>()
  return c.json(cats.results || [])
})

// 카테고리별 식단가 계산 기준 저장 (budget_include_keys, meals_include_keys)
adminRouter.put('/hospitals/:id/patient-categories/:catId/formula', async (c) => {
  const { id, catId } = c.req.param()
  const { budget_include_keys, meals_include_keys } = await c.req.json() as any

  await c.env.DB.prepare(`
    UPDATE hospital_patient_categories
    SET budget_include_keys = ?, meals_include_keys = ?
    WHERE hospital_id = ? AND id = ?
  `).bind(
    budget_include_keys ? JSON.stringify(budget_include_keys) : null,
    meals_include_keys ? JSON.stringify(meals_include_keys) : null,
    id, catId
  ).run()

  return c.json({ success: true })
})

// 카테고리 일괄 저장 (추가/수정/삭제 통합)
adminRouter.put('/hospitals/:id/patient-categories', async (c) => {
  const id = c.req.param('id')
  const { categories } = await c.req.json() as { categories: any[] }

  if (!categories || !Array.isArray(categories)) {
    return c.json({ error: 'categories 배열 필요' }, 400)
  }

  // 기존 전체 비활성화
  await c.env.DB.prepare(`
    UPDATE hospital_patient_categories SET is_active = 0 WHERE hospital_id = ?
  `).bind(id).run()

  // 새로 upsert
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i]
    await c.env.DB.prepare(`
      INSERT INTO hospital_patient_categories
        (hospital_id, category_key, category_name, order_code, sort_order, is_active)
      VALUES (?,?,?,?,?,1)
      ON CONFLICT(hospital_id, category_key) DO UPDATE SET
        category_name = excluded.category_name,
        order_code = excluded.order_code,
        sort_order = excluded.sort_order,
        is_active = 1
    `).bind(id, cat.category_key, cat.category_name, cat.order_code || '', i).run()
  }

  const updated = await c.env.DB.prepare(`
    SELECT * FROM hospital_patient_categories
    WHERE hospital_id = ? AND is_active = 1
    ORDER BY sort_order, id
  `).bind(id).all<any>()

  // ── meal_custom_fields 자동 동기화 ──────────────────────────
  // 환자군 저장 시 meal_custom_fields에도 cat_{category_key} 자동 반영
  // 1. cat_ 접두어 가진 기존 필드 비활성화
  await c.env.DB.prepare(`
    UPDATE meal_custom_fields SET is_active = 0
    WHERE hospital_id = ? AND field_key LIKE 'cat_%'
  `).bind(id).run()

  // 2. 활성 환자군들을 meal_custom_fields에 upsert (cat_ 접두어)
  const activeCats = updated.results || []
  for (let i = 0; i < activeCats.length; i++) {
    const cat = activeCats[i]
    const fieldKey = `cat_${cat.category_key}`
    await c.env.DB.prepare(`
      INSERT INTO meal_custom_fields
        (hospital_id, field_key, field_name, sort_order, is_active, unit_type)
      VALUES (?, ?, ?, ?, 1, 'meal')
      ON CONFLICT(hospital_id, field_key) DO UPDATE SET
        field_name = excluded.field_name,
        sort_order = excluded.sort_order,
        is_active = 1
    `).bind(id, fieldKey, cat.category_name, i).run()
  }

  return c.json({ success: true, categories: activeCats })
})

// 카테고리별 월간 목표 설정 조회
adminRouter.get('/hospitals/:id/category-settings/:year/:month', async (c) => {
  const { id, year, month } = c.req.param()

  // 1) 해당 월 설정 조회
  let settingsRows = await c.env.DB.prepare(`
    SELECT cos.*, hpc.category_key, hpc.category_name, hpc.order_code
    FROM category_order_settings cos
    JOIN hospital_patient_categories hpc ON cos.patient_category_id = hpc.id
    WHERE cos.hospital_id = ? AND cos.year = ? AND cos.month = ?
    ORDER BY hpc.sort_order
  `).bind(id, year, month).all<any>()

  let isFallback = false
  let fallbackYearMonth: string | null = null

  // 2) 없으면 해당 월 이전 중 카테고리별 가장 가까운 설정을 fallback 사용 (소급 방지)
  if (!settingsRows.results || settingsRows.results.length === 0) {
    settingsRows = await c.env.DB.prepare(`
      SELECT cos.*, hpc.category_key, hpc.category_name, hpc.order_code
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
    `).bind(id, id, year, year, month).all<any>()
    if (settingsRows.results && settingsRows.results.length > 0) {
      isFallback = true
      const r = settingsRows.results[0] as any
      fallbackYearMonth = `${r.year}년 ${r.month}월`
    }
  }

  return c.json({ settings: settingsRows.results || [], isFallback, fallbackYearMonth })
})

// 카테고리별 월간 목표 설정 저장
adminRouter.post('/hospitals/:id/category-settings/:year/:month', async (c) => {
  const { id, year, month } = c.req.param()
  const { settings } = await c.req.json() as { settings: any[] }

  if (!settings || !Array.isArray(settings)) {
    return c.json({ error: 'settings 배열 필요' }, 400)
  }

  for (const s of settings) {
    await c.env.DB.prepare(`
      INSERT INTO category_order_settings
        (hospital_id, patient_category_id, year, month, monthly_budget, target_meal_price, working_days, daily_meal_count, updated_at)
      VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(hospital_id, patient_category_id, year, month) DO UPDATE SET
        monthly_budget = excluded.monthly_budget,
        target_meal_price = excluded.target_meal_price,
        working_days = excluded.working_days,
        daily_meal_count = excluded.daily_meal_count,
        updated_at = CURRENT_TIMESTAMP
    `).bind(id, s.patient_category_id, year, month, s.monthly_budget || 0, s.target_meal_price || 0, s.working_days || 0, s.daily_meal_count || 0).run()
  }

  return c.json({ success: true })
})

// 카테고리별 발주 현황 조회 (일별/월별)
adminRouter.get('/hospitals/:id/category-orders/:year/:month', async (c) => {
  const { id, year, month } = c.req.param()
  const mm = String(month).padStart(2, '0')

  // 카테고리 목록
  const cats = await c.env.DB.prepare(`
    SELECT * FROM hospital_patient_categories
    WHERE hospital_id = ? AND is_active = 1
    ORDER BY sort_order, id
  `).bind(id).all<any>()

  // 카테고리별 월 발주 합계
  const monthly = await c.env.DB.prepare(`
    SELECT
      d.patient_category_id,
      COALESCE(SUM(d.taxable_amount), 0) as taxable,
      COALESCE(SUM(d.exempt_amount), 0) as exempt,
      COALESCE(SUM(d.vat_amount), 0) as vat,
      COALESCE(SUM(d.total_amount), 0) as total
    FROM daily_orders d
    WHERE d.hospital_id = ?
      AND strftime('%Y', d.order_date) = ?
      AND strftime('%m', d.order_date) = ?
    GROUP BY d.patient_category_id
  `).bind(id, String(year), mm).all<any>()

  // 카테고리별 일별 발주
  const daily = await c.env.DB.prepare(`
    SELECT
      d.order_date,
      d.patient_category_id,
      COALESCE(SUM(d.taxable_amount), 0) as taxable,
      COALESCE(SUM(d.exempt_amount), 0) as exempt,
      COALESCE(SUM(d.vat_amount), 0) as vat,
      COALESCE(SUM(d.total_amount), 0) as total
    FROM daily_orders d
    WHERE d.hospital_id = ?
      AND strftime('%Y', d.order_date) = ?
      AND strftime('%m', d.order_date) = ?
    GROUP BY d.order_date, d.patient_category_id
    ORDER BY d.order_date
  `).bind(id, String(year), mm).all<any>()

  // 목표 설정
  const catSettings = await c.env.DB.prepare(`
    SELECT cos.*, hpc.category_key, hpc.category_name
    FROM category_order_settings cos
    JOIN hospital_patient_categories hpc ON cos.patient_category_id = hpc.id
    WHERE cos.hospital_id = ? AND cos.year = ? AND cos.month = ?
  `).bind(id, year, month).all<any>()

  return c.json({
    categories: cats.results || [],
    monthlyByCategory: monthly.results || [],
    dailyByCategory: daily.results || [],
    categorySettings: catSettings.results || []
  })
})

// ── 카테고리별 연간 발주 집계 (분석용) ────────────────────────
adminRouter.get('/hospitals/:id/category-annual/:year', async (c) => {
  const { id, year } = c.req.param()

  const cats = await c.env.DB.prepare(`
    SELECT * FROM hospital_patient_categories
    WHERE hospital_id = ? AND is_active = 1
    ORDER BY sort_order, id
  `).bind(id).all<any>()

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
    GROUP BY d.patient_category_id, strftime('%m', d.order_date)
    ORDER BY d.patient_category_id, month
  `).bind(id, year).all<any>()

  const annualSettings = await c.env.DB.prepare(`
    SELECT cos.*, hpc.category_key, hpc.category_name
    FROM category_order_settings cos
    JOIN hospital_patient_categories hpc ON cos.patient_category_id = hpc.id
    WHERE cos.hospital_id = ? AND cos.year = ?
    ORDER BY hpc.sort_order, cos.month
  `).bind(id, year).all<any>()

  return c.json({
    categories: cats.results || [],
    annualByCategory: annual.results || [],
    annualSettings: annualSettings.results || []
  })
})

// ══════════════════════════════════════════════════════════════
// 식이 분류 (diet_categories) CRUD
// ══════════════════════════════════════════════════════════════

// 병원의 diet_categories 전체 조회 (대분류별 그룹)
// ── 수정: includeInactive=1 쿼리 없으면 is_active=1 항목만 반환 (삭제 항목 복구 방지)
adminRouter.get('/hospitals/:id/diet-categories', async (c) => {
  const id = c.req.param('id')
  const includeInactive = c.req.query('includeInactive') === '1'
  const rows = await c.env.DB.prepare(`
    SELECT * FROM diet_categories
    WHERE hospital_id = ?${includeInactive ? '' : ' AND is_active = 1'}
    ORDER BY parent_type, sort_order, id
  `).bind(id).all<any>()
  return c.json(rows.results || [])
})

// 프리셋 목록 조회
adminRouter.get('/diet-category-presets', async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT * FROM diet_category_presets ORDER BY parent_type, sort_order
  `).all<any>()
  return c.json(rows.results || [])
})

// diet_category 단건 생성 (v2 - diet_level, patient_group, include_in_meal_price 포함)
adminRouter.post('/hospitals/:id/diet-categories', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json() as any
  const {
    parent_type, diet_name, diet_key, is_active, show_in_input, sort_order,
    target_meal_price, monthly_budget,
    diet_level, patient_group, include_in_meal_price
  } = body

  if (!parent_type || !diet_name?.trim()) return c.json({ error: '대분류와 이름을 입력하세요' }, 400)

  const key = diet_key?.trim() || `${parent_type}_${Date.now()}`
  // diet_level 자동 결정 (명시 없으면 parent_type 기반)
  const level = diet_level || (
    parent_type === 'patient'    ? 'group' :
    parent_type === 'therapy'    ? 'therapy' :
    parent_type === 'noncovered' ? 'noncovered_item' : 'staff_item'
  )

  await c.env.DB.prepare(`
    INSERT INTO diet_categories
      (hospital_id, parent_type, diet_key, diet_name, is_active, show_in_input, sort_order,
       target_meal_price, monthly_budget, diet_level, patient_group, include_in_meal_price)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(hospital_id, diet_key) DO UPDATE SET
      diet_name = excluded.diet_name,
      parent_type = excluded.parent_type,
      is_active = excluded.is_active,
      show_in_input = excluded.show_in_input,
      sort_order = excluded.sort_order,
      diet_level = excluded.diet_level,
      patient_group = excluded.patient_group,
      include_in_meal_price = excluded.include_in_meal_price,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    id, parent_type, key, diet_name.trim(),
    is_active ?? 1, show_in_input ?? 1, sort_order ?? 0,
    target_meal_price ?? 0, monthly_budget ?? 0,
    level, patient_group ?? null, include_in_meal_price ?? 0
  ).run()

  // legacy_field_key 동기화: meal_custom_fields에도 추가
  const legacyKey = `diet_${key}`
  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO meal_custom_fields
      (hospital_id, field_key, field_name, sort_order, is_active, unit_type)
    VALUES (?,?,?,?,?,?)
  `).bind(id, legacyKey, diet_name.trim(), sort_order ?? 0, is_active ?? 1, 'meal').run()

  await c.env.DB.prepare(`
    UPDATE diet_categories SET legacy_field_key = ? WHERE hospital_id = ? AND diet_key = ?
  `).bind(legacyKey, id, key).run()

  const newRow = await c.env.DB.prepare(
    `SELECT * FROM diet_categories WHERE hospital_id = ? AND diet_key = ?`
  ).bind(id, key).first<any>()
  return c.json(newRow)
})

// diet_category 수정 (is_active, show_in_input, 식단가, 목표금액, 이름, linked_patient_group 등)
adminRouter.put('/hospitals/:id/diet-categories/:catId', async (c) => {
  const { id, catId } = c.req.param()
  const body = await c.req.json() as any

  await c.env.DB.prepare(`
    UPDATE diet_categories SET
      diet_name        = COALESCE(?, diet_name),
      parent_type      = COALESCE(?, parent_type),
      is_active        = COALESCE(?, is_active),
      show_in_input    = COALESCE(?, show_in_input),
      sort_order       = COALESCE(?, sort_order),
      target_meal_price= COALESCE(?, target_meal_price),
      monthly_budget   = COALESCE(?, monthly_budget),
      include_in_meal_price = COALESCE(?, include_in_meal_price),
      linked_patient_group  = CASE WHEN ? IS NOT NULL THEN ? ELSE linked_patient_group END,
      updated_at       = CURRENT_TIMESTAMP
    WHERE id = ? AND hospital_id = ?
  `).bind(
    body.diet_name ?? null,
    body.parent_type ?? null,
    body.is_active ?? null,
    body.show_in_input ?? null,
    body.sort_order ?? null,
    body.target_meal_price ?? null,
    body.monthly_budget ?? null,
    body.include_in_meal_price ?? null,
    // linked_patient_group: null 값도 명시적으로 처리
    'linked_patient_group' in body ? 'set' : null,
    'linked_patient_group' in body ? (body.linked_patient_group ?? null) : null,
    catId, id
  ).run()

  // meal_custom_fields 동기화
  if (body.legacy_field_key && (body.is_active !== undefined || body.diet_name !== undefined)) {
    await c.env.DB.prepare(`
      UPDATE meal_custom_fields SET
        is_active = COALESCE(?, is_active),
        field_name = COALESCE(?, field_name)
      WHERE hospital_id = ? AND field_key = ?
    `).bind(body.is_active ?? null, body.diet_name ?? null, id, body.legacy_field_key).run()
  }

  return c.json({ success: true })
})

// diet_category 삭제 (비활성화)
adminRouter.delete('/hospitals/:id/diet-categories/:catId', async (c) => {
  const { id, catId } = c.req.param()

  // legacy_field_key 먼저 조회
  const row = await c.env.DB.prepare(
    `SELECT legacy_field_key FROM diet_categories WHERE id = ? AND hospital_id = ?`
  ).bind(catId, id).first<any>()

  await c.env.DB.prepare(`
    UPDATE diet_categories SET is_active = 0, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND hospital_id = ?
  `).bind(catId, id).run()

  if (row?.legacy_field_key) {
    await c.env.DB.prepare(`
      UPDATE meal_custom_fields SET is_active = 0 WHERE hospital_id = ? AND field_key = ?
    `).bind(id, row.legacy_field_key).run()
  }

  return c.json({ success: true })
})

// diet_categories 순서/일괄 업데이트 (v3 - linked_patient_group, include_in_meal_price 지원)
adminRouter.put('/hospitals/:id/diet-categories', async (c) => {
  const id = c.req.param('id')
  const { categories } = await c.req.json() as { categories: any[] }
  if (!Array.isArray(categories)) return c.json({ error: 'categories 배열 필요' }, 400)

  for (const cat of categories) {
    await c.env.DB.prepare(`
      UPDATE diet_categories SET
        sort_order = ?, is_active = ?, show_in_input = ?,
        diet_name = ?, target_meal_price = ?, monthly_budget = ?,
        include_in_meal_price = ?,
        diet_level = COALESCE(?, diet_level),
        patient_group = COALESCE(?, patient_group),
        linked_patient_group = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND hospital_id = ?
    `).bind(
      cat.sort_order ?? 0, cat.is_active ?? 1, cat.show_in_input ?? 1,
      cat.diet_name, cat.target_meal_price ?? 0, cat.monthly_budget ?? 0,
      cat.include_in_meal_price ?? 0,
      cat.diet_level ?? null, cat.patient_group ?? null,
      cat.linked_patient_group ?? null,
      cat.id, id
    ).run()

    // meal_custom_fields 동기화
    if (cat.legacy_field_key) {
      await c.env.DB.prepare(`
        UPDATE meal_custom_fields SET
          is_active = ?, field_name = ?, sort_order = ?
        WHERE hospital_id = ? AND field_key = ?
      `).bind(cat.is_active ?? 1, cat.diet_name, cat.sort_order ?? 0, id, cat.legacy_field_key).run()
    }
  }

  const updated = await c.env.DB.prepare(`
    SELECT * FROM diet_categories WHERE hospital_id = ? AND is_active = 1 ORDER BY parent_type, sort_order, id
  `).bind(id).all<any>()
  return c.json({ success: true, categories: updated.results || [] })
})

// meals GET에서 diet_categories 포함 반환
adminRouter.get('/hospitals/:id/diet-categories-for-meal', async (c) => {
  const id = c.req.param('id')
  const rows = await c.env.DB.prepare(`
    SELECT * FROM diet_categories
    WHERE hospital_id = ? AND is_active = 1 AND show_in_input = 1
    ORDER BY parent_type, sort_order, id
  `).bind(id).all<any>()
  return c.json(rows.results || [])
})

// ── 관리자용: 병원별 환자군 월간 식수 합계 조회 ─────────────────
// 환자군 설정 예산 자동 배분에 사용 (custom_data의 cat_* 키 집계)
adminRouter.get('/hospitals/:id/meal-cat-totals/:year/:month', async (c) => {
  const { id, year, month } = c.req.param()
  const mm = String(month).padStart(2, '0')

  // 환자군 목록
  const cats = await c.env.DB.prepare(`
    SELECT * FROM hospital_patient_categories
    WHERE hospital_id = ? AND is_active = 1
    ORDER BY sort_order, id
  `).bind(id).all<any>()

  // 해당 월 daily_meals custom_data 전체 조회
  const mealRows = await c.env.DB.prepare(`
    SELECT custom_data FROM daily_meals
    WHERE hospital_id = ?
      AND strftime('%Y', meal_date) = ?
      AND strftime('%m', meal_date) = ?
      AND custom_data IS NOT NULL AND custom_data != '{}'
  `).bind(id, String(year), mm).all<any>()

  // 환자군별 식수 집계
  const catMealMap: Record<string, number> = {}
  for (const cat of (cats.results || [])) {
    catMealMap[cat.category_key] = 0
  }

  for (const row of (mealRows.results || [])) {
    try {
      const cd = JSON.parse(row.custom_data || '{}')
      for (const cat of (cats.results || [])) {
        const fk = `cat_${cat.category_key}`
        const fv = cd[fk] || {}
        catMealMap[cat.category_key] = (catMealMap[cat.category_key] || 0) +
          (fv.bf || 0) + (fv.l || 0) + (fv.d || 0)
      }
    } catch (e) {}
  }

  // 결과: 환자군별 식수 합계 + 전체 합계
  const totalMeals = Object.values(catMealMap).reduce((s: number, v) => s + (v as number), 0)
  const result = (cats.results || []).map((cat: any) => ({
    id: cat.id,
    category_key: cat.category_key,
    category_name: cat.category_name,
    total_meals: catMealMap[cat.category_key] || 0,
    ratio: totalMeals > 0 ? (catMealMap[cat.category_key] || 0) / totalMeals : 0
  }))

  return c.json({ catMeals: result, totalMeals })
})

// ── 발주 업체 → 명세서 업체 일괄 동기화 (초기 설정용) ──────────
adminRouter.post('/hospitals/:id/sync-invoice-vendors', async (c) => {
  const hospitalId = c.req.param('id')
  const vendors = await c.env.DB.prepare(`
    SELECT name FROM vendors WHERE hospital_id=? AND is_active=1
  `).bind(hospitalId).all<any>()
  let created = 0
  for (const v of (vendors.results || [])) {
    const norm = v.name.replace(/\s+/g, '')
    const existing = await c.env.DB.prepare(
      `SELECT id FROM hospital_invoice_vendors WHERE hospital_id=? AND vendor_name_norm=?`
    ).bind(hospitalId, norm).first<any>()
    if (!existing) {
      await c.env.DB.prepare(`
        INSERT INTO hospital_invoice_vendors (hospital_id, vendor_name, vendor_name_norm, test_status)
        VALUES (?, ?, ?, 'untested')
      `).bind(hospitalId, v.name, norm).run()
      created++
    }
  }
  return c.json({ success: true, created })
})

export default adminRouter
