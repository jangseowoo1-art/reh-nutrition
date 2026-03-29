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
    healthCertExpire, healthExamDate, healthExamStatus, annualLeaveTotal, sortOrder
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
       annual_leave_total, sort_order, is_active
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).bind(
    hid, name, team || 'cook', positionId || null, position || '',
    empNumber || '', birthDate || '', hireDate || '',
    employmentType || 'full', JSON.stringify(workParts || []),
    team || 'cook', phone || '', email || '', address || '', emergencyContact || '',
    note || '', healthCertExpire || '', healthExamDate || '',
    healthExamStatus || 'pending', annualLeaveTotal || 15, finalSortOrder
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
    healthCertExpire, healthExamDate, healthExamStatus, annualLeaveTotal, sortOrder, isActive
  } = body

  await c.env.DB.prepare(
    `UPDATE employees SET
       name = ?, team = ?, position_id = ?, position = ?, emp_number = ?,
       birth_date = ?, hire_date = ?, resign_date = ?,
       employment_type = ?, work_parts = ?, section = ?,
       phone = ?, email = ?, address = ?, emergency_contact = ?, note = ?,
       health_cert_expire = ?, health_exam_date = ?, health_exam_status = ?,
       annual_leave_total = ?, sort_order = ?, is_active = ?,
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

  const schedules = await c.env.DB.prepare(
    `SELECT s.*, sh.shift_name, sh.start_time, sh.end_time, sh.color as shift_color
     FROM daily_schedules s
     LEFT JOIN schedule_shifts sh ON s.shift_id = sh.id
     WHERE s.hospital_id = ?
       AND strftime('%Y', s.work_date) = ?
       AND strftime('%m', s.work_date) = printf('%02d', ?)
     ORDER BY s.work_date`
  ).bind(hospitalId, year, month).all<any>()

  const shifts = await c.env.DB.prepare(
    `SELECT * FROM schedule_shifts WHERE hospital_id = ? AND is_active = 1 ORDER BY sort_order`
  ).bind(hospitalId).all<any>()

  // 공휴일 조회
  const paddedMonth = String(month).padStart(2, '0')
  const holidays = await c.env.DB.prepare(
    `SELECT * FROM holidays
     WHERE (hospital_id IS NULL OR hospital_id = ?)
       AND holiday_date LIKE ?`
  ).bind(hospitalId, `${year}-${paddedMonth}-%`).all<any>()

  return c.json({
    employees: employees.results,
    schedules: schedules.results,
    shifts: shifts.results,
    holidays: holidays.results
  })
})

// 스케줄 저장 (upsert)
schedule.post('/save', async (c) => {
  const user = c.get('user')
  const { employeeId, workDate, shiftCode, shiftId, leaveType, isOvertime, overtimeHours, isTempStaff, note } = await c.req.json()
  const hospitalId = getHospitalId(user, undefined)

  // 영양사는 본인 병원만
  const emp = await c.env.DB.prepare(`SELECT hospital_id FROM employees WHERE id = ?`).bind(employeeId).first<any>()
  if (!emp) return c.json({ error: '직원을 찾을 수 없습니다' }, 404)
  if (!isAdmin(user) && emp.hospital_id !== user.hospitalId) return c.json({ error: '권한 없음' }, 403)

  await c.env.DB.prepare(
    `INSERT INTO daily_schedules (hospital_id, employee_id, work_date, shift_code, shift_id, leave_type, is_overtime, overtime_hours, is_temp_staff, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(hospital_id, employee_id, work_date) DO UPDATE SET
       shift_code = excluded.shift_code,
       shift_id = excluded.shift_id,
       leave_type = excluded.leave_type,
       is_overtime = excluded.is_overtime,
       overtime_hours = excluded.overtime_hours,
       is_temp_staff = excluded.is_temp_staff,
       note = excluded.note,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(
    emp.hospital_id, employeeId, workDate, shiftCode || '', shiftId || null,
    leaveType || null, isOvertime ? 1 : 0, overtimeHours || 0, isTempStaff ? 1 : 0, note || null
  ).run()
  return c.json({ success: true })
})

// 스케줄 일괄 저장 (배치)
schedule.post('/save-batch', async (c) => {
  const user = c.get('user')
  const { items } = await c.req.json()
  if (!Array.isArray(items) || items.length === 0) return c.json({ success: true, count: 0 })

  let count = 0
  for (const item of items) {
    const { employeeId, workDate, shiftCode, shiftId, leaveType, isOvertime, overtimeHours, isTempStaff, note } = item
    const emp = await c.env.DB.prepare(`SELECT hospital_id FROM employees WHERE id = ?`).bind(employeeId).first<any>()
    if (!emp) continue
    if (!isAdmin(user) && emp.hospital_id !== user.hospitalId) continue

    await c.env.DB.prepare(
      `INSERT INTO daily_schedules (hospital_id, employee_id, work_date, shift_code, shift_id, leave_type, is_overtime, overtime_hours, is_temp_staff, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(hospital_id, employee_id, work_date) DO UPDATE SET
         shift_code = excluded.shift_code, shift_id = excluded.shift_id,
         leave_type = excluded.leave_type, is_overtime = excluded.is_overtime,
         overtime_hours = excluded.overtime_hours, is_temp_staff = excluded.is_temp_staff,
         note = excluded.note, updated_at = CURRENT_TIMESTAMP`
    ).bind(
      emp.hospital_id, employeeId, workDate, shiftCode || '', shiftId || null,
      leaveType || null, isOvertime ? 1 : 0, overtimeHours || 0, isTempStaff ? 1 : 0, note || null
    ).run()
    count++
  }
  return c.json({ success: true, count })
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

export default schedule
