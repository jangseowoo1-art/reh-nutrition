import { Hono } from 'hono'

const dashboard = new Hono<{ Bindings: { DB: D1Database } }>()

// 월별 대시보드 요약
dashboard.get('/summary/:year/:month', async (c) => {
  const user = c.get('user')
  const hospitalId = user.role === 'admin' ? c.req.query('hospitalId') : user.hospitalId
  const { year, month } = c.req.param()

  // 월 설정 조회
  const settings = await c.env.DB.prepare(
    `SELECT * FROM monthly_settings WHERE hospital_id = ? AND year = ? AND month = ?`
  ).bind(hospitalId, year, month).first<any>()

  // 업체별 발주 합계
  const vendors = await c.env.DB.prepare(
    `SELECT v.id, v.name, v.category, v.tax_type, v.monthly_budget,
            COALESCE(SUM(d.taxable_amount), 0) as total_taxable,
            COALESCE(SUM(d.exempt_amount), 0) as total_exempt,
            COALESCE(SUM(d.vat_amount), 0) as total_vat,
            COALESCE(SUM(d.total_amount), 0) as total_used
     FROM vendors v
     LEFT JOIN daily_orders d ON v.id = d.vendor_id 
       AND strftime('%Y', d.order_date) = ? 
       AND strftime('%m', d.order_date) = printf('%02d', ?)
     WHERE v.hospital_id = ? AND v.is_active = 1
     GROUP BY v.id
     ORDER BY v.sort_order`
  ).bind(year, month, hospitalId).all<any>()

  // 일별 총 발주액
  const dailyOrders = await c.env.DB.prepare(
    `SELECT order_date, SUM(total_amount) as daily_total
     FROM daily_orders
     WHERE hospital_id = ? 
       AND strftime('%Y', order_date) = ?
       AND strftime('%m', order_date) = printf('%02d', ?)
     GROUP BY order_date
     ORDER BY order_date`
  ).bind(hospitalId, year, month).all<any>()

  // 식수 합계
  const mealStats = await c.env.DB.prepare(
    `SELECT 
       COALESCE(SUM(breakfast_patient + lunch_patient + dinner_patient), 0) as total_patient,
       COALESCE(SUM(breakfast_staff + lunch_staff + dinner_staff), 0) as total_staff,
       COALESCE(SUM(breakfast_noncovered + lunch_noncovered + dinner_noncovered), 0) as total_noncovered,
       COALESCE(SUM(breakfast_guardian + lunch_guardian + dinner_guardian), 0) as total_guardian,
       COUNT(*) as days_entered
     FROM daily_meals
     WHERE hospital_id = ?
       AND strftime('%Y', meal_date) = ?
       AND strftime('%m', meal_date) = printf('%02d', ?)`
  ).bind(hospitalId, year, month).first<any>()

  // 오늘 발주액
  const today = new Date().toISOString().split('T')[0]
  const todayOrders = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(total_amount), 0) as today_total
     FROM daily_orders WHERE hospital_id = ? AND order_date = ?`
  ).bind(hospitalId, today).first<any>()

  // 이번 주 발주액 (일요일 기준)
  const nowDate = new Date()
  const dayOfWeek = nowDate.getDay()
  const weekStart = new Date(nowDate)
  weekStart.setDate(nowDate.getDate() - dayOfWeek)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  const weekStartStr = weekStart.toISOString().split('T')[0]
  const weekEndStr = weekEnd.toISOString().split('T')[0]

  const weekOrders = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(total_amount), 0) as week_total
     FROM daily_orders WHERE hospital_id = ? AND order_date >= ? AND order_date <= ?`
  ).bind(hospitalId, weekStartStr, weekEndStr).first<any>()

  const totalUsed = vendors.results?.reduce((sum: number, v: any) => sum + v.total_used, 0) || 0
  const totalBudget = settings?.total_budget || 0
  const eventBudget = settings?.event_budget || 0
  const workingDays = settings?.working_days || 30
  const progress = totalBudget > 0 ? ((totalUsed / totalBudget) * 100).toFixed(2) : '0.00'
  
  // 일/주/월 목표
  const dailyBudget = workingDays > 0 ? Math.round(totalBudget / workingDays) : 0
  const weeklyBudget = dailyBudget * 7

  // 예산 초과 업체
  const overBudgetVendors = (vendors.results || []).filter((v: any) => 
    v.monthly_budget > 0 && v.total_used > v.monthly_budget
  )

  return c.json({
    settings,
    vendors: vendors.results,
    dailyOrders: dailyOrders.results,
    mealStats,
    overBudgetVendors,
    summary: {
      totalUsed,
      totalBudget,
      eventBudget,
      totalWithEvent: totalBudget + eventBudget,
      progress,
      remaining: totalBudget - totalUsed,
      dailyBudget,
      weeklyBudget,
      todayUsed: todayOrders?.today_total || 0,
      weekUsed: weekOrders?.week_total || 0,
      todayProgress: dailyBudget > 0 ? ((todayOrders?.today_total || 0) / dailyBudget * 100).toFixed(1) : '0.0',
      weekProgress: weeklyBudget > 0 ? ((weekOrders?.week_total || 0) / weeklyBudget * 100).toFixed(1) : '0.0'
    }
  })
})

// 연간 월별 비교
dashboard.get('/annual/:year', async (c) => {
  const user = c.get('user')
  const { year } = c.req.param()
  
  // admin은 hospitalId 쿼리 파라미터 필수, 없으면 첫 번째 병원 사용
  let hospitalId: any = user.hospitalId
  if (user.role === 'admin') {
    hospitalId = c.req.query('hospitalId')
    if (!hospitalId) {
      // hospitalId 없으면 첫 번째 병원 ID 사용
      const firstHospital = await c.env.DB.prepare(`SELECT id FROM hospitals ORDER BY id LIMIT 1`).first<any>()
      hospitalId = firstHospital?.id
    }
  }
  if (!hospitalId) return c.json({ monthly: [], mealMonthly: [], settings: [], vendorAnnual: [] })

  const monthly = await c.env.DB.prepare(
    `SELECT 
       strftime('%m', order_date) as month,
       SUM(total_amount) as total_used,
       SUM(taxable_amount) as total_taxable,
       SUM(exempt_amount) as total_exempt,
       SUM(vat_amount) as total_vat
     FROM daily_orders
     WHERE hospital_id = ? AND strftime('%Y', order_date) = ?
     GROUP BY month
     ORDER BY month`
  ).bind(hospitalId, year).all<any>()

  const mealMonthly = await c.env.DB.prepare(
    `SELECT 
       strftime('%m', meal_date) as month,
       SUM(breakfast_patient + lunch_patient + dinner_patient +
           breakfast_staff + lunch_staff + dinner_staff +
           breakfast_noncovered + lunch_noncovered + dinner_noncovered +
           breakfast_guardian + lunch_guardian + dinner_guardian) as total_meals,
       SUM(breakfast_patient + lunch_patient + dinner_patient) as total_patient,
       SUM(breakfast_staff + lunch_staff + dinner_staff) as total_staff,
       SUM(breakfast_noncovered + lunch_noncovered + dinner_noncovered) as total_noncovered,
       SUM(breakfast_guardian + lunch_guardian + dinner_guardian) as total_guardian
     FROM daily_meals
     WHERE hospital_id = ? AND strftime('%Y', meal_date) = ?
     GROUP BY month
     ORDER BY month`
  ).bind(hospitalId, year).all<any>()

  const settings = await c.env.DB.prepare(
    `SELECT month, total_budget, event_budget, meal_price, working_days FROM monthly_settings
     WHERE hospital_id = ? AND year = ?
     ORDER BY month`
  ).bind(hospitalId, year).all<any>()

  // 업체별 연간 합계
  const vendorAnnual = await c.env.DB.prepare(
    `SELECT v.name, v.category,
            strftime('%m', d.order_date) as month,
            SUM(d.total_amount) as total_used
     FROM daily_orders d
     JOIN vendors v ON d.vendor_id = v.id
     WHERE d.hospital_id = ? AND strftime('%Y', d.order_date) = ?
     GROUP BY v.id, month
     ORDER BY v.sort_order, month`
  ).bind(hospitalId, year).all<any>()

  return c.json({
    monthly: monthly.results,
    mealMonthly: mealMonthly.results,
    settings: settings.results,
    vendorAnnual: vendorAnnual.results
  })
})

// 관리자용 - 전체 병원 현황
dashboard.get('/admin/overview/:year/:month', async (c) => {
  const { year, month } = c.req.param()

  const hospitals = await c.env.DB.prepare(`SELECT * FROM hospitals ORDER BY id`).all<any>()

  // 주간 범위 계산 (월요일 기준)
  const nowDate = new Date()
  const dayOfWeek = nowDate.getDay()
  const weekStartDate = new Date(nowDate)
  weekStartDate.setDate(nowDate.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
  const weekEndDate = new Date(weekStartDate)
  weekEndDate.setDate(weekStartDate.getDate() + 6)
  const weekStartStr = weekStartDate.toISOString().split('T')[0]
  const weekEndStr = weekEndDate.toISOString().split('T')[0]
  const today = nowDate.toISOString().split('T')[0]
  
  const results = await Promise.all(
    (hospitals.results || []).map(async (h: any) => {
      const settings = await c.env.DB.prepare(
        `SELECT * FROM monthly_settings WHERE hospital_id = ? AND year = ? AND month = ?`
      ).bind(h.id, year, month).first<any>()

      const totalUsed = await c.env.DB.prepare(
        `SELECT COALESCE(SUM(total_amount), 0) as total
         FROM daily_orders
         WHERE hospital_id = ? AND strftime('%Y', order_date) = ? AND strftime('%m', order_date) = printf('%02d', ?)`
      ).bind(h.id, year, month).first<any>()

      const mealStats = await c.env.DB.prepare(
        `SELECT COALESCE(SUM(
           breakfast_patient + lunch_patient + dinner_patient +
           breakfast_staff + lunch_staff + dinner_staff +
           breakfast_noncovered + lunch_noncovered + dinner_noncovered +
           breakfast_guardian + lunch_guardian + dinner_guardian), 0) as total_meals
         FROM daily_meals
         WHERE hospital_id = ? AND strftime('%Y', meal_date) = ? AND strftime('%m', meal_date) = printf('%02d', ?)`
      ).bind(h.id, year, month).first<any>()

      // 오늘 발주
      const todayUsed = await c.env.DB.prepare(
        `SELECT COALESCE(SUM(total_amount), 0) as today_total FROM daily_orders WHERE hospital_id = ? AND order_date = ?`
      ).bind(h.id, today).first<any>()

      // 이번주 발주
      const weekUsed = await c.env.DB.prepare(
        `SELECT COALESCE(SUM(total_amount), 0) as week_total FROM daily_orders WHERE hospital_id = ? AND order_date >= ? AND order_date <= ?`
      ).bind(h.id, weekStartStr, weekEndStr).first<any>()

      const totalBudget = settings?.total_budget || 0
      const workingDays = settings?.working_days || new Date(parseInt(year), parseInt(month), 0).getDate()
      const dailyBudget = workingDays > 0 ? Math.round(totalBudget / workingDays) : 0
      const weekBudget = dailyBudget * 5
      const used = totalUsed?.total || 0
      const progress = totalBudget > 0 ? ((used / totalBudget) * 100).toFixed(1) : '0.0'

      return {
        hospital: h,
        totalBudget,
        totalUsed: used,
        progress,
        remaining: totalBudget - used,
        mealPrice: settings?.meal_price || 0,
        totalMeals: mealStats?.total_meals || 0,
        todayUsed: todayUsed?.today_total || 0,
        weekUsed: weekUsed?.week_total || 0,
        dailyBudget,
        weekBudget
      }
    })
  )

  return c.json({ hospitals: results, year, month })
})

export default dashboard
