import { Hono } from 'hono'

const meals = new Hono<{ Bindings: { DB: D1Database } }>()

// ─── 커스텀 식수 필드 목록 조회 ────────────────────────────────
meals.get('/custom-fields', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const data = await c.env.DB.prepare(
    `SELECT * FROM meal_custom_fields
     WHERE hospital_id = ? AND is_active = 1
     ORDER BY sort_order, id`
  ).bind(hospitalId).all<any>()
  return c.json(data.results)
})

// ─── 커스텀 식수 필드 생성 ────────────────────────────────────
meals.post('/custom-fields', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const { fieldName, unitType } = await c.req.json()
  if (!fieldName?.trim()) return c.json({ error: '이름을 입력하세요' }, 400)
  // unitType: 'meal' (식수에 포함) 또는 'ea' (개/ea, 식수 미포함)
  const unit = (unitType === 'ea') ? 'ea' : 'meal'

  // 기존 필드 수 확인 (최대 10개)
  const count = await c.env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM meal_custom_fields WHERE hospital_id = ? AND is_active = 1`
  ).bind(hospitalId).first<any>()
  if ((count?.cnt || 0) >= 10) return c.json({ error: '커스텀 칸은 최대 10개까지 가능합니다' }, 400)

  // 고유 key 생성
  const existing = await c.env.DB.prepare(
    `SELECT field_key FROM meal_custom_fields WHERE hospital_id = ? ORDER BY id`
  ).bind(hospitalId).all<any>()
  const usedKeys = new Set(existing.results.map((r: any) => r.field_key))
  let fieldKey = ''
  for (let i = 1; i <= 20; i++) {
    const k = `custom${i}`
    if (!usedKeys.has(k)) { fieldKey = k; break }
  }

  const sortOrder = count?.cnt || 0
  await c.env.DB.prepare(
    `INSERT INTO meal_custom_fields (hospital_id, field_key, field_name, sort_order, is_active, unit_type)
     VALUES (?, ?, ?, ?, 1, ?)`
  ).bind(hospitalId, fieldKey, fieldName.trim(), sortOrder, unit).run()

  const newField = await c.env.DB.prepare(
    `SELECT * FROM meal_custom_fields WHERE hospital_id = ? AND field_key = ?`
  ).bind(hospitalId, fieldKey).first<any>()
  return c.json(newField)
})

// ─── 커스텀 식수 필드 삭제(비활성화) ─────────────────────────
meals.delete('/custom-fields/:id', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare(
    `UPDATE meal_custom_fields SET is_active = 0 WHERE id = ? AND hospital_id = ?`
  ).bind(id, hospitalId).run()
  return c.json({ success: true })
})

// ─── 커스텀 식수 필드 이름 수정 ──────────────────────────────
meals.put('/custom-fields/:id', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const id = Number(c.req.param('id'))
  const { fieldName, unitType } = await c.req.json()
  if (!fieldName?.trim()) return c.json({ error: '이름을 입력하세요' }, 400)
  const unit = (unitType === 'ea') ? 'ea' : 'meal'
  await c.env.DB.prepare(
    `UPDATE meal_custom_fields SET field_name = ?, unit_type = ? WHERE id = ? AND hospital_id = ?`
  ).bind(fieldName.trim(), unit, id, hospitalId).run()
  return c.json({ success: true })
})

// ─── 공통 헬퍼: admin은 query param hospitalId, 일반 사용자는 user.hospitalId
function getHospId(user: any, c: any): number {
  if (user.role === 'admin' || user.role === 'hq') {
    const qId = c.req.query('hospitalId')
    return qId ? Number(qId) : Number(user.hospitalId)
  }
  return Number(user.hospitalId)
}

// ─── 월별 식수 조회 (환자군 자동 반영 포함) ───────────────────────
meals.get('/:year/:month', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospId(user, c)
  const { year, month } = c.req.param()

  // 환자군 목록 조회
  const patientCats = await c.env.DB.prepare(
    `SELECT * FROM hospital_patient_categories WHERE hospital_id = ? AND is_active = 1 ORDER BY sort_order, id`
  ).bind(hospitalId).all<any>()

  // 환자군 → meal_custom_fields 자동 동기화
  // category_key를 field_key로 사용 (예: cancer → cancer, nursing → nursing)
  const cats = patientCats.results || []
  for (const cat of cats) {
    const fieldKey = `cat_${cat.category_key}`
    const existing = await c.env.DB.prepare(
      `SELECT id FROM meal_custom_fields WHERE hospital_id = ? AND field_key = ?`
    ).bind(hospitalId, fieldKey).first<any>()
    if (!existing) {
      await c.env.DB.prepare(
        `INSERT INTO meal_custom_fields (hospital_id, field_key, field_name, sort_order, is_active, unit_type)
         VALUES (?, ?, ?, ?, 1, 'meal')`
      ).bind(hospitalId, fieldKey, cat.category_name, cat.sort_order || 99).run()
    } else {
      // 이름 동기화
      await c.env.DB.prepare(
        `UPDATE meal_custom_fields SET field_name = ?, is_active = 1 WHERE hospital_id = ? AND field_key = ?`
      ).bind(cat.category_name, hospitalId, fieldKey).run()
    }
  }

  const [mealData, customFields, dietCats] = await Promise.all([
    c.env.DB.prepare(
      `SELECT * FROM daily_meals
       WHERE hospital_id = ?
         AND strftime('%Y', meal_date) = ?
         AND strftime('%m', meal_date) = printf('%02d', ?)
       ORDER BY meal_date`
    ).bind(hospitalId, year, month).all<any>(),
    c.env.DB.prepare(
      `SELECT * FROM meal_custom_fields WHERE hospital_id = ? AND is_active = 1 ORDER BY sort_order, id`
    ).bind(hospitalId).all<any>(),
    c.env.DB.prepare(
      `SELECT * FROM diet_categories WHERE hospital_id = ? AND is_active = 1 AND show_in_input = 1 ORDER BY parent_type, sort_order, id`
    ).bind(hospitalId).all<any>()
  ])

  return c.json({
    meals: mealData.results,
    customFields: customFields.results,
    patientCategories: cats,
    dietCategories: dietCats.results || []
  })
})

// ─── 특정 날짜 식수 조회 ──────────────────────────────────────
meals.get('/date/:date', async (c) => {
  const user = c.get('user')
  const data = await c.env.DB.prepare(
    `SELECT * FROM daily_meals WHERE hospital_id = ? AND meal_date = ?`
  ).bind(user.hospitalId, c.req.param('date')).first<any>()

  return c.json(data || {
    meal_date: c.req.param('date'),
    breakfast_patient: 0, breakfast_staff: 0, breakfast_noncovered: 0, breakfast_guardian: 0,
    lunch_patient: 0, lunch_staff: 0, lunch_noncovered: 0, lunch_guardian: 0,
    dinner_patient: 0, dinner_staff: 0, dinner_noncovered: 0, dinner_guardian: 0,
    custom_data: '{}'
  })
})

// ─── 식수 저장 (커스텀 필드 포함) ────────────────────────────
meals.post('/save', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const body = await c.req.json()
  const { mealDate, customData, ...mealData } = body

  // customData: { custom1: {bf:5, l:3, d:2}, custom2: {bf:1, l:0, d:1} }
  const customJson = JSON.stringify(customData || {})

  await c.env.DB.prepare(
    `INSERT INTO daily_meals 
     (hospital_id, meal_date, 
      breakfast_patient, breakfast_staff, breakfast_noncovered, breakfast_guardian,
      lunch_patient, lunch_staff, lunch_noncovered, lunch_guardian,
      dinner_patient, dinner_staff, dinner_noncovered, dinner_guardian,
      custom_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
     custom_data = excluded.custom_data,
     updated_at = CURRENT_TIMESTAMP`
  ).bind(
    hospitalId, mealDate,
    mealData.breakfastPatient || 0, mealData.breakfastStaff || 0,
    mealData.breakfastNoncovered || 0, mealData.breakfastGuardian || 0,
    mealData.lunchPatient || 0, mealData.lunchStaff || 0,
    mealData.lunchNoncovered || 0, mealData.lunchGuardian || 0,
    mealData.dinnerPatient || 0, mealData.dinnerStaff || 0,
    mealData.dinnerNoncovered || 0, mealData.dinnerGuardian || 0,
    customJson
  ).run()

  return c.json({ success: true })
})

export default meals
