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

  const paddedMonth = String(month).padStart(2, '0')

  const [schedRows, shiftRows, holidayRows, leaveRows, subRows] = await Promise.all([
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

  return c.json({
    employees:       employees.results || [],
    sched_map:       schedMap,
    shifts:          shiftRows.results || [],
    holidays:        holidayRows.results || [],
    leave_map:       leaveMap,
    substitute_days: subRows.results || []
  })
})

// 스케줄 저장 (upsert)
schedule.post('/save', async (c) => {
  const user = c.get('user')
  const { employeeId, workDate, shiftCode, shiftId, leaveType,
          isOvertime, overtimeHours, isTempStaff, isNightWork, tempType, tempHours, note } = await c.req.json()
  const hospitalId = getHospitalId(user, undefined)

  // 영양사는 본인 병원만
  const emp = await c.env.DB.prepare(`SELECT hospital_id FROM employees WHERE id = ?`).bind(employeeId).first<any>()
  if (!emp) return c.json({ error: '직원을 찾을 수 없습니다' }, 404)
  if (!isAdmin(user) && emp.hospital_id !== user.hospitalId) return c.json({ error: '권한 없음' }, 403)

  await c.env.DB.prepare(
    `INSERT INTO daily_schedules (hospital_id, employee_id, work_date, shift_code, shift_id, leave_type, is_overtime, overtime_hours, is_temp_staff, is_night_work, temp_type, temp_hours, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(hospital_id, employee_id, work_date) DO UPDATE SET
       shift_code = excluded.shift_code,
       shift_id = excluded.shift_id,
       leave_type = excluded.leave_type,
       is_overtime = excluded.is_overtime,
       overtime_hours = excluded.overtime_hours,
       is_temp_staff = excluded.is_temp_staff,
       is_night_work = excluded.is_night_work,
       temp_type = excluded.temp_type,
       temp_hours = excluded.temp_hours,
       note = excluded.note,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(
    emp.hospital_id, employeeId, workDate, shiftCode || '', shiftId || null,
    leaveType || null, isOvertime ? 1 : 0, overtimeHours || 0, isTempStaff ? 1 : 0,
    isNightWork ? 1 : 0, tempType || null, tempHours || 0, note || null
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
  if (!isAdmin(user)) return c.json({ error: '관리자만 가능합니다' }, 403)
  const emp = await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(c.req.param('id')).first<any>()
  if (!emp) return c.json({ error: '직원 없음' }, 404)

  const { year, totalDays, usedDays, note } = await c.req.json()
  await c.env.DB.prepare(
    `INSERT INTO employee_leaves (hospital_id, employee_id, year, leave_type, total_days, used_days, note)
     VALUES (?, ?, ?, 'annual', ?, ?, ?)
     ON CONFLICT(hospital_id, employee_id, year, leave_type) DO UPDATE SET
       total_days = excluded.total_days, used_days = excluded.used_days,
       note = excluded.note, updated_at = datetime('now')`
  ).bind(emp.hospital_id, emp.id, year, totalDays, usedDays || 0, note || '').run()

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
  const monthly = { workDays:0, otHours:0, nightDays:0, annualDays:0, holidayWork:0, totalOtCost:0, totalNightCost:0 }
  for (const v of Object.values(dailyMap)) {
    const code = v.code
    if (code === '연') monthly.annualDays++
    else if (code && !REST_CODES.has(code)) {
      monthly.workDays++
      if (v.isHoliday) monthly.holidayWork++
      if (v.isNight) monthly.nightDays++
      monthly.otHours     += v.otHours
      monthly.totalOtCost += v.otCost
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
  if (!isAdmin(user)) return c.json({ error: '관리자만 가능합니다' }, 403)
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

// 인건비 월간 집계 (운영진용)
schedule.get('/labor-cost-report/:year/:month', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospitalId(user, c.req.query('hospitalId'))
  const { year, month } = c.req.param()
  const paddedMonth = String(month).padStart(2,'0')

  const [scheds, emps, otSettingsAll, laborCosts] = await Promise.all([
    c.env.DB.prepare(
      `SELECT s.*, e.name as emp_name, e.team, p.name as position_name
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
    ).bind(hospitalId).all<any>()
  ])

  const schedList  = scheds.results || []
  const empList    = emps.results || []
  const otMap: Record<number, any> = {}
  ;(otSettingsAll.results||[]).forEach(o => { otMap[o.employee_id] = o })
  const costMap: Record<string, number> = {}
  ;(laborCosts.results||[]).forEach(c2 => { costMap[c2.cost_type] = c2.unit_price })

  const REST_CODES = new Set(['휴','연','경조','병가'])

  // 직원별 집계
  const byEmp: Record<number, {
    emp: any, otHours: number, nightDays: number, holidayDays: number,
    tempDays: Record<string, number>, tempHours: number,
    otCost: number, nightCost: number, dispatchCost: number, parttimeCost: number
  }> = {}

  for (const emp of empList) {
    byEmp[emp.id] = { emp, otHours:0, nightDays:0, holidayDays:0, tempDays:{}, tempHours:0, otCost:0, nightCost:0, dispatchCost:0, parttimeCost:0 }
  }

  for (const s of schedList) {
    const rec = byEmp[s.employee_id]
    if (!rec) continue
    const ot = otMap[s.employee_id]
    const hourly = ot?.hourly_wage || 0
    const otRate = ot?.ot_rate || 1.5
    const nightRate = ot?.night_rate || 0.5
    const dow = new Date(s.work_date).getDay()
    const isHoliday = dow === 0 || dow === 6

    const otHrs = s.overtime_hours || 0
    if (otHrs > 0) {
      rec.otHours += otHrs
      if (hourly > 0) rec.otCost += Math.round(otHrs * hourly * otRate)
    }
    if (s.is_night_work) {
      rec.nightDays++
      if (hourly > 0) rec.nightCost += Math.round(8 * hourly * nightRate)
    }
    if (isHoliday && s.shift_code && !REST_CODES.has(s.shift_code)) {
      rec.holidayDays++
    }
    if (s.is_temp_staff) {
      const tt = s.temp_type || 'dispatch_9h'
      rec.tempDays[tt] = (rec.tempDays[tt] || 0) + 1
      const unitPrice = costMap[tt] || 0
      rec.dispatchCost += unitPrice
      if (tt === 'parttime') {
        rec.tempHours += s.temp_hours || 0
        rec.parttimeCost += Math.round((s.temp_hours||0) * (costMap['parttime_hourly']||0))
      }
    }
  }

  const totalOtCost       = Object.values(byEmp).reduce((a,v) => a + v.otCost, 0)
  const totalNightCost    = Object.values(byEmp).reduce((a,v) => a + v.nightCost, 0)
  const totalDispatchCost = Object.values(byEmp).reduce((a,v) => a + v.dispatchCost, 0)
  const totalParttimeCost = Object.values(byEmp).reduce((a,v) => a + v.parttimeCost, 0)

  return c.json({
    year, month, hospitalId,
    byEmployee: Object.values(byEmp),
    totals: { otCost: totalOtCost, nightCost: totalNightCost, dispatchCost: totalDispatchCost, parttimeCost: totalParttimeCost, grand: totalOtCost+totalNightCost+totalDispatchCost+totalParttimeCost },
    costSettings: costMap,
    otSettings: otMap
  })
})

export default schedule
