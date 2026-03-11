import { Hono } from 'hono'

const meals = new Hono<{ Bindings: { DB: D1Database } }>()

// 월별 식수 조회
meals.get('/:year/:month', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const { year, month } = c.req.param()

  const data = await c.env.DB.prepare(
    `SELECT * FROM daily_meals
     WHERE hospital_id = ?
       AND strftime('%Y', meal_date) = ?
       AND strftime('%m', meal_date) = printf('%02d', ?)
     ORDER BY meal_date`
  ).bind(hospitalId, year, month).all<any>()

  return c.json(data.results)
})

// 특정 날짜 식수 조회
meals.get('/date/:date', async (c) => {
  const user = c.get('user')
  const data = await c.env.DB.prepare(
    `SELECT * FROM daily_meals WHERE hospital_id = ? AND meal_date = ?`
  ).bind(user.hospitalId, c.req.param('date')).first<any>()

  return c.json(data || {
    meal_date: c.req.param('date'),
    breakfast_patient: 0, breakfast_staff: 0, breakfast_noncovered: 0, breakfast_guardian: 0,
    lunch_patient: 0, lunch_staff: 0, lunch_noncovered: 0, lunch_guardian: 0,
    dinner_patient: 0, dinner_staff: 0, dinner_noncovered: 0, dinner_guardian: 0
  })
})

// 식수 저장
meals.post('/save', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const body = await c.req.json()
  const { mealDate, ...mealData } = body

  await c.env.DB.prepare(
    `INSERT INTO daily_meals 
     (hospital_id, meal_date, 
      breakfast_patient, breakfast_staff, breakfast_noncovered, breakfast_guardian,
      lunch_patient, lunch_staff, lunch_noncovered, lunch_guardian,
      dinner_patient, dinner_staff, dinner_noncovered, dinner_guardian)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(hospital_id, meal_date) DO UPDATE SET
     breakfast_patient = excluded.breakfast_patient,
     breakfast_staff = excluded.breakfast_staff,
     breakfast_noncovered = excluded.breakfast_noncovered,
     breakfast_guardian = excluded.breakfast_guardian,
     lunch_patient = excluded.lunch_patient,
     lunch_staff = excluded.lunch_staff,
     lunch_noncovered = excluded.lunch_noncovered,
     lunch_guardian = excluded.lunch_guardian,
     dinner_patient = excluded.dinner_patient,
     dinner_staff = excluded.dinner_staff,
     dinner_noncovered = excluded.dinner_noncovered,
     dinner_guardian = excluded.dinner_guardian,
     updated_at = CURRENT_TIMESTAMP`
  ).bind(
    hospitalId, mealDate,
    mealData.breakfastPatient || 0, mealData.breakfastStaff || 0,
    mealData.breakfastNoncovered || 0, mealData.breakfastGuardian || 0,
    mealData.lunchPatient || 0, mealData.lunchStaff || 0,
    mealData.lunchNoncovered || 0, mealData.lunchGuardian || 0,
    mealData.dinnerPatient || 0, mealData.dinnerStaff || 0,
    mealData.dinnerNoncovered || 0, mealData.dinnerGuardian || 0
  ).run()

  return c.json({ success: true })
})

export default meals
