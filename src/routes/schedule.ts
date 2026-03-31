import { Hono } from 'hono'

const schedule = new Hono<{ Bindings: { DB: D1Database } }>()

// ════════════════════════════════════════════════════════════════
// 헬퍼: 권한 체크
// ════════════════════════════════════════════════════════════════
function isAdmin(user: any) { return user?.role === 'admin' }
function isNutritionist(user: any) { return user?.role === 'hospital' || user?.role === 'admin' }
function getHospitalId(user: any, paramHospitalId?: string): number {
  if (isAdmin(user) && paramHospitalId) return parseInt(paramHospitalId)
  return user.hospitalId
}

// ════════════════════════════════════════════════════════════════
// 헬퍼: 근무시간 자동계산 (스케줄 기반)
// ════════════════════════════════════════════════════════════════

/** 시간 문자열 "HH:MM" → 분 */
function timeToMinutes(t: string): number {
  if (!t) return 0
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}

/** 근무시간 계산 결과 */
interface WorkHourCalc {
  basicHours: number      // 기본 근무시간 (휴게 제외)
  otHours: number         // 연장근로 (기본 8h 초과분)
  nightHours: number      // 야간근로 (22:00-06:00 구간)
  isHolidayWork: boolean  // 휴일 근무 여부
  holidayHours: number    // 휴일 근무시간
}

/**
 * shift의 start_time/end_time 기반으로 근무시간 계산
 * - 기본 근무시간: 총 근무 - 휴게(1h 이상 시)
 * - OT: 기본 근무시간 중 8h 초과분
 * - 야간: 22:00~06:00(익일) 구간
 * - 휴일: 토/일/공휴일 여부
 */
function calcWorkHours(
  startTime: string, endTime: string,
  workDate: string, holidays: Set<string>
): WorkHourCalc {
  if (!startTime || !endTime) {
    return { basicHours:8, otHours:0, nightHours:0, isHolidayWork:false, holidayHours:0 }
  }

  const startMin = timeToMinutes(startTime)
  let endMin     = timeToMinutes(endTime)
  if (endMin <= startMin) endMin += 24 * 60  // 자정 넘김 처리

  const totalMin = endMin - startMin
  const breakMin = totalMin >= 480 ? 60 : totalMin >= 240 ? 30 : 0  // 8h이상→1h, 4h이상→30min
  const workMin  = totalMin - breakMin
  const basicH   = workMin / 60
  const otH      = Math.max(0, basicH - 8)

  // 야간 구간 계산 (22:00=1320분, 06:00+24h=1800분)
  const nightStart = 22 * 60        // 1320
  const nightEnd   = (6 + 24) * 60  // 1800
  let nightMin = 0
  // 근무 구간과 야간 구간 교집합
  const overlapStart = Math.max(startMin, nightStart)
  const overlapEnd   = Math.min(endMin, nightEnd)
  if (overlapEnd > overlapStart) nightMin += overlapEnd - overlapStart
  // 새벽 0~6 구간도 포함 (startMin < 6*60 케이스)
  if (startMin < 6 * 60) {
    nightMin += Math.max(0, Math.min(endMin, 6*60) - startMin)
  }
  const nightH = nightMin / 60

  // 휴일 여부 (토=6, 일=0)
  const dow = new Date(workDate).getDay()
  const isHolidayWork = dow === 0 || dow === 6 || holidays.has(workDate)
  const holidayH = isHolidayWork ? basicH : 0

  return {
    basicHours:    Math.round(basicH   * 100) / 100,
    otHours:       Math.round(otH      * 100) / 100,
    nightHours:    Math.round(nightH   * 100) / 100,
    isHolidayWork,
    holidayHours:  Math.round(holidayH * 100) / 100
  }
}

/**
 * 직원의 한 달 스케줄에서 주휴수당 대상 주 계산
 * 주 15h 이상 개근(결근 없음)한 주에 주휴수당 1일분 발생
 */
function calcWeeklyHolidayPay(dailyMap: Record<string, number>, year: number, month: number): number {
  // 해당 월의 모든 주를 순회
  const firstDay = new Date(year, month - 1, 1)
  const lastDay  = new Date(year, month, 0)
  let weeklyHolidayDays = 0
  let weekStart = new Date(firstDay)
  // 월요일 기준 주
  const dow0 = firstDay.getDay()
  if (dow0 !== 1) {
    weekStart.setDate(firstDay.getDate() - ((dow0 + 6) % 7))
  }

  while (weekStart <= lastDay) {
    let weekHours = 0
    let weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 6) // 일요일
    for (let d = new Date(weekStart); d <= weekEnd; d.setDate(d.getDate() + 1)) {
      const ds = d.toISOString().slice(0, 10)
      weekHours += dailyMap[ds] || 0
    }
    if (weekHours >= 15) weeklyHolidayDays++
    weekStart.setDate(weekStart.getDate() + 7)
  }
  return weeklyHolidayDays
}

// ════════════════════════════════════════════════════════════════
// 직위(포지션) 관리
// ════════════════════════════════════════════════════════════════

// 직위 목록 조회 (공통 기본직위 + 해당병원 커스텀)
schedule.get('/positions', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const data = await c.env.DB.prepare(
    `SELECT * FROM employee_positions
     WHERE (hospital_id IS NULL OR hospital_id = ?) AND is_active = 1
     ORDER BY team, sort_order, id`
  ).bind(hospitalId).all<any>()
  return c.json(data.results)
})

// 커스텀 직위 추가 (영양사: 본인 병원, 관리자: 전체)
schedule.post('/positions', async (c) => {
  const user = c.get('user')
  const { name, team, sortOrder, hospitalId: bodyHospId } = await c.req.json()
  const hid = isAdmin(user) && bodyHospId ? bodyHospId : user.hospitalId
  if (!name || !team) return c.json({ error: '직위명과 팀은 필수입니다' }, 400)
  
  // 커스텀 직위의 sort_order: 기본직위(최대) + 100 이후
  const maxRow = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(sort_order), 0) as max_order FROM employee_positions WHERE hospital_id = ? AND team = ?`
  ).bind(hid, team).first<any>()
  const defaultMax = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(sort_order), 70) as max_order FROM employee_positions WHERE hospital_id IS NULL AND team = ?`
  ).bind(team).first<any>()
  const newOrder = sortOrder ?? Math.max((maxRow?.max_order || 0), (defaultMax?.max_order || 70)) + 10

  await c.env.DB.prepare(
    `INSERT INTO employee_positions (hospital_id, team, name, sort_order, is_default) VALUES (?, ?, ?, ?, 0)`
  ).bind(hid, team, name, newOrder).run()
  return c.json({ success: true })
})

// 커스텀 직위 수정 (sort_order 포함)
schedule.put('/positions/:id', async (c) => {
  const user = c.get('user')
  const { name, sortOrder } = await c.req.json()
  const hid = user.hospitalId
  const check = await c.env.DB.prepare(
    `SELECT * FROM employee_positions WHERE id = ? AND is_default = 0 AND (hospital_id = ? OR ? = 1)`
  ).bind(c.req.param('id'), hid, isAdmin(user) ? 1 : 0).first<any>()
  if (!check) return c.json({ error: '수정 권한이 없거나 기본 직위입니다' }, 403)
  
  await c.env.DB.prepare(
    `UPDATE employee_positions SET name = ?, sort_order = ? WHERE id = ?`
  ).bind(name ?? check.name, sortOrder ?? check.sort_order, c.req.param('id')).run()
  return c.json({ success: true })
})

// 커스텀 직위 삭제 (비활성화)
schedule.delete('/positions/:id', async (c) => {
  const user = c.get('user')
  const check = await c.env.DB.prepare(
    `SELECT * FROM employee_positions WHERE id = ? AND is_default = 0`
  ).bind(c.req.param('id')).first<any>()
  if (!check) return c.json({ error: '기본 직위는 삭제할 수 없습니다' }, 403)
  if (!isAdmin(user) && check.hospital_id !== user.hospitalId) return c.json({ error: '권한 없음' }, 403)
  
  await c.env.DB.prepare(
    `UPDATE employee_positions SET is_active = 0 WHERE id = ?`
  ).bind(c.req.param('id')).run()
  return c.json({ success: true })
})

// ════════════════════════════════════════════════════════════════
// 근무조(Shift) 설정
// ════════════════════════════════════════════════════════════════

schedule.get('/shifts', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const data = await c.env.DB.prepare(
    `SELECT * FROM schedule_shifts WHERE hospital_id = ? AND is_active = 1 ORDER BY sort_order, id`
  ).bind(hospitalId).all<any>()
  return c.json(data.results)
})

schedule.post('/shifts', async (c) => {
  const user = c.get('user')
  const { shiftCode, shiftName, startTime, endTime, color, team, hospitalId: bodyHospId } = await c.req.json()
  const hid = isAdmin(user) && bodyHospId ? bodyHospId : user.hospitalId
  if (!shiftCode || !shiftName) return c.json({ error: '코드와 이름은 필수입니다' }, 400)

  const maxRow = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(sort_order), 0) as max_order FROM schedule_shifts WHERE hospital_id = ?`
  ).bind(hid).first<any>()

  await c.env.DB.prepare(
    `INSERT INTO schedule_shifts (hospital_id, shift_code, shift_name, start_time, end_time, color, team, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(hospital_id, shift_code) DO UPDATE SET
       shift_name=excluded.shift_name, start_time=excluded.start_time,
       end_time=excluded.end_time, color=excluded.color, team=excluded.team`
  ).bind(hid, shiftCode, shiftName, startTime || '09:00', endTime || '18:00',
    color || '#3B82F6', team || null, (maxRow?.max_order || 0) + 10).run()
  return c.json({ success: true })
})

schedule.put('/shifts/:id', async (c) => {
  const user = c.get('user')
  const { shiftCode, shiftName, startTime, endTime, color, team, sortOrder } = await c.req.json()
  const hid = user.hospitalId
  const check = await c.env.DB.prepare(
    `SELECT * FROM schedule_shifts WHERE id = ? AND (hospital_id = ? OR ? = 1)`
  ).bind(c.req.param('id'), hid, isAdmin(user) ? 1 : 0).first<any>()
  if (!check) return c.json({ error: '권한이 없거나 존재하지 않는 근무조입니다' }, 403)

  await c.env.DB.prepare(
    `UPDATE schedule_shifts SET shift_code=?, shift_name=?, start_time=?, end_time=?, color=?, team=?, sort_order=?
     WHERE id=?`
  ).bind(shiftCode ?? check.shift_code, shiftName ?? check.shift_name,
    startTime ?? check.start_time, endTime ?? check.end_time,
    color ?? check.color, team ?? check.team, sortOrder ?? check.sort_order,
    c.req.param('id')).run()
  return c.json({ success: true })
})

schedule.delete('/shifts/:id', async (c) => {
  const user = c.get('user')
  const hid = user.hospitalId
  const check = await c.env.DB.prepare(
    `SELECT * FROM schedule_shifts WHERE id = ? AND (hospital_id = ? OR ? = 1)`
  ).bind(c.req.param('id'), hid, isAdmin(user) ? 1 : 0).first<any>()
  if (!check) return c.json({ error: '권한 없음' }, 403)

  await c.env.DB.prepare(`UPDATE schedule_shifts SET is_active = 0 WHERE id = ?`).bind(c.req.param('id')).run()
  return c.json({ success: true })
})

// ════════════════════════════════════════════════════════════════
// 직원(인사카드) 관리
// ════════════════════════════════════════════════════════════════

// 직원 목록 조회
// - 영양사: 본인 병원만, is_active=1
// - 관리자: hospitalId 쿼리로 필터 (없으면 전체)
schedule.get('/employees', async (c) => {
  const user = c.get('user')
  
  if (isAdmin(user)) {
    const hospitalId = c.req.query('hospitalId')
    let query: string
    let params: any[]
    if (hospitalId) {
      query = `SELECT e.*, p.name as position_name, p.team as position_team
               FROM employees e
               LEFT JOIN employee_positions p ON e.position_id = p.id
               WHERE e.hospital_id = ?
               ORDER BY e.team, p.sort_order, e.hire_date, e.name`
      params = [hospitalId]
    } else {
      query = `SELECT e.*, p.name as position_name, p.team as position_team,
                      h.name as hospital_name
               FROM employees e
               LEFT JOIN employee_positions p ON e.position_id = p.id
               LEFT JOIN hospitals h ON e.hospital_id = h.id
               ORDER BY e.hospital_id, e.team, p.sort_order, e.hire_date, e.name`
      params = []
    }
    const data = await c.env.DB.prepare(query).bind(...params).all<any>()
    return c.json(data.results)
  }
  
  // 영양사: 본인 병원 활성 직원만
  const data = await c.env.DB.prepare(
    `SELECT e.*, p.name as position_name, p.team as position_team
     FROM employees e
     LEFT JOIN employee_positions p ON e.position_id = p.id
     WHERE e.hospital_id = ? AND e.is_active = 1
     ORDER BY e.team, p.sort_order, e.hire_date, e.name`
  ).bind(user.hospitalId).all<any>()
  return c.json(data.results)
})

// 직원 단건 조회
schedule.get('/employees/:id', async (c) => {
  const user = c.get('user')
  const emp = await c.env.DB.prepare(
    `SELECT e.*, p.name as position_name, p.team as position_team
     FROM employees e
     LEFT JOIN employee_positions p ON e.position_id = p.id
     WHERE e.id = ?`
  ).bind(c.req.param('id')).first<any>()
  if (!emp) return c.json({ error: '직원을 찾을 수 없습니다' }, 404)
  if (!isAdmin(user) && emp.hospital_id !== user.hospitalId) return c.json({ error: '권한 없음' }, 403)
  return c.json(emp)
})

// 직원 추가
schedule.post('/employees', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const hid = isAdmin(user) && body.hospitalId ? body.hospitalId : user.hospitalId

  const {
    name, team, positionId, position, empNumber, birthDate, hireDate,
    employmentType, workParts, phone, email, address, emergencyContact, note,
    healthCertExpire, healthExamDate, healthExamStatus, annualLeaveTotal, sortOrder,
    salaryType, baseSalary, otEnabled, nightEnabled, holidayEnabled
  } = body

  if (!name) return c.json({ error: '이름은 필수입니다' }, 400)

  // sort_order 자동 계산
  let finalSortOrder = sortOrder
  if (finalSortOrder === undefined || finalSortOrder === null) {
    const maxRow = await c.env.DB.prepare(
      `SELECT COALESCE(MAX(sort_order), 0) as max_order FROM employees WHERE hospital_id = ?`
    ).bind(hid).first<any>()
    finalSortOrder = (maxRow?.max_order || 0) + 10
  }

  await c.env.DB.prepare(
    `INSERT INTO employees (
       hospital_id, name, team, position_id, position, emp_number, birth_date, hire_date,
       employment_type, work_parts, section, phone, email, address, emergency_contact,
       note, health_cert_expire, health_exam_date, health_exam_status,
       annual_leave_total, sort_order, is_active,
       salary_type, base_salary, ot_enabled, night_allowance_enabled, holiday_allowance_enabled
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
  ).bind(
    hid, name, team || 'cook', positionId || null, position || '',
    empNumber || '', birthDate || '', hireDate || '',
    employmentType || 'full', JSON.stringify(workParts || []),
    team || 'cook', phone || '', email || '', address || '', emergencyContact || '',
    note || '', healthCertExpire || '', healthExamDate || '',
    healthExamStatus || 'pending', annualLeaveTotal || 15, finalSortOrder,
    salaryType || 'monthly', baseSalary || 0,
    otEnabled ? 1 : 0, nightEnabled ? 1 : 0, holidayEnabled ? 1 : 0
  ).run()
  return c.json({ success: true })
})

// 직원 수정
schedule.put('/employees/:id', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()

  // 권한 체크
  const existing = await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(c.req.param('id')).first<any>()
  if (!existing) return c.json({ error: '직원을 찾을 수 없습니다' }, 404)
  if (!isAdmin(user) && existing.hospital_id !== user.hospitalId) return c.json({ error: '권한 없음' }, 403)

  const {
    name, team, positionId, position, empNumber, birthDate, hireDate, resignDate,
    employmentType, workParts, phone, email, address, emergencyContact, note,
    healthCertExpire, healthExamDate, healthExamStatus, annualLeaveTotal, sortOrder, isActive,
    salaryType, baseSalary, otEnabled, nightEnabled, holidayEnabled
  } = body

  await c.env.DB.prepare(
    `UPDATE employees SET
       name = ?, team = ?, position_id = ?, position = ?, emp_number = ?,
       birth_date = ?, hire_date = ?, resign_date = ?,
       employment_type = ?, work_parts = ?, section = ?,
       phone = ?, email = ?, address = ?, emergency_contact = ?, note = ?,
       health_cert_expire = ?, health_exam_date = ?, health_exam_status = ?,
       annual_leave_total = ?, sort_order = ?, is_active = ?,
       salary_type = ?, base_salary = ?, ot_enabled = ?,
       night_allowance_enabled = ?, holiday_allowance_enabled = ?,
       updated_at = datetime('now')
     WHERE id = ?`
  ).bind(
    name ?? existing.name,
    team ?? existing.team,
    positionId !== undefined ? positionId : existing.position_id,
    position ?? existing.position,
    empNumber ?? existing.emp_number,
    birthDate ?? existing.birth_date,
    hireDate ?? existing.hire_date,
    resignDate !== undefined ? resignDate : existing.resign_date,
    employmentType ?? existing.employment_type,
    workParts !== undefined ? JSON.stringify(workParts) : existing.work_parts,
    team ?? existing.team,
    phone ?? existing.phone,
    email ?? existing.email,
    address ?? existing.address,
    emergencyContact ?? existing.emergency_contact,
    note ?? existing.note,
    healthCertExpire ?? existing.health_cert_expire,
    healthExamDate ?? existing.health_exam_date,
    healthExamStatus ?? existing.health_exam_status,
    annualLeaveTotal ?? existing.annual_leave_total,
    sortOrder ?? existing.sort_order,
    isActive !== undefined ? isActive : existing.is_active,
    salaryType ?? existing.salary_type ?? 'monthly',
    baseSalary !== undefined ? baseSalary : (existing.base_salary ?? 0),
    otEnabled !== undefined ? (otEnabled ? 1 : 0) : (existing.ot_enabled ?? 0),
    nightEnabled !== undefined ? (nightEnabled ? 1 : 0) : (existing.night_allowance_enabled ?? 0),
    holidayEnabled !== undefined ? (holidayEnabled ? 1 : 0) : (existing.holiday_allowance_enabled ?? 0),
    c.req.param('id')
  ).run()
  return c.json({ success: true })
})

// 직원 비활성화(퇴사처리)
schedule.delete('/employees/:id', async (c) => {
  const user = c.get('user')
  const existing = await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(c.req.param('id')).first<any>()
  if (!existing) return c.json({ error: '직원을 찾을 수 없습니다' }, 404)
  if (!isAdmin(user) && existing.hospital_id !== user.hospitalId) return c.json({ error: '권한 없음' }, 403)

  const today = new Date().toISOString().slice(0, 10)
  await c.env.DB.prepare(
    `UPDATE employees SET is_active = 0, resign_date = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(today, c.req.param('id')).run()
  return c.json({ success: true })
})

// 보건증/검진 만료 임박 직원 목록 (D-10 경고, D-3 긴급)
schedule.get('/alerts/health', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const today = new Date()
  const d10 = new Date(today); d10.setDate(today.getDate() + 10)
  const d3 = new Date(today); d3.setDate(today.getDate() + 3)
  const todayStr = today.toISOString().slice(0, 10)
  const d10Str = d10.toISOString().slice(0, 10)
  const d3Str = d3.toISOString().slice(0, 10)

  const data = await c.env.DB.prepare(
    `SELECT id, name, team, position, health_cert_expire, health_exam_date, health_exam_status,
            CASE
              WHEN health_cert_expire != '' AND health_cert_expire < ? THEN 'expired'
              WHEN health_cert_expire != '' AND health_cert_expire <= ? THEN 'urgent'
              WHEN health_cert_expire != '' AND health_cert_expire <= ? THEN 'warning'
              ELSE 'ok'
            END as cert_status
     FROM employees
     WHERE hospital_id = ? AND is_active = 1
       AND (health_cert_expire != '' OR health_exam_status = 'pending')
     ORDER BY health_cert_expire`
  ).bind(todayStr, d3Str, d10Str, hospitalId).all<any>()
  return c.json(data.results)
})

// 연차 부여일수 자동 계산 (법정 기준)
schedule.get('/employees/:id/leave-calc', async (c) => {
  const user = c.get('user')
  const emp = await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(c.req.param('id')).first<any>()
  if (!emp) return c.json({ error: '직원을 찾을 수 없습니다' }, 404)
  if (!isAdmin(user) && emp.hospital_id !== user.hospitalId) return c.json({ error: '권한 없음' }, 403)

  const year = parseInt(c.req.query('year') || new Date().getFullYear().toString())
  if (!emp.hire_date) return c.json({ legalDays: 0, note: '입사일 미입력' })

  const hireDate = new Date(emp.hire_date)
  const targetStart = new Date(`${year}-01-01`)
  const diffMs = targetStart.getTime() - hireDate.getTime()
  const yearsWorked = diffMs / (365.25 * 24 * 3600 * 1000)

  let legalDays = 0
  let note = ''

  if (yearsWorked < 0) {
    // 아직 입사 전
    legalDays = 0; note = '해당연도 미입사'
  } else if (yearsWorked < 1) {
    // 1년 미만: 월 1일 (최대 11일)
    const hireYear = hireDate.getFullYear()
    const hireMonth = hireDate.getMonth() + 1
    if (hireYear === year) {
      const monthsInYear = 12 - hireMonth
      legalDays = Math.min(monthsInYear, 11)
    } else {
      legalDays = 11
    }
    note = '1년 미만: 월 1일 (최대 11일)'
  } else if (yearsWorked < 3) {
    legalDays = 15; note = '기본 15일'
  } else {
    // 3년 이후 2년마다 1일 추가 (최대 25일)
    const extra = Math.floor((yearsWorked - 1) / 2)
    legalDays = Math.min(15 + extra, 25)
    note = `${Math.floor(yearsWorked)}년차: ${legalDays}일`
  }

  return c.json({ legalDays, note, yearsWorked: Math.round(yearsWorked * 10) / 10 })
})

// 연차 촉진 알림 목록
// - 연차 미부여 직원 (employee_leaves 레코드 없음)
// - 잔여 연차 > 0 이면서 연도 말까지 사용 권장 구간 진입 직원
//   · 10월 이후: 잔여 5일 이상 → 'encourage' (연차 사용 권장)
//   · 11월 이후: 잔여 3일 이상 → 'urgent' (연차 촉진)
//   · 12월:      잔여 1일 이상 → 'critical' (연차 소멸 위험)
//   · 연중 모두: 연차 소진율 0% (부여됐지만 하루도 안 씀, 입사 6개월+ ) → 'none_used'
schedule.get('/alerts/leave', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const year = parseInt(c.req.query('year') || new Date().getFullYear().toString())
  const today = new Date()
  const currentMonth = today.getMonth() + 1  // 1~12

  // 해당 병원 활성 직원 + 해당 연도 연차 정보 LEFT JOIN
  const emps = await c.env.DB.prepare(
    `SELECT e.id, e.name, e.team, e.position, e.hire_date, e.employment_type,
            e.annual_leave_total,
            l.total_days, l.used_days, l.leave_type
     FROM employees e
     LEFT JOIN employee_leaves l
       ON l.employee_id = e.id AND l.year = ? AND l.leave_type = 'annual'
     WHERE e.hospital_id = ? AND e.is_active = 1
       AND e.employment_type IN ('full','contract')
     ORDER BY e.team, e.hire_date`
  ).bind(year, hospitalId).all<any>()

  const alerts: any[] = []

  for (const emp of emps.results) {
    // 입사일 없으면 skip
    if (!emp.hire_date) continue

    const hireDate = new Date(emp.hire_date)
    // 해당연도 기준 근속 개월 계산
    const yearStart = new Date(`${year}-01-01`)
    const yearEnd   = new Date(`${year}-12-31`)
    const diffMonths = (today.getTime() - hireDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44)

    // 입사 3개월 미만이면 skip (연차 촉진 대상 아님)
    if (diffMonths < 3) continue

    // 법정 연차 계산 (leave-calc 로직 재사용)
    const yearsWorked = (yearStart.getTime() - hireDate.getTime()) / (365.25 * 24 * 3600 * 1000)
    let legalDays = 0
    if (yearsWorked < 0) {
      // 당해 입사: 입사월 이후 월 1일
      const hireYear = hireDate.getFullYear()
      const hireMonth = hireDate.getMonth() + 1
      if (hireYear === year) {
        legalDays = Math.min(12 - hireMonth, 11)
      } else {
        legalDays = 11
      }
    } else if (yearsWorked < 3) {
      legalDays = 15
    } else {
      legalDays = Math.min(15 + Math.floor((yearsWorked - 1) / 2), 25)
    }

    const totalDays = emp.total_days ?? legalDays   // 수동 설정 or 법정 계산
    const usedDays  = emp.used_days ?? 0
    const remaining = Math.max(totalDays - usedDays, 0)
    const isAssigned = emp.total_days != null         // employee_leaves 레코드 존재 여부
    const useRate = totalDays > 0 ? usedDays / totalDays : 0

    let alertLevel: string | null = null
    let alertMsg = ''

    // ① 연차 미부여 (레코드 없음, 법정 연차 > 0)
    if (!isAssigned && legalDays > 0) {
      alertLevel = 'not_assigned'
      alertMsg = `연차 ${legalDays}일 미부여`
    }
    // ② 연도말 촉진 구간
    else if (remaining > 0) {
      if (currentMonth === 12) {
        alertLevel = 'critical'
        alertMsg = `잔여 ${remaining}일 · 12월 연차 소멸 위험`
      } else if (currentMonth >= 11 && remaining >= 3) {
        alertLevel = 'urgent'
        alertMsg = `잔여 ${remaining}일 · 연차 촉진 필요`
      } else if (currentMonth >= 10 && remaining >= 5) {
        alertLevel = 'encourage'
        alertMsg = `잔여 ${remaining}일 · 연차 사용 권장`
      }
    }
    // ③ 연중 미사용 (부여 후 6개월 경과, 소진율 0%)
    if (!alertLevel && isAssigned && totalDays > 0 && usedDays === 0 && diffMonths >= 6) {
      alertLevel = 'none_used'
      alertMsg = `${totalDays}일 부여 후 미사용`
    }

    if (alertLevel) {
      alerts.push({
        id: emp.id,
        name: emp.name,
        team: emp.team,
        position: emp.position,
        hire_date: emp.hire_date,
        employment_type: emp.employment_type,
        legal_days: legalDays,
        total_days: totalDays,
        used_days: usedDays,
        remaining_days: remaining,
        is_assigned: isAssigned,
        alert_level: alertLevel,
        alert_msg: alertMsg
      })
    }
  }

  // 정렬: critical → urgent → not_assigned → encourage → none_used
  const ORDER: Record<string, number> = {
    critical: 0, urgent: 1, not_assigned: 2, encourage: 3, none_used: 4
  }
  alerts.sort((a, b) => (ORDER[a.alert_level] ?? 9) - (ORDER[b.alert_level] ?? 9))

  return c.json(alerts)
})

// ════════════════════════════════════════════════════════════════
// 연차/휴가 관리
// ════════════════════════════════════════════════════════════════

schedule.get('/employees/:id/leaves', async (c) => {
  const user = c.get('user')
  const emp = await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(c.req.param('id')).first<any>()
  if (!emp) return c.json({ error: '직원을 찾을 수 없습니다' }, 404)
  if (!isAdmin(user) && emp.hospital_id !== user.hospitalId) return c.json({ error: '권한 없음' }, 403)

  const year = c.req.query('year') || new Date().getFullYear()
  const data = await c.env.DB.prepare(
    `SELECT * FROM employee_leaves WHERE employee_id = ? AND year = ? ORDER BY leave_type`
  ).bind(c.req.param('id'), year).all<any>()
  return c.json(data.results)
})

schedule.post('/employees/:id/leaves', async (c) => {
  const user = c.get('user')
  if (!isAdmin(user)) return c.json({ error: '관리자만 연차를 수동 설정할 수 있습니다' }, 403)
  const emp = await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(c.req.param('id')).first<any>()
  if (!emp) return c.json({ error: '직원을 찾을 수 없습니다' }, 404)

  const { year, leaveType, totalDays, usedDays, note } = await c.req.json()
  await c.env.DB.prepare(
    `INSERT INTO employee_leaves (hospital_id, employee_id, year, leave_type, total_days, used_days, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(hospital_id, employee_id, year, leave_type) DO UPDATE SET
       total_days = excluded.total_days, used_days = excluded.used_days, note = excluded.note,
       updated_at = datetime('now')`
  ).bind(emp.hospital_id, c.req.param('id'), year, leaveType || 'annual', totalDays || 0, usedDays || 0, note || '').run()
  return c.json({ success: true })
})

// ════════════════════════════════════════════════════════════════
// 스케줄 (기존 + 확장)
// ════════════════════════════════════════════════════════════════

// 월별 스케줄 조회 (직위 포함, 정렬: 팀→직위순→입사일→이름)
schedule.get('/:year/:month', async (c) => {
  const user = c.get('user')
  const { year, month } = c.req.param()
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))

  const employees = await c.env.DB.prepare(
    `SELECT e.*, p.name as position_name, p.sort_order as position_sort
     FROM employees e
     LEFT JOIN employee_positions p ON e.position_id = p.id
     WHERE e.hospital_id = ? AND e.is_active = 1
     ORDER BY e.team, COALESCE(p.sort_order, 999), e.hire_date, e.name`
  ).bind(hospitalId).all<any>()

  const paddedMonth = String(month).padStart(2, '0')

  const [schedRows, shiftRows, holidayRows, leaveRows, subRows, extWorkerRows, extSchedRows] = await Promise.all([
    // 해당 월 스케줄
    c.env.DB.prepare(
      `SELECT s.employee_id, s.work_date, s.shift_code, s.leave_type,
              s.is_overtime, s.overtime_hours, s.is_night_work,
              s.is_temp_staff, s.temp_type, s.temp_hours,
              sh.shift_name, sh.start_time, sh.end_time, sh.color as shift_color
       FROM daily_schedules s
       LEFT JOIN schedule_shifts sh ON s.shift_id = sh.id
       WHERE s.hospital_id = ?
         AND strftime('%Y', s.work_date) = ?
         AND strftime('%m', s.work_date) = printf('%02d', ?)
       ORDER BY s.employee_id, s.work_date`
    ).bind(hospitalId, year, month).all<any>(),

    // 근무조 설정
    c.env.DB.prepare(
      `SELECT * FROM schedule_shifts WHERE hospital_id = ? AND is_active = 1 ORDER BY sort_order`
    ).bind(hospitalId).all<any>(),

    // 공휴일
    c.env.DB.prepare(
      `SELECT holiday_date, name as holiday_name FROM holidays WHERE holiday_date LIKE ?`
    ).bind(`${year}-${paddedMonth}-%`).all<any>(),

    // 연차·휴가 정보 (해당 연도)
    c.env.DB.prepare(
      `SELECT employee_id, leave_type, total_days, used_days
       FROM employee_leaves
       WHERE hospital_id = ? AND year = ?`
    ).bind(hospitalId, year).all<any>(),

    // 대체휴무
    c.env.DB.prepare(
      `SELECT off_date, off_name FROM substitute_off_days
       WHERE (hospital_id IS NULL OR hospital_id = ?) AND off_date LIKE ?`
    ).bind(hospitalId, `${year}-${paddedMonth}-%`).all<any>(),

    // 외부인력 마스터 (활성만)
    c.env.DB.prepare(
      `SELECT * FROM external_workers WHERE hospital_id=? AND is_active=1
       ORDER BY worker_type, name`
    ).bind(hospitalId).all<any>(),

    // 외부인력 해당 월 스케줄
    c.env.DB.prepare(
      `SELECT s.*, w.name as worker_name, w.worker_type
       FROM external_schedules s
       JOIN external_workers w ON s.worker_id=w.id
       WHERE s.hospital_id=? AND s.work_date LIKE ?
       ORDER BY w.worker_type, w.name, s.work_date`
    ).bind(hospitalId, `${year}-${paddedMonth}-%`).all<any>()
  ])

  // schedMap: { "empId_YYYY-MM-DD": { shift_code, leave_type, ... } }
  const schedMap: Record<string, any> = {}
  for (const s of (schedRows.results || [])) {
    const key = `${s.employee_id}_${s.work_date}`
    schedMap[key] = s
  }

  // leaveMap: { empId: { annual: {total, used}, ... } }
  const leaveMap: Record<number, Record<string, { total: number; used: number }>> = {}
  for (const l of (leaveRows.results || [])) {
    if (!leaveMap[l.employee_id]) leaveMap[l.employee_id] = {}
    leaveMap[l.employee_id][l.leave_type] = { total: l.total_days, used: l.used_days }
  }

  // 외부인력 스케줄 맵: { "workerId_date": schedule }
  const extSchedMap: Record<string, any> = {}
  for (const s of (extSchedRows.results || [])) {
    extSchedMap[`${s.worker_id}_${s.work_date}`] = s
  }

  return c.json({
    employees:        employees.results || [],
    sched_map:        schedMap,
    shifts:           shiftRows.results || [],
    holidays:         holidayRows.results || [],
    leave_map:        leaveMap,
    substitute_days:  subRows.results || [],
    external_workers: extWorkerRows.results || [],
    ext_sched_map:    extSchedMap
  })
})

// ════════════════════════════════════════════════════════════════
// 헬퍼: 스케줄 저장 시 근무시간 자동 계산 후 DB 업서트
// ════════════════════════════════════════════════════════════════
async function upsertScheduleWithCalc(
  db: D1Database,
  hospitalId: number,
  employeeId: number,
  workDate: string,
  shiftCode: string,
  shiftId: number | null,
  leaveType: string | null,
  isOvertime: boolean,
  overtimeHours: number,
  isTempStaff: boolean,
  isNightWork: boolean,
  tempType: string | null,
  tempHours: number,
  note: string | null
) {
  const REST_CODES = new Set(['휴','연','경조','병가','반차','대체'])

  // shiftId가 있을 때 근무시간 자동 계산
  let basicWorkHours = 0
  let nightWorkHours = 0
  let holidayWorkHours = 0
  let weeklyHolidayPay = 0
  let calcOtHours = overtimeHours
  let calcIsNight = isNightWork

  if (shiftId && !leaveType && !REST_CODES.has(shiftCode)) {
    const shift = await db.prepare(
      `SELECT start_time, end_time FROM schedule_shifts WHERE id=?`
    ).bind(shiftId).first<any>()

    if (shift?.start_time && shift?.end_time) {
      // 공휴일 목록 로드 (해당 월)
      const yearMonth = workDate.substring(0, 7)
      const holidays = await db.prepare(
        `SELECT holiday_date FROM holidays WHERE holiday_date LIKE ?`
      ).bind(`${yearMonth}-%`).all<any>()
      const holidaySet = new Set((holidays.results || []).map((h: any) => h.holiday_date))

      const calc = calcWorkHours(shift.start_time, shift.end_time, workDate, holidaySet as Set<string>)
      basicWorkHours    = calc.basicHours
      calcOtHours       = overtimeHours > 0 ? overtimeHours : calc.otHours
      nightWorkHours    = calc.nightHours
      calcIsNight       = calc.nightHours > 0 || isNightWork
      holidayWorkHours  = calc.holidayHours
    }
  }

  await db.prepare(
    `INSERT INTO daily_schedules
       (hospital_id, employee_id, work_date, shift_code, shift_id, leave_type,
        is_overtime, overtime_hours, is_temp_staff, is_night_work, temp_type, temp_hours, note,
        basic_work_hours, night_work_hours, holiday_work_hours, weekly_holiday_pay)
     VALUES (?,?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?,?)
     ON CONFLICT(hospital_id, employee_id, work_date) DO UPDATE SET
       shift_code=excluded.shift_code, shift_id=excluded.shift_id,
       leave_type=excluded.leave_type,
       is_overtime=excluded.is_overtime, overtime_hours=excluded.overtime_hours,
       is_temp_staff=excluded.is_temp_staff, is_night_work=excluded.is_night_work,
       temp_type=excluded.temp_type, temp_hours=excluded.temp_hours,
       note=excluded.note,
       basic_work_hours=excluded.basic_work_hours,
       night_work_hours=excluded.night_work_hours,
       holiday_work_hours=excluded.holiday_work_hours,
       weekly_holiday_pay=excluded.weekly_holiday_pay,
       updated_at=CURRENT_TIMESTAMP`
  ).bind(
    hospitalId, employeeId, workDate, shiftCode || '', shiftId,
    leaveType || null, isOvertime ? 1 : 0, calcOtHours, isTempStaff ? 1 : 0,
    calcIsNight ? 1 : 0, tempType || null, tempHours || 0, note || null,
    basicWorkHours, nightWorkHours, holidayWorkHours, weeklyHolidayPay
  ).run()
}

// 스케줄 저장 (upsert)
schedule.post('/save', async (c) => {
  const user = c.get('user')
  const { employeeId, workDate, shiftCode, shiftId, leaveType,
          isOvertime, overtimeHours, isTempStaff, isNightWork, tempType, tempHours, note } = await c.req.json()

  // 영양사는 본인 병원만
  const emp = await c.env.DB.prepare(`SELECT hospital_id FROM employees WHERE id = ?`).bind(employeeId).first<any>()
  if (!emp) return c.json({ error: '직원을 찾을 수 없습니다' }, 404)
  if (!isAdmin(user) && emp.hospital_id !== user.hospitalId) return c.json({ error: '권한 없음' }, 403)

  await upsertScheduleWithCalc(
    c.env.DB, emp.hospital_id, employeeId, workDate,
    shiftCode, shiftId || null, leaveType,
    !!isOvertime, overtimeHours || 0,
    !!isTempStaff, !!isNightWork, tempType || null, tempHours || 0, note || null
  )
  return c.json({ success: true })
})

// 스케줄 일괄 저장 (배치)
schedule.post('/save-batch', async (c) => {
  const user = c.get('user')
  const { items } = await c.req.json()
  if (!Array.isArray(items) || items.length === 0) return c.json({ success: true, count: 0 })

  // 병원별 직원 캐시 (반복 조회 최소화)
  const empCache: Record<number, any> = {}

  let count = 0
  for (const item of items) {
    const { employeeId, workDate, shiftCode, shiftId, leaveType,
            isOvertime, overtimeHours, isTempStaff, isNightWork, tempType, tempHours, note } = item

    if (!empCache[employeeId]) {
      const e = await c.env.DB.prepare(`SELECT hospital_id FROM employees WHERE id = ?`).bind(employeeId).first<any>()
      if (!e) continue
      empCache[employeeId] = e
    }
    const emp = empCache[employeeId]
    if (!isAdmin(user) && emp.hospital_id !== user.hospitalId) continue

    await upsertScheduleWithCalc(
      c.env.DB, emp.hospital_id, employeeId, workDate,
      shiftCode, shiftId || null, leaveType,
      !!isOvertime, overtimeHours || 0,
      !!isTempStaff, !!isNightWork, tempType || null, tempHours || 0, note || null
    )
    count++
  }
  return c.json({ success: true, count })
})


// external-workers/:id DELETE (/:employeeId/:workDate 라우트 충돌 방지용 선등록)
schedule.delete('/external-workers/:id', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, undefined)
  const id = c.req.param('id')

  const row = await c.env.DB.prepare(
    `SELECT hospital_id FROM external_workers WHERE id=?`
  ).bind(id).first<any>()
  if (!row) return c.json({ error: '외부인력을 찾을 수 없습니다' }, 404)
  if (!isAdmin(user) && row.hospital_id !== hospitalId) return c.json({ error: '권한 없음' }, 403)

  const hasSchedule = await c.env.DB.prepare(
    `SELECT id FROM external_schedules WHERE worker_id=? LIMIT 1`
  ).bind(id).first<any>()

  if (hasSchedule) {
    await c.env.DB.prepare(
      `UPDATE external_workers SET is_active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(id).run()
    return c.json({ success: true, deactivated: true })
  } else {
    await c.env.DB.prepare(`DELETE FROM external_workers WHERE id=?`).bind(id).run()
    return c.json({ success: true, deleted: true })
  }
})

// 스케줄 삭제
schedule.delete('/:employeeId/:workDate', async (c) => {
  const user = c.get('user')
  const emp = await c.env.DB.prepare(`SELECT hospital_id FROM employees WHERE id = ?`).bind(c.req.param('employeeId')).first<any>()
  if (!emp) return c.json({ error: '직원을 찾을 수 없습니다' }, 404)
  if (!isAdmin(user) && emp.hospital_id !== user.hospitalId) return c.json({ error: '권한 없음' }, 403)

  await c.env.DB.prepare(
    `DELETE FROM daily_schedules WHERE hospital_id=? AND employee_id=? AND work_date=?`
  ).bind(emp.hospital_id, c.req.param('employeeId'), c.req.param('workDate')).run()
  return c.json({ success: true })
})

// ════════════════════════════════════════════════════════════════
// 공휴일 관리
// ════════════════════════════════════════════════════════════════

schedule.get('/holidays/:year', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const data = await c.env.DB.prepare(
    `SELECT * FROM holidays
     WHERE (hospital_id IS NULL OR hospital_id = ?)
       AND holiday_date LIKE ?
     ORDER BY holiday_date`
  ).bind(hospitalId, `${c.req.param('year')}-%`).all<any>()
  return c.json(data.results)
})

schedule.post('/holidays', async (c) => {
  if (!isAdmin(c.get('user'))) return c.json({ error: '관리자 전용' }, 403)
  const { holidayDate, holidayName, holidayType, hospitalId } = await c.req.json()
  if (!holidayDate) return c.json({ error: '날짜는 필수입니다' }, 400)
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO holidays (hospital_id, holiday_date, holiday_name, holiday_type)
     VALUES (?, ?, ?, ?)`
  ).bind(hospitalId || null, holidayDate, holidayName || '', holidayType || 'national').run()
  return c.json({ success: true })
})

schedule.delete('/holidays/:id', async (c) => {
  if (!isAdmin(c.get('user'))) return c.json({ error: '관리자 전용' }, 403)
  await c.env.DB.prepare(`DELETE FROM holidays WHERE id = ?`).bind(c.req.param('id')).run()
  return c.json({ success: true })
})

// ════════════════════════════════════════════════════════════════
// 최소인원 설정 (관리자 전용)
// ════════════════════════════════════════════════════════════════

schedule.get('/min-staff', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const data = await c.env.DB.prepare(
    `SELECT ms.*, p.name as position_name FROM schedule_min_staff ms
     LEFT JOIN employee_positions p ON ms.position_id = p.id
     WHERE ms.hospital_id = ?`
  ).bind(hospitalId).all<any>()
  return c.json(data.results)
})

schedule.post('/min-staff', async (c) => {
  if (!isAdmin(c.get('user'))) return c.json({ error: '관리자 전용' }, 403)
  const { hospitalId, positionId, team, minCount, note } = await c.req.json()
  await c.env.DB.prepare(
    `INSERT INTO schedule_min_staff (hospital_id, position_id, team, min_count, note)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(hospital_id, position_id, team) DO UPDATE SET min_count=excluded.min_count, note=excluded.note`
  ).bind(hospitalId, positionId || null, team || null, minCount || 1, note || '').run()
  return c.json({ success: true })
})

// ════════════════════════════════════════════════════════════════
// 월별 부여휴무 API
// ════════════════════════════════════════════════════════════════
//
// [개념]
//  ① 부여휴무 (granted_off): 토요일 + 일요일 + 공휴일 (자동 계산)
//  ② 대체휴무 (substitute_off): 임시공휴일·대체공휴일 → 수동 등록
//
// GET  /off-grants?year=&month=   → 해당 월 부여휴무(자동) + 대체휴무 목록
// POST /off-grants/substitute     → 대체휴무 추가 (관리자만)
// DELETE /off-grants/substitute/:date → 대체휴무 삭제 (관리자만)
// ════════════════════════════════════════════════════════════════

schedule.get('/off-grants', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const year  = parseInt(c.req.query('year')  || new Date().getFullYear().toString())
  const month = parseInt(c.req.query('month') || (new Date().getMonth() + 1).toString())

  // ─── 해당 월의 공휴일 조회 (전국 공통) ────────────────────────
  const monthStr = String(month).padStart(2, '0')
  const prefix   = `${year}-${monthStr}`

  const holidayRows = await c.env.DB.prepare(
    `SELECT holiday_date, name as holiday_name
     FROM holidays
     WHERE holiday_date LIKE ?
     ORDER BY holiday_date`
  ).bind(`${prefix}-%`).all<any>()

  const nationalHolidayDates = new Set(
    (holidayRows.results || []).map((h: any) => h.holiday_date)
  )

  // ─── 해당 월 날짜별 자동 계산 ────────────────────────────────
  const daysInMonth = new Date(year, month, 0).getDate()
  const grantedDays: { date: string; day_of_week: string; type: string; label: string }[] = []

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month - 1, d)
    const dow = dateObj.getDay()   // 0=일, 6=토
    const dateStr = `${year}-${monthStr}-${String(d).padStart(2, '0')}`
    const DOW_LABEL = ['일', '월', '화', '수', '목', '금', '토']

    const isNationalHoliday = nationalHolidayDates.has(dateStr)
    // 공휴일이 이미 일/토이면 중복 제외
    if (dow === 0) {
      grantedDays.push({ date: dateStr, day_of_week: '일', type: 'sunday', label: '일요일' })
    } else if (dow === 6) {
      grantedDays.push({ date: dateStr, day_of_week: '토', type: 'saturday', label: '토요일' })
    } else if (isNationalHoliday) {
      const h = (holidayRows.results || []).find((r: any) => r.holiday_date === dateStr)
      grantedDays.push({ date: dateStr, day_of_week: DOW_LABEL[dow], type: 'holiday', label: h?.holiday_name || '공휴일' })
    }
  }

  // ─── 대체휴무 조회 ────────────────────────────────────────────
  const subRows = await c.env.DB.prepare(
    `SELECT * FROM substitute_off_days
     WHERE (hospital_id IS NULL OR hospital_id = ?)
       AND off_date LIKE ?
     ORDER BY off_date`
  ).bind(hospitalId, `${prefix}-%`).all<any>()

  const substituteDays = (subRows.results || []).map((r: any) => ({
    id:         r.id,
    date:       r.off_date,
    name:       r.off_name,
    reason:     r.off_reason || '',
    hospital_id: r.hospital_id,
    created_by: r.created_by || ''
  }))

  // ─── 요약 집계 ────────────────────────────────────────────────
  const summary = {
    total_granted:    grantedDays.length,
    sundays:          grantedDays.filter(d => d.type === 'sunday').length,
    saturdays:        grantedDays.filter(d => d.type === 'saturday').length,
    national_holidays: grantedDays.filter(d => d.type === 'holiday').length,
    substitute_count: substituteDays.length,
    grand_total:      grantedDays.length + substituteDays.length
  }

  return c.json({
    year, month,
    granted_days:    grantedDays,
    substitute_days: substituteDays,
    summary
  })
})

// 대체휴무 추가 (관리자만)
schedule.post('/off-grants/substitute', async (c) => {
  const user = c.get('user')
  if (!isAdmin(user)) return c.json({ error: '관리자 전용' }, 403)

  const { offDate, offName, offReason, hospitalId: reqHospId } = await c.req.json()
  if (!offDate) return c.json({ error: '날짜는 필수입니다' }, 400)

  const hid = reqHospId ? parseInt(reqHospId) : null  // null = 전체 공통

  await c.env.DB.prepare(
    `INSERT INTO substitute_off_days (hospital_id, off_date, off_name, off_reason, created_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(hospital_id, off_date) DO UPDATE SET
       off_name   = excluded.off_name,
       off_reason = excluded.off_reason,
       created_by = excluded.created_by`
  ).bind(hid, offDate, offName || '대체휴무', offReason || '', user.username || '').run()

  return c.json({ success: true })
})

// 대체휴무 삭제 (관리자만)
schedule.delete('/off-grants/substitute/:id', async (c) => {
  if (!isAdmin(c.get('user'))) return c.json({ error: '관리자 전용' }, 403)
  await c.env.DB.prepare(`DELETE FROM substitute_off_days WHERE id = ?`)
    .bind(c.req.param('id')).run()
  return c.json({ success: true })
})

// ════════════════════════════════════════════════════════════════
// 운영 분석 API (9번 요청사항)
// ════════════════════════════════════════════════════════════════

// 월별 운영 분석 데이터
schedule.get('/analysis/:year/:month', async (c) => {
  const user = c.get('user')
  const { year, month } = c.req.param()
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const paddedMonth = String(month).padStart(2, '0')

  const [schedRows, empRows, minStaffRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT s.*, e.name as emp_name, e.team, p.name as position_name
       FROM daily_schedules s
       LEFT JOIN employees e ON s.employee_id = e.id
       LEFT JOIN employee_positions p ON e.position_id = p.id
       WHERE s.hospital_id = ?
         AND strftime('%Y', s.work_date) = ?
         AND strftime('%m', s.work_date) = printf('%02d', ?)
       ORDER BY s.work_date, e.team, s.employee_id`
    ).bind(hospitalId, year, month).all<any>(),

    c.env.DB.prepare(
      `SELECT e.*, p.name as position_name
       FROM employees e
       LEFT JOIN employee_positions p ON e.position_id = p.id
       WHERE e.hospital_id = ? AND e.is_active = 1`
    ).bind(hospitalId).all<any>(),

    c.env.DB.prepare(
      `SELECT ms.*, p.name as position_name FROM schedule_min_staff ms
       LEFT JOIN employee_positions p ON ms.position_id = p.id
       WHERE ms.hospital_id = ?`
    ).bind(hospitalId).all<any>()
  ])

  const scheds = schedRows.results || []
  const emps   = empRows.results   || []
  const minStaff = minStaffRows.results || []

  // 날짜별 집계
  const dateMap: Record<string, {
    work: number, rest: number, annual: number, halfAM: number, halfPM: number,
    event: number, ot: number, tempStaff: number, alba: number,
    byPosition: Record<string, number>
  }> = {}

  for (const s of scheds) {
    const d = s.work_date
    if (!dateMap[d]) dateMap[d] = { work:0, rest:0, annual:0, halfAM:0, halfPM:0, event:0, ot:0, tempStaff:0, alba:0, byPosition:{} }
    const code = s.shift_code || ''
    const pos  = s.position_name || '기타'
    if (!dateMap[d].byPosition[pos]) dateMap[d].byPosition[pos] = 0

    if (code === '연')     { dateMap[d].annual++;  dateMap[d].rest++ }
    else if (code === '휴') dateMap[d].rest++
    else if (code === '오전') { dateMap[d].halfAM++; dateMap[d].rest++ }
    else if (code === '오후') { dateMap[d].halfPM++; dateMap[d].rest++ }
    else if (code === '경조') { dateMap[d].event++;  dateMap[d].rest++ }
    else if (code === 'OT')   { dateMap[d].ot++;     dateMap[d].work++; dateMap[d].byPosition[pos]++ }
    else if (s.is_temp_staff)  { dateMap[d].tempStaff++; dateMap[d].work++; dateMap[d].byPosition[pos]++ }
    else if (code && code !== '-') { dateMap[d].work++;  dateMap[d].byPosition[pos]++ }
  }

  // 월 전체 집계
  const monthly = {
    totalWork: 0, totalRest: 0, totalAnnual: 0, totalHalfAM: 0, totalHalfPM: 0,
    totalEvent: 0, totalOT: 0, totalTempStaff: 0,
    otByEmp: {} as Record<string, number>
  }
  for (const s of scheds) {
    const code = s.shift_code || ''
    if (code === '연') { monthly.totalAnnual++; monthly.totalRest++ }
    else if (code === '휴') monthly.totalRest++
    else if (code === '오전') { monthly.totalHalfAM++; monthly.totalRest++ }
    else if (code === '오후') { monthly.totalHalfPM++; monthly.totalRest++ }
    else if (code === '경조') { monthly.totalEvent++; monthly.totalRest++ }
    else if (code === 'OT')   { monthly.totalOT++;    monthly.totalWork++ }
    else if (s.is_temp_staff)  { monthly.totalTempStaff++; monthly.totalWork++ }
    else if (code && code !== '-') monthly.totalWork++

    if (s.overtime_hours > 0) {
      const empKey = s.emp_name || String(s.employee_id)
      monthly.otByEmp[empKey] = (monthly.otByEmp[empKey] || 0) + s.overtime_hours
    }
  }

  // 최소 인력 미달 날짜 감지
  const shortDates: Record<string, Array<{position: string, required: number, actual: number}>> = {}
  for (const [date, data] of Object.entries(dateMap)) {
    const shorts = []
    for (const ms of minStaff) {
      const actual = data.byPosition[ms.position_name] || 0
      if (actual < ms.min_count) {
        shorts.push({ position: ms.position_name, required: ms.min_count, actual })
      }
    }
    if (shorts.length > 0) shortDates[date] = shorts
  }

  // 연차/휴무 쏠림 감지 (같은 날 3명 이상 연차/휴무)
  const clusterDates: Record<string, {annual: number, rest: number, warning: boolean}> = {}
  for (const [date, data] of Object.entries(dateMap)) {
    if (data.annual >= 3 || data.rest >= 5) {
      clusterDates[date] = { annual: data.annual, rest: data.rest, warning: true }
    }
  }

  return c.json({
    year, month,
    date_map:    dateMap,
    monthly,
    short_dates: shortDates,
    cluster_dates: clusterDates,
    total_employees: emps.length
  })
})

// 직원별 연차 목록 (연도별)
schedule.get('/leaves/all', async (c) => {
  const user = c.get('user')
  const year = c.req.query('year') || new Date().getFullYear()
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))

  const rows = await c.env.DB.prepare(
    `SELECT l.*, e.name as emp_name, e.team, p.name as position_name, e.hire_date
     FROM employee_leaves l
     JOIN employees e ON l.employee_id = e.id
     LEFT JOIN employee_positions p ON e.position_id = p.id
     WHERE l.hospital_id = ? AND l.year = ?
     ORDER BY e.team, p.sort_order, e.hire_date, e.name`
  ).bind(hospitalId, year).all<any>()

  return c.json(rows.results || [])
})

// 식수 카테고리별 집계 (Admin & Operation용)
schedule.get('/meal-stats/:year/:month', async (c) => {
  const user = c.get('user')
  const { year, month } = c.req.param()
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const paddedMonth = String(month).padStart(2, '0')
  const datePattern = `${year}-${paddedMonth}-%`

  // 카테고리 목록
  const cats = await c.env.DB.prepare(
    `SELECT * FROM hospital_patient_categories WHERE hospital_id = ? AND is_active = 1 ORDER BY sort_order`
  ).bind(hospitalId).all<any>()

  // 해당 월 식수 데이터
  const meals = await c.env.DB.prepare(
    `SELECT * FROM daily_meals WHERE hospital_id = ? AND meal_date LIKE ? ORDER BY meal_date`
  ).bind(hospitalId, datePattern).all<any>()

  const catList = cats.results || []
  const mealList = meals.results || []

  // 카테고리별 집계
  const catStats: Record<string, { name: string, breakfast: number, lunch: number, dinner: number, total: number }> = {}
  for (const cat of catList) {
    catStats[cat.category_key] = { name: cat.category_name, breakfast: 0, lunch: 0, dinner: 0, total: 0 }
  }

  // 전통 필드 (직원식, 보호자식 등)
  const legacyStats = { staff: 0, guardian: 0, noncovered: 0, patient: 0 }

  for (const meal of mealList) {
    legacyStats.staff      += (meal.breakfast_staff    || 0) + (meal.lunch_staff    || 0) + (meal.dinner_staff    || 0)
    legacyStats.guardian   += (meal.breakfast_guardian || 0) + (meal.lunch_guardian || 0) + (meal.dinner_guardian || 0)
    legacyStats.noncovered += (meal.breakfast_noncovered||0) + (meal.lunch_noncovered||0) + (meal.dinner_noncovered||0)
    legacyStats.patient    += (meal.breakfast_patient  || 0) + (meal.lunch_patient  || 0) + (meal.dinner_patient  || 0)

    // custom_data 파싱
    if (meal.custom_data) {
      try {
        const cd = JSON.parse(meal.custom_data)
        for (const cat of catList) {
          const mealKeys: string[] = JSON.parse(cat.meals_include_keys || '[]')
          for (const mk of mealKeys) {
            if (cd[mk]) {
              if (!catStats[cat.category_key]) continue
              catStats[cat.category_key].breakfast += cd[mk].bf || 0
              catStats[cat.category_key].lunch     += cd[mk].l  || 0
              catStats[cat.category_key].dinner    += cd[mk].d  || 0
            }
          }
        }
      } catch { /* skip */ }
    }
  }

  // total 계산
  for (const key of Object.keys(catStats)) {
    const c2 = catStats[key]
    c2.total = c2.breakfast + c2.lunch + c2.dinner
  }

  return c.json({
    year, month,
    categories: catStats,
    legacy: legacyStats,
    total_days: mealList.length
  })
})

// 직원별 연차 일괄 수정
schedule.put('/employees/:id/leaves', async (c) => {
  const user = c.get('user')
  if (!isNutritionist(user)) return c.json({ error: '권한이 없습니다' }, 403)
  const emp = await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(c.req.param('id')).first<any>()
  if (!emp) return c.json({ error: '직원 없음' }, 404)
  // 영양사(hospital role)는 자기 병원 직원만 수정 가능
  if (!isAdmin(user) && emp.hospital_id !== user.hospitalId) return c.json({ error: '권한 없음' }, 403)

  const { year, totalDays, usedDays, note, carriedOverDays, allowancePaid, allowancePaidAt } = await c.req.json()

  // 수당 지급 처리: allowancePaid=true이면 이월연차를 0으로 리셋
  const finalCarriedOver = allowancePaid ? 0 : (carriedOverDays ?? 0)
  const paidAt = allowancePaid
    ? (allowancePaidAt || new Date().toISOString().slice(0, 10))
    : null

  await c.env.DB.prepare(
    `INSERT INTO employee_leaves (hospital_id, employee_id, year, leave_type, total_days, used_days, note, carried_over_days, allowance_paid, allowance_paid_at)
     VALUES (?, ?, ?, 'annual', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(hospital_id, employee_id, year, leave_type) DO UPDATE SET
       total_days = excluded.total_days, used_days = excluded.used_days,
       note = excluded.note,
       carried_over_days = excluded.carried_over_days,
       allowance_paid = excluded.allowance_paid,
       allowance_paid_at = excluded.allowance_paid_at,
       updated_at = datetime('now')`
  ).bind(emp.hospital_id, emp.id, year, totalDays, usedDays || 0, note || '', finalCarriedOver, allowancePaid ? 1 : 0, paidAt).run()

  return c.json({ success: true })
})

// ════════════════════════════════════════════════════════════════
// 스케줄 배치 복사 (주 단위 / 이전 주 → 현재 주 복사)
// ════════════════════════════════════════════════════════════════
schedule.post('/copy-week', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, undefined)
  const { fromStartDate, toStartDate } = await c.req.json()
  // fromStartDate: 복사 원본 주 월요일 (YYYY-MM-DD)
  // toStartDate: 붙여넣을 주 월요일 (YYYY-MM-DD)

  // 원본 주 7일치 스케줄 조회
  const from = new Date(fromStartDate)
  const dates: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(from)
    d.setDate(from.getDate() + i)
    dates.push(d.toISOString().split('T')[0])
  }

  const rows = await c.env.DB.prepare(
    `SELECT employee_id, work_date, shift_code, shift_id, leave_type, is_overtime, overtime_hours, is_temp_staff, temp_type, temp_hours, is_night_work, note
     FROM daily_schedules
     WHERE hospital_id = ? AND work_date IN (${dates.map(()=>'?').join(',')})` 
  ).bind(hospitalId, ...dates).all<any>()

  const srcMap: Record<string, any> = {}
  for (const r of (rows.results || [])) {
    const dow = new Date(r.work_date).getDay() // 0=일,1=월..
    srcMap[`${r.employee_id}_${dow}`] = r
  }

  // 대상 주에 붙여넣기
  const to = new Date(toStartDate)
  let count = 0
  for (let i = 0; i < 7; i++) {
    const d = new Date(to)
    d.setDate(to.getDate() + i)
    const targetDate = d.toISOString().split('T')[0]
    const dow = d.getDay()
    const empKeys = [...new Set((rows.results || []).map(r => r.employee_id))]
    for (const empId of empKeys) {
      const src = srcMap[`${empId}_${dow}`]
      if (!src) continue
      await c.env.DB.prepare(
        `INSERT INTO daily_schedules (hospital_id, employee_id, work_date, shift_code, shift_id, leave_type, is_overtime, overtime_hours, is_temp_staff, temp_type, temp_hours, is_night_work, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(hospital_id, employee_id, work_date) DO UPDATE SET
           shift_code=excluded.shift_code, shift_id=excluded.shift_id,
           leave_type=excluded.leave_type, is_overtime=excluded.is_overtime,
           overtime_hours=excluded.overtime_hours, is_temp_staff=excluded.is_temp_staff,
           temp_type=excluded.temp_type, temp_hours=excluded.temp_hours,
           is_night_work=excluded.is_night_work, note=excluded.note,
           updated_at=CURRENT_TIMESTAMP`
      ).bind(
        hospitalId, empId, targetDate, src.shift_code||'', src.shift_id||null,
        src.leave_type||null, src.is_overtime||0, src.overtime_hours||0,
        src.is_temp_staff||0, src.temp_type||null, src.temp_hours||0,
        src.is_night_work||0, src.note||null
      ).run()
      count++
    }
  }
  return c.json({ success: true, count })
})

// 스케줄 전체 초기화 (월)
schedule.delete('/clear-month/:year/:month', async (c) => {
  const user = c.get('user')
  if (!isAdmin(user)) return c.json({ error: '관리자만 가능합니다' }, 403)
  const hospitalId = getHospitalId(user, undefined)
  const { year, month } = c.req.param()
  const paddedMonth = String(month).padStart(2,'0')
  await c.env.DB.prepare(
    `DELETE FROM daily_schedules WHERE hospital_id=? AND work_date LIKE ?`
  ).bind(hospitalId, `${year}-${paddedMonth}-%`).run()
  return c.json({ success: true })
})

// ════════════════════════════════════════════════════════════════
// 개인별 상세 통계 (연차/OT/휴일근로 일별·주별·월별)
// ════════════════════════════════════════════════════════════════
schedule.get('/employees/:id/stats/:year/:month', async (c) => {
  const user = c.get('user')
  const empId = c.req.param('id')
  const { year, month } = c.req.param()
  const emp = await c.env.DB.prepare(
    `SELECT e.*, p.name as position_name FROM employees e
     LEFT JOIN employee_positions p ON e.position_id = p.id
     WHERE e.id = ?`
  ).bind(empId).first<any>()
  if (!emp) return c.json({ error: '직원 없음' }, 404)
  if (!isAdmin(user) && emp.hospital_id !== user.hospitalId) return c.json({ error: '권한 없음' }, 403)

  const paddedMonth = String(month).padStart(2,'0')

  const [schedRows, leaveRow, otSettings] = await Promise.all([
    c.env.DB.prepare(
      `SELECT s.*, sh.start_time, sh.end_time, sh.shift_name
       FROM daily_schedules s
       LEFT JOIN schedule_shifts sh ON s.shift_id = sh.id
       WHERE s.hospital_id=? AND s.employee_id=?
         AND s.work_date LIKE ?
       ORDER BY s.work_date`
    ).bind(emp.hospital_id, empId, `${year}-${paddedMonth}-%`).all<any>(),

    c.env.DB.prepare(
      `SELECT * FROM employee_leaves WHERE hospital_id=? AND employee_id=? AND year=? AND leave_type='annual'`
    ).bind(emp.hospital_id, empId, year).first<any>(),

    c.env.DB.prepare(
      `SELECT * FROM employee_ot_settings WHERE hospital_id=? AND employee_id=?`
    ).bind(emp.hospital_id, empId).first<any>()
  ])

  const scheds = schedRows.results || []
  const REST_CODES = new Set(['휴','연','경조','병가'])

  // 일별 집계
  const dailyMap: Record<string, {
    date: string, dow: string, code: string,
    workHours: number, otHours: number, isNight: boolean,
    isHoliday: boolean, isTempStaff: boolean, tempType: string|null, tempHours: number,
    otCost: number, nightCost: number
  }> = {}

  const hourlyWage  = otSettings?.hourly_wage  || 0
  const otRate      = otSettings?.ot_rate      || 1.5
  const nightRate   = otSettings?.night_rate   || 0.5
  const DAYS_KR = ['일','월','화','수','목','금','토']

  for (const s of scheds) {
    const d = new Date(s.work_date)
    const dow = DAYS_KR[d.getDay()]
    const isHoliday = ['토','일'].includes(dow)
    const workHours = s.overtime_hours > 0
      ? (s.shift_id ? 8 : 8) // 기본 근무시간 (추후 shift별로 계산 가능)
      : 0
    const otHours  = s.overtime_hours || 0
    const otCost   = hourlyWage > 0 ? Math.round(otHours * hourlyWage * otRate) : 0
    const nightCost= (s.is_night_work && hourlyWage > 0)
      ? Math.round(workHours * hourlyWage * nightRate) : 0

    dailyMap[s.work_date] = {
      date: s.work_date, dow,
      code: s.shift_code || '',
      workHours, otHours,
      isNight: !!s.is_night_work,
      isHoliday,
      isTempStaff: !!s.is_temp_staff,
      tempType: s.temp_type || null,
      tempHours: s.temp_hours || 0,
      otCost, nightCost
    }
  }

  // 주별 집계
  const weeklyStats: Array<{week: number, workDays: number, otHours: number, nightDays: number, annualDays: number, holidayWork: number, otCost: number, nightCost: number}> = []
  let wk = { week:1, workDays:0, otHours:0, nightDays:0, annualDays:0, holidayWork:0, otCost:0, nightCost:0 }
  const daysInMonth = new Date(parseInt(year), parseInt(month), 0).getDate()

  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${paddedMonth}-${String(d).padStart(2,'0')}`
    const dd = new Date(ds)
    const dow = DAYS_KR[dd.getDay()]
    const s = dailyMap[ds]
    if (s) {
      const code = s.code
      if (code === '연') wk.annualDays++
      else if (code && !REST_CODES.has(code)) {
        wk.workDays++
        if (s.isHoliday) wk.holidayWork++
        if (s.isNight) wk.nightDays++
        wk.otHours += s.otHours
        wk.otCost  += s.otCost
        wk.nightCost += s.nightCost
      }
    }
    if (dow === '일' || d === daysInMonth) {
      weeklyStats.push({ ...wk })
      wk = { week: wk.week+1, workDays:0, otHours:0, nightDays:0, annualDays:0, holidayWork:0, otCost:0, nightCost:0 }
    }
  }

  // 월 합계
  const monthly = {
    workDays:0, basicHours:0, otHours:0, nightDays:0, nightHours:0,
    holidayWork:0, holidayHours:0, annualDays:0,
    totalOtCost:0, totalNightCost:0, totalBasicHours:0
  }
  for (const v of Object.values(dailyMap) as any[]) {
    const code = v.code
    if (code === '연') monthly.annualDays++
    else if (code && !REST_CODES.has(code)) {
      monthly.workDays++
      monthly.totalBasicHours += v.workHours || 8
      if (v.isHoliday) { monthly.holidayWork++; monthly.holidayHours += v.workHours || 8 }
      if (v.isNight) { monthly.nightDays++; monthly.nightHours += 2 } // 야간 대략 2h
      monthly.otHours        += v.otHours
      monthly.totalOtCost    += v.otCost
      monthly.totalNightCost += v.nightCost
    }
  }

  return c.json({
    employee: emp, year, month,
    leaveInfo: leaveRow || null,
    otSettings: otSettings || null,
    daily: dailyMap,
    weekly: weeklyStats,
    monthly
  })
})

// ════════════════════════════════════════════════════════════════
// 인건비 단가 설정 CRUD
// ════════════════════════════════════════════════════════════════
schedule.get('/labor-costs', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const rows = await c.env.DB.prepare(
    `SELECT * FROM labor_cost_settings WHERE hospital_id=? ORDER BY cost_type`
  ).bind(hospitalId).all<any>()
  return c.json(rows.results || [])
})

schedule.post('/labor-costs', async (c) => {
  const user = c.get('user')
  if (!isAdmin(user) && user.role !== 'hospital') return c.json({ error: '권한이 없습니다' }, 403)
  const hospitalId = getHospitalId(user, undefined)
  const { cost_type, unit_price, description } = await c.req.json()
  await c.env.DB.prepare(
    `INSERT INTO labor_cost_settings (hospital_id, cost_type, unit_price, description)
     VALUES (?,?,?,?)
     ON CONFLICT(hospital_id, cost_type) DO UPDATE SET
       unit_price=excluded.unit_price, description=excluded.description,
       updated_at=datetime('now')`
  ).bind(hospitalId, cost_type, unit_price||0, description||'').run()
  return c.json({ success: true })
})

// 직원별 OT 설정
schedule.get('/employees/:id/ot-settings', async (c) => {
  const user = c.get('user')
  const empId = c.req.param('id')
  const emp = await c.env.DB.prepare(`SELECT * FROM employees WHERE id=?`).bind(empId).first<any>()
  if (!emp) return c.json({ error: '직원 없음' }, 404)
  const row = await c.env.DB.prepare(
    `SELECT * FROM employee_ot_settings WHERE hospital_id=? AND employee_id=?`
  ).bind(emp.hospital_id, empId).first<any>()
  return c.json(row || { hourly_wage:0, ot_rate:1.5, night_rate:0.5 })
})

schedule.post('/employees/:id/ot-settings', async (c) => {
  const user = c.get('user')
  if (!isAdmin(user)) return c.json({ error: '관리자만 가능합니다' }, 403)
  const empId = c.req.param('id')
  const emp = await c.env.DB.prepare(`SELECT * FROM employees WHERE id=?`).bind(empId).first<any>()
  if (!emp) return c.json({ error: '직원 없음' }, 404)
  const { hourly_wage, ot_rate, night_rate, note } = await c.req.json()
  await c.env.DB.prepare(
    `INSERT INTO employee_ot_settings (hospital_id, employee_id, hourly_wage, ot_rate, night_rate, note)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(hospital_id, employee_id) DO UPDATE SET
       hourly_wage=excluded.hourly_wage, ot_rate=excluded.ot_rate,
       night_rate=excluded.night_rate, note=excluded.note,
       updated_at=datetime('now')`
  ).bind(emp.hospital_id, empId, hourly_wage||0, ot_rate||1.5, night_rate||0.5, note||'').run()
  return c.json({ success: true })
})

// 인건비 월간 집계 (직원 + 외부인력 분리)
schedule.get('/labor-cost-report/:year/:month', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const { year, month } = c.req.param()
  const paddedMonth = String(month).padStart(2,'0')

  const [scheds, emps, otSettingsAll, laborCosts, holidayRows, extSchedRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT s.*, e.name as emp_name, e.team, e.salary_type, e.base_salary,
              e.ot_enabled, e.night_allowance_enabled, e.holiday_allowance_enabled,
              p.name as position_name
       FROM daily_schedules s
       JOIN employees e ON s.employee_id=e.id
       LEFT JOIN employee_positions p ON e.position_id=p.id
       WHERE s.hospital_id=? AND s.work_date LIKE ?
       ORDER BY e.team, s.employee_id, s.work_date`
    ).bind(hospitalId, `${year}-${paddedMonth}-%`).all<any>(),

    c.env.DB.prepare(
      `SELECT e.*, p.name as position_name FROM employees e
       LEFT JOIN employee_positions p ON e.position_id=p.id
       WHERE e.hospital_id=? AND e.is_active=1`
    ).bind(hospitalId).all<any>(),

    c.env.DB.prepare(
      `SELECT * FROM employee_ot_settings WHERE hospital_id=?`
    ).bind(hospitalId).all<any>(),

    c.env.DB.prepare(
      `SELECT * FROM labor_cost_settings WHERE hospital_id=?`
    ).bind(hospitalId).all<any>(),

    // 공휴일 목록
    c.env.DB.prepare(
      `SELECT holiday_date FROM holidays WHERE holiday_date LIKE ?`
    ).bind(`${year}-${paddedMonth}-%`).all<any>(),

    // 외부인력(external_workers 기반) 스케줄
    c.env.DB.prepare(
      `SELECT s.*, w.name as worker_name, w.worker_type
       FROM external_schedules s
       JOIN external_workers w ON s.worker_id=w.id
       WHERE s.hospital_id=? AND s.work_date LIKE ?
       ORDER BY w.worker_type, w.name, s.work_date`
    ).bind(hospitalId, `${year}-${paddedMonth}-%`).all<any>()
  ])

  const schedList     = scheds.results || []
  const empList       = emps.results || []
  const extSchedList  = extSchedRows.results || []
  const holidaySet    = new Set((holidayRows.results || []).map((h: any) => h.holiday_date))

  const otMap: Record<number, any> = {}
  ;(otSettingsAll.results||[]).forEach((o: any) => { otMap[o.employee_id] = o })
  const costMap: Record<string, number> = {}
  ;(laborCosts.results||[]).forEach((c2: any) => { costMap[c2.cost_type] = c2.unit_price })

  const REST_CODES = new Set(['휴','연','경조','병가','반차','대체'])

  // ─── 직원별 집계 ────────────────────────────────────────────
  type EmpStat = {
    emp: any
    workDays: number
    basicHours: number
    otHours: number
    nightHours: number
    holidayHours: number
    weeklyHolidayDays: number
    annualLeaveDays: number
    // 비용
    otCost: number
    nightCost: number
    holidayCost: number
    weeklyHolidayCost: number
    totalAddCost: number
  }

  const byEmp: Record<number, EmpStat> = {}
  for (const emp of empList) {
    byEmp[emp.id] = {
      emp,
      workDays: 0, basicHours: 0, otHours: 0, nightHours: 0,
      holidayHours: 0, weeklyHolidayDays: 0, annualLeaveDays: 0,
      otCost: 0, nightCost: 0, holidayCost: 0, weeklyHolidayCost: 0, totalAddCost: 0
    }
  }

  // 주휴수당 계산을 위한 일별 근무시간 맵 (empId → date → hours)
  const dailyHoursMap: Record<number, Record<string, number>> = {}

  for (const s of schedList) {
    const rec = byEmp[s.employee_id]
    if (!rec) continue

    const code = s.shift_code || ''
    const isLeave = !!s.leave_type
    if (isLeave) {
      if (s.leave_type === 'annual' || code === '연') rec.annualLeaveDays++
      continue
    }
    if (REST_CODES.has(code)) continue

    const ot = otMap[s.employee_id]
    const hourly    = ot?.hourly_wage || 0
    const otRate    = ot?.ot_rate   || 1.5
    const nightRate = ot?.night_rate || 0.5

    const dow = new Date(s.work_date).getDay()
    const isHoliday = dow === 0 || dow === 6 || holidaySet.has(s.work_date)

    // basic_work_hours가 저장돼 있으면 활용, 없으면 기본 8h
    const basicH   = s.basic_work_hours   > 0 ? s.basic_work_hours   : 8
    const otH      = s.overtime_hours     > 0 ? s.overtime_hours      : 0
    const nightH   = s.night_work_hours   > 0 ? s.night_work_hours    : (s.is_night_work ? 2 : 0)
    const holidayH = s.holiday_work_hours > 0 ? s.holiday_work_hours  : (isHoliday ? basicH : 0)

    rec.workDays++
    rec.basicHours    += basicH
    rec.otHours       += otH
    rec.nightHours    += nightH
    rec.holidayHours  += holidayH

    // 비용 계산 (직원 OT/야간/휴일 수당 활성화 여부 반영)
    if (otH > 0 && s.ot_enabled !== 0 && hourly > 0) {
      rec.otCost += Math.round(otH * hourly * otRate)
    }
    if (nightH > 0 && s.night_allowance_enabled !== 0 && hourly > 0) {
      rec.nightCost += Math.round(nightH * hourly * nightRate)
    }
    if (isHoliday && holidayH > 0 && s.holiday_allowance_enabled !== 0 && hourly > 0) {
      rec.holidayCost += Math.round(holidayH * hourly * 0.5) // 휴일수당 50%
    }

    // 주휴수당 계산용 일별 시간 누적
    if (!dailyHoursMap[s.employee_id]) dailyHoursMap[s.employee_id] = {}
    dailyHoursMap[s.employee_id][s.work_date] = basicH
  }

  // 주휴수당 계산
  for (const empId of Object.keys(byEmp).map(Number)) {
    const rec = byEmp[empId]
    const dmap = dailyHoursMap[empId] || {}
    const wdays = calcWeeklyHolidayPay(dmap, parseInt(year), parseInt(month))
    rec.weeklyHolidayDays = wdays
    const ot = otMap[empId]
    const hourly = ot?.hourly_wage || 0
    if (wdays > 0 && hourly > 0) {
      rec.weeklyHolidayCost = Math.round(wdays * 8 * hourly)
    }
    rec.totalAddCost = rec.otCost + rec.nightCost + rec.holidayCost + rec.weeklyHolidayCost
  }

  // ─── 외부인력 이름별 집계 (external_schedules 기반) ──────────
  const SHIFT_LABELS: Record<string, string> = {
    morning: '오전', afternoon: '오후', full_9h: '9시간', full_12h: '12시간'
  }

  function getExtUnitPrice(workerType: string, shiftType: string, override: number): number {
    if (override > 0) return override
    const wt = workerType === 'dispatch' ? 'dispatch' : 'parttime'
    // shiftType → costMap key 매핑
    const shiftKeyMap: Record<string, string> = {
      morning:   `${wt}_morning`,
      afternoon: `${wt}_afternoon`,
      full_9h:   `${wt}_9h`,
      full_12h:  `${wt}_12h`,
    }
    const key = shiftKeyMap[shiftType]
    if (key && costMap[key]) return costMap[key]
    // 알바는 시간당 단가 fallback
    if (wt === 'parttime' && costMap['parttime_hourly']) {
      const hours: Record<string, number> = { morning: 4, afternoon: 4, full_9h: 9, full_12h: 12 }
      return (costMap['parttime_hourly'] || 0) * (hours[shiftType] || 4)
    }
    return 0
  }

  type ExtWorkerStat = {
    workerId: number; workerName: string; workerType: string
    totalShifts: number; byShiftType: Record<string, number>
    totalCost: number; workDates: string[]
  }
  const byWorker: Record<number, ExtWorkerStat> = {}

  for (const s of extSchedList) {
    if (!byWorker[s.worker_id]) {
      byWorker[s.worker_id] = {
        workerId: s.worker_id, workerName: s.worker_name, workerType: s.worker_type,
        totalShifts: 0, byShiftType: {}, totalCost: 0, workDates: []
      }
    }
    const w = byWorker[s.worker_id]
    const price = getExtUnitPrice(s.worker_type, s.shift_type, s.unit_price || 0)
    w.totalShifts++
    w.byShiftType[s.shift_type] = (w.byShiftType[s.shift_type] || 0) + 1
    w.totalCost += price
    w.workDates.push(s.work_date)
  }

  const extStats         = Object.values(byWorker)
  const extDispatchStats = extStats.filter(w => w.workerType === 'dispatch')
  const extParttimeStats = extStats.filter(w => w.workerType === 'parttime')
  const extDispatchTotal = extDispatchStats.reduce((a, w) => a + w.totalCost, 0)
  const extParttimeTotal = extParttimeStats.reduce((a, w) => a + w.totalCost, 0)
  const extTotal         = extDispatchTotal + extParttimeTotal

  // ─── 합계 계산 ───────────────────────────────────────────────
  const empStats = Object.values(byEmp)
  const totalOtCost      = empStats.reduce((a, v) => a + v.otCost, 0)
  const totalNightCost   = empStats.reduce((a, v) => a + v.nightCost, 0)
  const totalHolidayCost = empStats.reduce((a, v) => a + v.holidayCost, 0)
  const totalWeeklyCost  = empStats.reduce((a, v) => a + v.weeklyHolidayCost, 0)
  const totalEmpAddCost  = empStats.reduce((a, v) => a + v.totalAddCost, 0)
  const grandTotal       = totalEmpAddCost + extTotal

  return c.json({
    year, month, hospitalId,
    // 직원 집계
    byEmployee: empStats,
    empTotals: {
      otCost: totalOtCost, nightCost: totalNightCost,
      holidayCost: totalHolidayCost, weeklyHolidayCost: totalWeeklyCost,
      totalAddCost: totalEmpAddCost
    },
    // 외부인력 이름별 집계
    byExtWorker: extStats,
    extDispatchWorkers: extDispatchStats,
    extParttimeWorkers: extParttimeStats,
    extDispatchTotal,
    extParttimeTotal,
    extTotal,
    // 전체 합계
    grandTotal,
    // 설정값
    costSettings: costMap,
    otSettings: otMap,
    shiftTypeLabels: SHIFT_LABELS
  })
})

// ════════════════════════════════════════════════════════════════
// 병원별 근무 설정 (법적 경고 기준 + 모듈 ON/OFF)
// ════════════════════════════════════════════════════════════════
const DEFAULT_WORK_SETTINGS: Record<string, string> = {
  daily_max_hours:          '8',
  weekly_max_hours:         '52',
  consecutive_max_days:     '6',
  leave_cluster_threshold:  '3',
  legal_warning_enabled:    '1',
  ot_cost_enabled:          '1',
  dispatch_enabled:         '1',
}

schedule.get('/work-settings', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const rows = await c.env.DB.prepare(
    `SELECT setting_key, setting_value FROM hospital_work_settings WHERE hospital_id=?`
  ).bind(hospitalId).all<any>()
  const map: Record<string, string> = { ...DEFAULT_WORK_SETTINGS }
  for (const r of (rows.results || [])) map[r.setting_key] = r.setting_value
  return c.json(map)
})

schedule.post('/work-settings', async (c) => {
  const user = c.get('user')
  if (!isAdmin(user)) return c.json({ error: '관리자만 가능합니다' }, 403)
  const hospitalId = getHospitalId(user, undefined)
  const body = await c.req.json()
  for (const [key, value] of Object.entries(body)) {
    await c.env.DB.prepare(
      `INSERT INTO hospital_work_settings (hospital_id, setting_key, setting_value)
       VALUES (?,?,?)
       ON CONFLICT(hospital_id, setting_key) DO UPDATE SET
         setting_value=excluded.setting_value, updated_at=datetime('now')`
    ).bind(hospitalId, key, String(value)).run()
  }
  return c.json({ success: true })
})

// ════════════════════════════════════════════════════════════════
// 연차 이력 (반차/경조사 등 세부 구분)
// ════════════════════════════════════════════════════════════════
schedule.get('/employees/:id/leave-history', async (c) => {
  const user = c.get('user')
  const empId = c.req.param('id')
  const year  = c.req.query('year') || new Date().getFullYear()
  const emp   = await c.env.DB.prepare(`SELECT * FROM employees WHERE id=?`).bind(empId).first<any>()
  if (!emp) return c.json({ error: '직원 없음' }, 404)
  if (!isAdmin(user) && emp.hospital_id !== user.hospitalId) return c.json({ error: '권한 없음' }, 403)
  const rows = await c.env.DB.prepare(
    `SELECT * FROM employee_leave_history
     WHERE hospital_id=? AND employee_id=? AND year=?
     ORDER BY leave_date`
  ).bind(emp.hospital_id, empId, year).all<any>()
  return c.json(rows.results || [])
})

schedule.post('/employees/:id/leave-history', async (c) => {
  const user = c.get('user')
  if (!isAdmin(user)) return c.json({ error: '관리자만 가능합니다' }, 403)
  const empId = c.req.param('id')
  const emp   = await c.env.DB.prepare(`SELECT * FROM employees WHERE id=?`).bind(empId).first<any>()
  if (!emp) return c.json({ error: '직원 없음' }, 404)
  const { leaveDate, leaveSubtype, note } = await c.req.json()
  const d = new Date(leaveDate)
  await c.env.DB.prepare(
    `INSERT INTO employee_leave_history
       (hospital_id, employee_id, year, month, leave_date, leave_subtype, note)
     VALUES (?,?,?,?,?,?,?)`
  ).bind(emp.hospital_id, empId, d.getFullYear(), d.getMonth()+1, leaveDate, leaveSubtype||'annual', note||'').run()
  return c.json({ success: true })
})

// 전체 직원 연차 이력 집계 (연차관리 탭용)
schedule.get('/leaves/history-summary', async (c) => {
  const user = c.get('user')
  const year = c.req.query('year') || new Date().getFullYear()
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const rows = await c.env.DB.prepare(
    `SELECT employee_id, leave_subtype, COUNT(*) as cnt
     FROM employee_leave_history
     WHERE hospital_id=? AND year=?
     GROUP BY employee_id, leave_subtype`
  ).bind(hospitalId, year).all<any>()
  // empId → { annual, half_am, half_pm, event, sick } 형태로 변환
  const summary: Record<number, Record<string, number>> = {}
  for (const r of (rows.results || [])) {
    if (!summary[r.employee_id]) summary[r.employee_id] = {}
    summary[r.employee_id][r.leave_subtype] = r.cnt
  }
  return c.json(summary)
})

// ════════════════════════════════════════════════════════════════
// dispatch_schedules – 파출/알바 외부인력 스케줄 관리
// ════════════════════════════════════════════════════════════════
// disp_type: 'morning'|'afternoon'|'fullday'|'parttime'
// GET  /dispatch?year=&month=
// POST /dispatch        { workDate, dispType, count, hours, unitPrice, memo }
// PUT  /dispatch/:id    { count, hours, unitPrice, memo }
// DELETE /dispatch/:id

schedule.get('/dispatch', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const year  = c.req.query('year')  || new Date().getFullYear()
  const month = c.req.query('month') || (new Date().getMonth() + 1)
  const paddedMonth = String(month).padStart(2, '0')

  const rows = await c.env.DB.prepare(
    `SELECT * FROM dispatch_schedules
     WHERE hospital_id=? AND work_date LIKE ?
     ORDER BY work_date, disp_type`
  ).bind(hospitalId, `${year}-${paddedMonth}-%`).all<any>()
  return c.json(rows.results || [])
})

schedule.post('/dispatch', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, undefined)
  const { workDate, dispType, count, hours, unitPrice, memo } = await c.req.json()
  if (!workDate || !dispType) return c.json({ error: '날짜와 유형은 필수입니다' }, 400)

  // 같은 날, 같은 타입이면 upsert
  const result = await c.env.DB.prepare(
    `INSERT INTO dispatch_schedules (hospital_id, work_date, disp_type, count, hours, unit_price, memo)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(hospital_id, work_date, disp_type) DO UPDATE SET
       count=excluded.count, hours=excluded.hours,
       unit_price=excluded.unit_price, memo=excluded.memo,
       updated_at=CURRENT_TIMESTAMP
     RETURNING id`
  ).bind(hospitalId, workDate, dispType, count||1, hours||0, unitPrice||0, memo||'').first<any>()
  return c.json({ success: true, id: result?.id })
})

schedule.put('/dispatch/:id', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, undefined)
  const id = c.req.param('id')
  const { count, hours, unitPrice, memo } = await c.req.json()

  const row = await c.env.DB.prepare(
    `SELECT hospital_id FROM dispatch_schedules WHERE id=?`
  ).bind(id).first<any>()
  if (!row) return c.json({ error: '데이터 없음' }, 404)
  if (!isAdmin(user) && row.hospital_id !== hospitalId) return c.json({ error: '권한 없음' }, 403)

  await c.env.DB.prepare(
    `UPDATE dispatch_schedules SET
       count=?, hours=?, unit_price=?, memo=?, updated_at=CURRENT_TIMESTAMP
     WHERE id=?`
  ).bind(count||1, hours||0, unitPrice||0, memo||'', id).run()
  return c.json({ success: true })
})

schedule.delete('/dispatch/:id', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, undefined)
  const id = c.req.param('id')

  const row = await c.env.DB.prepare(
    `SELECT hospital_id FROM dispatch_schedules WHERE id=?`
  ).bind(id).first<any>()
  if (!row) return c.json({ error: '데이터 없음' }, 404)
  if (!isAdmin(user) && row.hospital_id !== hospitalId) return c.json({ error: '권한 없음' }, 403)

  await c.env.DB.prepare(`DELETE FROM dispatch_schedules WHERE id=?`).bind(id).run()
  return c.json({ success: true })
})

// 월별 파출/알바 비용 집계
schedule.get('/dispatch/summary/:year/:month', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const { year, month } = c.req.param()
  const paddedMonth = String(month).padStart(2, '0')

  const rows = await c.env.DB.prepare(
    `SELECT disp_type,
            SUM(count) as total_count,
            SUM(hours) as total_hours,
            SUM(count * unit_price) as total_cost,
            COUNT(DISTINCT work_date) as work_days
     FROM dispatch_schedules
     WHERE hospital_id=? AND work_date LIKE ?
     GROUP BY disp_type`
  ).bind(hospitalId, `${year}-${paddedMonth}-%`).all<any>()

  const detail = await c.env.DB.prepare(
    `SELECT * FROM dispatch_schedules
     WHERE hospital_id=? AND work_date LIKE ?
     ORDER BY work_date, disp_type`
  ).bind(hospitalId, `${year}-${paddedMonth}-%`).all<any>()

  const summary = rows.results || []
  const grandTotal = summary.reduce((a: number, r: any) => a + (r.total_cost || 0), 0)

  return c.json({ summary, detail: detail.results || [], grandTotal, year, month })
})

// ════════════════════════════════════════════════════════════════
// 직원 급여형태 업데이트
// ════════════════════════════════════════════════════════════════
schedule.put('/employees/:id/salary', async (c) => {
  const user = c.get('user')
  if (!isAdmin(user)) return c.json({ error: '관리자만 가능합니다' }, 403)
  const empId = c.req.param('id')
  const { salaryType, baseSalary, otEnabled, nightEnabled, holidayEnabled } = await c.req.json()
  await c.env.DB.prepare(
    `UPDATE employees SET
       salary_type=?, base_salary=?, ot_enabled=?, night_allowance_enabled=?, holiday_allowance_enabled=?
     WHERE id=?`
  ).bind(salaryType||'monthly', baseSalary||0, otEnabled?1:0, nightEnabled?1:0, holidayEnabled?1:0, empId).run()
  return c.json({ success: true })
})

// ════════════════════════════════════════════════════════════════
// 외부인력 (파출/알바) 마스터 관리
// external_workers: 이름+타입 저장, 재사용 가능
// ════════════════════════════════════════════════════════════════

// 외부인력 목록 조회
schedule.get('/external-workers', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const includeInactive = c.req.query('all') === '1'

  const rows = await c.env.DB.prepare(
    `SELECT w.*,
       (SELECT COUNT(*) FROM external_schedules s WHERE s.worker_id=w.id) as total_shifts,
       (SELECT MAX(work_date) FROM external_schedules s WHERE s.worker_id=w.id) as last_work_date
     FROM external_workers w
     WHERE w.hospital_id=? ${includeInactive ? '' : 'AND w.is_active=1'}
     ORDER BY w.worker_type, w.name`
  ).bind(hospitalId).all<any>()
  return c.json(rows.results || [])
})

// 외부인력 생성
schedule.post('/external-workers', async (c) => {
  const user = c.get('user')
  const { name, workerType, memo, hospitalId: bodyHospId } = await c.req.json()
  const hospitalId = getHospitalId(user, bodyHospId ? String(bodyHospId) : c.req.query('hospitalId'))
  if (!name) return c.json({ error: '이름은 필수입니다' }, 400)
  if (!['dispatch', 'parttime'].includes(workerType || 'dispatch'))
    return c.json({ error: '유형은 dispatch 또는 parttime이어야 합니다' }, 400)

  const result = await c.env.DB.prepare(
    `INSERT INTO external_workers (hospital_id, name, worker_type, memo)
     VALUES (?,?,?,?) RETURNING id`
  ).bind(hospitalId, name.trim(), workerType || 'dispatch', memo || '').first<any>()
  return c.json({ success: true, id: result?.id })
})

// 외부인력 수정
schedule.put('/external-workers/:id', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, undefined)
  const id = c.req.param('id')
  const { name, workerType, memo, isActive } = await c.req.json()

  const row = await c.env.DB.prepare(
    `SELECT hospital_id FROM external_workers WHERE id=?`
  ).bind(id).first<any>()
  if (!row) return c.json({ error: '없음' }, 404)
  if (!isAdmin(user) && row.hospital_id !== hospitalId) return c.json({ error: '권한 없음' }, 403)

  await c.env.DB.prepare(
    `UPDATE external_workers SET
       name=COALESCE(?,name), worker_type=COALESCE(?,worker_type),
       memo=COALESCE(?,memo), is_active=COALESCE(?,is_active),
       updated_at=CURRENT_TIMESTAMP
     WHERE id=?`
  ).bind(name || null, workerType || null, memo ?? null,
         isActive !== undefined ? (isActive ? 1 : 0) : null, id).run()
  return c.json({ success: true })
})

// 외부인력 삭제 (스케줄이 있으면 비활성화만)
schedule.delete('/external-workers/:id', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, undefined)
  const id = c.req.param('id')

  const row = await c.env.DB.prepare(
    `SELECT hospital_id FROM external_workers WHERE id=?`
  ).bind(id).first<any>()
  if (!row) return c.json({ error: '없음' }, 404)
  if (!isAdmin(user) && row.hospital_id !== hospitalId) return c.json({ error: '권한 없음' }, 403)

  // 스케줄이 있으면 비활성화, 없으면 완전 삭제
  const hasSchedule = await c.env.DB.prepare(
    `SELECT id FROM external_schedules WHERE worker_id=? LIMIT 1`
  ).bind(id).first<any>()

  if (hasSchedule) {
    await c.env.DB.prepare(
      `UPDATE external_workers SET is_active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(id).run()
    return c.json({ success: true, deactivated: true })
  } else {
    await c.env.DB.prepare(`DELETE FROM external_workers WHERE id=?`).bind(id).run()
    return c.json({ success: true, deleted: true })
  }
})

// ════════════════════════════════════════════════════════════════
// 외부인력 스케줄 (external_schedules)
// ════════════════════════════════════════════════════════════════

// 월별 외부인력 스케줄 조회 (worker 정보 join)
schedule.get('/external-schedules', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const year  = c.req.query('year')  || new Date().getFullYear()
  const month = c.req.query('month') || (new Date().getMonth() + 1)
  const paddedMonth = String(month).padStart(2, '0')

  // 해당 월 스케줄 + 해당 월에 등록된 or 활성 인원 포함
  const [workers, schedules] = await Promise.all([
    c.env.DB.prepare(
      `SELECT * FROM external_workers WHERE hospital_id=? AND is_active=1
       ORDER BY worker_type, name`
    ).bind(hospitalId).all<any>(),

    c.env.DB.prepare(
      `SELECT s.*, w.name as worker_name, w.worker_type
       FROM external_schedules s
       JOIN external_workers w ON s.worker_id=w.id
       WHERE s.hospital_id=? AND s.work_date LIKE ?
       ORDER BY w.worker_type, w.name, s.work_date`
    ).bind(hospitalId, `${year}-${paddedMonth}-%`).all<any>()
  ])

  // schedMap: { "workerId_date": schedule }
  const schedMap: Record<string, any> = {}
  for (const s of (schedules.results || [])) {
    schedMap[`${s.worker_id}_${s.work_date}`] = s
  }

  return c.json({
    workers: workers.results || [],
    schedules: schedules.results || [],
    sched_map: schedMap
  })
})

// 외부인력 스케줄 저장 (upsert)
schedule.post('/external-schedules', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, undefined)
  const { workerId, workDate, shiftType, unitPrice, note } = await c.req.json()
  if (!workerId || !workDate || !shiftType)
    return c.json({ error: 'workerId, workDate, shiftType 필수' }, 400)

  const worker = await c.env.DB.prepare(
    `SELECT hospital_id FROM external_workers WHERE id=?`
  ).bind(workerId).first<any>()
  if (!worker) return c.json({ error: '외부인력 없음' }, 404)
  if (!isAdmin(user) && worker.hospital_id !== hospitalId) return c.json({ error: '권한 없음' }, 403)

  await c.env.DB.prepare(
    `INSERT INTO external_schedules (hospital_id, worker_id, work_date, shift_type, unit_price, note)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(hospital_id, worker_id, work_date) DO UPDATE SET
       shift_type=excluded.shift_type, unit_price=excluded.unit_price,
       note=excluded.note, updated_at=CURRENT_TIMESTAMP`
  ).bind(worker.hospital_id, workerId, workDate,
         shiftType, unitPrice || 0, note || '').run()
  return c.json({ success: true })
})

// 외부인력 스케줄 삭제
schedule.delete('/external-schedules/:workerId/:workDate', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, undefined)
  const { workerId, workDate } = c.req.param()

  const worker = await c.env.DB.prepare(
    `SELECT hospital_id FROM external_workers WHERE id=?`
  ).bind(workerId).first<any>()
  if (!worker) return c.json({ error: '없음' }, 404)
  if (!isAdmin(user) && worker.hospital_id !== hospitalId) return c.json({ error: '권한 없음' }, 403)

  await c.env.DB.prepare(
    `DELETE FROM external_schedules WHERE hospital_id=? AND worker_id=? AND work_date=?`
  ).bind(worker.hospital_id, workerId, workDate).run()
  return c.json({ success: true })
})

// 외부인력 스케줄 일괄 저장
schedule.post('/external-schedules/save-batch', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, undefined)
  const { items } = await c.req.json()
  if (!Array.isArray(items) || items.length === 0) return c.json({ success: true, count: 0 })

  const workerCache: Record<number, any> = {}
  let count = 0

  for (const item of items) {
    const { workerId, workDate, shiftType } = item
    if (!workerId || !workDate) continue

    if (!workerCache[workerId]) {
      const w = await c.env.DB.prepare(
        `SELECT hospital_id FROM external_workers WHERE id=? AND is_active=1`
      ).bind(workerId).first<any>()
      if (!w) continue
      workerCache[workerId] = w
    }
    const worker = workerCache[workerId]
    if (!isAdmin(user) && worker.hospital_id !== hospitalId) continue

    if (!shiftType) {
      // 빈 값이면 해당 날짜 스케줄 삭제
      await c.env.DB.prepare(
        `DELETE FROM external_schedules WHERE hospital_id=? AND worker_id=? AND work_date=?`
      ).bind(worker.hospital_id, workerId, workDate).run()
    } else {
      await c.env.DB.prepare(
        `INSERT INTO external_schedules (hospital_id, worker_id, work_date, shift_type, unit_price, note)
         VALUES (?,?,?,?,0,'')
         ON CONFLICT(hospital_id, worker_id, work_date) DO UPDATE SET
           shift_type=excluded.shift_type, updated_at=CURRENT_TIMESTAMP`
      ).bind(worker.hospital_id, workerId, workDate, shiftType).run()
    }
    count++
  }
  return c.json({ success: true, count })
})


// ════════════════════════════════════════════════════════════════
// 외부인력 인건비 집계 (이름별)
// ════════════════════════════════════════════════════════════════
schedule.get('/external-cost-report/:year/:month', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const { year, month } = c.req.param()
  const paddedMonth = String(month).padStart(2, '0')

  const SHIFT_TYPE_LABELS: Record<string, string> = {
    morning:   '오전', afternoon: '오후',
    full_9h:   '9시간', full_12h:  '12시간'
  }

  const [schedules, laborCosts] = await Promise.all([
    c.env.DB.prepare(
      `SELECT s.*, w.name as worker_name, w.worker_type
       FROM external_schedules s
       JOIN external_workers w ON s.worker_id=w.id
       WHERE s.hospital_id=? AND s.work_date LIKE ?
       ORDER BY w.worker_type, w.name, s.work_date`
    ).bind(hospitalId, `${year}-${paddedMonth}-%`).all<any>(),

    c.env.DB.prepare(
      `SELECT * FROM labor_cost_settings WHERE hospital_id=?`
    ).bind(hospitalId).all<any>()
  ])

  const costMap: Record<string, number> = {}
  ;(laborCosts.results || []).forEach((r: any) => { costMap[r.cost_type] = r.unit_price })

  // 단가 결정 함수
  function getUnitPrice(workerType: string, shiftType: string, overridePrice: number): number {
    if (overridePrice > 0) return overridePrice
    const key = `${workerType}_${shiftType}`  // e.g. dispatch_morning, parttime_full_9h
    // 호환 키: dispatch_9h → dispatch_full_9h
    const compatKey = shiftType === 'full_9h' ? `${workerType === 'dispatch' ? 'dispatch' : 'parttime'}_9h`
                    : shiftType === 'full_12h' ? `${workerType === 'dispatch' ? 'dispatch' : 'parttime'}_12h`
                    : null
    return costMap[key] || (compatKey ? costMap[compatKey] : 0) || 0
  }

  // 이름별 집계
  type WorkerStat = {
    workerId: number
    workerName: string
    workerType: string
    totalShifts: number
    byShiftType: Record<string, number>  // shiftType → count
    totalCost: number
    workDates: string[]
  }

  const byWorker: Record<number, WorkerStat> = {}

  for (const s of (schedules.results || [])) {
    if (!byWorker[s.worker_id]) {
      byWorker[s.worker_id] = {
        workerId: s.worker_id, workerName: s.worker_name,
        workerType: s.worker_type, totalShifts: 0,
        byShiftType: {}, totalCost: 0, workDates: []
      }
    }
    const stat = byWorker[s.worker_id]
    const unitPrice = getUnitPrice(s.worker_type, s.shift_type, s.unit_price || 0)
    stat.totalShifts++
    stat.byShiftType[s.shift_type] = (stat.byShiftType[s.shift_type] || 0) + 1
    stat.totalCost += unitPrice
    stat.workDates.push(s.work_date)
  }

  const workerStats = Object.values(byWorker)
  const dispatchStats  = workerStats.filter(w => w.workerType === 'dispatch')
  const parttimeStats  = workerStats.filter(w => w.workerType === 'parttime')
  const dispatchTotal  = dispatchStats.reduce((a, w) => a + w.totalCost, 0)
  const parttimeTotal  = parttimeStats.reduce((a, w) => a + w.totalCost, 0)

  return c.json({
    year, month,
    byWorker: workerStats,
    dispatchWorkers: dispatchStats,
    parttimeWorkers: parttimeStats,
    dispatchTotal,
    parttimeTotal,
    grandTotal: dispatchTotal + parttimeTotal,
    costSettings: costMap,
    shiftTypeLabels: SHIFT_TYPE_LABELS
  })
})

export default schedule
