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
               WHERE e.hospital_id = ? AND e.is_active = 1
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
  
  // 영양사: 본인 병원 활성 직원 + 당월 퇴사자 포함 (스케줄 히스토리 보존)
  const yearMonth = c.req.query('yearMonth') // 'YYYY-MM' 형태
  const ym = yearMonth || new Date().toISOString().slice(0, 7)
  const data = await c.env.DB.prepare(
    `SELECT e.*, p.name as position_name, p.team as position_team
     FROM employees e
     LEFT JOIN employee_positions p ON e.position_id = p.id
     WHERE e.hospital_id = ?
       AND (e.is_active = 1 OR (e.resign_date IS NOT NULL AND e.resign_date >= ?))
     ORDER BY e.team, p.sort_order, e.hire_date, e.name`
  ).bind(user.hospitalId, ym + '-01').all<any>()
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
    salaryType, baseSalary, otEnabled, nightEnabled, holidayEnabled,
    // 0057: 직원별 근무정책
    workType, scheduleType, workCycleStartDate, cycleWorkDays, cycleRestDays
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
       salary_type, base_salary, ot_enabled, night_allowance_enabled, holiday_allowance_enabled,
       work_type, schedule_type, work_cycle_start_date, cycle_work_days, cycle_rest_days
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    hid, name, team || 'cook', positionId || null, position || '',
    empNumber || '', birthDate || '', hireDate || '',
    employmentType || 'full', JSON.stringify(workParts || []),
    team || 'cook', phone || '', email || '', address || '', emergencyContact || '',
    note || '', healthCertExpire || '', healthExamDate || '',
    healthExamStatus || 'pending', annualLeaveTotal || 15, finalSortOrder,
    salaryType || 'monthly', baseSalary || 0,
    otEnabled ? 1 : 0, nightEnabled ? 1 : 0, holidayEnabled ? 1 : 0,
    // 0057: 직원별 근무정책 (NULL=병원설정 상속)
    workType || null,
    scheduleType || 'flexible',
    workCycleStartDate || null,
    cycleWorkDays !== undefined ? cycleWorkDays : null,
    cycleRestDays !== undefined ? cycleRestDays : null
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
    salaryType, baseSalary, otEnabled, nightEnabled, holidayEnabled,
    holidayPolicyOverride,  // Phase D: 직원별 공휴일 정책 예외 ('off'|'work_pay'|'work_substitute'|null)
    // 0057: 직원별 근무정책
    workType, scheduleType, workCycleStartDate, cycleWorkDays, cycleRestDays
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
       holiday_policy_override = ?,
       work_type = ?, schedule_type = ?,
       work_cycle_start_date = ?, cycle_work_days = ?, cycle_rest_days = ?,
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
    // Phase D: holiday_policy_override
    holidayPolicyOverride !== undefined
      ? (holidayPolicyOverride === '' ? null : (holidayPolicyOverride ?? null))
      : (existing.holiday_policy_override ?? null),
    // 0057: 직원별 근무정책
    // workType: 명시적 null 전달 시 병원 설정 상속으로 초기화
    workType !== undefined
      ? (workType === '' ? null : (workType ?? null))
      : (existing.work_type ?? null),
    scheduleType !== undefined ? (scheduleType || 'flexible') : (existing.schedule_type ?? 'flexible'),
    workCycleStartDate !== undefined
      ? (workCycleStartDate || null)
      : (existing.work_cycle_start_date ?? null),
    cycleWorkDays !== undefined ? cycleWorkDays : (existing.cycle_work_days ?? null),
    cycleRestDays !== undefined ? cycleRestDays : (existing.cycle_rest_days ?? null),
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
  if (!isNutritionist(user)) return c.json({ error: '권한이 없습니다' }, 403)
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

// 연차 전체 목록 조회 (/:year/:month 보다 반드시 먼저 등록)
schedule.get('/leaves/all', async (c) => {
  const user = c.get('user')
  const year = c.req.query('year') || new Date().getFullYear()
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))

  const rows = await c.env.DB.prepare(
    `SELECT l.*, e.name as emp_name, e.team, p.name as position_name, e.hire_date
     FROM employee_leaves l
     JOIN employees e ON l.employee_id = e.id
     LEFT JOIN employee_positions p ON e.position_id = p.id
     WHERE l.hospital_id = ? AND l.year = ? AND e.is_active = 1
     ORDER BY e.team, p.sort_order, e.hire_date, e.name`
  ).bind(hospitalId, year).all<any>()

  // ★ STEP 3: 반차(employee_leave_history) 합계를 직원별로 집계하여 함께 반환
  //   - 운영 데이터 직접 수정 없이, 조회 시점에 0.5일 단위 반차를 합산
  //   - half_used_days: 연차 차감용 반차 일수 합계 (leave_ratio 합, 보통 0.5×건수)
  //   - half_am_cnt / half_pm_cnt: 오전/오후 반차 건수 (참고용)
  const histRows = await c.env.DB.prepare(
    `SELECT employee_id,
            COALESCE(SUM(leave_ratio), 0) as half_used_days,
            SUM(CASE WHEN leave_period = 'am' THEN 1 ELSE 0 END) as half_am_cnt,
            SUM(CASE WHEN leave_period = 'pm' THEN 1 ELSE 0 END) as half_pm_cnt
     FROM employee_leave_history
     WHERE hospital_id = ? AND year = ?
     GROUP BY employee_id`
  ).bind(hospitalId, parseInt(String(year))).all<any>()

  const histByEmp: Record<number, any> = {}
  for (const h of (histRows.results || [])) histByEmp[h.employee_id] = h

  const enriched = (rows.results || []).map((r: any) => {
    const h = histByEmp[r.employee_id]
    return {
      ...r,
      half_used_days: h ? Number(h.half_used_days) || 0 : 0,
      half_am_cnt:    h ? Number(h.half_am_cnt)    || 0 : 0,
      half_pm_cnt:    h ? Number(h.half_pm_cnt)    || 0 : 0,
    }
  })

  return c.json(enriched)
})

// ════════════════════════════════════════════════════════════════
// 월차(月次) 관리 — 1년 미만 근무자 자동 월별 유급휴가
// ════════════════════════════════════════════════════════════════

// ── 헬퍼: 병원 월차 정책 읽기 ──────────────────────────────────
async function getMonthlyLeavePolicy(db: any, hospitalId: number) {
  const rows = await db.prepare(
    `SELECT setting_key, setting_value FROM hospital_work_settings WHERE hospital_id=?`
  ).bind(hospitalId).all<any>()
  const map: Record<string, string> = {}
  for (const r of (rows.results || [])) map[r.setting_key] = r.setting_value
  return {
    enabled:           map['monthly_leave_enabled']           !== '0',  // 기본 ON
    attendanceRule:    map['monthly_leave_attendance_rule']   || 'full', // full|partial|ratio
    attendanceRatio:   parseFloat(map['monthly_leave_attendance_ratio'] || '80'),
    maxDays:           parseInt(map['monthly_leave_max_days'] || '11'),
    autoTransition:    map['monthly_leave_auto_transition']   !== '0',  // 기본 ON
  }
}

// ── 헬퍼: 직원의 1년 만료 여부 ─────────────────────────────────
function isUnder1Year(hireDate: string, refDate?: Date): boolean {
  const hired = new Date(hireDate)
  const ref   = refDate || new Date()
  const diffMs = ref.getTime() - hired.getTime()
  return diffMs < 365.25 * 24 * 3600 * 1000
}

// ── 헬퍼: 특정 월 소정근로일수 계산 (토/일 제외) ──────────────
function calcWorkingDays(year: number, month: number): number {
  const lastDay = new Date(year, month, 0).getDate()
  let count = 0
  for (let d = 1; d <= lastDay; d++) {
    const dow = new Date(year, month - 1, d).getDay()
    if (dow !== 0 && dow !== 6) count++
  }
  return count
}

// ── 월차 발생 내역 조회 ─────────────────────────────────────────
schedule.get('/monthly-leave/grants', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const year = parseInt(c.req.query('year') || new Date().getFullYear().toString())
  const empId = c.req.query('employeeId')

  let sql = `SELECT g.*, e.name as emp_name, e.hire_date, e.team
             FROM monthly_leave_grants g
             JOIN employees e ON e.id = g.employee_id
             WHERE g.hospital_id = ? AND g.grant_year = ?`
  const params: any[] = [hospitalId, year]
  if (empId) { sql += ` AND g.employee_id = ?`; params.push(parseInt(empId)) }
  sql += ` ORDER BY e.name, g.target_year, g.target_month`

  const rows = await c.env.DB.prepare(sql).bind(...params).all<any>()
  return c.json(rows.results || [])
})

// ── 월차 감사 로그 조회 ─────────────────────────────────────────
schedule.get('/monthly-leave/audit', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const empId = c.req.query('employeeId')
  const limit = parseInt(c.req.query('limit') || '50')

  let sql = `SELECT a.*, e.name as emp_name
             FROM monthly_leave_audit a
             JOIN employees e ON e.id = a.employee_id
             WHERE a.hospital_id = ?`
  const params: any[] = [hospitalId]
  if (empId) { sql += ` AND a.employee_id = ?`; params.push(parseInt(empId)) }
  sql += ` ORDER BY a.created_at DESC LIMIT ?`
  params.push(limit)

  const rows = await c.env.DB.prepare(sql).bind(...params).all<any>()
  return c.json(rows.results || [])
})

// ── 월차 요약 (직원별) ──────────────────────────────────────────
schedule.get('/monthly-leave/summary', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const year = parseInt(c.req.query('year') || new Date().getFullYear().toString())

  const policy = await getMonthlyLeavePolicy(c.env.DB, hospitalId)
  const maxDays = policy.maxDays || 11

  // 1년 미만 + 이미 monthly 레코드 있는 직원 모두 포함
  const emps = await c.env.DB.prepare(`
    SELECT e.id as employee_id, e.name as emp_name, e.hire_date, e.team
    FROM employees e
    WHERE e.hospital_id=? AND e.is_active=1 AND e.hire_date IS NOT NULL AND e.hire_date != ''
    ORDER BY e.team, e.hire_date
  `).bind(hospitalId).all<any>()

  // employee_leaves monthly 레코드
  const leaves = await c.env.DB.prepare(`
    SELECT * FROM employee_leaves
    WHERE hospital_id=? AND year=? AND leave_type='monthly'
  `).bind(hospitalId, year).all<any>()
  const leaveMap: Record<number, any> = {}
  for (const l of (leaves.results || [])) leaveMap[l.employee_id] = l

  // monthly_leave_grants 집계
  const grants = await c.env.DB.prepare(`
    SELECT employee_id, SUM(days_granted) as total_granted, COUNT(*) as grant_count
    FROM monthly_leave_grants
    WHERE hospital_id=? AND grant_year=? AND status='active'
    GROUP BY employee_id
  `).bind(hospitalId, year).all<any>()
  const grantMap: Record<number, any> = {}
  for (const g of (grants.results || [])) grantMap[g.employee_id] = g

  const now = new Date()
  const result = []

  for (const emp of (emps.results || [])) {
    // 1년 미만 여부 판단
    const msPerYear = 365.25 * 24 * 3600 * 1000
    const diffMs = now.getTime() - new Date(emp.hire_date).getTime()
    const under1Year = diffMs < msPerYear

    // 이미 DB에 레코드 있으면 그 값 사용
    const leafRow = leaveMap[emp.employee_id]

    // DB에 없을 때: 1년 미만이면 자동 계산값으로 표시
    if (!leafRow && !under1Year) continue  // 1년 이상인데 monthly 레코드 없으면 제외

    // 자동계산 발생일수: 입사 다음달 ~ 이번달까지
    let autoCalcDays = 0
    if (under1Year) {
      const hired = new Date(emp.hire_date)
      let cy = hired.getFullYear(), cm = hired.getMonth() + 2
      if (cm > 12) { cm = 1; cy++ }
      const limitY = now.getFullYear(), limitM = now.getMonth() + 1
      while ((cy < limitY || (cy === limitY && cm <= limitM)) && autoCalcDays < maxDays) {
        autoCalcDays++
        cm++; if (cm > 12) { cm = 1; cy++ }
      }
    }

    const monthly_total = leafRow ? (leafRow.total_days ?? null) : null
    const monthly_used  = leafRow ? (leafRow.used_days  ?? 0)    : 0

    result.push({
      employee_id:    emp.employee_id,
      emp_name:       emp.emp_name,
      hire_date:      emp.hire_date,
      team:           emp.team,
      year,
      leave_type:     'monthly',
      monthly_total,               // null = DB에 발생 기록 없음
      monthly_used,
      monthly_remain: monthly_total !== null ? monthly_total - monthly_used : null,
      auto_calc_days: autoCalcDays, // 입사일 기준 자동계산 (표시용)
      under1Year,
      grant_count:    grantMap[emp.employee_id]?.grant_count   || 0,
      total_granted:  grantMap[emp.employee_id]?.total_granted || 0,
      is_initial_setup: leafRow?.is_initial_setup || 0,
    })
  }

  return c.json(result)
})

// ── 월차 자동 생성 (트리거: 매월 또는 수동 실행) ─────────────────
// POST /api/schedule/monthly-leave/generate
// body: { year, month, employeeId? }  — 특정 월의 월차 발생 처리
schedule.post('/monthly-leave/generate', async (c) => {
  const user = c.get('user')
  if (!isNutritionist(user)) return c.json({ error: '관리자만 실행 가능합니다' }, 403)

  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const body = await c.req.json().catch(() => ({}))
  const now  = new Date()
  // 기본: 이전 달(개근 확인 대상)
  const targetYear  = body.year  || (now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear())
  const targetMonth = body.month || (now.getMonth() === 0 ? 12 : now.getMonth())
  const specificEmpId = body.employeeId ? parseInt(body.employeeId) : null

  const policy = await getMonthlyLeavePolicy(c.env.DB, hospitalId)
  if (!policy.enabled) return c.json({ ok: true, skipped: true, reason: '월차 기능이 비활성화되어 있습니다' })

  // 대상 직원 조회 (1년 미만 재직자)
  const mmStr = `${targetYear}-${String(targetMonth).padStart(2,'0')}`
  const lastDayOfMonth = new Date(targetYear, targetMonth, 0).toISOString().slice(0, 10)

  let empSql = `SELECT * FROM employees WHERE hospital_id=? AND is_active=1 AND hire_date IS NOT NULL AND hire_date != ''`
  const empParams: any[] = [hospitalId]
  if (specificEmpId) { empSql += ` AND id=?`; empParams.push(specificEmpId) }
  const emps = await c.env.DB.prepare(empSql).bind(...empParams).all<any>()

  const results: any[] = []
  const grantDate = `${targetYear}-${String(targetMonth).padStart(2,'0')}-28` // 말일 기준

  for (const emp of (emps.results || [])) {
    // 1년 미만 여부 확인 (해당 월 말일 기준)
    const refDate = new Date(lastDayOfMonth)
    if (!isUnder1Year(emp.hire_date, refDate)) {
      // 1년 이상 → 월차 대상 아님, 연차 전환 체크
      if (policy.autoTransition) {
        // 연차 전환은 별도 API에서 처리
      }
      continue
    }

    // 입사 후 첫 달인지 확인 (첫 달은 개근 발생 안 함 - 다음 달부터)
    const hired = new Date(emp.hire_date)
    const hireYear  = hired.getFullYear()
    const hireMonth = hired.getMonth() + 1
    if (hireYear === targetYear && hireMonth >= targetMonth) continue // 입사월 이하

    // 이미 발생된 월차 확인
    const existing = await c.env.DB.prepare(
      `SELECT id FROM monthly_leave_grants WHERE hospital_id=? AND employee_id=? AND target_year=? AND target_month=?`
    ).bind(hospitalId, emp.id, targetYear, targetMonth).first<any>()
    if (existing) {
      results.push({ empId: emp.id, name: emp.name, status: 'already_exists' })
      continue
    }

    // 최대 11일 초과 여부 확인
    const prevGrants = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(days_granted),0) as total FROM monthly_leave_grants
       WHERE hospital_id=? AND employee_id=? AND status='active'`
    ).bind(hospitalId, emp.id).first<any>()
    const alreadyGranted = prevGrants?.total || 0
    if (alreadyGranted >= policy.maxDays) {
      results.push({ empId: emp.id, name: emp.name, status: 'max_reached', total: alreadyGranted })
      continue
    }

    // 개근 여부 확인
    const mmPad = String(targetMonth).padStart(2, '0')
    const fromDate = `${targetYear}-${mmPad}-01`
    const toDateStr = `${targetYear}-${mmPad}-${String(new Date(targetYear, targetMonth, 0).getDate()).padStart(2,'0')}`

    // 해당 월 스케줄에서 결근/연차 사용 여부 확인
    const schedRows = await c.env.DB.prepare(`
      SELECT work_date, shift_code, leave_type
      FROM daily_schedules
      WHERE hospital_id=? AND employee_id=? AND work_date BETWEEN ? AND ?
    `).bind(hospitalId, emp.id, fromDate, toDateStr).all<any>()

    const schedMap: Record<string, any> = {}
    for (const s of (schedRows.results || [])) schedMap[s.work_date] = s

    const workingDays = calcWorkingDays(targetYear, targetMonth)
    // 입사일 이후 소정근로일만 계산
    let attendanceDays = 0
    let absenceDays = 0
    const REST_CODES_SET = new Set(['연','반','경조','병','off','OFF','휴','대체'])

    for (let d = 1; d <= new Date(targetYear, targetMonth, 0).getDate(); d++) {
      const dateStr = `${targetYear}-${mmPad}-${String(d).padStart(2,'0')}`
      const dow = new Date(dateStr).getDay()
      if (dow === 0 || dow === 6) continue // 주말 제외
      if (dateStr < emp.hire_date) continue // 입사 전 제외

      const sc = schedMap[dateStr]
      if (!sc) {
        // 스케줄 미입력 = 출근으로 간주 (스케줄을 일일이 기록하지 않는 병원 현장 특성 반영)
        // full 기준일 때만 스케줄 없는 날을 확인 불가로 처리 가능하지만,
        // 기본적으로 스케줄 기록 없음 ≠ 결근이므로 출근으로 봄
        attendanceDays++
        continue
      }
      const shiftCode = sc.shift_code || ''
      const ABSENCE_CODES = new Set(['결','결근'])
      if (ABSENCE_CODES.has(shiftCode)) {
        absenceDays++ // 명시적 결근 코드만 결근으로 처리
      } else {
        attendanceDays++ // 연차, 병가, 경조 등 모두 출근 인정 (법적 기준)
      }
    }

    // 개근 기준 평가
    let qualified = false
    if (policy.attendanceRule === 'full') {
      qualified = absenceDays === 0
    } else if (policy.attendanceRule === 'partial') {
      qualified = absenceDays <= 1
    } else if (policy.attendanceRule === 'ratio') {
      const actualWorking = attendanceDays + absenceDays
      const ratio = actualWorking > 0 ? (attendanceDays / actualWorking * 100) : 0
      qualified = ratio >= policy.attendanceRatio
    } else {
      qualified = absenceDays === 0
    }

    if (!qualified) {
      results.push({ empId: emp.id, name: emp.name, status: 'not_qualified', absenceDays })
      continue
    }

    // 월차 발생 처리
    const daysToGrant = Math.min(1, policy.maxDays - alreadyGranted)

    // monthly_leave_grants 에 삽입
    const grantResult = await c.env.DB.prepare(`
      INSERT INTO monthly_leave_grants
        (hospital_id, employee_id, grant_year, grant_month, target_year, target_month,
         days_granted, grant_type, status, attendance_days, working_days, absence_days, note)
      VALUES (?,?,?,?,?,?,?,'auto','active',?,?,?,?)
    `).bind(
      hospitalId, emp.id,
      targetYear, targetMonth,  // 발생 연월 (= 개근 확인 대상 다음 달이 원칙이나 여기선 동일 처리)
      targetYear, targetMonth,  // 개근 대상 연월
      daysToGrant,
      attendanceDays, workingDays, absenceDays,
      `${targetYear}년 ${targetMonth}월 개근 월차 자동 발생`
    ).run()

    // employee_leaves (monthly 타입) upsert
    // year = 발생 연도 기준
    const leaveYear = targetYear
    await c.env.DB.prepare(`
      INSERT INTO employee_leaves (hospital_id, employee_id, year, leave_type, total_days, used_days, note)
      VALUES (?,?,?,'monthly',?,0,?)
      ON CONFLICT(hospital_id, employee_id, year, leave_type) DO UPDATE SET
        total_days = total_days + excluded.total_days,
        note = excluded.note,
        updated_at = datetime('now')
    `).bind(hospitalId, emp.id, leaveYear, daysToGrant, `${targetYear}년 월차`).run()

    // 감사 로그
    await c.env.DB.prepare(`
      INSERT INTO monthly_leave_audit
        (hospital_id, employee_id, grant_id, action, after_value, actor_id, actor_role, reason)
      VALUES (?,?,?,?,?,?,?,?)
    `).bind(
      hospitalId, emp.id, grantResult.meta.last_row_id,
      'auto_grant',
      JSON.stringify({ year: leaveYear, month: targetMonth, days: daysToGrant, attendance: attendanceDays, absence: absenceDays }),
      user.userId || null, 'system',
      `${targetYear}년 ${targetMonth}월 개근 확인 후 자동 발생`
    ).run()

    results.push({ empId: emp.id, name: emp.name, status: 'granted', days: daysToGrant })
  }

  return c.json({ ok: true, results, targetYear, targetMonth })
})

// ── 월차 소급 처리 (입사 후 현재까지 미발생 월차 일괄 발생) ──────
// POST /api/schedule/monthly-leave/backfill
// body: { employeeId? }  — 특정 직원 또는 전체 1년 미만 직원 소급 처리
// 개근 조건 없이 입사 다음달부터 이번달까지 무조건 자동 발생 (초기 도입용)
schedule.post('/monthly-leave/backfill', async (c) => {
  const user = c.get('user')
  if (!isNutritionist(user)) return c.json({ error: '관리자만 실행 가능합니다' }, 403)

  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const body = await c.req.json().catch(() => ({}) as any)
  const specificEmpId = body.employeeId ? parseInt(body.employeeId) : null

  const policy = await getMonthlyLeavePolicy(c.env.DB, hospitalId)
  if (!policy.enabled) return c.json({ ok: true, skipped: true, reason: '월차 기능이 비활성화되어 있습니다' })

  let empSql = `SELECT * FROM employees WHERE hospital_id=? AND is_active=1 AND hire_date IS NOT NULL AND hire_date != ''`
  const empParams: any[] = [hospitalId]
  if (specificEmpId) { empSql += ` AND id=?`; empParams.push(specificEmpId) }
  const emps = await c.env.DB.prepare(empSql).bind(...empParams).all<any>()

  const now = new Date()
  const allResults: any[] = []

  for (const emp of (emps.results || [])) {
    const hired = new Date(emp.hire_date)
    const msPerYear = 365.25 * 24 * 60 * 60 * 1000
    const yearsWorked = (now.getTime() - hired.getTime()) / msPerYear

    // 1년 미만 직원만 소급 처리 (1년 이상은 연차 전환 대상)
    if (yearsWorked >= 1) continue

    // 입사 다음 달부터 시작
    let checkYear = hired.getFullYear()
    let checkMonth = hired.getMonth() + 2 // 입사 다음 달 (getMonth()는 0-indexed)
    if (checkMonth > 12) { checkMonth = 1; checkYear++ }

    // 이번 달(현재 달 포함)까지 처리: getMonth()+1이 현재 월(1-indexed)
    const todayYM = now.getFullYear() * 100 + (now.getMonth() + 1)

    while (checkYear * 100 + checkMonth <= todayYM) {
      const targetYear = checkYear
      const targetMonth = checkMonth

      // 해당 월이 1년 미만 범위인지 확인 (말일 기준)
      const lastDayOfMonth = new Date(targetYear, targetMonth, 0).toISOString().slice(0, 10)
      if (!isUnder1Year(emp.hire_date, new Date(lastDayOfMonth))) {
        checkMonth++
        if (checkMonth > 12) { checkMonth = 1; checkYear++ }
        continue
      }

      // 이미 발생된 월차 확인 → 스킵
      const existing = await c.env.DB.prepare(
        `SELECT id FROM monthly_leave_grants WHERE hospital_id=? AND employee_id=? AND target_year=? AND target_month=?`
      ).bind(hospitalId, emp.id, targetYear, targetMonth).first<any>()
      if (existing) {
        allResults.push({ empId: emp.id, name: emp.name, year: targetYear, month: targetMonth, status: 'already_exists' })
        checkMonth++
        if (checkMonth > 12) { checkMonth = 1; checkYear++ }
        continue
      }

      // 누적 발생일수 확인 (최대 11일)
      const prevGrants = await c.env.DB.prepare(
        `SELECT COALESCE(SUM(days_granted),0) as total FROM monthly_leave_grants WHERE hospital_id=? AND employee_id=? AND status='active'`
      ).bind(hospitalId, emp.id).first<any>()
      const alreadyGranted = prevGrants?.total || 0
      if (alreadyGranted >= policy.maxDays) {
        allResults.push({ empId: emp.id, name: emp.name, year: targetYear, month: targetMonth, status: 'max_reached', total: alreadyGranted })
        checkMonth++
        if (checkMonth > 12) { checkMonth = 1; checkYear++ }
        continue
      }

      // ✅ 개근 조건 없이 무조건 발생 (초기 도입 소급 처리)
      const daysToGrant2 = Math.min(1, policy.maxDays - alreadyGranted)
      const workingDays2 = calcWorkingDays(targetYear, targetMonth)

      const grantResult2 = await c.env.DB.prepare(`
        INSERT INTO monthly_leave_grants
          (hospital_id, employee_id, grant_year, grant_month, target_year, target_month,
           days_granted, grant_type, status, attendance_days, working_days, absence_days, note)
        VALUES (?,?,?,?,?,?,?,'auto_backfill','active',?,?,0,?)
      `).bind(
        hospitalId, emp.id, targetYear, targetMonth, targetYear, targetMonth,
        daysToGrant2, workingDays2, workingDays2,
        `${targetYear}년 ${targetMonth}월 월차 자동발생`
      ).run()

      // employee_leaves 누적 업데이트
      await c.env.DB.prepare(`
        INSERT INTO employee_leaves (hospital_id, employee_id, year, leave_type, total_days, used_days, note)
        VALUES (?,?,?,'monthly',?,0,?)
        ON CONFLICT(hospital_id, employee_id, year, leave_type) DO UPDATE SET
          total_days = total_days + excluded.total_days,
          note = excluded.note,
          updated_at = datetime('now')
      `).bind(hospitalId, emp.id, targetYear, daysToGrant2, `${targetYear}년 월차 자동발생`).run()

      // 감사 로그
      await c.env.DB.prepare(`
        INSERT INTO monthly_leave_audit
          (hospital_id, employee_id, grant_id, action, after_value, actor_id, actor_role, reason)
        VALUES (?,?,?,?,?,?,?,?)
      `).bind(
        hospitalId, emp.id, grantResult2.meta.last_row_id,
        'backfill_grant',
        JSON.stringify({ year: targetYear, month: targetMonth, days: daysToGrant2 }),
        user.userId || null, 'system',
        `${targetYear}년 ${targetMonth}월 자동 소급 처리`
      ).run()

      allResults.push({ empId: emp.id, name: emp.name, year: targetYear, month: targetMonth, status: 'granted', days: daysToGrant2 })

      checkMonth++
      if (checkMonth > 12) { checkMonth = 1; checkYear++ }
    }
  }

  const grantedCount = allResults.filter(r => r.status === 'granted').length
  const alreadyCount = allResults.filter(r => r.status === 'already_exists').length
  const maxCount = allResults.filter(r => r.status === 'max_reached').length

  return c.json({ ok: true, results: allResults, summary: { granted: grantedCount, already_exists: alreadyCount, max_reached: maxCount } })
})

// ── 월차 수동 조정 ──────────────────────────────────────────────
schedule.post('/monthly-leave/adjust', async (c) => {
  const user = c.get('user')
  if (!isNutritionist(user)) return c.json({ error: '관리자만 수동 조정 가능합니다' }, 403)

  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const { employeeId, year, totalDays, usedDays, reason } = await c.req.json()
  if (!employeeId || year == null) return c.json({ error: '필수 파라미터 누락' }, 400)

  const emp = await c.env.DB.prepare(`SELECT * FROM employees WHERE id=?`).bind(employeeId).first<any>()
  if (!emp) return c.json({ error: '직원 없음' }, 404)

  // 현재 값 조회
  const prev = await c.env.DB.prepare(
    `SELECT total_days, used_days FROM employee_leaves WHERE hospital_id=? AND employee_id=? AND year=? AND leave_type='monthly'`
  ).bind(hospitalId, employeeId, year).first<any>()

  await c.env.DB.prepare(`
    INSERT INTO employee_leaves (hospital_id, employee_id, year, leave_type, total_days, used_days, note)
    VALUES (?,?,?,'monthly',?,?,?)
    ON CONFLICT(hospital_id, employee_id, year, leave_type) DO UPDATE SET
      total_days = excluded.total_days,
      used_days  = excluded.used_days,
      note       = excluded.note,
      updated_at = datetime('now')
  `).bind(hospitalId, employeeId, year, totalDays || 0, usedDays || 0, reason || '').run()

  // 감사 로그
  await c.env.DB.prepare(`
    INSERT INTO monthly_leave_audit
      (hospital_id, employee_id, action, before_value, after_value, actor_id, actor_role, reason)
    VALUES (?,?,?,?,?,?,?,?)
  `).bind(
    hospitalId, employeeId,
    'manual_adjust',
    JSON.stringify(prev || {}),
    JSON.stringify({ total_days: totalDays, used_days: usedDays }),
    user.userId || null, user.role || 'hospital',
    reason || '수동 조정'
  ).run()

  return c.json({ ok: true })
})

// ── 직원별 월차 상세 조회 (인사카드용) ─────────────────────────
schedule.get('/employees/:id/monthly-leave', async (c) => {
  const user = c.get('user')
  const empId = parseInt(c.req.param('id'))
  const emp = await c.env.DB.prepare(`SELECT * FROM employees WHERE id=?`).bind(empId).first<any>()
  if (!emp) return c.json({ error: '직원 없음' }, 404)
  if (!isAdmin(user) && emp.hospital_id !== user.hospitalId) return c.json({ error: '권한 없음' }, 403)

  const year = parseInt(c.req.query('year') || new Date().getFullYear().toString())

  // 월차 발생 이력
  const grants = await c.env.DB.prepare(`
    SELECT * FROM monthly_leave_grants WHERE employee_id=? ORDER BY target_year, target_month
  `).bind(empId).all<any>()

  // 월차 집계
  const leaveRow = await c.env.DB.prepare(
    `SELECT * FROM employee_leaves WHERE employee_id=? AND year=? AND leave_type='monthly'`
  ).bind(empId, year).first<any>()

  // 연차 집계
  const annualRow = await c.env.DB.prepare(
    `SELECT * FROM employee_leaves WHERE employee_id=? AND year=? AND leave_type='annual'`
  ).bind(empId, year).first<any>()

  // 감사 로그 (최근 20건)
  const audit = await c.env.DB.prepare(`
    SELECT * FROM monthly_leave_audit WHERE employee_id=? ORDER BY created_at DESC LIMIT 20
  `).bind(empId).all<any>()

  // 정책
  const policy = await getMonthlyLeavePolicy(c.env.DB, emp.hospital_id)

  // 1년 도달 여부
  const under1Year = isUnder1Year(emp.hire_date || '')

  return c.json({
    emp: { id: emp.id, name: emp.name, hire_date: emp.hire_date },
    policy,
    under1Year,
    grants:     grants.results || [],
    monthlyLeave: leaveRow || null,
    annualLeave:  annualRow || null,
    audit:      audit.results || [],
  })
})

// ── 1년 도달 직원 연차 전환 처리 ────────────────────────────────
schedule.post('/monthly-leave/transition', async (c) => {
  const user = c.get('user')
  if (!isNutritionist(user)) return c.json({ error: '권한이 없습니다' }, 403)

  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const body = await c.req.json().catch(() => ({}))
  const specificEmpId = body.employeeId ? parseInt(body.employeeId) : null

  const policy = await getMonthlyLeavePolicy(c.env.DB, hospitalId)
  if (!policy.autoTransition) return c.json({ ok: true, skipped: true, reason: '자동 전환 비활성화' })

  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const year = today.getFullYear()

  let empSql = `SELECT * FROM employees WHERE hospital_id=? AND is_active=1 AND hire_date IS NOT NULL AND hire_date != ''`
  const empParams: any[] = [hospitalId]
  if (specificEmpId) { empSql += ` AND id=?`; empParams.push(specificEmpId) }
  const emps = await c.env.DB.prepare(empSql).bind(...empParams).all<any>()

  const transitioned: any[] = []
  for (const emp of (emps.results || [])) {
    if (isUnder1Year(emp.hire_date, today)) continue // 아직 1년 미만

    // 이미 연차 레코드 있는지 확인
    const annualRow = await c.env.DB.prepare(
      `SELECT id FROM employee_leaves WHERE hospital_id=? AND employee_id=? AND year=? AND leave_type='annual'`
    ).bind(hospitalId, emp.id, year).first<any>()
    if (annualRow) continue // 이미 연차 있음

    // 법정 연차 계산
    const hired = new Date(emp.hire_date)
    const diffMs = today.getTime() - hired.getTime()
    const yearsWorked = diffMs / (365.25 * 24 * 3600 * 1000)
    let legalDays = 15
    if (yearsWorked >= 3) {
      const extra = Math.floor((yearsWorked - 1) / 2)
      legalDays = Math.min(15 + extra, 25)
    }

    // 연차 레코드 생성
    await c.env.DB.prepare(`
      INSERT INTO employee_leaves (hospital_id, employee_id, year, leave_type, total_days, used_days, note)
      VALUES (?,?,?,'annual',?,0,?)
      ON CONFLICT(hospital_id, employee_id, year, leave_type) DO UPDATE SET
        total_days = excluded.total_days,
        note = excluded.note,
        updated_at = datetime('now')
    `).bind(hospitalId, emp.id, year, legalDays, `1년 만료 자동 연차 전환 (${todayStr})`).run()

    // 감사 로그
    await c.env.DB.prepare(`
      INSERT INTO monthly_leave_audit
        (hospital_id, employee_id, action, after_value, actor_id, actor_role, reason)
      VALUES (?,?,?,?,?,?,?)
    `).bind(
      hospitalId, emp.id,
      'policy_change',
      JSON.stringify({ transition: 'monthly_to_annual', annual_days: legalDays, years_worked: yearsWorked }),
      user.userId || null, 'system',
      `1년 만료 연차 전환 (${Math.floor(yearsWorked * 10) / 10}년 근무)`
    ).run()

    transitioned.push({ empId: emp.id, name: emp.name, legalDays, yearsWorked })
  }

  return c.json({ ok: true, transitioned })
})

// ════════════════════════════════════════════════════════════════
// 초기 도입 셋업 — 과거 이력 없는 병원을 위한 발생+사용보정 일괄 처리
// ════════════════════════════════════════════════════════════════

// ── 헬퍼: 입사일 기준 법정 발생 일수 계산 (미리보기용) ──────────
function calcInitialLeave(hireDate: string, referenceDate: Date) {
  const hired = new Date(hireDate)
  if (isNaN(hired.getTime())) return null

  const diffMs = referenceDate.getTime() - hired.getTime()
  if (diffMs < 0) return null

  const msPerYear = 365.25 * 24 * 3600 * 1000
  const yearsWorked = diffMs / msPerYear

  if (yearsWorked < 1) {
    // 월차: 입사 다음 달~기준일 이전 달까지 (최대 maxDays)
    const hireYear  = hired.getFullYear()
    const hireMonth = hired.getMonth() + 1
    const refYear   = referenceDate.getFullYear()
    const refMonth  = referenceDate.getMonth() + 1

    const breakdown: { year: number; month: number; days: number }[] = []
    let y = hireYear
    let m = hireMonth + 1 // 입사 다음 달부터
    if (m > 12) { m = 1; y++ }

    // 기준일 당월까지 포함
    const limitYM = refYear * 100 + refMonth
    while (y * 100 + m <= limitYM && breakdown.length < 11) {
      breakdown.push({ year: y, month: m, days: 1 })
      m++; if (m > 12) { m = 1; y++ }
    }
    return {
      leaveType: 'monthly' as const,
      totalDays: breakdown.length,
      breakdown,
    }
  } else {
    // 연차: 법정 기준
    let legalDays = 15
    if (yearsWorked >= 3) {
      const extra = Math.floor((yearsWorked - 1) / 2)
      legalDays = Math.min(15 + extra, 25)
    }
    return {
      leaveType: 'annual' as const,
      totalDays: legalDays,
      breakdown: [],
    }
  }
}

// ── GET /initial-setup/status ────────────────────────────────────
// 병원의 초기 셋업 완료 여부 조회
schedule.get('/initial-setup/status', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))

  const row = await c.env.DB.prepare(
    `SELECT setting_value FROM hospital_work_settings WHERE hospital_id=? AND setting_key='initial_setup_done'`
  ).bind(hospitalId).first<any>()

  const done = row?.setting_value === '1'
  return c.json({ done })
})

// ── POST /initial-setup/calculate ───────────────────────────────
// 입사일 기준 발생 예상치 계산 (미리보기 — DB 저장 없음)
schedule.post('/initial-setup/calculate', async (c) => {
  const user = c.get('user')
  if (!isNutritionist(user)) return c.json({ error: '관리자만 실행 가능합니다' }, 403)

  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const body = await c.req.json().catch(() => ({}) as any)
  const refDate = body.referenceDate ? new Date(body.referenceDate) : new Date()
  const specificEmpId = body.employeeId ? parseInt(body.employeeId) : null

  let empSql = `SELECT e.*, p.name as position_name FROM employees e
    LEFT JOIN employee_positions p ON e.position_id = p.id
    WHERE e.hospital_id=? AND e.is_active=1 AND e.hire_date IS NOT NULL AND e.hire_date != ''`
  const empParams: any[] = [hospitalId]
  if (specificEmpId) { empSql += ` AND e.id=?`; empParams.push(specificEmpId) }
  empSql += ` ORDER BY e.team, e.hire_date`
  const emps = await c.env.DB.prepare(empSql).bind(...empParams).all<any>()

  const result = []
  for (const emp of (emps.results || [])) {
    const calc = calcInitialLeave(emp.hire_date, refDate)
    if (!calc) continue

    // 이미 설정된 값 확인
    const existing = await c.env.DB.prepare(
      `SELECT total_days, used_days, initial_used_days, is_initial_setup FROM employee_leaves
       WHERE hospital_id=? AND employee_id=? AND leave_type=?`
    ).bind(hospitalId, emp.id, calc.leaveType).first<any>()

    result.push({
      employeeId:    emp.id,
      name:          emp.name,
      position:      emp.position_name || emp.position || '',
      team:          emp.team || 'cook',
      hireDate:      emp.hire_date,
      leaveType:     calc.leaveType,
      calculatedDays: calc.totalDays,
      breakdown:     calc.breakdown,
      alreadySet:    existing ? {
        totalDays:       existing.total_days,
        usedDays:        existing.used_days,
        initialUsedDays: existing.initial_used_days,
        isInitialSetup:  !!existing.is_initial_setup,
      } : null,
    })
  }

  return c.json({ ok: true, referenceDate: refDate.toISOString().slice(0, 10), employees: result })
})

// ── POST /initial-setup/apply ────────────────────────────────────
// 발생 세팅 + 사용 보정 일괄 적용 (덮어쓰기)
// body: { employees: [{ employeeId, totalDays, initialUsedDays, leaveType, note }] }
schedule.post('/initial-setup/apply', async (c) => {
  const user = c.get('user')
  if (!isNutritionist(user)) return c.json({ error: '관리자만 실행 가능합니다' }, 403)

  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const body = await c.req.json().catch(() => ({}) as any)
  const employees: any[] = body.employees || []

  if (!employees.length) return c.json({ error: '직원 목록이 없습니다' }, 400)

  const now = new Date()
  const year = now.getFullYear()
  const processed: any[] = []
  const skipped: any[] = []

  for (const item of employees) {
    const empId        = parseInt(item.employeeId)
    const totalDays    = parseFloat(item.totalDays)   ?? 0
    const initUsed     = parseFloat(item.initialUsedDays ?? 0)
    const leaveType    = item.leaveType || 'annual'
    const note         = item.note || `초기 도입 셋업 (${now.toISOString().slice(0, 10)})`

    if (isNaN(empId) || isNaN(totalDays)) { skipped.push({ empId, reason: '유효하지 않은 값' }); continue }

    const emp = await c.env.DB.prepare(`SELECT * FROM employees WHERE id=? AND hospital_id=?`)
      .bind(empId, hospitalId).first<any>()
    if (!emp) { skipped.push({ empId, reason: '직원 없음' }); continue }

    // 실제 사용일수 = initialUsedDays (보정값)
    const usedDays = Math.min(initUsed, totalDays)

    await c.env.DB.prepare(`
      INSERT INTO employee_leaves
        (hospital_id, employee_id, year, leave_type, total_days, used_days,
         initial_used_days, is_initial_setup, note)
      VALUES (?,?,?,?,?,?,?,1,?)
      ON CONFLICT(hospital_id, employee_id, year, leave_type) DO UPDATE SET
        total_days        = excluded.total_days,
        used_days         = excluded.used_days,
        initial_used_days = excluded.initial_used_days,
        is_initial_setup  = 1,
        note              = excluded.note,
        updated_at        = datetime('now')
    `).bind(hospitalId, empId, year, leaveType, totalDays, usedDays, initUsed, note).run()

    // 월차 타입이면 monthly_leave_grants 에도 초기 레코드 생성 (이력용)
    if (leaveType === 'monthly' && totalDays > 0) {
      // 이미 grant 이력이 없는 경우에만 bulk insert (단일 row로 요약)
      const existGrant = await c.env.DB.prepare(
        `SELECT id FROM monthly_leave_grants WHERE hospital_id=? AND employee_id=? AND grant_type='initial_setup'`
      ).bind(hospitalId, empId).first<any>()
      if (!existGrant) {
        const hireDate = emp.hire_date || ''
        await c.env.DB.prepare(`
          INSERT INTO monthly_leave_grants
            (hospital_id, employee_id, grant_year, grant_month, target_year, target_month,
             days_granted, grant_type, status, note)
          VALUES (?,?,?,?,?,?,?,'initial_setup','active',?)
        `).bind(
          hospitalId, empId,
          year, 0,   // grant_month=0 = 초기 셋업 일괄
          year, 0,
          totalDays,
          `초기 도입 셋업: ${totalDays}일 발생 / ${initUsed}일 사용 보정`
        ).run()
      }
    }

    // 감사 로그
    await c.env.DB.prepare(`
      INSERT INTO monthly_leave_audit
        (hospital_id, employee_id, action, after_value, actor_id, actor_role, reason)
      VALUES (?,?,?,?,?,?,?)
    `).bind(
      hospitalId, empId,
      'initial_setup',
      JSON.stringify({ leaveType, totalDays, usedDays, initUsed }),
      user.userId || null, user.role || 'admin',
      `초기 도입 셋업 적용`
    ).run()

    processed.push({ empId, name: emp.name, leaveType, totalDays, usedDays })
  }

  return c.json({ ok: true, processed: processed.length, skipped: skipped.length, details: processed })
})

// ── POST /initial-setup/finalize ─────────────────────────────────
// 초기 셋업 완료 확정 (병원 단위 플래그 세팅)
schedule.post('/initial-setup/finalize', async (c) => {
  const user = c.get('user')
  if (!isNutritionist(user)) return c.json({ error: '관리자만 실행 가능합니다' }, 403)

  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const body = await c.req.json().catch(() => ({}) as any)
  const undo = body.undo === true  // 초기화(취소) 시 undo:true

  const val = undo ? '0' : '1'
  await c.env.DB.prepare(`
    INSERT INTO hospital_work_settings (hospital_id, setting_key, setting_value)
    VALUES (?,?,?)
    ON CONFLICT(hospital_id, setting_key) DO UPDATE SET setting_value=excluded.setting_value
  `).bind(hospitalId, 'initial_setup_done', val).run()

  return c.json({ ok: true, done: !undo, finalizedAt: new Date().toISOString() })
})

// 공개 API: 토큰으로 직원 스케줄 조회 (인증 불필요) ── /:year/:month 보다 먼저 등록
schedule.get('/public/:token', async (c) => {
  const token = c.req.param('token')
  const yearParam  = c.req.query('year')
  const monthParam = c.req.query('month')

  const tokenRow = await c.env.DB.prepare(`
    SELECT t.*, e.name as emp_name, e.position, e.hospital_id,
           h.name as hospital_name
    FROM schedule_share_tokens t
    JOIN employees e ON e.id = t.employee_id
    JOIN hospitals h ON h.id = t.hospital_id
    WHERE t.token = ? AND t.is_active = 1
  `).bind(token).first<any>()

  if (!tokenRow) return c.json({ error: 'Invalid or expired token' }, 404)

  const now = new Date()
  const year  = yearParam  ? parseInt(yearParam)  : now.getFullYear()
  const month = monthParam ? parseInt(monthParam) : now.getMonth() + 1
  const mm = String(month).padStart(2, '0')
  const fromDate = `${year}-${mm}-01`
  const lastDay  = new Date(year, month, 0).getDate()
  const toDate   = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`

  const schedRows = await c.env.DB.prepare(`
    SELECT ds.work_date, ds.shift_code, ds.leave_type,
           ss.shift_name, ss.start_time, ss.end_time, ss.color
    FROM daily_schedules ds
    LEFT JOIN schedule_shifts ss ON ss.hospital_id = ? AND ss.shift_code = ds.shift_code
    WHERE ds.hospital_id = ? AND ds.employee_id = ?
      AND ds.work_date >= ? AND ds.work_date <= ?
    ORDER BY ds.work_date
  `).bind(tokenRow.hospital_id, tokenRow.hospital_id, tokenRow.employee_id, fromDate, toDate).all<any>()

  const schedMap: Record<string, any> = {}
  const codeCount: Record<string, number> = {}
  let workDays = 0
  for (const r of (schedRows.results || [])) {
    schedMap[r.work_date] = r
    if (r.shift_code && r.shift_code !== '연' && r.shift_code !== '휴') {
      workDays++
      codeCount[r.shift_code] = (codeCount[r.shift_code] || 0) + 1
    }
  }

  const shifts = await c.env.DB.prepare(`
    SELECT shift_code, shift_name, start_time, end_time, color
    FROM schedule_shifts WHERE hospital_id=? AND is_active=1 ORDER BY sort_order
  `).bind(tokenRow.hospital_id).all<any>()

  // 최근 변경 이력 (최근 30일, 최대 20건)
  const changeLog = await c.env.DB.prepare(`
    SELECT work_date, old_shift_code, new_shift_code, changed_at
    FROM schedule_change_log
    WHERE employee_id=? AND changed_at >= datetime('now', '-30 days')
    ORDER BY changed_at DESC
    LIMIT 20
  `).bind(tokenRow.employee_id).all<any>()

  return c.json({
    employee: { id: tokenRow.employee_id, name: tokenRow.emp_name, position: tokenRow.position },
    hospital: { name: tokenRow.hospital_name },
    year, month, schedMap, workDays, codeCount,
    shifts: shifts.results || [],
    totalDays: lastDay,
    changeLog: changeLog.results || [],
  })
})

// 공개 API: 팀 전체 스케줄 조회 (인증 불필요) ── /:year/:month 보다 먼저 등록
schedule.get('/team-public/:token', async (c) => {
  const token = c.req.param('token')
  const yearParam  = c.req.query('year')
  const monthParam = c.req.query('month')

  const tokenRow = await c.env.DB.prepare(
    `SELECT t.hospital_id, h.name as hospital_name
     FROM team_share_tokens t
     JOIN hospitals h ON h.id = t.hospital_id
     WHERE t.token=? AND t.is_active=1`
  ).bind(token).first<any>()

  if (!tokenRow) return c.json({ error: 'Invalid or expired token' }, 404)

  const hid = tokenRow.hospital_id
  const now  = new Date()
  const year  = yearParam  ? parseInt(yearParam)  : now.getFullYear()
  const month = monthParam ? parseInt(monthParam) : now.getMonth() + 1
  const mm = String(month).padStart(2, '0')
  const fromDate = `${year}-${mm}-01`
  const lastDay  = new Date(year, month, 0).getDate()
  const toDate   = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`

  // 활성 직원 목록 (position_name 포함)
  const empRows = await c.env.DB.prepare(
    `SELECT e.id, e.name, e.position, e.team,
            COALESCE(p.name, e.position) as position_name
     FROM employees e
     LEFT JOIN employee_positions p ON e.position_id = p.id
     WHERE e.hospital_id=? AND e.is_active=1
     ORDER BY e.team, COALESCE(p.sort_order,999), e.hire_date, e.name`
  ).bind(hid).all<any>()
  const employees = empRows.results || []

  // 이번 달 전체 스케줄
  const schedRows = await c.env.DB.prepare(
    `SELECT ds.employee_id, ds.work_date, ds.shift_code
     FROM daily_schedules ds
     WHERE ds.hospital_id=? AND ds.work_date>=? AND ds.work_date<=?`
  ).bind(hid, fromDate, toDate).all<any>()

  // schedMap: { empId: { 'YYYY-MM-DD': shiftCode } }
  const schedMap: Record<string, Record<string, string>> = {}
  ;(schedRows.results || []).forEach((r: any) => {
    if (!schedMap[r.employee_id]) schedMap[r.employee_id] = {}
    schedMap[r.employee_id][r.work_date] = r.shift_code
  })

  // 근무조 색상
  const shifts = await c.env.DB.prepare(
    `SELECT shift_code, shift_name, color FROM schedule_shifts WHERE hospital_id=? AND is_active=1 ORDER BY sort_order`
  ).bind(hid).all<any>()

  // 공휴일
  const holRows = await c.env.DB.prepare(
    `SELECT holiday_date as date, name FROM holidays WHERE holiday_date LIKE ? ORDER BY holiday_date`
  ).bind(`${year}-${mm}-%`).all<any>()

  return c.json({
    hospital: { name: tokenRow.hospital_name },
    year, month, totalDays: lastDay,
    employees,
    schedMap,
    shifts: shifts.results || [],
    holidays: holRows.results || [],
  })
})

// ════════════════════════════════════════════════════════════════
// 부분연차 / 반차 (작업 C) — partial-leave
//   ⚠️ /:year/:month 보다 반드시 먼저 등록 (그렇지 않으면 'partial-leave'가
//      year 파라미터로 잡혀 가로채짐)
//   - employee_leave_history 에 (leave_period, leave_hours, leave_ratio,
//     standard_hours) 컬럼을 사용해 저장.
//   - UPSERT 키: (hospital_id, employee_id, leave_date, leave_period)
//   - 저장 후 recalcAnnualUsedDays() 로 used_days 재집계 → 잔여연차 반영.
// ════════════════════════════════════════════════════════════════

// 해당 날짜 직원 근무조/기준시간 조회 (모달의 standard_hours 표시용 보조 API)
//   GET /api/schedule/employee-shift-on-date?hospitalId=&employeeId=&date=
//   응답: { shift: { shift_name, standard_hours } | null }
schedule.get('/employee-shift-on-date', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  if (!hospitalId) return c.json({ error: 'Unauthorized' }, 401)
  const employeeId = parseInt(c.req.query('employeeId') || '0')
  const date = c.req.query('date') || ''
  if (!employeeId || !date) return c.json({ shift: null })

  // 권한: 영양사는 본인 병원만
  if (!isAdmin(user) && hospitalId !== user.hospitalId) return c.json({ error: '권한 없음' }, 403)

  // 해당 날짜 스케줄에서 shift_code 조회
  const sched = await c.env.DB.prepare(
    `SELECT shift_code, shift_id FROM daily_schedules
     WHERE hospital_id=? AND employee_id=? AND work_date=?`
  ).bind(hospitalId, employeeId, date).first<any>()

  if (!sched || !sched.shift_code) return c.json({ shift: null })

  // 근무조 정보 조회 (shift_id 우선, 없으면 shift_code)
  let shiftRow: any = null
  if (sched.shift_id) {
    shiftRow = await c.env.DB.prepare(
      `SELECT * FROM schedule_shifts WHERE id=? AND hospital_id=?`
    ).bind(sched.shift_id, hospitalId).first<any>()
  }
  if (!shiftRow) {
    shiftRow = await c.env.DB.prepare(
      `SELECT * FROM schedule_shifts WHERE hospital_id=? AND shift_code=? AND is_active=1`
    ).bind(hospitalId, sched.shift_code).first<any>()
  }
  if (!shiftRow) return c.json({ shift: null })

  // standard_hours: start/end 시각으로 계산(8h 이상 근무 시 휴게 1h 제외), 없으면 8 기본
  let standardHours = 8
  if (shiftRow.start_time && shiftRow.end_time) {
    let mins = timeToMinutes(shiftRow.end_time) - timeToMinutes(shiftRow.start_time)
    if (mins < 0) mins += 24 * 60 // 야간 교대 보정
    let hrs = mins / 60
    if (hrs >= 8) hrs -= 1 // 8시간 이상 근무 시 휴게 1시간 제외(법정)
    if (hrs > 0) standardHours = Math.round(hrs * 100) / 100
  }

  return c.json({
    shift: {
      shift_name: shiftRow.shift_name || shiftRow.shift_code,
      shift_code: shiftRow.shift_code,
      standard_hours: standardHours,
    }
  })
})

// 해당 날짜 부분연차/반차 이력 조회
//   GET /api/schedule/partial-leave/history?hospitalId=&employeeId=&date=
//   응답: { history: [ { leave_hours, leave_ratio, leave_period, ... } ] }
schedule.get('/partial-leave/history', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  if (!hospitalId) return c.json({ error: 'Unauthorized' }, 401)
  const employeeId = parseInt(c.req.query('employeeId') || '0')
  const date = c.req.query('date') || ''
  if (!employeeId || !date) return c.json({ history: [] })

  if (!isAdmin(user) && hospitalId !== user.hospitalId) return c.json({ error: '권한 없음' }, 403)

  const rows = await c.env.DB.prepare(
    `SELECT id, leave_date, leave_period, leave_hours, leave_ratio,
            standard_hours, leave_subtype, note, created_at
     FROM employee_leave_history
     WHERE hospital_id=? AND employee_id=? AND leave_date=? AND leave_period IS NOT NULL
     ORDER BY CASE leave_period WHEN 'am' THEN 0 WHEN 'pm' THEN 1 ELSE 2 END, id`
  ).bind(hospitalId, employeeId, date).all<any>()

  return c.json({ history: rows.results || [] })
})

// 부분연차/반차 저장 (UPSERT — 부분 UNIQUE 인덱스라 수동 UPSERT)
//   POST /api/schedule/partial-leave
//   body: { hospitalId, employeeId, date, leaveHours, standardHours,
//           leavePeriod('am'|'pm'), leaveRatio, leaveSubtype, note }
//   응답: { updated: true(수정) | false(신규) }
schedule.post('/partial-leave', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const {
    hospitalId: bodyHospId, employeeId, date,
    leaveHours, standardHours, leavePeriod, leaveRatio, note,
  } = body

  // 병원 권한 결정 (admin은 body hospitalId, 영양사는 본인 병원)
  const hospitalId = isAdmin(user) && bodyHospId ? parseInt(String(bodyHospId)) : user.hospitalId
  if (!hospitalId) return c.json({ error: '권한이 없습니다.' }, 401)
  if (!employeeId) return c.json({ error: '직원을 선택해주세요.' }, 400)
  if (!date) return c.json({ error: '날짜를 선택해주세요.' }, 400)
  if (leavePeriod !== 'am' && leavePeriod !== 'pm') {
    return c.json({ error: '오전/오후를 선택해주세요.' }, 400)
  }

  // 직원 병원 일치 확인
  const emp = await c.env.DB.prepare(`SELECT hospital_id FROM employees WHERE id=?`).bind(employeeId).first<any>()
  if (!emp) return c.json({ error: '직원을 찾을 수 없습니다.' }, 404)
  if (!isAdmin(user) && emp.hospital_id !== user.hospitalId) return c.json({ error: '권한 없음' }, 403)
  const hid = emp.hospital_id

  const ratio = typeof leaveRatio === 'number' ? leaveRatio : parseFloat(leaveRatio) || 0
  const hours = typeof leaveHours === 'number' ? leaveHours : parseFloat(leaveHours) || 0
  const stdHours = typeof standardHours === 'number' ? standardHours : parseFloat(standardHours) || 8
  // 기존 집계(half_am/half_pm) 호환을 위해 period 기준 subtype 부여
  const subtype = leavePeriod === 'am' ? 'half_am' : 'half_pm'
  const d = new Date(date)
  const year = d.getFullYear()
  const month = d.getMonth() + 1

  // 기존 동일 (직원,날짜,오전/오후) 행 존재 여부 → updated 분기 + 수동 UPSERT
  const existing = await c.env.DB.prepare(
    `SELECT id FROM employee_leave_history
     WHERE hospital_id=? AND employee_id=? AND leave_date=? AND leave_period=?`
  ).bind(hid, employeeId, date, leavePeriod).first<any>()

  if (existing) {
    await c.env.DB.prepare(
      `UPDATE employee_leave_history
       SET leave_subtype=?, leave_hours=?, leave_ratio=?, standard_hours=?,
           year=?, month=?, note=?
       WHERE id=?`
    ).bind(subtype, hours, ratio, stdHours, year, month, note || '', existing.id).run()
  } else {
    await c.env.DB.prepare(
      `INSERT INTO employee_leave_history
         (hospital_id, employee_id, year, month, leave_date, leave_subtype,
          leave_period, leave_hours, leave_ratio, standard_hours, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      hid, employeeId, year, month, date, subtype,
      leavePeriod, hours, ratio, stdHours, note || ''
    ).run()
  }

  // used_days 재집계 → 잔여연차 반영
  await recalcAnnualUsedDays(c.env.DB, hid, employeeId, year)

  return c.json({ updated: !!existing })
})

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
      `SELECT s.employee_id, s.work_date, s.shift_code, s.shift_id, s.leave_type,
              s.is_overtime, s.overtime_hours, s.is_night_work,
              s.is_temp_staff, s.temp_type, s.temp_hours, s.note,
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
      `SELECT employee_id, leave_type, total_days, used_days, carried_over_days, allowance_paid, allowance_paid_at
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

  // leaveMap: { empId: { annual: {total, used, carried_over_days, allowance_paid}, ... } }
  const leaveMap: Record<number, Record<string, any>> = {}
  for (const l of (leaveRows.results || [])) {
    if (!leaveMap[l.employee_id]) leaveMap[l.employee_id] = {}
    leaveMap[l.employee_id][l.leave_type] = {
      total: l.total_days > 0 ? l.total_days : null,  // 0 = 미부여 → null 처리
      used: l.used_days,
      carried_over_days: l.carried_over_days ?? 0,
      allowance_paid: l.allowance_paid ?? 0,
      allowance_paid_at: l.allowance_paid_at ?? null
    }
  }

  // ── 스케줄 기반 연차 사용일 보정 ──────────────────────────────
  // employee_leaves에 행이 없거나 used_days가 실제와 다를 경우
  // schedMap에서 직접 '연' 코드를 카운트하여 leaveMap에 주입
  // ⚠️ 작업 C: 종일 연차 COUNT 에 더해 부분연차/반차 ratio 합산도 반영
  const annualUsedFromSched: Record<number, number> = {}
  for (const key of Object.keys(schedMap)) {
    const s = schedMap[key]
    if (s.shift_code === '연') {
      const empId = s.employee_id
      annualUsedFromSched[empId] = (annualUsedFromSched[empId] || 0) + 1
    }
  }

  // 부분연차/반차 ratio 합산 (해당 연도 employee_leave_history.leave_ratio)
  const partialUsedRows = await c.env.DB.prepare(
    `SELECT employee_id, COALESCE(SUM(leave_ratio), 0) as ratio_sum
     FROM employee_leave_history
     WHERE hospital_id=? AND year=? AND leave_period IS NOT NULL
     GROUP BY employee_id`
  ).bind(hospitalId, parseInt(year)).all<any>()
  const partialUsedByEmp: Record<number, number> = {}
  for (const r of (partialUsedRows.results || [])) {
    partialUsedByEmp[Number(r.employee_id)] = r.ratio_sum || 0
  }

  // 종일 연차 + 부분연차 합산하여 보정 대상 직원 집합 구성
  const correctedEmpIds = new Set<number>([
    ...Object.keys(annualUsedFromSched).map(Number),
    ...Object.keys(partialUsedByEmp).map(Number),
  ])
  for (const empId of correctedEmpIds) {
    const schedUsed = (annualUsedFromSched[empId] || 0) + (partialUsedByEmp[empId] || 0)
    if (!leaveMap[empId]) {
      // employee_leaves 행 자체가 없는 직원 → 사용일만 주입
      leaveMap[empId] = { annual: { total: null, used: schedUsed, carried_over_days: 0, allowance_paid: 0, allowance_paid_at: null } }
    } else if (!leaveMap[empId].annual) {
      leaveMap[empId].annual = { total: null, used: schedUsed, carried_over_days: 0, allowance_paid: 0, allowance_paid_at: null }
    } else {
      // DB의 used_days와 (스케줄 카운트 + 부분연차 ratio)가 다를 경우 보정
      if (leaveMap[empId].annual.used !== schedUsed) {
        leaveMap[empId].annual.used = schedUsed
      }
    }
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
// 헬퍼: 연차 사용일수(used_days) 재집계
//   used_days = (종일 연차 shift_code='연' COUNT)  ← 기존 동작 그대로 유지
//             + (부분연차/반차 leave_ratio 합산: employee_leave_history)
//
// ⚠️ 작업 C 영향도 대응:
//   - 기존엔 종일 연차만 1일씩 카운트하여 반차(0.5)/부분연차(ratio)가 used_days에 미반영.
//   - 이 헬퍼는 employee_leave_history 에 저장된 부분연차/반차 ratio 를 추가 합산한다.
//   - 종일 연차 카운트 방식(=COUNT)은 변경하지 않는다(기존 동작 보존, 추가 합산만 수행).
// ════════════════════════════════════════════════════════════════
async function recalcAnnualUsedDays(
  db: D1Database,
  hospitalId: number,
  employeeId: number,
  year: number
): Promise<number> {
  // 1) 종일 연차: daily_schedules.shift_code='연' COUNT (기존 로직 보존)
  const annualCount = await db.prepare(
    `SELECT COUNT(*) as cnt FROM daily_schedules
     WHERE hospital_id=? AND employee_id=? AND shift_code='연'
       AND work_date LIKE ?`
  ).bind(hospitalId, employeeId, `${year}-%`).first<any>()
  const usedAnnualFull = annualCount?.cnt ?? 0

  // 2) 부분연차/반차: employee_leave_history.leave_ratio 합산 (leave_period 있는 행)
  const partialSum = await db.prepare(
    `SELECT COALESCE(SUM(leave_ratio), 0) as ratio_sum
     FROM employee_leave_history
     WHERE hospital_id=? AND employee_id=? AND year=?
       AND leave_period IS NOT NULL`
  ).bind(hospitalId, employeeId, year).first<any>()
  const usedPartial = partialSum?.ratio_sum ?? 0

  // 3) 합산값을 employee_leaves.used_days 에 UPSERT
  const usedTotal = usedAnnualFull + usedPartial
  await db.prepare(
    `INSERT INTO employee_leaves (hospital_id, employee_id, year, leave_type, total_days, used_days, note)
     VALUES (?, ?, ?, 'annual', 0, ?, '')
     ON CONFLICT (hospital_id, employee_id, year, leave_type)
     DO UPDATE SET used_days=excluded.used_days, updated_at=CURRENT_TIMESTAMP`
  ).bind(hospitalId, employeeId, year, usedTotal).run()

  return usedTotal
}

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
  const REST_CODES = new Set(['휴','연','경조','병가','반차','대체','대휴','공가','무급'])

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

  // ── 연차 사용일수 자동 재집계 ──────────────────────────────
  // 스케줄 저장/삭제 시마다 해당 직원의 해당 연도 연차 used_days를 실제 스케줄 기준으로 재계산
  // (종일 연차 COUNT + 부분연차/반차 ratio 합산) — 공통 헬퍼 사용
  const workYear = parseInt(workDate.substring(0, 4))
  await recalcAnnualUsedDays(db, hospitalId, employeeId, workYear)
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

  // 변경 전 기존 스케줄 조회 (변경 이력용)
  const oldRow = await c.env.DB.prepare(
    `SELECT shift_code FROM daily_schedules WHERE hospital_id=? AND employee_id=? AND work_date=?`
  ).bind(emp.hospital_id, employeeId, workDate).first<any>()
  const oldCode = oldRow?.shift_code ?? null

  await upsertScheduleWithCalc(
    c.env.DB, emp.hospital_id, employeeId, workDate,
    shiftCode, shiftId || null, leaveType,
    !!isOvertime, overtimeHours || 0,
    !!isTempStaff, !!isNightWork, tempType || null, tempHours || 0, note || null
  )

  // 변경 이력 기록 (내용이 실제로 바뀐 경우만)
  const newCode = shiftCode || null
  if (oldCode !== newCode) {
    await c.env.DB.prepare(
      `INSERT INTO schedule_change_log (hospital_id, employee_id, work_date, old_shift_code, new_shift_code, changed_by)
       VALUES (?,?,?,?,?,?)`
    ).bind(emp.hospital_id, employeeId, workDate, oldCode, newCode, (user as any).id || null).run()
  }

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

    // 변경 전 기존 코드 조회 (변경 이력용)
    const oldRow2 = await c.env.DB.prepare(
      `SELECT shift_code FROM daily_schedules WHERE hospital_id=? AND employee_id=? AND work_date=?`
    ).bind(emp.hospital_id, employeeId, workDate).first<any>()
    const oldCode = oldRow2?.shift_code ?? null

    await upsertScheduleWithCalc(
      c.env.DB, emp.hospital_id, employeeId, workDate,
      shiftCode, shiftId || null, leaveType,
      !!isOvertime, overtimeHours || 0,
      !!isTempStaff, !!isNightWork, tempType || null, tempHours || 0, note || null
    )

    // 변경 이력 기록 (내용 변경 시)
    const newCode = shiftCode || null
    if (oldCode !== newCode) {
      await c.env.DB.prepare(
        `INSERT INTO schedule_change_log (hospital_id, employee_id, work_date, old_shift_code, new_shift_code, changed_by)
         VALUES (?,?,?,?,?,?)`
      ).bind(emp.hospital_id, employeeId, workDate, oldCode, newCode, (user as any).id || null).run()
    }

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

// ────────────────────────────────────────────────────────────────
// 📌 월 고정 휴무 자동 배치 알고리즘 (computeMonthlyFixedOff)
//
// 설계 원칙 (정책 우선순위 반영):
//   STEP 1. 공휴일·주말 먼저 휴무 배정 (이미 확정)
//   STEP 2. 잔여 목표 휴무일 = N - 공휴일/주말 수
//   STEP 3. 후보 평일 목록을 "일별 예상 근무인원"이 높은 순으로 정렬
//            → 가장 인원이 많은 날(여유 있는 날)부터 휴무 배정
//            → 기준인원(required_staff_count) 이하로 떨어지지 않도록 보호
//   STEP 4. 주별 균등 분산 (주당 최대 허용 초과 방지)
//   STEP 5. 연속 휴무 3일 이상 지양 (이미 앞뒤로 2일 휴무이면 해당 날 후보 제외)
//   STEP 6. 수동 수정된 날짜(lock_flag=1)는 재계산 시 건드리지 않음
//
// 반환값:
//   배치된 날짜 배열 (type='monthly_fixed', is_auto=true)
//   + 각 날짜에 배치 근거(reason) 포함
// ────────────────────────────────────────────────────────────────

interface OffGrantDay {
  date: string
  day_of_week: string
  type: string
  label: string
  is_auto?: boolean       // true = 자동 배치, false = 수동 수정
  lock_flag?: number      // 0 = 자동(덮어쓰기 가능), 1 = 수동 잠금
  base_off_type?: string  // 수동 수정 전 원본 자동 유형
  reason?: string         // 배치 근거 텍스트
}

/**
 * 일별 정규직원 예상 근무인원 집계
 * - daily_schedules 에서 해당 월의 실제 입력된 근무코드 기반
 * - team='nutrition' 직원 제외 (기존 정책 유지)
 * - 반환: { 'YYYY-MM-DD': number }
 */
async function buildDailyWorkCount(
  db: D1Database,
  hospitalId: number,
  year: number,
  month: number,
  restCodes: Set<string>
): Promise<Record<string, number>> {
  const monthStr = String(month).padStart(2, '0')
  const prefix   = `${year}-${monthStr}`

  // 영양사 제외 정규직원 ID 목록 조회
  const empRows = await db.prepare(
    `SELECT id FROM employees
     WHERE hospital_id=? AND team != 'nutrition' AND is_active=1`
  ).bind(hospitalId).all<any>()
  const empIds = new Set((empRows.results || []).map((e: any) => e.id))
  if (empIds.size === 0) return {}

  // 해당 월 스케줄 조회 (영양사 제외)
  const schedRows = await db.prepare(
    `SELECT employee_id, work_date, shift_code
     FROM daily_schedules
     WHERE hospital_id=? AND work_date LIKE ?`
  ).bind(hospitalId, `${prefix}-%`).all<any>()

  const countMap: Record<string, number> = {}
  for (const r of (schedRows.results || [])) {
    if (!empIds.has(r.employee_id)) continue
    const code = r.shift_code || ''
    if (!code || code === '-' || restCodes.has(code)) continue
    countMap[r.work_date] = (countMap[r.work_date] || 0) + 1
  }
  return countMap
}

/**
 * 월 고정 휴무 자동 배치 핵심 함수
 *
 * @param targetOff     목표 총 휴무일수 (예: 10)
 * @param year, month   대상 년월
 * @param holidays      공휴일 Set<'YYYY-MM-DD'>
 * @param holidayMap    공휴일 이름 Map
 * @param dailyWorkCount 일별 현재 근무인원 { 'YYYY-MM-DD': number }
 * @param requiredStaff 일일 기준(목표) 근무인원 (0 = 미설정)
 * @param lockedDates   수동 잠금 날짜 Set<'YYYY-MM-DD'>
 * @param lockedTypes   수동 잠금 날짜의 off_type Map
 */
function computeMonthlyFixedOff(
  targetOff: number,
  year: number,
  month: number,
  holidays: Set<string>,
  holidayMap: Map<string, string>,
  dailyWorkCount: Record<string, number>,
  requiredStaff: number,
  lockedDates: Set<string>,
  lockedTypes: Map<string, string>,
  requiredStaffWeekend: number = 0
): OffGrantDay[] {
  const DOW_LABEL = ['일', '월', '화', '수', '목', '금', '토']
  const daysInMonth = new Date(year, month, 0).getDate()
  const monthStr    = String(month).padStart(2, '0')
  const result: OffGrantDay[] = []

  // ── STEP 1: 공휴일·주말 먼저 확정 ──────────────────────────
  const fixedOffDates = new Set<string>()   // 이미 휴무로 확정된 날짜

  for (let d = 1; d <= daysInMonth; d++) {
    const ds  = `${year}-${monthStr}-${String(d).padStart(2, '0')}`
    const dow = new Date(year, month - 1, d).getDay()

    // 수동 잠금된 날짜: 기존 유형 그대로 유지
    if (lockedDates.has(ds)) {
      const lockedType = lockedTypes.get(ds) || 'manual'
      result.push({
        date: ds,
        day_of_week: DOW_LABEL[dow],
        type: lockedType,
        label: lockedType === 'monthly_fixed' ? '월고정(수동수정)'
             : lockedType === 'holiday'       ? (holidayMap.get(ds) || '공휴일')
             : lockedType === 'manual'        ? '수동지정'
             : lockedType,
        is_auto: false,
        lock_flag: 1,
        base_off_type: lockedType,
        reason: '관리자 수동 수정 (잠금)'
      })
      fixedOffDates.add(ds)
      continue
    }

    // 공휴일 (주말 중복 포함 — 단일 처리)
    if (holidays.has(ds)) {
      const label = holidayMap.get(ds) || '공휴일'
      const type  = dow === 0 ? 'sunday' : dow === 6 ? 'saturday' : 'holiday'
      result.push({
        date: ds, day_of_week: DOW_LABEL[dow],
        type, label, is_auto: true, lock_flag: 0,
        reason: '공휴일 자동 배정'
      })
      fixedOffDates.add(ds)
      continue
    }
    // 일요일
    if (dow === 0) {
      result.push({
        date: ds, day_of_week: '일', type: 'sunday', label: '일요일',
        is_auto: true, lock_flag: 0, reason: '일요일 자동 배정'
      })
      fixedOffDates.add(ds)
      continue
    }
    // 토요일
    if (dow === 6) {
      result.push({
        date: ds, day_of_week: '토', type: 'saturday', label: '토요일',
        is_auto: true, lock_flag: 0, reason: '토요일 자동 배정'
      })
      fixedOffDates.add(ds)
      continue
    }
  }

  // ── STEP 2: 잔여 목표 휴무일 계산 ──────────────────────────
  const alreadyOff   = fixedOffDates.size
  const remaining    = Math.max(0, targetOff - alreadyOff)
  if (remaining === 0) return result

  // ── STEP 3: 후보 평일 목록 구성 ────────────────────────────
  // 후보 = 아직 휴무로 배정되지 않은 평일
  const candidates: {
    ds: string; dow: number; week: number; workCount: number
  }[] = []

  for (let d = 1; d <= daysInMonth; d++) {
    const ds  = `${year}-${monthStr}-${String(d).padStart(2, '0')}`
    const dow = new Date(year, month - 1, d).getDay()
    if (fixedOffDates.has(ds)) continue          // 이미 휴무 확정
    if (dow === 0 || dow === 6) continue         // 주말 제외 (이미 처리)

    const week = Math.ceil(d / 7)                // 주차 (1~5)
    const workCount = dailyWorkCount[ds] ?? -1   // -1: 스케줄 미입력
    candidates.push({ ds, dow, week, workCount })
  }

  // ── STEP 4: 정렬 기준 ────────────────────────────────────
  // 우선순위: ① 근무인원이 많은 날(여유 있는 날) ② 주차 균등 ③ 요일(금→월 순 약간 가중)
  // 근무인원 정보가 없는 날(-1)은 가장 낮은 우선순위로 처리
  const weekCount: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }

  // 이미 잠금(수동) 날짜가 포함된 주 카운트 선반영
  for (const d of result) {
    if (d.lock_flag === 1) {
      const day = parseInt(d.date.split('-')[2])
      const wk  = Math.ceil(day / 7)
      weekCount[wk] = (weekCount[wk] || 0) + 1
    }
  }

  // 정렬: 근무인원 내림차순 → 주차 카운트 오름차순 → 날짜 오름차순
  candidates.sort((a, b) => {
    const wDiff = (weekCount[a.week] || 0) - (weekCount[b.week] || 0)
    if (wDiff !== 0) return wDiff  // 적게 배정된 주 우선

    // 근무인원이 많은 날 우선 (여유 있는 날에 휴무 배정)
    if (b.workCount !== a.workCount) return b.workCount - a.workCount

    return a.ds.localeCompare(b.ds)  // 날짜 순
  })

  // ── STEP 5: 연속 휴무 방지 + 기준인원 보호 로직으로 배정 ──
  let assigned = 0
  const assignedDates = new Set<string>(fixedOffDates)

  // 배정 후보 순서대로 순회
  for (const cand of candidates) {
    if (assigned >= remaining) break

    const { ds, dow, week } = cand

    // 연속 휴무 3일 이상 방지: 앞뒤 이틀 범위 내 기존 휴무 확인
    const d = parseInt(ds.split('-')[2])
    const prev1 = `${year}-${monthStr}-${String(d - 1).padStart(2, '0')}`
    const prev2 = `${year}-${monthStr}-${String(d - 2).padStart(2, '0')}`
    const next1 = `${year}-${monthStr}-${String(d + 1).padStart(2, '0')}`
    const next2 = `${year}-${monthStr}-${String(d + 2).padStart(2, '0')}`

    const consecBefore = assignedDates.has(prev1) && assignedDates.has(prev2)
    const consecAfter  = assignedDates.has(next1) && assignedDates.has(next2)
    const bridgeCons   = assignedDates.has(prev1) && assignedDates.has(next1)

    if (consecBefore || consecAfter || bridgeCons) {
      // 연속 3일 이상 발생 → 이 날은 건너뜀 (나중에 재시도)
      continue
    }

    // 기준인원 보호: 이 날을 휴무로 배정하면 근무인원이 기준 미달인지 확인
    // workCount: 현재 해당 날짜에 실제 입력된 근무인원
    // 해당 날짜에 월고정 휴무가 배정되면 그 직원이 빠지므로 예상 인원 = workCount - 1
    const isWkndDate = (dow === 0 || dow === 6) || holidays.has(ds)
    const effectiveRequired = (requiredStaffWeekend > 0 && isWkndDate) ? requiredStaffWeekend : requiredStaff
    if (effectiveRequired > 0 && cand.workCount >= 0) {
      const afterOff = cand.workCount - 1  // 1명 추가 휴무 시 예상 잔여 인원

      // 단계별 임계값 적용:
      //   일반 배정: 기준인원의 85% 미만이면 거부
      //   목표의 마지막 20% 배정 시: 75%까지 허용 (목표 달성 우선)
      //   스케줄 미입력(-1)인 날: 건너뜀 없이 배정 (Step6에서 처리)
      const nearEnd = (remaining - assigned) <= Math.ceil(remaining * 0.2)
      const threshold = nearEnd ? effectiveRequired * 0.75 : effectiveRequired * 0.85

      if (afterOff < threshold) {
        // 인력 부족 우려 → 배정 금지 (STEP 6에서 기준 완화 후 재시도)
        continue
      }
    }

    // 배정 확정
    result.push({
      date: ds,
      day_of_week: DOW_LABEL[dow],
      type: 'monthly_fixed',
      label: '월고정 자동배치',
      is_auto: true,
      lock_flag: 0,
      reason: cand.workCount >= 0
        ? `자동배치 (당일 근무인원 ${cand.workCount}명, 기준 ${requiredStaff}명)`
        : '자동배치 (스케줄 미입력 — 균등분산 기준)'
    })
    assignedDates.add(ds)
    weekCount[week] = (weekCount[week] || 0) + 1
    assigned++
  }

  // ── STEP 6: 기준인원 보호로 못 채운 경우 재시도 (기준 완화) ──
  if (assigned < remaining) {
    for (const cand of candidates) {
      if (assigned >= remaining) break
      if (assignedDates.has(cand.ds)) continue
      // 연속 휴무 방지만 유지, 기준인원 제약 제거
      const d = parseInt(cand.ds.split('-')[2])
      const prev1 = `${year}-${monthStr}-${String(d - 1).padStart(2, '0')}`
      const prev2 = `${year}-${monthStr}-${String(d - 2).padStart(2, '0')}`
      const next1 = `${year}-${monthStr}-${String(d + 1).padStart(2, '0')}`
      const next2 = `${year}-${monthStr}-${String(d + 2).padStart(2, '0')}`
      if (assignedDates.has(prev1) && assignedDates.has(prev2)) continue
      if (assignedDates.has(next1) && assignedDates.has(next2)) continue

      result.push({
        date: cand.ds,
        day_of_week: DOW_LABEL[cand.dow],
        type: 'monthly_fixed',
        label: '월고정 자동배치',
        is_auto: true,
        lock_flag: 0,
        reason: `자동배치 (기준인원 제약 완화 — 잔여 ${remaining - assigned}일 배정)`
      })
      assignedDates.add(cand.ds)
      weekCount[cand.week] = (weekCount[cand.week] || 0) + 1
      assigned++
    }
  }

  // ── STEP 7: 연속 휴무 제약도 완화하여 최종 마무리 ─────────
  if (assigned < remaining) {
    for (const cand of candidates) {
      if (assigned >= remaining) break
      if (assignedDates.has(cand.ds)) continue
      result.push({
        date: cand.ds,
        day_of_week: DOW_LABEL[cand.dow],
        type: 'monthly_fixed',
        label: '월고정 자동배치',
        is_auto: true,
        lock_flag: 0,
        reason: `자동배치 (연속휴무 제약 완화 — 목표 ${targetOff}일 달성)`
      })
      assignedDates.add(cand.ds)
      assigned++
    }
  }

  // 날짜순 정렬 후 반환
  return result.sort((a, b) => a.date.localeCompare(b.date))
}

schedule.get('/off-grants', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const year  = parseInt(c.req.query('year')  || new Date().getFullYear().toString())
  const month = parseInt(c.req.query('month') || (new Date().getMonth() + 1).toString())

  // ─── 병원별 근무 설정 조회 ─────────────────────────────────────
  const wsRows = await c.env.DB.prepare(
    `SELECT setting_key, setting_value FROM hospital_work_settings WHERE hospital_id=?`
  ).bind(hospitalId).all<any>()
  const wsMap: Record<string, string> = { ...DEFAULT_WORK_SETTINGS }
  for (const r of (wsRows.results || [])) wsMap[r.setting_key] = r.setting_value

  const offGrantType       = wsMap.off_grant_type          || 'weekly5'
  const cycleWorkDays      = parseInt(wsMap.off_cycle_work_days  || '5')
  const cycleRestDays      = parseInt(wsMap.off_cycle_rest_days  || '2')
  const cycleStartDate     = wsMap.off_cycle_start_date    || ''
  const monthlyFixedDays   = parseInt(wsMap.monthly_fixed_off_days || '10')
  const requiredStaff        = parseInt(wsMap.required_staff_count         || '0')
  const requiredStaffWeekend = parseInt(wsMap.required_staff_count_weekend || '0')
  const monthlyMinOff      = parseInt(wsMap.monthly_min_off_days  || '0')
  const holidayPolicy      = wsMap.holiday_policy          || 'off'
  const cycleHolidayPolicy = wsMap.cycle_holiday_policy    || 'add'

  // ─── 해당 월의 공휴일 조회 ────────────────────────────────────
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
  // 공휴일 이름 Map
  const holidayNameMap = new Map<string, string>(
    (holidayRows.results || []).map((h: any) => [h.holiday_date, h.holiday_name])
  )

  // ─── 해당 월 날짜별 자동 계산 ────────────────────────────────
  const daysInMonth = new Date(year, month, 0).getDate()
  const DOW_LABEL   = ['일', '월', '화', '수', '목', '금', '토']

  // REST_CODES (off-grants 계산에서 제외할 휴무 코드)
  const REST_CODES_OG = new Set(['연', '휴', '경조', '병가', '대체'])

  let grantedDays: OffGrantDay[] = []

  // 일별 근무인원 집계 (monthly_fixed 배치 + min_guarantee 공통 사용)
  const dailyWorkCount = await buildDailyWorkCount(
    c.env.DB, hospitalId, year, month, REST_CODES_OG
  )

  // ── Phase E: 공통 수동 잠금 이력 로드 (모든 근무제 유형 공통) ──────────
  // off_grant_history에서 날짜별 최신 이력을 가져와 현재 lock 상태를 판단
  // (force_recalc로 lock=0이 된 날짜는 잠금 해제 상태로 처리)
  const allLockRows = await c.env.DB.prepare(
    `SELECT target_date, new_off_type, new_lock_flag, base_off_type
     FROM off_grant_history
     WHERE hospital_id=?
       AND target_date LIKE ?
     ORDER BY changed_at DESC`
  ).bind(hospitalId, `${prefix}-%`).all<any>()

  const lockedDates = new Set<string>()
  const lockedTypes = new Map<string, string>()        // date → new_off_type
  const lockedBaseTypes = new Map<string, string>()    // date → base_off_type
  const seenHistoryDates = new Set<string>()
  for (const r of (allLockRows.results || [])) {
    // 날짜별 최신 이력만 사용 (ORDER BY changed_at DESC 첫 번째)
    if (seenHistoryDates.has(r.target_date)) continue
    seenHistoryDates.add(r.target_date)
    // 최신 이력의 new_lock_flag=1인 경우만 잠금으로 처리
    if (r.new_lock_flag === 1) {
      lockedDates.add(r.target_date)
      lockedTypes.set(r.target_date, r.new_off_type || 'monthly_fixed')
      lockedBaseTypes.set(r.target_date, r.base_off_type || r.new_off_type || 'monthly_fixed')
    }
  }

  if (offGrantType === 'monthly_fixed') {
    // ── 월 고정 휴무제 ────────────────────────────────────────
    // 수동 잠금 날짜는 위에서 공통 로드한 lockedDates/lockedTypes 사용

    grantedDays = computeMonthlyFixedOff(
      monthlyFixedDays,
      year, month,
      nationalHolidayDates,
      holidayNameMap,
      dailyWorkCount,
      requiredStaff,
      lockedDates,
      lockedTypes,
      requiredStaffWeekend
    )

  } else if (offGrantType === 'cycle' || offGrantType === 'mixed') {
    // ── 순환 패턴 / 혼합형 ──────────────────────────────────────
    // mixed = 순환패턴 기반 + 공휴일 별도 처리 정책(cycleHolidayPolicy) 적용
    const cycleLen = cycleWorkDays + cycleRestDays
    let baseDate: Date
    if (cycleStartDate) {
      baseDate = new Date(cycleStartDate)
    } else {
      baseDate = new Date(year, month - 1, 1)
    }
    const baseTime = baseDate.getTime()

    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month - 1, d)
      const dateStr = `${year}-${monthStr}-${String(d).padStart(2, '0')}`
      const dow     = dateObj.getDay()
      const dowLabel = DOW_LABEL[dow]
      const isHoliday = nationalHolidayDates.has(dateStr)
      const holidayName = holidayNameMap.get(dateStr) || '공휴일'

      // Phase E: 수동 잠금 날짜 처리 (cycle/mixed 포함)
      if (lockedDates.has(dateStr)) {
        const lockedType = lockedTypes.get(dateStr) || 'cycle_rest'
        const lockedBase = lockedBaseTypes.get(dateStr) || lockedType
        const lockedLabel = lockedType === 'cycle_rest' ? `순환휴무 (수동수정)`
          : lockedType === 'holiday' ? (holidayNameMap.get(dateStr) || '공휴일')
          : lockedType === 'monthly_fixed' ? '월고정(수동수정)'
          : lockedType === 'min_guarantee' ? '최소보장(수동수정)'
          : '수동지정'
        grantedDays.push({
          date: dateStr, day_of_week: dowLabel,
          type: lockedType, label: lockedLabel,
          is_auto: false, lock_flag: 1,
          base_off_type: lockedBase,
          reason: '관리자 수동 수정 (잠금)'
        })
        continue
      }

      const diffMs   = dateObj.getTime() - baseTime
      const diffDays = Math.floor(diffMs / 86400000)
      const posIdx   = ((diffDays % cycleLen) + cycleLen) % cycleLen
      const isRestDay = posIdx >= cycleWorkDays

      if (isRestDay) {
        // ── 순환 휴무일 ────────────────────────────────────────
        // ignore 모드: 토/일/공휴일 여부와 관계없이 cycle_rest 단일 처리
        // 그 외    : 일요일→sunday, 토요일→saturday, 공휴일→holiday, 나머지→cycle_rest
        const isIgnore = cycleHolidayPolicy === 'ignore'
        const typeLabel = isIgnore ? 'cycle_rest'
          : dow === 0 ? 'sunday'
          : dow === 6 ? 'saturday'
          : isHoliday ? 'holiday'
          : 'cycle_rest'
        const label = isIgnore
          ? `순환휴무 (${cycleWorkDays}일근무/${cycleRestDays}일휴무)`
          : dow === 0 ? '일요일'
          : dow === 6 ? '토요일'
          : isHoliday ? holidayName
          : `순환휴무 (${cycleWorkDays}일근무/${cycleRestDays}일휴무)`
        grantedDays.push({
          date: dateStr, day_of_week: dowLabel,
          type: typeLabel, label,
          is_auto: true, lock_flag: 0,
          reason: isIgnore && (dow === 0 || dow === 6 || isHoliday)
            ? `ignore: 순환휴무일(${dow===0?'일':dow===6?'토':'공휴'}) → cycle_rest 유지`
            : isHoliday && !isIgnore ? 'Case A: 순환휴무+공휴일 겹침 → holiday 단일처리'
            : undefined
        })
      } else {
        // ── 순환 근무일 ────────────────────────────────────────
        // ignore 모드: 순환 근무일에서는 토/일/공휴일 모두 추가 휴무 부여 안 함
        // (패턴만 유지 — 근무일은 근무일)
        if (cycleHolidayPolicy === 'ignore') {
          // 아무것도 추가하지 않음 → 근무일 유지
        } else if (dow === 0) {
          // 일요일이 근무일과 겹칠 경우 (순환이 일요일에 근무)
          grantedDays.push({
            date: dateStr, day_of_week: '일', type: 'sunday', label: '일요일',
            is_auto: true, lock_flag: 0
          })
        } else if (dow === 6) {
          // 토요일이 근무일과 겹칠 경우
          grantedDays.push({
            date: dateStr, day_of_week: '토', type: 'saturday', label: '토요일',
            is_auto: true, lock_flag: 0
          })
        } else if (isHoliday) {
          // ── Case B: 순환 근무일 + 공휴일 겹침 ──────────────
          // cycleHolidayPolicy 에 따라 처리
          if (offGrantType === 'mixed') {
            // 혼합형: cycleHolidayPolicy 적용
            if (cycleHolidayPolicy === 'ignore') {
              // ignore: 공휴일 무시, 근무 유지 (휴무 없음)
            } else if (cycleHolidayPolicy === 'pay') {
              // pay: 공휴수당 지급, 휴무 없음 (분석 표시용으로만 기록)
              grantedDays.push({
                date: dateStr, day_of_week: dowLabel,
                type: 'holiday',
                label: `${holidayName} (공휴수당 지급)`,
                is_auto: true, lock_flag: 0,
                reason: 'Case B: 순환근무일+공휴일 → 공휴수당 지급'
              })
            } else if (cycleHolidayPolicy === 'substitute') {
              // substitute: 대체휴무 자동 생성 (여기서는 표시만)
              grantedDays.push({
                date: dateStr, day_of_week: dowLabel,
                type: 'substitute',
                label: `${holidayName} (대체휴무 생성)`,
                is_auto: true, lock_flag: 0,
                reason: 'Case B: 순환근무일+공휴일 → 대체휴무 생성'
              })
            } else {
              // add (기본): 추가 휴무 부여
              grantedDays.push({
                date: dateStr, day_of_week: dowLabel,
                type: 'holiday',
                label: `${holidayName} (추가 휴무)`,
                is_auto: true, lock_flag: 0,
                reason: 'Case B: 순환근무일+공휴일 → 추가 휴무 부여'
              })
            }
          } else {
            // cycle 모드: cycleHolidayPolicy 우선 적용, 없으면 holidayPolicy 적용
            if (cycleHolidayPolicy === 'ignore') {
              // ignore: 공휴일 무시 → 순환 패턴만 유지, 공휴일 휴무 미부여
            } else if (cycleHolidayPolicy === 'pay') {
              // pay: 공휴수당 지급, 휴무 없음
              grantedDays.push({
                date: dateStr, day_of_week: dowLabel,
                type: 'holiday',
                label: `${holidayName} (공휴수당 지급)`,
                is_auto: true, lock_flag: 0,
                reason: 'cycle 공휴일 정책: pay (수당 지급)'
              })
            } else if (cycleHolidayPolicy === 'substitute') {
              // substitute: 대체휴무 생성
              grantedDays.push({
                date: dateStr, day_of_week: dowLabel,
                type: 'substitute',
                label: `${holidayName} (대체휴무)`,
                is_auto: true, lock_flag: 0,
                reason: 'cycle 공휴일 정책: substitute (대체휴무)'
              })
            } else if (holidayPolicy === 'work_pay' || holidayPolicy === 'work_substitute') {
              // holidayPolicy fallback: work_pay / work_substitute
              grantedDays.push({
                date: dateStr, day_of_week: dowLabel,
                type: holidayPolicy === 'work_substitute' ? 'substitute' : 'holiday',
                label: holidayPolicy === 'work_substitute'
                  ? `${holidayName} (대체휴무)`
                  : `${holidayName} (공휴수당)`,
                is_auto: true, lock_flag: 0,
                reason: `공휴일 정책(${holidayPolicy}) 적용`
              })
            } else {
              // add 또는 off (기본): 공휴일 = 추가 휴무
              grantedDays.push({
                date: dateStr, day_of_week: dowLabel,
                type: 'holiday', label: holidayName,
                is_auto: true, lock_flag: 0,
                reason: 'cycle 공휴일 정책: add (추가 휴무)'
              })
            }
          }
        }
      }
    }
  } else {
    // ── 주5일제 기본 (토·일·공휴일) + holiday_policy 적용 ──────────
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month - 1, d)
      const dow     = dateObj.getDay()
      const dateStr = `${year}-${monthStr}-${String(d).padStart(2, '0')}`
      const isNationalHoliday = nationalHolidayDates.has(dateStr)
      const hName = holidayNameMap.get(dateStr) || '공휴일'

      // Phase E: 수동 잠금 처리 (weekly5 모드 포함)
      if (lockedDates.has(dateStr)) {
        const lockedType = lockedTypes.get(dateStr) || 'manual'
        const lockedBase = lockedBaseTypes.get(dateStr) || lockedType
        const lockedLabel = lockedType === 'holiday' ? (holidayNameMap.get(dateStr) || '공휴일')
          : lockedType === 'min_guarantee' ? '최소보장(수동수정)'
          : lockedType === 'monthly_fixed' ? '월고정(수동수정)'
          : '수동지정'
        grantedDays.push({
          date: dateStr, day_of_week: DOW_LABEL[dow],
          type: lockedType, label: lockedLabel,
          is_auto: false, lock_flag: 1,
          base_off_type: lockedBase,
          reason: '관리자 수동 수정 (잠금)'
        })
        continue
      }

      if (dow === 0) {
        grantedDays.push({ date: dateStr, day_of_week: '일', type: 'sunday', label: '일요일', is_auto: true, lock_flag: 0 })
      } else if (dow === 6) {
        grantedDays.push({ date: dateStr, day_of_week: '토', type: 'saturday', label: '토요일', is_auto: true, lock_flag: 0 })
      } else if (isNationalHoliday) {
        // ── holiday_policy 병원 기본값 적용 ─────────────────
        if (holidayPolicy === 'work_pay') {
          // 근무 + 공휴수당 → 휴무 부여하지 않음. 분석용으로만 기록
          grantedDays.push({
            date: dateStr, day_of_week: DOW_LABEL[dow],
            type: 'holiday',
            label: `${hName} (공휴수당 지급)`,
            is_auto: true, lock_flag: 0,
            reason: '병원정책: 공휴일 근무 + 수당 지급'
          })
        } else if (holidayPolicy === 'work_substitute') {
          // 근무 + 대체휴무 자동 생성
          grantedDays.push({
            date: dateStr, day_of_week: DOW_LABEL[dow],
            type: 'substitute',
            label: `${hName} (대체휴무 생성)`,
            is_auto: true, lock_flag: 0,
            reason: '병원정책: 공휴일 근무 + 대체휴무 생성'
          })
        } else {
          // off (기본): 공휴일 = 휴무
          grantedDays.push({
            date: dateStr, day_of_week: DOW_LABEL[dow],
            type: 'holiday', label: hName,
            is_auto: true, lock_flag: 0
          })
        }
      }
    }
  }

  // ─── monthly_min_off_days: 최소 휴무 보장 (min_guarantee 자동 삽입) ───
  // Phase E: 잠긴 min_guarantee 날짜는 이미 grantedDays에 포함됨 (lockedDates로 처리)
  // 대체휴무는 아래에서 조회되므로 여기선 grantedDays 기준으로만 계산
  if (monthlyMinOff > 0) {
    // Phase E: 현재 잠긴 min_guarantee 날짜를 현재 총계에 포함
    const currentTotal = grantedDays.length
    const deficit = monthlyMinOff - currentTotal

    if (deficit > 0) {
      // 이미 휴무인 날짜 집합
      const offDateSet = new Set<string>(grantedDays.map(d => d.date))

      // Phase E: 잠긴 날짜 중 min_guarantee 타입도 후보에서 제외
      for (const ld of lockedDates) offDateSet.add(ld)

      // 최소 보장 추가 후보: 평일 중 아직 휴무가 아닌 날
      const minCandidates: { ds: string; dow: number; workCount: number }[] = []
      for (let d = 1; d <= daysInMonth; d++) {
        const ds  = `${year}-${monthStr}-${String(d).padStart(2, '0')}`
        if (offDateSet.has(ds)) continue
        const dow = new Date(year, month - 1, d).getDay()
        if (dow === 0 || dow === 6) continue  // 주말은 이미 처리됨
        const wc = dailyWorkCount[ds] ?? -1
        minCandidates.push({ ds, dow, workCount: wc })
      }

      // 근무인원 많은 날 우선 정렬
      minCandidates.sort((a, b) => b.workCount - a.workCount)

      let minAdded = 0
      for (const mc of minCandidates) {
        if (minAdded >= deficit) break
        grantedDays.push({
          date: mc.ds,
          day_of_week: DOW_LABEL[mc.dow],
          type: 'min_guarantee',
          label: '최소휴무 보장',
          is_auto: true,
          lock_flag: 0,
          reason: `월 최소 휴무 ${monthlyMinOff}일 보장 자동 추가 (현재 ${currentTotal + minAdded}일 → 목표 ${monthlyMinOff}일)`
        })
        minAdded++
      }
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
    id:          r.id,
    date:        r.off_date,
    name:        r.off_name,
    reason:      r.off_reason || '',
    hospital_id: r.hospital_id,
    created_by:  r.created_by || ''
  }))

  // ─── 요약 집계 (월 고정 휴무제 항목 포함 확장) ──────────────
  const minGuaranteeCount = grantedDays.filter(d => d.type === 'min_guarantee').length
  // Phase E: lock 통계 분리 — 타입별 잠금 수
  const totalLocked         = grantedDays.filter(d => d.lock_flag === 1).length
  const lockedMonthlyFixed  = grantedDays.filter(d => d.lock_flag === 1 && d.type === 'monthly_fixed').length
  const lockedMinGuarantee  = grantedDays.filter(d => d.lock_flag === 1 && d.type === 'min_guarantee').length
  const lockedCycleRest     = grantedDays.filter(d => d.lock_flag === 1 && d.type === 'cycle_rest').length
  const lockedManual        = grantedDays.filter(d => d.lock_flag === 1 && (d.type === 'manual' || !['monthly_fixed','min_guarantee','cycle_rest'].includes(d.type))).length

  const summary = {
    total_granted:           grantedDays.length,
    sundays:                 grantedDays.filter(d => d.type === 'sunday').length,
    saturdays:               grantedDays.filter(d => d.type === 'saturday').length,
    national_holidays:       grantedDays.filter(d => d.type === 'holiday').length,
    cycle_rest_days:         grantedDays.filter(d => d.type === 'cycle_rest').length,
    monthly_fixed_days:      grantedDays.filter(d => d.type === 'monthly_fixed').length,
    monthly_fixed_auto:      grantedDays.filter(d => d.type === 'monthly_fixed' && d.lock_flag !== 1).length,
    monthly_fixed_manual:    lockedMonthlyFixed,
    min_guarantee_days:      minGuaranteeCount,
    // Phase E: 확장된 lock 통계
    total_locked:            totalLocked,
    locked_monthly_fixed:    lockedMonthlyFixed,
    locked_min_guarantee:    lockedMinGuarantee,
    locked_cycle_rest:       lockedCycleRest,
    locked_manual:           lockedManual,
    substitute_type_days:    grantedDays.filter(d => d.type === 'substitute').length,
    substitute_count:        substituteDays.length,
    grand_total:             grantedDays.length + substituteDays.length,
    off_grant_type:          offGrantType,
    monthly_fixed_target:    monthlyFixedDays,
    monthly_min_off_target:  monthlyMinOff,
    cycle_work_days:         cycleWorkDays,
    cycle_rest_days_setting: cycleRestDays,
    holiday_policy:          holidayPolicy,
    cycle_holiday_policy:    cycleHolidayPolicy,
    required_staff:          requiredStaff,
    required_staff_weekend:  requiredStaffWeekend,
    // 정책 검토 신호: min_guarantee 발생 여부
    policy_review_signal:    minGuaranteeCount > 0,
  }

  // ── 직원별 근무정책 요약 (0057) ──────────────────────────────
  // 병원 소속 활성 직원들의 work_type, schedule_type 정보를 함께 반환
  const empPolicyRows = await c.env.DB.prepare(
    `SELECT id, name, work_type, schedule_type,
            work_cycle_start_date, cycle_work_days, cycle_rest_days
     FROM employees
     WHERE hospital_id = ? AND is_active = 1
     ORDER BY sort_order, name`
  ).bind(hospitalId).all<any>()

  const employeeWorkPolicies = (empPolicyRows.results || []).map((e: any) => ({
    id:                    e.id,
    name:                  e.name,
    // work_type: NULL이면 병원 전체 설정 상속
    work_type:             e.work_type ?? null,
    effective_work_type:   e.work_type ?? offGrantType,  // 실제 적용 유형
    schedule_type:         e.schedule_type ?? 'flexible',
    work_cycle_start_date: e.work_cycle_start_date ?? null,
    cycle_work_days:       e.cycle_work_days ?? null,
    cycle_rest_days:       e.cycle_rest_days ?? null,
    // 고정형 여부 플래그
    is_fixed:              (e.schedule_type ?? 'flexible') === 'fixed',
  }))

  // 정책별 직원 수 집계
  const policyStats = {
    total:             employeeWorkPolicies.length,
    fixed_count:       employeeWorkPolicies.filter((e: any) => e.is_fixed).length,
    flexible_count:    employeeWorkPolicies.filter((e: any) => !e.is_fixed).length,
    type_override_count: employeeWorkPolicies.filter((e: any) => e.work_type !== null).length,
  }

  return c.json({
    year, month,
    granted_days:           grantedDays,
    substitute_days:        substituteDays,
    summary,
    employee_work_policies: employeeWorkPolicies,
    policy_stats:           policyStats,
  })
})

// ── 월 고정 휴무 수동 잠금 설정/해제 API ─────────────────────────────────
// POST /api/schedule/off-grants/lock
// body: { date, off_type, lock_flag (0|1), base_off_type?, hospitalId? }
schedule.post('/off-grants/lock', async (c) => {
  const user = c.get('user')
  if (!isAdmin(user) && user?.role !== 'hospital') return c.json({ error: '권한이 없습니다' }, 403)

  const body = await c.req.json()
  const hospitalId = isAdmin(user)
    ? (body.hospitalId ? parseInt(body.hospitalId) : getHospitalId(user, c.req.query('hospitalId')))
    : (user as any).hospitalId
  if (!hospitalId) return c.json({ error: 'hospitalId가 필요합니다' }, 400)

  const { date, off_type, lock_flag, base_off_type } = body
  if (!date) return c.json({ error: '날짜(date)는 필수입니다' }, 400)

  const changedBy = (user as any)?.username || (user as any)?.name || 'system'
  const newLockFlag = lock_flag === 0 ? 0 : 1

  // 기존 이력 조회 (이전 값 보존)
  const prevRow = await c.env.DB.prepare(
    `SELECT new_off_type, new_lock_flag FROM off_grant_history
     WHERE hospital_id=? AND target_date=?
     ORDER BY changed_at DESC LIMIT 1`
  ).bind(hospitalId, date).first<any>()

  const prevOffType  = prevRow?.new_off_type  ?? null
  const prevLockFlag = prevRow?.new_lock_flag ?? null

  // off_grant_history에 기록
  await c.env.DB.prepare(
    `INSERT INTO off_grant_history
       (hospital_id, target_date, prev_off_type, new_off_type,
        prev_lock_flag, new_lock_flag, base_off_type,
        changed_by, change_type, changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', datetime('now'))`
  ).bind(
    hospitalId, date,
    prevOffType,  off_type || prevOffType || 'monthly_fixed',
    prevLockFlag, newLockFlag,
    base_off_type || prevOffType || off_type || 'monthly_fixed',
    changedBy
  ).run()

  return c.json({
    success: true,
    date,
    off_type: off_type || prevOffType || 'monthly_fixed',
    lock_flag: newLockFlag,
    message: newLockFlag === 1 ? '수동 잠금 설정됨' : '잠금 해제됨'
  })
})

// ── 월 고정 휴무 강제 재계산 (잠금 해제) API ──────────────────────────────
// POST /api/schedule/off-grants/force-recalc
// body: { year, month, hospitalId?, off_types?: string[] }
// off_types: 해제할 타입 필터 (미지정 시 전체 해제)
// 예: { off_types: ['monthly_fixed'] } → monthly_fixed 잠금만 해제
//     { off_types: ['monthly_fixed', 'min_guarantee'] } → 두 타입 잠금 해제
//     {} → 전체 잠금 해제
schedule.post('/off-grants/force-recalc', async (c) => {
  const user = c.get('user')
  if (!isAdmin(user) && user?.role !== 'hospital') return c.json({ error: '권한이 없습니다' }, 403)

  const body = await c.req.json()
  const hospitalId = isAdmin(user)
    ? (body.hospitalId ? parseInt(body.hospitalId) : getHospitalId(user, c.req.query('hospitalId')))
    : (user as any).hospitalId
  if (!hospitalId) return c.json({ error: 'hospitalId가 필요합니다' }, 400)

  const year  = parseInt(body.year  || new Date().getFullYear().toString())
  const month = parseInt(body.month || (new Date().getMonth() + 1).toString())
  const monthStr = String(month).padStart(2, '0')
  const prefix   = `${year}-${monthStr}`

  // Phase E: 해제할 off_types 필터 (기본: 전체)
  const offTypesFilter: string[] | null = Array.isArray(body.off_types) && body.off_types.length > 0
    ? body.off_types
    : null

  const changedBy = (user as any)?.username || (user as any)?.name || 'system'

  // 해당 월 잠금된 이력 조회 후 필터에 따라 잠금 해제
  const lockRows = await c.env.DB.prepare(
    `SELECT target_date, new_off_type, base_off_type FROM off_grant_history
     WHERE hospital_id=? AND new_lock_flag=1 AND target_date LIKE ?
     ORDER BY changed_at DESC`
  ).bind(hospitalId, `${prefix}-%`).all<any>()

  const seenDates = new Set<string>()
  let unlockedCount = 0
  let skippedCount = 0

  for (const r of (lockRows.results || [])) {
    if (seenDates.has(r.target_date)) continue
    seenDates.add(r.target_date)

    // Phase E: off_types 필터 적용 — 해당 타입만 해제
    if (offTypesFilter && !offTypesFilter.includes(r.new_off_type)) {
      skippedCount++
      continue  // 이 타입은 잠금 유지
    }

    await c.env.DB.prepare(
      `INSERT INTO off_grant_history
         (hospital_id, target_date, prev_off_type, new_off_type,
          prev_lock_flag, new_lock_flag, base_off_type,
          changed_by, change_type, changed_at)
       VALUES (?, ?, ?, ?, 1, 0, ?, ?, 'force_recalc', datetime('now'))`
    ).bind(
      hospitalId, r.target_date,
      r.new_off_type, r.new_off_type,
      r.base_off_type || r.new_off_type, changedBy
    ).run()
    unlockedCount++
  }

  const filterDesc = offTypesFilter ? `(${offTypesFilter.join(', ')} 타입)` : '(전체)'

  return c.json({
    success: true,
    year, month,
    unlocked_count: unlockedCount,
    skipped_count:  skippedCount,
    filter_applied: offTypesFilter,
    message: `${unlockedCount}개 날짜 ${filterDesc} 잠금 해제됨. 다음 off-grants 조회 시 자동 재계산됩니다.`
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
// Phase D: 직원별 공휴일 정책 예외 API
// ════════════════════════════════════════════════════════════════

// ── 직원별 공휴일 정책 조회 ───────────────────────────────────
// GET /api/schedule/employees/:id/holiday-policy
schedule.get('/employees/:id/holiday-policy', async (c) => {
  const user = c.get('user')
  const empId = parseInt(c.req.param('id'))
  const emp = await c.env.DB.prepare(`SELECT * FROM employees WHERE id=?`).bind(empId).first<any>()
  if (!emp) return c.json({ error: '직원 없음' }, 404)
  if (!isAdmin(user) && emp.hospital_id !== (user as any).hospitalId) return c.json({ error: '권한 없음' }, 403)

  // 병원 기본값 조회
  const wsRows = await c.env.DB.prepare(
    `SELECT setting_key, setting_value FROM hospital_work_settings WHERE hospital_id=?`
  ).bind(emp.hospital_id).all<any>()
  const wsMap: Record<string,string> = {}
  for (const r of (wsRows.results || [])) wsMap[r.setting_key] = r.setting_value
  const hospitalPolicy = wsMap.holiday_policy || 'off'

  // 직원 오버라이드 (null이면 병원 기본값 상속)
  const override  = emp.holiday_policy_override ?? null
  const effective = override ?? hospitalPolicy

  return c.json({
    employee_id:      empId,
    employee_name:    emp.name,
    hospital_policy:  hospitalPolicy,     // 병원 기본값
    override:         override,           // null=상속, 또는 'off'|'work_pay'|'work_substitute'
    effective_policy: effective,          // 실제 적용값
    source:           override ? 'override' : 'hospital'
  })
})

// ── 직원별 공휴일 정책 오버라이드 설정 ───────────────────────
// PUT /api/schedule/employees/:id/holiday-policy
// body: { override: 'off'|'work_pay'|'work_substitute'|null }
schedule.put('/employees/:id/holiday-policy', async (c) => {
  const user = c.get('user')
  if (!isAdmin(user) && user?.role !== 'hospital') return c.json({ error: '권한이 없습니다' }, 403)

  const empId = parseInt(c.req.param('id'))
  const emp = await c.env.DB.prepare(`SELECT * FROM employees WHERE id=?`).bind(empId).first<any>()
  if (!emp) return c.json({ error: '직원 없음' }, 404)
  if (!isAdmin(user) && emp.hospital_id !== (user as any).hospitalId) return c.json({ error: '권한 없음' }, 403)

  const body = await c.req.json()
  const override = body.override === '' ? null : (body.override ?? null)  // 빈 문자열도 null 처리
  const validPolicies = [null, 'off', 'work_pay', 'work_substitute']
  if (!validPolicies.includes(override)) {
    return c.json({ error: '유효한 정책값이 아닙니다 (off|work_pay|work_substitute|null)' }, 400)
  }

  const changedBy = (user as any)?.username || (user as any)?.name || 'system'
  const prevOverride = emp.holiday_policy_override ?? null

  await c.env.DB.prepare(
    `UPDATE employees SET holiday_policy_override=?, updated_at=datetime('now') WHERE id=?`
  ).bind(override, empId).run()

  // 변경 이력 기록
  if (prevOverride !== override) {
    await c.env.DB.prepare(
      `INSERT INTO work_settings_history
         (hospital_id, setting_key, prev_value, new_value, changed_by, change_type)
       VALUES (?, ?, ?, ?, ?, 'manual')`
    ).bind(
      emp.hospital_id,
      `employee_${empId}_holiday_policy_override`,
      prevOverride ?? '(병원기본값 상속)',
      override ?? '(병원기본값 상속)',
      changedBy
    ).run()
  }

  return c.json({
    success: true,
    employee_id: empId,
    prev_override: prevOverride,
    new_override:  override,
    message: override ? `공휴일 정책 개별 설정: ${override}` : '병원 기본값 상속으로 초기화'
  })
})

// ── 직원별 공휴일 예외 처리 기록 (특정 날짜) ─────────────────
// POST /api/schedule/employees/:id/holiday-exceptions
// body: { holidayDate, holidayName?, appliedPolicy, allowancePaid?, substituteDate?, note? }
schedule.post('/employees/:id/holiday-exceptions', async (c) => {
  const user = c.get('user')
  if (!isAdmin(user) && user?.role !== 'hospital') return c.json({ error: '권한이 없습니다' }, 403)

  const empId = parseInt(c.req.param('id'))
  const emp = await c.env.DB.prepare(`SELECT * FROM employees WHERE id=?`).bind(empId).first<any>()
  if (!emp) return c.json({ error: '직원 없음' }, 404)

  const body = await c.req.json()
  const { holidayDate, holidayName, appliedPolicy, allowancePaid, substituteDate, note } = body
  if (!holidayDate || !appliedPolicy) return c.json({ error: 'holidayDate, appliedPolicy는 필수입니다' }, 400)

  const changedBy = (user as any)?.username || (user as any)?.name || 'system'

  // 직원의 실제 적용 정책 확인 (병원기본 vs 오버라이드)
  const wsRows = await c.env.DB.prepare(
    `SELECT setting_key, setting_value FROM hospital_work_settings WHERE hospital_id=?`
  ).bind(emp.hospital_id).all<any>()
  const wsMap: Record<string,string> = {}
  for (const r of (wsRows.results || [])) wsMap[r.setting_key] = r.setting_value
  const hospitalPolicy = wsMap.holiday_policy || 'off'
  const override = emp.holiday_policy_override ?? null
  const policySource = override && override !== hospitalPolicy ? 'override' : 'hospital'

  await c.env.DB.prepare(
    `INSERT INTO employee_holiday_exceptions
       (hospital_id, employee_id, holiday_date, holiday_name,
        applied_policy, allowance_paid, substitute_date,
        policy_source, note, created_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(hospital_id, employee_id, holiday_date) DO UPDATE SET
       applied_policy  = excluded.applied_policy,
       allowance_paid  = excluded.allowance_paid,
       substitute_date = excluded.substitute_date,
       policy_source   = excluded.policy_source,
       note            = excluded.note,
       created_by      = excluded.created_by,
       updated_at      = datetime('now')`
  ).bind(
    emp.hospital_id, empId, holidayDate, holidayName || '',
    appliedPolicy,
    allowancePaid ? 1 : 0,
    substituteDate || null,
    policySource,
    note || '', changedBy
  ).run()

  return c.json({ success: true, policy_source: policySource, applied_policy: appliedPolicy })
})

// ── 직원별 공휴일 예외 처리 목록 조회 ──────────────────────────
// GET /api/schedule/employees/:id/holiday-exceptions?year=&month=
schedule.get('/employees/:id/holiday-exceptions', async (c) => {
  const user = c.get('user')
  const empId = parseInt(c.req.param('id'))
  const emp = await c.env.DB.prepare(`SELECT * FROM employees WHERE id=?`).bind(empId).first<any>()
  if (!emp) return c.json({ error: '직원 없음' }, 404)
  if (!isAdmin(user) && emp.hospital_id !== (user as any).hospitalId) return c.json({ error: '권한 없음' }, 403)

  const year  = c.req.query('year')  || new Date().getFullYear().toString()
  const month = c.req.query('month')
  const prefix = month ? `${year}-${String(month).padStart(2,'0')}` : year

  const rows = await c.env.DB.prepare(
    `SELECT * FROM employee_holiday_exceptions
     WHERE hospital_id=? AND employee_id=? AND holiday_date LIKE ?
     ORDER BY holiday_date`
  ).bind(emp.hospital_id, empId, `${prefix}%`).all<any>()

  return c.json({ employee_id: empId, exceptions: rows.results || [] })
})

// ── 병원 전체 공휴일 예외 처리 현황 조회 (관리자용) ─────────────
// GET /api/schedule/holiday-policy-summary?year=&month=&hospitalId=
schedule.get('/holiday-policy-summary', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const year  = c.req.query('year')  || new Date().getFullYear().toString()
  const month = c.req.query('month')
  const prefix = month ? `${year}-${String(month).padStart(2,'0')}` : year

  // 병원 기본 공휴일 정책
  const wsRows = await c.env.DB.prepare(
    `SELECT setting_key, setting_value FROM hospital_work_settings WHERE hospital_id=?`
  ).bind(hospitalId).all<any>()
  const wsMap: Record<string,string> = {}
  for (const r of (wsRows.results || [])) wsMap[r.setting_key] = r.setting_value
  const hospitalPolicy     = wsMap.holiday_policy      || 'off'
  const cycleHolidayPolicy = wsMap.cycle_holiday_policy || 'add'

  // 직원별 오버라이드 목록
  const empRows = await c.env.DB.prepare(
    `SELECT id, name, team, holiday_policy_override
     FROM employees
     WHERE hospital_id=? AND is_active=1
     ORDER BY sort_order`
  ).bind(hospitalId).all<any>()

  const employees = (empRows.results || []).map((e: any) => ({
    id:               e.id,
    name:             e.name,
    team:             e.team,
    override:         e.holiday_policy_override ?? null,
    effective_policy: e.holiday_policy_override ?? hospitalPolicy,
    source:           e.holiday_policy_override ? 'override' : 'hospital',
  }))

  // 예외 처리 이력 집계
  const excRows = await c.env.DB.prepare(
    `SELECT employee_id, applied_policy, policy_source, allowance_paid, substitute_date
     FROM employee_holiday_exceptions
     WHERE hospital_id=? AND holiday_date LIKE ?`
  ).bind(hospitalId, `${prefix}%`).all<any>()

  const excMap: Record<number, any[]> = {}
  for (const r of (excRows.results || [])) {
    if (!excMap[r.employee_id]) excMap[r.employee_id] = []
    excMap[r.employee_id].push(r)
  }

  return c.json({
    hospital_id:          hospitalId,
    hospital_policy:      hospitalPolicy,
    cycle_holiday_policy: cycleHolidayPolicy,
    period:               prefix,
    employees,
    exceptions_by_employee: excMap,
    override_count:       employees.filter((e: any) => e.override !== null).length,
    total_employees:      employees.length,
  })
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

  const [schedRows, empRows, minStaffRows, workSettingsRows] = await Promise.all([
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
    ).bind(hospitalId).all<any>(),

    c.env.DB.prepare(
      `SELECT setting_key, setting_value FROM hospital_work_settings WHERE hospital_id=?`
    ).bind(hospitalId).all<any>()
  ])

  // 근무 설정값 파싱
  const wsMap: Record<string,string> = {}
  for (const r of (workSettingsRows.results||[])) wsMap[r.setting_key] = r.setting_value
  const clusterThreshold = parseInt(wsMap['leave_cluster_threshold'] || '40')

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

  // 연차/휴무 쏠림 감지 — 비율 기준으로 변경 (전체 직원 대비 %)
  // clusterThreshold: 전체 직원 수 대비 연차 쏠림 비율(%) 기준 (기본 40%)
  const totalEmpCount = emps.length || 1
  const clusterRatio = clusterThreshold <= 20
    ? 0.40  // 설정값이 20 이하인 경우(기존 절대값 방식) → 40% 비율로 자동 전환
    : clusterThreshold / 100  // 설정값을 퍼센트로 해석 (예: 40 → 40%)
  const clusterDates: Record<string, {annual: number, rest: number, warning: boolean}> = {}
  for (const [date, data] of Object.entries(dateMap)) {
    const annualRatio = data.annual / totalEmpCount
    const restRatio   = data.rest   / totalEmpCount
    // 연차: 전체 직원의 40% 이상 집중 시 경고
    // 휴무: 전체 직원의 50% 이상 집중 시 경고
    if (annualRatio >= clusterRatio || restRatio >= clusterRatio * 1.25) {
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
  const REST_CODES = new Set(['휴','연','경조','병가','반차','대체','대휴','공가','무급'])

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

  const REST_CODES = new Set(['휴','연','경조','병가','반차','대체','대휴','공가','무급'])

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
  leave_cluster_threshold:  '40',
  legal_warning_enabled:    '1',
  ot_cost_enabled:          '1',
  dispatch_enabled:         '1',
  // 인력 운영 기준
  required_staff_count:     '0',   // 일일 기준(목표) 근무인원 (0=미설정)
  // ── 근무제 유형 ──────────────────────────────────────────────────
  // 'weekly5'      : 주5일제 — 토·일·공휴일 자동 휴무
  // 'cycle'        : 순환근무제 — N일 근무 + M일 휴무 반복
  // 'monthly_fixed': 월 고정 휴무제 — 매월 N일 고정 (공휴일 수 무관)
  // 'mixed'        : 혼합형 — 순환근무 기본 + 공휴일 별도 정책 적용
  off_grant_type:           'weekly5',
  // 순환근무 패턴 (off_grant_type='cycle' | 'mixed' 일 때 사용)
  off_cycle_work_days:      '5',   // 연속 근무일수
  off_cycle_rest_days:      '2',   // 연속 휴무일수
  off_cycle_start_date:     '',    // 순환 시작 기준일 (YYYY-MM-DD, 비어있으면 해당 월 1일)
  // ── 월 고정 휴무제 (off_grant_type='monthly_fixed' 일 때 사용) ──
  monthly_fixed_off_days:   '10',  // 월 고정 휴무일수
  // ── 월 최소 휴무 보장 (0=미사용) ────────────────────────────────
  monthly_min_off_days:     '0',   // 최소 보장 휴무일 — 부족분 min_guarantee 자동 삽입
  // ── 공휴일 처리 정책 (병원 전체 기본값) ─────────────────────────
  // 'off'              : 공휴일 = 휴무 (기본)
  // 'work_pay'         : 공휴일 = 근무 + 공휴수당 지급
  // 'work_substitute'  : 공휴일 = 근무 + 대체휴무 자동 생성
  holiday_policy:           'off',
  // ── 순환/혼합형에서 공휴일이 근무일과 겹칠 때 처리 방식 ──────────
  // 'ignore'    : 순환패턴 유지 (공휴일 별도 처리 없음)
  // 'pay'       : 공휴일이 근무일과 겹치면 공휴수당 지급
  // 'add'       : 공휴일이 근무일과 겹치면 추가 휴무 부여
  // 'substitute': 공휴일이 근무일과 겹치면 대체휴무 자동 생성
  cycle_holiday_policy:     'add',
  // ── 이력 관리 설정 ───────────────────────────────────────────────
  off_grant_log_enabled:    '1',   // 휴무 수정 이력 저장 여부 (1=사용)
  // ── 월차 자동 생성 정책 (1년 미만 근무자) ───────────────────────
  // monthly_leave_enabled       : '1' = 활성화(기본), '0' = 비활성화
  // monthly_leave_attendance_rule: 개근 판단 기준
  //   'full'    = 결근 0일 (완전 개근, 기본)
  //   'partial' = 결근 1일 이하
  //   'ratio'   = 출근율 N% 이상 (monthly_leave_attendance_ratio 참조)
  // monthly_leave_attendance_ratio: 출근율 기준 (%) - ratio 방식일 때
  // monthly_leave_max_days      : 최대 발생 월차 일수 (법정 11일)
  // monthly_leave_auto_transition: 1년 도달 시 연차로 자동 전환 여부
  monthly_leave_enabled:           '1',
  monthly_leave_attendance_rule:   'full',
  monthly_leave_attendance_ratio:  '80',
  monthly_leave_max_days:          '11',
  monthly_leave_auto_transition:   '1',
  // ── 급여 공개 정책 ───────────────────────────────────────────────
  // '0' = 비공개 (기본) — 운영진 대시보드에서 기본급·월급여 컬럼 숨김
  // '1' = 공개          — 운영진 대시보드에서 기본급·월급여 표시
  show_base_salary:                '0',
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
  if (!isAdmin(user) && user?.role !== 'hospital') return c.json({ error: '권한이 없습니다' }, 403)
  const body = await c.req.json()
  // admin이 hospitalId를 body에 포함해서 보낼 수 있음
  const hospitalId = isAdmin(user)
    ? (body.hospitalId ? parseInt(body.hospitalId) : getHospitalId(user, c.req.query('hospitalId')))
    : user.hospitalId
  if (!hospitalId) return c.json({ error: 'hospitalId가 필요합니다' }, 400)

  // 변경 전 기존값 조회 (이력 저장용)
  const existingRows = await c.env.DB.prepare(
    `SELECT setting_key, setting_value FROM hospital_work_settings WHERE hospital_id=?`
  ).bind(hospitalId).all<any>()
  const existingMap: Record<string, string> = {}
  for (const r of (existingRows.results || [])) existingMap[r.setting_key] = r.setting_value

  const changedBy  = (user as any)?.username || (user as any)?.name || 'system'
  const changeType = body._changeType || 'manual'  // 'manual' | 'force_recalc'

  for (const [key, value] of Object.entries(body)) {
    if (key === 'hospitalId' || key === '_changeType') continue  // 내부 키 제외
    const strVal  = String(value)
    const prevVal = existingMap[key] ?? DEFAULT_WORK_SETTINGS[key] ?? null

    // 실제 변경이 있을 때만 처리
    if (prevVal !== strVal) {
      // 설정값 저장 (upsert)
      await c.env.DB.prepare(
        `INSERT INTO hospital_work_settings (hospital_id, setting_key, setting_value)
         VALUES (?,?,?)
         ON CONFLICT(hospital_id, setting_key) DO UPDATE SET
           setting_value=excluded.setting_value, updated_at=datetime('now')`
      ).bind(hospitalId, key, strVal).run()

      // 이력 저장 (work_settings_history)
      await c.env.DB.prepare(
        `INSERT INTO work_settings_history
           (hospital_id, setting_key, prev_value, new_value, changed_by, change_type)
         VALUES (?,?,?,?,?,?)`
      ).bind(hospitalId, key, prevVal, strVal, changedBy, changeType).run()
    } else {
      // 값 변경 없어도 upsert는 유지 (다른 필드 저장 보장)
      await c.env.DB.prepare(
        `INSERT INTO hospital_work_settings (hospital_id, setting_key, setting_value)
         VALUES (?,?,?)
         ON CONFLICT(hospital_id, setting_key) DO UPDATE SET
           setting_value=excluded.setting_value, updated_at=datetime('now')`
      ).bind(hospitalId, key, strVal).run()
    }
  }
  return c.json({ success: true })
})

// 근무설정 변경 이력 조회
schedule.get('/work-settings/history', async (c) => {
  const user = c.get('user')
  if (!isAdmin(user) && user?.role !== 'hospital') return c.json({ error: '권한 없음' }, 403)
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const limit  = parseInt(c.req.query('limit')  || '50')
  const offset = parseInt(c.req.query('offset') || '0')
  const rows = await c.env.DB.prepare(
    `SELECT * FROM work_settings_history
     WHERE hospital_id=?
     ORDER BY changed_at DESC
     LIMIT ? OFFSET ?`
  ).bind(hospitalId, limit, offset).all<any>()
  return c.json(rows.results || [])
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

// ══════════════════════════════════════════════════════════════
// QR 코드 기반 직원 스케줄 공유
// ══════════════════════════════════════════════════════════════

// 직원별 공유 토큰 생성 / 조회
schedule.get('/share-tokens', async (c) => {
  const user = c.get('user' as any) as any
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  if (!hospitalId) return c.json({ error: 'Unauthorized' }, 401)

  const rows = await c.env.DB.prepare(`
    SELECT t.id, t.employee_id, t.token, t.created_at, t.is_active,
           e.name as emp_name, e.position
    FROM schedule_share_tokens t
    JOIN employees e ON e.id = t.employee_id
    WHERE t.hospital_id = ? AND e.is_active = 1
    ORDER BY e.sort_order, e.name
  `).bind(hospitalId).all<any>()

  return c.json({ tokens: rows.results || [] })
})

// 직원 공유 토큰 생성
schedule.post('/share-tokens', async (c) => {
  const user = c.get('user' as any) as any
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  if (!hospitalId) return c.json({ error: 'Unauthorized' }, 401)

  const { employeeId } = await c.req.json()
  if (!employeeId) return c.json({ error: 'employeeId 필요' }, 400)

  // 기존 토큰 비활성화
  await c.env.DB.prepare(`UPDATE schedule_share_tokens SET is_active=0 WHERE hospital_id=? AND employee_id=?`)
    .bind(hospitalId, employeeId).run()

  // 새 토큰 생성 (UUID)
  const token = crypto.randomUUID().replace(/-/g, '')
  await c.env.DB.prepare(`
    INSERT INTO schedule_share_tokens (hospital_id, employee_id, token, is_active)
    VALUES (?, ?, ?, 1)
  `).bind(hospitalId, employeeId, token).run()

  return c.json({ token })
})

// 모든 직원 토큰 일괄 생성
schedule.post('/share-tokens/bulk', async (c) => {
  const user = c.get('user' as any) as any
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  if (!hospitalId) return c.json({ error: 'Unauthorized' }, 401)

  const employees = await c.env.DB.prepare(`
    SELECT id FROM employees WHERE hospital_id=? AND is_active=1
  `).bind(hospitalId).all<any>()

  const results: any[] = []
  for (const emp of (employees.results || [])) {
    // 기존 활성 토큰이 있으면 재사용
    const existing = await c.env.DB.prepare(`
      SELECT token FROM schedule_share_tokens WHERE hospital_id=? AND employee_id=? AND is_active=1
    `).bind(hospitalId, emp.id).first<any>()
    if (existing) { results.push({ employeeId: emp.id, token: existing.token }); continue }

    const token = crypto.randomUUID().replace(/-/g, '')
    await c.env.DB.prepare(`
      INSERT INTO schedule_share_tokens (hospital_id, employee_id, token, is_active)
      VALUES (?, ?, ?, 1)
    `).bind(hospitalId, emp.id, token).run()
    results.push({ employeeId: emp.id, token })
  }

  return c.json({ created: results.length, tokens: results })
})

// ══════════════════════════════════════════════════════════════
// 전체 팀 스케줄 공유 (QR 스캔 → 전체 근무표 공개 페이지)
// ══════════════════════════════════════════════════════════════

// 팀 공유 토큰 조회
schedule.get('/team-token', async (c) => {
  const user = c.get('user' as any) as any
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  if (!hospitalId) return c.json({ error: 'Unauthorized' }, 401)

  const row = await c.env.DB.prepare(
    `SELECT token FROM team_share_tokens WHERE hospital_id=? AND is_active=1`
  ).bind(hospitalId).first<any>()

  return c.json({ token: row?.token || null })
})

// 팀 공유 토큰 생성/재생성
schedule.post('/team-token', async (c) => {
  const user = c.get('user' as any) as any
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  if (!hospitalId) return c.json({ error: 'Unauthorized' }, 401)

  const token = crypto.randomUUID().replace(/-/g, '')
  // UPSERT: 기존 레코드가 있으면 토큰 갱신, 없으면 신규 삽입
  await c.env.DB.prepare(
    `INSERT INTO team_share_tokens (hospital_id, token, is_active)
     VALUES (?,?,1)
     ON CONFLICT(hospital_id) DO UPDATE SET token=excluded.token, is_active=1`
  ).bind(hospitalId, token).run()

  return c.json({ token })
})

export default schedule
