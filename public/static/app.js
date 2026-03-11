// ══════════════════════════════════════════════════════════════
//  병원 급식 예산 관리 - 메인 앱 JS v2.0
// ══════════════════════════════════════════════════════════════

const App = {
  token: localStorage.getItem('token'),
  role: localStorage.getItem('role'),
  hospitalName: localStorage.getItem('hospitalName'),
  username: localStorage.getItem('username'),
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth() + 1,
  currentPage: '',
  charts: {}
}

// 마감 승인 폴링 타이머 ID (전역에 선언해 navigateTo에서 접근 가능)
let _closingPollTimer = null
function stopClosingPoll() {
  if (_closingPollTimer) {
    clearInterval(_closingPollTimer)
    _closingPollTimer = null
  }
}
function startClosingPoll(approvedYear, approvedMonth) {
  stopClosingPoll()
  _closingPollTimer = setInterval(async () => {
    try {
      const am = await api('GET', '/api/settings/active-month')
      if (!am) return
      const isAdvanced = (am.year > approvedYear) ||
        (am.year === approvedYear && am.month > approvedMonth)
      if (isAdvanced || (am.closingStatus === 'open' && am.year === approvedYear && am.month === approvedMonth)) {
        stopClosingPoll()
        App.currentYear = am.year
        App.currentMonth = am.month
        updateMonthDisplay()
        showToast(`관리자가 마감을 승인했습니다. ${am.year}년 ${am.month}월로 전환됩니다.`, 'success')
        renderSettings()
      }
    } catch (e) {}
  }, 20000) // 20초마다 확인
}

// ── 초기화 ────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  if (!App.token) { window.location.href = '/login'; return }

  // 병원 계정이면 DB의 활성 월(current_year/month)로 App 상태 동기화
  if (App.role !== 'admin') {
    try {
      const am = await api('GET', '/api/settings/active-month')
      if (am?.year) {
        App.currentYear = am.year
        App.currentMonth = am.month
      }
    } catch(e) {}
    // heartbeat 시작 (60초마다 현재 페이지 서버에 전달)
    startHeartbeat()
  }

  initSidebar()
  const path = window.location.pathname
  const pageMap = {
    '/dashboard': 'dashboard', '/': 'dashboard',
    '/orders': 'orders', '/meals': 'meals',
    '/schedule': 'schedule', '/analysis': 'analysis',
    '/settings': 'settings', '/admin': 'admin'
  }
  navigateTo(pageMap[path] || 'dashboard')
})

// ── 세션 heartbeat (병원 계정 전용) ─────────────────────────
let _heartbeatTimer = null
function startHeartbeat() {
  if (_heartbeatTimer) clearInterval(_heartbeatTimer)
  sendHeartbeat()
  _heartbeatTimer = setInterval(sendHeartbeat, 60000) // 60초마다
}
async function sendHeartbeat() {
  if (App.role === 'admin') return
  try {
    await api('POST', '/api/settings/session/heartbeat', { page: App.currentPage })
  } catch(e) {}
}

function initSidebar() {
  document.getElementById('hospitalNameDisplay').textContent = App.hospitalName || '병원'
  document.getElementById('usernameDisplay').textContent = App.username
  document.getElementById('roleDisplay').textContent = App.role === 'admin' ? '관리자' : '영양사'
  updateMonthDisplay()
  const menus = App.role === 'admin' ? getAdminMenus() : getHospitalMenus()
  document.getElementById('menuContainer').innerHTML = menus.map(renderMenuItem).join('')
  // 관리자면 알림 배지 로드
  if (App.role === 'admin') loadNotificationBadge()
}

async function loadNotificationBadge() {
  const data = await api('GET', '/api/admin/notifications')
  if (!data) return
  const cnt = data.unreadCount || 0
  // 병원 관리 메뉴에 배지 추가/업데이트
  const menuEl = document.getElementById('menu-hospital-manage')
  if (menuEl) {
    const existing = menuEl.querySelector('.notif-badge')
    if (cnt > 0) {
      if (existing) {
        existing.textContent = cnt > 9 ? '9+' : cnt
      } else {
        const badge = document.createElement('span')
        badge.className = 'notif-badge ml-auto bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold'
        badge.textContent = cnt > 9 ? '9+' : cnt
        menuEl.appendChild(badge)
      }
    } else {
      // 읽지 않은 알림이 없으면 배지 제거
      if (existing) existing.remove()
    }
  }
  App.unreadNotifCount = cnt
}

function getHospitalMenus() {
  return [
    { id: 'dashboard', icon: 'fa-chart-line', label: '월별 대시보드', section: '현황' },
    { id: 'orders', icon: 'fa-clipboard-list', label: '발주 입력', section: null },
    { id: 'meals', icon: 'fa-utensils', label: '식수 입력', section: null },
    { id: 'schedule', icon: 'fa-calendar-alt', label: '스케줄 관리', section: null },
    { id: 'analysis', icon: 'fa-chart-bar', label: '연간 분석', section: '분석' },
    { id: 'settings', icon: 'fa-flag-checkered', label: '마감 요청', section: '관리' }
  ]
}

function getAdminMenus() {
  return [
    { id: 'admin', icon: 'fa-th-large', label: '전체 현황', section: '관리자' },
    { id: 'hospital-manage', icon: 'fa-hospital', label: '병원 관리', section: null },
    { id: 'holiday-manage', icon: 'fa-calendar-times', label: '공휴일 관리', section: null },
    { id: 'analysis', icon: 'fa-chart-bar', label: '비교 분석', section: '분석' },
    { id: 'report', icon: 'fa-file-pdf', label: '보고서 출력', section: null }
  ]
}

function renderMenuItem(item) {
  const sectionHtml = item.section ? `<div class="menu-section-title">${item.section}</div>` : ''
  return `${sectionHtml}
  <div class="menu-item" id="menu-${item.id}" onclick="navigateTo('${item.id}')">
    <div class="icon"><i class="fas ${item.icon} text-xs"></i></div>
    <span>${item.label}</span>
  </div>`
}

function updateMonthDisplay() {
  const m = `${App.currentYear}년 ${App.currentMonth}월`
  const el1 = document.getElementById('currentMonthDisplay')
  const el2 = document.getElementById('headerMonth')
  if (el1) el1.textContent = m
  if (el2) el2.textContent = m
}

// 패널 전환 헬퍼 - orders/meals는 전용 패널, 나머지는 pageContent
function _showPanel(page) {
  const mainPanel   = document.getElementById('pageContent')
  const ordersPanel = document.getElementById('orders-panel')
  const mealsPanel  = document.getElementById('meals-panel')
  if (!mainPanel) return
  // style.display 직접 제어 (Tailwind hidden 클래스 충돌 방지)
  if (page === 'orders') {
    mainPanel.style.display   = 'none'
    if (mealsPanel)  mealsPanel.style.display  = 'none'
    if (ordersPanel) ordersPanel.style.display = ''
  } else if (page === 'meals') {
    mainPanel.style.display   = 'none'
    if (ordersPanel) ordersPanel.style.display = 'none'
    if (mealsPanel)  mealsPanel.style.display  = ''
  } else {
    if (ordersPanel) ordersPanel.style.display = 'none'
    if (mealsPanel)  mealsPanel.style.display  = 'none'
    mainPanel.style.display   = ''
  }
}

function navigateTo(page, forceReload = false) {
  if (!App._panelReady) App._panelReady = {}

  // 메뉴 활성화
  document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'))
  const activeMenu = document.getElementById(`menu-${page}`)
  if (activeMenu) activeMenu.classList.add('active')

  // 타이틀
  const titles = {
    dashboard: { title: '월별 대시보드', sub: '예산 현황 및 업체별 진행률' },
    orders: { title: '발주 입력', sub: '일별 업체별 발주금액 입력' },
    meals: { title: '식수 입력', sub: '조식/중식/석식 식수 현황' },
    schedule: { title: '스케줄 관리', sub: '직원 근무 스케줄' },
    analysis: { title: '연간 분석', sub: '월별 비교 및 추이 그래프' },
    settings: { title: '마감 요청', sub: '월 마감 요청 및 현황' },
    admin: { title: '전체 병원 현황', sub: '관리자 - 실시간 모니터링' },
    'hospital-manage': { title: '병원 관리', sub: '병원 정보 및 예산 설정' },
    'holiday-manage': { title: '공휴일 관리', sub: '공휴일 조회 및 수동 추가' },
    report: { title: '보고서 출력', sub: 'PPT/PDF 월별 리포트' }
  }
  const t = titles[page] || { title: page, sub: '' }
  const titleEl = document.getElementById('pageTitle')
  const subEl   = document.getElementById('pageSubtitle')
  if (titleEl) titleEl.textContent = t.title
  if (subEl)   subEl.textContent   = t.sub

  history.pushState(null, '', `/${page === 'dashboard' ? '' : page}`)
  App.currentPage = page

  // 패널 전환 (orders/meals는 전용 패널 표시)
  _showPanel(page)

  // orders / meals: 이미 렌더된 경우 재렌더 스킵 (DOM 보존)
  const cacheKey = `${page}-${App.currentYear}-${App.currentMonth}`
  if (!forceReload && (page === 'orders' || page === 'meals') && App._panelReady[cacheKey]) {
    return
  }

  // 차트 정리 (orders/meals 제외)
  if (page !== 'orders' && page !== 'meals') {
    Object.values(App.charts).forEach(c => c?.destroy?.())
    App.charts = {}
  }
  if (page !== 'settings') stopClosingPoll()

  const pages = {
    dashboard: renderDashboard, orders: renderOrders, meals: renderMeals,
    schedule: renderSchedule,  analysis: renderAnalysis,
    settings: renderSettings,  admin: renderAdminDashboard,
    'hospital-manage': renderHospitalManage,
    'holiday-manage':  renderHolidayManage,
    report: renderReport
  }

  if (pages[page]) {
    if (page === 'orders' || page === 'meals') App._panelReady[cacheKey] = true
    pages[page]()
  } else {
    document.getElementById('pageContent').innerHTML =
      '<div class="text-center text-gray-400 py-20">준비 중입니다</div>'
  }
}

function changeMonth(delta) {
  App.currentMonth += delta
  if (App.currentMonth > 12) { App.currentMonth = 1; App.currentYear++ }
  if (App.currentMonth < 1)  { App.currentMonth = 12; App.currentYear-- }
  updateMonthDisplay()
  App._panelReady = {}  // 월 변경 시 캐시 초기화
  navigateTo(App.currentPage)
}

async function api(method, url, data = null) {
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` }
    }
    if (data) opts.body = JSON.stringify(data)
    const res = await fetch(url, opts)
    if (res.status === 401) { logout(); return null }
    return await res.json()
  } catch(e) { console.error('API Error:', e); return null }
}

function fmt(n) { return (n || 0).toLocaleString('ko-KR') }
function fmtWon(n) { return `${(n || 0).toLocaleString('ko-KR')}원` }
function fmtMan(n) { return n >= 10000 ? `${Math.round(n/10000)}만` : `${n}` }
function getProgressColor(pct) {
  if (pct >= 100) return 'progress-red'
  if (pct >= 80) return 'progress-yellow'
  return 'progress-green'
}
function getBadgeColor(pct) {
  if (pct >= 100) return 'badge-red'
  if (pct >= 80) return 'badge-yellow'
  return 'badge-green'
}
function getDaysInMonth(year, month) { return new Date(year, month, 0).getDate() }
function getDayOfWeek(year, month, day) {
  return ['일','월','화','수','목','금','토'][new Date(year, month-1, day).getDay()]
}
function isWeekend(year, month, day) {
  const d = new Date(year, month-1, day).getDay()
  return d === 0 || d === 6
}
function getCategoryColor(cat) {
  const map = { major:'bg-blue-400', meat:'bg-red-400', seafood:'bg-cyan-400', fruit:'bg-yellow-400',
    organic:'bg-green-400', delivery:'bg-purple-400', market:'bg-orange-400', event:'bg-pink-400', card:'bg-gray-400' }
  return map[cat] || 'bg-gray-300'
}
function getCategoryLabel(cat) {
  const map = { major:'대기업급식', meat:'육류', seafood:'해산물', fruit:'청과', organic:'유기농',
    delivery:'인터넷배송', market:'시장', event:'이벤트', card:'법인카드', general:'기타' }
  return map[cat] || '기타'
}
function getTaxTypeLabel(t) {
  return { mixed:'과세+면세', taxable:'과세', exempt:'면세' }[t] || t
}

function showToast(msg, type = 'success') {
  const t = document.createElement('div')
  t.className = `toast toast-${type}`
  t.innerHTML = `<i class="fas ${type==='success'?'fa-check-circle':type==='error'?'fa-times-circle':'fa-exclamation-triangle'}"></i> ${msg}`
  document.body.appendChild(t)
  setTimeout(() => t.classList.add('fade-out'), 2700)
  setTimeout(() => t.remove(), 3000)
}

function logout() { localStorage.clear(); window.location.href = '/login' }

// ══════════════════════════════════════════════════════════════
//  대시보드 페이지 (v2.0)
// ══════════════════════════════════════════════════════════════
async function renderDashboard() {
  const content = document.getElementById('pageContent')
  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`

  const data = await api('GET', `/api/dashboard/summary/${App.currentYear}/${App.currentMonth}`)
  if (!data) { content.innerHTML = '<div class="text-red-500 p-6">데이터 로드 실패</div>'; return }

  const s = data.summary
  const vendors = data.vendors || []
  const ms = data.mealStats || {}
  const totalMeals = (ms.total_patient||0)+(ms.total_staff||0)+(ms.total_noncovered||0)+(ms.total_guardian||0)
  const mealPrice = totalMeals > 0 && s.totalUsed > 0 ? Math.round(s.totalUsed / totalMeals) : (data.settings?.meal_price || 0)
  // 식단가 3종 (API에서 제공)
  const mealPriceTotal = data.mealPriceTotal || mealPrice
  const mealPriceNoStaff = data.mealPriceNoStaff || 0
  const mealPriceNoSupply = data.mealPriceNoSupply || 0
  const targetMealPrice = data.settings?.meal_price || 0
  const mpOver = targetMealPrice > 0 && mealPriceTotal > targetMealPrice
  const overBudget = data.overBudgetVendors || []
  
  // 현재 날짜 기준 남은 일수 계산
  const today = new Date()
  const isCurrentMonth = today.getFullYear() === App.currentYear && (today.getMonth()+1) === App.currentMonth
  const daysInMonth = getDaysInMonth(App.currentYear, App.currentMonth)
  const currentDay = isCurrentMonth ? today.getDate() : daysInMonth
  const remainingDays = daysInMonth - currentDay

  // 잔반 데이터 비동기 로드
  let foodWasteData = []
  try {
    foodWasteData = await api('GET', `/api/settings/food-waste/${App.currentYear}/${App.currentMonth}`) || []
  } catch(e) {}

  content.innerHTML = `
  <!-- 예산 초과 알림 -->
  ${overBudget.length > 0 ? `
  <div class="mb-4 bg-red-50 border border-red-200 rounded-xl p-4">
    <div class="flex items-center gap-2 mb-2">
      <i class="fas fa-exclamation-triangle text-red-500"></i>
      <span class="font-bold text-red-700">예산 초과 알림 (${overBudget.length}개 업체)</span>
    </div>
    <div class="flex flex-wrap gap-2">
      ${overBudget.map(v => `
        <div class="bg-red-100 text-red-700 px-3 py-1 rounded-lg text-sm font-medium">
          ${v.name}: ${fmt(v.total_used)}원 / ${fmt(v.monthly_budget)}원 
          (+${fmt(v.total_used - v.monthly_budget)}원 초과)
        </div>
      `).join('')}
    </div>
  </div>` : ''}

  <!-- 상단 요약 카드 4개 -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
    <div class="stat-card">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs text-gray-500 font-semibold uppercase tracking-wide">월 사용금액</span>
        <div class="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
          <i class="fas fa-won-sign text-blue-500 text-xs"></i>
        </div>
      </div>
      <div class="text-2xl font-bold text-gray-800">${fmtMan(s.totalUsed)}<span class="text-xs font-normal text-gray-400 ml-1">원</span></div>
      <div class="text-xs text-gray-400 mt-1">목표: ${fmtMan(s.totalBudget)}원</div>
      <div class="mt-2 progress-bar">
        <div class="progress-fill ${getProgressColor(parseFloat(s.progress))}" style="width:${Math.min(parseFloat(s.progress),100)}%"></div>
      </div>
      <div class="mt-1 text-xs font-semibold ${parseFloat(s.progress)>=100?'text-red-600':parseFloat(s.progress)>=80?'text-yellow-600':'text-green-600'}">${s.progress}%</div>
    </div>

    <div class="stat-card">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs text-gray-500 font-semibold uppercase tracking-wide">잔여 예산</span>
        <div class="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
          <i class="fas fa-piggy-bank text-purple-500 text-xs"></i>
        </div>
      </div>
      <div class="text-2xl font-bold ${s.remaining<0?'text-red-600':'text-gray-800'}">${fmtMan(Math.abs(s.remaining))}<span class="text-xs font-normal text-gray-400 ml-1">원</span></div>
      <div class="text-xs ${s.remaining<0?'text-red-500':'text-gray-400'} mt-1">${s.remaining<0?'⚠️ 예산 초과!':'남은 예산'}</div>
      <div class="text-xs text-gray-400 mt-1">잔여 ${remainingDays}일 · 일평균 ${fmtMan(remainingDays>0?Math.round(s.remaining/remainingDays):0)}원 가능</div>
    </div>

    <div class="stat-card">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs text-gray-500 font-semibold uppercase tracking-wide">오늘 발주</span>
        <div class="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
          <i class="fas fa-calendar-day text-green-500 text-xs"></i>
        </div>
      </div>
      <div class="text-2xl font-bold ${parseFloat(s.todayProgress)>=100?'text-red-600':parseFloat(s.todayProgress)>=80?'text-yellow-600':'text-gray-800'}">${fmtMan(s.todayUsed)}<span class="text-xs font-normal text-gray-400 ml-1">원</span></div>
      <div class="text-xs text-gray-400 mt-1">일 목표: ${fmtMan(s.dailyBudget)}원</div>
      <div class="mt-2 progress-bar">
        <div class="progress-fill ${getProgressColor(parseFloat(s.todayProgress))}" style="width:${Math.min(parseFloat(s.todayProgress||0),100)}%"></div>
      </div>
      <div class="mt-1 text-xs text-gray-500">${s.todayProgress}%</div>
    </div>

    <div class="stat-card">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs text-gray-500 font-semibold uppercase tracking-wide">이번 주</span>
        <div class="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">
          <i class="fas fa-calendar-week text-orange-500 text-xs"></i>
        </div>
      </div>
      <div class="text-2xl font-bold ${parseFloat(s.weekProgress)>=100?'text-red-600':parseFloat(s.weekProgress)>=80?'text-yellow-600':'text-gray-800'}">${fmtMan(s.weekUsed)}<span class="text-xs font-normal text-gray-400 ml-1">원</span></div>
      <div class="text-xs text-gray-400 mt-1">주 목표: ${fmtMan(s.weeklyBudget)}원</div>
      <div class="mt-2 progress-bar">
        <div class="progress-fill ${getProgressColor(parseFloat(s.weekProgress))}" style="width:${Math.min(parseFloat(s.weekProgress||0),100)}%"></div>
      </div>
      <div class="mt-1 text-xs text-gray-500">${s.weekProgress}%</div>
    </div>
  </div>

  <!-- 업체별 진행률 + 일별 차트 -->
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
    <!-- 업체별 진행률 -->
    <div class="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 class="font-bold text-gray-800">업체별 예산 현황</h2>
        <button onclick="navigateTo('orders')" class="text-xs text-blue-500 hover:underline flex items-center gap-1">
          <i class="fas fa-edit"></i> 발주 입력 →
        </button>
      </div>
      <div class="overflow-x-auto">
        <table class="data-table">
          <thead>
            <tr>
              <th>업체명</th>
              <th class="text-right">사용금액</th>
              <th class="text-right">목표금액</th>
              <th style="width:160px">진행률</th>
              <th class="text-right">잔여</th>
            </tr>
          </thead>
          <tbody>
            ${vendors.map(v => {
              const pct = v.monthly_budget > 0 ? ((v.total_used / v.monthly_budget) * 100) : null
              const remaining = v.monthly_budget - v.total_used
              const over = v.monthly_budget > 0 && v.total_used > v.monthly_budget
              return `<tr>
                <td>
                  <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full flex-shrink-0 ${getCategoryColor(v.category)}"></span>
                    <span class="font-medium text-sm">${v.name}</span>
                    ${over ? '<span class="badge badge-red" style="font-size:10px">초과</span>' : ''}
                  </div>
                  <div class="text-xs text-gray-400 ml-4">${getCategoryLabel(v.category)} · ${getTaxTypeLabel(v.tax_type)}</div>
                </td>
                <td class="text-right font-semibold text-sm">${fmt(v.total_used)}</td>
                <td class="text-right text-gray-500 text-sm">${v.monthly_budget > 0 ? fmt(v.monthly_budget) : '무제한'}</td>
                <td>
                  ${pct !== null ? `
                  <div class="flex items-center gap-2">
                    <div class="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div class="h-full rounded-full ${getProgressColor(pct)}" style="width:${Math.min(pct,100)}%"></div>
                    </div>
                    <span class="text-xs w-10 text-right ${over?'text-red-600 font-bold':'text-gray-600'}">${pct.toFixed(1)}%</span>
                  </div>` : '<span class="text-xs text-gray-300">-</span>'}
                </td>
                <td class="text-right text-sm ${remaining<0?'text-red-500 font-semibold':'text-gray-500'}">${v.monthly_budget>0?fmt(remaining):'-'}</td>
              </tr>`
            }).join('')}
          </tbody>
          <tfoot>
            <tr class="bg-gray-50 font-bold">
              <td class="text-sm">합계</td>
              <td class="text-right text-blue-700">${fmt(s.totalUsed)}</td>
              <td class="text-right text-gray-600">${fmt(s.totalBudget)}</td>
              <td>
                <div class="flex items-center gap-2">
                  <div class="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div class="h-full rounded-full ${getProgressColor(parseFloat(s.progress))}" style="width:${Math.min(parseFloat(s.progress),100)}%"></div>
                  </div>
                  <span class="text-xs w-10 text-right">${s.progress}%</span>
                </div>
              </td>
              <td class="text-right ${s.remaining<0?'text-red-600':'text-green-700'}">${fmt(s.remaining)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <!-- 일별 누적 발주 차트 -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col">
      <h2 class="font-bold text-gray-800 mb-1">일별 누적 발주</h2>
      <p class="text-xs text-gray-400 mb-3">누적 vs 목표금액</p>
      <div class="flex-1 min-h-0">
        <canvas id="dailyChart"></canvas>
      </div>
    </div>
  </div>

  <!-- 식수 현황 + 업체 카테고리 -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="font-bold text-gray-800">이번달 식수 현황</h2>
        <button onclick="navigateTo('meals')" class="text-xs text-blue-500 hover:underline">식수 입력 →</button>
      </div>
      <div class="grid grid-cols-2 gap-3 mb-4">
        ${[
          { label: '환자식', value: ms.total_patient, color: 'bg-blue-100 text-blue-700', icon: 'fa-bed' },
          { label: '직원식', value: ms.total_staff, color: 'bg-green-100 text-green-700', icon: 'fa-user' },
          { label: '비급여', value: ms.total_noncovered, color: 'bg-purple-100 text-purple-700', icon: 'fa-receipt' },
          { label: '보호자', value: ms.total_guardian, color: 'bg-orange-100 text-orange-700', icon: 'fa-users' }
        ].map(item => `
          <div class="flex items-center gap-3 p-3 rounded-xl ${item.color.split(' ')[0]}">
            <div class="w-9 h-9 rounded-lg flex items-center justify-center ${item.color}">
              <i class="fas ${item.icon} text-xs"></i>
            </div>
            <div>
              <div class="text-xs font-medium opacity-75">${item.label}</div>
              <div class="font-bold text-lg">${fmt(item.value)}<span class="text-xs font-normal opacity-60 ml-1">식</span></div>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
        <span class="text-sm font-medium text-gray-600">총 식수</span>
        <span class="font-bold text-lg text-gray-800">${fmt(totalMeals)}<span class="text-xs font-normal text-gray-400 ml-1">식</span></span>
      </div>
      <!-- 식단가 3종 -->
      <div class="mt-3 space-y-2">
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs font-semibold text-gray-600"><i class="fas fa-utensils mr-1 text-blue-400"></i>식단가 현황</span>
          ${targetMealPrice>0?`<span class="text-xs text-gray-400">목표: ${fmt(targetMealPrice)}원/식</span>`:''}
        </div>
        <div class="flex items-center justify-between p-2.5 ${mpOver?'bg-red-50 border border-red-200':'bg-blue-50'} rounded-xl">
          <div>
            <span class="text-xs font-medium ${mpOver?'text-red-600':'text-blue-600'}">전체 식단가</span>
            ${mpOver?`<span class="text-xs text-red-500 ml-1 font-bold">▲초과</span>`:''}
          </div>
          <span class="font-bold text-lg ${mpOver?'text-red-600':'text-blue-700'}">${totalMeals>0?fmt(mealPriceTotal):'집계중'}<span class="text-xs font-normal ml-1">원/식</span></span>
        </div>
        <div class="flex items-center justify-between p-2.5 bg-purple-50 rounded-xl">
          <span class="text-xs font-medium text-purple-600">직원식 제외</span>
          <span class="font-bold text-purple-700">${totalMeals>0?fmt(mealPriceNoStaff):'집계중'}<span class="text-xs font-normal ml-1">원/식</span></span>
        </div>
        <div class="flex items-center justify-between p-2.5 bg-orange-50 rounded-xl">
          <span class="text-xs font-medium text-orange-600">소모품 제외</span>
          <span class="font-bold text-orange-700">${totalMeals>0?fmt(mealPriceNoSupply):'집계중'}<span class="text-xs font-normal ml-1">원/식</span></span>
        </div>
      </div>

      <!-- 잔반 현황 -->
      <div class="mt-3 border-t border-gray-100 pt-3">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-bold text-gray-700"><i class="fas fa-recycle text-amber-500 mr-1"></i>잔반 월별 현황</span>
          <button onclick="showFoodWasteModal(${App.currentYear},${App.currentMonth})" class="text-xs text-blue-500 hover:underline">입력/수정 →</button>
        </div>
        ${foodWasteData.length > 0 ? `
        <div class="space-y-1.5">
          ${foodWasteData.map(w=>`
          <div class="flex items-center justify-between text-xs bg-amber-50 rounded-lg px-3 py-1.5">
            <span class="text-gray-600">${w.week}주차</span>
            <span class="font-semibold text-amber-700">${w.waste_amount}kg</span>
            ${w.waste_cost>0?`<span class="text-gray-500">${fmtMan(w.waste_cost)}원</span>`:''}
            ${w.memo?`<span class="text-gray-400 truncate max-w-20">${w.memo}</span>`:''}
          </div>`).join('')}
          <div class="flex items-center justify-between text-xs font-bold bg-amber-100 rounded-lg px-3 py-1.5">
            <span class="text-amber-800">합계</span>
            <span class="text-amber-800">${foodWasteData.reduce((s,w)=>s+w.waste_amount,0).toFixed(1)}kg</span>
            <span class="text-amber-700">${fmtMan(foodWasteData.reduce((s,w)=>s+w.waste_cost,0))}원</span>
          </div>
        </div>` : `<div class="text-xs text-gray-400 py-2 text-center">잔반 기록 없음 · <button onclick="showFoodWasteModal(${App.currentYear},${App.currentMonth})" class="text-blue-500 hover:underline">입력하기</button></div>`}
      </div>
    </div>

    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <h2 class="font-bold text-gray-800 mb-4">업체 카테고리별 비중</h2>
      <canvas id="vendorPieChart" style="max-height:200px"></canvas>
    </div>
  </div>`

  // 일별 누적 차트 (daysInMonth는 위에서 이미 선언됨)
  const dailyMap = {}
  ;(data.dailyOrders || []).forEach(d => {
    const day = parseInt(d.order_date.split('-')[2]) - 1
    dailyMap[day] = d.daily_total
  })
  let cumulative = 0
  const cumulativeData = []
  for (let i = 0; i < daysInMonth; i++) {
    cumulative += dailyMap[i] || 0
    cumulativeData.push(cumulative)
  }
  const ctx1 = document.getElementById('dailyChart')
  if (ctx1) {
    App.charts.daily = new Chart(ctx1, {
      type: 'line',
      data: {
        labels: Array.from({ length: daysInMonth }, (_, i) => `${i+1}`),
        datasets: [{
          label: '누적 발주액',
          data: cumulativeData,
          borderColor: '#16a34a',
          backgroundColor: 'rgba(22,163,74,0.08)',
          fill: true, tension: 0.4, pointRadius: 2, borderWidth: 2
        }, {
          label: '목표금액',
          data: Array(daysInMonth).fill(s.totalBudget),
          borderColor: '#ef4444',
          borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0, fill: false
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { font: { size: 10 } } },
          y: { ticks: { callback: v => `${(v/10000).toFixed(0)}만`, font: { size: 10 } } }
        }
      }
    })
  }

  // 파이 차트
  const catData = {}
  vendors.forEach(v => {
    if (v.total_used > 0) {
      const cat = getCategoryLabel(v.category)
      catData[cat] = (catData[cat] || 0) + v.total_used
    }
  })
  const ctx2 = document.getElementById('vendorPieChart')
  if (ctx2 && Object.keys(catData).length > 0) {
    App.charts.pie = new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels: Object.keys(catData),
        datasets: [{ data: Object.values(catData), backgroundColor: ['#16a34a','#15803d','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899'] }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${fmt(ctx.raw)}원` } }
        }
      }
    })
  }
}

// ══════════════════════════════════════════════════════════════
//  발주 입력 페이지 (v2.0 - 다일치 발주 지원)
// ══════════════════════════════════════════════════════════════
async function renderOrders() {
  const content = document.getElementById('orders-panel') || document.getElementById('pageContent')
  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`

  const [vendors, orderData, settingsData, dashData] = await Promise.all([
    api('GET', '/api/vendors'),
    api('GET', `/api/orders/${App.currentYear}/${App.currentMonth}`),
    api('GET', `/api/settings/${App.currentYear}/${App.currentMonth}`),
    api('GET', `/api/dashboard/summary/${App.currentYear}/${App.currentMonth}`)
  ])

  if (!vendors) { content.innerHTML = '<div class="text-red-500 p-6">데이터 로드 실패</div>'; return }

  const days = getDaysInMonth(App.currentYear, App.currentMonth)
  const orderMap = {}
  ;(orderData || []).forEach(o => {
    if (!orderMap[o.order_date]) orderMap[o.order_date] = {}
    orderMap[o.order_date][o.vendor_id] = o
  })

  const settings = settingsData?.settings || {}
  const totalBudget = settings.total_budget || 0
  const workingDays = settings.working_days || getDaysInMonth(App.currentYear, App.currentMonth)
  const dailyBudget = workingDays > 0 ? Math.round(totalBudget / workingDays) : 0
  // 식단가 관련 데이터
  const mealStats = dashData?.mealStats || {}
  const targetMealPrice = settings.meal_price || 0

  // 오늘 날짜 계산
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
  const todayDay = (today.getFullYear() === App.currentYear && today.getMonth()+1 === App.currentMonth) ? today.getDate() : days

  // 이번 주 시작/끝 (월요일 기준)
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - (today.getDay() === 0 ? 6 : today.getDay() - 1))
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)

  // 금액 계산
  const monthTotal = (orderData||[]).reduce((s,o) => s+(o.total_amount||0), 0)

  let todayTotal = 0, weekTotal = 0
  ;(orderData||[]).forEach(o => {
    if (o.order_date === todayStr) todayTotal += o.total_amount||0
    const od = new Date(o.order_date)
    if (od >= weekStart && od <= weekEnd) weekTotal += o.total_amount||0
  })

  // 주간 예산 = 일일예산 × 5일(영업일)
  const weekBudget = dailyBudget * 5

  const monthPct = totalBudget > 0 ? Math.round(monthTotal / totalBudget * 100) : 0
  const todayPct = dailyBudget > 0 ? Math.round(todayTotal / dailyBudget * 100) : 0
  const weekPct = weekBudget > 0 ? Math.round(weekTotal / weekBudget * 100) : 0

  function pctColor(p) { return p >= 100 ? 'text-red-600' : p >= 80 ? 'text-yellow-600' : 'text-green-700' }
  function barColor(p) { return p >= 100 ? 'progress-red' : p >= 80 ? 'progress-yellow' : 'progress-green' }

  content.innerHTML = `
  <!-- ── 식단가 실시간 패널 ── -->
  <div id="mealPricePanel" class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4">
    <div class="flex items-center justify-between mb-3">
      <h3 class="font-bold text-gray-700 text-sm"><i class="fas fa-utensils text-blue-500 mr-1"></i>실시간 식단가</h3>
      <span class="text-xs text-gray-400">식수: <strong id="realMealCount">${fmt((mealStats.total_patient||0)+(mealStats.total_staff||0)+(mealStats.total_noncovered||0)+(mealStats.total_guardian||0))}</strong>식</span>
    </div>
    <div class="grid grid-cols-3 gap-3">
      <div id="mpCard-total" class="rounded-xl p-3 ${targetMealPrice > 0 && dashData?.mealPriceTotal > targetMealPrice ? 'bg-red-50 border-2 border-red-300' : 'bg-blue-50'}">
        <div class="text-xs text-blue-600 mb-1 font-medium">전체 식단가</div>
        <div class="text-lg font-bold" id="mpVal-total">${fmt(dashData?.mealPriceTotal||0)}<span class="text-xs font-normal ml-0.5">원/식</span></div>
        ${targetMealPrice > 0 ? `<div class="text-xs text-gray-400">목표: ${fmt(targetMealPrice)}원</div>` : ''}
        <div class="text-xs font-semibold mt-1" id="mpDiff-total">${targetMealPrice > 0 && dashData?.mealPriceTotal > 0 ? (dashData.mealPriceTotal > targetMealPrice ? `<span class="text-red-500">▲ +${fmt(dashData.mealPriceTotal-targetMealPrice)}원 초과</span>` : `<span class="text-green-600">▼ ${fmt(targetMealPrice-dashData.mealPriceTotal)}원 여유</span>`) : ''}</div>
      </div>
      <div class="bg-purple-50 rounded-xl p-3">
        <div class="text-xs text-purple-600 mb-1 font-medium">직원식 제외</div>
        <div class="text-lg font-bold text-purple-700" id="mpVal-nostaff">${fmt(dashData?.mealPriceNoStaff||0)}<span class="text-xs font-normal ml-0.5">원/식</span></div>
        <div class="text-xs text-purple-400">직원: ${fmt(mealStats.total_staff||0)}식 제외</div>
      </div>
      <div class="bg-orange-50 rounded-xl p-3">
        <div class="text-xs text-orange-600 mb-1 font-medium">소모품 제외</div>
        <div class="text-lg font-bold text-orange-700" id="mpVal-nosupply">${fmt(dashData?.mealPriceNoSupply||0)}<span class="text-xs font-normal ml-0.5">원/식</span></div>
        <div class="text-xs text-orange-400">소모품/카드 제외</div>
      </div>
    </div>
  </div>

  <!-- ── 예산 진행률 실시간 패널 ── -->
  <div id="budgetProgressPanel" class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4">
    <div class="flex items-center justify-between mb-3">
      <h3 class="font-bold text-gray-700 text-sm"><i class="fas fa-tachometer-alt text-green-600 mr-1"></i>예산 달성 현황 (실시간)</h3>
      <span class="text-xs text-gray-400">${App.currentYear}년 ${App.currentMonth}월 | 월 총예산: <strong class="text-gray-700">${fmtWon(totalBudget)}</strong></span>
    </div>
    <div class="grid grid-cols-3 gap-4">
      <div class="bg-gray-50 rounded-xl p-3">
        <div class="flex justify-between items-center mb-1">
          <span class="text-xs text-gray-500">일별 발주</span>
          <span class="text-xs font-bold ${pctColor(todayPct)}" id="todayPct">${todayPct}%</span>
        </div>
        <div class="progress-bar h-2 mb-1"><div id="todayBar" class="progress-fill ${barColor(todayPct)}" style="width:${Math.min(todayPct,100)}%"></div></div>
        <div class="flex justify-between text-xs text-gray-400">
          <span id="todayAmt">${fmtWon(todayTotal)}</span>
          <span>목표: ${fmtWon(dailyBudget)}</span>
        </div>
      </div>
      <div class="bg-gray-50 rounded-xl p-3">
        <div class="flex justify-between items-center mb-1">
          <span class="text-xs text-gray-500">주별 발주</span>
          <span class="text-xs font-bold ${pctColor(weekPct)}" id="weekPct">${weekPct}%</span>
        </div>
        <div class="progress-bar h-2 mb-1"><div id="weekBar" class="progress-fill ${barColor(weekPct)}" style="width:${Math.min(weekPct,100)}%"></div></div>
        <div class="flex justify-between text-xs text-gray-400">
          <span id="weekAmt">${fmtWon(weekTotal)}</span>
          <span>목표: ${fmtWon(weekBudget)}</span>
        </div>
      </div>
      <div class="bg-gray-50 rounded-xl p-3">
        <div class="flex justify-between items-center mb-1">
          <span class="text-xs text-gray-500">월별 발주</span>
          <span class="text-xs font-bold ${pctColor(monthPct)}" id="monthPct">${monthPct}%</span>
        </div>
        <div class="progress-bar h-2 mb-1"><div id="monthBar" class="progress-fill ${barColor(monthPct)}" style="width:${Math.min(monthPct,100)}%"></div></div>
        <div class="flex justify-between text-xs text-gray-400">
          <span id="monthAmt">${fmtWon(monthTotal)}</span>
          <span>목표: ${fmtWon(totalBudget)}</span>
        </div>
      </div>
    </div>
  </div>

  <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
    <div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
      <div>
        <h2 class="font-bold text-gray-800">${App.currentYear}년 ${App.currentMonth}월 발주 입력</h2>
        <p class="text-xs text-gray-400 mt-0.5">입력 후 자동 저장됨 | 수동 저장은 저장 버튼 클릭</p>
      </div>
      <div class="flex gap-2 flex-wrap">
        <button onclick="saveAllOrders()" class="btn btn-success btn-sm">
          <i class="fas fa-save mr-1"></i> 전체 저장
        </button>
        <button onclick="showQuickMultiDay()" class="btn btn-primary btn-sm">
          <i class="fas fa-calendar-plus mr-1"></i> 다수일 발주
        </button>
        <button onclick="refreshOrders()" class="btn btn-secondary btn-sm">
          <i class="fas fa-sync"></i> 새로고침
        </button>
      </div>
    </div>
    
    <!-- 월별 업체 합계 요약 -->
    <div class="px-5 py-3 border-b border-gray-100 bg-gray-50 overflow-x-auto">
      <div class="flex gap-3 min-w-max text-xs" id="vendorSummaryRow">
        ${vendors.map(v => {
          const vOrders = (orderData || []).filter(o => o.vendor_id === v.id)
          const vTotal = vOrders.reduce((s, o) => s + (o.total_amount || 0), 0)
          const pct = v.monthly_budget > 0 ? (vTotal / v.monthly_budget * 100).toFixed(0) : null
          const over = v.monthly_budget > 0 && vTotal > v.monthly_budget
          return `<div class="flex flex-col items-center min-w-[80px] p-2 bg-white rounded-lg border ${over?'border-red-200':'border-gray-200'}">
            <div class="font-semibold text-gray-700 text-center leading-tight mb-1" style="font-size:11px">${v.name.length > 6 ? v.name.substring(0,6)+'…' : v.name}</div>
            <div class="font-bold ${over?'text-red-600':'text-green-700'}">${fmtMan(vTotal)}</div>
            ${pct ? `<div class="${over?'text-red-400':'text-gray-400'}">${pct}%</div>` : ''}
          </div>`
        }).join('')}
        <div class="flex flex-col items-center min-w-[80px] p-2 bg-green-50 rounded-lg border border-green-200">
          <div class="font-semibold text-green-700 mb-1" style="font-size:11px">월 합계</div>
          <div class="font-bold text-green-700" id="monthTotalDisplay">${fmtMan((orderData||[]).reduce((s,o)=>s+(o.total_amount||0),0))}</div>
          ${totalBudget > 0 ? `<div class="text-gray-400" id="monthPctDisplay">${monthPct}%</div>` : ''}
        </div>
      </div>
    </div>

    <div class="overflow-x-auto">
      <table class="order-table w-full" id="ordersTable">
        <thead>
          <tr>
            <th rowspan="2" class="sticky left-0 z-10 bg-gray-800" style="min-width:50px">일</th>
            <th rowspan="2" style="min-width:28px">요일</th>
            <th rowspan="2" style="min-width:50px;font-size:10px">발주<br>일수</th>
            ${vendors.map(v => `
              <th colspan="${getVendorCols(v.tax_type)}" style="min-width:${getVendorCols(v.tax_type)*90}px">
                <div style="font-size:11px">${v.name}</div>
                <div style="font-size:9px;opacity:0.7">${getTaxTypeLabel(v.tax_type)}</div>
              </th>
            `).join('')}
            <th rowspan="2" style="min-width:90px">일 합계</th>
          </tr>
          <tr>
            ${vendors.map(v => getVendorSubHeaders(v.tax_type)).join('')}
          </tr>
        </thead>
        <tbody>
          ${Array.from({ length: days }, (_, i) => {
            const day = i + 1
            const dow = getDayOfWeek(App.currentYear, App.currentMonth, day)
            const weekend = isWeekend(App.currentYear, App.currentMonth, day)
            const dateStr = `${App.currentYear}-${String(App.currentMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`
            const rowClass = dow === '일' ? 'holiday-row' : weekend ? 'weekend-row' : ''
            let dayTotal = 0
            ;(orderData||[]).filter(o=>o.order_date===dateStr).forEach(o=>dayTotal+=o.total_amount||0)
            // 다일치 여부 확인
            const dayOrders = (orderData||[]).filter(o=>o.order_date===dateStr)
            const multiDayInfo = dayOrders.find(o=>o.is_multi_day)
            const multiDayCount = multiDayInfo ? (() => {
              const s = new Date(multiDayInfo.multi_day_start), e = new Date(multiDayInfo.multi_day_end)
              return Math.round((e-s)/(1000*60*60*24))+1
            })() : 1
            return `<tr class="${rowClass}" data-date="${dateStr}">
              <td class="date-col sticky left-0 z-10">${day}</td>
              <td class="text-center" style="font-size:11px;font-weight:${weekend?'bold':'normal'};color:${dow==='토'?'#16a34a':dow==='일'?'#ef4444':'#6b7280'}">${dow}</td>
              <td class="text-center" style="font-size:10px">
                <select class="multiday-select" data-date="${dateStr}" style="border:1px solid #e5e7eb;border-radius:4px;padding:1px 2px;font-size:10px;background:#f9fafb;cursor:pointer;" onchange="updateMultiDayNote(this)">
                  ${[1,2,3,4,5,6,7].map(n => `<option value="${n}" ${multiDayCount===n?'selected':''}>${n}일</option>`).join('')}
                </select>
              </td>
              ${vendors.map(v => getVendorInputCells(v, orderMap[dateStr]?.[v.id]||{}, dateStr)).join('')}
              <td class="total-col text-right pr-2 text-xs" id="dayTotal-${dateStr}">${dayTotal>0?fmt(dayTotal):''}</td>
            </tr>`
          }).join('')}
        </tbody>
        <tfoot>
          <tr class="bg-gray-100 font-bold text-xs">
            <td colspan="3" class="text-center py-2 sticky left-0 bg-gray-100">합계</td>
            ${vendors.map(v => getVendorTotalCells(v, orderData||[])).join('')}
            <td class="text-right pr-2 text-green-700 font-bold">
              ${fmt((orderData||[]).reduce((s,o)=>s+(o.total_amount||0),0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>

  <!-- 다수일 발주 빠른 입력 패널 -->
  <div id="quickMultiDayPanel" class="hidden bg-white rounded-2xl shadow-sm border border-green-200 p-5 mt-4">
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-bold text-gray-800"><i class="fas fa-calendar-plus text-green-600 mr-2"></i>다수일 발주 입력 (주말·공휴일·명절)</h3>
      <button onclick="document.getElementById('quickMultiDayPanel').classList.add('hidden')" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>
    </div>
    <div class="bg-green-50 rounded-xl p-3 mb-4 text-xs text-green-800">
      <i class="fas fa-info-circle mr-1"></i>
      주말·공휴일이 포함된 다수일 발주를 넣을 때 사용합니다. 시작일에 N일치 금액을 한 번에 입력합니다.
    </div>
    <div class="grid grid-cols-2 gap-4 mb-4">
      <div>
        <label class="block text-xs font-semibold text-gray-600 mb-1">발주 날짜 (시작일)</label>
        <input type="date" id="qdStart" class="form-input" value="${App.currentYear}-${String(App.currentMonth).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}">
      </div>
      <div>
        <label class="block text-xs font-semibold text-gray-600 mb-1">발주 일수</label>
        <div class="flex gap-2">
          ${[2,3,4,5,6,7].map(n => `<button onclick="selectQDDays(${n})" id="qdBtn${n}" class="px-3 py-2 rounded-lg border text-sm font-medium ${n===2?'bg-green-600 text-white border-green-600':'bg-white text-gray-600 border-gray-300'} hover:bg-green-50">${n}일</button>`).join('')}
          <input type="number" id="qdDays" class="form-input text-center" style="width:60px" value="2" min="1" max="14" onchange="syncQDButtons(this.value)">
        </div>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-4 mb-4">
      <div>
        <label class="block text-xs font-semibold text-gray-600 mb-1">업체 선택</label>
        <select id="qdVendor" class="form-input">
          ${vendors.map(v => `<option value="${v.id}" data-taxtype="${v.tax_type}">${v.name}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="block text-xs font-semibold text-gray-600 mb-1">비고 (자동입력)</label>
        <input type="text" id="qdNote" class="form-input" placeholder="예: 설 연휴 3일치" id="qdNote">
      </div>
    </div>
    <div class="grid grid-cols-2 gap-4 mb-4">
      <div>
        <label class="block text-xs font-semibold text-gray-600 mb-1">과세금액 (원)</label>
        <input type="number" id="qdTaxable" class="form-input" placeholder="0" min="0">
      </div>
      <div>
        <label class="block text-xs font-semibold text-gray-600 mb-1">면세금액 (원)</label>
        <input type="number" id="qdExempt" class="form-input" placeholder="0" min="0">
      </div>
    </div>
    <div class="flex gap-3">
      <button onclick="saveQuickMultiDay()" class="btn btn-primary flex-1"><i class="fas fa-save mr-1"></i>다수일 발주 저장</button>
      <button onclick="document.getElementById('quickMultiDayPanel').classList.add('hidden')" class="btn btn-secondary">취소</button>
    </div>
  </div>`

  // 전역에 예산 데이터 저장 (실시간 업데이트용)
  window._ordersBudget = { totalBudget, dailyBudget, weekBudget, todayStr, weekStart, weekEnd }
  window._ordersData = orderData || []
  window._ordersMealStats = {
    totalMeals: (mealStats.total_patient||0)+(mealStats.total_staff||0)+(mealStats.total_noncovered||0)+(mealStats.total_guardian||0),
    totalStaff: mealStats.total_staff||0,
    targetMealPrice,
    vendors: vendors || []
  }

  bindOrderInputEvents()
}

// ── 발주 전체 수동 저장 ────────────────────────────────────────
window.saveAllOrders = async () => {
  const inputs = document.querySelectorAll('.order-input')
  if (inputs.length === 0) { showToast('저장할 발주 데이터가 없습니다', 'warning'); return }

  showAutoSaveIndicator('saving')
  const seen = new Set()
  const promises = []

  inputs.forEach(inp => {
    const vendorId = inp.dataset.vendor
    const date = inp.dataset.date
    const key = `${vendorId}-${date}`
    if (seen.has(key)) return
    seen.add(key)

    const taxableEl = document.querySelector(`input.order-input[data-vendor="${vendorId}"][data-type="taxable"][data-date="${date}"]`)
    const exemptEl  = document.querySelector(`input.order-input[data-vendor="${vendorId}"][data-type="exempt"][data-date="${date}"]`)
    const taxable = parseInt(taxableEl?.value||0)||0
    const exempt  = parseInt(exemptEl?.value||0)||0
    if (taxable === 0 && exempt === 0) return  // 빈 칸은 스킵

    const vat   = Math.round(taxable * 0.1)
    promises.push(api('POST', '/api/orders/save', {
      vendorId: parseInt(vendorId), orderDate: date,
      taxableAmount: taxable, exemptAmount: exempt, vatAmount: vat
    }))
  })

  if (promises.length === 0) { showToast('입력된 발주 데이터가 없습니다', 'warning'); showAutoSaveIndicator('saved'); return }

  const results = await Promise.all(promises)
  const ok = results.every(r => r?.success)
  showAutoSaveIndicator(ok ? 'saved' : 'error')
  showToast(ok ? `${promises.length}건 발주 저장 완료!` : '일부 저장 실패', ok ? 'success' : 'error')
  updateBudgetProgressPanel()
}

window.showQuickMultiDay = () => {
  document.getElementById('quickMultiDayPanel').classList.remove('hidden')
  document.getElementById('quickMultiDayPanel').scrollIntoView({ behavior: 'smooth' })
}

window.selectQDDays = (n) => {
  document.getElementById('qdDays').value = n
  ;[2,3,4,5,6,7].forEach(x => {
    const btn = document.getElementById(`qdBtn${x}`)
    if (btn) btn.className = `px-3 py-2 rounded-lg border text-sm font-medium ${x===n?'bg-green-600 text-white border-green-600':'bg-white text-gray-600 border-gray-300'} hover:bg-green-50`
  })
  // 비고 자동 업데이트
  const noteEl = document.getElementById('qdNote')
  if (noteEl && !noteEl.value) noteEl.placeholder = `${n}일치 발주`
}

window.syncQDButtons = (v) => window.selectQDDays(parseInt(v))

window.updateMultiDayNote = (sel) => {
  // 발주일수 변경 시 해당 행의 다일치 정보 업데이트 (시각적 표시만)
  const days = parseInt(sel.value)
  const dateStr = sel.dataset.date
  const row = document.querySelector(`tr[data-date="${dateStr}"]`)
  if (row) {
    row.style.background = days > 1 ? 'rgba(22,163,74,0.05)' : ''
  }
}

window.saveQuickMultiDay = async () => {
  const start = document.getElementById('qdStart').value
  const days = parseInt(document.getElementById('qdDays').value) || 2
  const vendorId = parseInt(document.getElementById('qdVendor').value)
  const taxable = parseInt(document.getElementById('qdTaxable').value || 0) || 0
  const exempt = parseInt(document.getElementById('qdExempt').value || 0) || 0
  const note = document.getElementById('qdNote').value || `${days}일치 발주`
  const vat = Math.round(taxable * 0.1)

  if (!start) { showToast('시작일을 선택하세요', 'error'); return }
  if (taxable === 0 && exempt === 0) { showToast('금액을 입력하세요', 'error'); return }

  // 종료일 계산
  const endDate = new Date(start)
  endDate.setDate(endDate.getDate() + days - 1)
  const end = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}-${String(endDate.getDate()).padStart(2,'0')}`

  const res = await api('POST', '/api/orders/save', {
    vendorId, orderDate: start, taxableAmount: taxable, exemptAmount: exempt, vatAmount: vat,
    note: note, isMultiDay: 1, multiDayStart: start, multiDayEnd: end
  })

  if (res?.success) {
    document.getElementById('quickMultiDayPanel').classList.add('hidden')
    showToast(`${start} ~ ${end} (${days}일치) 발주 저장 완료!`, 'success')
    renderOrders()
  } else {
    showToast('저장 실패', 'error')
  }
}

window.refreshOrders = () => {
  if (App._panelReady) {
    delete App._panelReady[`orders-${App.currentYear}-${App.currentMonth}`]
  }
  renderOrders()
}

function getVendorCols(taxType) { return taxType === 'mixed' ? 3 : 1 }

function getVendorSubHeaders(taxType) {
  if (taxType === 'mixed') return `<th style="min-width:80px;font-size:10px">과세</th><th style="min-width:80px;font-size:10px">면세</th><th style="min-width:80px;font-size:10px;background:#1a2f4a">소계</th>`
  if (taxType === 'taxable') return `<th style="min-width:80px;font-size:10px">과세</th>`
  return `<th style="min-width:80px;font-size:10px">면세</th>`
}

function getVendorInputCells(v, order, dateStr) {
  const taxable = order.taxable_amount || 0
  const exempt = order.exempt_amount || 0
  const total = order.total_amount || 0
  const multiDay = order.is_multi_day ? `title="${order.multi_day_start}~${order.multi_day_end} 다일치"` : ''
  if (v.tax_type === 'mixed') {
    return `<td><input type="number" class="order-input" data-vendor="${v.id}" data-type="taxable" data-date="${dateStr}" value="${taxable||''}" placeholder="0" min="0"></td>
            <td><input type="number" class="order-input" data-vendor="${v.id}" data-type="exempt" data-date="${dateStr}" value="${exempt||''}" placeholder="0" min="0"></td>
            <td class="total-col text-right pr-2 text-xs ${order.is_multi_day?'multi-day-cell':''}" id="vt-${v.id}-${dateStr}" ${multiDay}>${total>0?fmt(total):''}</td>`
  }
  if (v.tax_type === 'taxable') {
    return `<td><input type="number" class="order-input" data-vendor="${v.id}" data-type="taxable" data-date="${dateStr}" value="${taxable||''}" placeholder="0" min="0"></td>`
  }
  return `<td><input type="number" class="order-input" data-vendor="${v.id}" data-type="exempt" data-date="${dateStr}" value="${exempt||''}" placeholder="0" min="0"></td>`
}

function getVendorTotalCells(v, orderData) {
  const filtered = orderData.filter(o => o.vendor_id === v.id)
  const totalTaxable = filtered.reduce((s, o) => s + (o.taxable_amount||0), 0)
  const totalExempt = filtered.reduce((s, o) => s + (o.exempt_amount||0), 0)
  const total = filtered.reduce((s, o) => s + (o.total_amount||0), 0)
  if (v.tax_type === 'mixed') {
    return `<td class="text-right pr-1 text-xs">${totalTaxable>0?fmt(totalTaxable):''}</td>
            <td class="text-right pr-1 text-xs">${totalExempt>0?fmt(totalExempt):''}</td>
            <td class="text-right pr-2 text-blue-700 font-bold text-xs total-col">${total>0?fmt(total):''}</td>`
  }
  return `<td class="text-right pr-2 text-blue-700 font-bold text-xs total-col">${total>0?fmt(total):''}</td>`
}

function bindOrderInputEvents() {
  document.querySelectorAll('.order-input').forEach(input => {
    // 저장 핸들러 (change + blur 모두 처리, 중복 방지)
    let _saveTimer = null
    const saveHandler = async function() {
      const vendorId = this.dataset.vendor
      const date = this.dataset.date
      const taxableEl = document.querySelector(`input.order-input[data-vendor="${vendorId}"][data-type="taxable"][data-date="${date}"]`)
      const exemptEl = document.querySelector(`input.order-input[data-vendor="${vendorId}"][data-type="exempt"][data-date="${date}"]`)
      const taxable = parseInt(taxableEl?.value||0)||0
      const exempt = parseInt(exemptEl?.value||0)||0
      const vat = Math.round(taxable * 0.1)
      const total = taxable + exempt + vat
      const subtotalEl = document.getElementById(`vt-${vendorId}-${date}`)
      if (subtotalEl) subtotalEl.textContent = total > 0 ? fmt(total) : ''
      updateDayTotal(date)
      showAutoSaveIndicator('saving')
      const res = await api('POST', '/api/orders/save', {
        vendorId: parseInt(vendorId), orderDate: date,
        taxableAmount: taxable, exemptAmount: exempt, vatAmount: vat
      })
      showAutoSaveIndicator(res?.success ? 'saved' : 'error')
      updateBudgetProgressPanel()
    }
    // change: 값 확정 시 저장
    input.addEventListener('change', saveHandler)
    // blur: 포커스 이탈 시 저장 (다른 탭으로 이동 포함)
    input.addEventListener('blur', function() {
      if (_saveTimer) clearTimeout(_saveTimer)
      _saveTimer = setTimeout(() => saveHandler.call(this), 100)
    })
    // 엔터키로 다음 셀 이동
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === 'Tab') {
        const inputs = [...document.querySelectorAll('.order-input')]
        const idx = inputs.indexOf(this)
        if (idx < inputs.length-1) { e.preventDefault(); inputs[idx+1].focus() }
      }
    })
  })
}

// 자동저장 인디케이터
let _autoSaveTimer = null
function showAutoSaveIndicator(state) {
  let el = document.getElementById('autoSaveIndicator')
  if (!el) {
    el = document.createElement('div')
    el.id = 'autoSaveIndicator'
    el.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;z-index:9999;transition:opacity 0.3s;pointer-events:none;'
    document.body.appendChild(el)
  }
  if (_autoSaveTimer) clearTimeout(_autoSaveTimer)
  if (state === 'saving') {
    el.style.background = '#f59e0b'; el.style.color = '#fff'; el.style.opacity = '1'
    el.innerHTML = '<i class="fas fa-sync-alt fa-spin mr-1"></i>저장 중...'
  } else if (state === 'saved') {
    el.style.background = '#10b981'; el.style.color = '#fff'; el.style.opacity = '1'
    el.innerHTML = '<i class="fas fa-check mr-1"></i>자동 저장됨'
    _autoSaveTimer = setTimeout(() => { el.style.opacity = '0' }, 2000)
  } else {
    el.style.background = '#ef4444'; el.style.color = '#fff'; el.style.opacity = '1'
    el.innerHTML = '<i class="fas fa-exclamation-circle mr-1"></i>저장 실패'
    _autoSaveTimer = setTimeout(() => { el.style.opacity = '0' }, 3000)
  }
}

function updateBudgetProgressPanel() {
  // 전체 입력값 합계 재계산
  const budget = window._ordersBudget
  if (!budget) return
  const { totalBudget, dailyBudget, weekBudget, todayStr, weekStart, weekEnd } = budget

  let monthTotal = 0, todayTotal = 0, weekTotal = 0
  const allInputs = document.querySelectorAll('.order-input')
  const processed = {}
  allInputs.forEach(inp => {
    const date = inp.dataset.date
    const vendor = inp.dataset.vendor
    const key = `${date}-${vendor}`
    if (processed[key]) return
    processed[key] = true
    const taxableEl = document.querySelector(`input.order-input[data-vendor="${vendor}"][data-type="taxable"][data-date="${date}"]`)
    const exemptEl = document.querySelector(`input.order-input[data-vendor="${vendor}"][data-type="exempt"][data-date="${date}"]`)
    const t = parseInt(taxableEl?.value||0)||0
    const e = parseInt(exemptEl?.value||0)||0
    const total = t + Math.round(t*0.1) + e
    monthTotal += total
    if (date === todayStr) todayTotal += total
    // 날짜 문자열로 비교 (시간대 문제 방지)
    const weekStartStr2 = weekStart instanceof Date ? weekStart.toISOString().split('T')[0] : weekStart
    const weekEndStr2 = weekEnd instanceof Date ? weekEnd.toISOString().split('T')[0] : weekEnd
    if (date >= weekStartStr2 && date <= weekEndStr2) weekTotal += total
  })

  const monthPct = totalBudget > 0 ? Math.round(monthTotal / totalBudget * 100) : 0
  const todayPct = dailyBudget > 0 ? Math.round(todayTotal / dailyBudget * 100) : 0
  const weekPct = weekBudget > 0 ? Math.round(weekTotal / weekBudget * 100) : 0

  function pctColor(p) { return p >= 100 ? 'text-red-600' : p >= 80 ? 'text-yellow-600' : 'text-green-700' }
  function barColor(p) { return p >= 100 ? '#ef4444' : p >= 80 ? '#f59e0b' : '#16a34a' }

  const updateEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val }
  const updateBar = (id, pct, color) => {
    const el = document.getElementById(id)
    if (el) { el.style.width = `${Math.min(pct,100)}%`; el.style.background = color }
  }
  const updateClass = (id, cls) => {
    const el = document.getElementById(id)
    if (el) { el.className = `text-xs font-bold ${cls}` }
  }

  updateEl('todayPct', `${todayPct}%`); updateEl('todayAmt', fmtWon(todayTotal))
  updateEl('weekPct', `${weekPct}%`); updateEl('weekAmt', fmtWon(weekTotal))
  updateEl('monthPct', `${monthPct}%`); updateEl('monthAmt', fmtWon(monthTotal))
  updateBar('todayBar', todayPct, barColor(todayPct))
  updateBar('weekBar', weekPct, barColor(weekPct))
  updateBar('monthBar', monthPct, barColor(monthPct))
  updateClass('todayPct', pctColor(todayPct))
  updateClass('weekPct', pctColor(weekPct))
  updateClass('monthPct', pctColor(monthPct))

  // 월 합계 표시 업데이트
  const mTotalEl = document.getElementById('monthTotalDisplay')
  const mPctEl = document.getElementById('monthPctDisplay')
  if (mTotalEl) mTotalEl.textContent = fmtMan(monthTotal)
  if (mPctEl) mPctEl.textContent = `${monthPct}%`

  // 실시간 식단가 업데이트
  const ms = window._ordersMealStats
  if (ms && ms.totalMeals > 0) {
    // 소모품/카드 카테고리 업체들의 합계
    const supplyTotal = ms.vendors
      .filter(v => v.category === 'supply' || v.category === 'card')
      .reduce((s, v) => {
        const vInputs = document.querySelectorAll(`.order-input[data-vendor="${v.id}"]`)
        let vTotal = 0
        const seen = new Set()
        vInputs.forEach(inp => {
          const date = inp.dataset.date
          if (seen.has(date)) return; seen.add(date)
          const taxEl = document.querySelector(`input.order-input[data-vendor="${v.id}"][data-type="taxable"][data-date="${date}"]`)
          const exEl = document.querySelector(`input.order-input[data-vendor="${v.id}"][data-type="exempt"][data-date="${date}"]`)
          const t = parseInt(taxEl?.value||0)||0
          const e = parseInt(exEl?.value||0)||0
          vTotal += t + Math.round(t*0.1) + e
        })
        return s + vTotal
      }, 0)

    const staffRatio = ms.totalMeals > 0 ? ms.totalStaff / ms.totalMeals : 0
    const staffTotal = Math.round(monthTotal * staffRatio)

    const mp1 = Math.round(monthTotal / ms.totalMeals)
    const mp2 = (ms.totalMeals - ms.totalStaff) > 0 ? Math.round((monthTotal - staffTotal) / (ms.totalMeals - ms.totalStaff)) : 0
    const mp3 = Math.round((monthTotal - supplyTotal) / ms.totalMeals)
    const tgt = ms.targetMealPrice

    const mp1El = document.getElementById('mpVal-total')
    const mp2El = document.getElementById('mpVal-nostaff')
    const mp3El = document.getElementById('mpVal-nosupply')
    const mpDiffEl = document.getElementById('mpDiff-total')
    const mpCardEl = document.getElementById('mpCard-total')

    if (mp1El) mp1El.innerHTML = `${fmt(mp1)}<span class="text-xs font-normal ml-0.5">원/식</span>`
    if (mp2El) mp2El.innerHTML = `${fmt(mp2)}<span class="text-xs font-normal ml-0.5">원/식</span>`
    if (mp3El) mp3El.innerHTML = `${fmt(mp3)}<span class="text-xs font-normal ml-0.5">원/식</span>`

    if (mpDiffEl && tgt > 0) {
      if (mp1 > tgt) {
        mpDiffEl.innerHTML = `<span class="text-red-500">▲ +${fmt(mp1-tgt)}원 초과</span>`
        if (mpCardEl) mpCardEl.className = 'rounded-xl p-3 bg-red-50 border-2 border-red-300'
      } else {
        mpDiffEl.innerHTML = `<span class="text-green-600">▼ ${fmt(tgt-mp1)}원 여유</span>`
        if (mpCardEl) mpCardEl.className = 'rounded-xl p-3 bg-blue-50'
      }
    }
  }
}

function updateDayTotal(date) {
  let total = 0
  const processedVendors = new Set()
  document.querySelectorAll(`.order-input[data-date="${date}"]`).forEach(inp => {
    const vendorId = inp.dataset.vendor
    if (processedVendors.has(vendorId)) return
    processedVendors.add(vendorId)
    const taxableEl = document.querySelector(`input.order-input[data-vendor="${vendorId}"][data-type="taxable"][data-date="${date}"]`)
    const exemptEl = document.querySelector(`input.order-input[data-vendor="${vendorId}"][data-type="exempt"][data-date="${date}"]`)
    const t = parseInt(taxableEl?.value||0)||0
    const e = parseInt(exemptEl?.value||0)||0
    total += t + Math.round(t*0.1) + e
  })
  const el = document.getElementById(`dayTotal-${date}`)
  if (el) el.textContent = total > 0 ? fmt(total) : ''
}

// ══════════════════════════════════════════════════════════════
//  식수 입력 페이지
// ══════════════════════════════════════════════════════════════
async function renderMeals() {
  const content = document.getElementById('meals-panel') || document.getElementById('pageContent')
  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`

  const mealData = await api('GET', `/api/meals/${App.currentYear}/${App.currentMonth}`)
  if (!mealData) return

  const days = getDaysInMonth(App.currentYear, App.currentMonth)
  const mealMap = {}
  mealData.forEach(m => { mealMap[m.meal_date] = m })

  // 월 합계 계산
  let monthTotal = { p:0, s:0, n:0, g:0 }
  mealData.forEach(m => {
    monthTotal.p += (m.breakfast_patient||0)+(m.lunch_patient||0)+(m.dinner_patient||0)
    monthTotal.s += (m.breakfast_staff||0)+(m.lunch_staff||0)+(m.dinner_staff||0)
    monthTotal.n += (m.breakfast_noncovered||0)+(m.lunch_noncovered||0)+(m.dinner_noncovered||0)
    monthTotal.g += (m.breakfast_guardian||0)+(m.lunch_guardian||0)+(m.dinner_guardian||0)
  })

  content.innerHTML = `
  <!-- 월 합계 요약 -->
  <div class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
    ${[
      { label: '환자식', val: monthTotal.p, color: 'blue', id: 'mealSummary-p' },
      { label: '직원식', val: monthTotal.s, color: 'green', id: 'mealSummary-s' },
      { label: '비급여', val: monthTotal.n, color: 'purple', id: 'mealSummary-n' },
      { label: '보호자', val: monthTotal.g, color: 'orange', id: 'mealSummary-g' },
      { label: '총 식수', val: monthTotal.p+monthTotal.s+monthTotal.n+monthTotal.g, color: 'gray', id: 'mealSummary-total', bold: true }
    ].map(item => `
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-3 text-center">
        <div class="text-xs text-gray-500 font-medium mb-1">${item.label}</div>
        <div class="text-xl font-bold text-${item.color}-600" id="${item.id}">${fmt(item.val)}</div>
        <div class="text-xs text-gray-400">식</div>
      </div>
    `).join('')}
  </div>

  <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
    <div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
      <div>
        <h2 class="font-bold text-gray-800">${App.currentYear}년 ${App.currentMonth}월 식수 현황</h2>
        <p class="text-xs text-gray-400 mt-0.5">조식/중식/석식 × 환자·직원·비급여·보호자</p>
      </div>
      <button onclick="saveMealBatch()" class="btn btn-success btn-sm">
        <i class="fas fa-save"></i> 전체 저장
      </button>
    </div>
    <div class="overflow-x-auto">
      <table class="meal-table w-full" style="font-size:12px">
        <thead>
          <tr>
            <th rowspan="2" style="min-width:32px">일</th>
            <th rowspan="2" style="min-width:24px">요</th>
            <th colspan="5" class="border-l-2 border-blue-700">조식</th>
            <th colspan="5" class="border-l-2 border-green-700">중식</th>
            <th colspan="5" class="border-l-2 border-purple-700">석식</th>
            <th colspan="5" class="border-l-2 border-gray-600" style="background:#0f2942">합계</th>
          </tr>
          <tr>
            ${['bf','l','d','t'].map((prefix, mi) => {
              const colors = ['border-blue-700','border-green-700','border-purple-700','border-gray-600']
              const bg = mi===3 ? 'background:#0f2942' : ''
              return `
                <th class="border-l-2 ${colors[mi]}" style="${bg}">환자</th>
                <th style="${bg}">직원</th>
                <th style="${bg}">비급</th>
                <th style="${bg}">보호</th>
                <th style="${bg};background:${mi===3?'#0f2942':'#1e3a6e'};color:#93c5fd">합</th>
              `
            }).join('')}
          </tr>
        </thead>
        <tbody id="mealTableBody">
          ${Array.from({ length: days }, (_, i) => {
            const day = i + 1
            const dow = getDayOfWeek(App.currentYear, App.currentMonth, day)
            const weekend = isWeekend(App.currentYear, App.currentMonth, day)
            const dateStr = `${App.currentYear}-${String(App.currentMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`
            const m = mealMap[dateStr] || {}
            const rowClass = dow==='일'?'holiday-row':weekend?'weekend-row':''
            const bp=m.breakfast_patient||0, bs=m.breakfast_staff||0, bn=m.breakfast_noncovered||0, bg2=m.breakfast_guardian||0
            const lp=m.lunch_patient||0, ls=m.lunch_staff||0, ln=m.lunch_noncovered||0, lg=m.lunch_guardian||0
            const dp=m.dinner_patient||0, ds=m.dinner_staff||0, dn=m.dinner_noncovered||0, dg=m.dinner_guardian||0
            return `<tr class="${rowClass}" data-date="${dateStr}">
              <td class="font-semibold text-center">${day}</td>
              <td class="text-center ${dow==='토'?'text-blue-600 font-bold':dow==='일'?'text-red-600 font-bold':''}">${dow}</td>
              ${makeMealInput('bf_p',dateStr,bp)} ${makeMealInput('bf_s',dateStr,bs)} ${makeMealInput('bf_n',dateStr,bn)} ${makeMealInput('bf_g',dateStr,bg2)}
              <td class="font-semibold text-center bg-blue-50 text-blue-800" id="bf-sum-${dateStr}">${bp+bs+bn+bg2||''}</td>
              ${makeMealInput('l_p',dateStr,lp)} ${makeMealInput('l_s',dateStr,ls)} ${makeMealInput('l_n',dateStr,ln)} ${makeMealInput('l_g',dateStr,lg)}
              <td class="font-semibold text-center bg-green-50 text-green-800" id="l-sum-${dateStr}">${lp+ls+ln+lg||''}</td>
              ${makeMealInput('d_p',dateStr,dp)} ${makeMealInput('d_s',dateStr,ds)} ${makeMealInput('d_n',dateStr,dn)} ${makeMealInput('d_g',dateStr,dg)}
              <td class="font-semibold text-center bg-purple-50 text-purple-800" id="d-sum-${dateStr}">${dp+ds+dn+dg||''}</td>
              <td class="text-center bg-gray-50" id="t-p-${dateStr}">${bp+lp+dp||''}</td>
              <td class="text-center bg-gray-50" id="t-s-${dateStr}">${bs+ls+ds||''}</td>
              <td class="text-center bg-gray-50" id="t-n-${dateStr}">${bn+ln+dn||''}</td>
              <td class="text-center bg-gray-50" id="t-g-${dateStr}">${bg2+lg+dg||''}</td>
              <td class="font-bold text-center bg-blue-100 text-blue-900" id="t-total-${dateStr}">${(bp+bs+bn+bg2)+(lp+ls+ln+lg)+(dp+ds+dn+dg)||''}</td>
            </tr>`
          }).join('')}
        </tbody>
        <tfoot>
          <tr class="bg-gray-100 font-bold" style="font-size:11px">
            <td colspan="2" class="text-center py-2">월 합계</td>
            <td class="text-center">${fmt(mealData.reduce((s,m)=>s+(m.breakfast_patient||0),0))}</td>
            <td class="text-center">${fmt(mealData.reduce((s,m)=>s+(m.breakfast_staff||0),0))}</td>
            <td class="text-center">${fmt(mealData.reduce((s,m)=>s+(m.breakfast_noncovered||0),0))}</td>
            <td class="text-center">${fmt(mealData.reduce((s,m)=>s+(m.breakfast_guardian||0),0))}</td>
            <td class="text-center bg-blue-100 font-bold">${fmt(mealData.reduce((s,m)=>s+(m.breakfast_patient||0)+(m.breakfast_staff||0)+(m.breakfast_noncovered||0)+(m.breakfast_guardian||0),0))}</td>
            <td class="text-center">${fmt(mealData.reduce((s,m)=>s+(m.lunch_patient||0),0))}</td>
            <td class="text-center">${fmt(mealData.reduce((s,m)=>s+(m.lunch_staff||0),0))}</td>
            <td class="text-center">${fmt(mealData.reduce((s,m)=>s+(m.lunch_noncovered||0),0))}</td>
            <td class="text-center">${fmt(mealData.reduce((s,m)=>s+(m.lunch_guardian||0),0))}</td>
            <td class="text-center bg-green-100 font-bold">${fmt(mealData.reduce((s,m)=>s+(m.lunch_patient||0)+(m.lunch_staff||0)+(m.lunch_noncovered||0)+(m.lunch_guardian||0),0))}</td>
            <td class="text-center">${fmt(mealData.reduce((s,m)=>s+(m.dinner_patient||0),0))}</td>
            <td class="text-center">${fmt(mealData.reduce((s,m)=>s+(m.dinner_staff||0),0))}</td>
            <td class="text-center">${fmt(mealData.reduce((s,m)=>s+(m.dinner_noncovered||0),0))}</td>
            <td class="text-center">${fmt(mealData.reduce((s,m)=>s+(m.dinner_guardian||0),0))}</td>
            <td class="text-center bg-purple-100 font-bold">${fmt(mealData.reduce((s,m)=>s+(m.dinner_patient||0)+(m.dinner_staff||0)+(m.dinner_noncovered||0)+(m.dinner_guardian||0),0))}</td>
            <td class="text-center bg-gray-200 font-bold">${fmt(monthTotal.p)}</td>
            <td class="text-center bg-gray-200 font-bold">${fmt(monthTotal.s)}</td>
            <td class="text-center bg-gray-200 font-bold">${fmt(monthTotal.n)}</td>
            <td class="text-center bg-gray-200 font-bold">${fmt(monthTotal.g)}</td>
            <td class="text-center bg-blue-200 font-bold text-blue-900">${fmt(monthTotal.p+monthTotal.s+monthTotal.n+monthTotal.g)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>`

  bindMealInputEvents()
}

function makeMealInput(key, date, val) {
  return `<td><input type="number" class="meal-input" data-key="${key}" data-date="${date}" value="${val||''}" placeholder="" min="0"></td>`
}

function bindMealInputEvents() {
  document.querySelectorAll('.meal-input').forEach(input => {
    input.addEventListener('input', function() { updateMealRowTotals(this.dataset.date) })
    input.addEventListener('change', async function() {
      const date = this.dataset.date
      const get = (k) => getMealVal(k, date)
      await api('POST', '/api/meals/save', {
        mealDate: date,
        breakfastPatient: get('bf_p'), breakfastStaff: get('bf_s'), breakfastNoncovered: get('bf_n'), breakfastGuardian: get('bf_g'),
        lunchPatient: get('l_p'), lunchStaff: get('l_s'), lunchNoncovered: get('l_n'), lunchGuardian: get('l_g'),
        dinnerPatient: get('d_p'), dinnerStaff: get('d_s'), dinnerNoncovered: get('d_n'), dinnerGuardian: get('d_g')
      })
    })
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === 'Tab') {
        const inputs = [...document.querySelectorAll('.meal-input')]
        const idx = inputs.indexOf(this)
        if (idx < inputs.length-1) { e.preventDefault(); inputs[idx+1].focus() }
      }
    })
  })
}

function getMealVal(key, date) {
  return parseInt(document.querySelector(`input.meal-input[data-key="${key}"][data-date="${date}"]`)?.value||0)||0
}

function updateMealRowTotals(date) {
  const g = (k) => getMealVal(k, date)
  const bp=g('bf_p'),bs=g('bf_s'),bn=g('bf_n'),bg2=g('bf_g')
  const lp=g('l_p'),ls=g('l_s'),ln=g('l_n'),lg=g('l_g')
  const dp=g('d_p'),ds=g('d_s'),dn=g('d_n'),dg=g('d_g')
  const set = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=v||'' }
  set(`bf-sum-${date}`,bp+bs+bn+bg2); set(`l-sum-${date}`,lp+ls+ln+lg); set(`d-sum-${date}`,dp+ds+dn+dg)
  set(`t-p-${date}`,bp+lp+dp); set(`t-s-${date}`,bs+ls+ds); set(`t-n-${date}`,bn+ln+dn); set(`t-g-${date}`,bg2+lg+dg)
  set(`t-total-${date}`,(bp+bs+bn+bg2)+(lp+ls+ln+lg)+(dp+ds+dn+dg))
  // 상단 요약 카드 실시간 업데이트
  updateMealSummaryCards()
}

function updateMealSummaryCards() {
  // 전체 테이블에서 각 카테고리 합산
  let tp=0, ts=0, tn=0, tg=0
  document.querySelectorAll('#mealTableBody tr[data-date]').forEach(row => {
    const date = row.dataset.date
    const g = (k) => getMealVal(k, date)
    tp += g('bf_p')+g('l_p')+g('d_p')
    ts += g('bf_s')+g('l_s')+g('d_s')
    tn += g('bf_n')+g('l_n')+g('d_n')
    tg += g('bf_g')+g('l_g')+g('d_g')
  })
  // 상단 카드 ID로 업데이트
  const setCard = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=fmt(v) }
  setCard('mealSummary-p', tp)
  setCard('mealSummary-s', ts)
  setCard('mealSummary-n', tn)
  setCard('mealSummary-g', tg)
  setCard('mealSummary-total', tp+ts+tn+tg)
}

async function saveMealBatch() {
  const rows = document.querySelectorAll('#mealTableBody tr[data-date]')
  let saved = 0
  const promises = []
  rows.forEach(row => {
    const date = row.dataset.date
    const g = (k) => getMealVal(k, date)
    const total = ['bf_p','bf_s','bf_n','bf_g','l_p','l_s','l_n','l_g','d_p','d_s','d_n','d_g'].reduce((s,k)=>s+g(k),0)
    if (total > 0) {
      saved++
      promises.push(api('POST', '/api/meals/save', {
        mealDate: date,
        breakfastPatient: g('bf_p'), breakfastStaff: g('bf_s'), breakfastNoncovered: g('bf_n'), breakfastGuardian: g('bf_g'),
        lunchPatient: g('l_p'), lunchStaff: g('l_s'), lunchNoncovered: g('l_n'), lunchGuardian: g('l_g'),
        dinnerPatient: g('d_p'), dinnerStaff: g('d_s'), dinnerNoncovered: g('d_n'), dinnerGuardian: g('d_g')
      }))
    }
  })
  await Promise.all(promises)
  showToast(`${saved}일치 식수 저장 완료!`, 'success')
}

// ══════════════════════════════════════════════════════════════
//  연간 분석 페이지
// ══════════════════════════════════════════════════════════════
async function renderAnalysis(selectedHospitalId = null) {
  const content = document.getElementById('pageContent')
  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`

  // admin이면 병원 목록 먼저 로드
  let hospitals = []
  if (App.role === 'admin') {
    const hList = await api('GET', '/api/admin/hospitals')
    hospitals = hList || []
    if (!selectedHospitalId && hospitals.length > 0) selectedHospitalId = hospitals[0].id
  }

  const url = App.role === 'admin'
    ? `/api/dashboard/annual/${App.currentYear}?hospitalId=${selectedHospitalId}`
    : `/api/dashboard/annual/${App.currentYear}`

  const data = await api('GET', url)
  if (!data) {
    content.innerHTML = '<div class="text-red-500 p-6">데이터 로드 실패</div>'
    return
  }

  const months = Array.from({length:12}, (_,i) => `${i+1}월`)
  const usedByMonth = Array(12).fill(0)
  const budgetByMonth = Array(12).fill(0)
  const mealsByMonth = Array(12).fill(0)
  const mealPriceByMonth = Array(12).fill(0)

  ;(data.monthly||[]).forEach(m => { usedByMonth[parseInt(m.month)-1] = m.total_used })
  ;(data.settings||[]).forEach(m => { budgetByMonth[m.month-1] = m.total_budget })
  ;(data.mealMonthly||[]).forEach(m => {
    const idx = parseInt(m.month)-1
    mealsByMonth[idx] = m.total_meals
    if (m.total_meals > 0 && usedByMonth[idx] > 0) {
      mealPriceByMonth[idx] = Math.round(usedByMonth[idx] / m.total_meals)
    }
  })

  const totalUsed = usedByMonth.reduce((s,v)=>s+v,0)
  const totalBudget = budgetByMonth.reduce((s,v)=>s+v,0)
  const totalMeals = mealsByMonth.reduce((s,v)=>s+v,0)
  const avgMealPrice = totalMeals > 0 ? Math.round(totalUsed / totalMeals) : 0

  // admin 병원 선택 셀렉트
  const hospitalSelectHtml = App.role === 'admin' && hospitals.length > 0 ? `
  <div class="mb-4 flex items-center gap-3">
    <label class="text-sm font-semibold text-gray-600">병원 선택</label>
    <select id="analysisHospitalSelect" onchange="renderAnalysis(this.value)"
      class="form-input" style="width:auto;min-width:180px">
      ${hospitals.map(h => `<option value="${h.id}" ${h.id == selectedHospitalId ? 'selected' : ''}>${h.name}</option>`).join('')}
    </select>
    <span class="text-sm text-gray-400">${App.currentYear}년 연간 분석</span>
  </div>` : ''

  content.innerHTML = `
  ${hospitalSelectHtml}

  <!-- 연간 요약 -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
    <div class="stat-card">
      <div class="text-xs text-gray-500 mb-1">연간 총 사용</div>
      <div class="text-xl font-bold text-green-700">${fmtMan(totalUsed)}원</div>
      <div class="text-xs text-gray-400">예산: ${fmtMan(totalBudget)}원</div>
    </div>
    <div class="stat-card">
      <div class="text-xs text-gray-500 mb-1">연간 진행률</div>
      <div class="text-xl font-bold ${totalBudget>0&&totalUsed>totalBudget?'text-red-600':'text-green-600'}">
        ${totalBudget > 0 ? ((totalUsed/totalBudget)*100).toFixed(1) : 0}%
      </div>
    </div>
    <div class="stat-card">
      <div class="text-xs text-gray-500 mb-1">연간 총 식수</div>
      <div class="text-xl font-bold text-purple-600">${fmt(totalMeals)}식</div>
    </div>
    <div class="stat-card">
      <div class="text-xs text-gray-500 mb-1">평균 식단가</div>
      <div class="text-xl font-bold text-orange-600">${fmt(avgMealPrice)}원</div>
    </div>
  </div>

  <!-- 월별 카드 -->
  <div class="grid grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
    ${months.map((m, i) => {
      const used = usedByMonth[i]
      const budget = budgetByMonth[i]
      const pct = budget > 0 ? (used/budget*100) : null
      const isCurrentMonth = (i+1) === App.currentMonth
      return `<div class="stat-card ${isCurrentMonth?'ring-2 ring-green-500':''}">
        <div class="flex justify-between items-center mb-1">
          <span class="font-semibold text-sm ${isCurrentMonth?'text-green-700':''}">${m}</span>
          <span class="badge ${pct!==null?getBadgeColor(pct):'badge-gray'}" style="font-size:9px">${pct!==null?pct.toFixed(0)+'%':'-'}</span>
        </div>
        <div class="font-bold text-gray-800 text-sm">${used>0?fmtMan(used)+'원':'-'}</div>
        ${budget > 0 ? `<div class="mt-1 progress-bar h-1.5">
          <div class="progress-fill ${getProgressColor(pct||0)}" style="width:${Math.min(pct||0,100)}%"></div>
        </div>` : ''}
      </div>`
    }).join('')}
  </div>

  <!-- 차트들 -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <h2 class="font-bold text-gray-800 mb-4">${App.currentYear}년 월별 예산 vs 사용금액</h2>
      <canvas id="annualChart"></canvas>
    </div>
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <h2 class="font-bold text-gray-800 mb-4">월별 식수 추이 & 식단가</h2>
      <canvas id="mealChart"></canvas>
    </div>
  </div>`

  App.charts.annual = new Chart(document.getElementById('annualChart'), {
    type: 'bar',
    data: {
      labels: months,
      datasets: [
        { label: '사용금액', data: usedByMonth, backgroundColor: 'rgba(22,163,74,0.75)', borderRadius: 6 },
        { label: '목표예산', data: budgetByMonth, type: 'line', borderColor: '#ef4444', borderDash: [5,5], borderWidth: 2, pointRadius: 3, fill: false }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: { y: { ticks: { callback: v => `${(v/10000000).toFixed(0)}천만` } } }
    }
  })

  App.charts.meal = new Chart(document.getElementById('mealChart'), {
    type: 'bar',
    data: {
      labels: months,
      datasets: [
        { label: '식수', data: mealsByMonth, backgroundColor: 'rgba(16,185,129,0.6)', borderRadius: 4, yAxisID: 'y' },
        { label: '식단가', data: mealPriceByMonth, type: 'line', borderColor: '#f59e0b', borderWidth: 2, pointRadius: 4, fill: false, yAxisID: 'y1' }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: {
        y: { ticks: { callback: v => `${v}식` }, position: 'left' },
        y1: { ticks: { callback: v => `${(v/1000).toFixed(1)}천원` }, position: 'right', grid: { drawOnChartArea: false } }
      }
    }
  })
}

// ══════════════════════════════════════════════════════════════
//  설정 페이지
// ══════════════════════════════════════════════════════════════

async function renderSettings() {
  stopClosingPoll()
  const content = document.getElementById('pageContent')
  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`

  // 마감 현황 + 활성 월 정보 로드
  const activeMonth = await api('GET', '/api/settings/active-month')

  const activeYear = activeMonth?.year || App.currentYear
  const activeMon = activeMonth?.month || App.currentMonth
  const closingStatus = activeMonth?.closingStatus || 'open'
  const closingReqAt = activeMonth?.closingRequestedAt

  // App 상태와 사이드바 월 표시를 DB 기준으로 동기화
  if (activeMonth?.year) {
    App.currentYear = activeMonth.year
    App.currentMonth = activeMonth.month
    updateMonthDisplay()
  }

  content.innerHTML = `
  <div class="max-w-2xl mx-auto space-y-5">

    <!-- 현재 활성 월 안내 -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 class="font-bold text-gray-800 mb-4">
        <i class="fas fa-calendar-check text-green-600 mr-2"></i>현재 운영 월
      </h2>
      <div class="flex items-center gap-4">
        <div class="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center">
          <i class="fas fa-calendar-alt text-green-600 text-2xl"></i>
        </div>
        <div>
          <div class="text-3xl font-bold text-green-700">${activeYear}년 ${activeMon}월</div>
          <div class="text-sm text-gray-500 mt-1">현재 발주 입력 및 관리 중인 월</div>
        </div>
        <div class="ml-auto">
          <span class="badge ${closingStatus==='requested'?'badge-yellow':closingStatus==='closed'?'badge-green':'badge-gray'} text-sm px-3 py-1">
            ${closingStatus==='requested'?'마감 요청중':closingStatus==='closed'?'마감완료':'운영중'}
          </span>
        </div>
      </div>
      ${closingReqAt ? `<div class="mt-3 text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
        <i class="fas fa-clock mr-1"></i>마감 요청일: ${closingReqAt?.split('T')[0]} · 관리자 승인 대기 중
      </div>` : ''}
    </div>

    <!-- 마감 요청 카드 -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 class="font-bold text-gray-800 mb-2">
        <i class="fas fa-flag-checkered text-green-600 mr-2"></i>월 마감 요청
      </h2>
      <p class="text-sm text-gray-500 mb-5">
        이번 달 발주 입력이 완료되면 관리자에게 마감 요청을 보내세요.<br>
        관리자가 승인하면 다음 달로 자동 전환됩니다.
      </p>

      ${closingStatus === 'requested' ? `
      <!-- 이미 요청됨 -->
      <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
        <i class="fas fa-hourglass-half text-amber-500 text-xl"></i>
        <div>
          <div class="font-semibold text-amber-800">${activeYear}년 ${activeMon}월 마감 요청 완료</div>
          <div class="text-sm text-amber-600">관리자의 승인을 기다리고 있습니다</div>
        </div>
      </div>
      ` : closingStatus === 'closed' ? `
      <!-- 마감 완료 -->
      <div class="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
        <i class="fas fa-check-circle text-green-500 text-xl"></i>
        <div>
          <div class="font-semibold text-green-800">마감 완료</div>
          <div class="text-sm text-green-600">다음 달로 전환되었습니다</div>
        </div>
      </div>
      ` : `
      <!-- 마감 요청 폼 -->
      <div class="space-y-3">
        <div>
          <label class="block text-sm font-medium text-gray-600 mb-1">마감 메모 (선택)</label>
          <textarea id="closingMemo" class="form-input" rows="3" placeholder="특이사항, 인수인계 내용 등을 입력하세요"></textarea>
        </div>
        <button onclick="submitClosingRequest(${activeYear},${activeMon})" class="btn btn-primary w-full">
          <i class="fas fa-paper-plane mr-2"></i>${activeYear}년 ${activeMon}월 마감 요청 보내기
        </button>
      </div>
      `}
    </div>

    <!-- 안내 사항 -->
    <div class="bg-gray-50 rounded-2xl border border-gray-100 p-5">
      <h3 class="font-semibold text-gray-600 mb-3 text-sm"><i class="fas fa-info-circle text-gray-400 mr-1"></i>안내</h3>
      <ul class="text-sm text-gray-500 space-y-2">
        <li><i class="fas fa-check text-green-500 mr-2 text-xs"></i>이번 달 발주 입력이 완료되면 <strong class="text-gray-700">마감 요청</strong>을 보내세요</li>
        <li><i class="fas fa-check text-green-500 mr-2 text-xs"></i>관리자가 승인하면 <strong class="text-gray-700">다음 달로 자동 전환</strong>됩니다</li>
        <li><i class="fas fa-check text-green-500 mr-2 text-xs"></i>문의사항은 관리자에게 연락하세요</li>
      </ul>
    </div>

  </div>`

  // 마감 요청 중일 때 자동 감지 폴링 시작 (20초마다 승인 여부 확인)
  if (closingStatus === 'requested') {
    startClosingPoll(activeYear, activeMon)
  }
}

// ── 잔반 입력 모달 ─────────────────────────────────────────────
window.showFoodWasteModal = async function(year, month) {
  const existing = await api('GET', `/api/settings/food-waste/${year}/${month}`) || []
  const weeks = [1,2,3,4,5]
  const wMap = {}
  existing.forEach(w => { wMap[w.week] = w })

  let modal = document.getElementById('foodWasteModal')
  if (!modal) {
    modal = document.createElement('div')
    modal.id = 'foodWasteModal'
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9000;display:flex;align-items:center;justify-content:center;'
    document.body.appendChild(modal)
  }
  modal.innerHTML = `
  <div class="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4">
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-bold text-gray-800"><i class="fas fa-recycle text-amber-500 mr-2"></i>잔반 기록 - ${year}년 ${month}월</h3>
      <button onclick="document.getElementById('foodWasteModal').remove()" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>
    </div>
    <div class="space-y-3">
      ${weeks.map(w => {
        const d = wMap[w] || {}
        return `
        <div class="p-3 bg-gray-50 rounded-xl">
          <div class="font-semibold text-sm text-gray-700 mb-2">${w}주차</div>
          <div class="grid grid-cols-3 gap-2">
            <div>
              <label class="text-xs text-gray-500">잔반량(kg)</label>
              <input type="number" id="fw-amount-${w}" class="form-input text-sm" step="0.1" min="0" value="${d.waste_amount||''}" placeholder="0.0">
            </div>
            <div>
              <label class="text-xs text-gray-500">비용(원)</label>
              <input type="number" id="fw-cost-${w}" class="form-input text-sm" min="0" value="${d.waste_cost||''}" placeholder="0">
            </div>
            <div>
              <label class="text-xs text-gray-500">메모</label>
              <input type="text" id="fw-memo-${w}" class="form-input text-sm" value="${d.memo||''}" placeholder="">
            </div>
          </div>
        </div>`
      }).join('')}
    </div>
    <div class="flex gap-3 mt-5">
      <button onclick="saveFoodWaste(${year},${month})" class="btn btn-primary flex-1"><i class="fas fa-save mr-1"></i>저장</button>
      <button onclick="document.getElementById('foodWasteModal').remove()" class="btn btn-secondary">취소</button>
    </div>
  </div>`
  modal.style.display = 'flex'
}

window.saveFoodWaste = async function(year, month) {
  const weeks = [1,2,3,4,5]
  let saved = 0
  for (const w of weeks) {
    const amount = parseFloat(document.getElementById(`fw-amount-${w}`)?.value || 0) || 0
    const cost = parseInt(document.getElementById(`fw-cost-${w}`)?.value || 0) || 0
    const memo = document.getElementById(`fw-memo-${w}`)?.value || ''
    if (amount > 0 || cost > 0) {
      await api('POST', '/api/settings/food-waste', { year, month, week: w, waste_amount: amount, waste_cost: cost, memo })
      saved++
    }
  }
  document.getElementById('foodWasteModal')?.remove()
  showToast(`잔반 기록 ${saved}건 저장됨`, 'success')
  renderDashboard()
}

async function submitClosingRequest(year, month) {
  const memo = document.getElementById('closingMemo')?.value || ''
  if (!confirm(`${year}년 ${month}월 마감 요청을 보내시겠습니까?\n관리자 승인 후 다음 달로 전환됩니다.`)) return
  const res = await api('POST', '/api/settings/closing-request', { year, month, memo })
  if (res?.success) {
    showToast('마감 요청이 전송되었습니다. 관리자 승인을 기다려 주세요.', 'success')
    renderSettings()
  } else {
    showToast('마감 요청 실패', 'error')
  }
}

async function saveSettings() {
  const get = id => parseInt(document.getElementById(id)?.value||0)||0
  const res = await api('POST', '/api/settings/save', {
    year: App.currentYear, month: App.currentMonth,
    totalBudget: get('set-totalBudget'), eventBudget: get('set-eventBudget'),
    mealPrice: get('set-mealPrice'), foodWasteBudget: get('set-foodWasteBudget'),
    workingDays: get('set-workingDays')
  })
  if (res?.success) showToast('설정이 저장되었습니다', 'success')
  else showToast('저장 실패', 'error')
}

function showAddVendorModal() {
  document.getElementById('vendorModalTitle').textContent = '업체 추가'
  document.getElementById('vendorId').value = ''
  document.getElementById('vendorName').value = ''
  document.getElementById('vendorBudget').value = ''
  document.getElementById('vendorModal').classList.remove('hidden')
}

function editVendor(id) {
  const btn = document.querySelector(`[onclick="editVendor(${id})"]`)
  const name = btn?.dataset.name || ''
  const category = btn?.dataset.cat || 'general'
  const taxType = btn?.dataset.tax || 'mixed'
  const budget = parseInt(btn?.dataset.budget || 0)
  document.getElementById('vendorModalTitle').textContent = '업체 수정'
  document.getElementById('vendorId').value = id
  document.getElementById('vendorName').value = name
  document.getElementById('vendorCategory').value = category
  document.getElementById('vendorTaxType').value = taxType
  document.getElementById('vendorBudget').value = budget
  document.getElementById('vendorModal').classList.remove('hidden')
}

function closeVendorModal() { document.getElementById('vendorModal').classList.add('hidden') }

async function saveVendor() {
  const id = document.getElementById('vendorId').value
  const data = {
    name: document.getElementById('vendorName').value,
    category: document.getElementById('vendorCategory').value,
    taxType: document.getElementById('vendorTaxType').value,
    monthlyBudget: parseInt(document.getElementById('vendorBudget').value||0)||0
  }
  if (!data.name.trim()) { showToast('업체명을 입력하세요', 'error'); return }
  const res = id ? await api('PUT', `/api/vendors/${id}`, data) : await api('POST', '/api/vendors', data)
  if (res?.success) {
    closeVendorModal()
    showToast(id ? '업체가 수정되었습니다' : '업체가 추가되었습니다', 'success')
    renderSettings()
  }
}

async function deleteVendor(id) {
  if (!confirm('업체를 삭제하시겠습니까?\n(해당 업체의 발주 데이터는 유지됩니다)')) return
  await api('DELETE', `/api/vendors/${id}`)
  showToast('업체가 삭제되었습니다', 'success')
  renderSettings()
}

// ══════════════════════════════════════════════════════════════
//  관리자 대시보드
// ══════════════════════════════════════════════════════════════
async function renderAdminDashboard() {
  const content = document.getElementById('pageContent')
  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`

  const data = await api('GET', `/api/admin/dashboard/${App.currentYear}/${App.currentMonth}`)
  if (!data) return

  const hospitals = data.hospitals || []
  const onlineCount = hospitals.filter(h => h.online).length
  const issueCount = hospitals.reduce((s,h) => s + h.issues.filter(i=>i.level==='danger').length, 0)
  const overCount = hospitals.filter(h => h.totalBudget > 0 && h.totalUsed > h.totalBudget).length

  content.innerHTML = `
  <!-- 상단 요약 카드 4개 -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
    <div class="stat-card border-l-4 border-green-500">
      <div class="text-xs text-gray-500 mb-1">관리 병원</div>
      <div class="text-3xl font-bold text-green-700">${hospitals.length}<span class="text-sm font-normal text-gray-400 ml-1">개</span></div>
      <div class="text-xs text-gray-400 mt-1">온라인: <span class="text-green-600 font-semibold">${onlineCount}개</span></div>
    </div>
    <div class="stat-card border-l-4 border-blue-500">
      <div class="text-xs text-gray-500 mb-1">오늘 총 발주</div>
      <div class="text-lg font-bold text-gray-800">${fmtMan(hospitals.reduce((s,h)=>s+h.todayUsed,0))}원</div>
      <div class="text-xs text-gray-400 mt-1">이번 주: ${fmtMan(hospitals.reduce((s,h)=>s+h.weekUsed,0))}원</div>
    </div>
    <div class="stat-card border-l-4 ${overCount>0?'border-red-500':'border-green-500'}">
      <div class="text-xs text-gray-500 mb-1">예산 초과 병원</div>
      <div class="text-2xl font-bold ${overCount>0?'text-red-600':'text-green-700'}">${overCount}개</div>
      <div class="text-xs text-gray-400 mt-1">위험 이슈: <span class="${issueCount>0?'text-red-500 font-semibold':'text-gray-400'}">${issueCount}건</span></div>
    </div>
    <div class="stat-card border-l-4 border-amber-500">
      <div class="text-xs text-gray-500 mb-1">마감 요청 대기</div>
      <div class="text-2xl font-bold text-amber-600">${hospitals.filter(h=>h.closingStatus==='requested').length}건</div>
      <div class="text-xs text-gray-400 mt-1">${App.currentYear}년 ${App.currentMonth}월 기준</div>
    </div>
  </div>

  <!-- 탭 -->
  <div class="flex gap-1 mb-4 border-b border-gray-200">
    <button id="adminTab-cards" onclick="switchAdminTab('cards')" class="px-4 py-2 text-sm font-medium border-b-2 border-green-600 text-green-700">
      <i class="fas fa-th-large mr-1"></i>병원별 현황
    </button>
    <button id="adminTab-issues" onclick="switchAdminTab('issues')" class="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700">
      <i class="fas fa-exclamation-triangle mr-1 text-amber-500"></i>데일리 이슈
    </button>
    <button id="adminTab-chart" onclick="switchAdminTab('chart')" class="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700">
      <i class="fas fa-chart-bar mr-1"></i>발주 비교
    </button>
  </div>

  <!-- 병원별 카드 탭 -->
  <div id="adminContent-cards">
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      ${hospitals.map(h => {
        const pct = parseFloat(h.progress)
        const over = h.totalBudget > 0 && h.totalUsed > h.totalBudget
        const warn = !over && h.totalBudget > 0 && pct >= 90
        const borderColor = over ? 'border-red-400' : warn ? 'border-amber-300' : 'border-gray-100'
        const iconBg = over ? 'bg-red-50' : 'bg-green-50'
        const iconColor = over ? 'text-red-500' : 'text-green-600'
        // 식단가 색상
        const mpOver = h.targetMealPrice > 0 && h.mealPriceTotal > h.targetMealPrice
        const mpWarn = !mpOver && h.targetMealPrice > 0 && h.mealPriceTotal > h.targetMealPrice * 0.95
        const mpColor = mpOver ? 'text-red-600' : mpWarn ? 'text-amber-600' : 'text-green-700'
        const dangerIssues = h.issues.filter(i=>i.level==='danger')
        const warnIssues = h.issues.filter(i=>i.level==='warning')
        const totalIssues = dangerIssues.length + warnIssues.length
        // 오늘 식수 계산
        const tm = h.todayMeals || {}
        const todayBreakfast = (tm.bp||0)+(tm.bs||0)+(tm.bn||0)+(tm.bg||0)
        const todayLunch     = (tm.lp||0)+(tm.ls||0)+(tm.ln||0)+(tm.lg||0)
        const todayDinner    = (tm.dp||0)+(tm.ds||0)+(tm.dn||0)+(tm.dg||0)
        const todayTotalMeals = todayBreakfast + todayLunch + todayDinner
        // 오늘 치료식(일반 환자식) = breakfast_patient + lunch_patient + dinner_patient
        const todayTherapy = (tm.bp||0)+(tm.lp||0)+(tm.dp||0)
        return `
        <div class="bg-white rounded-2xl shadow-sm border-2 ${borderColor} p-4 relative">
          <!-- 이슈 경고 배너 (이슈 있을 때만) -->
          ${totalIssues > 0 ? `
          <div class="flex items-center gap-2 mb-3 px-2 py-1.5 rounded-xl ${dangerIssues.length>0?'bg-red-50 border border-red-200':'bg-amber-50 border border-amber-200'}">
            <span class="relative flex h-2 w-2">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full ${dangerIssues.length>0?'bg-red-400':'bg-amber-400'} opacity-75"></span>
              <span class="relative inline-flex rounded-full h-2 w-2 ${dangerIssues.length>0?'bg-red-500':'bg-amber-500'}"></span>
            </span>
            <span class="text-xs font-semibold ${dangerIssues.length>0?'text-red-700':'text-amber-700'} flex-1">
              ${dangerIssues.length>0?`🚨 위험 이슈 ${dangerIssues.length}건`:`⚠️ 주의 이슈 ${warnIssues.length}건`}
            </span>
            ${dangerIssues.length>0&&warnIssues.length>0?`<span class="text-xs text-amber-600">+경고 ${warnIssues.length}건</span>`:''}
          </div>` : ''}
          <!-- 헤더 -->
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <div class="w-9 h-9 rounded-xl ${iconBg} flex items-center justify-center">
                <i class="fas fa-hospital ${iconColor} text-sm"></i>
              </div>
              <div>
                <div class="font-bold text-gray-800 text-sm">${h.hospital.name}</div>
                <div class="text-xs text-gray-400">${h.activeYear}년 ${h.activeMonth}월 운영 중</div>
              </div>
            </div>
            <div class="flex items-center gap-2 flex-wrap justify-end">
              ${h.online ? `
              <span class="flex items-center gap-1 text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full border border-green-200">
                <span class="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                ${h.online.username || '온라인'}
              </span>` : `<span class="text-xs text-gray-300">오프라인</span>`}
              ${h.closingStatus==='requested'?`<span class="badge badge-yellow text-xs">마감요청</span>`:''}
            </div>
          </div>

          <!-- ① 예산 진행률 -->
          <div class="mb-3">
            <div class="flex justify-between items-center mb-1">
              <span class="text-xs text-gray-500 font-medium">월 예산 사용률</span>
              <span class="text-xs font-bold ${over?'text-red-600':warn?'text-amber-600':'text-green-600'}">${pct.toFixed(1)}%</span>
            </div>
            <div class="progress-bar mb-1.5">
              <div class="progress-fill ${getProgressColor(pct)}" style="width:${Math.min(pct,100)}%"></div>
            </div>
            <div class="grid grid-cols-3 gap-1.5 text-center">
              <div class="p-1.5 bg-gray-50 rounded-lg">
                <div class="text-xs text-gray-400">사용</div>
                <div class="text-xs font-bold text-gray-700">${fmtMan(h.totalUsed)}원</div>
              </div>
              <div class="p-1.5 bg-gray-50 rounded-lg">
                <div class="text-xs text-gray-400">목표</div>
                <div class="text-xs font-semibold text-gray-600">${h.totalBudget>0?fmtMan(h.totalBudget)+'원':'-'}</div>
              </div>
              <div class="p-1.5 ${over?'bg-red-50':'bg-green-50'} rounded-lg">
                <div class="text-xs ${over?'text-red-400':'text-gray-400'}">잔여</div>
                <div class="text-xs font-bold ${over?'text-red-600':'text-green-600'}">${fmtMan(h.remaining)}원</div>
              </div>
            </div>
          </div>

          <!-- ② 식단가 3종 (핵심!) -->
          <div class="mb-3 p-2.5 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-100">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-semibold text-blue-700"><i class="fas fa-utensils mr-1"></i>식단가 현황</span>
              ${h.targetMealPrice>0?`<span class="text-xs text-blue-500">목표 ${h.targetMealPrice.toLocaleString()}원</span>`:''}
            </div>
            <div class="grid grid-cols-3 gap-1.5 text-center">
              <div class="p-1.5 bg-white rounded-lg border ${mpOver?'border-red-300':mpWarn?'border-amber-300':'border-blue-100'} relative">
                ${mpOver?`<div class="absolute -top-1.5 left-1/2 -translate-x-1/2 text-xs">🚨</div>`:''}
                <div class="text-xs text-blue-500 mt-1">전체</div>
                <div class="text-xs font-bold ${mpColor}">${h.mealPriceTotal>0?h.mealPriceTotal.toLocaleString()+' 원':'-'}</div>
                ${mpOver?`<div class="text-xs text-red-500">▲초과</div>`:mpWarn?`<div class="text-xs text-amber-500">▲주의</div>`:`<div class="text-xs text-gray-300">-</div>`}
              </div>
              <div class="p-1.5 bg-white rounded-lg border border-purple-100">
                <div class="text-xs text-purple-500">직원제외</div>
                <div class="text-xs font-bold text-purple-700">${h.mealPriceNoStaff>0?h.mealPriceNoStaff.toLocaleString()+' 원':'-'}</div>
                <div class="text-xs text-gray-300">-</div>
              </div>
              <div class="p-1.5 bg-white rounded-lg border border-orange-100">
                <div class="text-xs text-orange-500">소모품제외</div>
                <div class="text-xs font-bold text-orange-700">${h.mealPriceNoSupply>0?h.mealPriceNoSupply.toLocaleString()+' 원':'-'}</div>
                <div class="text-xs text-gray-300">-</div>
              </div>
            </div>
          </div>

          <!-- ③ 오늘 식수 현황 -->
          <div class="mb-3 p-2.5 bg-gradient-to-r from-teal-50 to-cyan-50 rounded-xl border border-teal-100">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-semibold text-teal-700"><i class="fas fa-people-group mr-1"></i>오늘 식수</span>
              <span class="text-xs font-bold text-teal-800">${todayTotalMeals>0?`전체 ${fmt(todayTotalMeals)}식`:'입력 없음'}</span>
            </div>
            <div class="grid grid-cols-4 gap-1 text-center">
              <div class="p-1.5 bg-white rounded-lg border border-teal-100">
                <div class="text-xs text-teal-600 font-medium">조식</div>
                <div class="text-sm font-bold text-gray-700">${todayBreakfast}</div>
                <div class="text-xs text-gray-400">식</div>
              </div>
              <div class="p-1.5 bg-white rounded-lg border border-teal-100">
                <div class="text-xs text-teal-600 font-medium">중식</div>
                <div class="text-sm font-bold text-gray-700">${todayLunch}</div>
                <div class="text-xs text-gray-400">식</div>
              </div>
              <div class="p-1.5 bg-white rounded-lg border border-teal-100">
                <div class="text-xs text-teal-600 font-medium">석식</div>
                <div class="text-sm font-bold text-gray-700">${todayDinner}</div>
                <div class="text-xs text-gray-400">식</div>
              </div>
              <div class="p-1.5 bg-white rounded-lg border border-indigo-100">
                <div class="text-xs text-indigo-600 font-medium">치료식</div>
                <div class="text-sm font-bold text-indigo-700">${todayTherapy}</div>
                <div class="text-xs text-gray-400">명</div>
              </div>
            </div>
            <!-- 월간 누적 식수 -->
            ${h.totalMeals > 0 ? `
            <div class="mt-1.5 flex justify-between text-xs text-teal-600 bg-teal-50 rounded-lg px-2 py-1">
              <span>월간 누적</span>
              <span class="font-semibold">${fmt(h.totalMeals)}식 (환자 ${fmt(h.mealStats?.total_patient||0)} / 직원 ${fmt(h.mealStats?.total_staff||0)} / 비급여 ${fmt(h.mealStats?.total_noncovered||0)} / 보호자 ${fmt(h.mealStats?.total_guardian||0)})</span>
            </div>` : ''}
          </div>

          <!-- ④ 발주 현황 & 잔반 -->
          <div class="flex gap-2 text-xs text-gray-500 mb-2">
            <span>오늘발주: <strong class="text-gray-700">${fmtMan(h.todayUsed)}원</strong></span>
            <span>·</span>
            <span>이번주: <strong class="text-gray-700">${fmtMan(h.weekUsed)}원</strong></span>
            ${h.foodWaste.totalWaste > 0 ? `<span>·</span><span>잔반: <strong class="text-amber-600">${h.foodWaste.totalWaste.toFixed(1)}kg</strong></span>` : ''}
          </div>

          <!-- ⑤ 이슈 목록 -->
          ${dangerIssues.length > 0 ? `
          <div class="space-y-1">
            ${dangerIssues.map(i=>`
            <div class="flex items-center gap-1 text-xs bg-red-50 text-red-700 px-2 py-1 rounded-lg border border-red-100">
              <i class="fas fa-exclamation-circle text-red-400 flex-shrink-0"></i><span>${i.msg}</span>
            </div>`).join('')}
          </div>` : ''}
          ${warnIssues.length > 0 ? `
          <div class="space-y-1 mt-1">
            ${warnIssues.slice(0,2).map(i=>`
            <div class="flex items-center gap-1 text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded-lg border border-amber-100">
              <i class="fas fa-exclamation-triangle text-amber-400 flex-shrink-0"></i><span>${i.msg}</span>
            </div>`).join('')}
            ${warnIssues.length>2?`<div class="text-xs text-gray-400 text-right mt-1">+${warnIssues.length-2}건 더 있음</div>`:''}
          </div>` : ''}
        </div>`
      }).join('')}
    </div>
  </div>

  <!-- 데일리 이슈 탭 -->
  <div id="adminContent-issues" class="hidden">
    ${hospitals.every(h=>h.issues.length===0) ? `
    <div class="text-center py-12 text-gray-400">
      <i class="fas fa-check-circle text-green-400 text-4xl mb-3"></i>
      <div class="font-semibold">현재 이슈 없음</div>
      <div class="text-sm mt-1">모든 병원이 정상 범위 내에서 운영 중입니다</div>
    </div>` : `
    <!-- 이슈 요약 카드 -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <div class="bg-red-50 rounded-xl p-3 border border-red-200">
        <div class="text-xs text-red-500 mb-1">예산 초과 병원</div>
        <div class="text-2xl font-bold text-red-600">${hospitals.filter(h=>h.issues.some(i=>i.type==='budget_over')).length}개</div>
      </div>
      <div class="bg-amber-50 rounded-xl p-3 border border-amber-200">
        <div class="text-xs text-amber-500 mb-1">업체 초과</div>
        <div class="text-2xl font-bold text-amber-600">${hospitals.reduce((s,h)=>s+h.issues.filter(i=>i.type==='vendor_over').length,0)}건</div>
      </div>
      <div class="bg-orange-50 rounded-xl p-3 border border-orange-200">
        <div class="text-xs text-orange-500 mb-1">일 발주 초과</div>
        <div class="text-2xl font-bold text-orange-600">${hospitals.reduce((s,h)=>s+h.issues.filter(i=>i.type==='daily_over').length,0)}건</div>
      </div>
      <div class="bg-purple-50 rounded-xl p-3 border border-purple-200">
        <div class="text-xs text-purple-500 mb-1">식단가 초과</div>
        <div class="text-2xl font-bold text-purple-600">${hospitals.filter(h=>h.issues.some(i=>i.type==='meal_price_over')).length}개</div>
      </div>
    </div>
    <!-- 병원별 상세 이슈 -->
    <div class="space-y-4">
      ${hospitals.filter(h=>h.issues.length>0).map(h => {
        const dangerIssues = h.issues.filter(i=>i.level==='danger')
        const warnIssues = h.issues.filter(i=>i.level==='warning')
        // 일별 초과 발주 목록
        const dailyOverList = h.dailyOrders.filter(d => h.dailyBudget > 0 && d.daily_total > h.dailyBudget * 1.0)
          .sort((a,b) => b.daily_total - a.daily_total)
        // 초과 업체 목록
        const overVendors = h.vendors.filter(v => v.monthly_budget > 0 && v.used > v.monthly_budget)
        return `
        <div class="bg-white rounded-xl shadow-sm border-l-4 ${dangerIssues.length>0?'border-red-400':'border-amber-400'} p-4">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              ${h.online?`<span class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>`:`<span class="w-2 h-2 bg-gray-300 rounded-full"></span>`}
              <span class="font-bold text-gray-800">${h.hospital.name}</span>
              ${h.online?`<span class="text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded">${h.online.username} · ${h.online.last_page}</span>`:''}
            </div>
            <div class="flex items-center gap-2">
              ${dangerIssues.length>0?`<span class="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold">위험 ${dangerIssues.length}건</span>`:''}
              ${warnIssues.length>0?`<span class="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">경고 ${warnIssues.length}건</span>`:''}
            </div>
          </div>
          
          <!-- 이슈 배지 목록 -->
          <div class="flex flex-wrap gap-1.5 mb-3">
            ${h.issues.map(i=>`
            <span class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg font-medium ${i.level==='danger'?'bg-red-100 text-red-700':'bg-amber-100 text-amber-700'}">
              <i class="fas ${i.level==='danger'?'fa-exclamation-circle':'fa-exclamation-triangle'}"></i>
              ${i.msg}
            </span>`).join('')}
          </div>

          <!-- 일별 발주 초과 상세 테이블 -->
          ${dailyOverList.length > 0 ? `
          <div class="mb-3">
            <div class="text-xs font-semibold text-gray-500 mb-1.5"><i class="fas fa-calendar-day mr-1 text-orange-400"></i>일별 발주 현황 (일목표: ${fmtWon(h.dailyBudget)})</div>
            <div class="overflow-x-auto">
              <table class="w-full text-xs">
                <thead><tr class="bg-gray-50">
                  <th class="text-left px-2 py-1">날짜</th>
                  <th class="text-right px-2 py-1">발주액</th>
                  <th class="text-right px-2 py-1">목표대비</th>
                  <th class="text-left px-2 py-1 w-24">진행</th>
                </tr></thead>
                <tbody>
                  ${dailyOverList.slice(0,7).map(d => {
                    const pct = h.dailyBudget > 0 ? Math.round(d.daily_total/h.dailyBudget*100) : 0
                    const over = pct >= 100
                    return `<tr class="${over?'bg-red-50':'bg-amber-50'}">
                      <td class="px-2 py-1 font-mono">${d.order_date}</td>
                      <td class="text-right px-2 py-1 font-semibold ${over?'text-red-600':'text-amber-700'}">${fmt(d.daily_total)}원</td>
                      <td class="text-right px-2 py-1 font-bold ${over?'text-red-600':'text-amber-600'}">${pct}%</td>
                      <td class="px-2 py-1"><div class="h-1.5 bg-gray-200 rounded-full"><div class="h-full rounded-full ${over?'bg-red-400':'bg-amber-400'}" style="width:${Math.min(pct,100)}%"></div></div></td>
                    </tr>`
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>` : ''}

          <!-- 초과 업체 상세 -->
          ${overVendors.length > 0 ? `
          <div>
            <div class="text-xs font-semibold text-gray-500 mb-1.5"><i class="fas fa-store mr-1 text-red-400"></i>예산 초과 업체</div>
            <div class="flex flex-wrap gap-1.5">
              ${overVendors.map(v => {
                const pct = Math.round(v.used/v.monthly_budget*100)
                const over = v.used - v.monthly_budget
                return `<div class="bg-red-50 border border-red-200 rounded-lg px-2 py-1.5 text-xs">
                  <div class="font-semibold text-red-700">${v.name}</div>
                  <div class="text-red-500">${fmt(v.used)}원 / ${fmt(v.monthly_budget)}원</div>
                  <div class="text-red-600 font-bold">+${fmt(over)}원 (${pct}%)</div>
                </div>`
              }).join('')}
            </div>
          </div>` : ''}
        </div>`
      }).join('')}
    </div>`}
  </div>

  <!-- 발주 비교 탭 -->
  <div id="adminContent-chart" class="hidden">
    <!-- 병원별 비교 차트 -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4">
      <h3 class="font-bold text-gray-700 mb-1"><i class="fas fa-chart-bar text-green-600 mr-2"></i>${App.currentYear}년 ${App.currentMonth}월 병원별 예산 대비 사용현황</h3>
      <p class="text-xs text-gray-400 mb-4">막대: 실제 사용 / 배경: 목표예산</p>
      <canvas id="adminCompareChart" height="80"></canvas>
    </div>
    <!-- 식단가 비교 차트 -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4">
      <h3 class="font-bold text-gray-700 mb-1"><i class="fas fa-utensils text-purple-500 mr-2"></i>병원별 식단가 비교</h3>
      <p class="text-xs text-gray-400 mb-4">전체 식단가 / 직원식 제외 / 소모품 제외</p>
      <canvas id="adminMealPriceChart" height="80"></canvas>
    </div>
    <!-- 요약 테이블 -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 overflow-x-auto">
      <h3 class="font-bold text-gray-700 mb-3"><i class="fas fa-table text-gray-500 mr-2"></i>병원별 전체 현황 요약</h3>
      <table class="data-table w-full text-sm">
        <thead>
          <tr>
            <th class="text-left pl-3">병원</th>
            <th class="text-center">상태</th>
            <th class="text-center">일발주/목표</th>
            <th class="text-center">주발주/목표</th>
            <th class="text-center">월사용/목표</th>
            <th class="text-center">전체식단가</th>
            <th class="text-center">직원제외</th>
            <th class="text-center">소모품제외</th>
            <th class="text-center">잔반</th>
            <th class="text-center">진행률</th>
          </tr>
        </thead>
        <tbody>
          ${hospitals.map(h=>{
            const pct = parseFloat(h.progress)
            const mp = h.mealPriceTotal
            const mpOver = h.targetMealPrice > 0 && mp > h.targetMealPrice
            const todayPct = h.dailyBudget > 0 ? Math.round(h.todayUsed/h.dailyBudget*100) : 0
            const weekPct = h.weekBudget > 0 ? Math.round(h.weekUsed/h.weekBudget*100) : 0
            return `
            <tr class="${pct>=100&&h.totalBudget>0?'bg-red-50':''}">
              <td class="font-semibold pl-3 py-2">${h.hospital.name}</td>
              <td class="text-center py-2">${h.online?`<span class="inline-flex items-center gap-1 text-xs text-green-600"><span class="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>온라인</span>`:'<span class="text-xs text-gray-300">오프라인</span>'}</td>
              <td class="text-center text-xs py-2">${fmtMan(h.todayUsed)}원<br><span class="${todayPct>=100?'text-red-500 font-bold':'text-gray-400'}">${todayPct}%</span></td>
              <td class="text-center text-xs py-2">${fmtMan(h.weekUsed)}원<br><span class="${weekPct>=100?'text-red-500 font-bold':'text-gray-400'}">${weekPct}%</span></td>
              <td class="text-center text-xs py-2">${fmtMan(h.totalUsed)} / ${h.totalBudget>0?fmtMan(h.totalBudget):'-'}원</td>
              <td class="text-center text-xs py-2 ${mpOver?'text-red-600 font-bold':''}">${mp>0?mp.toLocaleString()+'원':'-'}${mpOver?'<br><span class="text-red-400 text-xs">▲초과</span>':''}</td>
              <td class="text-center text-xs py-2 text-purple-600">${h.mealPriceNoStaff>0?h.mealPriceNoStaff.toLocaleString()+'원':'-'}</td>
              <td class="text-center text-xs py-2 text-orange-600">${h.mealPriceNoSupply>0?h.mealPriceNoSupply.toLocaleString()+'원':'-'}</td>
              <td class="text-center text-xs py-2">${h.foodWaste.totalWaste>0?h.foodWaste.totalWaste.toFixed(1)+'kg':'-'}</td>
              <td class="text-center py-2">
                <span class="font-bold ${pct>=100?'text-red-600':pct>=90?'text-amber-500':'text-green-700'}">${pct.toFixed(1)}%</span>
              </td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>`

  // 차트 렌더링
  renderAdminCompareChart(hospitals)
  switchAdminTab('cards')
}

window.switchAdminTab = (tab) => {
  ;['cards','issues','chart'].forEach(t => {
    document.getElementById(`adminContent-${t}`)?.classList.toggle('hidden', t !== tab)
    const btn = document.getElementById(`adminTab-${t}`)
    if (btn) {
      btn.className = t === tab
        ? 'px-4 py-2 text-sm font-medium border-b-2 border-green-600 text-green-700'
        : 'px-4 py-2 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700'
    }
  })
  if (tab === 'chart') {
    setTimeout(() => {
      if (App.charts.adminCompare) App.charts.adminCompare.resize()
      if (App.charts.adminMealPrice) App.charts.adminMealPrice.resize()
    }, 100)
  }
}

function renderAdminCompareChart(hospitals) {
  // 예산 비교 차트
  const ctx = document.getElementById('adminCompareChart')
  if (ctx) {
    if (App.charts.adminCompare) { App.charts.adminCompare.destroy(); App.charts.adminCompare = null }
    const labels = hospitals.map(h => h.hospital.name)
    const used = hospitals.map(h => h.totalUsed)
    const budget = hospitals.map(h => h.totalBudget)
    const colors = hospitals.map(h => {
      const pct = h.totalBudget > 0 ? h.totalUsed/h.totalBudget*100 : 0
      return pct >= 100 ? 'rgba(239,68,68,0.75)' : pct >= 90 ? 'rgba(245,158,11,0.75)' : 'rgba(34,197,94,0.75)'
    })
    App.charts.adminCompare = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '사용금액', data: used, backgroundColor: colors, borderRadius: 4 },
          { label: '목표예산', data: budget, backgroundColor: 'rgba(156,163,175,0.25)', borderRadius: 4, borderColor: 'rgba(156,163,175,0.5)', borderWidth: 1 }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top' },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmt(ctx.raw)}원` } }
        },
        scales: { y: { ticks: { callback: v => fmtMan(v)+'원' } } }
      }
    })
  }

  // 식단가 비교 차트
  const ctx2 = document.getElementById('adminMealPriceChart')
  if (ctx2) {
    if (App.charts.adminMealPrice) { App.charts.adminMealPrice.destroy(); App.charts.adminMealPrice = null }
    const labels = hospitals.map(h => h.hospital.name)
    const mp1 = hospitals.map(h => h.mealPriceTotal)
    const mp2 = hospitals.map(h => h.mealPriceNoStaff)
    const mp3 = hospitals.map(h => h.mealPriceNoSupply)
    const targets = hospitals.map(h => h.targetMealPrice)
    App.charts.adminMealPrice = new Chart(ctx2, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '전체 식단가', data: mp1, backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 4 },
          { label: '직원식 제외', data: mp2, backgroundColor: 'rgba(139,92,246,0.7)', borderRadius: 4 },
          { label: '소모품 제외', data: mp3, backgroundColor: 'rgba(249,115,22,0.7)', borderRadius: 4 },
          { type: 'line', label: '목표 식단가', data: targets, borderColor: '#ef4444', borderDash: [5,5], borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#ef4444', fill: false }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top' },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmt(ctx.raw)}원/식` } }
        },
        scales: { y: { ticks: { callback: v => `${fmt(v)}원` } } }
      }
    })
  }
}

// ══════════════════════════════════════════════════════════════
//  스케줄 관리 페이지
// ══════════════════════════════════════════════════════════════
async function renderSchedule() {
  const content = document.getElementById('pageContent')
  const days = getDaysInMonth(App.currentYear, App.currentMonth)
  
  // 스케줄 데이터 로드 시도
  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`
  
  // 직원 목록과 스케줄 로드
  const [empData, schedData] = await Promise.all([
    api('GET', '/api/schedule/employees').catch(() => null),
    api('GET', `/api/schedule/${App.currentYear}/${App.currentMonth}`).catch(() => null)
  ])

  const employees = empData || []
  const schedMap = {}
  ;(schedData || []).forEach(s => {
    if (!schedMap[s.employee_id]) schedMap[s.employee_id] = {}
    schedMap[s.employee_id][s.work_date] = s.shift_code
  })

  const SHIFTS = ['a', 'b', 'c', 'za', 'zb', 'F', '연', '휴', '반', '-']
  const SHIFT_COLORS = {
    'a': 'bg-blue-100 text-blue-700', 'b': 'bg-green-100 text-green-700',
    'c': 'bg-pink-100 text-pink-700', 'za': 'bg-indigo-100 text-indigo-700',
    'zb': 'bg-emerald-100 text-emerald-700', 'F': 'bg-red-100 text-red-700',
    '연': 'bg-yellow-100 text-yellow-700', '휴': 'bg-orange-100 text-orange-700',
    '반': 'bg-purple-100 text-purple-700', '-': 'bg-gray-50 text-gray-300'
  }

  content.innerHTML = `
  <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
    <div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
      <div>
        <h2 class="font-bold text-gray-800">${App.currentYear}년 ${App.currentMonth}월 근무 스케줄</h2>
        <p class="text-xs text-gray-400 mt-0.5">셀 클릭으로 근무코드 변경 · 자동 저장</p>
      </div>
      <div class="flex gap-2 flex-wrap">
        <button onclick="showAddEmployeeModal()" class="btn btn-success btn-sm">
          <i class="fas fa-user-plus"></i> 직원 추가
        </button>
      </div>
    </div>
    
    <!-- 근무코드 범례 -->
    <div class="px-5 py-2 border-b border-gray-100 bg-gray-50 flex flex-wrap gap-2">
      ${SHIFTS.filter(s=>s!=='-').map(s => `
        <span class="inline-flex items-center px-2 py-1 rounded text-xs font-semibold ${SHIFT_COLORS[s]||'bg-gray-100 text-gray-600'}">${s}</span>
      `).join('')}
      <span class="text-xs text-gray-400 ml-2 self-center">클릭으로 변경</span>
    </div>

    <div class="overflow-x-auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#166534;color:white">
            <th style="padding:8px 12px;text-align:left;min-width:80px;position:sticky;left:0;background:#166534;z-index:10">이름/직책</th>
            ${Array.from({length:days},(_,i)=>{
              const day=i+1, dow=getDayOfWeek(App.currentYear,App.currentMonth,day)
              const isWknd=isWeekend(App.currentYear,App.currentMonth,day)
              return `<th style="padding:6px 4px;text-align:center;min-width:34px;font-weight:${isWknd?'bold':'normal'};color:${dow==='토'?'#93c5fd':dow==='일'?'#fca5a5':'white'}">
                <div>${day}</div><div style="font-size:9px">${dow}</div>
              </th>`
            }).join('')}
            <th style="padding:8px 6px;min-width:50px">근무</th>
            <th style="padding:8px 6px;min-width:40px">연차</th>
          </tr>
        </thead>
        <tbody>
          ${employees.length === 0 ? `
            <tr><td colspan="${days+3}" class="text-center py-12 text-gray-400">
              <i class="fas fa-users text-4xl mb-3 block"></i>
              등록된 직원이 없습니다. 직원을 추가해주세요.
            </td></tr>
          ` : employees.map(emp => {
            const empSchedule = schedMap[emp.id] || {}
            let workDays = 0, annualDays = 0, restDays = 0
            for (let d=1; d<=days; d++) {
              const dateStr = `${App.currentYear}-${String(App.currentMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`
              const shift = empSchedule[dateStr]
              if (shift && shift !== '-' && shift !== '휴' && shift !== '연') workDays++
              if (shift === '연') annualDays++
              if (shift === '휴') restDays++
            }
            return `<tr style="border-bottom:1px solid #f1f5f9" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
              <td style="padding:6px 12px;position:sticky;left:0;background:white;z-index:5">
                <div class="font-semibold text-gray-800">${emp.name}</div>
                <div style="font-size:10px;color:#94a3b8">${emp.position}</div>
              </td>
              ${Array.from({length:days},(_,i)=>{
                const day=i+1
                const dateStr=`${App.currentYear}-${String(App.currentMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`
                const shift=empSchedule[dateStr]||''
                const isWknd=isWeekend(App.currentYear,App.currentMonth,day)
                const cellBg=isWknd?'background:#fffbeb;':'background:white;'
                const colorClass=SHIFT_COLORS[shift]||''
                return `<td style="padding:4px;text-align:center;${cellBg}cursor:pointer" 
                  onclick="cycleShift(${emp.id},'${dateStr}',this)"
                  data-shift="${shift}" data-employee="${emp.id}" data-date="${dateStr}">
                  <span class="inline-flex items-center justify-center w-7 h-7 rounded text-xs font-bold ${colorClass||'bg-gray-50 text-gray-300'}">${shift||'·'}</span>
                </td>`
              }).join('')}
              <td style="padding:6px;text-align:center;background:#f0fdf4" class="font-semibold text-green-700">${workDays}</td>
              <td style="padding:6px;text-align:center;background:#fef9c3" class="font-semibold text-yellow-700">${annualDays}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>

  <!-- 직원 추가 모달 -->
  <div id="empModal" class="hidden modal-overlay">
    <div class="modal-box max-w-md p-6">
      <h3 class="font-bold text-lg mb-4">직원 추가</h3>
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-sm font-medium text-gray-600">이름 *</label>
            <input type="text" id="empName" class="form-input mt-1" placeholder="홍길동">
          </div>
          <div>
            <label class="text-sm font-medium text-gray-600">직책 *</label>
            <input type="text" id="empPosition" class="form-input mt-1" placeholder="조리장">
          </div>
        </div>
        <div>
          <label class="text-sm font-medium text-gray-600">소속</label>
          <select id="empSection" class="form-input mt-1">
            <option value="cook">조리팀</option>
            <option value="manager">매니저</option>
            <option value="hall">홀/전포</option>
            <option value="part">파트타임</option>
          </select>
        </div>
      </div>
      <div class="flex gap-2 mt-5">
        <button onclick="addEmployee()" class="btn btn-primary flex-1">추가</button>
        <button onclick="document.getElementById('empModal').classList.add('hidden')" class="btn btn-secondary flex-1">취소</button>
      </div>
    </div>
  </div>`

  // 근무 코드 순환 클릭 핸들러
  window.cycleShift = async (empId, date, cell) => {
    const currentShift = cell.dataset.shift || ''
    const idx = SHIFTS.indexOf(currentShift)
    const nextShift = SHIFTS[(idx + 1) % SHIFTS.length]
    
    cell.dataset.shift = nextShift
    const span = cell.querySelector('span')
    if (span) {
      span.className = `inline-flex items-center justify-center w-7 h-7 rounded text-xs font-bold ${SHIFT_COLORS[nextShift]||'bg-gray-50 text-gray-300'}`
      span.textContent = nextShift === '-' ? '·' : nextShift
    }

    // 저장
    if (nextShift === '-') {
      await api('DELETE', `/api/schedule/${empId}/${date}`).catch(() => null)
    } else {
      await api('POST', '/api/schedule/save', { employeeId: empId, workDate: date, shiftCode: nextShift }).catch(() => null)
    }
  }
}

window.showAddEmployeeModal = () => {
  document.getElementById('empModal').classList.remove('hidden')
}

window.addEmployee = async () => {
  const name = document.getElementById('empName').value.trim()
  const position = document.getElementById('empPosition').value.trim()
  const section = document.getElementById('empSection').value
  if (!name || !position) { showToast('이름과 직책을 입력하세요', 'error'); return }
  const res = await api('POST', '/api/schedule/employees', { name, position, section })
  if (res?.success) {
    document.getElementById('empModal').classList.add('hidden')
    showToast('직원이 추가되었습니다', 'success')
    renderSchedule()
  }
}

// ══════════════════════════════════════════════════════════════
//  병원 관리 페이지 (관리자)
// ══════════════════════════════════════════════════════════════
async function renderHospitalManage() {
  const content = document.getElementById('pageContent')
  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`

  const [hospitals, closingReqs] = await Promise.all([
    api('GET', '/api/admin/hospitals'),
    api('GET', '/api/admin/closing-requests')
  ])

  const pendingClosings = closingReqs || []

  // 병원 관리 페이지 진입 시 항상 알림 읽음 처리 (배지 초기화)
  await api('POST', '/api/admin/notifications/read-all')
  loadNotificationBadge()

  content.innerHTML = `
  <!-- 마감 요청 알림 -->
  ${pendingClosings.length > 0 ? `
  <div class="mb-5 bg-amber-50 border border-amber-200 rounded-xl p-4">
    <div class="flex items-center gap-2 mb-3">
      <i class="fas fa-bell text-amber-500 animate-pulse"></i>
      <span class="font-bold text-amber-800">마감 요청 대기 중 (${pendingClosings.length}건)</span>
    </div>
    <div class="space-y-2">
      ${pendingClosings.map(r => `
        <div class="flex items-center justify-between bg-white rounded-lg p-3 border border-amber-100">
          <div>
            <span class="font-semibold text-gray-800">${r.hospital_name}</span>
            <span class="text-sm text-gray-500 ml-2">${r.year}년 ${r.month}월 마감 요청</span>
            <span class="text-xs text-gray-400 ml-2">${r.requested_at?.split('T')[0]}</span>
          </div>
          <button onclick="approveClosing(${r.hospital_id},${r.year},${r.month})"
            class="btn btn-primary btn-sm">
            <i class="fas fa-check mr-1"></i>승인 & 다음달 전환
          </button>
        </div>
      `).join('')}
    </div>
  </div>` : ''}

  <!-- 병원 목록 -->
  <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
    <div class="p-5 border-b border-gray-100 flex items-center justify-between">
      <h2 class="font-bold text-gray-800"><i class="fas fa-hospital text-green-600 mr-2"></i>병원 목록</h2>
      <span class="text-sm text-gray-400">총 ${(hospitals||[]).length}개 병원</span>
    </div>
    <div class="divide-y divide-gray-50">
      ${(hospitals||[]).map(h => `
        <div class="p-4 hover:bg-gray-50 transition cursor-pointer" onclick="openHospitalDetail(${h.id})">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
                <i class="fas fa-hospital text-green-600 text-sm"></i>
              </div>
              <div>
                <div class="font-semibold text-gray-800">${h.name}</div>
                <div class="text-xs text-gray-400">
                  ${getHospitalTypeLabel(h.hospital_type)} · 
                  ${h.licensed_beds||'-'}병상 · 
                  ${h.dietitian_name||'영양사 미등록'}
                  ${h.main_specialty ? ` · <span class="text-green-600 font-medium">${h.main_specialty}</span>` : ''}
                </div>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <span class="badge ${h.closing_status==='requested'?'badge-yellow':h.closing_status==='closed'?'badge-green':'badge-gray'}">
                ${h.closing_status==='requested'?'마감 요청중':h.closing_status==='closed'?'마감완료':'운영중'}
              </span>
              <span class="text-sm text-green-700 font-semibold">${h.current_year||2026}년 ${h.current_month||3}월</span>
              <i class="fas fa-chevron-right text-gray-300 text-xs"></i>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  </div>`
}

function getHospitalTypeLabel(type) {
  const map = {
    general:'종합병원', oriental:'한방병원', nursing:'요양병원',
    rehab:'재활병원', clinic:'의원', care_facility:'요양원'
  }
  return map[type] || '병원'
}

async function approveClosing(hospitalId, year, month) {
  if (!confirm(`${year}년 ${month}월 마감을 승인하고 다음달로 전환할까요?`)) return
  const res = await api('POST', `/api/admin/closing-approve/${hospitalId}`, { year, month })
  if (res?.success) {
    showToast(`마감 승인 완료! ${res.nextYear}년 ${res.nextMonth}월로 전환되었습니다`, 'success')
    renderHospitalManage()
  }
}

async function openHospitalDetail(hospitalId) {
  const [hosp, budget, vendorList, accounts] = await Promise.all([
    api('GET', `/api/admin/hospitals/${hospitalId}`),
    api('GET', `/api/admin/hospitals/${hospitalId}/budget/${App.currentYear}/${App.currentMonth}`),
    api('GET', `/api/admin/hospitals/${hospitalId}/vendors`),
    api('GET', `/api/admin/hospitals/${hospitalId}/accounts`)
  ])
  if (!hosp) return

  const s = budget?.settings || {}
  const vendors = vendorList || []

  // 현재 관리 중인 hospitalId를 전역에 저장
  window._adminHospitalId = hospitalId
  window._adminHospVendors = vendors  // 예산탭 갱신에 사용

  const modal = document.createElement('div')
  modal.className = 'modal-overlay'
  modal.id = 'hospDetailModal'
  modal.innerHTML = `
  <div class="modal-box" style="max-width:820px">
    <div class="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
      <h2 class="font-bold text-xl text-gray-800"><i class="fas fa-hospital text-green-600 mr-2"></i>${hosp.name}</h2>
      <button onclick="document.getElementById('hospDetailModal').remove()" class="text-gray-400 hover:text-gray-600 text-xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100">✕</button>
    </div>
    <div class="p-6 space-y-6">

      <!-- 탭 -->
      <div class="flex gap-2 border-b border-gray-100 pb-3">
        <button class="tab-btn active" id="tab-info" onclick="switchHospTab('info')">
          <i class="fas fa-info-circle mr-1"></i>기본정보
        </button>
        <button class="tab-btn" id="tab-budget" onclick="switchHospTab('budget')">
          <i class="fas fa-won-sign mr-1"></i>예산설정
        </button>
        <button class="tab-btn" id="tab-vendors" onclick="switchHospTab('vendors')">
          <i class="fas fa-store mr-1"></i>업체관리
        </button>
        <button class="tab-btn" id="tab-accounts" onclick="switchHospTab('accounts')">
          <i class="fas fa-user-circle mr-1"></i>계정관리
        </button>
      </div>

      <!-- 기본정보 탭 -->
      <div id="hospTab-info">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">병원명</label>
            <input id="hi-name" class="form-input" value="${hosp.name||''}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">병원 유형</label>
            <select id="hi-type" class="form-input">
              ${[['general','종합병원'],['oriental','한방병원'],['nursing','요양병원'],['rehab','재활병원'],['clinic','의원'],['care_facility','요양원']]
                .map(([v,l]) => `<option value="${v}" ${hosp.hospital_type===v?'selected':''}>${l}</option>`).join('')}
            </select>
          </div>
          <div class="col-span-2">
            <label class="block text-xs font-semibold text-gray-500 mb-1">주소</label>
            <input id="hi-address" class="form-input" value="${hosp.address||''}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">허가 병상수</label>
            <input id="hi-beds" type="number" class="form-input" value="${hosp.licensed_beds||0}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">평균 입원환자수</label>
            <input id="hi-inpatients" type="number" class="form-input" value="${hosp.avg_inpatients||0}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">급식 대상 직원수</label>
            <input id="hi-staff" type="number" class="form-input" value="${hosp.staff_count||0}">
          </div>
          <div class="col-span-2">
            <label class="block text-xs font-semibold text-gray-500 mb-1">주 종목 <span class="text-gray-400 font-normal">(암, 교통사고, 척추, 관절 등 직접 입력)</span></label>
            <input id="hi-specialty" class="form-input" placeholder="예: 암, 교통사고, 척추 재활" value="${hosp.main_specialty||''}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">급식 운영방식</label>
            <select id="hi-optype" class="form-input">
              <option value="direct" ${hosp.operation_type==='direct'?'selected':''}>직영</option>
              <option value="consignment" ${hosp.operation_type==='consignment'?'selected':''}>위탁</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">위탁업체명</label>
            <input id="hi-consign" class="form-input" value="${hosp.consignment_company||''}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">1일 급식횟수</label>
            <select id="hi-meals" class="form-input">
              <option value="2" ${hosp.meals_per_day==2?'selected':''}>2식</option>
              <option value="3" ${hosp.meals_per_day==3?'selected':''}>3식</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">납품 방식</label>
            <select id="hi-supply" class="form-input">
              <option value="direct" ${hosp.supply_method==='direct'?'selected':''}>직납</option>
              <option value="market" ${hosp.supply_method==='market'?'selected':''}>시장</option>
              <option value="mixed" ${hosp.supply_method==='mixed'?'selected':''}>혼합</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">현재 식단가 (원/식)</label>
            <input id="hi-curprice" type="number" class="form-input" value="${hosp.current_meal_price||0}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">목표 식단가 (원/식)</label>
            <input id="hi-tgtprice" type="number" class="form-input" value="${hosp.target_meal_price||0}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">연간 총 급식예산 (원)</label>
            <input id="hi-annual" type="number" class="form-input" value="${hosp.annual_budget||0}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">영양사 이름</label>
            <input id="hi-dietname" class="form-input" value="${hosp.dietitian_name||''}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">영양사 연락처</label>
            <input id="hi-dietphone" class="form-input" value="${hosp.dietitian_phone||''}">
          </div>
          <div class="col-span-2">
            <label class="block text-xs font-semibold text-gray-500 mb-1">관리자 메모</label>
            <textarea id="hi-memo" class="form-input" rows="3">${hosp.admin_memo||''}</textarea>
          </div>
        </div>
        <div class="mt-4 flex justify-end">
          <button onclick="saveHospitalInfo(${hospitalId})" class="btn btn-primary">
            <i class="fas fa-save mr-1"></i>기본정보 저장
          </button>
        </div>
      </div>

      <!-- 예산설정 탭 -->
      <div id="hospTab-budget" class="hidden">
        <div class="text-sm font-semibold text-gray-600 mb-3">${App.currentYear}년 ${App.currentMonth}월 예산 설정</div>
        <div class="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">월 총 목표금액 (원)</label>
            <input id="hb-total" type="number" class="form-input" value="${s.total_budget||0}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">이벤트 예산 (원)</label>
            <input id="hb-event" type="number" class="form-input" value="${s.event_budget||0}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">소모품 목표금액 (원)</label>
            <input id="hb-supply" type="number" class="form-input" value="${s.supply_budget||0}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">법인카드 목표금액 (원)</label>
            <input id="hb-card" type="number" class="form-input" value="${s.card_budget||0}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">목표 식단가 (원/식)</label>
            <input id="hb-mealprice" type="number" class="form-input" value="${s.meal_price||0}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">잔반 목표금액 (원)</label>
            <input id="hb-waste" type="number" class="form-input" value="${s.food_waste_budget||0}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">해당월 영업일수 (일)</label>
            <input id="hb-workdays" type="number" class="form-input" value="${s.working_days || getDefaultWorkingDays(App.currentYear, App.currentMonth)}">
            <p class="text-xs text-gray-400 mt-1">* 자동계산: ${getDefaultWorkingDays(App.currentYear, App.currentMonth)}일 (해당월 전체일수)</p>
          </div>
        </div>

        <!-- 업체별 목표금액 -->
        <div class="border-t border-gray-100 pt-4">
          <h3 class="font-semibold text-gray-700 mb-3"><i class="fas fa-store text-green-600 mr-1"></i>업체별 월 목표금액</h3>
          <div id="hospBudgetVendors">
            ${renderBudgetVendorRows(vendors)}
          </div>
        </div>
        <div class="mt-4 flex justify-end">
          <button onclick="saveHospitalBudget(${hospitalId})" class="btn btn-primary">
            <i class="fas fa-save mr-1"></i>예산설정 저장
          </button>
        </div>
      </div>

      <!-- 업체관리 탭 -->
      <div id="hospTab-vendors" class="hidden">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-semibold text-gray-700"><i class="fas fa-store text-green-600 mr-1"></i>등록 업체 목록</h3>
          <button onclick="showAdminAddVendorModal()" class="btn btn-success btn-sm">
            <i class="fas fa-plus mr-1"></i>업체 추가
          </button>
        </div>
        <div id="adminVendorList">
          ${renderAdminVendorRows(vendors)}
        </div>
      </div>

      <!-- 계정관리 탭 -->
      <div id="hospTab-accounts" class="hidden">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-semibold text-gray-700"><i class="fas fa-user-circle text-green-600 mr-1"></i>병원 계정 목록</h3>
          <button onclick="showAdminAddAccountModal()" class="btn btn-success btn-sm">
            <i class="fas fa-plus mr-1"></i>계정 추가
          </button>
        </div>
        <div id="adminAccountList">
          ${renderAdminAccountRows(accounts || [])}
        </div>
        <div class="mt-4 p-3 bg-blue-50 rounded-xl text-xs text-blue-600">
          <i class="fas fa-info-circle mr-1"></i>
          병원 계정은 발주 입력, 식수 관리, 마감 요청 등에 사용됩니다. 관리자 계정은 이 화면에서 관리하지 않습니다.
        </div>
      </div>

    </div>
  </div>

  <!-- 업체 추가/수정 모달 (관리자용) -->
  <div id="adminVendorModal" class="hidden fixed inset-0 bg-black/50 flex items-center justify-center z-[200]">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 mx-4">
      <h3 class="font-bold text-lg mb-4" id="adminVendorModalTitle">업체 추가</h3>
      <input type="hidden" id="adminVendorId">
      <div class="space-y-3">
        <div>
          <label class="text-sm font-medium text-gray-600">업체명 *</label>
          <input type="text" id="adminVendorName" class="form-input mt-1" placeholder="예: 삼성 웰스토리">
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-sm font-medium text-gray-600">카테고리</label>
            <select id="adminVendorCategory" class="form-input mt-1">
              <option value="major">대기업급식</option>
              <option value="meat">육류</option>
              <option value="seafood">해산물</option>
              <option value="fruit">청과</option>
              <option value="organic">유기농/한살림</option>
              <option value="market">시장/유통</option>
              <option value="delivery">인터넷배송</option>
              <option value="card">법인카드</option>
              <option value="event">이벤트</option>
              <option value="general">기타</option>
            </select>
          </div>
          <div>
            <label class="text-sm font-medium text-gray-600">세금 구분</label>
            <select id="adminVendorTaxType" class="form-input mt-1">
              <option value="mixed">과세+면세</option>
              <option value="taxable">과세만</option>
              <option value="exempt">면세만</option>
            </select>
          </div>
        </div>
        <div>
          <label class="text-sm font-medium text-gray-600">월 목표금액 (원)</label>
          <input type="number" id="adminVendorBudget" class="form-input mt-1" placeholder="0 (없으면 0)">
        </div>
      </div>
      <div class="flex gap-2 mt-5">
        <button onclick="saveAdminVendor()" class="btn btn-primary flex-1">저장</button>
        <button onclick="document.getElementById('adminVendorModal').classList.add('hidden')" class="btn btn-secondary flex-1">취소</button>
      </div>
    </div>
  </div>

  <!-- 계정 추가/수정 모달 (관리자용) -->
  <div id="adminAccountModal" class="hidden fixed inset-0 bg-black/50 flex items-center justify-center z-[200]">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 mx-4">
      <h3 class="font-bold text-lg mb-4" id="adminAccountModalTitle">계정 추가</h3>
      <input type="hidden" id="adminAccountId">
      <div class="space-y-3">
        <div>
          <label class="text-sm font-medium text-gray-600">아이디 *</label>
          <input type="text" id="adminAccountUsername" class="form-input mt-1" placeholder="영문+숫자 조합 권장">
        </div>
        <div>
          <label class="text-sm font-medium text-gray-600" id="adminAccountPwLabel">비밀번호 *</label>
          <input type="password" id="adminAccountPassword" class="form-input mt-1" placeholder="비밀번호 입력">
          <p class="text-xs text-gray-400 mt-1" id="adminAccountPwHint"></p>
        </div>
      </div>
      <div class="flex gap-2 mt-5">
        <button onclick="saveAdminAccount()" class="btn btn-primary flex-1">저장</button>
        <button onclick="document.getElementById('adminAccountModal').classList.add('hidden')" class="btn btn-secondary flex-1">취소</button>
      </div>
    </div>
  </div>`

  document.body.appendChild(modal)
}

// 예산설정 탭 업체별 목표금액 행 렌더
function renderBudgetVendorRows(vendors) {
  if (!vendors || vendors.length === 0) {
    return `<div class="text-center py-8 text-gray-400">
      <i class="fas fa-store text-3xl mb-2 block text-gray-300"></i>
      <p class="text-sm">등록된 업체가 없습니다</p>
      <p class="text-xs mt-1">업체관리 탭에서 업체를 먼저 추가하세요</p>
    </div>`
  }
  return `<div class="space-y-2">
    ${vendors.map(v => `
      <div class="flex items-center gap-3 py-2 border-b border-gray-50">
        <span class="w-2.5 h-2.5 rounded-full flex-shrink-0 ${getCategoryColor(v.category)}"></span>
        <div class="flex-1 min-w-0">
          <span class="font-medium text-sm">${v.name}</span>
          <span class="text-xs text-gray-400 ml-2">${getCategoryLabel(v.category)}</span>
        </div>
        <div class="flex items-center gap-2">
          <input id="hvb-${v.id}" type="number" class="form-input w-40 text-right text-sm py-1.5"
            value="${v.monthly_budget||0}" placeholder="0">
          <span class="text-xs text-gray-400 whitespace-nowrap">원</span>
        </div>
      </div>
    `).join('')}
  </div>`
}

// 계정 목록 행 렌더
function renderAdminAccountRows(accounts) {
  if (!accounts || accounts.length === 0) {
    return `<div class="text-center py-10 text-gray-400">
      <i class="fas fa-user-circle text-4xl mb-3 block text-gray-300"></i>
      <p class="text-sm">등록된 계정이 없습니다</p>
      <p class="text-xs mt-1">계정 추가 버튼을 눌러 계정을 등록하세요</p>
    </div>`
  }
  return `<div class="divide-y divide-gray-50">
    ${accounts.map(a => `
      <div class="flex items-center gap-3 py-3 hover:bg-gray-50 px-2 rounded-lg">
        <div class="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
          <i class="fas fa-user text-green-600 text-sm"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-medium text-sm">${a.username}</div>
          <div class="text-xs text-gray-400">생성일: ${a.created_at?.split('T')[0] || '-'}</div>
        </div>
        <div class="flex gap-1">
          <button onclick="editAdminAccount(${a.id}, '${a.username}')"
            class="btn btn-secondary btn-sm px-2" title="비밀번호 변경">
            <i class="fas fa-key text-xs"></i>
          </button>
          <button onclick="deleteAdminAccount(${a.id}, '${a.username}')"
            class="btn btn-danger btn-sm px-2" title="계정 삭제">
            <i class="fas fa-trash text-xs"></i>
          </button>
        </div>
      </div>
    `).join('')}
  </div>`
}

function renderAdminVendorRows(vendors) {
  if (!vendors || vendors.length === 0) {
    return `<div class="text-center py-10 text-gray-400">
      <i class="fas fa-store text-4xl mb-3 block text-gray-300"></i>
      <p class="text-sm">등록된 업체가 없습니다</p>
      <p class="text-xs mt-1 text-gray-300">업체 추가 버튼을 눌러 업체를 등록하세요</p>
    </div>`
  }
  return `<div class="divide-y divide-gray-50">
    ${vendors.map((v, idx) => `
      <div class="flex items-center gap-3 py-3 hover:bg-gray-50 px-2 rounded-lg" id="avendor-row-${v.id}">
        <span class="text-gray-400 text-xs w-5 text-center">${idx+1}</span>
        <span class="w-2.5 h-2.5 rounded-full flex-shrink-0 ${getCategoryColor(v.category)}"></span>
        <div class="flex-1 min-w-0">
          <div class="font-medium text-sm">${v.name}</div>
          <div class="text-xs text-gray-400">${getCategoryLabel(v.category)} · ${getTaxTypeLabel(v.tax_type)}</div>
        </div>
        <div class="text-sm text-gray-600 font-medium">${v.monthly_budget>0?fmtMan(v.monthly_budget)+'원':'목표없음'}</div>
        <div class="flex gap-1">
          <button onclick="editAdminVendor(${v.id})"
            data-name="${v.name.replace(/"/g,'&quot;')}" data-cat="${v.category}" data-tax="${v.tax_type}" data-budget="${v.monthly_budget}"
            class="btn btn-secondary btn-sm px-2"><i class="fas fa-edit text-xs"></i></button>
          <button onclick="deleteAdminVendor(${v.id})"
            class="btn btn-danger btn-sm px-2"><i class="fas fa-trash text-xs"></i></button>
        </div>
      </div>
    `).join('')}
  </div>`
}

function showAdminAddVendorModal() {
  document.getElementById('adminVendorModalTitle').textContent = '업체 추가'
  document.getElementById('adminVendorId').value = ''
  document.getElementById('adminVendorName').value = ''
  document.getElementById('adminVendorCategory').value = 'general'
  document.getElementById('adminVendorTaxType').value = 'mixed'
  document.getElementById('adminVendorBudget').value = ''
  document.getElementById('adminVendorModal').classList.remove('hidden')
}

function editAdminVendor(id) {
  // 클릭된 버튼의 data 속성에서 값 읽기
  const btn = document.querySelector(`[onclick="editAdminVendor(${id})"]`)
  const name = btn?.dataset.name || ''
  const category = btn?.dataset.cat || 'general'
  const taxType = btn?.dataset.tax || 'mixed'
  const budget = parseInt(btn?.dataset.budget || 0)
  document.getElementById('adminVendorModalTitle').textContent = '업체 수정'
  document.getElementById('adminVendorId').value = id
  document.getElementById('adminVendorName').value = name
  document.getElementById('adminVendorCategory').value = category
  document.getElementById('adminVendorTaxType').value = taxType
  document.getElementById('adminVendorBudget').value = budget
  document.getElementById('adminVendorModal').classList.remove('hidden')
}

async function saveAdminVendor() {
  const hospitalId = window._adminHospitalId
  if (!hospitalId) return
  const vid = document.getElementById('adminVendorId').value
  const data = {
    name: document.getElementById('adminVendorName').value.trim(),
    category: document.getElementById('adminVendorCategory').value,
    taxType: document.getElementById('adminVendorTaxType').value,
    monthlyBudget: parseInt(document.getElementById('adminVendorBudget').value||0)||0
  }
  if (!data.name) { showToast('업체명을 입력하세요', 'error'); return }
  const res = vid
    ? await api('PUT', `/api/admin/hospitals/${hospitalId}/vendors/${vid}`, data)
    : await api('POST', `/api/admin/hospitals/${hospitalId}/vendors`, data)
  if (res?.success) {
    document.getElementById('adminVendorModal').classList.add('hidden')
    showToast(vid ? '업체가 수정되었습니다' : '업체가 추가되었습니다', 'success')
    // 업체 목록 + 예산탭 동시 갱신
    const updated = await api('GET', `/api/admin/hospitals/${hospitalId}/vendors`)
    window._adminHospVendors = updated || []
    document.getElementById('adminVendorList').innerHTML = renderAdminVendorRows(updated || [])
    document.getElementById('hospBudgetVendors').innerHTML = renderBudgetVendorRows(updated || [])
  } else {
    showToast('저장 실패', 'error')
  }
}

async function deleteAdminVendor(vid) {
  const hospitalId = window._adminHospitalId
  if (!hospitalId) return
  if (!confirm('업체를 삭제하시겠습니까?\n(해당 업체의 발주 데이터는 유지됩니다)')) return
  await api('DELETE', `/api/admin/hospitals/${hospitalId}/vendors/${vid}`)
  showToast('업체가 삭제되었습니다', 'success')
  // 업체 목록 + 예산탭 동시 갱신
  const updated = await api('GET', `/api/admin/hospitals/${hospitalId}/vendors`)
  window._adminHospVendors = updated || []
  document.getElementById('adminVendorList').innerHTML = renderAdminVendorRows(updated || [])
  document.getElementById('hospBudgetVendors').innerHTML = renderBudgetVendorRows(updated || [])
}

// ── 계정 관리 함수 ────────────────────────────────────────────
function showAdminAddAccountModal() {
  document.getElementById('adminAccountModalTitle').textContent = '계정 추가'
  document.getElementById('adminAccountId').value = ''
  document.getElementById('adminAccountUsername').value = ''
  document.getElementById('adminAccountUsername').disabled = false
  document.getElementById('adminAccountPassword').value = ''
  document.getElementById('adminAccountPwLabel').textContent = '비밀번호 *'
  document.getElementById('adminAccountPwHint').textContent = ''
  document.getElementById('adminAccountModal').classList.remove('hidden')
}

function editAdminAccount(id, username) {
  document.getElementById('adminAccountModalTitle').textContent = '비밀번호 변경'
  document.getElementById('adminAccountId').value = id
  document.getElementById('adminAccountUsername').value = username
  document.getElementById('adminAccountUsername').disabled = true
  document.getElementById('adminAccountPassword').value = ''
  document.getElementById('adminAccountPwLabel').textContent = '새 비밀번호 *'
  document.getElementById('adminAccountPwHint').textContent = '새 비밀번호를 입력하면 변경됩니다'
  document.getElementById('adminAccountModal').classList.remove('hidden')
}

async function saveAdminAccount() {
  const hospitalId = window._adminHospitalId
  if (!hospitalId) return
  const aid = document.getElementById('adminAccountId').value
  const username = document.getElementById('adminAccountUsername').value.trim()
  const password = document.getElementById('adminAccountPassword').value

  if (!username) { showToast('아이디를 입력하세요', 'error'); return }
  if (!password) { showToast('비밀번호를 입력하세요', 'error'); return }
  if (password.length < 4) { showToast('비밀번호는 4자 이상 입력하세요', 'error'); return }

  const res = aid
    ? await api('PUT', `/api/admin/hospitals/${hospitalId}/accounts/${aid}`, { password })
    : await api('POST', `/api/admin/hospitals/${hospitalId}/accounts`, { username, password })

  if (res?.success) {
    document.getElementById('adminAccountModal').classList.add('hidden')
    showToast(aid ? '비밀번호가 변경되었습니다' : '계정이 생성되었습니다', 'success')
    const updated = await api('GET', `/api/admin/hospitals/${hospitalId}/accounts`)
    document.getElementById('adminAccountList').innerHTML = renderAdminAccountRows(updated || [])
  } else if (res?.error) {
    showToast(res.error, 'error')
  } else {
    showToast('저장 실패', 'error')
  }
}

async function deleteAdminAccount(aid, username) {
  const hospitalId = window._adminHospitalId
  if (!hospitalId) return
  if (!confirm(`"${username}" 계정을 삭제하시겠습니까?`)) return
  const res = await api('DELETE', `/api/admin/hospitals/${hospitalId}/accounts/${aid}`)
  if (res?.success) {
    showToast('계정이 삭제되었습니다', 'success')
    const updated = await api('GET', `/api/admin/hospitals/${hospitalId}/accounts`)
    document.getElementById('adminAccountList').innerHTML = renderAdminAccountRows(updated || [])
  } else {
    showToast('삭제 실패', 'error')
  }
}

function getDefaultWorkingDays(year, month) {
  return new Date(year, month, 0).getDate()
}

function switchHospTab(tab) {
  ['info','budget','vendors','accounts'].forEach(t => {
    document.getElementById(`hospTab-${t}`)?.classList.toggle('hidden', t !== tab)
    document.getElementById(`tab-${t}`)?.classList.toggle('active', t === tab)
  })
}

async function saveHospitalInfo(hospitalId) {
  const body = {
    name: document.getElementById('hi-name').value,
    address: document.getElementById('hi-address').value,
    hospital_type: document.getElementById('hi-type').value,
    licensed_beds: parseInt(document.getElementById('hi-beds').value)||0,
    avg_inpatients: parseInt(document.getElementById('hi-inpatients').value)||0,
    staff_count: parseInt(document.getElementById('hi-staff').value)||0,
    main_specialty: document.getElementById('hi-specialty').value,
    operation_type: document.getElementById('hi-optype').value,
    consignment_company: document.getElementById('hi-consign').value,
    meals_per_day: parseInt(document.getElementById('hi-meals').value)||3,
    current_meal_price: parseInt(document.getElementById('hi-curprice').value)||0,
    target_meal_price: parseInt(document.getElementById('hi-tgtprice').value)||0,
    supply_method: document.getElementById('hi-supply').value,
    annual_budget: parseInt(document.getElementById('hi-annual').value)||0,
    dietitian_name: document.getElementById('hi-dietname').value,
    dietitian_phone: document.getElementById('hi-dietphone').value,
    admin_memo: document.getElementById('hi-memo').value
  }
  const res = await api('PUT', `/api/admin/hospitals/${hospitalId}/info`, body)
  if (res?.success) showToast('기본정보가 저장되었습니다', 'success')
  else showToast('저장 실패', 'error')
}

async function saveHospitalBudget(hospitalId) {
  // 업체별 목표금액 수집 (hvb-{vendorId} 형식의 입력 필드)
  const vendorBudgets = []
  document.querySelectorAll('[id^="hvb-"]').forEach(el => {
    const vid = el.id.replace('hvb-', '')
    vendorBudgets.push({ vendorId: parseInt(vid), budget: parseInt(el.value||0)||0 })
  })

  const body = {
    totalBudget: parseInt(document.getElementById('hb-total').value)||0,
    eventBudget: parseInt(document.getElementById('hb-event').value)||0,
    mealPrice: parseInt(document.getElementById('hb-mealprice').value)||0,
    foodWasteBudget: parseInt(document.getElementById('hb-waste').value)||0,
    workingDays: parseInt(document.getElementById('hb-workdays').value)||0,
    supplyBudget: parseInt(document.getElementById('hb-supply').value)||0,
    cardBudget: parseInt(document.getElementById('hb-card').value)||0,
    vendorBudgets
  }
  const res = await api('POST', `/api/admin/hospitals/${hospitalId}/budget/${App.currentYear}/${App.currentMonth}`, body)
  if (res?.success) showToast('예산설정이 저장되었습니다', 'success')
  else showToast('저장 실패', 'error')
}

// ══════════════════════════════════════════════════════════════
//  공휴일 관리 페이지 (관리자)
// ══════════════════════════════════════════════════════════════
async function renderHolidayManage() {
  const content = document.getElementById('pageContent')
  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`

  const holidays = await api('GET', `/api/admin/holidays/${App.currentYear}`)

  content.innerHTML = `
  <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
    <div class="flex items-center justify-between mb-4">
      <h2 class="font-bold text-gray-800"><i class="fas fa-calendar-times text-green-600 mr-2"></i>${App.currentYear}년 공휴일 관리</h2>
      <button onclick="showAddHolidayForm()" class="btn btn-primary btn-sm">
        <i class="fas fa-plus mr-1"></i>공휴일 추가
      </button>
    </div>
    <div id="addHolidayForm" class="hidden mb-4 p-4 bg-green-50 rounded-xl border border-green-200">
      <div class="flex gap-3 items-end">
        <div>
          <label class="block text-xs font-semibold text-gray-600 mb-1">날짜</label>
          <input id="newHolidayDate" type="date" class="form-input" style="width:160px">
        </div>
        <div class="flex-1">
          <label class="block text-xs font-semibold text-gray-600 mb-1">공휴일명</label>
          <input id="newHolidayName" class="form-input" placeholder="예) 창립기념일">
        </div>
        <button onclick="addHoliday()" class="btn btn-success btn-sm">추가</button>
        <button onclick="document.getElementById('addHolidayForm').classList.add('hidden')" class="btn btn-secondary btn-sm">취소</button>
      </div>
    </div>
    <div class="overflow-hidden rounded-xl border border-gray-100">
      <table class="data-table">
        <thead><tr><th>날짜</th><th>공휴일명</th><th>구분</th><th>관리</th></tr></thead>
        <tbody>
          ${(holidays||[]).map(h => `
            <tr>
              <td class="font-mono text-sm">${h.holiday_date}</td>
              <td class="font-semibold">${h.name}</td>
              <td><span class="badge ${h.is_auto?'badge-blue':'badge-purple'}">${h.is_auto?'자동':'수동'}</span></td>
              <td>
                <button onclick="deleteHoliday('${h.holiday_date}')" class="btn btn-danger btn-sm">
                  <i class="fas fa-trash"></i>
                </button>
              </td>
            </tr>
          `).join('')}
          ${(holidays||[]).length===0?'<tr><td colspan="4" class="text-center text-gray-400 py-8">등록된 공휴일이 없습니다</td></tr>':''}
        </tbody>
      </table>
    </div>
  </div>`
}

function showAddHolidayForm() {
  document.getElementById('addHolidayForm').classList.remove('hidden')
  const today = new Date().toISOString().split('T')[0]
  document.getElementById('newHolidayDate').value = today
}

async function addHoliday() {
  const date = document.getElementById('newHolidayDate').value
  const name = document.getElementById('newHolidayName').value.trim()
  if (!date || !name) { showToast('날짜와 공휴일명을 입력하세요', 'error'); return }
  const res = await api('POST', '/api/admin/holidays', { date, name })
  if (res?.success) { showToast('공휴일이 추가되었습니다', 'success'); renderHolidayManage() }
}

async function deleteHoliday(date) {
  if (!confirm(`${date} 공휴일을 삭제할까요?`)) return
  const res = await api('DELETE', `/api/admin/holidays/${date}`)
  if (res?.success) { showToast('삭제되었습니다', 'success'); renderHolidayManage() }
}

// ══════════════════════════════════════════════════════════════
//  보고서 출력 페이지 (관리자 전용)
// ══════════════════════════════════════════════════════════════
async function renderReport(selectedHospitalId = null) {
  const content = document.getElementById('pageContent')

  // 관리자만 접근 가능
  if (App.role !== 'admin') {
    content.innerHTML = `
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
      <i class="fas fa-lock text-4xl text-gray-300 mb-4"></i>
      <h3 class="text-lg font-semibold text-gray-500 mb-2">접근 제한</h3>
      <p class="text-sm text-gray-400">보고서 출력은 관리자만 사용할 수 있습니다</p>
    </div>`
    return
  }

  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`

  let hospitals = []
  let hospitalName = App.hospitalName
  let targetHospitalId = null

  if (App.role === 'admin') {
    hospitals = await api('GET', '/api/admin/hospitals') || []
    if (!selectedHospitalId && hospitals.length > 0) selectedHospitalId = hospitals[0].id
    targetHospitalId = selectedHospitalId
    const h = hospitals.find(x => x.id == selectedHospitalId)
    hospitalName = h?.name || ''
  }

  const reportYear = App.currentYear
  const reportMonth = App.currentMonth
  const nextMonth = reportMonth === 12 ? 1 : reportMonth + 1
  const nextYear = reportMonth === 12 ? reportYear + 1 : reportYear

  const [summaryData, annualData, nextSettingsData] = await Promise.all([
    api('GET', `/api/dashboard/summary/${reportYear}/${reportMonth}?hospitalId=${targetHospitalId}`),
    api('GET', `/api/dashboard/annual/${reportYear}?hospitalId=${targetHospitalId}`),
    api('GET', `/api/settings/${nextYear}/${nextMonth}?hospitalId=${targetHospitalId}`)
  ])

  const s = summaryData?.summary || {}
  const vendors = summaryData?.vendors || []
  const ms = summaryData?.mealStats || {}
  const dailyOrders = summaryData?.dailyOrders || []
  const vendorOrders = summaryData?.vendorOrders || vendors

  const monthlyUsed = (annualData?.monthly||[])
  const monthlyMeals = (annualData?.mealMonthly||[])
  const monthlySettings = (annualData?.settings||[])

  const nextSettings = nextSettingsData?.settings || {}
  const nextBudget = nextSettings.total_budget || 0
  const nextMealPrice = nextSettings.meal_price || 0

  // 일별 발주 데이터 정리
  const daysCount = new Date(reportYear, reportMonth, 0).getDate()
  const dailyMap = {}
  dailyOrders.forEach(d => {
    const day = parseInt(d.order_date.split('-')[2])
    dailyMap[day] = (dailyMap[day]||0) + d.daily_total
  })
  const dailyLabels = Array.from({length:daysCount}, (_,i)=>`${i+1}`)
  const dailyValues = Array.from({length:daysCount}, (_,i)=>dailyMap[i+1]||0)

  content.innerHTML = `
  <!-- 보고서 컨트롤 (인쇄 제외) -->
  <div class="mb-4 flex items-center gap-3 flex-wrap no-print">
    <select id="reportHospitalSelect" onchange="renderReport(this.value)" class="form-input" style="width:auto;min-width:180px">
      ${hospitals.map(h => `<option value="${h.id}" ${h.id==selectedHospitalId?'selected':''}>${h.name}</option>`).join('')}
    </select>
    <div class="flex items-center gap-2 text-sm text-gray-500">
      <i class="fas fa-file-pdf text-red-500"></i>
      <span>${reportYear}년 ${reportMonth}월 월간 보고서</span>
    </div>
    <div class="ml-auto flex gap-2">
      <button onclick="window.print()" class="btn btn-secondary btn-sm">
        <i class="fas fa-print mr-1"></i>인쇄/PDF저장
      </button>
      <button onclick="exportReportPPT('${hospitalName}',${reportYear},${reportMonth})" class="btn btn-primary btn-sm">
        <i class="fas fa-file-powerpoint mr-1"></i>PPT 다운로드
      </button>
    </div>
  </div>

  <!-- ══ 보고서 본문 (인쇄 대상) ══ -->
  <div id="reportBody" class="space-y-6">

    <!-- 슬라이드 1: 표지 -->
    <div class="report-slide bg-gradient-to-br from-green-800 to-green-600 text-white rounded-2xl p-10 text-center shadow-lg">
      <div class="text-5xl mb-4">🏥</div>
      <h1 class="text-3xl font-bold mb-2">${hospitalName}</h1>
      <h2 class="text-xl mb-6 opacity-80">급식 운영 월간 보고서</h2>
      <div class="text-4xl font-bold mb-2">${reportYear}년 ${reportMonth}월</div>
      <div class="text-sm opacity-60 mt-6">작성일: ${new Date().toLocaleDateString('ko-KR')}</div>
    </div>

    <!-- 슬라이드 2: 월 예산 요약 + 다음달 목표 -->
    <div class="report-slide bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 class="report-slide-title"><i class="fas fa-chart-pie text-green-600 mr-2"></i>월 예산 요약</h2>
      <div class="grid grid-cols-4 gap-4 mb-6">
        ${[
          { label:'총 예산', val:`${fmtMan(s.totalBudget||0)}원`, color:'text-green-700' },
          { label:'사용금액', val:`${fmtMan(s.totalUsed||0)}원`, color:'text-green-700' },
          { label:'달성률', val:`${s.progress||0}%`, color: parseFloat(s.progress||0)>=100?'text-red-600':'text-green-700' },
          { label:'잔여예산', val:`${fmtMan(Math.abs(s.remaining||0))}원`, color:(s.remaining||0)<0?'text-red-600':'text-gray-800' }
        ].map(item => `
          <div class="bg-gray-50 rounded-xl p-4 text-center">
            <div class="text-xs text-gray-500 mb-1">${item.label}</div>
            <div class="text-xl font-bold ${item.color}">${item.val}</div>
          </div>`).join('')}
      </div>
      <div class="mb-2 flex justify-between text-xs text-gray-500">
        <span>예산 달성률</span><span>${s.progress||0}%</span>
      </div>
      <div class="progress-bar h-4 mb-6">
        <div class="progress-fill ${getProgressColor(parseFloat(s.progress||0))}" style="width:${Math.min(parseFloat(s.progress||0),100)}%"></div>
      </div>
      <!-- 다음달 목표 -->
      ${nextBudget > 0 || nextMealPrice > 0 ? `
      <div class="border-t border-gray-100 pt-4">
        <h3 class="text-sm font-semibold text-gray-600 mb-3"><i class="fas fa-arrow-right text-green-600 mr-1"></i>${nextYear}년 ${nextMonth}월 목표</h3>
        <div class="grid grid-cols-2 gap-4">
          ${nextBudget > 0 ? `<div class="bg-green-50 rounded-xl p-3 text-center">
            <div class="text-xs text-gray-500 mb-1">다음달 목표금액</div>
            <div class="text-lg font-bold text-green-700">${fmtWon(nextBudget)}</div>
          </div>` : ''}
          ${nextMealPrice > 0 ? `<div class="bg-green-50 rounded-xl p-3 text-center">
            <div class="text-xs text-gray-500 mb-1">다음달 목표 식단가</div>
            <div class="text-lg font-bold text-green-700">${fmtWon(nextMealPrice)}/식</div>
          </div>` : ''}
        </div>
      </div>` : ''}
    </div>

    <!-- 슬라이드 3: 업체별 발주 내역 표 + 차트 -->
    <div class="report-slide bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 class="report-slide-title"><i class="fas fa-store text-green-600 mr-2"></i>업체별 발주 내역</h2>
      <div class="grid grid-cols-2 gap-6">
        <div>
          <div class="overflow-hidden rounded-xl border border-gray-100 mb-4">
            <table class="data-table w-full text-xs">
              <thead><tr><th class="text-left pl-3">업체명</th><th class="text-right">발주금액</th><th class="text-right">목표</th><th class="text-right">달성률</th></tr></thead>
              <tbody>
                ${vendors.map(v => {
                  const pct = v.monthly_budget > 0 ? Math.round(v.total_used / v.monthly_budget * 100) : null
                  const over = v.monthly_budget > 0 && v.total_used > v.monthly_budget
                  return `<tr class="${over?'bg-red-50':''}">
                    <td class="pl-3 font-medium">${v.name}</td>
                    <td class="text-right pr-3 font-semibold ${over?'text-red-600':'text-green-700'}">${fmtMan(v.total_used)}원</td>
                    <td class="text-right pr-3 text-gray-400">${v.monthly_budget>0?fmtMan(v.monthly_budget)+'원':'-'}</td>
                    <td class="text-right pr-3 ${over?'text-red-500 font-bold':''}">${pct!=null?pct+'%':'-'}</td>
                  </tr>`
                }).join('')}
                <tr class="bg-green-50 font-bold">
                  <td class="pl-3">합계</td>
                  <td class="text-right pr-3 text-green-700">${fmtMan(s.totalUsed||0)}원</td>
                  <td class="text-right pr-3 text-gray-400">${fmtMan(s.totalBudget||0)}원</td>
                  <td class="text-right pr-3">${s.progress||0}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div><canvas id="rpt-vendorChart" style="max-height:220px"></canvas></div>
      </div>
    </div>

    <!-- 슬라이드 4: 일별 매입금액 표 + 차트 -->
    <div class="report-slide bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 class="report-slide-title"><i class="fas fa-calendar-day text-green-600 mr-2"></i>일별 매입금액 (1일~말일)</h2>
      <div class="grid grid-cols-2 gap-6">
        <div style="max-height:300px;overflow-y:auto">
          <table class="data-table w-full text-xs">
            <thead><tr><th>일</th><th>요일</th><th class="text-right">금액</th></tr></thead>
            <tbody>
              ${Array.from({length:daysCount},(_,i)=>{
                const day=i+1, val=dailyMap[day]||0
                const dow=['일','월','화','수','목','금','토'][new Date(reportYear,reportMonth-1,day).getDay()]
                const isWknd=dow==='토'||dow==='일'
                return `<tr class="${isWknd?'bg-gray-50':''}">
                  <td class="text-center">${day}</td>
                  <td class="text-center" style="color:${dow==='토'?'#16a34a':dow==='일'?'#ef4444':'#6b7280'}">${dow}</td>
                  <td class="text-right pr-3 ${val>0?'font-medium':''}">${val>0?fmtMan(val)+'원':'-'}</td>
                </tr>`
              }).join('')}
              <tr class="bg-green-50 font-bold"><td colspan="2" class="text-center">합계</td><td class="text-right pr-3 text-green-700">${fmtMan(dailyValues.reduce((s,v)=>s+v,0))}원</td></tr>
            </tbody>
          </table>
        </div>
        <div><canvas id="rpt-dailyChart" style="max-height:280px"></canvas></div>
      </div>
    </div>

    <!-- 슬라이드 5: 식수 현황 -->
    <div class="report-slide bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 class="report-slide-title"><i class="fas fa-utensils text-green-600 mr-2"></i>식수 현황 통계</h2>
      <div class="grid grid-cols-4 gap-4 mb-6">
        ${[
          { label:'환자식', val:fmt((ms.total_patient||0)), icon:'fa-procedures', color:'bg-blue-50 text-blue-700' },
          { label:'직원식', val:fmt((ms.total_staff||0)), icon:'fa-user-md', color:'bg-green-50 text-green-700' },
          { label:'비급여식', val:fmt((ms.total_noncovered||0)), icon:'fa-user', color:'bg-purple-50 text-purple-700' },
          { label:'전체', val:fmt((ms.total_patient||0)+(ms.total_staff||0)+(ms.total_noncovered||0)), icon:'fa-users', color:'bg-gray-50 text-gray-700' }
        ].map(item => `
          <div class="rounded-xl p-4 text-center ${item.color.split(' ')[0]}">
            <i class="fas ${item.icon} text-2xl ${item.color.split(' ')[1]} mb-2"></i>
            <div class="text-xs text-gray-500 mb-1">${item.label}</div>
            <div class="text-xl font-bold ${item.color.split(' ')[1]}">${item.val}식</div>
          </div>`).join('')}
      </div>
      <canvas id="rpt-mealMonthChart" style="max-height:220px"></canvas>
    </div>

    <!-- 슬라이드 6: 식단가 분석 -->
    <div class="report-slide bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 class="report-slide-title"><i class="fas fa-coins text-green-600 mr-2"></i>식단가 월별 비교 분석</h2>
      <canvas id="rpt-mealPriceChart" style="max-height:250px"></canvas>
      <div class="mt-4 grid grid-cols-3 gap-4">
        <div class="bg-gray-50 rounded-xl p-3 text-center">
          <div class="text-xs text-gray-500 mb-1">이번달 식단가</div>
          <div class="text-lg font-bold text-green-700">${fmtWon(s.mealPrice||0)}</div>
        </div>
        <div class="bg-gray-50 rounded-xl p-3 text-center">
          <div class="text-xs text-gray-500 mb-1">목표 식단가</div>
          <div class="text-lg font-bold text-gray-700">${fmtWon(s.targetMealPrice||0)}</div>
        </div>
        <div class="bg-gray-50 rounded-xl p-3 text-center">
          <div class="text-xs text-gray-500 mb-1">전월 대비 차액</div>
          <div class="text-lg font-bold ${(s.mealPriceDiff||0)>0?'text-red-600':(s.mealPriceDiff||0)<0?'text-green-600':'text-gray-700'}">${(s.mealPriceDiff||0)>0?'+':''}${fmtWon(s.mealPriceDiff||0)}</div>
        </div>
      </div>
    </div>

  </div>`

  // ── 차트 렌더링 ──
  // 업체별 도넛차트
  const vendorLabels = vendors.map(v=>v.name)
  const vendorData = vendors.map(v=>v.total_used)
  if (document.getElementById('rpt-vendorChart') && vendorData.some(v=>v>0)) {
    App.charts.rptVendor = new Chart(document.getElementById('rpt-vendorChart'), {
      type: 'doughnut',
      data: {
        labels: vendorLabels,
        datasets: [{ data: vendorData,
          backgroundColor: ['#16a34a','#15803d','#22c55e','#86efac','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899','#64748b'] }]
      },
      options: { responsive:true, plugins:{ legend:{ position:'right', labels:{ font:{size:11} } } } }
    })
  }

  // 일별 바차트
  App.charts.rptDaily = new Chart(document.getElementById('rpt-dailyChart'), {
    type: 'bar',
    data: {
      labels: dailyLabels,
      datasets: [{ label:'일별 매입금액', data:dailyValues, backgroundColor:'rgba(22,163,74,0.7)', borderRadius:4 }]
    },
    options: { responsive:true,
      plugins:{ legend:{display:false} },
      scales:{ y:{ ticks:{ callback:v=>`${(v/10000).toFixed(0)}만` } } }
    }
  })

  // 월별 식수 차트
  const mMonths = Array.from({length:12}, (_,i)=>`${i+1}월`)
  const mMealsData = Array(12).fill(0)
  const mPriceData = Array(12).fill(0)
  const mUsedData = Array(12).fill(0)
  const mBudgetData = Array(12).fill(0)
  monthlyMeals.forEach(m=>{ mMealsData[parseInt(m.month)-1] = m.total_meals })
  monthlyUsed.forEach(m=>{ mUsedData[parseInt(m.month)-1] = m.total_used })
  monthlySettings.forEach(m=>{ mBudgetData[m.month-1] = m.total_budget })
  mMealsData.forEach((meals, i)=>{ if(meals>0&&mUsedData[i]>0) mPriceData[i] = Math.round(mUsedData[i]/meals) })

  App.charts.rptMealMonth = new Chart(document.getElementById('rpt-mealMonthChart'), {
    type: 'bar',
    data: {
      labels: mMonths,
      datasets: [
        { label:'전체 식수', data:mMealsData, backgroundColor:'rgba(22,163,74,0.6)', borderRadius:4, yAxisID:'y' }
      ]
    },
    options: { responsive:true,
      plugins:{ legend:{ labels:{ font:{size:11} } } },
      scales:{ y:{ ticks:{ callback:v=>`${v}식` }, position:'left' } }
    }
  })

  App.charts.rptMealPrice = new Chart(document.getElementById('rpt-mealPriceChart'), {
    type: 'line',
    data: {
      labels: mMonths,
      datasets: [
        { label:'식단가', data:mPriceData, borderColor:'#16a34a', backgroundColor:'rgba(22,163,74,0.1)', fill:true, tension:0.4, pointRadius:5 },
        { label:'예산 기준가', data:mBudgetData.map((b,i)=>mMealsData[i]>0?Math.round(b/mMealsData[i]):0),
          borderColor:'#ef4444', borderDash:[5,5], borderWidth:2, pointRadius:3, fill:false }
      ]
    },
    options: { responsive:true,
      plugins:{ legend:{ labels:{ font:{size:11} } } },
      scales:{ y:{ ticks:{ callback:v=>`${v.toLocaleString()}원` } } }
    }
  })
}

async function exportReportPPT(hospitalName, year, month) {
  showToast('PPT 생성 중... 잠시 기다려주세요', 'warning')
  // pptxgenjs CDN 동적 로드
  if (!window.PptxGenJS) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js'
      s.onload = resolve; s.onerror = reject
      document.head.appendChild(s)
    })
  }
  const pptx = new window.PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'

  // 슬라이드 1: 표지
  const s1 = pptx.addSlide()
  s1.background = { color: '166534' }
  s1.addText(`${hospitalName}`, { x:1, y:1.5, w:11, h:1, fontSize:36, bold:true, color:'FFFFFF', align:'center' })
  s1.addText('급식 운영 월간 보고서', { x:1, y:2.7, w:11, h:0.7, fontSize:22, color:'CCFFCC', align:'center' })
  s1.addText(`${year}년 ${month}월`, { x:1, y:3.6, w:11, h:0.8, fontSize:28, bold:true, color:'FFFFFF', align:'center' })
  s1.addText(`작성일: ${new Date().toLocaleDateString('ko-KR')}`, { x:1, y:5.2, w:11, h:0.4, fontSize:13, color:'AAFFAA', align:'center' })

  // 슬라이드 2: 예산 요약
  const s2 = pptx.addSlide()
  s2.addText('월 예산 요약', { x:0.5, y:0.3, w:12, h:0.6, fontSize:24, bold:true, color:'166534' })
  const canvas1 = document.getElementById('rpt-vendorChart')
  if (canvas1) {
    s2.addImage({ data: canvas1.toDataURL('image/png'), x:0.5, y:1.0, w:12, h:4.5 })
  }

  // 슬라이드 3: 일별 매입금액
  const s3 = pptx.addSlide()
  s3.addText('일별 매입금액', { x:0.5, y:0.3, w:12, h:0.6, fontSize:24, bold:true, color:'166534' })
  const canvas2 = document.getElementById('rpt-dailyChart')
  if (canvas2) {
    s3.addImage({ data: canvas2.toDataURL('image/png'), x:0.5, y:1.0, w:12, h:4.5 })
  }

  // 슬라이드 4: 식수 현황
  const s4 = pptx.addSlide()
  s4.addText('식수 현황 월별 추이', { x:0.5, y:0.3, w:12, h:0.6, fontSize:24, bold:true, color:'166534' })
  const canvas3 = document.getElementById('rpt-mealMonthChart')
  if (canvas3) {
    s4.addImage({ data: canvas3.toDataURL('image/png'), x:0.5, y:1.0, w:12, h:4.5 })
  }

  // 슬라이드 5: 식단가 분석
  const s5 = pptx.addSlide()
  s5.addText('식단가 월별 비교', { x:0.5, y:0.3, w:12, h:0.6, fontSize:24, bold:true, color:'166534' })
  const canvas4 = document.getElementById('rpt-mealPriceChart')
  if (canvas4) {
    s5.addImage({ data: canvas4.toDataURL('image/png'), x:0.5, y:1.0, w:12, h:4.5 })
  }

  pptx.writeFile({ fileName: `${hospitalName}_${year}년${month}월_보고서.pptx` })
  showToast('PPT 다운로드 완료!', 'success')
}
