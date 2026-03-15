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
  initMobileNav()   // 모바일 하단 네비 초기화
  initMobileUtils() // 모바일 제스처/UX 초기화

  const path = window.location.pathname
  const pageMap = {
    '/dashboard': 'dashboard', '/': 'dashboard',
    '/orders': 'orders', '/meals': 'meals',
    '/schedule': 'schedule', '/analysis': 'analysis',
    '/settings': 'settings', '/admin': 'admin'
  }
  navigateTo(pageMap[path] || 'dashboard')
})

// ── 모바일 사이드바 토글 ──────────────────────────────────────
window.openSidebar = function() {
  const sidebar = document.getElementById('sidebar')
  const overlay = document.getElementById('sidebarOverlay')
  if (sidebar) sidebar.classList.add('open')
  if (overlay) overlay.classList.add('active')
  document.body.style.overflow = 'hidden'
}
window.closeSidebar = function() {
  const sidebar = document.getElementById('sidebar')
  const overlay = document.getElementById('sidebarOverlay')
  if (sidebar) sidebar.classList.remove('open')
  if (overlay) overlay.classList.remove('active')
  document.body.style.overflow = ''
}

// ── 모바일 하단 네비게이션 초기화 ─────────────────────────────
function initMobileNav() {
  const nav = document.getElementById('mobileBottomNav')
  const container = document.getElementById('mobileNavItems')
  if (!nav || !container) return

  const menus = App.role === 'admin' ? getAdminMenus() : getHospitalMenus()
  // 최대 5개만 표시
  const mobileMenus = menus.slice(0, 5)

  container.innerHTML = mobileMenus.map(item => `
    <div class="mobile-nav-item" id="mobnav-${item.id}" onclick="navigateTo('${item.id}');closeSidebar()">
      <i class="fas ${item.icon}"></i>
      <span>${item.label.length > 4 ? item.label.substring(0,4) : item.label}</span>
    </div>
  `).join('')
}

// 모바일 하단 네비 활성 상태 업데이트
function updateMobileNav(page) {
  document.querySelectorAll('.mobile-nav-item').forEach(el => {
    el.classList.toggle('active', el.id === `mobnav-${page}`)
  })
}

// ── 모바일 유틸리티 초기화 ────────────────────────────────────
function initMobileUtils() {
  // 모바일 판단 (768px 이하)
  const isMobile = () => window.innerWidth <= 768

  // 사이드바 메뉴 클릭 시 모바일이면 자동 닫기
  document.addEventListener('click', (e) => {
    const menuItem = e.target.closest('.menu-item')
    if (menuItem && isMobile()) {
      closeSidebar()
    }
  })

  // 키보드(숫자 입력) 시 하단 nav 잠시 숨기기 (모바일 전용)
  if (isMobile()) {
    document.addEventListener('focusin', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        const nav = document.getElementById('mobileBottomNav')
        if (nav) nav.style.display = 'none'
        const main = document.querySelector('main')
        if (main) main.style.paddingBottom = '0'
      }
    })
    document.addEventListener('focusout', (e) => {
      setTimeout(() => {
        const nav = document.getElementById('mobileBottomNav')
        if (nav) nav.style.display = 'block'
        const main = document.querySelector('main')
        if (main) main.style.paddingBottom = '60px'
      }, 200)
    })
  }
}

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

// ── 실시간 활동 로그 전송 (실제 편집 시에만 호출) ─────────────
async function sendActivityLog(action) {
  if (App.role === 'admin') return
  try {
    await api('POST', '/api/settings/session/activity', {
      page: App.currentPage,
      action: action || ''
    })
  } catch(e) {}
}

// ── 스마트 폴링 (관리자 대시보드 실시간 갱신) ─────────────────
let _smartPollTimer = null
let _lastInputTime = 0
let _isPolling = false

function startSmartPolling(refreshFn, baseInterval = 10000) {
  stopSmartPolling()
  // 입력 감지: 포커스 중인 셀은 갱신 제외
  const onInput = () => { _lastInputTime = Date.now() }
  document.addEventListener('input', onInput)
  document.addEventListener('change', onInput)

  _smartPollTimer = setInterval(async () => {
    if (_isPolling) return
    // 입력 중(2초 이내)이면 건너뜀
    if (Date.now() - _lastInputTime < 2000) return
    // 포커스된 입력 요소 있으면 건너뜀
    const focused = document.activeElement
    if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.tagName === 'SELECT')) return
    _isPolling = true
    try { await refreshFn() } catch(e) {}
    _isPolling = false
  }, baseInterval)

  return () => {
    document.removeEventListener('input', onInput)
    document.removeEventListener('change', onInput)
  }
}

function stopSmartPolling() {
  if (_smartPollTimer) {
    clearInterval(_smartPollTimer)
    _smartPollTimer = null
  }
  _isPolling = false
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
  const notifCnt = data.unreadCount || 0

  // 마감 승인 요청 건수도 별도로 가져오기
  let closeReqCnt = 0
  try {
    const cr = await api('GET', '/api/admin/close-requests/pending')
    closeReqCnt = cr?.count || 0
  } catch(e) {}

  // ① 마감요청 배지 (빨간색) - 별도 표시
  const closeReqEl = document.getElementById('close-req-badge')
  if (closeReqEl) {
    if (closeReqCnt > 0) {
      closeReqEl.textContent = closeReqCnt > 9 ? '9+' : closeReqCnt
      closeReqEl.style.display = ''
      closeReqEl.title = `📋 마감요청 ${closeReqCnt}건`
    } else {
      closeReqEl.style.display = 'none'
    }
  }

  // ② 이슈 알림 배지 (주황색) - 별도 표시
  const issueBadgeEl = document.getElementById('notif-issue-badge')
  if (issueBadgeEl) {
    if (notifCnt > 0) {
      issueBadgeEl.textContent = notifCnt > 9 ? '9+' : notifCnt
      issueBadgeEl.style.display = ''
      issueBadgeEl.title = `🔔 이슈알림 ${notifCnt}건`
    } else {
      issueBadgeEl.style.display = 'none'
    }
  }

  // 기존 단일 배지(notif-badge) 정리 - 이전 코드 잔재 제거
  const menuEl = document.getElementById('menu-hospital-manage')
  if (menuEl) {
    const existing = menuEl.querySelector('.notif-badge')
    if (existing) existing.remove()
  }

  App.unreadNotifCount = notifCnt
  App.closeReqCount = closeReqCnt
}

function getHospitalMenus() {
  return [
    { id: 'dashboard', icon: 'fa-chart-line', label: '월별 대시보드', section: '현황' },
    { id: 'orders', icon: 'fa-clipboard-list', label: '발주 입력', section: null },
    { id: 'meals', icon: 'fa-utensils', label: '식수 입력', section: null },
    { id: 'schedule', icon: 'fa-calendar-alt', label: '스케줄 관리', section: null },
    { id: 'analysis', icon: 'fa-chart-bar', label: '비교 분석', section: '분석' },
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
  // 병원 관리 메뉴에는 마감요청 + 이슈 배지 슬롯 두 개 포함
  const badgeHtml = item.id === 'hospital-manage'
    ? `<span id="close-req-badge" class="ml-auto bg-red-500 text-white text-xs rounded-full min-w-[20px] h-5 px-1 flex items-center justify-center font-bold" style="display:none" title="마감요청"></span>
       <span id="notif-issue-badge" class="bg-orange-400 text-white text-xs rounded-full min-w-[20px] h-5 px-1 flex items-center justify-center font-bold ml-1" style="display:none" title="이슈알림"></span>`
    : ''
  return `${sectionHtml}
  <div class="menu-item" id="menu-${item.id}" onclick="navigateTo('${item.id}')">
    <div class="icon"><i class="fas ${item.icon} text-xs"></i></div>
    <span>${item.label}</span>
    ${badgeHtml}
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
    analysis: { title: '비교 분석', sub: '연도별·월별 비교 및 추이 그래프' },
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
  // ※ orders는 환자군 카테고리 변경을 반영하기 위해 항상 새로 렌더링
  const cacheKey = `${page}-${App.currentYear}-${App.currentMonth}`
  if (!forceReload && page === 'meals' && App._panelReady[cacheKey]) {
    return
  }

  // 차트 정리 (orders/meals 제외)
  if (page !== 'orders' && page !== 'meals') {
    Object.values(App.charts).forEach(c => c?.destroy?.())
    App.charts = {}
  }
  if (page !== 'settings') stopClosingPoll()
  // 관리자 페이지 이탈 시 스마트 폴링 중단
  if (page !== 'admin') stopSmartPolling()

  const pages = {
    dashboard: renderDashboard, orders: renderOrders, meals: renderMeals,
    schedule: renderSchedule,  analysis: renderAnalysis,
    settings: renderSettings,  admin: renderAdminDashboard,
    'hospital-manage': renderHospitalManage,
    'holiday-manage':  renderHolidayManage,
    report: renderReport
  }

  if (pages[page]) {
    if (page === 'meals') App._panelReady[cacheKey] = true
    pages[page]()
  } else {
    document.getElementById('pageContent').innerHTML =
      '<div class="text-center text-gray-400 py-20">준비 중입니다</div>'
  }

  // 모바일 하단 네비 활성 탭 업데이트
  updateMobileNav(page)
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
// 콤마 포함 문자열에서 숫자 추출 (발주입력 text 필드용)
function parseOrderVal(v) { return parseInt(String(v||'').replace(/,/g,''))||0 }
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

// 환자군 카테고리 색상 (hex)
function getCategoryColorHex(key) {
  const colors = {
    general: '#6b7280', cancer: '#dc2626', rehab: '#2563eb',
    nursing: '#16a34a', traffic: '#d97706', mental: '#7c3aed',
    pediatric: '#db2777', spine: '#0891b2', joint: '#059669',
    cardiac: '#e11d48', dialysis: '#0284c7', stroke: '#9333ea',
    elderly: '#65a30d', maternity: '#ec4899', other: '#6b7280'
  }
  return colors[key] || '#6b7280'
}

// 카테고리 설정 안내
function openCategorySetupGuide() {
  showToast('관리자 → 병원관리 → 환자군 탭에서 카테고리를 설정하세요', 'info')
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

  const [data, catData] = await Promise.all([
    api('GET', `/api/dashboard/summary/${App.currentYear}/${App.currentMonth}`),
    api('GET', `/api/orders/category-monthly/${App.currentYear}/${App.currentMonth}`)
  ])
  if (!data) { content.innerHTML = '<div class="text-red-500 p-6">데이터 로드 실패</div>'; return }

  const patientCats = catData?.categories || []
  const catMonthly = catData?.monthly || []
  const catSettings = catData?.settings || []
  const catTodayMeals = catData?.todayMeals || { patient_total: 0 }
  const catPrevSettings = catData?.prevSettings || []

  // 카테고리별 데이터 맵
  const catMonthlyMap = {}
  catMonthly.forEach(m => { catMonthlyMap[m.patient_category_id] = m })
  const catSettingsMap = {}
  catSettings.forEach(s => { catSettingsMap[s.patient_category_id] = s })
  const catPrevSettingsMap = {}
  catPrevSettings.forEach(s => { catPrevSettingsMap[s.patient_category_id] = s })

  const s = data.summary
  const vendors = data.vendors || []
  const ms = data.mealStats || {}
  const pm = data.prevMonth || {}  // 전월 데이터
  // 백엔드에서 계산된 카테고리별 식단가 데이터 (있으면 우선 사용)
  const catDietPricesData = data.catDietPrices || []
  window._catDietPricesData = catDietPricesData  // 실시간 패널에서 참조
  const todayPatientMealsDash = data.todayPatientMeals || 0
  const mealCustomFields = data.mealCustomFields || []
  const mealCustomTotals = data.mealCustomTotals || {}
  // ea 단위 커스텀 필드는 총식수에서 제외
  const customMealTotal = mealCustomFields
    .filter(f => (f.unit_type||'meal') !== 'ea')
    .reduce((s, f) => s + (Number(mealCustomTotals[f.field_key]) || 0), 0)
  const totalMeals = (ms.total_patient||0)+(ms.total_staff||0)+(ms.total_guardian||0) + customMealTotal
  const mealPrice = totalMeals > 0 && s.totalUsed > 0 ? Math.round(s.totalUsed / totalMeals) : (data.settings?.meal_price || 0)
  // 식단가 3종 (API에서 제공)
  const mealPriceTotal = data.mealPriceTotal || mealPrice
  const mealPriceNoStaff = data.mealPriceNoStaff || 0
  const mealPriceNoSupply = data.mealPriceNoSupply || 0
  const targetMealPrice = data.settings?.meal_price || 0
  const mpOver = targetMealPrice > 0 && mealPriceTotal > targetMealPrice
  const overBudget = data.overBudgetVendors || []

  // 전월 비교 계산 헬퍼
  function mpDiff(cur, prev) {
    if (!prev || !cur) return ''
    const diff = cur - prev
    const pct = prev > 0 ? ((diff / prev) * 100).toFixed(1) : '0.0'
    if (diff > 0) return `<span class="text-red-500 text-xs font-semibold">▲${fmt(diff)}원 (+${pct}%)</span>`
    if (diff < 0) return `<span class="text-green-600 text-xs font-semibold">▼${fmt(Math.abs(diff))}원 (${pct}%)</span>`
    return `<span class="text-gray-400 text-xs">변동없음</span>`
  }
  
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
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
    <div class="stat-card">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs text-gray-500 font-semibold uppercase tracking-wide">월 사용금액</span>
        <div class="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
          <i class="fas fa-won-sign text-blue-500 text-xs"></i>
        </div>
      </div>
      <div class="text-xl md:text-2xl font-bold text-gray-800">${fmtMan(s.totalUsed)}<span class="text-xs font-normal text-gray-400 ml-1">원</span></div>
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
      <div class="text-xl md:text-2xl font-bold ${s.remaining<0?'text-red-600':'text-gray-800'}">${fmtMan(Math.abs(s.remaining))}<span class="text-xs font-normal text-gray-400 ml-1">원</span></div>
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
      <div class="text-xl md:text-2xl font-bold ${parseFloat(s.todayProgress)>=100?'text-red-600':parseFloat(s.todayProgress)>=80?'text-yellow-600':'text-gray-800'}">${fmtMan(s.todayUsed)}<span class="text-xs font-normal text-gray-400 ml-1">원</span></div>
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
      <div class="text-xl md:text-2xl font-bold ${parseFloat(s.weekProgress)>=100?'text-red-600':parseFloat(s.weekProgress)>=80?'text-yellow-600':'text-gray-800'}">${fmtMan(s.weekUsed)}<span class="text-xs font-normal text-gray-400 ml-1">원</span></div>
      <div class="text-xs text-gray-400 mt-1">주 목표: ${fmtMan(s.weeklyBudget)}원</div>
      <div class="mt-2 progress-bar">
        <div class="progress-fill ${getProgressColor(parseFloat(s.weekProgress))}" style="width:${Math.min(parseFloat(s.weekProgress||0),100)}%"></div>
      </div>
      <div class="mt-1 text-xs text-gray-500">${s.weekProgress}%</div>
    </div>
  </div>

  <!-- 업체별 진행률 + 일별 차트 -->
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
    <!-- 업체별 진행률 -->
    <div class="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 class="font-bold text-gray-800">업체별 예산 현황</h2>
        <button onclick="navigateTo('orders')" class="text-xs text-blue-500 hover:underline flex items-center gap-1">
          <i class="fas fa-edit"></i> 발주 입력 →
        </button>
      </div>
      <div class="overflow-x-auto">
        <table class="data-table" style="table-layout:fixed;width:100%">
          <colgroup>
            <col style="width:auto;min-width:120px">
            <col style="width:110px">
            <col style="width:110px">
            <col style="min-width:160px;max-width:220px">
            <col style="width:100px">
          </colgroup>
          <thead>
            <tr>
              <th>업체명</th>
              <th class="text-right">사용금액</th>
              <th class="text-right">목표금액</th>
              <th>진행률</th>
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
  ${patientCats.length > 0 ? `
  <!-- 환자군별 발주 현황 -->
  <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4">
    <div class="flex items-center justify-between mb-4">
      <h2 class="font-bold text-gray-800"><i class="fas fa-layer-group text-purple-600 mr-2"></i>환자군별 발주 현황</h2>
      <span class="text-xs text-gray-400">${App.currentYear}년 ${App.currentMonth}월</span>
    </div>
    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      ${patientCats.map(cat => {
        const monthly = catMonthlyMap[cat.id] || {}
        const settings = catSettingsMap[cat.id] || {}
        const used = monthly.total || 0
        const budget = settings.monthly_budget || 0
        const taxable = monthly.taxable || 0
        const exempt = monthly.exempt || 0
        const pct = budget > 0 ? Math.round(used / budget * 100) : null
        const over = pct !== null && pct >= 100
        const warn = pct !== null && pct >= 80 && !over
        const catColor = getCategoryColorHex(cat.category_key)
        const borderColor = over ? '#ef4444' : warn ? '#f59e0b' : catColor
        return `<div style="border:2px solid ${borderColor}20;border-radius:12px;padding:12px;background:${catColor}08;position:relative;overflow:hidden">
          <div style="position:absolute;top:0;right:0;width:40px;height:40px;border-radius:0 0 0 40px;background:${catColor}15"></div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
            <div style="width:24px;height:24px;border-radius:6px;background:${catColor};display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:700">${cat.category_name.charAt(0)}</div>
            <span style="font-weight:700;color:#374151;font-size:13px">${cat.category_name}</span>
            ${cat.order_code ? `<span style="font-size:10px;color:#9ca3af">(${cat.order_code})</span>` : ''}
          </div>
          <div style="font-size:20px;font-weight:900;color:${over?'#dc2626':catColor};line-height:1;margin-bottom:4px">${fmtMan(used)}</div>
          ${budget > 0 ? `
          <div style="font-size:10px;color:#9ca3af;margin-bottom:6px">목표: ${fmtMan(budget)}</div>
          <div style="background:${catColor}20;border-radius:4px;height:5px;overflow:hidden;margin-bottom:4px">
            <div style="height:5px;width:${Math.min(pct||0,100)}%;background:${over?'#ef4444':warn?'#f59e0b':catColor};border-radius:4px;transition:width 0.3s"></div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:11px;font-weight:700;color:${over?'#dc2626':warn?'#d97706':catColor}">${pct}%</span>
            <span style="font-size:10px;color:#9ca3af">${over?'<span style="color:#dc2626">초과</span>':fmtMan(budget-used)+' 남음'}</span>
          </div>` : `<div style="font-size:10px;color:#9ca3af">목표미설정</div>`}
          ${(taxable > 0 || exempt > 0) ? `
          <div style="margin-top:6px;padding-top:6px;border-top:1px solid ${catColor}20;display:flex;gap:8px;font-size:10px;color:#6b7280">
            <span>과: ${fmtMan(taxable)}</span>
            <span>면: ${fmtMan(exempt)}</span>
          </div>` : ''}
        </div>`
      }).join('')}
    </div>
  </div>` : ''}
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
          { label: '보호자', value: ms.total_guardian, color: 'bg-orange-100 text-orange-700', icon: 'fa-users' },
          ...mealCustomFields.map(f => ({ label: f.field_name, value: mealCustomTotals[f.field_key]||0, color: f.unit_type==='ea'?'bg-orange-100 text-orange-700':'bg-indigo-100 text-indigo-700', icon: 'fa-utensils', unit: f.unit_type||'meal' }))
        ].map(item => `
          <div class="flex items-center gap-3 p-3 rounded-xl ${item.color.split(' ')[0]}">
            <div class="w-9 h-9 rounded-lg flex items-center justify-center ${item.color}">
              <i class="fas ${item.icon} text-xs"></i>
            </div>
            <div>
              <div class="text-xs font-medium opacity-75">${item.label}${item.unit==='ea'?'<span style="font-size:9px;color:#f97316">(ea)</span>':''}</div>
              <div class="font-bold text-lg">${fmt(item.value)}<span class="text-xs font-normal opacity-60 ml-1">${item.unit==='ea'?'개':'식'}</span></div>
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

      <!-- 환자군별 식단가 현황 -->
      ${(() => {
        // 백엔드 catDietPricesData 우선, 없으면 기존 계산 방식 폴백
        const catsToRender = catDietPricesData.length > 0 ? catDietPricesData : (patientCats.length > 0 ? patientCats.map(cat => {
          const cs = catSettingsMap[cat.id] || {}
          return { id: cat.id, category_key: cat.category_key, category_name: cat.category_name,
            monthAmt: catMonthlyMap[cat.id]?.total || 0, todayAmt: 0, monthBudget: cs.monthly_budget||0,
            targetPrice: cs.target_meal_price||0, workDays: cs.working_days||30,
            todayCatMeals: 0, todayDietPrice: 0, catRatio: 1/patientCats.length,
            prevTargetPrice: catPrevSettingsMap[cat.id]?.target_meal_price||0, prevMonthBudget: 0 }
        }) : [])
        if (catsToRender.length === 0) return ''

        const totalCatBudget2 = catsToRender.reduce((s,c) => s+(c.monthBudget||0), 0)
        const weightedTarget2 = totalCatBudget2 > 0
          ? Math.round(catsToRender.reduce((s,c) => {
              const w2 = (c.monthBudget||0) / totalCatBudget2
              return s + (c.targetPrice||0) * w2
            }, 0))
          : 0

        const catCards = catsToRender.map(cat => {
          const color = getCategoryColorHex(cat.category_key)
          const targetP = cat.targetPrice || 0
          const monthBudget = cat.monthBudget || 0
          const catMonthAmt = cat.monthAmt || 0
          // 월 식단가: 백엔드 formula 계산값 우선, 없으면 mealCustomTotals 기반 폴백
          const catMonthMeals2 = cat.monthMeals !== undefined
            ? (cat.monthMeals || 0)
            : ((mealCustomTotals||{})[`cat_${cat.category_key}`] || 0)
          const monthDietPrice2 = cat.monthDietPrice !== undefined
            ? (cat.monthDietPrice || 0)
            : (catMonthMeals2 > 0 ? Math.round(catMonthAmt / catMonthMeals2) : 0)
          // 월 식단가 기준으로 초과/경고 판단
          const isOverM2 = targetP > 0 && monthDietPrice2 > targetP
          const isWarnM2 = targetP > 0 && monthDietPrice2 >= targetP * 0.9 && !isOverM2
          const priceColorM2 = isOverM2 ? '#dc2626' : isWarnM2 ? '#d97706' : color
          const prevTargetP = cat.prevTargetPrice || 0
          const budgetPct = monthBudget > 0 ? Math.round(catMonthAmt / monthBudget * 100) : null
          return `<div style="border:1px solid ${color}30;border-radius:10px;padding:8px 10px;background:${color}06;margin-bottom:6px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
              <div style="display:flex;align-items:center;gap:5px">
                <span style="width:9px;height:9px;border-radius:50%;background:${color};display:inline-block"></span>
                <span style="font-size:12px;font-weight:700;color:${color}">${cat.category_name}</span>
              </div>
              ${targetP > 0 ? `<span style="font-size:9px;color:#9ca3af">목표: ${fmt(targetP)}원/식</span>` : ''}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
              <div style="text-align:center;padding:5px;background:white;border-radius:7px;border:1px solid ${priceColorM2}30">
                <div style="font-size:8px;color:#9ca3af;margin-bottom:2px">월 식단가</div>
                <div style="font-size:13px;font-weight:900;color:${monthDietPrice2>0?priceColorM2:'#d1d5db'}">${monthDietPrice2>0?fmt(monthDietPrice2):'-'}</div>
                <div style="font-size:8px;color:#6b7280">원/식</div>
                ${isOverM2?`<div style="font-size:8px;color:#dc2626;font-weight:700">▲초과</div>`:isWarnM2?`<div style="font-size:8px;color:#d97706;font-weight:700">⚠주의</div>`:''}
              </div>
              <div style="text-align:center;padding:5px;background:white;border-radius:7px;border:1px solid ${color}20">
                <div style="font-size:8px;color:#9ca3af;margin-bottom:2px">월 발주</div>
                <div style="font-size:11px;font-weight:700;color:#374151">${fmtMan(catMonthAmt)}</div>
                <div style="font-size:8px;color:#9ca3af">예산 ${fmtMan(monthBudget)}</div>
              </div>
              <div style="text-align:center;padding:5px;background:${budgetPct!==null&&budgetPct>=100?'#fee2e2':budgetPct!==null&&budgetPct>=80?'#fef3c7':'white'};border-radius:7px;border:1px solid ${color}20">
                <div style="font-size:8px;color:#9ca3af;margin-bottom:2px">예산 달성</div>
                ${budgetPct !== null
                  ? `<div style="font-size:11px;font-weight:700;color:${budgetPct>=100?'#dc2626':budgetPct>=80?'#d97706':color}">${budgetPct}%</div>
                     <div style="font-size:8px;height:4px;background:#e5e7eb;border-radius:2px;overflow:hidden;margin-top:2px"><div style="height:100%;width:${Math.min(budgetPct,100)}%;background:${budgetPct>=100?'#dc2626':budgetPct>=80?'#f59e0b':color};border-radius:2px"></div></div>`
                  : `<div style="font-size:9px;color:#d1d5db">미설정</div>`
                }
              </div>
            </div>
            ${targetP > 0 && monthDietPrice2 > 0 ? `
            <div style="margin-top:5px;padding:4px 6px;background:${isOverM2?'#fee2e2':isWarnM2?'#fef3c7':'#f0fdf4'};border-radius:6px;display:flex;align-items:center;justify-content:space-between">
              <span style="font-size:9px;color:#6b7280">월 식단가 vs 목표</span>
              <span style="font-size:10px;font-weight:700;color:${priceColorM2}">${isOverM2?'▲ +'+fmt(monthDietPrice2-targetP)+'원 초과':'▼ '+fmt(targetP-monthDietPrice2)+'원 여유'}</span>
            </div>` : ''}
            ${prevTargetP > 0 ? `<div style="margin-top:4px;font-size:9px;color:#6b7280;display:flex;align-items:center;gap:4px;border-top:1px dashed ${color}20;padding-top:4px">
              <span>전월 목표:</span><span style="font-weight:600">${fmt(prevTargetP)}원</span>
              ${targetP > 0 && prevTargetP > 0 && targetP !== prevTargetP
                ? `<span style="color:${targetP>prevTargetP?'#dc2626':'#16a34a'}">${targetP>prevTargetP?'▲':'▼'} ${fmt(Math.abs(targetP-prevTargetP))}원 변동</span>`
                : ''}
            </div>` : ''}
          </div>`
        }).join('')
        return `<div style="border-top:1px solid #e5e7eb;margin-top:10px;padding-top:10px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span style="font-size:12px;font-weight:700;color:#374151"><i class="fas fa-layer-group" style="color:#8b5cf6;margin-right:4px;font-size:11px"></i>환자군별 식단가 현황</span>
            ${weightedTarget2 > 0 ? `<span style="font-size:10px;color:#6b7280">가중평균 목표: <strong style="color:#1f2937">${fmt(weightedTarget2)}원/식</strong></span>` : ''}
          </div>
          <div style="font-size:9px;color:#9ca3af;margin-bottom:6px"><i class="fas fa-info-circle"></i> 선택한 예산항목 ÷ 선택한 식수항목 기준 (카테고리별 계산 기준 적용)</div>
          ${catCards}
        </div>`
      })()}

      <!-- 가중평균 식단가 + 막대그래프 (A카드 바로 아래) -->
      ${catDietPricesData.length > 0 ? (() => {
        // ── 카테고리별 식단가 계산 (formula 기반) ──
        const isSingleCat = catDietPricesData.length === 1

        // 각 카테고리의 formula 식단가 산출
        const catPriceList = catDietPricesData.map(cat => {
          const monthDietPrice = cat.monthDietPrice !== undefined
            ? (cat.monthDietPrice || 0)
            : (() => {
                const m = cat.monthMeals !== undefined ? (cat.monthMeals||0) : ((mealCustomTotals||{})[`cat_${cat.category_key}`]||0)
                return m > 0 ? Math.round((cat.monthAmt||0) / m) : 0
              })()
          return { ...cat, _dietPrice: monthDietPrice }
        })

        // 활성(데이터 있는) 카테고리만 가중평균에 사용
        const activeCats = catPriceList.filter(c => c._dietPrice > 0)
        const totalBudgetW = activeCats.reduce((s,c) => s + (c.monthBudget||0), 0)
        const totalAmtW = activeCats.reduce((s,c) => s + c.monthAmt, 0)

        // ① 전체 식단가 (예산비중 가중평균, 예산 미설정 시 발주금액 비중 폴백)
        let dbWeightedCurrent = 0
        if (isSingleCat) {
          // 카테고리 1개: 해당 식단가 = 전체 식단가
          dbWeightedCurrent = catPriceList[0]._dietPrice
        } else if (totalBudgetW > 0) {
          // 카테고리 2개+: 예산 비중 가중평균 (핵심 수정)
          dbWeightedCurrent = Math.round(activeCats.reduce((s,c) => s + c._dietPrice * ((c.monthBudget||0) / totalBudgetW), 0))
        } else if (totalAmtW > 0) {
          // 예산 미설정 시: 발주금액 비중 가중평균 폴백
          dbWeightedCurrent = Math.round(activeCats.reduce((s,c) => s + c._dietPrice * (c.monthAmt / totalAmtW), 0))
        }

        // ② 목표 식단가 (예산 비중 가중평균)
        const catsWithTarget = catPriceList.filter(c => c.monthBudget > 0 && c.targetPrice > 0)
        const totalBudgetForTarget = catsWithTarget.reduce((s,c) => s + c.monthBudget, 0)
        let dbWeightedTarget = 0
        if (isSingleCat) {
          dbWeightedTarget = catPriceList[0]?.targetPrice || 0
        } else if (totalBudgetForTarget > 0) {
          dbWeightedTarget = Math.round(catsWithTarget.reduce((s,c) => s + c.targetPrice * (c.monthBudget / totalBudgetForTarget), 0))
        }

        const dbWDiff = dbWeightedCurrent > 0 && dbWeightedTarget > 0 ? dbWeightedCurrent - dbWeightedTarget : null
        const dbWOver = dbWDiff !== null && dbWDiff > 0
        const dbWWarn = dbWDiff !== null && !dbWOver && dbWeightedCurrent >= dbWeightedTarget * 0.9
        const dbWColor = dbWOver ? '#dc2626' : dbWWarn ? '#d97706' : '#16a34a'
        // 막대그래프
        const dbBarHtml = dbWeightedTarget > 0 && dbWeightedCurrent > 0 ? (() => {
          const maxV = Math.max(dbWeightedTarget, dbWeightedCurrent) * 1.15
          const tPct = Math.min(Math.round(dbWeightedTarget / maxV * 100), 100)
          const cPct = Math.min(Math.round(dbWeightedCurrent / maxV * 100), 100)
          const bColor = dbWOver ? '#dc2626' : dbWWarn ? '#d97706' : '#16a34a'
          return `<div style="margin-top:8px">
            <div style="display:flex;justify-content:space-between;font-size:10px;color:#6b7280;margin-bottom:4px">
              <span>목표 대비 현재</span>
              <span style="font-weight:700;color:${bColor}">${Math.round(dbWeightedCurrent/dbWeightedTarget*100)}%</span>
            </div>
            <div style="margin-bottom:4px">
              <div style="font-size:9px;color:#9ca3af;margin-bottom:2px">현재 <strong style="color:${bColor}">${fmt(dbWeightedCurrent)}원/식</strong></div>
              <div style="background:#e5e7eb;border-radius:4px;height:12px;position:relative;overflow:visible">
                <div style="height:100%;width:${cPct}%;background:${bColor};border-radius:4px"></div>
                <div style="position:absolute;top:-3px;left:${tPct}%;transform:translateX(-50%);width:2px;height:18px;background:#7c3aed;border-radius:1px"></div>
              </div>
            </div>
            <div>
              <div style="font-size:9px;color:#9ca3af;margin-bottom:2px">목표 <strong style="color:#7c3aed">${fmt(dbWeightedTarget)}원/식</strong> (▎마커)</div>
              <div style="background:#e5e7eb;border-radius:4px;height:8px">
                <div style="height:100%;width:${tPct}%;background:#c084fc;border-radius:4px"></div>
              </div>
            </div>
          </div>`
        })() : ''
        const panelTitle = isSingleCat ? `전체 식단가 (${catPriceList[0]?.category_name||''} 기준)` : '전체 식단가 (예산비중 가중평균)'
        const panelIcon  = isSingleCat ? 'fa-utensils' : 'fa-balance-scale'
        const panelDesc  = isSingleCat
          ? `${catPriceList[0]?.category_name||''} 발주금액 ÷ 설정 식수`
          : (totalBudgetW > 0
            ? activeCats.map(c => `${c.category_name} ${Math.round(((c.monthBudget||0)/totalBudgetW)*100)}%`).join(' + ') + ' (예산비중)'
            : activeCats.map(c => `${c.category_name} ${totalAmtW>0?Math.round((c.monthAmt/totalAmtW)*100):0}%`).join(' + ') + ' (발주비중)')
        return `<div class="mt-3 p-3 rounded-xl border" style="background:linear-gradient(135deg,#faf5ff,#f0f9ff);border-color:#c084fc40">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
            <span style="font-size:12px;font-weight:700;color:#7c3aed"><i class="fas ${panelIcon}" style="margin-right:4px"></i>${panelTitle}</span>
            ${dbWDiff!==null&&dbWeightedCurrent>0?`<span style="font-size:11px;font-weight:700;color:${dbWColor}">${dbWOver?'▲ +':'▼ '}${fmt(Math.abs(dbWDiff))}원 ${dbWOver?'초과':dbWWarn?'주의':'이내'}</span>`:''}
          </div>
          <div style="font-size:9px;color:#9ca3af;margin-bottom:6px">${panelDesc}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:0px">
            <div style="background:white;border-radius:8px;padding:10px;text-align:center;border:1px solid #e9d5ff">
              <div style="font-size:10px;color:#6b7280;margin-bottom:3px">목표</div>
              <div style="font-size:15px;font-weight:800;color:${dbWeightedTarget>0?'#7c3aed':'#d1d5db'}">${dbWeightedTarget>0?fmt(dbWeightedTarget)+'원/식':'미설정'}</div>
            </div>
            <div style="background:white;border-radius:8px;padding:10px;text-align:center;border:1px solid ${dbWeightedCurrent>0?dbWColor+'60':'#e5e7eb'}">
              <div style="font-size:10px;color:#6b7280;margin-bottom:3px">현재</div>
              <div style="font-size:15px;font-weight:800;color:${dbWeightedCurrent>0?dbWColor:'#d1d5db'}">${dbWeightedCurrent>0?fmt(dbWeightedCurrent)+'원/식':'미입력'}</div>
            </div>
          </div>
          ${dbBarHtml}
        </div>`
      })() : ''}

      <!-- 전월 대비 식단가 비교 -->
      ${pm.mealPriceTotal !== undefined ? `
      <div class="mt-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-bold text-gray-600"><i class="fas fa-exchange-alt mr-1 text-indigo-400"></i>전월(${pm.year}년 ${pm.month}월) 대비</span>
          <span class="text-xs text-gray-400">식단가 변동</span>
        </div>
        <div class="space-y-1.5">
          <div class="flex items-center justify-between text-xs">
            <span class="text-blue-600 font-medium">전체 식단가</span>
            <div class="flex items-center gap-2">
              <span class="text-gray-400">${pm.mealPriceTotal>0?fmt(pm.mealPriceTotal)+'원':'자료없음'}</span>
              <span class="text-gray-300">→</span>
              <span class="font-bold text-blue-700">${totalMeals>0?fmt(mealPriceTotal)+'원':'집계중'}</span>
              ${totalMeals>0&&pm.mealPriceTotal>0?mpDiff(mealPriceTotal,pm.mealPriceTotal):''}
            </div>
          </div>
          <div class="flex items-center justify-between text-xs">
            <span class="text-purple-600 font-medium">직원식 제외</span>
            <div class="flex items-center gap-2">
              <span class="text-gray-400">${pm.mealPriceNoStaff>0?fmt(pm.mealPriceNoStaff)+'원':'자료없음'}</span>
              <span class="text-gray-300">→</span>
              <span class="font-bold text-purple-700">${totalMeals>0?fmt(mealPriceNoStaff)+'원':'집계중'}</span>
              ${totalMeals>0&&pm.mealPriceNoStaff>0?mpDiff(mealPriceNoStaff,pm.mealPriceNoStaff):''}
            </div>
          </div>
          <div class="flex items-center justify-between text-xs">
            <span class="text-orange-600 font-medium">소모품 제외</span>
            <div class="flex items-center gap-2">
              <span class="text-gray-400">${pm.mealPriceNoSupply>0?fmt(pm.mealPriceNoSupply)+'원':'자료없음'}</span>
              <span class="text-gray-300">→</span>
              <span class="font-bold text-orange-700">${totalMeals>0?fmt(mealPriceNoSupply)+'원':'집계중'}</span>
              ${totalMeals>0&&pm.mealPriceNoSupply>0?mpDiff(mealPriceNoSupply,pm.mealPriceNoSupply):''}
            </div>
          </div>
          <div class="flex items-center justify-between text-xs pt-1 border-t border-gray-200">
            <span class="text-gray-500 font-medium">총 식수</span>
            <div class="flex items-center gap-2">
              <span class="text-gray-400">${pm.totalMeals>0?fmt(pm.totalMeals)+'식':'자료없음'}</span>
              <span class="text-gray-300">→</span>
              <span class="font-bold text-gray-700">${fmt(totalMeals)}식</span>
              ${pm.totalMeals>0?mpDiff(totalMeals,pm.totalMeals):''}
            </div>
          </div>

        </div>
      </div>` : ''}

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
  const vendorCatData = {}
  vendors.forEach(v => {
    if (v.total_used > 0) {
      const cat = getCategoryLabel(v.category)
      vendorCatData[cat] = (vendorCatData[cat] || 0) + v.total_used
    }
  })
  const ctx2 = document.getElementById('vendorPieChart')
  if (ctx2 && Object.keys(vendorCatData).length > 0) {
    App.charts.pie = new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels: Object.keys(vendorCatData),
        datasets: [{ data: Object.values(vendorCatData), backgroundColor: ['#16a34a','#15803d','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899'] }]
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

  const [vendors, orderData, settingsData, dashData, patientCats, catOrderData] = await Promise.all([
    api('GET', '/api/vendors'),
    api('GET', `/api/orders/${App.currentYear}/${App.currentMonth}`),
    api('GET', `/api/settings/${App.currentYear}/${App.currentMonth}`),
    api('GET', `/api/dashboard/summary/${App.currentYear}/${App.currentMonth}`),
    api('GET', '/api/orders/patient-categories'),
    api('GET', `/api/orders/category-monthly/${App.currentYear}/${App.currentMonth}`)
  ])

  if (!vendors) { content.innerHTML = '<div class="text-red-500 p-6">데이터 로드 실패</div>'; return }

  // 환자군 카테고리 전역 저장
  window._patientCats = patientCats || []
  window._catOrderSettings = (catOrderData?.settings) || []
  window._catTodayMeals = catOrderData?.todayMeals || { patient_total: 0, staff_total: 0, guardian_total: 0 }
  window._catPrevSettings = catOrderData?.prevSettings || []
  // 발주 페이지에서 직접 접근 시 catDietPricesData 초기화 (대시보드 미방문 대비)
  if (!window._catDietPricesData || window._catDietPricesData.length === 0) {
    window._catDietPricesData = dashData?.catDietPrices || []
  }

  const days = getDaysInMonth(App.currentYear, App.currentMonth)
  const orderMap = {}
  ;(orderData || []).forEach(o => {
    if (!orderMap[o.order_date]) orderMap[o.order_date] = {}
    orderMap[o.order_date][o.vendor_id] = o
  })

  const settings = settingsData?.settings || {}
  const totalBudget = settings.total_budget || 0
  // working_days: 관리자 설정값 우선, 미설정 시 22일(평균 영업일) 사용
  // 설정된 working_days가 없으면 일 예산을 계산할 수 없어 진행률이 의미없으므로
  // totalBudget이 있을 때만 dailyBudget 계산
  const workingDays = settings.working_days || 0
  const dailyBudget = (totalBudget > 0 && workingDays > 0) ? Math.round(totalBudget / workingDays) : 0
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

  // ── 카테고리별 금액 계산 (A안+B안용) ──
  const catSettings2 = catOrderData?.settings || []
  const catDailyData = catOrderData?.dailyByVendorCat || []  // flat 배열
  const hasCatsData = (patientCats||[]).length > 0

  // 카테고리별 월 합계 (monthly 집계에서)
  const catMonthTotals = {}  // { catId: amount }
  const catTodayTotals = {}
  const catWeekTotals  = {}
  ;(catOrderData?.monthly || []).forEach(r => {
    catMonthTotals[r.patient_category_id] = (catMonthTotals[r.patient_category_id]||0) + (r.total||0)
  })
  // dailyByVendorCat(flat 배열) 순회로 오늘/주간 카테고리 합계
  ;(catDailyData).forEach(r => {
    const dateStr2 = r.order_date
    const od2 = new Date(dateStr2)
    const isToday2 = dateStr2 === todayStr
    const isThisWeek2 = od2 >= weekStart && od2 <= weekEnd
    const catId = r.patient_category_id
    const amt = r.total || 0
    if (isToday2)    catTodayTotals[catId] = (catTodayTotals[catId]||0) + amt
    if (isThisWeek2) catWeekTotals[catId]  = (catWeekTotals[catId]||0)  + amt
  })

  // 금액 계산 (카테고리 모드일 때는 catDailyData 합산, 아닐 때는 orderData 사용)
  const catMonthTotal = catDailyData.reduce((s, r) => s + (r.total || 0), 0)
  const normalMonthTotal = (orderData||[]).reduce((s,o) => s+(o.total_amount||0), 0)
  const monthTotal = hasCatsData ? catMonthTotal : normalMonthTotal

  let catTodayTotal = 0, catWeekTotal = 0
  catDailyData.forEach(r => {
    if (r.order_date === todayStr) catTodayTotal += r.total || 0
    const od = new Date(r.order_date)
    if (od >= weekStart && od <= weekEnd) catWeekTotal += r.total || 0
  })
  let normalTodayTotal = 0, normalWeekTotal = 0
  ;(orderData||[]).forEach(o => {
    if (o.order_date === todayStr) normalTodayTotal += o.total_amount||0
    const od = new Date(o.order_date)
    if (od >= weekStart && od <= weekEnd) normalWeekTotal += o.total_amount||0
  })
  const todayTotal = hasCatsData ? catTodayTotal : normalTodayTotal
  const weekTotal  = hasCatsData ? catWeekTotal  : normalWeekTotal

  // 주간 예산 = 일일예산 × 5일(영업일)
  const weekBudget = dailyBudget * 5

  // ── 이번 달 주차별 계산 (1주~5주) ──
  const weeklyData = []
  const seenWeeks = new Set()
  for (let d = 1; d <= days; d++) {
    const ds = `${App.currentYear}-${String(App.currentMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    const dObj = new Date(ds)
    const mon = new Date(dObj); mon.setDate(dObj.getDate() - (dObj.getDay()===0?6:dObj.getDay()-1))
    const sun = new Date(mon); sun.setDate(mon.getDate()+6)
    const wk = mon.toISOString().split('T')[0]
    if (seenWeeks.has(wk)) continue
    seenWeeks.add(wk)
    const wkEnd = sun.toISOString().split('T')[0]
    // 카테고리 모드이면 catDailyData에서 주합계 계산, 아니면 orderData 사용
    let wTotal = 0
    if (hasCatsData) {
      wTotal = catDailyData.filter(r => r.order_date >= wk && r.order_date <= wkEnd).reduce((s,r) => s+(r.total||0), 0)
    } else {
      wTotal = (orderData||[]).filter(o=>o.order_date>=wk&&o.order_date<=wkEnd).reduce((s,o)=>s+(o.total_amount||0),0)
    }
    const wPct = weekBudget>0?Math.round(wTotal/weekBudget*100):0
    // 이번 주 여부
    const isCurWeek = todayStr>=wk && todayStr<=wkEnd
    weeklyData.push({ wk, wkEnd, wTotal, wPct, isCurWeek })
  }

  const monthPct = totalBudget > 0 ? Math.round(monthTotal / totalBudget * 100) : 0
  const todayPct = dailyBudget > 0 ? Math.round(todayTotal / dailyBudget * 100) : 0
  const weekPct = weekBudget > 0 ? Math.round(weekTotal / weekBudget * 100) : 0

  function pctColor(p) { return p >= 100 ? 'text-red-600' : p >= 80 ? 'text-yellow-600' : 'text-green-700' }
  function barColor(p) { return p >= 100 ? 'progress-red' : p >= 80 ? 'progress-yellow' : 'progress-green' }

  // 초기 식수 합계: 직원+보호자+환자군 커스텀 필드 (ea 제외, 비급여 제외)
  const initMealCustomFields = dashData?.mealCustomFields || []
  const initMealCustomTotals = dashData?.mealCustomTotals || {}
  const initCustomMealSum = initMealCustomFields
    .filter(f => (f.unit_type||'meal') !== 'ea')
    .reduce((s, f) => s + (Number(initMealCustomTotals[f.field_key]) || 0), 0)
  const initTotalMeals = (mealStats.total_staff||0) + (mealStats.total_guardian||0) + initCustomMealSum

  content.innerHTML = `
  <!-- ── 식단가 실시간 패널 ── -->
  <div id="mealPricePanel" class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4">
    <div class="flex items-center justify-between mb-3">
      <h3 class="font-bold text-gray-700 text-sm"><i class="fas fa-utensils text-blue-500 mr-1"></i>실시간 식단가</h3>
      <span class="text-xs text-gray-400">식수: <strong id="realMealCount">${fmt(initTotalMeals)}</strong>식</span>
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
    ${(() => {
      // 카테고리별 실시간 식단가 섹션
      const cats = patientCats || []
      if (cats.length === 0) return ''
      const todayMeals2 = catOrderData?.todayMeals || { patient_total: 0 }
      const totalPatientMeals = todayMeals2.patient_total || 0
      // 카테고리 설정 맵 (target_meal_price 포함)
      const catSetMap = {}
      ;(catOrderData?.settings || []).forEach(s => { catSetMap[s.patient_category_id] = s })
      const prevSetMap = {}
      ;(catOrderData?.prevSettings || []).forEach(s => { prevSetMap[s.patient_category_id] = s })

      // 가중평균 목표 식단가 계산 (예산 비중 기반)
      const isSingleCatOrd = cats.length === 1
      const totalMonthBudget = cats.reduce((s,c) => s + (catSetMap[c.id]?.monthly_budget||0), 0)
      const weightedTarget = isSingleCatOrd
        ? (catSetMap[cats[0]?.id]?.target_meal_price || 0)
        : (totalMonthBudget > 0
          ? Math.round(cats.reduce((s,c) => {
              const w = (catSetMap[c.id]?.monthly_budget||0) / totalMonthBudget
              return s + (catSetMap[c.id]?.target_meal_price||0) * w
            }, 0))
          : 0)

      const catRows = cats.map(cat => {
        const color = getCategoryColorHex(cat.category_key)
        const s = catSetMap[cat.id] || {}
        const targetPrice = s.target_meal_price || 0
        // 월 발주금액: window._catDietPricesData (대시보드에서 로드한 catDietPrices)
        const dcEntry = (window._catDietPricesData||[]).find(d => d.id === cat.id)
        const initMonthAmt = dcEntry?.monthAmt || 0
        // 월 식수: formula 기반 (백엔드 monthMeals 우선, 없으면 폴백)
        const initMonthMeals = dcEntry?.monthMeals !== undefined
          ? (dcEntry.monthMeals || 0)
          : ((dashData?.mealCustomTotals||{})[`cat_${cat.category_key}`] || 0)
        // 월 식단가: formula 기반 (백엔드 monthDietPrice 우선)
        const initMonthPrice = dcEntry?.monthDietPrice !== undefined
          ? (dcEntry.monthDietPrice || 0)
          : (initMonthAmt > 0 && initMonthMeals > 0 ? Math.round(initMonthAmt / initMonthMeals) : 0)
        // 초기 목표 대비 계산
        const initIsOver = targetPrice > 0 && initMonthPrice > targetPrice
        const initIsWarn = targetPrice > 0 && initMonthPrice >= targetPrice * 0.9 && !initIsOver
        const initPriceColor = initIsOver ? '#dc2626' : initIsWarn ? '#d97706' : color
        const initDiffHtml = initMonthPrice > 0 && targetPrice > 0
          ? (initIsOver
              ? `<span style="color:#dc2626;font-size:10px">▲ +${fmt(initMonthPrice-targetPrice)}원</span><div style="font-size:8px;color:#9ca3af">목표: ${fmt(targetPrice)}원</div>`
              : `<span style="color:#16a34a;font-size:10px">▼ ${fmt(targetPrice-initMonthPrice)}원</span><div style="font-size:8px;color:#9ca3af">목표: ${fmt(targetPrice)}원</div>`)
          : (targetPrice > 0 ? `<div style="font-size:8px;color:#9ca3af">목표: ${fmt(targetPrice)}원</div>` : '<span style="font-size:9px;color:#d1d5db">미설정</span>')
        return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;background:${color}0d;border:1px solid ${color}30;margin-bottom:6px">
          <div style="display:flex;align-items:center;gap:4px;min-width:50px">
            <span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0"></span>
            <span style="font-size:11px;font-weight:700;color:${color}">${cat.category_name}</span>
          </div>
          <div style="flex:1;display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;align-items:center">
            <div style="text-align:center">
              <div style="font-size:8px;color:#9ca3af;margin-bottom:1px">월 발주</div>
              <div id="cat-mp-amt-${cat.id}" style="font-size:12px;font-weight:700;color:${color}">${initMonthAmt>0?fmtMan(initMonthAmt):'-'}</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:8px;color:#9ca3af;margin-bottom:1px">월 식단가</div>
              <div id="cat-mp-price-${cat.id}" style="font-size:13px;font-weight:900;color:${initMonthPrice>0?initPriceColor:color}">${initMonthPrice>0?fmt(initMonthPrice):'-'}</div>
              <div style="font-size:8px;color:#6b7280">원/식</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:8px;color:#9ca3af;margin-bottom:1px">목표 대비</div>
              <div id="cat-mp-diff-${cat.id}" style="font-size:10px;font-weight:700;color:#9ca3af">
                ${initDiffHtml}
              </div>
            </div>
          </div>
          <div style="text-align:right;min-width:36px">
            <div style="font-size:8px;color:#9ca3af">식수</div>
            <div id="cat-mp-meals-${cat.id}" style="font-size:10px;font-weight:600;color:#374151">${initMonthMeals > 0 ? fmt(initMonthMeals)+'식' : '-'}</div>
          </div>
        </div>`
      }).join('')

      return `<div style="border-top:1px solid #e5e7eb;margin-top:10px;padding-top:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-size:11px;font-weight:700;color:#374151"><i class="fas fa-layer-group" style="color:#8b5cf6;margin-right:4px"></i>환자군별 월 식단가</span>
          ${weightedTarget > 0 ? `<span style="font-size:10px;color:#6b7280">가중평균 목표: <strong style="color:#1f2937">${fmt(weightedTarget)}원/식</strong></span>` : ''}
        </div>
        <div style="font-size:9px;color:#9ca3af;margin-bottom:6px;display:flex;align-items:center;gap:4px">
          <i class="fas fa-info-circle"></i> 선택한 예산항목 ÷ 선택한 식수항목 기준
        </div>
        ${catRows}
      </div>`
    })()}
  </div>

  <!-- ── 예산 진행률 실시간 패널 ── -->
  ${(() => {
    // ── 카드 생성 헬퍼 ──
    function miniCard(id, label, pct, amt, budget, barId, amtId, pctId, isCurrent=false, isToday=false) {
      const isOver = pct>=100, isWarn = pct>=80&&!isOver
      // 오늘 일별 카드는 파란 계열 강조
      const borderColor = isOver?'#ef4444':isWarn?'#f59e0b':(isToday?'#2563eb':'#16a34a')
      const borderW = (isCurrent||isToday) ? '3px' : '2px'
      const bgColor = isOver?'#fff1f2':isWarn?'#fffbeb':(isToday?'#eff6ff':(isCurrent?'#f0fdf4':'#f8fafc'))
      const pctColor = isOver?'#dc2626':isWarn?'#d97706':(isToday?'#1d4ed8':'#16a34a')
      const pctSize = isToday ? (isOver||isWarn?'30px':'26px') : (isCurrent ? (isOver||isWarn?'26px':'20px') : (isOver||isWarn?'22px':'17px'))
      const barFill = isOver?'#dc2626':isWarn?'#f59e0b':(isToday?'#3b82f6':'#16a34a')
      const barBg = isOver?'#fee2e2':isWarn?'#fef3c7':(isToday?'#dbeafe':'#dcfce7')
      const badge = isOver
        ? `<span style="background:#dc2626;color:white;font-size:9px;font-weight:700;padding:1px 5px;border-radius:10px;margin-left:3px">🚨초과</span>`
        : isWarn
        ? `<span style="background:#f59e0b;color:white;font-size:9px;font-weight:700;padding:1px 5px;border-radius:10px;margin-left:3px">⚠️주의</span>`
        : ''
      const shadow = (isCurrent||isToday) ? 'box-shadow:0 4px 14px rgba(0,0,0,0.13);' : ''
      const curLabel = isCurrent && !isToday ? `<span style="font-size:8px;background:${isOver?'#dc2626':isWarn?'#f59e0b':'#16a34a'};color:white;padding:1px 5px;border-radius:8px;margin-left:4px;vertical-align:middle">이번주</span>` : ''
      const todaySubLabel = isToday ? `<div style="font-size:9px;color:${isOver?'#dc2626':isWarn?'#d97706':'#3b82f6'};font-weight:700;margin-top:1px">일 발주 진행률</div>` : ''
      const labelSize = isToday ? '13px' : (isCurrent?'12px':'11px')
      return `<div id="${id}-card" style="border-radius:12px;padding:${(isCurrent||isToday)?'13px 14px':'10px 12px'};transition:all 0.3s;background:${bgColor};border:${borderW} solid ${borderColor};${shadow}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:${isToday?'2px':'4px'}">
          <div>
            <span style="font-size:${labelSize};font-weight:700;color:#374151">${label}${curLabel}</span>
            ${todaySubLabel}
          </div>
          ${badge}
        </div>
        <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:6px">
          <span id="${pctId}" style="font-size:${pctSize};font-weight:900;line-height:1;color:${pctColor}">${pct}%</span>
          <div style="text-align:right">
            <div style="font-size:9px;color:#9ca3af">발주액</div>
            <div id="${amtId}" style="font-size:${(isCurrent||isToday)?'12px':'11px'};font-weight:700;color:#374151">${fmtWon(amt)}</div>
          </div>
        </div>
        <div style="background:${barBg};border-radius:4px;height:${isToday?'8px':'6px'};overflow:hidden;margin-bottom:4px">
          <div id="${barId}" style="height:100%;border-radius:4px;background:${barFill};width:${Math.min(pct,100)}%;transition:width 0.4s"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:${isToday?'10px':'9px'};color:${isToday?'#6b7280':'#9ca3af'};font-weight:${isToday?'600':'400'}">목표</span>
          <span style="font-size:${(isCurrent||isToday)?'12px':'10px'};font-weight:800;color:${isToday?'#1e40af':'#1f2937'}">${fmtWon(budget)}</span>
        </div>
      </div>`
    }

    // ── 카테고리 비율 섹션 생성 헬퍼 (A안 + B안) ──
    const hasCats2 = (patientCats||[]).length > 0
    function makeCatSection(catTotalsMap, catBudgetsMap, periodLabel) {
      if (!hasCats2) return ''
      const cats = patientCats || []
      const grandAmt = cats.reduce((s,c) => s+(catTotalsMap[c.id]||0), 0)
      const rows = cats.map(cat => {
        const color = getCategoryColorHex(cat.category_key)
        const amt = catTotalsMap[cat.id] || 0
        const budget = catBudgetsMap[cat.id] || 0
        // A안: 실적 비율 (전체 발주 중 이 카테고리 비중)
        const aPct = grandAmt > 0 ? Math.round(amt/grandAmt*100) : 0
        // B안: 예산 달성률 (카테고리 목표 대비)
        const bPct = budget > 0 ? Math.round(amt/budget*100) : null
        const bColor = bPct===null?'#9ca3af':bPct>=100?'#dc2626':bPct>=80?'#d97706':color
        return `<div style="display:flex;align-items:center;gap:5px;margin-bottom:5px">
          <span style="display:inline-block;background:${color};color:white;font-size:8px;font-weight:700;padding:1px 5px;border-radius:8px;min-width:28px;text-align:center;white-space:nowrap">${cat.category_name}</span>
          <div style="flex:1;display:flex;flex-direction:column;gap:2px">
            <div style="display:flex;align-items:center;gap:3px">
              <div style="flex:1;height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden">
                <div id="catABar-${periodLabel}-${cat.id}" style="height:100%;width:${aPct}%;background:${color};border-radius:3px;transition:width 0.4s"></div>
              </div>
              <span id="catAPct-${periodLabel}-${cat.id}" style="font-size:9px;color:${color};font-weight:700;min-width:26px;text-align:right">${aPct}%</span>
              <span style="font-size:8px;color:#9ca3af">점유</span>
            </div>
            ${bPct!==null?`<div style="display:flex;align-items:center;gap:3px">
              <div style="flex:1;height:4px;background:#e5e7eb;border-radius:2px;overflow:hidden">
                <div id="catBBar-${periodLabel}-${cat.id}" style="height:100%;width:${Math.min(bPct,100)}%;background:${bColor};border-radius:2px;transition:width 0.4s"></div>
              </div>
              <span id="catBPct-${periodLabel}-${cat.id}" style="font-size:9px;color:${bColor};font-weight:700;min-width:26px;text-align:right">${bPct}%</span>
              <span style="font-size:8px;color:#9ca3af">달성</span>
            </div>`:
            `<div style="font-size:8px;color:#d1d5db;padding-top:1px">예산 미설정</div>`}
          </div>
          <div style="text-align:right;min-width:46px">
            <div id="catAmt-${periodLabel}-${cat.id}" style="font-size:9px;font-weight:700;color:${color}">${fmtMan(amt)}</div>
            ${budget>0?`<div style="font-size:8px;color:#9ca3af">${fmtMan(budget)}</div>`:''}
          </div>
        </div>`
      }).join('')
      return `<div style="border-top:1px dashed #e5e7eb;margin-top:6px;padding-top:6px">
        <div style="font-size:9px;font-weight:700;color:#6b7280;margin-bottom:5px;display:flex;align-items:center;gap:3px">
          <i class="fas fa-chart-bar" style="color:#8b5cf6;font-size:8px"></i> 환자군별 비중·달성률
        </div>
        ${rows}
      </div>`
    }

    // 카테고리별 예산 (일별/주별/월별)
    const catMonthBudgets = {}
    const catDailyBudgets = {}
    const catWeekBudgets  = {}
    ;(catSettings2||[]).forEach(s => {
      const id = s.patient_category_id
      catMonthBudgets[id] = s.monthly_budget || 0
      catDailyBudgets[id] = s.working_days > 0 ? Math.round((s.monthly_budget||0)/s.working_days) : 0
      catWeekBudgets[id]  = catDailyBudgets[id] * 5
    })

    // 각 카드에 카테고리 섹션 삽입하기 위해 miniCardWithCats 헬퍼
    function miniCardWithCats(id, label, pct, amt, budget, barId, amtId, pctId, isCurrent, isToday, catTotalsMap, catBudgetsMap, periodLbl) {
      const base = miniCard(id, label, pct, amt, budget, barId, amtId, pctId, isCurrent, isToday)
      const catSection = makeCatSection(catTotalsMap, catBudgetsMap, periodLbl)
      // base의 닫는 </div> 직전에 삽입
      return base.replace(/(<\/div>)\s*$/, catSection + '$1')
    }

    // 주차 카드들
    const weekCards = weeklyData.map((w,i) => {
      const lbl = `${i+1}주 (${w.wk.slice(5).replace('-','/')}~${w.wkEnd.slice(5).replace('-','/')})`
      return miniCardWithCats(`week${i+1}`, lbl, w.wPct, w.wTotal, weekBudget, `weekBar${i+1}`, `weekAmt${i+1}`, `weekPct${i+1}`, w.isCurWeek, false, catWeekTotals, catWeekBudgets, `w${i+1}`)
    }).join('')

    return `
    <div id="budgetProgressPanel" style="background:white;border-radius:16px;box-shadow:0 2px 8px rgba(0,0,0,0.06);border:1px solid #e5e7eb;padding:16px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="font-weight:700;color:#374151;font-size:14px"><i class="fas fa-tachometer-alt" style="color:#16a34a;margin-right:4px"></i>예산 달성 현황 (실시간)</h3>
        <span style="font-size:11px;color:#9ca3af">${App.currentYear}년 ${App.currentMonth}월 | 월 총예산 <strong style="color:#374151">${fmtWon(totalBudget)}</strong></span>
      </div>

      <!-- 일별 + 월별 카드 (2열) -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        ${miniCardWithCats('today','📅 오늘 일별 발주',todayPct,todayTotal,dailyBudget,'todayBar','todayAmt','todayPct',false,true, catTodayTotals, catDailyBudgets, 'today')}
        ${miniCardWithCats('month','🗓️ 월별 발주',monthPct,monthTotal,totalBudget,'monthBar','monthAmt','monthPct',false,false, catMonthTotals, catMonthBudgets, 'month')}
      </div>

      <!-- 주차별 카드 -->
      <div style="border-top:1px solid #e5e7eb;padding-top:10px">
        <div style="font-size:11px;font-weight:700;color:#6b7280;margin-bottom:8px">📆 주차별 발주 현황</div>
        <div id="weeklyCardsGrid" style="display:grid;grid-template-columns:repeat(${weeklyData.length},1fr);gap:8px">
          ${weekCards}
        </div>
      </div>
    </div>`
  })()}

  <div class="bg-white rounded-2xl shadow-sm border border-gray-100" style="overflow:visible;min-width:0">
    <div class="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
      <div>
        <h2 class="font-bold text-gray-800 text-sm md:text-base">${App.currentYear}년 ${App.currentMonth}월 발주 입력</h2>
        <p class="text-xs text-gray-400 mt-0.5 hidden md:block">입력 후 자동 저장됨 | 수동 저장은 저장 버튼 클릭</p>
      </div>
      <div class="flex gap-1.5 flex-wrap">
        <button onclick="saveAllOrders()" class="btn btn-success btn-sm">
          <i class="fas fa-save"></i> <span class="hidden sm:inline">전체 </span>저장
        </button>
        ${window._patientCats && window._patientCats.length > 0 ? '' : `
        <button onclick="openCategorySetupGuide()" class="btn btn-sm" style="background:#f3e8ff;color:#7c3aed;border:1px solid #d8b4fe">
          <i class="fas fa-layer-group"></i> <span class="hidden sm:inline">칸 생성</span>
        </button>`}
        <button onclick="showQuickMultiDay()" class="btn btn-primary btn-sm">
          <i class="fas fa-calendar-plus"></i> <span class="hidden sm:inline">다수일 </span>발주
        </button>
        <button onclick="refreshOrders()" class="btn btn-secondary btn-sm">
          <i class="fas fa-sync"></i>
        </button>
      </div>
    </div>
    
    <!-- 월별 업체 합계 요약 -->
    <div class="px-3 py-2 border-b border-gray-100 bg-gray-50" style="-webkit-overflow-scrolling:touch">
      <!-- 등록 업체 칩 목록 -->
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        <span style="font-size:10px;font-weight:700;color:#6b7280;white-space:nowrap"><i class="fas fa-store" style="color:#3b82f6;margin-right:3px"></i>등록 업체</span>
        ${vendors.map(v => {
          const taxLabel = v.tax_type==='mixed'?'과+면':v.tax_type==='taxable'?'과세':'면세'
          const taxBg = v.tax_type==='mixed'?'#dbeafe':v.tax_type==='taxable'?'#dcfce7':'#fef9c3'
          const taxColor = v.tax_type==='mixed'?'#1d4ed8':v.tax_type==='taxable'?'#166534':'#92400e'
          return `<span style="display:inline-flex;align-items:center;gap:3px;background:white;border:1px solid #e5e7eb;border-radius:20px;padding:2px 8px;font-size:10px;font-weight:600;color:#374151;cursor:pointer;white-space:nowrap" onclick="openTodayDetailForVendor(${v.id})" title="클릭하면 오늘 발주 입력 열기">
            ${v.name}
            <span style="background:${taxBg};color:${taxColor};font-size:8px;padding:0 3px;border-radius:4px;font-weight:700">${taxLabel}</span>
          </span>`
        }).join('')}
      </div>
      <!-- 업체별 카드 (진행률 바 포함) -->
      <div class="overflow-x-auto" style="-webkit-overflow-scrolling:touch">
      <div class="flex gap-2 min-w-max text-xs" id="vendorSummaryRow">
        ${vendors.map(v => {
          const vOrders = (orderData || []).filter(o => o.vendor_id === v.id)
          const vTotal = vOrders.reduce((s, o) => s + (o.total_amount || 0), 0)
          const pctNum = v.monthly_budget > 0 ? Math.round(vTotal / v.monthly_budget * 100) : null
          const over = pctNum !== null && pctNum >= 100
          const warn = pctNum !== null && pctNum >= 80 && !over
          const remain = v.monthly_budget > 0 ? v.monthly_budget - vTotal : null
          const barColor = over ? '#dc2626' : warn ? '#d97706' : '#16a34a'
          const borderColor = over ? '#fca5a5' : warn ? '#fcd34d' : '#d1fae5'
          const taxLabel = v.tax_type==='mixed'?'과+면':v.tax_type==='taxable'?'과세':'면세'
          return `<div id="vsum-${v.id}" style="min-width:100px;background:white;border-radius:10px;border:1px solid ${borderColor};padding:8px 10px;cursor:pointer;transition:box-shadow 0.15s" onclick="openTodayDetailForVendor(${v.id})" title="클릭 → 오늘 발주 입력">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">
              <span style="font-size:10px;font-weight:700;color:#1f2937;white-space:nowrap;max-width:72px;overflow:hidden;text-overflow:ellipsis">${v.name}</span>
              <span style="font-size:8px;padding:0 3px;border-radius:4px;background:${v.tax_type==='mixed'?'#dbeafe':v.tax_type==='taxable'?'#dcfce7':'#fef9c3'};color:${v.tax_type==='mixed'?'#1d4ed8':v.tax_type==='taxable'?'#166534':'#92400e'};font-weight:700">${taxLabel}</span>
            </div>
            <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:2px">
              <span class="vsum-amt" style="font-size:12px;font-weight:800;color:${barColor}">${fmtMan(vTotal)}</span>
              ${pctNum !== null ? `<span class="vsum-pct" style="font-size:10px;font-weight:700;color:${barColor}">${pctNum}%${over?' 🚨':warn?' ⚠️':''}</span>` : '<span class="vsum-pct"></span>'}
            </div>
            ${v.monthly_budget > 0 ? `
            <div style="height:5px;background:#e5e7eb;border-radius:3px;overflow:hidden;margin-bottom:3px">
              <div style="height:100%;width:${Math.min(pctNum||0,100)}%;background:${barColor};border-radius:3px;transition:width 0.4s"></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:9px;color:#9ca3af">
              <span>목표 ${fmtMan(v.monthly_budget)}</span>
              <span style="color:${remain<0?'#dc2626':'#6b7280'}">${remain<0?'초과 '+fmtMan(Math.abs(remain)):'잔여 '+fmtMan(remain)}</span>
            </div>` : `<div style="font-size:9px;color:#d1d5db;text-align:center">목표 미설정</div>`}
          </div>`
        }).join('')}
        <div style="min-width:90px;background:#f0fdf4;border-radius:10px;border:1px solid #d1fae5;padding:8px 10px">
          <div style="font-size:10px;font-weight:700;color:#166534;margin-bottom:3px">월 합계</div>
          <div class="font-bold text-green-700" id="monthTotalDisplay" style="font-size:13px;font-weight:800">${fmtMan((orderData||[]).reduce((s,o)=>s+(o.total_amount||0),0))}</div>
          ${totalBudget > 0 ? `<div style="font-size:10px;font-weight:700;color:${monthPct>=100?'#dc2626':monthPct>=80?'#d97706':'#16a34a'}" id="monthPctDisplay">${monthPct}%</div>` : ''}
          ${totalBudget > 0 ? `<div style="height:5px;background:#e5e7eb;border-radius:3px;margin-top:3px;overflow:hidden"><div style="height:100%;width:${Math.min(monthPct,100)}%;background:${monthPct>=100?'#dc2626':monthPct>=80?'#d97706':'#16a34a'};border-radius:3px"></div></div>` : ''}
        </div>
      </div>
      </div>
    </div>

    <!-- ── 인사이트 패널: 월 예산 예측 + 업체 비중 + 식단가 경고 ── -->
    <div id="ordersInsightPanel" style="background:white;border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,0.06);border:1px solid #e5e7eb;padding:14px 16px;margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;cursor:pointer" onclick="toggleInsightPanel()">
        <div style="display:flex;align-items:center;gap:6px">
          <i class="fas fa-chart-pie" style="color:#8b5cf6;font-size:14px"></i>
          <span style="font-size:13px;font-weight:700;color:#1f2937">발주 현황 인사이트</span>
        </div>
        <span id="insightPanelArrow" style="font-size:12px;color:#9ca3af">▼</span>
      </div>
      <div id="insightPanelBody">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <!-- 월 예산 초과 예측 -->
          <div id="budgetForecastCard" style="background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;padding:10px">
            <div style="font-size:10px;font-weight:700;color:#6b7280;margin-bottom:6px;display:flex;align-items:center;gap:4px">
              <i class="fas fa-calculator" style="color:#f59e0b"></i> 월 예산 예측
            </div>
            <div id="budgetForecastContent">
              <div style="font-size:10px;color:#9ca3af">데이터 계산 중...</div>
            </div>
            <div id="budgetForecastWarn" style="display:none"></div>
          </div>
          <!-- 식단가 경고 -->
          <div id="dietPriceAlertCard" style="background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;padding:10px">
            <div style="font-size:10px;font-weight:700;color:#6b7280;margin-bottom:6px;display:flex;align-items:center;gap:4px">
              <i class="fas fa-utensils" style="color:#10b981"></i> 식단가 현황
            </div>
            <div id="dietPriceAlertContent">
              <div style="font-size:10px;color:#9ca3af">데이터 계산 중...</div>
            </div>
          </div>
        </div>
        <!-- 업체 발주 비중 -->
        <div id="vendorShareCard" style="margin-top:10px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;padding:10px">
          <div style="font-size:10px;font-weight:700;color:#6b7280;margin-bottom:6px;display:flex;align-items:center;gap:4px">
            <i class="fas fa-store" style="color:#3b82f6"></i> 업체별 발주 비중
          </div>
          <div id="vendorShareContent">
            <div style="font-size:10px;color:#9ca3af">데이터 계산 중...</div>
          </div>
          <div id="vendorBiasAlert" style="display:none"></div>
        </div>
      </div>
    </div>

    <div class="orders-scroll-wrap" id="ordersScrollWrap" style="position:relative;padding-bottom:0">
      <!-- 모바일 스크롤 안내 -->
      <div class="scroll-hint">
        <i class="fas fa-arrows-left-right"></i>좌우로 스크롤하여 전체 발주 입력
      </div>
      <!-- 가로 스크롤 컨테이너 -->
      <div id="ordersTableScroller" style="overflow-x:auto;overflow-y:visible;width:100%;max-width:100%;-webkit-overflow-scrolling:touch;scroll-behavior:smooth">
      <table class="order-table" id="ordersTable" style="table-layout:auto;border-collapse:collapse;width:100%;min-width:max-content">
        <thead style="position:sticky;top:0;z-index:20">
          <tr>
            <th class="sticky left-0 z-30 bg-gray-800" style="width:30px;min-width:30px;padding:4px 2px">일</th>
            <th class="sticky z-30 bg-gray-800" style="width:24px;min-width:24px;left:30px;padding:4px 2px">요</th>
            <th class="sticky z-30 bg-gray-800" style="width:56px;min-width:56px;left:54px;font-size:9px;padding:4px 2px" title="몇 일분 발주인지 선택합니다. 예: 2일 선택 시 일 목표금액×2 기준으로 진행률 계산">몇일분<br><span style="font-size:8px;opacity:0.8">발주</span></th>
            ${patientCats.map((cat, ci) => {
              const catColor = getCategoryColorHex(cat.category_key)
              const bl = ci === 0 ? 'border-left:3px solid #334155;' : 'border-left:2px solid #475569;'
              return `<th style="${bl}min-width:76px;background:${catColor}dd;font-size:11px;padding:5px 4px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.3)">${cat.category_name}<br><span style="font-size:9px;opacity:0.9;font-weight:500">합계</span></th>`
            }).join('')}
            ${patientCats.length === 0 ? `<th style="min-width:80px;background:#166534;border-left:3px solid #334155">일합계</th>` : ''}
            <th class="sticky z-30" style="min-width:80px;background:#1e3a5f;left:110px;padding:4px 3px">합계<br><span style="font-size:9px;opacity:0.8;font-weight:400">/ 진행률</span></th>
            <th style="min-width:64px;background:#374151;font-size:11px;padding:4px 2px">업체별<br><span style="font-size:9px;opacity:0.75;font-weight:400">입력</span></th>
          </tr>
        </thead>
        <tbody id="ordersTbody">
          <tr><td colspan="99" class="text-center py-8 text-gray-400" style="font-size:13px"><div class="loading-spinner" style="display:inline-block;margin-right:8px"></div>발주 데이터 로딩 중...</td></tr>
        </tbody>
        <tfoot id="ordersTfoot"></tfoot>
      </table>
      </div>
      <!-- 하단 가로 스크롤바 (데스크탑용 미러) -->
      <div id="orders-hscroll-bar" style="overflow-x:auto;overflow-y:hidden;height:14px;border-top:1px solid #e5e7eb;background:#f9fafb;display:none">
        <div id="orders-hscroll-inner" style="height:1px"></div>
      </div>
    </div>
  </div>
  <!-- 다수일 발주 빠른 입력 패널 -->
  <div id="quickMultiDayPanel" class="hidden bg-white rounded-2xl shadow-sm border border-green-200 p-5 mt-4">
    QUICK_MULTIDAY_PLACEHOLDER
  </div>`

  // quickMultiDay 패널 HTML을 별도로 삽입 (innerHTML 크기 줄이기)
  const qmPanel = document.getElementById('quickMultiDayPanel')
  if (qmPanel) {
    qmPanel.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-bold text-gray-800"><i class="fas fa-calendar-plus text-green-600 mr-2"></i>다수일 발주 입력 (주말·공휴일·명절)</h3>
      <button onclick="document.getElementById('quickMultiDayPanel').classList.add('hidden')" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>
    </div>
    <div class="bg-green-50 rounded-xl p-3 mb-4 text-xs text-green-800">
      <i class="fas fa-info-circle mr-1"></i>
      주말·공휴일이 포함된 다수일 발주를 넣을 때 사용합니다. 시작일에 N일치 금액을 한 번에 입력합니다.
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
      <input type="date" id="qdStart" class="form-input" value="${App.currentYear}-${String(App.currentMonth).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}">
      <div>
        <label class="block text-xs font-semibold text-gray-600 mb-1">발주 일수</label>
        <div class="flex gap-2">
          ${[2,3,4,5,6,7].map(n => `<button onclick="selectQDDays(${n})" id="qdBtn${n}" class="px-3 py-2 rounded-lg border text-sm font-medium ${n===2?'bg-green-600 text-white border-green-600':'bg-white text-gray-600 border-gray-300'} hover:bg-green-50">${n}일</button>`).join('')}
          <input type="number" id="qdDays" class="form-input text-center" style="width:60px" value="2" min="1" max="14" onchange="syncQDButtons(this.value)">
        </div>
      </div>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
      <div>
        <label class="block text-xs font-semibold text-gray-600 mb-1">업체 선택</label>
        <select id="qdVendor" class="form-input">
          ${vendors.map(v => `<option value="${v.id}" data-taxtype="${v.tax_type}">${v.name}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="block text-xs font-semibold text-gray-600 mb-1">비고 (자동입력)</label>
        <input type="text" id="qdNote" class="form-input" placeholder="예: 설 연휴 3일치">
      </div>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
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
    </div>`
  }

  // 전역 예산 데이터 저장 (실시간 업데이트용)
  const vendorDailyBudgets2 = {}
  ;(vendors||[]).forEach(v => {
    vendorDailyBudgets2[v.id] = workingDays>0 ? Math.round((v.monthly_budget||0)/workingDays) : 0
  })
  const weekStartStr = weekStart.toISOString().split('T')[0]
  const weekEndStr = weekEnd.toISOString().split('T')[0]
  window._ordersBudget = { totalBudget, dailyBudget, weekBudget, todayStr, weekStart, weekEnd, weekStartStr, weekEndStr, vendorDailyBudgets: vendorDailyBudgets2, vendorWeeklyBudgets: Object.fromEntries(Object.entries(vendorDailyBudgets2).map(([k,v])=>[k,v*5])), workingDays, weeklyData }
  window._ordersData = orderData || []
  window._ordersVendors = vendors || []
  window._ordersMealStats = {
    totalMeals: (mealStats.total_patient||0)+(mealStats.total_staff||0)+(mealStats.total_guardian||0),
    totalPatient: mealStats.total_patient||0,
    totalStaff: mealStats.total_staff||0,
    totalNoncovered: mealStats.total_noncovered||0,
    totalGuardian: mealStats.total_guardian||0,
    mealCustomFields: dashData?.mealCustomFields || [],
    mealCustomTotals: dashData?.mealCustomTotals || {},
    targetMealPrice,
    vendors: vendors || []
  }

  // tbody/tfoot를 requestAnimationFrame 후 비동기 렌더링
  requestAnimationFrame(() => {
    setTimeout(() => {
      const _coveredDates = {}
      const _multiDayMap = {}
      ;(orderData||[]).forEach(o => {
        if (o.is_multi_day && o.multi_day_start && o.multi_day_end) {
          const s = new Date(o.multi_day_start), e = new Date(o.multi_day_end)
          const cnt = Math.round((e-s)/(1000*60*60*24))+1
          _multiDayMap[o.multi_day_start] = Math.max(_multiDayMap[o.multi_day_start]||0, cnt)
          for (let d = new Date(s); d <= e; d.setDate(d.getDate()+1)) {
            const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
            if (ds !== o.multi_day_start) _coveredDates[ds] = o.multi_day_start
          }
        }
      })
      const _vendorDailyBudgets = {}
      ;(vendors||[]).forEach(v => { _vendorDailyBudgets[v.id] = workingDays > 0 ? Math.round((v.monthly_budget||0)/workingDays) : 0 })
      window._ordersCoveredDates = _coveredDates
      window._ordersMultiDayMap = _multiDayMap
      window._ordersVendors = vendors
      window._ordersVendorDailyBudgets = _vendorDailyBudgets

      // catDailyMap: date → vendor_id → category_id → row 구조
      const _catDailyMap = {}
      ;(catOrderData?.dailyByVendorCat || []).forEach(r => {
        if (!_catDailyMap[r.order_date]) _catDailyMap[r.order_date] = {}
        if (!_catDailyMap[r.order_date][r.vendor_id]) _catDailyMap[r.order_date][r.vendor_id] = {}
        _catDailyMap[r.order_date][r.vendor_id][r.patient_category_id] = r
      })
      window._catDailyMap = _catDailyMap
      const _catSettingsMap = {}
      ;(catOrderData?.settings || []).forEach(s => { _catSettingsMap[s.patient_category_id] = s })
      window._catSettingsMap = _catSettingsMap

      _buildOrdersTbody({
        days, orderData: orderData||[], vendors: vendors||[],
        patientCats: patientCats||[], coveredDates: _coveredDates,
        multiDayMap: _multiDayMap, vendorDailyBudgets: _vendorDailyBudgets,
        catDailyMap: _catDailyMap, catSettingsMap: _catSettingsMap,
        dailyBudget, weekBudget, weekStart, weekEnd, todayStr,
        totalBudget, monthPct, orderMap
      })
      _buildOrdersTfoot({
        vendors: vendors||[], patientCats: patientCats||[], orderData: orderData||[],
        catOrderData, catSettingsMap: _catSettingsMap, monthPct, totalBudget
      })
      // ── 테이블/tfoot 렌더링 완료 후 모든 실시간 패널 업데이트 ──
      requestAnimationFrame(() => {
        if (typeof updateBudgetProgressPanel === 'function') updateBudgetProgressPanel()
      })
    }, 0)
  })

  // ── _buildOrdersTbody: 아코디언 구조 (날짜 1행 요약 + 상세 펼침) ──
  function _buildOrdersTbody(p) {
    const tbody = document.getElementById('ordersTbody')
    if (!tbody) return
    const { days, orderData, vendors, patientCats, coveredDates, multiDayMap,
            vendorDailyBudgets, catDailyMap, catSettingsMap,
            dailyBudget, weekBudget, weekStart, weekEnd, todayStr, orderMap } = p

    const rows = []
    const renderedWeeks = new Set()
    let weekNumber = 0
    const hasCats = patientCats.length > 0

    for (let i = 0; i < days; i++) {
      const day = i + 1
      const dow = getDayOfWeek(App.currentYear, App.currentMonth, day)
      const weekend = isWeekend(App.currentYear, App.currentMonth, day)
      const dateStr = `${App.currentYear}-${String(App.currentMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`
      const isToday = dateStr === todayStr
      const isPast = dateStr < todayStr
      const rowClass = dow === '일' ? 'holiday-row' : weekend ? 'weekend-row' : ''

      const dateObj = new Date(dateStr)
      const thisMon = new Date(dateObj)
      thisMon.setDate(dateObj.getDate() - (dateObj.getDay()===0 ? 6 : dateObj.getDay()-1))
      const thisSun = new Date(thisMon); thisSun.setDate(thisMon.getDate()+6)
      const weekKey = thisMon.toISOString().split('T')[0]
      const weekEndKey = thisSun.toISOString().split('T')[0]

      // ── 주간 요약 행 ──
      if (!renderedWeeks.has(weekKey)) {
        renderedWeeks.add(weekKey)
        weekNumber++
        const hasCatsForWeek = patientCats.length > 0
        let wTotal = 0
        if (hasCatsForWeek) {
          Object.entries(catDailyMap).forEach(([dateKey, vMap]) => {
            if (dateKey >= weekKey && dateKey <= weekEndKey) {
              Object.values(vMap).forEach(catMap => {
                Object.values(catMap).forEach(r => { wTotal += r.total || 0 })
              })
            }
          })
        } else {
          wTotal = orderData.filter(o=>o.order_date>=weekKey&&o.order_date<=weekEndKey).reduce((s,o)=>s+(o.total_amount||0),0)
        }
        const wPct = weekBudget>0 ? Math.round(wTotal/weekBudget*100) : null
        const wOver = wPct!==null&&wPct>=100; const wWarn = wPct!==null&&wPct>=80&&!wOver
        const isCurrentWeek = todayStr>=weekKey && todayStr<=weekEndKey
        const wColor = wOver?'#dc2626':wWarn?'#d97706':'#166534'
        const wBg = wOver?'#fee2e2':wWarn?'#fef3c7':(isCurrentWeek?'#e0f2fe':'#f0fdf4')
        const wBorderColor = wOver?'#dc2626':wWarn?'#f59e0b':'#16a34a'
        const wBW = isCurrentWeek ? '3px' : '2px'
        const wBS = isCurrentWeek ? 'double' : 'solid'
        const wLabel = `${weekKey.slice(5).replace('-','/')}~${weekEndKey.slice(5).replace('-','/')}`
        const wBadgeBg = isCurrentWeek ? '#0284c7' : (wOver?'#dc2626':wWarn?'#d97706':'#166534')
        const wPctBar = wPct!==null ? `<div style="height:4px;background:rgba(255,255,255,0.3);border-radius:2px;margin-top:3px"><div style="height:4px;width:${Math.min(wPct,100)}%;background:${wColor};border-radius:2px"></div></div>` : ''

        // 카테고리별 주간합계
        const weekCatTotals = patientCats.map(cat => {
          let amt = 0
          Object.entries(catDailyMap).forEach(([dateKey, vMap]) => {
            if (dateKey >= weekKey && dateKey <= weekEndKey) {
              Object.values(vMap).forEach(catMap => {
                const r = catMap[cat.id] || {}
                amt += r.total || 0
              })
            }
          })
          return amt
        })

        // 주간 카테고리 합계 셀들
        const weekCatCells = patientCats.map((cat, ci) => {
          const catColor = getCategoryColorHex(cat.category_key)
          const catAmt = weekCatTotals[ci] || 0
          const bl = ci === 0 ? `border-left:3px solid ${catColor}60;` : `border-left:2px solid ${catColor}30;`
          return `<td style="${bl}background:${isCurrentWeek?'#ede9fe20':'#f5f3ff15'};padding:3px 4px;text-align:center;vertical-align:middle;min-width:76px">
            <div style="font-size:10px;font-weight:700;color:${catAmt>0?catColor:'#d1d5db'}">${catAmt>0?fmtMan(catAmt):'-'}</div>
          </td>`
        }).join('')

        // 카테고리 없을 때 일합계 열 (비어있는 주간행)
        const weekNoCatCell = patientCats.length === 0 ? `<td style="background:${wBg};padding:3px 4px"></td>` : ''

        // colspan 계산: 날짜(1) + 요일(1) + 일수(1) = 3
        rows.push(`<tr class="week-summary-row${isCurrentWeek?' current-week-row':''}" data-week-key="${weekKey}" data-week-num="${weekNumber}" style="background:${wBg};border-top:${wBW} ${wBS} ${wBorderColor};border-bottom:${wBW} ${wBS} ${wBorderColor};">
          <td colspan="3" class="sticky left-0" id="weekPctCell-${weekKey}" data-week-num="${weekNumber}" data-week-is-current="${isCurrentWeek?'1':'0'}" data-week-label="${wLabel}" data-week-budget="${weekBudget}" style="background:${wBg};padding:3px 5px;min-width:110px;border-right:3px solid ${wBorderColor};">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:3px">
              <div style="display:inline-flex;align-items:center;background:${wBadgeBg};color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:9px;white-space:nowrap">${weekNumber}주${isCurrentWeek?'(현재)':''}</div>
              <span style="font-size:${isCurrentWeek?'13px':'12px'};font-weight:800;color:${wColor};white-space:nowrap">${wPct!==null?wPct+'%':'-'}${wOver?' 🚨':wWarn?' ⚠️':''}</span>
            </div>
            <div style="font-size:8px;color:#6b7280;margin-top:1px;white-space:nowrap">${wLabel}</div>
            <div style="font-size:9px;font-weight:700;color:${wColor};white-space:nowrap">${fmtMan(wTotal)}<span style="color:#9ca3af;font-size:8px;font-weight:400"> /${fmtMan(weekBudget)}</span></div>
            ${wPctBar}
          </td>
          ${weekCatCells}
          ${weekNoCatCell}
          <td style="background:${wBg};padding:3px 4px;text-align:center;min-width:80px"><div style="font-size:11px;font-weight:700;color:${wColor}">${wTotal>0?fmtMan(wTotal):'-'}</div><div style="font-size:9px;color:${wColor};font-weight:600">${wPct!==null?wPct+'%':''}</div></td>
          <td style="background:${wBg}"></td>
        </tr>`)
      }

      // ── 날짜별 계산 ──
      const isCovered = !!coveredDates[dateStr]
      let dayTotal = 0
      if (hasCats) {
        const vMapDay = catDailyMap[dateStr] || {}
        Object.values(vMapDay).forEach(catMap => {
          Object.values(catMap).forEach(r => { dayTotal += r.total || 0 })
        })
      } else {
        orderData.filter(o=>o.order_date===dateStr).forEach(o=>dayTotal+=o.total_amount||0)
      }
      const multiDayCount = multiDayMap[dateStr] || 1
      const adjBudget = isCovered ? 0 : dailyBudget * multiDayCount
      const dayPct = adjBudget>0 ? Math.round(dayTotal/adjBudget*100) : null
      const dOver = dayPct!==null&&dayPct>=100; const dWarn = dayPct!==null&&dayPct>=80&&!dOver
      const dColor = dOver?'#dc2626':dWarn?'#d97706':(dayTotal>0?'#166534':'#6b7280')
      const dBg = dOver?'#fee2e2':dWarn?'#fef3c7':'white'

      // 오늘 강조 / 과거 흐리게 스타일
      const todayHighlight = isToday ? 'border-left:3px solid #2563eb !important;box-shadow:inset 3px 0 0 #2563eb;' : ''
      const pastOpacity = isPast && !isToday ? 'opacity:0.65;' : ''

      // 카테고리별 일합계
      const catTotals = hasCats ? patientCats.map(cat => {
        return Object.values(catDailyMap[dateStr] || {}).reduce((s, vMap) => {
          const r = vMap[cat.id] || {}
          return s + (r.total || 0)
        }, 0)
      }) : []

      const displayTotal = hasCats ? catTotals.reduce((a,b)=>a+b,0) : dayTotal

      // ── 요약 행 (날짜 1행) ──
      const summaryRowBg = isToday ? '#eff6ff' : (isPast ? '#fafafa' : 'white')
      const summaryBorderTop = isToday ? 'border-top:2px solid #3b82f6;' : 'border-top:1px solid #e5e7eb;'

      // 카테고리 합계 셀들 (요약 행)
      const summaryCatCells = patientCats.map((cat, ci) => {
        const catColor = getCategoryColorHex(cat.category_key)
        const catAmt = catTotals[ci] || 0
        const catSettings2 = catSettingsMap[cat.id] || {}
        const catDB = catSettings2.working_days > 0 ? Math.round((catSettings2.monthly_budget||0)/catSettings2.working_days) : 0
        const catAdjBudget = isCovered ? 0 : catDB * multiDayCount
        const catPct = catAdjBudget > 0 ? Math.round(catAmt/catAdjBudget*100) : null
        const catOver = catPct!==null&&catPct>=100; const catWarn = catPct!==null&&catPct>=80&&!catOver
        const catAmtColor = catOver?'#dc2626':catWarn?'#d97706':(catAmt>0?catColor:'#9ca3af')
        const bl = ci === 0 ? `border-left:3px solid ${catColor}80;` : `border-left:2px solid ${catColor}40;`
        return `<td id="summCatAmt-${cat.id}-${dateStr}" style="${bl}${summaryBorderTop}padding:3px 4px;background:${catAmt>0?catColor+'12':summaryRowBg};text-align:center;vertical-align:middle;min-width:76px;${pastOpacity}">
          <div style="font-size:8px;color:${catColor}99;margin-bottom:1px;font-weight:600">${cat.category_name}</div>
          <div style="font-size:11px;font-weight:700;color:${catAmtColor}">${catAmt>0?fmtMan(catAmt):'<span style="color:#e5e7eb">-</span>'}</div>
          ${catPct!==null?`<div style="font-size:9px;color:${catAmtColor};font-weight:600">${catPct}%${catOver?' 🚨':catWarn?' ⚠️':''}</div>`:(catAmt>0?'<div style="font-size:8px;color:#d1d5db">목표 미설정</div>':'')}
        </td>`
      }).join('')

      // 카테고리 없을 때 일합계 셀
      const summaryNoCatCell = patientCats.length === 0 ? `<td id="dayTotal-${dateStr}" class="total-col text-center text-xs" style="${summaryBorderTop}vertical-align:middle;${dOver?'color:#dc2626;font-weight:700;background:#fee2e2':dWarn?'color:#d97706;font-weight:600;background:#fef3c7':''}">${dayTotal>0?fmt(dayTotal):''}</td>` : ''

      // 진행률/합계 셀 (sticky) - 일별 발주금액 기준
      const totalCellHtml = `
        <div style="font-size:9px;color:#9ca3af;margin-bottom:1px">일별 발주</div>
        <div style="font-size:11px;font-weight:700;color:${dColor}">${displayTotal>0?fmtMan(displayTotal):'<span style="color:#d1d5db">-</span>'}</div>
        ${dayPct!==null
          ? `<div style="font-size:9px;color:${dColor};font-weight:600">${dayPct}%${dOver?' 🚨':dWarn?' ⚠️':''}</div>`
          : (displayTotal>0&&adjBudget===0?'<div style="font-size:8px;color:#d1d5db">목표 미설정</div>':'')}
        ${adjBudget>0?`<div style="font-size:8px;color:#9ca3af">/${fmtMan(adjBudget)}</div>`:''}`

      // 일수 선택기
      const daySelectHtml = `<select class="multiday-select" data-date="${dateStr}" style="border:1px solid ${multiDayCount>1?'#16a34a':'#e5e7eb'};border-radius:3px;padding:1px 2px;font-size:10px;background:${multiDayCount>1?'#f0fdf4':'#f9fafb'};cursor:pointer;color:${multiDayCount>1?'#166534':'#374151'};font-weight:${multiDayCount>1?'700':'400'};width:50px" onchange="updateMultiDayNote(this)">${[1,2,3,4,5,6,7].map(n=>`<option value="${n}" ${multiDayCount===n?'selected':''}>${n}일</option>`).join('')}</select>${multiDayCount>1?`<div style="font-size:8px;color:#16a34a;font-weight:600;margin-top:1px;white-space:nowrap">${multiDayCount}일치</div>`:''}`

      // 상세 토글 버튼 (오늘은 기본 열림 → ▲, 나머지는 ▼)
      const initArrow = isToday ? '▲' : '▼'
      const initBtnBg = isToday ? (displayTotal>0?'#2563eb':'#16a34a') : (displayTotal>0?'#2563eb':'#e5e7eb')
      const initBtnColor = (isToday || displayTotal>0) ? 'white' : '#6b7280'
      const detailToggleBtn = hasCats ? `<button class="detail-toggle-btn" data-date="${dateStr}" onclick="toggleOrderDetail('${dateStr}')" style="border:none;background:${initBtnBg};color:${initBtnColor};border-radius:5px;padding:3px 6px;font-size:10px;cursor:pointer;white-space:nowrap;font-weight:600" title="업체별 상세 발주 입력">
        <span class="detail-arrow" data-date="${dateStr}">${initArrow}</span> 업체별 입력
      </button>` : ''

      rows.push(`<tr class="order-summary-row ${rowClass}" data-date="${dateStr}" data-multidays="${multiDayCount}" data-covered="${isCovered?'1':'0'}" data-week-start="${weekKey}" data-week-end="${weekEndKey}" style="background:${summaryRowBg};${summaryBorderTop}${isToday?'outline:2px solid #3b82f6;outline-offset:-1px;':''}${pastOpacity}">
        <td class="date-col sticky left-0 z-10" style="width:30px;text-align:center;vertical-align:middle;${summaryBorderTop}border-right:2px solid #d1d5db;background:${isToday?'#dbeafe':summaryRowBg};font-weight:${isToday?'800':'normal'};font-size:${isToday?'14px':'13px'};color:${isToday?'#1d4ed8':dow==='일'?'#ef4444':dow==='토'?'#16a34a':'#374151'};padding:4px 2px">${day}${isToday?'<div style="font-size:7px;color:#2563eb;font-weight:700">오늘</div>':''}</td>
        <td class="sticky z-10" style="width:24px;text-align:center;vertical-align:middle;${summaryBorderTop}background:${isToday?'#dbeafe':summaryRowBg};font-size:11px;font-weight:${weekend?'bold':'normal'};color:${dow==='토'?'#16a34a':dow==='일'?'#ef4444':'#6b7280'};left:30px;padding:4px 2px">${dow}</td>
        <td class="sticky z-10" style="width:56px;text-align:center;vertical-align:middle;${summaryBorderTop}background:${isToday?'#dbeafe':summaryRowBg};left:54px;padding:3px 2px;border-right:2px solid #e5e7eb">${daySelectHtml}</td>
        ${summaryCatCells}
        ${summaryNoCatCell}
        <td id="dayRatioCell-${dateStr}" class="sticky z-10" style="min-width:80px;left:110px;text-align:center;vertical-align:middle;${summaryBorderTop}background:${dOver?'#fee2e2':dWarn?'#fef3c7':(isToday?'#eff6ff':'#f8fafc')};border-left:2px solid ${dOver?'#fca5a5':dWarn?'#fcd34d':'#d1d5db'};padding:3px 4px">
          ${totalCellHtml}
        </td>
        <td style="text-align:center;vertical-align:middle;${summaryBorderTop}background:white;padding:3px 2px;border-left:1px solid #e5e7eb;min-width:52px">
          ${hasCats ? detailToggleBtn : ''}
          ${!hasCats ? `<button class="detail-toggle-btn" data-date="${dateStr}" onclick="toggleOrderDetail('${dateStr}')" style="border:none;background:${displayTotal>0?'#2563eb':'#e5e7eb'};color:${displayTotal>0?'white':'#6b7280'};border-radius:5px;padding:3px 6px;font-size:10px;cursor:pointer;white-space:nowrap;font-weight:600"><span class="detail-arrow" data-date="${dateStr}">▼</span> 업체별 입력</button>` : ''}
        </td>
      </tr>`)

      // ── 상세 행 (기본 숨김, 아코디언 펼침) ──
      if (hasCats) {
        // ── 탭형 아코디언: 카테고리별 탭 + 업체별 정보 ──
        // 탭 헤더 행 (단일 카테고리면 탭 없음)
        const colCount = 3 + patientCats.length + 1 + 1  // sticky3 + catCols + total + btn

        // 각 카테고리별 탭 상세 행 생성
        const tabDetailRowsHtml = patientCats.map((cat, ci) => {
          const catColor = getCategoryColorHex(cat.category_key)
          const catSettings2 = catSettingsMap[cat.id] || {}
          const catMonthBudget = catSettings2.monthly_budget || 0
          const catBgRow = catColor + '08'
          const isFirstCat = ci === 0

          // 이 카테고리의 오늘 입력 합계
          const catDayAmt = catTotals[ci] || 0
          const catDB2 = catSettings2.working_days > 0 ? Math.round(catMonthBudget/catSettings2.working_days) : 0
          const catAdjBudget2 = isCovered ? 0 : catDB2 * multiDayCount
          const catPctDay = catAdjBudget2 > 0 ? Math.round(catDayAmt/catAdjBudget2*100) : null
          const catOver2 = catPctDay!==null&&catPctDay>=100
          const catWarn2 = catPctDay!==null&&catPctDay>=80&&!catOver2
          const catAmtColor2 = catOver2?'#dc2626':catWarn2?'#d97706':catColor

          // 이 카테고리의 월 누적 발주 (모든 날짜 합산)
          let catMonthAccum = 0
          Object.keys(catDailyMap).forEach(dk => {
            Object.values(catDailyMap[dk] || {}).forEach(vMap => {
              const r = vMap[cat.id] || {}
              catMonthAccum += r.total || 0
            })
          })
          const catMonthRemain = catMonthBudget > 0 ? catMonthBudget - catMonthAccum : null
          const catMonthPct = catMonthBudget > 0 ? Math.round(catMonthAccum / catMonthBudget * 100) : null
          const catMonthOver = catMonthPct!==null&&catMonthPct>=100
          const catMonthWarn = catMonthPct!==null&&catMonthPct>=80&&!catMonthOver
          const catMonthColor = catMonthOver?'#dc2626':catMonthWarn?'#d97706':catColor

          // 탭 헤더 셀 (카테고리 구분)
          const tabHeader = patientCats.length > 1 ? `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;padding-bottom:5px;border-bottom:2px solid ${catColor}40">
            ${patientCats.map((c2, i2) => {
              const c2Color = getCategoryColorHex(c2.category_key)
              const isActive = i2 === ci
              return `<span style="padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;cursor:pointer;border:1.5px solid ${isActive?c2Color:'#e5e7eb'};background:${isActive?c2Color:'white'};color:${isActive?'white':'#6b7280'}" onclick="switchOrderDetailTab('${dateStr}',${i2})">${c2.category_name}</span>`
            }).join('')}
          </div>` : ''

          // 업체별 행 (월목표·누적·잔여·진행률·오늘입력)
          const vendorRows = vendors.map((v, vi) => {
            const catRow = (catDailyMap[dateStr]?.[v.id]?.[cat.id]) || {}
            const taxable = catRow.taxable || 0
            const exempt = catRow.exempt || 0
            const total = catRow.total || 0
            const vCols = getVendorCols(v.tax_type)

            // 업체 월 누적 (이 카테고리)
            let vCatMonthAccum = 0
            Object.keys(catDailyMap).forEach(dk => {
              const r2 = (catDailyMap[dk]?.[v.id]?.[cat.id]) || {}
              vCatMonthAccum += r2.total || 0
            })
            const vRemain = catMonthBudget > 0 ? Math.round(catMonthBudget / vendors.length) - vCatMonthAccum : null
            const taxLabel = v.tax_type==='mixed'?'과+면':v.tax_type==='taxable'?'과세':'면세'
            const taxBg = v.tax_type==='mixed'?'#dbeafe':v.tax_type==='taxable'?'#dcfce7':'#fef9c3'
            const taxColor = v.tax_type==='mixed'?'#1d4ed8':v.tax_type==='taxable'?'#166534':'#92400e'

            // 입력 필드
            let inputFields = ''
            if (vCols === 3) {
              inputFields = `
                <div style="display:flex;gap:3px;align-items:center;margin-top:4px">
                  <div style="flex:1">
                    <div style="font-size:8px;color:#9ca3af;margin-bottom:1px">과세</div>
                    <input type="text" inputmode="numeric" pattern="[0-9,]*" class="cat-order-input" style="width:100%;font-size:11px;text-align:right;padding:3px 4px;border:1.5px solid ${catColor}60;border-radius:4px;background:${taxable>0?catColor+'15':'white'}" data-category="${cat.id}" data-vendor="${v.id}" data-field="taxable" data-date="${dateStr}" value="${taxable>0?fmt(taxable):''}" placeholder="0">
                  </div>
                  <div style="flex:1">
                    <div style="font-size:8px;color:#9ca3af;margin-bottom:1px">면세</div>
                    <input type="text" inputmode="numeric" pattern="[0-9,]*" class="cat-order-input" style="width:100%;font-size:11px;text-align:right;padding:3px 4px;border:1.5px solid ${catColor}60;border-radius:4px;background:${exempt>0?catColor+'15':'white'}" data-category="${cat.id}" data-vendor="${v.id}" data-field="exempt" data-date="${dateStr}" value="${exempt>0?fmt(exempt):''}" placeholder="0">
                  </div>
                  <div id="vcatsubt-${v.id}-${cat.id}-${dateStr}" style="flex:1;text-align:center;font-size:11px;font-weight:700;color:${catColor};padding:3px 2px;background:${catColor}10;border-radius:4px;margin-top:12px">${total>0?fmtMan(total):''}</div>
                </div>`
            } else {
              inputFields = `
                <div style="margin-top:4px">
                  <div style="font-size:8px;color:#9ca3af;margin-bottom:1px">금액</div>
                  <input type="text" inputmode="numeric" pattern="[0-9,]*" class="cat-order-input" style="width:100%;font-size:11px;text-align:right;padding:3px 4px;border:1.5px solid ${catColor}60;border-radius:4px;background:${total>0?catColor+'15':'white'}" data-category="${cat.id}" data-vendor="${v.id}" data-field="total" data-date="${dateStr}" value="${total>0?fmt(total):''}" placeholder="0">
                </div>`
            }

            // 업체 월 목표: 업체 자체 monthly_budget 사용, 없으면 카테고리 예산 균등 배분
            const vMonthBudget = (v.monthly_budget > 0) ? v.monthly_budget : (catMonthBudget > 0 ? Math.round(catMonthBudget / vendors.length) : 0)
            const vMonthPct = vMonthBudget > 0 ? Math.round(vCatMonthAccum / vMonthBudget * 100) : null
            const vMonthOver = vMonthPct!==null&&vMonthPct>=100
            const vMonthWarn = vMonthPct!==null&&vMonthPct>=80&&!vMonthOver
            const vMonthColor = vMonthOver?'#dc2626':vMonthWarn?'#d97706':catColor
            const vRemainAmt = vMonthBudget > 0 ? vMonthBudget - vCatMonthAccum : null

            return `<div id="vendor-card-${v.id}-${cat.id}-${dateStr}" style="background:white;border-radius:8px;border:1.5px solid ${total>0?catColor+'80':'#e5e7eb'};padding:8px 10px;min-width:140px;flex:1">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
                <span style="font-size:11px;font-weight:700;color:#1f2937;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:90px">${v.name}</span>
                <span style="font-size:8px;padding:1px 4px;border-radius:4px;background:${taxBg};color:${taxColor};font-weight:700">${taxLabel}</span>
              </div>
              ${inputFields}
              <div style="margin-top:6px;padding-top:5px;border-top:1px solid #f3f4f6">
                <div style="display:flex;justify-content:space-between;font-size:9px;color:#6b7280;margin-bottom:2px">
                  <span>월 누적</span>
                  <span id="vcat-month-accum-${v.id}-${cat.id}" style="font-weight:700;color:${vMonthColor}">${vCatMonthAccum>0?fmtMan(vCatMonthAccum):'0'}</span>
                </div>
                ${vMonthBudget > 0 ? `
                <div style="display:flex;justify-content:space-between;font-size:9px;color:#9ca3af;margin-bottom:3px">
                  <span>월 목표</span>
                  <span style="color:#6b7280">${fmtMan(vMonthBudget)}</span>
                </div>
                <div style="height:4px;background:#e5e7eb;border-radius:2px;margin-bottom:2px;overflow:hidden">
                  <div style="height:4px;width:${Math.min(vMonthPct||0,100)}%;background:${vMonthColor};border-radius:2px;transition:width 0.3s"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:8px">
                  <span style="color:${vMonthColor};font-weight:600">${vMonthPct!==null?vMonthPct+'%':''}</span>
                  <span style="color:${vRemainAmt<0?'#dc2626':'#9ca3af'}">${vRemainAmt!==null?(vRemainAmt<0?'초과 '+fmtMan(Math.abs(vRemainAmt)):'잔여 '+fmtMan(vRemainAmt)):''}</span>
                </div>` : `<div style="font-size:8px;color:#d1d5db;text-align:center">목표 미설정</div>`}
              </div>
            </div>`
          }).join('')

          // 카테고리 전체 소계 + 닫기 버튼 (첫번째 탭만 닫기 버튼 표시하면 헷갈리니 각 탭에 표시)
          const catSummary = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;padding-top:6px;border-top:1.5px solid ${catColor}30">
              <div style="display:flex;align-items:center;gap:8px">
                <span id="catDayTotal-${dateStr}-${cat.id}" style="font-size:12px;font-weight:700;color:${catAmtColor2}">${catDayAmt>0?fmtMan(catDayAmt):'-'}</span>
                ${catPctDay!==null?`<span style="font-size:10px;color:${catAmtColor2};font-weight:600">${catPctDay}%${catOver2?' 🚨':catWarn2?' ⚠️':''}</span>`:''}
                ${catAdjBudget2>0?`<span style="font-size:9px;color:#9ca3af">/${fmtMan(catAdjBudget2)}</span>`:''}
              </div>
              <div>
                <button onclick="toggleOrderDetail('${dateStr}')" style="border:none;background:#64748b;color:white;border-radius:5px;padding:3px 8px;font-size:10px;cursor:pointer;font-weight:600">▲ 닫기</button>
              </div>
            </div>`

          // 전체 발주 합계 셀 (모든 카테고리 합산)
          const grandSummary = isFirstCat ? `
            <td id="dayRatioCell-detail-${dateStr}" rowspan="${patientCats.length}" class="sticky z-10" style="left:110px;padding:6px 4px;background:${dBg};text-align:center;vertical-align:middle;border-left:2px solid #d1d5db;min-width:80px">
              <div style="font-size:11px;font-weight:700;color:${dColor}">${displayTotal>0?fmtMan(displayTotal):'-'}</div>
              ${dayPct!==null?`<div style="font-size:9px;color:${dColor};font-weight:600">${dayPct}%${dOver?' 🚨':dWarn?' ⚠️':''}</div>`:''}
            </td>
            <td rowspan="${patientCats.length}" style="background:white;padding:3px 2px;text-align:center;vertical-align:middle;border-left:1px solid #e5e7eb;min-width:48px">
            </td>` : ''

          // 지난 날짜는 기본 닫힘, 오늘 날짜는 첫 번째 탭만 열림
          const isDetailOpen = isToday && ci === 0
          const displayStyle = isDetailOpen ? '' : 'display:none'

          return `<tr class="order-detail-row cat-tab-row ${rowClass}" data-date="${dateStr}" data-cat="${cat.id}" data-tab-index="${ci}" data-multidays="${multiDayCount}" data-covered="${isCovered?'1':'0'}" data-week-start="${weekKey}" data-week-end="${weekEndKey}" style="${displayStyle};background:${catBgRow}">
            <td class="sticky left-0 z-10" style="width:30px;background:#f1f5f9;padding:2px;border-right:1px solid #e2e8f0;vertical-align:top"></td>
            <td class="sticky z-10" style="width:24px;background:#f1f5f9;left:30px;padding:2px;vertical-align:top"></td>
            <td class="sticky z-10" style="width:56px;background:#f1f5f9;left:54px;padding:2px;border-right:1px solid #e2e8f0;text-align:center;font-size:9px;color:#94a3b8;vertical-align:top">${multiDayCount}일</td>
            <td colspan="${patientCats.length}" style="padding:8px 10px;background:${catBgRow};vertical-align:top">
              ${tabHeader}
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                ${vendorRows}
              </div>
              ${catSummary}
            </td>
            ${grandSummary}
          </tr>`
        }).join('')

        rows.push(tabDetailRowsHtml)
      } else {
        // 카테고리 없는 경우: 상세 행에 업체 입력
        const vendorInputCells = vendors.map((v, vi) => getVendorInputCells(v, orderMap[dateStr]?.[v.id]||{}, dateStr, vi > 0)).join('')
        rows.push(`<tr class="order-detail-row ${rowClass}" data-date="${dateStr}" data-multidays="${multiDayCount}" data-covered="${isCovered?'1':'0'}" data-week-start="${weekKey}" data-week-end="${weekEndKey}" style="${isToday?'':'display:none'}">
          <td class="sticky left-0 z-10" style="width:30px;background:#f1f5f9;text-align:center;font-size:10px;color:#94a3b8;border-right:1px solid #e2e8f0;padding:3px">↳</td>
          <td class="sticky z-10" style="width:24px;background:#f1f5f9;left:30px;padding:2px"></td>
          <td class="sticky z-10" style="width:56px;background:#f1f5f9;left:54px;padding:2px;border-right:1px solid #e2e8f0"></td>
          ${vendorInputCells}
          <td id="dayTotal-${dateStr}" class="total-col text-center text-xs sticky z-10" style="left:110px;vertical-align:middle;min-width:80px;background:#f8fafc;${dOver?'color:#dc2626;font-weight:700;background:#fee2e2':dWarn?'color:#d97706;font-weight:600;background:#fef3c7':''}">${dayTotal>0?fmt(dayTotal):''}</td>
          <td style="background:white;padding:3px 2px;text-align:center;border-left:1px solid #e5e7eb">
            <button onclick="toggleOrderDetail('${dateStr}')" style="border:none;background:#64748b;color:white;border-radius:5px;padding:3px 6px;font-size:10px;cursor:pointer;font-weight:600">▲ 닫기</button>
          </td>
        </tr>`)
      }
    }

    tbody.innerHTML = rows.join('')
    bindOrderInputEvents()
    setupOrdersScrollSync()
  }

  function _buildOrdersTfoot(p) {
    const tfoot = document.getElementById('ordersTfoot')
    if (!tfoot) return
    const { vendors, patientCats, orderData, catOrderData, catSettingsMap, monthPct, totalBudget } = p
    const hasCats = patientCats.length > 0

    // 카테고리 모드: catOrderData 집계, 아니면 orderData 사용
    let monthTotal = 0
    if (hasCats) {
      // dailyByVendorCat의 total 합산
      monthTotal = (catOrderData?.dailyByVendorCat || []).reduce((s, r) => s + (r.total || 0), 0)
    } else {
      monthTotal = (orderData||[]).reduce((s,o)=>s+(o.total_amount||0),0)
    }

    // 카테고리별 월합계
    const catMonthTotals = patientCats.map(cat => {
      return (catOrderData?.dailyByVendorCat || [])
        .filter(r => r.patient_category_id === cat.id)
        .reduce((s, r) => s + (r.total || 0), 0)
    })

    // 카테고리 모드용 업체별 합계: dailyByVendorCat 집계
    const getVendorTotalCellsCat = (v) => {
      const rows = (catOrderData?.dailyByVendorCat || []).filter(r => r.vendor_id === v.id)
      const totalTaxable = rows.reduce((s, r) => s + (r.taxable || 0), 0)
      const totalExempt  = rows.reduce((s, r) => s + (r.exempt || 0), 0)
      const total = rows.reduce((s, r) => s + (r.total || 0), 0)
      if (v.tax_type === 'mixed') {
        return `<td class="text-center text-xs py-1">${totalTaxable>0?fmt(totalTaxable):''}</td>
                <td class="text-center text-xs py-1">${totalExempt>0?fmt(totalExempt):''}</td>
                <td class="text-center text-blue-700 font-bold text-xs total-col py-1" id="vfoot-amt-${v.id}">${total>0?fmt(total):''}</td>
                <td class="text-center text-blue-700 font-bold text-xs py-1">${total>0?fmt(total):''}</td>`
      }
      return `<td class="text-center text-blue-700 font-bold text-xs total-col py-1" id="vfoot-amt-${v.id}">${total>0?fmt(total):''}</td>
              <td class="text-center text-blue-700 font-bold text-xs py-1">${total>0?fmt(total):''}</td>`
    }

    const totalCols = hasCats ? `
      <td class="text-center text-green-700 font-bold" id="vfoot-month-total" style="font-size:11px">${fmt(monthTotal)}</td>
      <td style="padding:2px 3px;text-align:center;vertical-align:middle">
        ${patientCats.map((cat, ci) => {
          const catColor = getCategoryColorHex(cat.category_key)
          const catAmt = catMonthTotals[ci] || 0
          const pct = monthTotal > 0 ? Math.round(catAmt / monthTotal * 100) : 0
          return `<div style="display:flex;align-items:center;gap:2px;margin-bottom:1px">
            <div style="background:${catColor};color:white;font-size:7px;font-weight:700;padding:0 3px;border-radius:4px;white-space:nowrap">${cat.category_name}</div>
            <div style="flex:1;height:4px;background:#e5e7eb;border-radius:2px"><div style="height:4px;width:${pct}%;background:${catColor};border-radius:2px"></div></div>
            <span style="font-size:8px;color:${catColor};font-weight:700">${pct}%</span>
          </div>`
        }).join('')}
      </td>` : `<td class="text-center text-green-700 font-bold" id="vfoot-month-total" style="font-size:11px">${fmt(monthTotal)}</td>`

    tfoot.innerHTML = `<tr class="bg-gray-100 font-bold text-xs">
      <td colspan="3" class="text-center py-1.5 sticky left-0 bg-gray-100" style="min-width:110px">${hasCats ? '월 합계' : '합계'}</td>
      ${hasCats ? patientCats.map((cat, ci) => {
        const catColor = getCategoryColorHex(cat.category_key)
        const catAmt = catMonthTotals[ci] || 0
        const bl = ci===0 ? `border-left:3px solid ${catColor}80;` : `border-left:2px solid ${catColor}40;`
        return `<td style="${bl}text-align:center;padding:3px 4px;min-width:76px;background:${catAmt>0?catColor+'10':''}"><div style="font-size:10px;font-weight:700;color:${catAmt>0?catColor:'#9ca3af'}">${catAmt>0?fmtMan(catAmt):'-'}</div></td>`
      }).join('') : `<td class="text-center bg-gray-100 py-1" id="vfoot-month-pct" style="color:${monthPct>=100?'#dc2626':monthPct>=80?'#d97706':'#16a34a'};font-weight:700;font-size:10px">${monthPct}%<div style="font-size:8px;color:#6b7280;font-weight:400">${fmtMan(totalBudget)}</div></td>`}
      <td class="text-center sticky bg-gray-100" id="vfoot-month-total" style="left:110px;font-size:11px;min-width:80px;font-weight:700;color:${monthPct>=100?'#dc2626':monthPct>=80?'#d97706':'#16a34a'}">${fmtMan(monthTotal)}<div style="font-size:9px;font-weight:600">${monthPct}%</div></td>
      <td style="background:#f3f4f6;text-align:center;padding:2px;font-size:9px;color:#9ca3af">업체별</td>
    </tr>`
  }


}

// ── 업체 카드 클릭 → 오늘 날짜 상세 자동 오픈 ──────────────────
window.openTodayDetailForVendor = function(vendorId) {
  const todayStr = new Date().toISOString().split('T')[0]
  // 오늘 요약 행 찾기
  const todayRow = document.querySelector(`tr.order-summary-row[data-date="${todayStr}"]`)
  if (todayRow) {
    // 상세가 닫혀 있으면 열기
    const detailRows = document.querySelectorAll(`.order-detail-row[data-date="${todayStr}"]`)
    const firstRow = detailRows[0]
    const isOpen = firstRow && firstRow.style.display !== 'none'
    if (!isOpen) toggleOrderDetail(todayStr)

    // 탭 구조: 이 업체가 입력된 탭(카테고리)으로 전환
    setTimeout(() => {
      // 해당 업체 입력창 찾기
      const inp = document.querySelector(`.cat-order-input[data-vendor="${vendorId}"][data-date="${todayStr}"]`)
      if (inp) {
        // 이 입력이 속한 탭 행 찾기
        const tabRow = inp.closest(`tr.cat-tab-row[data-date="${todayStr}"]`)
        if (tabRow) {
          const tabIdx = parseInt(tabRow.dataset.tabIndex || '0')
          // 이미 해당 탭이 열려있지 않으면 전환
          if (tabRow.style.display === 'none') {
            window.switchOrderDetailTab(todayStr, tabIdx)
          }
        }
        // 스크롤 후 포커스 및 강조
        setTimeout(() => {
          todayRow.scrollIntoView({ behavior: 'smooth', block: 'center' })
          setTimeout(() => {
            const cardEl = inp.closest('[id^="vendor-card-"]')
            if (cardEl) {
              cardEl.style.boxShadow = '0 0 0 2px #3b82f6'
              setTimeout(() => { cardEl.style.boxShadow = '' }, 2000)
            }
            inp.style.outline = '2px solid #3b82f6'
            inp.focus()
            setTimeout(() => { inp.style.outline = '' }, 2000)
          }, 200)
        }, 100)
      } else {
        todayRow.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, isOpen ? 50 : 200)
  } else {
    // 오늘 날짜가 이번 달에 없으면 그냥 테이블로 스크롤
    const table = document.getElementById('ordersTable')
    if (table) table.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

// ── 아코디언: 상세 행 토글 ──────────────────────────────────────
window.toggleOrderDetail = function(dateStr) {
  const detailRows = document.querySelectorAll(`.order-detail-row[data-date="${dateStr}"]`)
  // 탭 구조: tab-index=0인 행이 보이면 열린 상태
  const firstDetailRow = detailRows[0]
  const isOpen = firstDetailRow && firstDetailRow.style.display !== 'none'

  if (isOpen) {
    // 닫기: 모든 상세 행 숨기기
    detailRows.forEach(row => { row.style.display = 'none' })
  } else {
    // 열기: tab-index=0 행만 표시 (탭 구조), 비탭은 모두 표시
    detailRows.forEach(row => {
      const tabIdx = row.dataset.tabIndex
      if (tabIdx === undefined) {
        row.style.display = ''  // 비탭 구조
      } else {
        row.style.display = tabIdx === '0' ? '' : 'none'  // 탭 구조: 첫 탭만 표시
      }
    })
  }

  // 상세 버튼 화살표 방향 변경
  const arrowEl = document.querySelector(`.detail-arrow[data-date="${dateStr}"]`)
  const btnEl = document.querySelector(`.detail-toggle-btn[data-date="${dateStr}"]`)
  if (arrowEl) arrowEl.textContent = isOpen ? '▼' : '▲'
  if (btnEl) {
    btnEl.style.background = isOpen ? (btnEl.dataset.hasamt === '1' ? '#2563eb' : '#e5e7eb') : '#64748b'
    btnEl.style.color = isOpen ? (btnEl.dataset.hasamt === '1' ? 'white' : '#6b7280') : 'white'
  }

  // 스크롤 동기화 재초기화
  if (!isOpen) {
    setTimeout(() => setupOrdersScrollSync(), 50)
    // 상세가 열릴 때 첫 번째 입력에 포커스
    const firstInput = firstDetailRow?.querySelector('input.cat-order-input, input.order-input')
    if (firstInput) setTimeout(() => firstInput.focus(), 100)
  }
}

// ── 탭 전환: 날짜별 카테고리 탭 전환 ────────────────────────────
window.switchOrderDetailTab = function(dateStr, tabIndex) {
  const detailRows = document.querySelectorAll(`.order-detail-row.cat-tab-row[data-date="${dateStr}"]`)
  detailRows.forEach(row => {
    const idx = parseInt(row.dataset.tabIndex || '0')
    row.style.display = idx === tabIndex ? '' : 'none'
  })
  // 탭 전환 후 첫 입력에 포커스
  const activeRow = document.querySelector(`.order-detail-row.cat-tab-row[data-date="${dateStr}"][data-tab-index="${tabIndex}"]`)
  if (activeRow) {
    const inp = activeRow.querySelector('input.cat-order-input')
    if (inp) setTimeout(() => inp.focus(), 80)
  }
  setTimeout(() => setupOrdersScrollSync(), 50)
}

// ── 발주 테이블 하단 스크롤 미러 동기화 ──────────────────────────
function setupOrdersScrollSync() {
  requestAnimationFrame(() => {
    const scroller = document.getElementById('ordersTableScroller')
    const table = document.getElementById('ordersTable')
    const hBar = document.getElementById('orders-hscroll-bar')
    const hInner = document.getElementById('orders-hscroll-inner')
    if (!scroller || !table) return

    const isMobile = window.innerWidth <= 768

    // 테이블 실제 너비를 inner에 적용하여 스크롤바 트랙 크기 맞춤
    const syncWidth = () => {
      if (hInner) hInner.style.width = table.scrollWidth + 'px'
    }
    syncWidth()

    if (isMobile) {
      // 모바일: 스크롤바 숨기고 터치 스크롤만 사용
      if (hBar) hBar.style.display = 'none'
    } else {
      // 데스크탑: 하단 미러 스크롤바 표시
      if (hBar) hBar.style.display = 'block'
      if (hBar && hInner) {
        // 미러 → 테이블 스크롤 동기화
        let lockBar = false, lockScroller = false
        hBar.addEventListener('scroll', () => {
          if (lockBar) return
          lockScroller = true
          scroller.scrollLeft = hBar.scrollLeft
          requestAnimationFrame(() => { lockScroller = false })
        })
        scroller.addEventListener('scroll', () => {
          if (lockScroller) return
          lockBar = true
          hBar.scrollLeft = scroller.scrollLeft
          syncWidth()
          requestAnimationFrame(() => { lockBar = false })
        })
      }
    }

    // ResizeObserver: 테이블 크기 변할 때 너비 동기화
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        syncWidth()
        // 모바일에서 스크롤 영역이 화면 넘치지 않도록 강제
        if (scroller) {
          scroller.style.maxWidth = '100vw'
        }
      })
      ro.observe(table)
    }
  })
}

// ── 발주 전체 수동 저장 ────────────────────────────────────────
window.saveAllOrders = async () => {
  const inputs = document.querySelectorAll('.order-input')
  if (inputs.length === 0) { showToast('저장할 발주 데이터가 없습니다', 'warning'); return }

  // 버튼 로딩 상태
  const btn = document.querySelector('button[onclick="saveAllOrders()"]')
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> 저장 중...' }

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
    const taxable = parseOrderVal(taxableEl?.value)
    const exempt  = parseOrderVal(exemptEl?.value)
    if (taxable === 0 && exempt === 0) return  // 빈 칸은 스킵

    const vat   = Math.round(taxable * 0.1)
    promises.push(api('POST', '/api/orders/save', {
      vendorId: parseInt(vendorId), orderDate: date,
      taxableAmount: taxable, exemptAmount: exempt, vatAmount: vat
    }))
  })

  if (promises.length === 0) {
    showToast('입력된 발주 데이터가 없습니다', 'warning')
    showAutoSaveIndicator('saved')
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-1"></i> 전체 저장' }
    return
  }

  const results = await Promise.all(promises)
  const ok = results.every(r => r?.success)
  showAutoSaveIndicator(ok ? 'saved' : 'error')
  showToast(ok ? `✅ ${promises.length}건 발주 저장 완료!` : '❌ 일부 저장 실패', ok ? 'success' : 'error')
  if (ok) sendActivityLog('발주 입력 저장')
  updateBudgetProgressPanel()

  // 버튼 복원
  if (btn) {
    btn.disabled = false
    btn.innerHTML = ok
      ? '<i class="fas fa-check mr-1"></i> 저장 완료'
      : '<i class="fas fa-save mr-1"></i> 전체 저장'
    if (ok) setTimeout(() => { btn.innerHTML = '<i class="fas fa-save mr-1"></i> 전체 저장' }, 2000)
  }
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

window.updateMultiDayNote = async (sel) => {
  const days = parseInt(sel.value)
  const dateStr = sel.dataset.date
  const row = document.querySelector(`tr.order-summary-row[data-date="${dateStr}"]`) || document.querySelector(`tr[data-date="${dateStr}"]`)
  if (!row) return

  // 1) data-multidays 즉시 반영 (요약 행 + 상세 행 모두)
  row.dataset.multidays = days
  row.style.background = days > 1 ? 'rgba(22,163,74,0.05)' : ''
  document.querySelectorAll(`tr.order-detail-row[data-date="${dateStr}"]`).forEach(r => {
    r.dataset.multidays = days
  })

  // 2) 드롭다운 색상 업데이트
  sel.style.border = `1px solid ${days > 1 ? '#16a34a' : '#e5e7eb'}`
  sel.style.background = days > 1 ? '#f0fdf4' : '#f9fafb'
  sel.style.color = days > 1 ? '#166534' : '#374151'
  sel.style.fontWeight = days > 1 ? '700' : '400'

  // 3) 다일치 라벨 추가/제거
  let labelEl = sel.nextElementSibling
  if (days > 1) {
    if (!labelEl || !labelEl.classList.contains('multiday-label')) {
      labelEl = document.createElement('div')
      labelEl.className = 'multiday-label'
      labelEl.style.cssText = 'font-size:8px;color:#16a34a;font-weight:600;margin-top:1px'
      sel.parentNode.insertBefore(labelEl, sel.nextSibling)
    }
    labelEl.textContent = `${days}일치`
  } else {
    if (labelEl && labelEl.classList.contains('multiday-label')) labelEl.remove()
  }

  // 4) 종료일 계산
  const endDate = new Date(dateStr)
  endDate.setDate(endDate.getDate() + days - 1)
  const endStr = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}-${String(endDate.getDate()).padStart(2,'0')}`

  if (days > 1) {
    sel.title = `${dateStr} ~ ${endStr} (${days}일치)`
    if (window._ordersMultiDayMap) window._ordersMultiDayMap[dateStr] = days
  } else {
    sel.title = ''
    if (window._ordersMultiDayMap) delete window._ordersMultiDayMap[dateStr]
  }

  // 5) 진행률 셀 즉시 재계산
  updateDayTotal(dateStr)

  // 6) 입력값 있는 업체만 DB 저장
  const vendors = window._ordersVendors || []
  for (const v of vendors) {
    const taxableEl = document.querySelector(`input.order-input[data-vendor="${v.id}"][data-type="taxable"][data-date="${dateStr}"]`)
    const exemptEl = document.querySelector(`input.order-input[data-vendor="${v.id}"][data-type="exempt"][data-date="${dateStr}"]`)
    const taxable = parseOrderVal(taxableEl?.value)
    const exempt = parseOrderVal(exemptEl?.value)
    if (taxable === 0 && exempt === 0) continue
    const vat = Math.round(taxable * 0.1)
    await api('POST', '/api/orders/save', {
      vendorId: v.id, orderDate: dateStr,
      taxableAmount: taxable, exemptAmount: exempt, vatAmount: vat,
      isMultiDay: days > 1 ? 1 : 0,
      multiDayStart: days > 1 ? dateStr : null,
      multiDayEnd: days > 1 ? endStr : null,
      note: days > 1 ? `${days}일치 발주` : null
    })
  }
  showAutoSaveIndicator('saved')
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
  if (taxType === 'mixed') return `<th style="min-width:60px;font-size:10px">과세</th><th style="min-width:60px;font-size:10px">면세</th><th style="min-width:60px;font-size:10px;background:#1a2f4a">소계</th>`
  if (taxType === 'taxable') return `<th style="min-width:60px;font-size:10px">과세</th>`
  return `<th style="min-width:60px;font-size:10px">면세</th>`
}

function getVendorInputCells(v, order, dateStr, addBorder = false) {
  const taxable = order.taxable_amount || 0
  const exempt = order.exempt_amount || 0
  const total = order.total_amount || 0
  const multiDay = order.is_multi_day ? `title="${order.multi_day_start}~${order.multi_day_end} 다일치"` : ''
  const borderStyle = addBorder ? 'border-left:3px solid #cbd5e1;' : ''
  const fmtV = (v) => v > 0 ? v.toLocaleString() : ''
  if (v.tax_type === 'mixed') {
    return `<td style="${borderStyle}min-width:64px;padding:2px 2px"><input type="text" inputmode="numeric" pattern="[0-9,]*" class="order-input" data-vendor="${v.id}" data-type="taxable" data-date="${dateStr}" value="${fmtV(taxable)}" placeholder="0" style="width:60px;min-width:60px"></td>
            <td style="min-width:64px;padding:2px 2px"><input type="text" inputmode="numeric" pattern="[0-9,]*" class="order-input" data-vendor="${v.id}" data-type="exempt" data-date="${dateStr}" value="${fmtV(exempt)}" placeholder="0" style="width:60px;min-width:60px"></td>
            <td class="total-col text-center text-xs ${order.is_multi_day?'multi-day-cell':''}" id="vt-${v.id}-${dateStr}" style="min-width:64px;padding:2px 2px" ${multiDay}>${total>0?fmt(total):''}</td>`
  }
  if (v.tax_type === 'taxable') {
    return `<td style="${borderStyle}min-width:72px;padding:2px 2px"><input type="text" inputmode="numeric" pattern="[0-9,]*" class="order-input" data-vendor="${v.id}" data-type="taxable" data-date="${dateStr}" value="${fmtV(taxable)}" placeholder="0" style="width:68px;min-width:68px"></td>`
  }
  return `<td style="${borderStyle}min-width:72px;padding:2px 2px"><input type="text" inputmode="numeric" pattern="[0-9,]*" class="order-input" data-vendor="${v.id}" data-type="exempt" data-date="${dateStr}" value="${fmtV(exempt)}" placeholder="0" style="width:68px;min-width:68px"></td>`
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

// 업체 서브헤더 (주 진행률 열 없음)
function getVendorSubHeadersWithPct(v, borderLeft = '', hasCats = false, vBgStyle = '') {
  const colW = v.tax_type === 'mixed' ? 68 : 76
  const firstBorder = borderLeft ? `style="${borderLeft}${vBgStyle}min-width:${colW}px;font-size:10px"` : `style="${vBgStyle}min-width:${colW}px;font-size:10px"`
  const subBg = vBgStyle ? `style="${vBgStyle}min-width:${colW}px;font-size:10px"` : `style="min-width:${colW}px;font-size:10px"`
  const sumBg = `style="${vBgStyle}min-width:56px;font-size:9px;border-left:1px dashed rgba(255,255,255,0.3)"`
  if (v.tax_type === 'mixed') {
    return `<th ${firstBorder}>과세</th><th ${subBg}>면세</th><th style="${vBgStyle}min-width:${colW}px;font-size:10px;opacity:0.85">소계</th>${hasCats ? `<th ${sumBg}>업체합산</th>` : ''}`
  }
  if (v.tax_type === 'taxable') {
    return `<th ${firstBorder}>과세</th>${hasCats ? `<th ${sumBg}>업체합산</th>` : ''}`
  }
  return `<th ${firstBorder}>면세</th>${hasCats ? `<th ${sumBg}>업체합산</th>` : ''}`
}

// 업체 합계 셀 (주 진행률 열 없음 — 합계행에 월 달성률만 id로 남김)
function getVendorTotalCellsWithPct(v, orderData) {
  const filtered = orderData.filter(o => o.vendor_id === v.id)
  const totalTaxable = filtered.reduce((s, o) => s + (o.taxable_amount||0), 0)
  const totalExempt = filtered.reduce((s, o) => s + (o.exempt_amount||0), 0)
  const total = filtered.reduce((s, o) => s + (o.total_amount||0), 0)
  if (v.tax_type === 'mixed') {
    return `<td class="text-center text-xs py-1">${totalTaxable>0?fmt(totalTaxable):''}</td>
            <td class="text-center text-xs py-1">${totalExempt>0?fmt(totalExempt):''}</td>
            <td class="text-center text-blue-700 font-bold text-xs total-col py-1" id="vfoot-amt-${v.id}">${total>0?fmt(total):''}</td>`
  }
  return `<td class="text-center text-blue-700 font-bold text-xs total-col py-1" id="vfoot-amt-${v.id}">${total>0?fmt(total):''}</td>`
}

function bindOrderInputEvents() {
  const tbody = document.getElementById('ordersTbody')
  if (!tbody) return

  // ── 이벤트 위임: tbody에 하나만 등록 (개별 input마다 붙이지 않음) ──
  const _saveTimers = {}
  const _catSaveTimers = {}

  const doOrderSave = async (vendorId, date) => {
    const taxableEl = tbody.querySelector(`input.order-input[data-vendor="${vendorId}"][data-type="taxable"][data-date="${date}"]`)
    const exemptEl  = tbody.querySelector(`input.order-input[data-vendor="${vendorId}"][data-type="exempt"][data-date="${date}"]`)
    const taxable = parseOrderVal(taxableEl?.value)
    const exempt  = parseOrderVal(exemptEl?.value)
    if (taxableEl) taxableEl.value = taxable > 0 ? taxable.toLocaleString() : ''
    if (exemptEl)  exemptEl.value  = exempt  > 0 ? exempt.toLocaleString()  : ''
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

  tbody.addEventListener('input', function(e) {
    const input = e.target
    if (input.classList.contains('order-input')) {
      input.value = input.value.replace(/[^0-9]/g, '')
      const vendorId = input.dataset.vendor
      const date = input.dataset.date
      const taxableEl = tbody.querySelector(`input.order-input[data-vendor="${vendorId}"][data-type="taxable"][data-date="${date}"]`)
      const exemptEl  = tbody.querySelector(`input.order-input[data-vendor="${vendorId}"][data-type="exempt"][data-date="${date}"]`)
      const taxable = parseOrderVal(taxableEl?.value)
      const exempt  = parseOrderVal(exemptEl?.value)
      const vat = Math.round(taxable * 0.1)
      const total = taxable + exempt + vat
      const subtotalEl = document.getElementById(`vt-${vendorId}-${date}`)
      if (subtotalEl) subtotalEl.textContent = total > 0 ? fmt(total) : ''
      updateDayTotal(date)
      updateBudgetProgressPanel()
    } else if (input.classList.contains('cat-order-input')) {
      input.value = input.value.replace(/[^0-9]/g, '')
      updateDayTotal(input.dataset.date)
      updateBudgetProgressPanel()
    }
  })

  tbody.addEventListener('focus', function(e) {
    const input = e.target
    if (input.classList.contains('order-input') || input.classList.contains('cat-order-input')) {
      const raw = parseOrderVal(input.value)
      input.value = raw > 0 ? String(raw) : ''
      input.select()
    }
  }, true)

  tbody.addEventListener('change', function(e) {
    const input = e.target
    if (input.classList.contains('order-input')) {
      const key = `${input.dataset.vendor}-${input.dataset.date}`
      if (_saveTimers[key]) clearTimeout(_saveTimers[key])
      _saveTimers[key] = setTimeout(() => doOrderSave(input.dataset.vendor, input.dataset.date), 0)
    }
  })

  tbody.addEventListener('blur', function(e) {
    const input = e.target
    if (input.classList.contains('order-input')) {
      const key = `${input.dataset.vendor}-${input.dataset.date}`
      if (_saveTimers[key]) clearTimeout(_saveTimers[key])
      _saveTimers[key] = setTimeout(() => doOrderSave(input.dataset.vendor, input.dataset.date), 100)
    } else if (input.classList.contains('cat-order-input')) {
      const val = parseOrderVal(input.value)
      if (val > 0) input.value = val.toLocaleString()
      else input.value = ''
      const ckey = `${input.dataset.vendor}-${input.dataset.category}-${input.dataset.date}`
      if (_catSaveTimers[ckey]) clearTimeout(_catSaveTimers[ckey])
      _catSaveTimers[ckey] = setTimeout(async () => { await saveCatOrderInput(input) }, 200)
    }
  }, true)

  tbody.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter' && e.key !== 'Tab') return
    const input = e.target
    if (input.classList.contains('order-input')) {
      const inputs = [...tbody.querySelectorAll('.order-input')]
      const idx = inputs.indexOf(input)
      if (idx < inputs.length - 1) { e.preventDefault(); inputs[idx + 1].focus() }
    } else if (input.classList.contains('cat-order-input')) {
      const inputs = [...tbody.querySelectorAll('.cat-order-input')]
      const idx = inputs.indexOf(input)
      if (idx < inputs.length - 1) { e.preventDefault(); inputs[idx + 1].focus() }
    }
  })
}

// 카테고리별 발주 저장
async function saveCatOrderInput(input) {
  const categoryId = input.dataset.category
  const vendorId = input.dataset.vendor
  const date = input.dataset.date
  const field = input.dataset.field  // 'taxable', 'exempt', 'total'

  if (!categoryId || !date || !vendorId) return

  // 같은 vendor+date+category 행의 과세/면세 값을 함께 읽어서 저장
  const tbody = document.getElementById('ordersTbody')
  const selBase = `.cat-order-input[data-category="${categoryId}"][data-vendor="${vendorId}"][data-date="${date}"]`
  const taxableEl = tbody ? tbody.querySelector(`${selBase}[data-field="taxable"]`) : null
  const exemptEl  = tbody ? tbody.querySelector(`${selBase}[data-field="exempt"]`)  : null
  const totalEl   = tbody ? tbody.querySelector(`${selBase}[data-field="total"]`)   : null

  let taxable = 0, exempt = 0
  if (taxableEl) taxable = parseOrderVal(taxableEl.value)
  if (exemptEl)  exempt  = parseOrderVal(exemptEl.value)
  if (totalEl) {
    // tax_type === 'exempt' 또는 단일 컬럼인 경우
    const val = parseOrderVal(totalEl.value)
    // vendor tax_type 판별: 부모 행에서 읽기 어려우므로 field로 구분
    if (field === 'exempt') exempt = val
    else taxable = val
  }

  const vat = Math.round(taxable * 0.1)

  showAutoSaveIndicator('saving')
  const res = await api('POST', '/api/orders/save-category', {
    vendorId: parseInt(vendorId),
    orderDate: date,
    patientCategoryId: parseInt(categoryId),
    taxableAmount: taxable,
    exemptAmount: exempt,
    vatAmount: vat
  })
  showAutoSaveIndicator(res?.success ? 'saved' : 'error')
  // 서브행 합계 셀 업데이트
  updateCatSubrowTotal(categoryId, vendorId, date, taxable, exempt, vat)
  updateCatMonthTotal(categoryId)
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

// 서브행 합계 셀 실시간 업데이트 (과세+면세+vat)
function updateCatSubrowTotal(categoryId, vendorId, date, taxable, exempt, vat) {
  const total = taxable + exempt + vat
  // 합계 td: 3컬럼(mixed) 업체의 3번째 td에 해당 (현재는 동적 생성 기반 - 재렌더링으로 처리)
  // 간단히 dayTotal 업데이트만 수행
  updateDayTotal(date)
  updateBudgetProgressPanel()
}

// 카테고리 월 합계 업데이트
function updateCatMonthTotal(categoryId) {
  let monthTotal = 0
  document.querySelectorAll(`.cat-order-input[data-category="${categoryId}"]`).forEach(inp => {
    monthTotal += parseOrderVal(inp.value)
  })
  // tfoot 카테고리 셀 업데이트 - 간단한 버전으로 구현
  // (tfoot은 렌더링 시 catSettingsMap 사용하므로 실시간 업데이트는 refreshOrders 호출로 처리)
}

function updateBudgetProgressPanel() {
  // 전체 입력값 합계 재계산
  const budget = window._ordersBudget
  if (!budget) return
  const { totalBudget, dailyBudget, weekBudget, todayStr, weekStart, weekEnd } = budget

  const patientCats = window._patientCats || []
  const hasCats = patientCats.length > 0

  let monthTotal = 0, todayTotal = 0, weekTotal = 0

  if (hasCats) {
    // 카테고리 모드: cat-order-input 집계
    const weekStartStr2 = weekStart instanceof Date ? weekStart.toISOString().split('T')[0] : weekStart
    const weekEndStr2   = weekEnd   instanceof Date ? weekEnd.toISOString().split('T')[0]   : weekEnd

    // 카테고리별 합계도 실시간 계산
    const catMonthAcc = {}; const catTodayAcc = {}; const catWeekAcc = {}
    patientCats.forEach(c => { catMonthAcc[c.id]=0; catTodayAcc[c.id]=0; catWeekAcc[c.id]=0 })

    const processedCat = {}
    document.querySelectorAll('.cat-order-input').forEach(inp => {
      const date   = inp.dataset.date
      const vendor = inp.dataset.vendor
      const catId  = inp.dataset.category
      const field  = inp.dataset.field
      const key = `${date}-${vendor}-${catId}-${field}`
      if (processedCat[key]) return
      processedCat[key] = true

      const val = parseOrderVal(inp.value)
      if (val === 0) return
      const amt = field === 'taxable' ? val + Math.round(val*0.1) : val

      monthTotal += amt
      if (catMonthAcc[catId] !== undefined) catMonthAcc[catId] += amt
      if (date === todayStr) {
        todayTotal += amt
        if (catTodayAcc[catId] !== undefined) catTodayAcc[catId] += amt
      }
      if (date >= weekStartStr2 && date <= weekEndStr2) {
        weekTotal += amt
        if (catWeekAcc[catId] !== undefined) catWeekAcc[catId] += amt
      }
    })

    // 카테고리 바 실시간 업데이트 (A안+B안)
    const catSettingsMap = window._catSettingsMap || {}
    const updateCatBars = (totalsMap, budgetsMap, periodLbl) => {
      patientCats.forEach(cat => {
        const color = getCategoryColorHex(cat.category_key)
        const grand = patientCats.reduce((s,c)=>s+(totalsMap[c.id]||0),0)
        const amt = totalsMap[cat.id] || 0
        const budg = budgetsMap[cat.id] || 0

        const aBar = document.getElementById(`catABar-${periodLbl}-${cat.id}`)
        const aPctEl = document.getElementById(`catAPct-${periodLbl}-${cat.id}`)
        const bBar = document.getElementById(`catBBar-${periodLbl}-${cat.id}`)
        const bPctEl = document.getElementById(`catBPct-${periodLbl}-${cat.id}`)
        const amtEl = document.getElementById(`catAmt-${periodLbl}-${cat.id}`)

        const aPct = grand > 0 ? Math.round(amt/grand*100) : 0
        const bPct = budg > 0 ? Math.round(amt/budg*100) : null
        const bColor = bPct===null?'#9ca3af':bPct>=100?'#dc2626':bPct>=80?'#d97706':color

        if (aBar)   aBar.style.width = aPct + '%'
        if (aPctEl) aPctEl.textContent = aPct + '%'
        if (bBar)   { bBar.style.width = Math.min(bPct||0,100) + '%'; bBar.style.background = bColor }
        if (bPctEl) { bPctEl.textContent = (bPct!==null ? bPct+'%' : ''); bPctEl.style.color = bColor }
        if (amtEl)  amtEl.textContent = fmtMan(amt)
      })
    }

    const catDailyBudgets2 = {}; const catMonthBudgets2 = {}; const catWeekBudgets2 = {}
    ;(window._catOrderSettings||[]).forEach(s => {
      const id = s.patient_category_id
      catMonthBudgets2[id] = s.monthly_budget || 0
      catDailyBudgets2[id] = s.working_days > 0 ? Math.round((s.monthly_budget||0)/s.working_days) : 0
      catWeekBudgets2[id]  = catDailyBudgets2[id] * 5
    })

    updateCatBars(catTodayAcc,  catDailyBudgets2, 'today')
    updateCatBars(catMonthAcc,  catMonthBudgets2, 'month')
    // 주차 바 업데이트
    document.querySelectorAll('[id^="week"][id$="-card"]').forEach(el => {
      const num = el.id.replace('-card','').replace('week','')
      if (isNaN(num)) return
      updateCatBars(catWeekAcc, catWeekBudgets2, `w${num}`)
    })

  } else {
    // 기존 모드 (카테고리 없을 때): order-input 집계
    const weekStartStr2 = weekStart instanceof Date ? weekStart.toISOString().split('T')[0] : weekStart
    const weekEndStr2   = weekEnd   instanceof Date ? weekEnd.toISOString().split('T')[0]   : weekEnd
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
      const t = parseOrderVal(taxableEl?.value)
      const e = parseOrderVal(exemptEl?.value)
      const total = t + Math.round(t*0.1) + e
      monthTotal += total
      if (date === todayStr) todayTotal += total
      if (date >= weekStartStr2 && date <= weekEndStr2) weekTotal += total
    })
  }

  const monthPct = totalBudget > 0 ? Math.round(monthTotal / totalBudget * 100) : 0
  const todayPct = dailyBudget > 0 ? Math.round(todayTotal / dailyBudget * 100) : 0
  const weekPct  = weekBudget  > 0 ? Math.round(weekTotal  / weekBudget  * 100) : 0

  // 범용 카드 업데이트 헬퍼
  function updateBudgetCard(cardId, pctId, amtId, barId, pct, amt, isCurrent=false, isToday=false) {
    const card = document.getElementById(cardId)
    if (!card) return
    const isOver = pct>=100, isWarn = pct>=80&&!isOver
    const borderColor = isOver?'#ef4444':isWarn?'#f59e0b':(isToday?'#2563eb':'#16a34a')
    const borderW = (isCurrent||isToday)?'3px':'2px'
    card.style.background = isOver?'#fff1f2':isWarn?'#fffbeb':(isToday?'#eff6ff':(isCurrent?'#f0fdf4':'#f8fafc'))
    card.style.border = `${borderW} solid ${borderColor}`
    card.style.boxShadow = (isCurrent||isToday)?'0 4px 14px rgba(0,0,0,0.13)':''
    const pctEl = document.getElementById(pctId)
    if (pctEl) {
      pctEl.textContent = `${pct}%`
      pctEl.style.color = isOver?'#dc2626':isWarn?'#d97706':(isToday?'#1d4ed8':'#16a34a')
      pctEl.style.fontSize = isToday?(isOver||isWarn?'30px':'26px'):(isCurrent?(isOver||isWarn?'26px':'20px'):(isOver||isWarn?'22px':'17px'))
    }
    const amtEl = document.getElementById(amtId)
    if (amtEl) amtEl.textContent = fmtWon(amt)
    const barEl = document.getElementById(barId)
    if (barEl) {
      barEl.style.width = `${Math.min(pct,100)}%`
      barEl.style.background = isOver?'#dc2626':isWarn?'#f59e0b':(isToday?'#3b82f6':'#16a34a')
      if (barEl.parentElement) barEl.parentElement.style.background = isOver?'#fee2e2':isWarn?'#fef3c7':(isToday?'#dbeafe':'#dcfce7')
    }
    // 뱃지 업데이트 (첫번째 div의 마지막 요소)
    const badgeEl = card.querySelector('[style*="border-radius:10px"]')
    const badge = isOver
      ? `<span style="background:#dc2626;color:white;font-size:9px;font-weight:700;padding:1px 5px;border-radius:10px;margin-left:3px">🚨초과</span>`
      : isWarn
      ? `<span style="background:#f59e0b;color:white;font-size:9px;font-weight:700;padding:1px 5px;border-radius:10px;margin-left:3px">⚠️주의</span>`
      : ''
    if (badgeEl) { badgeEl.outerHTML = badge || '' }
    else if (badge) {
      const firstDiv = card.querySelector('div')
      if (firstDiv) firstDiv.insertAdjacentHTML('beforeend', badge)
    }
  }

  updateBudgetCard('today-card','todayPct','todayAmt','todayBar', todayPct, todayTotal, false, true)
  updateBudgetCard('month-card','monthPct','monthAmt','monthBar', monthPct, monthTotal, false, false)

  // 주차별 카드 업데이트
  const wBudget = budget.weekBudget
  // 저장된 weeklyData(주차 시작일/종료일 목록)로 주차별 집계
  const savedWeeklyData = budget.weeklyData || []
  // weekStart 기준으로 weeklyTotals 계산
  const weeklyTotals = {}
  if (hasCats) {
    // 카테고리 모드: cat-order-input 에서 날짜 기준으로 주차별 합산
    const procCatWk = {}
    document.querySelectorAll('.cat-order-input').forEach(inp => {
      const date   = inp.dataset.date
      const vendor = inp.dataset.vendor
      const field  = inp.dataset.field
      const wKey   = `${date}-${vendor}-${field}`
      if (procCatWk[wKey]) return
      procCatWk[wKey] = true
      const val = parseOrderVal(inp.value)
      if (val === 0) return
      const amt = field === 'taxable' ? val + Math.round(val * 0.1) : val
      // 해당 날짜가 속한 주차 시작일 찾기
      const wEntry = savedWeeklyData.find(w => date >= w.wk && date <= w.wkEnd)
      const wkStart = wEntry ? wEntry.wk : null
      if (!wkStart) return
      if (!weeklyTotals[wkStart]) weeklyTotals[wkStart] = 0
      weeklyTotals[wkStart] += amt
    })
  } else {
    // 일반 모드: order-input 에서 날짜 기준으로 주차별 합산
    const procWk = {}
    document.querySelectorAll('.order-input').forEach(inp => {
      const date   = inp.dataset.date
      const vendor = inp.dataset.vendor
      const wKey   = `${date}-${vendor}`
      if (procWk[wKey]) return
      procWk[wKey] = true
      const tx = document.querySelector(`input.order-input[data-vendor="${vendor}"][data-type="taxable"][data-date="${date}"]`)
      const ex = document.querySelector(`input.order-input[data-vendor="${vendor}"][data-type="exempt"][data-date="${date}"]`)
      const t2 = parseOrderVal(tx?.value)
      const e2 = parseOrderVal(ex?.value)
      const tot2 = t2 + Math.round(t2 * 0.1) + e2
      if (tot2 === 0) return
      const wEntry = savedWeeklyData.find(w => date >= w.wk && date <= w.wkEnd)
      const wkStart = wEntry ? wEntry.wk : null
      if (!wkStart) return
      if (!weeklyTotals[wkStart]) weeklyTotals[wkStart] = 0
      weeklyTotals[wkStart] += tot2
    })
  }
  // 주차 카드별 업데이트 (savedWeeklyData 순서 기준으로 안정적으로 매핑)
  savedWeeklyData.forEach((w, i) => {
    const num  = i + 1
    const wkAmt = weeklyTotals[w.wk] || 0
    const wkPct = wBudget > 0 ? Math.round(wkAmt / wBudget * 100) : 0
    const isCW  = (todayStr >= w.wk && todayStr <= w.wkEnd)
    updateBudgetCard(`week${num}-card`, `weekPct${num}`, `weekAmt${num}`, `weekBar${num}`, wkPct, wkAmt, isCW)
  })

  // 월 합계 표시 업데이트
  const mTotalEl = document.getElementById('monthTotalDisplay')
  const mPctEl = document.getElementById('monthPctDisplay')
  if (mTotalEl) mTotalEl.textContent = fmtMan(monthTotal)
  if (mPctEl) mPctEl.textContent = `${monthPct}%`

  // ── 업체별 월 합계 카드 실시간 업데이트 ──
  const vendors = window._ordersVendors || []
  const hasCatsForVsum = (window._patientCats || []).length > 0
  vendors.forEach(v => {
    // DOM에서 해당 업체 입력값 전체 합산 (일반 모드 + 카테고리 모드 모두 지원)
    let vMonthTotal = 0
    if (hasCatsForVsum) {
      // 카테고리 모드: cat-order-input으로 업체별 합산
      const seenKeys = new Set()
      document.querySelectorAll(`.cat-order-input[data-vendor="${v.id}"]`).forEach(inp => {
        const d = inp.dataset.date
        const catId = inp.dataset.category
        const field = inp.dataset.field
        const key = `${d}-${catId}-${field}`
        if (seenKeys.has(key)) return; seenKeys.add(key)
        const val = parseOrderVal(inp.value)
        if (field === 'taxable') vMonthTotal += val + Math.round(val * 0.1)
        else if (field === 'exempt') vMonthTotal += val
        else if (field === 'total') {
          // total 필드는 taxable/exempt 없을 때만 합산 (중복 방지)
          const txEl = document.querySelector(`.cat-order-input[data-vendor="${v.id}"][data-category="${catId}"][data-field="taxable"][data-date="${d}"]`)
          const exEl = document.querySelector(`.cat-order-input[data-vendor="${v.id}"][data-category="${catId}"][data-field="exempt"][data-date="${d}"]`)
          if (!txEl && !exEl) vMonthTotal += val
        }
      })
    } else {
      const seenDates = new Set()
      document.querySelectorAll(`.order-input[data-vendor="${v.id}"]`).forEach(inp => {
        const d = inp.dataset.date
        if (seenDates.has(d)) return; seenDates.add(d)
        const tx = document.querySelector(`input.order-input[data-vendor="${v.id}"][data-type="taxable"][data-date="${d}"]`)
        const ex = document.querySelector(`input.order-input[data-vendor="${v.id}"][data-type="exempt"][data-date="${d}"]`)
        const t = parseOrderVal(tx?.value)
        const e = parseOrderVal(ex?.value)
        vMonthTotal += t + Math.round(t*0.1) + e
      })
    }
    const vPct = v.monthly_budget > 0 ? Math.round(vMonthTotal / v.monthly_budget * 100) : null
    const vOver = vPct !== null && vPct >= 100
    const vWarn = vPct !== null && vPct >= 80 && !vOver
    // 상단 요약 카드 업데이트
    const sumCard = document.getElementById(`vsum-${v.id}`)
    if (sumCard) {
      const amtEl = sumCard.querySelector('.vsum-amt')
      const pctEl = sumCard.querySelector('.vsum-pct')
      if (amtEl) { amtEl.textContent = fmtMan(vMonthTotal); amtEl.style.color = vOver?'#dc2626':vWarn?'#d97706':'#166534' }
      if (pctEl) { pctEl.textContent = vPct !== null ? `${vPct}%` : ''; pctEl.style.color = vOver?'#ef4444':vWarn?'#f59e0b':'#6b7280' }
      sumCard.style.borderColor = vOver?'#fca5a5':vWarn?'#fde68a':'#e5e7eb'
      sumCard.style.background = vOver?'#fff1f2':vWarn?'#fffbeb':'white'
    }
    // 테이블 하단 합계 행의 업체별 셀 업데이트
    const footAmtEl = document.getElementById(`vfoot-amt-${v.id}`)
    const footPctEl = document.getElementById(`vfoot-pct-${v.id}`)
    if (footAmtEl) { footAmtEl.textContent = vMonthTotal > 0 ? fmt(vMonthTotal) : ''; footAmtEl.style.color = vOver?'#dc2626':'#1d4ed8' }
    if (footPctEl) {
      footPctEl.textContent = vPct !== null ? vPct + '%' + (vOver ? ' 🚨' : vWarn ? ' ⚠️' : '') : '-'
      footPctEl.style.color = vOver?'#dc2626':vWarn?'#d97706':'#166534'
      footPctEl.style.background = vOver?'#fee2e2':vWarn?'#fef3c7':'#f0fdf4'
    }
  })

  // ── 테이블 하단 월 합계 셀 업데이트 ──
  const footMonthEl = document.getElementById('vfoot-month-total')
  if (footMonthEl) { footMonthEl.textContent = monthTotal > 0 ? fmt(monthTotal) : ''; footMonthEl.style.color = monthPct>=100?'#dc2626':monthPct>=80?'#d97706':'#166534' }
  const footMonthPctEl = document.getElementById('vfoot-month-pct')
  if (footMonthPctEl) {
    footMonthPctEl.innerHTML = `${monthPct}%<div style="font-size:9px;color:#6b7280;font-weight:400">${fmtMan(monthTotal)} / ${fmtMan(totalBudget)}</div>`
    footMonthPctEl.style.color = monthPct>=100?'#dc2626':monthPct>=80?'#d97706':'#16a34a'
  }

  // 실시간 식단가 업데이트
  const ms = window._ordersMealStats
  if (ms) {
    // 소모품/카드 카테고리 업체들의 합계
    const supplyTotal = (ms.vendors || [])
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
          const t = parseOrderVal(taxEl?.value)
          const e = parseOrderVal(exEl?.value)
          vTotal += t + Math.round(t*0.1) + e
        })
        return s + vTotal
      }, 0)

    // 식단가 계산용 식수: 비급여 제외, ea 단위 커스텀 필드 제외, 환자(patient) 제외(환자군으로 대체)
    const customFields4price = (ms.mealCustomFields || []).filter(f => (f.unit_type||'meal') !== 'ea')
    const customMealSum = customFields4price.reduce((s, f) => s + (Number((ms.mealCustomTotals||{})[f.field_key]) || 0), 0)
    // 전체 식수: 직원+보호자+환자군(커스텀) — 비급여 제외, 환자(patient) 제외
    const totalMeals = (ms.totalStaff||0) + (ms.totalGuardian||0) + customMealSum  // 표시용
    const totalMealsForPrice = (ms.totalStaff||0) + (ms.totalGuardian||0) + customMealSum
    // ② 직원식 제외 분모: 보호자 + 환자군
    const mealsNoStaff = (ms.totalGuardian||0) + customMealSum

    // ① 전체 식단가: 총금액 ÷ (환자+직원+보호자) — 비급여 제외
    const mp1 = totalMealsForPrice > 0 ? Math.round(monthTotal / totalMealsForPrice) : 0
    // ② 직원식 제외: 총금액 ÷ (환자+보호자) — 분모에서만 직원식수 제외
    //    예: 20,880,000 ÷ 110명 = 189,818원/식 (전체 130,500원보다 높음)
    const mp2 = mealsNoStaff > 0 ? Math.round(monthTotal / mealsNoStaff) : 0
    // ③ 소모품/카드 제외: (총금액 - 소모품) ÷ (환자+직원+보호자) — 비급여 제외
    const mp3 = totalMealsForPrice > 0 ? Math.round((monthTotal - supplyTotal) / totalMealsForPrice) : 0
    const tgt = ms.targetMealPrice

    const mp1El = document.getElementById('mpVal-total')
    const mp2El = document.getElementById('mpVal-nostaff')
    const mp3El = document.getElementById('mpVal-nosupply')
    const mpDiffEl = document.getElementById('mpDiff-total')
    const mpCardEl = document.getElementById('mpCard-total')
    const mealCountEl = document.getElementById('realMealCount')

    if (mealCountEl) mealCountEl.textContent = fmt(totalMeals)

    if (totalMealsForPrice > 0) {
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
    } else {
      // 식수 없을 때 금액 기반으로 표시
      if (mp1El) mp1El.innerHTML = `<span class="text-gray-400 text-sm">식수 미입력</span>`
      if (mp2El) mp2El.innerHTML = `<span class="text-gray-400 text-sm">식수 미입력</span>`
      if (mp3El) mp3El.innerHTML = `<span class="text-gray-400 text-sm">식수 미입력</span>`
    }

    // ── 카테고리별 실시간 식단가 업데이트 ──
    const catsList = window._patientCats || []
    if (catsList.length > 0) {
      const todayMealsData = window._catTodayMeals || { patient_total: 0 }
      const totalPatientToday = todayMealsData.patient_total || 0
      const catSettings3 = window._catOrderSettings || []
      const catSetMap3 = {}
      catSettings3.forEach(s => { catSetMap3[s.patient_category_id] = s })

      // 오늘 카테고리별 발주 합계 계산
      const todayStr3 = budget?.todayStr || ''
      const catTodayAmts = {}
      catsList.forEach(c => { catTodayAmts[c.id] = 0 })
      document.querySelectorAll(`.cat-order-input[data-date="${todayStr3}"]`).forEach(inp => {
        const catId = parseInt(inp.dataset.category)
        const field = inp.dataset.field
        const val = parseOrderVal(inp.value)
        if (!catTodayAmts[catId] === undefined) catTodayAmts[catId] = 0
        if (field === 'taxable') catTodayAmts[catId] = (catTodayAmts[catId]||0) + val + Math.round(val*0.1)
        else catTodayAmts[catId] = (catTodayAmts[catId]||0) + val
      })

      // 카테고리별 월 식단가 업데이트 (formula 기반: 선택 예산항목 ÷ 선택 식수항목)
      catsList.forEach(cat => {
        const s3 = catSetMap3[cat.id] || {}
        const targetPrice3 = s3.target_meal_price || 0

        // formula 설정 (백엔드에서 받은 catDietPricesData 활용)
        const catDietEntry = (window._catDietPricesData || []).find(d => d.id === cat.id)
        const budgetKeys3 = catDietEntry?.budgetKeys || []
        const mealsKeys3 = catDietEntry?.mealsKeys || []
        const hasFormula3 = budgetKeys3.length > 0 || mealsKeys3.length > 0

        // 카테고리 key → id 맵 (catsList에서 빌드)
        const catKeyIdMap3 = {}
        catsList.forEach(c2 => { catKeyIdMap3[c2.category_key] = c2.id })

        // 월 발주금액: budgetKeys 기반으로 포함된 카테고리들의 합산 (현재 입력값 실시간 반영)
        let catMonthAmtLive = 0
        if (hasFormula3 && budgetKeys3.length > 0) {
          budgetKeys3.forEach(bKey => {
            const bCatId = catKeyIdMap3[bKey]
            if (bCatId !== undefined) {
              document.querySelectorAll(`.cat-order-input[data-category="${bCatId}"]`).forEach(inp => {
                const field = inp.dataset.field
                const val = parseOrderVal(inp.value)
                if (field === 'taxable') catMonthAmtLive += val + Math.round(val*0.1)
                else catMonthAmtLive += val
              })
            }
          })
        } else {
          document.querySelectorAll(`.cat-order-input[data-category="${cat.id}"]`).forEach(inp => {
            const field = inp.dataset.field
            const val = parseOrderVal(inp.value)
            if (field === 'taxable') catMonthAmtLive += val + Math.round(val*0.1)
            else catMonthAmtLive += val
          })
        }

        // 월 실입력 식수: mealsKeys 기반으로 포함된 식수 항목 합산
        const orderMealStats = window._ordersMealStats?.mealCustomTotals || {}
        const staffMeals3 = window._ordersMealStats?.totalStaff || 0
        const guardianMeals3 = window._ordersMealStats?.totalGuardian || 0
        let catMonthMeals = 0
        if (hasFormula3 && mealsKeys3.length > 0) {
          if (mealsKeys3.includes('staff')) catMonthMeals += staffMeals3
          if (mealsKeys3.includes('guardian')) catMonthMeals += guardianMeals3
          // noncovered는 항상 제외 (mealsKeys3에 포함되어 있어도 무시)
          mealsKeys3.filter(k => k.startsWith('cat_')).forEach(k => { catMonthMeals += (orderMealStats[k] || 0) })
        } else {
          catMonthMeals = (orderMealStats[`cat_${cat.category_key}`] || 0)
        }

        const catMealPrice = catMonthAmtLive > 0 && catMonthMeals > 0 ? Math.round(catMonthAmtLive / catMonthMeals) : 0

        const color = getCategoryColorHex(cat.category_key)
        const amtEl = document.getElementById(`cat-mp-amt-${cat.id}`)
        const priceEl = document.getElementById(`cat-mp-price-${cat.id}`)
        const diffEl = document.getElementById(`cat-mp-diff-${cat.id}`)
        const mealsEl = document.getElementById(`cat-mp-meals-${cat.id}`)

        if (amtEl) amtEl.textContent = catMonthAmtLive > 0 ? fmtMan(catMonthAmtLive) : (catDietEntry?.monthAmt > 0 ? fmtMan(catDietEntry.monthAmt) : '-')
        if (mealsEl) mealsEl.textContent = catMonthMeals > 0 ? fmt(catMonthMeals)+'식' : '-'

        if (priceEl) {
          if (catMealPrice > 0) {
            const isOver3 = targetPrice3 > 0 && catMealPrice > targetPrice3
            const isWarn3 = targetPrice3 > 0 && catMealPrice >= targetPrice3*0.9 && !isOver3
            priceEl.textContent = fmt(catMealPrice)
            priceEl.style.color = isOver3 ? '#dc2626' : isWarn3 ? '#d97706' : color
          } else {
            priceEl.innerHTML = `<span style="font-size:10px;color:#d1d5db">식수 미입력</span>`
          }
        }

        if (diffEl) {
          if (catMealPrice > 0 && targetPrice3 > 0) {
            const diff3 = catMealPrice - targetPrice3
            diffEl.innerHTML = diff3 > 0
              ? `<span style="color:#dc2626;font-size:10px">▲ +${fmt(diff3)}원</span><div style="font-size:8px;color:#9ca3af">목표: ${fmt(targetPrice3)}원</div>`
              : `<span style="color:#16a34a;font-size:10px">▼ ${fmt(Math.abs(diff3))}원</span><div style="font-size:8px;color:#9ca3af">목표: ${fmt(targetPrice3)}원</div>`
          } else if (targetPrice3 > 0) {
            diffEl.innerHTML = `<div style="font-size:8px;color:#9ca3af">목표: ${fmt(targetPrice3)}원</div>`
          } else {
            diffEl.innerHTML = `<span style="font-size:9px;color:#d1d5db">미설정</span>`
          }
        }
      })
    }
  }
  // 인사이트 패널도 함께 업데이트
  updateInsightPanel()
}

// ── 인사이트 패널: 월 예산 예측 + 업체 비중 + 식단가 경고 ──────
window.toggleInsightPanel = function() {
  const body = document.getElementById('insightPanelBody')
  const arrow = document.getElementById('insightPanelArrow')
  if (!body) return
  const isOpen = body.style.display !== 'none'
  body.style.display = isOpen ? 'none' : ''
  if (arrow) arrow.textContent = isOpen ? '▶' : '▼'
}

function updateInsightPanel() {
  const budget = window._ordersBudget
  if (!budget) return
  const vendors = window._ordersVendors || []
  const patientCats = window._patientCats || []
  const catSettingsMap = window._catSettingsMap || {}
  const totalBudget = budget.totalBudget || 0
  const hasCats = patientCats.length > 0

  // ── 1. 월 발주 합계 계산 ──
  let monthOrdered = 0
  if (hasCats) {
    document.querySelectorAll('.cat-order-input').forEach(inp => {
      const field = inp.dataset.field
      const val = parseOrderVal(inp.value)
      if (field === 'taxable') monthOrdered += val + Math.round(val * 0.1)
      else if (field === 'exempt' || field === 'total') monthOrdered += val
    })
  } else {
    document.querySelectorAll('.order-input').forEach(inp => {
      if (inp.dataset.type === 'taxable') {
        const val = parseOrderVal(inp.value)
        monthOrdered += val + Math.round(val * 0.1)
      } else if (inp.dataset.type === 'exempt') {
        monthOrdered += parseOrderVal(inp.value)
      } else {
        monthOrdered += parseOrderVal(inp.value)
      }
    })
  }

  // ── 2. 월 예산 예측 카드 ──
  const forecastEl = document.getElementById('budgetForecastContent')
  if (forecastEl && totalBudget > 0) {
    const pct = Math.round(monthOrdered / totalBudget * 100)
    const diff = monthOrdered - totalBudget
    const isOver = diff > 0
    const isWarn = pct >= 80 && !isOver
    const fColor = isOver ? '#dc2626' : isWarn ? '#d97706' : '#16a34a'
    const fBg = isOver ? '#fee2e2' : isWarn ? '#fef3c7' : '#f0fdf4'
    const fIcon = isOver ? '🚨' : isWarn ? '⚠️' : '✅'
    const fMsg = isOver
      ? `예산 <strong style="color:#dc2626">${fmtMan(Math.abs(diff))} 초과</strong> (${pct}%)`
      : pct >= 80
      ? `예산 소진 주의 <strong style="color:#d97706">${pct}%</strong> 사용`
      : `정상 범위 <strong style="color:#16a34a">${pct}%</strong> 사용`

    forecastEl.innerHTML = `
      <div style="background:${fBg};border-radius:8px;padding:8px;border:1px solid ${fColor}30">
        <div style="font-size:12px;margin-bottom:4px">${fIcon} ${fMsg}</div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:#6b7280;margin-bottom:4px">
          <span>발주액</span><strong style="color:${fColor}">${fmtMan(monthOrdered)}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:#6b7280;margin-bottom:6px">
          <span>예산</span><strong style="color:#374151">${fmtMan(totalBudget)}</strong>
        </div>
        <div style="height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${Math.min(pct,100)}%;background:${fColor};border-radius:3px;transition:width 0.4s"></div>
        </div>
      </div>`
  } else if (forecastEl) {
    forecastEl.innerHTML = `<div style="font-size:10px;color:#9ca3af">예산 설정 필요</div>`
  }

  // ── 3. 식단가 경고 카드 ──
  const dietAlertEl = document.getElementById('dietPriceAlertContent')
  if (dietAlertEl && hasCats && patientCats.length > 0) {
    const catRows = patientCats.map(cat => {
      const catColor = getCategoryColorHex(cat.category_key)
      const s = catSettingsMap[cat.id] || {}
      const targetPrice = s.target_meal_price || 0  // ← 버그 수정: target_diet_price → target_meal_price
      const monthlyBudget = s.monthly_budget || 0
      const workingDays = s.working_days || 0

      // formula(catDietPricesData) 기반으로 발주금액 및 식수 계산 (updateBudgetProgressPanel과 동일 방식)
      const mealStats2 = window._ordersMealStats || {}
      const orderMealStats2 = mealStats2.mealCustomTotals || {}
      const staffMeals2 = mealStats2.totalStaff || 0
      const guardianMeals2 = mealStats2.totalGuardian || 0
      const catDietEntry2 = (window._catDietPricesData || []).find(d => d.id === cat.id)
      const budgetKeys2 = catDietEntry2?.budgetKeys || []
      const mealsKeys2 = catDietEntry2?.mealsKeys || []
      const hasFormula2 = budgetKeys2.length > 0 || mealsKeys2.length > 0

      // 카테고리 key → id 맵
      const catKeyIdMap2 = {}
      patientCats.forEach(c2 => { catKeyIdMap2[c2.category_key] = c2.id })

      // 발주 총액: budgetKeys 기반 (formula 있을 때), 없으면 해당 카테고리 직접 합산
      let catTotal = 0
      if (hasFormula2 && budgetKeys2.length > 0) {
        budgetKeys2.forEach(bKey => {
          const bCatId = catKeyIdMap2[bKey]
          if (bCatId !== undefined) {
            document.querySelectorAll(`.cat-order-input[data-category="${bCatId}"]`).forEach(inp => {
              const field = inp.dataset.field
              const val = parseOrderVal(inp.value)
              if (field === 'taxable') catTotal += val + Math.round(val * 0.1)
              else catTotal += val
            })
          }
        })
      } else {
        document.querySelectorAll(`.cat-order-input[data-category="${cat.id}"]`).forEach(inp => {
          const field = inp.dataset.field
          const val = parseOrderVal(inp.value)
          if (field === 'taxable') catTotal += val + Math.round(val * 0.1)
          else catTotal += val
        })
      }

      // 식수: mealsKeys 기반 (formula 있을 때), 없으면 카테고리 key로 직접 조회
      let catMealCount = 0
      if (hasFormula2 && mealsKeys2.length > 0) {
        if (mealsKeys2.includes('staff')) catMealCount += staffMeals2
        if (mealsKeys2.includes('guardian')) catMealCount += guardianMeals2
        mealsKeys2.filter(k => k.startsWith('cat_')).forEach(k => { catMealCount += (orderMealStats2[k] || 0) })
      } else {
        // formula 없으면 카테고리 key로 식수 직접 조회
        catMealCount = (orderMealStats2[`cat_${cat.category_key}`] || 0)
      }
      const curDietPrice = catMealCount > 0 ? Math.round(catTotal / catMealCount) : 0
      const diff2 = targetPrice > 0 ? curDietPrice - targetPrice : 0
      const diffPct = targetPrice > 0 ? Math.round(diff2 / targetPrice * 100) : null
      const isOver2 = diff2 > 0; const isWarn2 = diffPct!==null&&diffPct>=-10&&!isOver2&&diffPct<0
      const dPriceColor = isOver2 ? '#dc2626' : isWarn2 ? '#d97706' : (curDietPrice>0?catColor:'#9ca3af')
      const statusIcon = isOver2 ? '🚨' : isWarn2 ? '⚠️' : (curDietPrice>0?'✅':'—')

      return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
        <span style="background:${catColor};color:white;font-size:8px;font-weight:700;padding:1px 5px;border-radius:8px;min-width:28px;text-align:center;white-space:nowrap">${cat.category_name}</span>
        <div style="flex:1">
          ${curDietPrice > 0
            ? `<div style="font-size:11px;font-weight:700;color:${dPriceColor}">${statusIcon} ${curDietPrice.toLocaleString()}원/인</div>
               ${targetPrice > 0 ? `<div style="font-size:9px;color:#9ca3af">목표 ${targetPrice.toLocaleString()}원 ${diffPct!==null?`<span style="color:${dPriceColor};font-weight:600">(${diff2>0?'+':''}${diffPct}%)</span>`:''}</div>` : ''}`
            : (catTotal > 0 ? `<div style="font-size:10px;color:#9ca3af">⚠️ 식수 데이터 없음<div style="font-size:8px;color:#d1d5db">발주 ${fmtMan(catTotal)} 입력됨</div></div>` : `<div style="font-size:10px;color:#d1d5db">발주 미입력</div>`)}
        </div>
      </div>`
    }).join('')
    dietAlertEl.innerHTML = catRows || `<div style="font-size:10px;color:#9ca3af">카테고리 없음</div>`
  } else if (dietAlertEl) {
    dietAlertEl.innerHTML = `<div style="font-size:10px;color:#9ca3af">카테고리 설정 필요</div>`
  }

  // ── 4. 업체 발주 비중 ──
  const vendorShareEl = document.getElementById('vendorShareContent')
  if (vendorShareEl && vendors.length > 0) {
    // 업체별 발주 합계
    const vendorTotals = {}
    vendors.forEach(v => { vendorTotals[v.id] = 0 })
    if (hasCats) {
      document.querySelectorAll('.cat-order-input').forEach(inp => {
        const vid = parseInt(inp.dataset.vendor)
        const field = inp.dataset.field
        const val = parseOrderVal(inp.value)
        if (vid && vendorTotals[vid] !== undefined) {
          if (field === 'taxable') vendorTotals[vid] += val + Math.round(val * 0.1)
          else vendorTotals[vid] += val
        }
      })
    } else {
      document.querySelectorAll('.order-input').forEach(inp => {
        const vid = parseInt(inp.dataset.vendor)
        if (vid && vendorTotals[vid] !== undefined) {
          if (inp.dataset.type === 'taxable') {
            const val = parseOrderVal(inp.value)
            vendorTotals[vid] += val + Math.round(val * 0.1)
          } else {
            vendorTotals[vid] += parseOrderVal(inp.value)
          }
        }
      })
    }
    const grandV = Object.values(vendorTotals).reduce((a,b)=>a+b,0)
    const vendorColors = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#84cc16','#ec4899']
    const vendorBars = vendors.map((v, vi) => {
      const amt = vendorTotals[v.id] || 0
      const pct = grandV > 0 ? Math.round(amt/grandV*100) : 0
      const vColor = vendorColors[vi % vendorColors.length]
      if (amt === 0) return ''
      return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
        <div style="min-width:64px;font-size:9px;font-weight:700;color:${vColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${v.name}">${v.name}</div>
        <div style="flex:1;height:10px;background:#e5e7eb;border-radius:5px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${vColor};border-radius:5px;transition:width 0.4s"></div>
        </div>
        <div style="min-width:52px;text-align:right">
          <span style="font-size:9px;font-weight:700;color:${vColor}">${pct}%</span>
          <span style="font-size:8px;color:#9ca3af;margin-left:2px">${fmtMan(amt)}</span>
        </div>
      </div>`
    }).filter(Boolean).join('')
    vendorShareEl.innerHTML = grandV > 0
      ? vendorBars
      : `<div style="font-size:10px;color:#9ca3af">발주 데이터 없음</div>`

    // ── 업체 편중 감지 (70% 이상 시 경고) ──
    if (grandV > 0) {
      const biasedVendors = vendors.filter(v => {
        const pct = Math.round((vendorTotals[v.id]||0)/grandV*100)
        return pct >= 70
      })
      const biasEl = document.getElementById('vendorBiasAlert')
      if (biasEl) {
        if (biasedVendors.length > 0) {
          const v = biasedVendors[0]
          const bpct = Math.round((vendorTotals[v.id]||0)/grandV*100)
          biasEl.innerHTML = `<div style="font-size:10px;background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:5px 8px;margin-top:6px">⚠️ <strong style="color:#d97706">${v.name}</strong> 발주 비중 <strong style="color:#dc2626">${bpct}%</strong> — 편중 주의</div>`
          biasEl.style.display = 'block'
        } else {
          biasEl.style.display = 'none'
        }
      }
    }
  }

  // ── 5. 예산 소진 예상 경고 ──
  const forecastWarnEl = document.getElementById('budgetForecastWarn')
  if (forecastWarnEl && totalBudget > 0) {
    const today2 = new Date()
    const dayOfMonth = today2.getDate()
    const daysInMonth2 = new Date(today2.getFullYear(), today2.getMonth()+1, 0).getDate()
    const elapsedRatio = dayOfMonth / daysInMonth2
    // 현재 발주 합계 (실시간)
    let liveTotal2 = 0
    document.querySelectorAll('.cat-order-input, .order-input').forEach(inp => {
      const field = inp.dataset.field || inp.dataset.type
      const val = parseOrderVal(inp.value)
      if (field === 'taxable') liveTotal2 += val + Math.round(val * 0.1)
      else if (field !== 'total') liveTotal2 += val
    })
    // 월간 누적 발주액은 monthOrdered 변수 사용 (이미 계산됨)
    if (elapsedRatio > 0.05 && monthOrdered > 0) {
      const projectedTotal = Math.round(monthOrdered / elapsedRatio)
      const projectedPct = Math.round(projectedTotal / totalBudget * 100)
      if (projectedPct >= 95) {
        const projColor = projectedPct >= 110 ? '#dc2626' : '#d97706'
        const projIcon = projectedPct >= 110 ? '🚨' : '⚠️'
        forecastWarnEl.innerHTML = `<div style="font-size:10px;background:${projectedPct>=110?'#fee2e2':'#fef3c7'};border:1px solid ${projectedPct>=110?'#fca5a5':'#fde68a'};border-radius:6px;padding:5px 8px;margin-top:6px">${projIcon} 이달 예상 발주 <strong style="color:${projColor}">${fmtMan(projectedTotal)}</strong> (${projectedPct}%) — 예산 초과 예상</div>`
        forecastWarnEl.style.display = 'block'
      } else {
        forecastWarnEl.style.display = 'none'
      }
    } else {
      forecastWarnEl.style.display = 'none'
    }
  }
}

function updateDayTotal(date) {
  let total = 0
  const processedVendors = new Set()
  const vendorTotals = {}

  document.querySelectorAll(`.order-input[data-date="${date}"]`).forEach(inp => {
    const vendorId = inp.dataset.vendor
    if (processedVendors.has(vendorId)) return
    processedVendors.add(vendorId)
    const taxableEl = document.querySelector(`input.order-input[data-vendor="${vendorId}"][data-type="taxable"][data-date="${date}"]`)
    const exemptEl = document.querySelector(`input.order-input[data-vendor="${vendorId}"][data-type="exempt"][data-date="${date}"]`)
    const t = parseOrderVal(taxableEl?.value)
    const e = parseOrderVal(exemptEl?.value)
    const vTotal = t + Math.round(t*0.1) + e
    total += vTotal
    vendorTotals[vendorId] = vTotal
  })

  // 카테고리 모드: dayRatioCell 업데이트
  const ratioCell = document.getElementById(`dayRatioCell-${date}`)
  if (ratioCell) {
    // cat-order-input 으로 카테고리별 합계 계산
    const vendors = window._ordersVendors || []
    const patientCats = window._patientCats || []
    const catTotals = {}
    patientCats.forEach(cat => { catTotals[cat.id] = 0 })
    document.querySelectorAll(`.cat-order-input[data-date="${date}"]`).forEach(inp => {
      const catId = parseInt(inp.dataset.category)
      const field = inp.dataset.field
      const val = parseOrderVal(inp.value)
      if (catTotals[catId] === undefined) catTotals[catId] = 0
      if (field === 'taxable') catTotals[catId] += val + Math.round(val * 0.1)
      else catTotals[catId] += val
    })
    const grandTotal = Object.values(catTotals).reduce((a,b)=>a+b,0)

    const budget = window._ordersBudget
    const row = document.querySelector(`tr[data-date="${date}"]`)
    const multidays = row ? parseInt(row.dataset.multidays || '1') : 1
    const isCovered = row ? row.dataset.covered === '1' : false
    const adjBudget = budget && !isCovered ? budget.dailyBudget * multidays : 0
    const dayPct = adjBudget > 0 ? Math.round(grandTotal / adjBudget * 100) : null
    const dOver = dayPct!==null&&dayPct>=100; const dWarn = dayPct!==null&&dayPct>=80&&!dOver
    const dColor = dOver?'#dc2626':dWarn?'#d97706':'#166534'
    const dBg = dOver?'#fee2e2':dWarn?'#fef3c7':'#f0fdf4'

    // 비중 바 재계산
    const barsHtml = patientCats.map(cat => {
      const catColor = getCategoryColorHex(cat.category_key)
      const catAmt = catTotals[cat.id] || 0
      const pct = grandTotal > 0 ? Math.round(catAmt / grandTotal * 100) : 0
      return `<div style="display:flex;align-items:center;gap:2px;margin-bottom:1px">
        <div style="width:${Math.max(pct,2)}%;max-width:100%;height:5px;background:${catColor};border-radius:2px;min-width:2px"></div>
        <span style="font-size:8px;color:${catColor};font-weight:700;white-space:nowrap">${pct}%</span>
      </div>`
    }).join('')

    ratioCell.innerHTML = `<div style="font-size:9px;color:#9ca3af;margin-bottom:1px">일별 발주</div><div style="font-size:10px;font-weight:700;color:${dColor}">${grandTotal>0?fmt(grandTotal):'-'}</div>${dayPct!==null?`<div style="font-size:9px;color:${dColor};font-weight:600">${dayPct}%</div>`:(grandTotal>0&&adjBudget===0?'<div style="font-size:8px;color:#d1d5db">목표 미설정</div>':'')}<div style="margin-top:3px;border-top:1px solid #e5e7eb;padding-top:2px">${barsHtml}</div>`
    ratioCell.style.background = grandTotal > 0 ? dBg : '#f9fafb'

    // 카테고리별 소계 셀(vcatsubt) + 업체합산(vcat-sum) 업데이트
    patientCats.forEach(cat => {
      const catColor = getCategoryColorHex(cat.category_key)
      vendors.forEach(v => {
        const subtEl = document.getElementById(`vcatsubt-${v.id}-${cat.id}-${date}`)
        if (subtEl) {
          const taxableEl = document.querySelector(`.cat-order-input[data-vendor="${v.id}"][data-category="${cat.id}"][data-field="taxable"][data-date="${date}"]`)
          const exemptEl  = document.querySelector(`.cat-order-input[data-vendor="${v.id}"][data-category="${cat.id}"][data-field="exempt"][data-date="${date}"]`)
          const totalEl   = document.querySelector(`.cat-order-input[data-vendor="${v.id}"][data-category="${cat.id}"][data-field="total"][data-date="${date}"]`)
          const t = parseOrderVal(taxableEl?.value)
          const e = parseOrderVal(exemptEl?.value)
          const tot = parseOrderVal(totalEl?.value)
          const catAmt = t > 0 || e > 0 ? t + Math.round(t*0.1) + e : tot
          subtEl.textContent = catAmt > 0 ? fmtMan(catAmt) : ''
          subtEl.style.color = catColor
        }
        // 업체합산: 이 업체의 이날 모든 카테고리 합계 (첫 번째 카테고리 행의 합산셀 업데이트)
        if (cat === patientCats[0]) {
          const sumEl = document.getElementById(`vcat-sum-${v.id}-first-${date}`)
          if (sumEl) {
            let vAllCatsAmt = 0
            patientCats.forEach(pc => {
              const txEl = document.querySelector(`.cat-order-input[data-vendor="${v.id}"][data-category="${pc.id}"][data-field="taxable"][data-date="${date}"]`)
              const exEl = document.querySelector(`.cat-order-input[data-vendor="${v.id}"][data-category="${pc.id}"][data-field="exempt"][data-date="${date}"]`)
              const totEl = document.querySelector(`.cat-order-input[data-vendor="${v.id}"][data-category="${pc.id}"][data-field="total"][data-date="${date}"]`)
              const tx2 = parseOrderVal(txEl?.value)
              const ex2 = parseOrderVal(exEl?.value)
              const tot2 = parseOrderVal(totEl?.value)
              vAllCatsAmt += tx2 > 0 || ex2 > 0 ? tx2 + Math.round(tx2*0.1) + ex2 : tot2
            })
            sumEl.textContent = vAllCatsAmt > 0 ? fmt(vAllCatsAmt) : ''
          }
        }
      })
      // catDayTotal 셀 업데이트
      const catSettings = (window._catSettingsMap || {})[cat.id] || {}
      const catDB = catSettings.working_days > 0 ? Math.round((catSettings.monthly_budget||0)/catSettings.working_days) : 0
      const catCatAmt = catTotals[cat.id] || 0
      const catPct = catDB > 0 ? Math.round(catCatAmt/catDB*100) : null
      const catOver = catPct!==null&&catPct>=100; const catWarn = catPct!==null&&catPct>=80&&!catOver
      const catAmtColor = catOver?'#dc2626':catWarn?'#d97706':catColor
      const el = document.getElementById(`catDayTotal-${date}-${cat.id}`)
      if (el) {
        const badge = `<div style="display:inline-block;background:${catColor};color:white;font-size:8px;font-weight:700;padding:1px 4px;border-radius:8px;margin-bottom:2px;white-space:nowrap">${cat.category_name}</div>`
        const amtDisp = catCatAmt > 0 ? `<div style="font-size:10px;font-weight:700;color:${catAmtColor}">${fmtMan(catCatAmt)}</div>` : `<div style="font-size:9px;color:#d1d5db">-</div>`
        const pctDisp = catPct!==null ? `<div style="font-size:9px;color:${catAmtColor};font-weight:600">${catPct}%</div>` : ''
        el.innerHTML = badge + amtDisp + pctDisp
      }
    })
    // ── 아코디언 요약 행 카테고리 합계 셀 실시간 업데이트 ──
    const row2 = document.querySelector(`tr.order-summary-row[data-date="${date}"]`)
    const multidays2 = row2 ? parseInt(row2.dataset.multidays || '1') : 1
    const isCovered2 = row2 ? row2.dataset.covered === '1' : false
    const budget2 = window._ordersBudget
    patientCats.forEach(cat => {
      const catColor = getCategoryColorHex(cat.category_key)
      const catSettings4 = (window._catSettingsMap || {})[cat.id] || {}
      const catDB4 = catSettings4.working_days > 0 ? Math.round((catSettings4.monthly_budget||0)/catSettings4.working_days) : 0
      const catAdjBudget4 = isCovered2 ? 0 : catDB4 * multidays2
      const catAmt4 = catTotals[cat.id] || 0
      const catPct4 = catAdjBudget4 > 0 ? Math.round(catAmt4/catAdjBudget4*100) : null
      const catOver4 = catPct4!==null&&catPct4>=100; const catWarn4 = catPct4!==null&&catPct4>=80&&!catOver4
      const catAmtColor4 = catOver4?'#dc2626':catWarn4?'#d97706':(catAmt4>0?catColor:'#9ca3af')
      const summEl = document.getElementById(`summCatAmt-${cat.id}-${date}`)
      if (summEl) {
        summEl.innerHTML = `<div style="font-size:8px;color:${catColor}99;margin-bottom:1px;font-weight:600">${cat.category_name}</div><div style="font-size:11px;font-weight:700;color:${catAmtColor4}">${catAmt4>0?fmtMan(catAmt4):'<span style="color:#e5e7eb">-</span>'}</div>${catPct4!==null?`<div style="font-size:9px;color:${catAmtColor4};font-weight:600">${catPct4}%${catOver4?' 🚨':catWarn4?' ⚠️':''}</div>`:(catAmt4>0?'<div style="font-size:8px;color:#d1d5db">목표 미설정</div>':'')}`
        summEl.style.background = catAmt4 > 0 ? catColor + '12' : ''
      }
    })
    // ── 요약 행 합계/진행률 셀(dayRatioCell) 업데이트 ──
    const summRatioEl = document.getElementById(`dayRatioCell-${date}`)
    if (summRatioEl) {
      const budgetAdj = budget2 && !isCovered2 ? budget2.dailyBudget * multidays2 : 0
      const grandPct2 = budgetAdj > 0 ? Math.round(grandTotal / budgetAdj * 100) : null
      const dOver2 = grandPct2!==null&&grandPct2>=100; const dWarn2 = grandPct2!==null&&grandPct2>=80&&!dOver2
      const dColor2 = dOver2?'#dc2626':dWarn2?'#d97706':(grandTotal>0?'#166534':'#6b7280')
      summRatioEl.innerHTML = `<div style="font-size:9px;color:#9ca3af;margin-bottom:1px">일별 발주</div><div style="font-size:11px;font-weight:700;color:${dColor2}">${grandTotal>0?fmtMan(grandTotal):'<span style="color:#d1d5db">-</span>'}</div>${grandPct2!==null?`<div style="font-size:9px;color:${dColor2};font-weight:600">${grandPct2}%${dOver2?' 🚨':dWarn2?' ⚠️':''}</div>`:(grandTotal>0&&budgetAdj===0?'<div style="font-size:8px;color:#d1d5db">목표 미설정</div>':'')}${budgetAdj>0?`<div style="font-size:8px;color:#9ca3af">/${fmtMan(budgetAdj)}</div>`:''}`
      summRatioEl.style.background = dOver2?'#fee2e2':dWarn2?'#fef3c7':'#f8fafc'
    }
    // ── 상세 행 dayRatioCell-detail도 업데이트 ──
    const detailRatioEl = document.getElementById(`dayRatioCell-detail-${date}`)
    if (detailRatioEl) {
      const budgetAdj3 = budget2 && !isCovered2 ? budget2.dailyBudget * multidays2 : 0
      const grandPct3 = budgetAdj3 > 0 ? Math.round(grandTotal / budgetAdj3 * 100) : null
      const dOver3 = grandPct3!==null&&grandPct3>=100; const dWarn3 = grandPct3!==null&&grandPct3>=80&&!dOver3
      const dColor3 = dOver3?'#dc2626':dWarn3?'#d97706':(grandTotal>0?'#166534':'#6b7280')
      detailRatioEl.innerHTML = `<div style="font-size:11px;font-weight:700;color:${dColor3}">${grandTotal>0?fmtMan(grandTotal):'-'}</div>${grandPct3!==null?`<div style="font-size:9px;color:${dColor3};font-weight:600">${grandPct3}%${dOver3?' 🚨':dWarn3?' ⚠️':''}</div>`:''}`
      detailRatioEl.style.background = dOver3?'#fee2e2':dWarn3?'#fef3c7':'white'
    }
    // 카테고리 모드에서도 주별 진행률 실시간 업데이트
    updateWeekPctCell(date)

    // ── 탭 내 업체 월 누적 금액 실시간 업데이트 ──
    patientCats.forEach(cat => {
      const catColor = getCategoryColorHex(cat.category_key)
      const catSettings5 = (window._catSettingsMap || {})[cat.id] || {}
      const catMonthBudget5 = catSettings5.monthly_budget || 0
      const vendorsBudget = window._ordersVendors || []
      const vCount = vendorsBudget.length || 1

      vendorsBudget.forEach(v => {
        const accumEl = document.getElementById(`vcat-month-accum-${v.id}-${cat.id}`)
        if (!accumEl) return
        // 이 업체×카테고리의 전체 월 누적 합산 (현재 입력값 포함)
        let vCatLiveTotal = 0
        document.querySelectorAll(`.cat-order-input[data-vendor="${v.id}"][data-category="${cat.id}"]`).forEach(inp2 => {
          const fld = inp2.dataset.field
          const val2 = parseOrderVal(inp2.value)
          if (fld === 'taxable') vCatLiveTotal += val2 + Math.round(val2 * 0.1)
          else vCatLiveTotal += val2
        })

        // 업체 자체 monthly_budget 우선, 없으면 카테고리 예산 균등 배분
        const vMonthBudget5 = (v.monthly_budget > 0) ? v.monthly_budget : (catMonthBudget5 > 0 ? Math.round(catMonthBudget5 / vCount) : 0)
        const vMonthPct5 = vMonthBudget5 > 0 ? Math.round(vCatLiveTotal / vMonthBudget5 * 100) : null
        const vMonthOver5 = vMonthPct5!==null&&vMonthPct5>=100
        const vMonthWarn5 = vMonthPct5!==null&&vMonthPct5>=80&&!vMonthOver5
        const vMonthColor5 = vMonthOver5?'#dc2626':vMonthWarn5?'#d97706':catColor

        accumEl.textContent = vCatLiveTotal > 0 ? fmtMan(vCatLiveTotal) : '0'
        accumEl.style.color = vMonthColor5

        // 업체 카드 테두리 색상 업데이트
        const cardEl = document.getElementById(`vendor-card-${v.id}-${cat.id}-${date}`)
        if (cardEl) {
          const hasAmt = (catTotals[cat.id] || 0) > 0
          cardEl.style.borderColor = hasAmt ? catColor + '80' : '#e5e7eb'
          // 진행률 바 업데이트
          const barEl = cardEl.querySelector('[id^="vbar-"]')
          if (!barEl && vMonthBudget5 > 0) {
            // 진행률 바가 있으면 너비 업데이트 (동적 선택)
            const bars = cardEl.querySelectorAll('[style*="height:4px"]')
            bars.forEach(bar => {
              if (bar.style.width !== undefined && bar.parentElement) {
                // 진행률 바 내부 div
                const innerBar = bar.style.background && bar.style.background !== '#e5e7eb' ? bar : null
                if (innerBar) {
                  innerBar.style.width = Math.min(vMonthPct5||0, 100) + '%'
                  innerBar.style.background = vMonthColor5
                }
              }
            })
          }
        }
      })
    })

    // 예산 진행 패널 갱신
    if (typeof updateBudgetProgressPanel === 'function') updateBudgetProgressPanel()
    return
  }

  // 기존 모드 (카테고리 없을 때)
  const dayTotalEl = document.getElementById(`dayTotal-${date}`)
  if (dayTotalEl) dayTotalEl.textContent = total > 0 ? fmt(total) : ''

  const budget = window._ordersBudget
  if (budget) {
    const row = document.querySelector(`tr[data-date="${date}"]`)
    const multidays = row ? parseInt(row.dataset.multidays || '1') : 1
    const isCovered = row ? row.dataset.covered === '1' : false
    const adjBudget = isCovered ? 0 : budget.dailyBudget * multidays
    const dayPct = adjBudget > 0 ? Math.round(total / adjBudget * 100) : null
    const dOver = dayPct !== null && dayPct >= 100
    const dWarn = dayPct !== null && dayPct >= 80 && !dOver
    const dColor = dOver ? '#dc2626' : dWarn ? '#d97706' : '#16a34a'
    const dBg = dOver ? '#fee2e2' : dWarn ? '#fef3c7' : (dayPct !== null && total > 0 ? '#f0fdf4' : '')
    if (dayTotalEl) {
      dayTotalEl.style.color = dOver ? '#dc2626' : dWarn ? '#d97706' : ''
      dayTotalEl.style.fontWeight = (dOver || dWarn) ? '700' : ''
    }
  }
  // 주별 진행률 셀 실시간 업데이트
  updateWeekPctCell(date)
  if (typeof updateBudgetProgressPanel === 'function') updateBudgetProgressPanel()
}

function updateWeekPctCell(date) {
  const row = document.querySelector(`tr[data-date="${date}"]`)
  if (!row) return
  const weekKey = row.dataset.weekStart
  if (!weekKey) return
  const weekPctCell = document.getElementById(`weekPctCell-${weekKey}`)
  if (!weekPctCell) return
  const budget = window._ordersBudget
  if (!budget) return

  // 이 주에 속한 모든 날짜 행의 발주금액 재합산
  const weekRows = document.querySelectorAll(`tr[data-week-start="${weekKey}"][data-date]`)
  let wTotal = 0

  const patientCats = window._patientCats || []
  const hasCats = patientCats.length > 0

  if (hasCats) {
    // 카테고리 모드: cat-order-input 합산
    const seenKeys = new Set()
    weekRows.forEach(wr => {
      if (wr.dataset.covered === '1') return
      const d = wr.dataset.date
      document.querySelectorAll(`.cat-order-input[data-date="${d}"]`).forEach(inp => {
        const field = inp.dataset.field
        const catId = inp.dataset.category
        const vendor = inp.dataset.vendor
        const key = `${d}-${vendor}-${catId}-${field}`
        if (seenKeys.has(key)) return; seenKeys.add(key)
        const val = parseInt(inp.value?.replace(/,/g,'') || 0) || 0
        if (field === 'taxable') wTotal += val + Math.round(val * 0.1)
        else if (field === 'exempt') wTotal += val
      })
    })
  } else {
    // 일반 모드: order-input 합산
    weekRows.forEach(wr => {
      if (wr.dataset.covered === '1') return
      const d = wr.dataset.date
      const processedVendors = new Set()
      document.querySelectorAll(`.order-input[data-date="${d}"]`).forEach(inp => {
        const vendorId = inp.dataset.vendor
        if (processedVendors.has(vendorId)) return
        processedVendors.add(vendorId)
        const taxableEl = document.querySelector(`input.order-input[data-vendor="${vendorId}"][data-type="taxable"][data-date="${d}"]`)
        const exemptEl  = document.querySelector(`input.order-input[data-vendor="${vendorId}"][data-type="exempt"][data-date="${d}"]`)
        const t = parseInt(taxableEl?.value?.replace(/,/g,'') || 0) || 0
        const e = parseInt(exemptEl?.value?.replace(/,/g,'') || 0) || 0
        wTotal += t + Math.round(t * 0.1) + e
      })
    })
  }

  const weekBudget = parseInt(weekPctCell.dataset.weekBudget || 0) || budget.weekBudget || 0
  const wPct = weekBudget > 0 ? Math.round(wTotal / weekBudget * 100) : null
  const wOver = wPct !== null && wPct >= 100
  const wWarn = wPct !== null && wPct >= 80 && !wOver
  const wColor = wOver ? '#dc2626' : wWarn ? '#d97706' : '#166534'
  const isCurrentWeek = weekPctCell.dataset.weekIsCurrent === '1'
  const weekNum = weekPctCell.dataset.weekNum || ''
  const weekLabel = weekPctCell.dataset.weekLabel || ''
  const wBadgeBg = isCurrentWeek ? '#0284c7' : (wOver ? '#dc2626' : wWarn ? '#d97706' : '#166534')
  const wPctBar = wPct !== null
    ? `<div style="height:4px;background:rgba(255,255,255,0.3);border-radius:2px;margin-top:3px"><div style="height:4px;width:${Math.min(wPct,100)}%;background:${wColor};border-radius:2px"></div></div>`
    : ''
  weekPctCell.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:3px">
      <div style="display:inline-flex;align-items:center;background:${wBadgeBg};color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:9px;white-space:nowrap">${weekNum}주${isCurrentWeek?'(현재)':''}</div>
      <span style="font-size:${isCurrentWeek?'13px':'12px'};font-weight:800;color:${wColor};white-space:nowrap">${wPct !== null ? wPct + '%' : '-'}${wOver?' 🚨':wWarn?' ⚠️':''}</span>
    </div>
    <div style="font-size:8px;color:#6b7280;margin-top:1px;white-space:nowrap">${weekLabel}</div>
    <div style="font-size:9px;font-weight:700;color:${wColor};white-space:nowrap">${fmtMan(wTotal)}<span style="color:#9ca3af;font-size:8px;font-weight:400"> /${fmtMan(weekBudget)}</span></div>
    ${wPctBar}
  `
}

// ══════════════════════════════════════════════════════════════
//  식수 입력 페이지
// ══════════════════════════════════════════════════════════════
// 전역: 현재 커스텀 필드 목록
window._mealCustomFields = []

async function renderMeals() {
  const content = document.getElementById('meals-panel') || document.getElementById('pageContent')
  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`

  // 식수 데이터 + 카테고리 발주 합계 병렬 로드
  const [resp, catOrderData] = await Promise.all([
    api('GET', `/api/meals/${App.currentYear}/${App.currentMonth}`),
    api('GET', `/api/orders/category-monthly/${App.currentYear}/${App.currentMonth}`)
  ])
  if (!resp) return

  // 구버전(배열) 호환
  const mealData = Array.isArray(resp) ? resp : (resp.meals || [])
  window._mealCustomFields = Array.isArray(resp) ? [] : (resp.customFields || [])
  window._mealPatientCats = Array.isArray(resp) ? [] : (resp.patientCategories || [])

  // 카테고리별 월 발주 합계: { catId: amount }
  const catMonthTotals = {}
  ;(catOrderData?.monthly || []).forEach(r => {
    catMonthTotals[r.patient_category_id] = (catMonthTotals[r.patient_category_id]||0) + (r.total||0)
  })
  window._catMonthTotals = catMonthTotals

  // 카테고리 설정(예산/목표식단가) 저장 - 발주 페이지에서 이미 로드됐으면 덮어쓰지 않음
  window._catOrderSettings = catOrderData?.settings || window._catOrderSettings || []

  renderMealsContent(content, mealData, window._mealCustomFields, window._mealPatientCats)
}

function renderMealsContent(content, mealData, customFields, patientCats) {
  patientCats = patientCats || []
  const days = getDaysInMonth(App.currentYear, App.currentMonth)
  const mealMap = {}
  mealData.forEach(m => {
    mealMap[m.meal_date] = m
    // custom_data JSON 파싱
    try { m._custom = JSON.parse(m.custom_data || '{}') } catch(e) { m._custom = {} }
  })

  // 월 합계 계산 (기본 - 환자 컬럼은 화면 표시 없음, 데이터 유지만)
  let monthTotal = { s:0, n:0, g:0, custom:{} }
  customFields.forEach(f => { monthTotal.custom[f.field_key] = 0 })
  mealData.forEach(m => {
    monthTotal.s += (m.breakfast_staff||0)+(m.lunch_staff||0)+(m.dinner_staff||0)
    monthTotal.n += (m.breakfast_noncovered||0)+(m.lunch_noncovered||0)+(m.dinner_noncovered||0)
    monthTotal.g += (m.breakfast_guardian||0)+(m.lunch_guardian||0)+(m.dinner_guardian||0)
    customFields.forEach(f => {
      const cd = m._custom?.[f.field_key] || {}
      monthTotal.custom[f.field_key] = (monthTotal.custom[f.field_key]||0) + (cd.bf||0) + (cd.l||0) + (cd.d||0)
    })
  })

  // 기본 + 커스텀 합계 (커스텀 중 ea 단위는 grandTotal에서 제외)
  const customTotalForMeals = customFields
    .filter(f => f.unit_type !== 'ea')
    .reduce((s, f) => s + (monthTotal.custom[f.field_key] || 0), 0)
  // 총 식수: 비급여 제외, ea 커스텀 필드 제외, 환자 제외(환자군으로 대체)
  const grandTotal = monthTotal.s + monthTotal.g + customTotalForMeals

  // 헤더 서브컬럼 생성: 직원/비급/보호 + 환자군(커스텀필드)들 + 합
  const baseLabels = ['직원','비급','보호']
  const customLabels = customFields.map(f => f.field_name)
  const allLabels = [...baseLabels, ...customLabels]
  const colCount = allLabels.length + 1  // +1 = 소계

  content.innerHTML = `
  <!-- 월 합계 요약 카드 -->
  <div class="flex flex-wrap gap-2 mb-4" id="mealSummaryCards">
    ${buildMealSummaryCards(monthTotal, customFields, grandTotal)}
  </div>

  <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
    <div class="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
      <div>
        <h2 class="font-bold text-gray-800 text-sm md:text-base">${App.currentYear}년 ${App.currentMonth}월 식수 현황</h2>
        <p class="text-xs text-gray-400 mt-0.5 hidden md:block">조식/중식/석식 × 식수 카테고리</p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <button onclick="saveMealBatch()" class="btn btn-success btn-sm">
          <i class="fas fa-save"></i> 저장
        </button>
        <!-- 칸 생성 버튼 제거: 환자군은 관리자에서 설정하면 자동 반영됩니다 -->
      </div>
    </div>
    <div class="overflow-x-auto" style="-webkit-overflow-scrolling:touch;">
      <div class="scroll-hint"><i class="fas fa-arrows-left-right"></i>좌우로 스크롤하여 전체 식수 입력</div>
      <table class="meal-table w-full" id="mealMainTable" style="font-size:12px;border-collapse:collapse">
        <thead>
          <tr>
            <th rowspan="2" style="min-width:28px;border:2px solid #1e5c3a">일</th>
            <th rowspan="2" style="min-width:22px;border:2px solid #1e5c3a">요</th>
            <th colspan="${colCount}" style="border:2px solid #1d4ed8;border-bottom:1px solid #3b82f6;background:#1e40af">조식</th>
            <th colspan="${colCount}" style="border:2px solid #166534;border-bottom:1px solid #22c55e;background:#14532d">중식</th>
            <th colspan="${colCount}" style="border:2px solid #6b21a8;border-bottom:1px solid #a855f7;background:#581c87">석식</th>
            <th colspan="${allLabels.length + 1}" style="border:2px solid #374151;border-bottom:1px solid #6b7280;background:#0f2942">합계</th>
          </tr>
          <tr>
            ${['bf','l','d','t'].map((prefix, mi) => {
              const borderColors = ['#3b82f6','#22c55e','#a855f7','#6b7280']
              const border = borderColors[mi]
              const isTot = mi===3
              return allLabels.map((label, li) => {
                const isFirst = li===0
                const isLast = li===allLabels.length-1
                const isCustom = li >= 3  // 직원(0)/비급(1)/보호(2) 이후부터 환자군 커스텀
                const bg = isTot ? 'background:#0f2942;' : isCustom ? 'background:#1a2f4a;' : ''
                const bl = isFirst ? `border-left:3px solid ${border};` : 'border-left:1px solid rgba(255,255,255,0.15);'
                const br = isLast ? `;border-right:1px solid rgba(255,255,255,0.15)` : ''
                return `<th style="${bl}border-top:1px solid ${border};border-bottom:1px solid ${border}${br};padding:3px 2px;${bg}font-size:10px">${label}</th>`
              }).join('') + `<th style="border:1px solid rgba(255,255,255,0.15);border-right:3px solid ${border};padding:3px 2px;background:${isTot?'#0f2942':'#1e3a6e'};color:#93c5fd;font-size:10px">합</th>`
            }).join('')}
          </tr>
        </thead>
        <tbody id="mealTableBody">
          ${Array.from({ length: days }, (_, i) => buildMealRow(i+1, mealMap, customFields, colCount)).join('')}
        </tbody>
        <tfoot>
          ${buildMealFooter(mealData, customFields, monthTotal, grandTotal, colCount)}
        </tfoot>
      </table>
    </div>
  </div>

  `
  // 환자군별 식단가 현황은 월별 대시보드로 이동됨

  bindMealInputEvents()
}

function buildMealSummaryCards(monthTotal, customFields, grandTotal) {
  // 환자 카드 제거 (환자군 커스텀 필드로 대체), 직원/비급/보호만 기본 표시
  const baseCards = [
    { label:'직원식', val:monthTotal.s, color:'green', id:'mealSummary-s' },
    { label:'비급여', val:monthTotal.n, color:'purple', id:'mealSummary-n' },
    { label:'보호자', val:monthTotal.g, color:'orange', id:'mealSummary-g' },
  ]
  const customCards = customFields.map(f => ({
    label: f.field_name, val: monthTotal.custom[f.field_key]||0, color:'indigo', id:`mealSummary-${f.field_key}`, unit: f.unit_type||'meal'
  }))
  const totalCard = { label:'총식수', val:grandTotal, color:'gray', id:'mealSummary-total', bold:true, unit:'meal' }
  return [...baseCards, ...customCards, totalCard].map(item => {
    const unitStr = item.unit === 'ea' ? '개' : '식'
    return `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-2 text-center" style="min-width:72px">
      <div class="text-xs text-gray-500 font-medium mb-0.5">${item.label}${item.unit==='ea'?'<span style="font-size:9px;color:#f97316">(ea)</span>':''}</div>
      <div class="text-base font-bold text-${item.color}-600" id="${item.id}">${fmt(item.val)}</div>
      <div class="text-xs text-gray-400">${unitStr}</div>
    </div>`
  }).join('')
}

// ── 환자군별 식단가 패널 ──────────────────────────────────────
function buildMealPricePanel(patientCats, customFields, mealData) {
  // 카테고리 설정 (발주 예산)
  const catSettings = window._catOrderSettings || []
  const catSettingsMap = {}
  catSettings.forEach(s => { catSettingsMap[s.patient_category_id] = s })

  // 이번 달 전체 발주 합계 (catMonthTotals)
  const catMonthTotals = window._catMonthTotals || {}

  // 환자군별 식수 집계: customFields에서 cat_ 접두어 가진 것만
  // mealData에서 custom_data의 cat_* 키 합산
  const catMealTotals = {}  // { category_key: total_meals }
  patientCats.forEach(cat => { catMealTotals[cat.category_key] = 0 })

  mealData.forEach(m => {
    let cd = {}
    try { cd = JSON.parse(m.custom_data || '{}') } catch(e) {}
    patientCats.forEach(cat => {
      const fieldKey = `cat_${cat.category_key}`
      const v = cd[fieldKey] || {}
      catMealTotals[cat.category_key] = (catMealTotals[cat.category_key] || 0) + (v.bf||0) + (v.l||0) + (v.d||0)
    })
  })

  // 기본 항목 (직원,비급,보호) 월 합계
  const basicTotals = { staff: 0, noncovered: 0, guardian: 0 }
  mealData.forEach(m => {
    basicTotals.staff += (m.breakfast_staff||0)+(m.lunch_staff||0)+(m.dinner_staff||0)
    basicTotals.noncovered += (m.breakfast_noncovered||0)+(m.lunch_noncovered||0)+(m.dinner_noncovered||0)
    basicTotals.guardian += (m.breakfast_guardian||0)+(m.lunch_guardian||0)+(m.dinner_guardian||0)
  })

  const catColors = {
    cancer: '#dc2626', nursing: '#16a34a', default_0: '#7c3aed',
    default_1: '#0369a1', default_2: '#b45309', default_3: '#be185d'
  }

  const rows = patientCats.map((cat, ci) => {
    const color = catColors[cat.category_key] || catColors[`default_${ci % 4}`] || '#6b7280'
    const s = catSettingsMap[cat.id] || {}
    const monthBudget = catMonthTotals[cat.id] || 0   // 실제 발주 총액
    const targetBudget = s.monthly_budget || 0
    const catMeals = catMealTotals[cat.category_key] || 0
    // 식단가 = 발주금액 / (환자군 식수 + 직원 + 보호자)
    // 비급여는 제외, 기본 직원/보호는 포함
    const totalMealsForPrice = catMeals + basicTotals.staff + basicTotals.guardian
    const mealPrice = totalMealsForPrice > 0 ? Math.round(monthBudget / totalMealsForPrice) : 0
    // 환자군만 기준 식단가 (환자군 식수만으로)
    const mealPriceCatOnly = catMeals > 0 ? Math.round(monthBudget / catMeals) : 0
    const targetMealPrice = s.target_meal_price || 0
    const priceDiff = targetMealPrice > 0 ? mealPrice - targetMealPrice : null

    return `<div style="background:white;border-radius:12px;border:1px solid ${color}30;padding:12px 14px;border-left:4px solid ${color}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="background:${color};color:white;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px">${cat.category_name}</span>
          <span style="font-size:10px;color:#6b7280">식수: <strong style="color:${color}">${fmt(catMeals)}식</strong></span>
        </div>
        <div style="font-size:10px;color:#9ca3af">예산: ${targetBudget > 0 ? fmtWon(targetBudget) : '미설정'}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div style="background:${color}08;border-radius:8px;padding:8px;text-align:center">
          <div style="font-size:9px;color:#6b7280;margin-bottom:2px">발주 총액</div>
          <div style="font-size:13px;font-weight:700;color:${color}">${monthBudget > 0 ? fmtWon(monthBudget) : '-'}</div>
        </div>
        <div style="background:${color}08;border-radius:8px;padding:8px;text-align:center">
          <div style="font-size:9px;color:#6b7280;margin-bottom:2px">식단가(전체기준)</div>
          <div style="font-size:13px;font-weight:700;color:${mealPrice > 0 ? (priceDiff > 0 ? '#dc2626' : '#16a34a') : '#9ca3af'}">${mealPrice > 0 ? fmt(mealPrice)+'원' : '-'}</div>
          ${priceDiff !== null && mealPrice > 0 ? `<div style="font-size:9px;font-weight:600;color:${priceDiff > 0 ? '#dc2626' : '#16a34a'}">${priceDiff > 0 ? '▲+' : '▼'}${fmt(Math.abs(priceDiff))}원</div>` : ''}
        </div>
        <div style="background:${color}08;border-radius:8px;padding:8px;text-align:center">
          <div style="font-size:9px;color:#6b7280;margin-bottom:2px">식단가(환자군만)</div>
          <div style="font-size:13px;font-weight:700;color:${mealPriceCatOnly > 0 ? color : '#9ca3af'}">${mealPriceCatOnly > 0 ? fmt(mealPriceCatOnly)+'원' : '-'}</div>
          ${targetMealPrice > 0 ? `<div style="font-size:9px;color:#9ca3af">목표: ${fmt(targetMealPrice)}원</div>` : ''}
        </div>
      </div>
    </div>`
  }).join('')

  // 전체 합산 식단가 (비급여 제외 전체 식수 기준)
  const totalMeals = Object.values(catMealTotals).reduce((s,v)=>s+v,0) + basicTotals.staff + basicTotals.guardian
  const totalBudget = Object.values(catMonthTotals).reduce((s,v)=>s+v,0)
  const totalMealPrice = totalMeals > 0 ? Math.round(totalBudget / totalMeals) : 0

  // 가중평균 식단가 계산 (발주금액 비중 기준)
  let wPriceSum = 0, wBudgetSum = 0
  let wTargetSum = 0, wTargetBudgetSum = 0
  patientCats.forEach(cat => {
    const s = catSettingsMap[cat.id] || {}
    const monthAmt = catMonthTotals[cat.id] || 0
    const catMeals = catMealTotals[cat.category_key] || 0
    const totalMealsForPrice = catMeals + basicTotals.staff + basicTotals.guardian
    const mealPriceForCat = totalMealsForPrice > 0 ? Math.round(monthAmt / totalMealsForPrice) : 0
    const targetP = s.target_meal_price || 0
    const monthBudget = s.monthly_budget || 0
    if (monthAmt > 0 && mealPriceForCat > 0) {
      wPriceSum += monthAmt * mealPriceForCat
      wBudgetSum += monthAmt
    }
    if (monthBudget > 0 && targetP > 0) {
      wTargetSum += monthBudget * targetP
      wTargetBudgetSum += monthBudget
    }
  })
  const weightedCurrentPrice = wBudgetSum > 0 ? Math.round(wPriceSum / wBudgetSum) : 0
  const weightedTargetPrice  = wTargetBudgetSum > 0 ? Math.round(wTargetSum / wTargetBudgetSum) : 0
  const wDiff = weightedCurrentPrice > 0 && weightedTargetPrice > 0 ? weightedCurrentPrice - weightedTargetPrice : null
  const wOver = wDiff !== null && wDiff > 0
  const wWarn = wDiff !== null && !wOver && weightedCurrentPrice >= weightedTargetPrice * 0.9
  const wColor = wOver ? '#dc2626' : wWarn ? '#d97706' : '#16a34a'

  return `<div style="background:white;border-radius:16px;box-shadow:0 2px 8px rgba(0,0,0,0.06);border:1px solid #e5e7eb;padding:16px;margin-top:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h3 style="font-weight:700;color:#374151;font-size:14px"><i class="fas fa-calculator" style="color:#7c3aed;margin-right:4px"></i>환자군별 식단가 현황</h3>
      <div style="font-size:11px;color:#9ca3af">
        ${App.currentYear}년 ${App.currentMonth}월
        ${totalMeals > 0 ? `| 전체 ${fmt(totalMeals)}식 · <strong style="color:#374151">${fmt(totalMealPrice)}원/식</strong>` : ''}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px">
      ${rows}
    </div>
    <!-- 가중평균 식단가 요약 + 막대그래프 -->
    <div style="margin-top:12px;padding:12px 14px;background:linear-gradient(135deg,#faf5ff,#f0f9ff);border-radius:12px;border:1px solid #c084fc40">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:12px;font-weight:700;color:#7c3aed"><i class="fas fa-balance-scale" style="margin-right:4px"></i>가중평균 식단가 <span style="font-size:10px;color:#9ca3af;font-weight:400">(발주금액 비중 기준)</span></span>
        ${wDiff!==null&&weightedCurrentPrice>0?`<span style="font-size:11px;font-weight:700;color:${wColor}">${wOver?'▲ +':'▼ '}${fmt(Math.abs(wDiff))}원 ${wOver?'초과':wWarn?'주의':'이내'}</span>`:''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        <div style="background:white;border-radius:8px;padding:10px;text-align:center;border:1px solid #e9d5ff">
          <div style="font-size:10px;color:#6b7280;margin-bottom:3px">목표 가중평균</div>
          <div style="font-size:15px;font-weight:800;color:${weightedTargetPrice>0?'#7c3aed':'#d1d5db'}">${weightedTargetPrice>0?fmt(weightedTargetPrice)+'원/식':'미설정'}</div>
          <div style="font-size:9px;color:#9ca3af;margin-top:2px">카테고리별 목표예산 비중</div>
        </div>
        <div style="background:white;border-radius:8px;padding:10px;text-align:center;border:1px solid ${weightedCurrentPrice>0?wColor+'60':'#e5e7eb'}">
          <div style="font-size:10px;color:#6b7280;margin-bottom:3px">현재 가중평균</div>
          <div style="font-size:15px;font-weight:800;color:${weightedCurrentPrice>0?wColor:'#d1d5db'}">${weightedCurrentPrice>0?fmt(weightedCurrentPrice)+'원/식':'미입력'}</div>
          <div style="font-size:9px;color:#9ca3af;margin-top:2px">카테고리별 실발주 비중</div>
        </div>
      </div>
      <!-- 목표 대비 현재 막대그래프 -->
      ${weightedTargetPrice>0&&weightedCurrentPrice>0 ? (() => {
        const maxVal = Math.max(weightedTargetPrice, weightedCurrentPrice) * 1.15
        const targetPct = Math.min(Math.round(weightedTargetPrice / maxVal * 100), 100)
        const currentPct = Math.min(Math.round(weightedCurrentPrice / maxVal * 100), 100)
        const barColor = wOver ? '#dc2626' : wWarn ? '#d97706' : '#16a34a'
        const targetMarkerPct = Math.min(Math.round(weightedTargetPrice / maxVal * 100), 100)
        return `<div style="margin-bottom:4px">
          <div style="display:flex;justify-content:space-between;font-size:10px;color:#6b7280;margin-bottom:4px">
            <span>목표 대비 현재 식단가</span>
            <span style="font-weight:700;color:${barColor}">${Math.round(weightedCurrentPrice/weightedTargetPrice*100)}%</span>
          </div>
          <!-- 현재 막대 -->
          <div style="margin-bottom:5px">
            <div style="font-size:9px;color:#9ca3af;margin-bottom:2px">현재 <strong style="color:${barColor}">${fmt(weightedCurrentPrice)}원</strong></div>
            <div style="background:#e5e7eb;border-radius:4px;height:12px;position:relative;overflow:visible">
              <div style="height:100%;width:${currentPct}%;background:${barColor};border-radius:4px;transition:width 0.5s;position:relative">
                <span style="position:absolute;right:4px;top:50%;transform:translateY(-50%);font-size:8px;color:white;font-weight:700;white-space:nowrap">${currentPct>20?fmt(weightedCurrentPrice)+'원':''}</span>
              </div>
              <!-- 목표 위치 마커 -->
              <div style="position:absolute;top:-3px;left:${targetMarkerPct}%;transform:translateX(-50%);width:2px;height:18px;background:#7c3aed;border-radius:1px"></div>
            </div>
          </div>
          <!-- 목표 막대 -->
          <div>
            <div style="font-size:9px;color:#9ca3af;margin-bottom:2px">목표 <strong style="color:#7c3aed">${fmt(weightedTargetPrice)}원</strong></div>
            <div style="background:#e5e7eb;border-radius:4px;height:8px">
              <div style="height:100%;width:${targetPct}%;background:#c084fc;border-radius:4px"></div>
            </div>
          </div>
          <div style="margin-top:4px;font-size:9px;color:#9ca3af;text-align:right">▎ 세로 마커 = 목표 위치</div>
        </div>`
      })() : weightedTargetPrice===0 ? `<div style="text-align:center;font-size:10px;color:#d1d5db;padding:6px">목표 식단가 미설정 시 그래프 표시 불가</div>` : ''}
    </div>
    <div style="margin-top:10px;padding:8px 12px;background:#f8fafc;border-radius:8px;font-size:11px;color:#6b7280">
      💡 <strong>식단가 계산 기준</strong>: 환자군 식수 + 직원 + 보호자 합산 (비급여 제외) · <strong>가중평균</strong>: 카테고리별 발주금액 비중으로 식단가 가중합산
    </div>
  </div>`
}

function buildMealRow(day, mealMap, customFields, colCount) {
  const dow = getDayOfWeek(App.currentYear, App.currentMonth, day)
  const weekend = isWeekend(App.currentYear, App.currentMonth, day)
  const dateStr = `${App.currentYear}-${String(App.currentMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`
  const m = mealMap[dateStr] || {}
  const cd = m._custom || {}
  const rowClass = dow==='일'?'holiday-row':weekend?'weekend-row':''

  const bp=m.breakfast_patient||0, bs=m.breakfast_staff||0, bn=m.breakfast_noncovered||0, bg2=m.breakfast_guardian||0
  const lp=m.lunch_patient||0, ls=m.lunch_staff||0, ln=m.lunch_noncovered||0, lg=m.lunch_guardian||0
  const dp=m.dinner_patient||0, ds=m.dinner_staff||0, dn=m.dinner_noncovered||0, dg=m.dinner_guardian||0

  // 커스텀 값
  const cVals = customFields.map(f => ({
    key: f.field_key,
    bf: cd[f.field_key]?.bf || 0,
    l:  cd[f.field_key]?.l  || 0,
    d:  cd[f.field_key]?.d  || 0,
  }))

  // 소계: 환자 컬럼 숨겼으므로 환자 제외 (직원+비급+보호+커스텀)
  const bfSum = bs+bn+bg2 + cVals.reduce((s,c)=>s+c.bf,0)
  const lSum  = ls+ln+lg  + cVals.reduce((s,c)=>s+c.l,0)
  const dSum  = ds+dn+dg  + cVals.reduce((s,c)=>s+c.d,0)
  const tsSum=bs+ls+ds, tnSum=bn+ln+dn, tgSum=bg2+lg+dg
  // 총 식수(t-total): 비급여 제외, ea 단위 커스텀 필드 제외, 환자 제외(환자군으로 대체)
  const cValsForMeals = cVals.filter((_,i) => (customFields[i]?.unit_type||'meal') !== 'ea')
  const tGrand = tsSum + tgSum + cValsForMeals.reduce((s,c)=>s+c.bf+c.l+c.d,0)

  const mealSections = [
    // 환자(bf_p, l_p, d_p)는 hidden input으로 유지 (데이터 보존), 표시 안 함
    // base 배열에서 환자(_p) 항목 제거 → 직원/비급/보호만 표시
    { prefix:'bf', border:'#3b82f6', bg:'#dbeafe', base:[{k:'bf_s',v:bs},{k:'bf_n',v:bn},{k:'bf_g',v:bg2}], cPrefix:'bf', sum:bfSum, sumId:`bf-sum-${dateStr}`, sumBg:'bg-blue-50 text-blue-800' },
    { prefix:'l',  border:'#22c55e', bg:'#dcfce7', base:[{k:'l_s',v:ls},{k:'l_n',v:ln},{k:'l_g',v:lg}],   cPrefix:'l',  sum:lSum,  sumId:`l-sum-${dateStr}`,  sumBg:'bg-green-50 text-green-800' },
    { prefix:'d',  border:'#a855f7', bg:'#f3e8ff', base:[{k:'d_s',v:ds},{k:'d_n',v:dn},{k:'d_g',v:dg}],   cPrefix:'d',  sum:dSum,  sumId:`d-sum-${dateStr}`,  sumBg:'bg-purple-50 text-purple-800' },
  ]

  let cells = ''
  // 환자 hidden input (데이터 보존용 - 화면 미표시)
  cells += `<td style="display:none">${makeMealInput('bf_p', dateStr, bp)}</td>`
  cells += `<td style="display:none">${makeMealInput('l_p', dateStr, lp)}</td>`
  cells += `<td style="display:none">${makeMealInput('d_p', dateStr, dp)}</td>`

  mealSections.forEach(sec => {
    sec.base.forEach((b, bi) => {
      const bl = bi===0 ? `border-left:3px solid ${sec.border};` : ''
      cells += `<td style="${bl}border-top:1px solid ${sec.bg};border-bottom:1px solid ${sec.bg};border-right:1px solid ${sec.bg}">${makeMealInput(b.k, dateStr, b.v)}</td>`
    })
    // 커스텀 칸들
    cVals.forEach(cv => {
      cells += `<td style="border:1px solid ${sec.bg};background:#fafafa">${makeMealInput(`${sec.cPrefix}_c_${cv.key}`, dateStr, cv[sec.cPrefix === 'bf' ? 'bf' : sec.cPrefix === 'l' ? 'l' : 'd'])}</td>`
    })
    cells += `<td class="font-semibold text-center ${sec.sumBg}" id="${sec.sumId}" style="border-left:1px solid ${sec.bg};border-right:3px solid ${sec.border}">${sec.sum||''}</td>`
  })

  // 합계 열 (환자 열 숨김)
  cells += `<td class="text-center bg-gray-50" id="t-s-${dateStr}" style="border-left:3px solid #6b7280;border:1px solid #e5e7eb">${tsSum||''}</td>`
  cells += `<td class="text-center bg-gray-50" id="t-n-${dateStr}" style="border:1px solid #e5e7eb">${tnSum||''}</td>`
  cells += `<td class="text-center bg-gray-50" id="t-g-${dateStr}" style="border:1px solid #e5e7eb">${tgSum||''}</td>`
  cVals.forEach(cv => {
    cells += `<td class="text-center bg-indigo-50" id="t-${cv.key}-${dateStr}" style="border:1px solid #e0e7ff">${(cv.bf+cv.l+cv.d)||''}</td>`
  })
  cells += `<td class="font-bold text-center bg-blue-100 text-blue-900" id="t-total-${dateStr}" style="border:2px solid #93c5fd">${tGrand||''}</td>`

  return `<tr class="${rowClass}" data-date="${dateStr}">
    <td class="font-semibold text-center" style="border:1px solid #d1d5db">${day}</td>
    <td class="text-center ${dow==='토'?'text-blue-600 font-bold':dow==='일'?'text-red-600 font-bold':''}" style="border:1px solid #d1d5db">${dow}</td>
    ${cells}
  </tr>`
}

function buildMealFooter(mealData, customFields, monthTotal, grandTotal, colCount) {
  // 커스텀 필드 조식/중식/석식 월합계
  const cBf={}, cL={}, cD={}
  customFields.forEach(f => { cBf[f.field_key]=0; cL[f.field_key]=0; cD[f.field_key]=0 })
  mealData.forEach(m => {
    const cd = m._custom || {}
    customFields.forEach(f => {
      cBf[f.field_key] += cd[f.field_key]?.bf||0
      cL[f.field_key]  += cd[f.field_key]?.l||0
      cD[f.field_key]  += cd[f.field_key]?.d||0
    })
  })
  // 환자 컬럼 제거: 직원/비급/보호 + 커스텀만 합산
  const bfTotal = mealData.reduce((s,m)=>s+(m.breakfast_staff||0)+(m.breakfast_noncovered||0)+(m.breakfast_guardian||0),0) + customFields.reduce((s,f)=>s+cBf[f.field_key],0)
  const lTotal  = mealData.reduce((s,m)=>s+(m.lunch_staff||0)+(m.lunch_noncovered||0)+(m.lunch_guardian||0),0) + customFields.reduce((s,f)=>s+cL[f.field_key],0)
  const dTotal  = mealData.reduce((s,m)=>s+(m.dinner_staff||0)+(m.dinner_noncovered||0)+(m.dinner_guardian||0),0) + customFields.reduce((s,f)=>s+cD[f.field_key],0)

  let cells = `<td colspan="2" class="text-center py-2">월 합계</td>`
  cells += `<td class="text-center" id="mealFoot-bf-s">${fmt(mealData.reduce((s,m)=>s+(m.breakfast_staff||0),0))}</td>`
  cells += `<td class="text-center" id="mealFoot-bf-n">${fmt(mealData.reduce((s,m)=>s+(m.breakfast_noncovered||0),0))}</td>`
  cells += `<td class="text-center" id="mealFoot-bf-g">${fmt(mealData.reduce((s,m)=>s+(m.breakfast_guardian||0),0))}</td>`
  customFields.forEach(f => { cells += `<td class="text-center" id="mealFoot-bf-${f.field_key}">${fmt(cBf[f.field_key])}</td>` })
  cells += `<td class="text-center bg-blue-100 font-bold" id="mealFoot-bf-sum">${fmt(bfTotal)}</td>`
  cells += `<td class="text-center" id="mealFoot-l-s">${fmt(mealData.reduce((s,m)=>s+(m.lunch_staff||0),0))}</td>`
  cells += `<td class="text-center" id="mealFoot-l-n">${fmt(mealData.reduce((s,m)=>s+(m.lunch_noncovered||0),0))}</td>`
  cells += `<td class="text-center" id="mealFoot-l-g">${fmt(mealData.reduce((s,m)=>s+(m.lunch_guardian||0),0))}</td>`
  customFields.forEach(f => { cells += `<td class="text-center" id="mealFoot-l-${f.field_key}">${fmt(cL[f.field_key])}</td>` })
  cells += `<td class="text-center bg-green-100 font-bold" id="mealFoot-l-sum">${fmt(lTotal)}</td>`
  cells += `<td class="text-center" id="mealFoot-d-s">${fmt(mealData.reduce((s,m)=>s+(m.dinner_staff||0),0))}</td>`
  cells += `<td class="text-center" id="mealFoot-d-n">${fmt(mealData.reduce((s,m)=>s+(m.dinner_noncovered||0),0))}</td>`
  cells += `<td class="text-center" id="mealFoot-d-g">${fmt(mealData.reduce((s,m)=>s+(m.dinner_guardian||0),0))}</td>`
  customFields.forEach(f => { cells += `<td class="text-center" id="mealFoot-d-${f.field_key}">${fmt(cD[f.field_key])}</td>` })
  cells += `<td class="text-center bg-purple-100 font-bold" id="mealFoot-d-sum">${fmt(dTotal)}</td>`
  cells += `<td class="text-center bg-gray-200 font-bold" id="mealFoot-t-s">${fmt(monthTotal.s)}</td>`
  cells += `<td class="text-center bg-gray-200 font-bold" id="mealFoot-t-n">${fmt(monthTotal.n)}</td>`
  cells += `<td class="text-center bg-gray-200 font-bold" id="mealFoot-t-g">${fmt(monthTotal.g)}</td>`
  customFields.forEach(f => { cells += `<td class="text-center bg-indigo-100 font-bold" id="mealFoot-t-${f.field_key}">${fmt(monthTotal.custom[f.field_key]||0)}</td>` })
  cells += `<td class="text-center bg-blue-200 font-bold text-blue-900" id="mealFoot-t-total">${fmt(grandTotal)}</td>`
  return `<tr class="bg-gray-100 font-bold" style="font-size:11px">${cells}</tr>`
}

function makeMealInput(key, date, val, extraStyle = '') {
  return `<input type="number" class="meal-input" data-key="${key}" data-date="${date}" value="${val||''}" placeholder="" min="0">`
}

function bindMealInputEvents() {
  document.querySelectorAll('.meal-input').forEach(input => {
    input.addEventListener('input', function() { updateMealRowTotals(this.dataset.date) })
    input.addEventListener('change', async function() {
      const date = this.dataset.date
      await saveMealRow(date)
      sendActivityLog('식수 입력')
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

function buildCustomData(date) {
  const customData = {}
  window._mealCustomFields.forEach(f => {
    customData[f.field_key] = {
      bf: getMealVal(`bf_c_${f.field_key}`, date),
      l:  getMealVal(`l_c_${f.field_key}`, date),
      d:  getMealVal(`d_c_${f.field_key}`, date),
    }
  })
  return customData
}

async function saveMealRow(date) {
  const g = (k) => getMealVal(k, date)
  await api('POST', '/api/meals/save', {
    mealDate: date,
    breakfastPatient: 0, breakfastStaff: g('bf_s'), breakfastNoncovered: g('bf_n'), breakfastGuardian: g('bf_g'),
    lunchPatient: 0, lunchStaff: g('l_s'), lunchNoncovered: g('l_n'), lunchGuardian: g('l_g'),
    dinnerPatient: 0, dinnerStaff: g('d_s'), dinnerNoncovered: g('d_n'), dinnerGuardian: g('d_g'),
    customData: buildCustomData(date)
  })
}

function updateMealRowTotals(date) {
  const g = (k) => getMealVal(k, date)
  const cf = window._mealCustomFields || []

  // 환자(bf_p 등)는 hidden input이므로 포함하지 않음
  const bs=g('bf_s'),bn=g('bf_n'),bg2=g('bf_g')
  const ls=g('l_s'),ln=g('l_n'),lg=g('l_g')
  const ds=g('d_s'),dn=g('d_n'),dg=g('d_g')

  // 커스텀 합계
  let bfC=0, lC=0, dC=0
  const customTotals = {}
  cf.forEach(f => {
    const bfv=g(`bf_c_${f.field_key}`), lv=g(`l_c_${f.field_key}`), dv=g(`d_c_${f.field_key}`)
    bfC+=bfv; lC+=lv; dC+=dv
    customTotals[f.field_key] = bfv+lv+dv
  })

  const bfSum=(bs+bn+bg2)+bfC, lSum=(ls+ln+lg)+lC, dSum=(ds+dn+dg)+dC
  // 총 식수: 비급여 제외, ea 단위 커스텀 필드 제외, 환자 제외(환자군으로 대체)
  const customForMeals = cf.filter(f => (f.unit_type||'meal') !== 'ea')
  const tGrand = (bs+ls+ds)+(bg2+lg+dg) + customForMeals.reduce((s,f)=>s+(customTotals[f.field_key]||0),0)

  const set = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=v||'' }
  set(`bf-sum-${date}`, bfSum)
  set(`l-sum-${date}`, lSum)
  set(`d-sum-${date}`, dSum)
  set(`t-s-${date}`, bs+ls+ds)
  set(`t-n-${date}`, bn+ln+dn)
  set(`t-g-${date}`, bg2+lg+dg)
  cf.forEach(f => { set(`t-${f.field_key}-${date}`, customTotals[f.field_key]) })
  set(`t-total-${date}`, tGrand)
  updateMealSummaryCards()
}

function updateMealSummaryCards() {
  let ts=0, tn=0, tg=0
  const cf = window._mealCustomFields || []
  const customSums = {}
  const bfSums = {s:0,n:0,g:0}, lSums = {s:0,n:0,g:0}, dSums = {s:0,n:0,g:0}
  const bfC = {}, lC = {}, dC = {}
  cf.forEach(f => { customSums[f.field_key]=0; bfC[f.field_key]=0; lC[f.field_key]=0; dC[f.field_key]=0 })

  document.querySelectorAll('#mealTableBody tr[data-date]').forEach(row => {
    const date = row.dataset.date
    const g = (k) => getMealVal(k, date)
    const bfs=g('bf_s'),bfn=g('bf_n'),bfg=g('bf_g')
    const ls=g('l_s'),ln=g('l_n'),lg=g('l_g')
    const ds=g('d_s'),dn=g('d_n'),dg=g('d_g')
    ts+=bfs+ls+ds; tn+=bfn+ln+dn; tg+=bfg+lg+dg
    bfSums.s+=bfs; bfSums.n+=bfn; bfSums.g+=bfg
    lSums.s+=ls;   lSums.n+=ln;   lSums.g+=lg
    dSums.s+=ds;   dSums.n+=dn;   dSums.g+=dg
    cf.forEach(f => {
      const bfv=g(`bf_c_${f.field_key}`), lv=g(`l_c_${f.field_key}`), dv=g(`d_c_${f.field_key}`)
      customSums[f.field_key]+=bfv+lv+dv
      bfC[f.field_key]+=bfv; lC[f.field_key]+=lv; dC[f.field_key]+=dv
    })
  })
  const customTotalForMeals = cf
    .filter(f => (f.unit_type||'meal') !== 'ea')
    .reduce((s, f) => s + (customSums[f.field_key] || 0), 0)
  const grand = ts+tg+customTotalForMeals

  const set = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=fmt(v) }
  // 상단 요약 카드
  set('mealSummary-s', ts); set('mealSummary-n', tn); set('mealSummary-g', tg)
  cf.forEach(f => { set(`mealSummary-${f.field_key}`, customSums[f.field_key]) })
  set('mealSummary-total', grand)
  // 하단 footer 행 실시간 업데이트
  const bfTotal = bfSums.s+bfSums.n+bfSums.g+cf.reduce((s,f)=>s+bfC[f.field_key],0)
  const lTotal  = lSums.s+lSums.n+lSums.g  +cf.reduce((s,f)=>s+lC[f.field_key],0)
  const dTotal  = dSums.s+dSums.n+dSums.g  +cf.reduce((s,f)=>s+dC[f.field_key],0)
  set('mealFoot-bf-s',bfSums.s); set('mealFoot-bf-n',bfSums.n); set('mealFoot-bf-g',bfSums.g)
  set('mealFoot-l-s', lSums.s);  set('mealFoot-l-n', lSums.n);  set('mealFoot-l-g', lSums.g)
  set('mealFoot-d-s', dSums.s);  set('mealFoot-d-n', dSums.n);  set('mealFoot-d-g', dSums.g)
  cf.forEach(f => { set(`mealFoot-bf-${f.field_key}`,bfC[f.field_key]); set(`mealFoot-l-${f.field_key}`,lC[f.field_key]); set(`mealFoot-d-${f.field_key}`,dC[f.field_key]) })
  set('mealFoot-bf-sum',bfTotal); set('mealFoot-l-sum',lTotal); set('mealFoot-d-sum',dTotal)
  set('mealFoot-t-s',ts); set('mealFoot-t-n',tn); set('mealFoot-t-g',tg)
  cf.forEach(f => { set(`mealFoot-t-${f.field_key}`,customSums[f.field_key]) })
  set('mealFoot-t-total',grand)
}

async function saveMealBatch() {
  const rows = document.querySelectorAll('#mealTableBody tr[data-date]')
  let saved = 0
  const promises = []

  const btn = document.querySelector('button[onclick="saveMealBatch()"]')
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> 저장 중...' }

  rows.forEach(row => {
    const date = row.dataset.date
    const g = (k) => getMealVal(k, date)
    // 환자(bf_p 등)는 hidden이므로 실질적으로 0이지만 baseTotal에서 제외해도 무관
    const baseTotal = ['bf_s','bf_n','bf_g','l_s','l_n','l_g','d_s','d_n','d_g'].reduce((s,k)=>s+g(k),0)
    const cf = window._mealCustomFields || []
    const customSum = cf.reduce((s,f)=>s+g(`bf_c_${f.field_key}`)+g(`l_c_${f.field_key}`)+g(`d_c_${f.field_key}`),0)
    if (baseTotal + customSum > 0) {
      saved++
      promises.push(api('POST', '/api/meals/save', {
        mealDate: date,
        breakfastPatient: 0, breakfastStaff: g('bf_s'), breakfastNoncovered: g('bf_n'), breakfastGuardian: g('bf_g'),
        lunchPatient: 0, lunchStaff: g('l_s'), lunchNoncovered: g('l_n'), lunchGuardian: g('l_g'),
        dinnerPatient: 0, dinnerStaff: g('d_s'), dinnerNoncovered: g('d_n'), dinnerGuardian: g('d_g'),
        customData: buildCustomData(date)
      }))
    }
  })

  const results = await Promise.all(promises)
  const ok = saved === 0 || results.every(r => r?.success)
  if (saved === 0) {
    showToast('저장할 식수 데이터가 없습니다', 'warning')
  } else {
    showToast(ok ? `✅ ${saved}일치 식수 저장 완료!` : '❌ 일부 저장 실패', ok ? 'success' : 'error')
  }
  if (btn) {
    btn.disabled = false
    btn.innerHTML = ok && saved > 0 ? '<i class="fas fa-check mr-1"></i> 저장 완료' : '<i class="fas fa-save"></i> 저장'
    if (ok && saved > 0) setTimeout(() => { btn.innerHTML = '<i class="fas fa-save"></i> 저장' }, 2000)
  }
}

// ── 커스텀 필드 모달 (제거됨: 환자군은 관리자에서 설정, 자동 반영됨) ──────────────────────────────────────
// 칸 생성 기능이 제거되고 관리자 > 병원설정 > 환자군에서 설정하면 자동 반영됩니다.
function openCustomFieldModal() {
  showToast('환자군 추가/관리는 관리자 페이지 > 병원설정에서 하세요', 'info')
}
function closeCustomFieldModal() {}
function renderCustomFieldList() {}
async function addCustomField() {
  showToast('환자군 추가/관리는 관리자 페이지 > 병원설정에서 하세요', 'info')
}
async function deleteCustomField(id) {
  showToast('환자군 관리는 관리자 페이지 > 병원설정에서 하세요', 'info')
}

// ══════════════════════════════════════════════════════════════
//  연간/월간 비교분석 페이지 (영양사+관리자 공통)
// ══════════════════════════════════════════════════════════════
async function renderAnalysis(selectedHospitalId = null, activeTab = 'annual') {
  const content = document.getElementById('pageContent')
  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`

  let hospitals = []
  if (App.role === 'admin') {
    const hList = await api('GET', '/api/admin/hospitals')
    hospitals = hList || []
    if (!selectedHospitalId && hospitals.length > 0) selectedHospitalId = hospitals[0].id
  }

  const annualUrl = App.role === 'admin'
    ? `/api/dashboard/annual/${App.currentYear}?hospitalId=${selectedHospitalId}`
    : `/api/dashboard/annual/${App.currentYear}`
  const summaryUrl = App.role === 'admin'
    ? `/api/dashboard/summary/${App.currentYear}/${App.currentMonth}?hospitalId=${selectedHospitalId}`
    : `/api/dashboard/summary/${App.currentYear}/${App.currentMonth}`

  // 카테고리 연간 데이터
  const catAnnualUrl = App.role === 'admin' && selectedHospitalId
    ? `/api/admin/hospitals/${selectedHospitalId}/category-annual/${App.currentYear}`
    : `/api/orders/category-annual/${App.currentYear}`
  const catCategoryUrl = App.role === 'admin' && selectedHospitalId
    ? `/api/admin/hospitals/${selectedHospitalId}/patient-categories`
    : '/api/orders/patient-categories'

  // 3개년도 데이터를 병렬 로드 (연도별 비교용)
  const curYear = parseInt(App.currentYear)
  const annualUrl2 = App.role === 'admin'
    ? `/api/dashboard/annual/${curYear-1}?hospitalId=${selectedHospitalId}`
    : `/api/dashboard/annual/${curYear-1}`
  const annualUrl3 = App.role === 'admin'
    ? `/api/dashboard/annual/${curYear-2}?hospitalId=${selectedHospitalId}`
    : `/api/dashboard/annual/${curYear-2}`

  const [data, summaryData, catAnnualData, data2, data3] = await Promise.all([
    api('GET', annualUrl),
    api('GET', summaryUrl),
    api('GET', catAnnualUrl),
    api('GET', annualUrl2),
    api('GET', annualUrl3)
  ])
  if (!data) { content.innerHTML = '<div class="text-red-500 p-6">데이터 로드 실패</div>'; return }

  // 환자군 카테고리 연간 데이터 처리
  const patientCatsForAnalysis = catAnnualData?.categories || []
  const catAnnualByCategory = catAnnualData?.annualByCategory || []
  const catAnnualSettingsData = catAnnualData?.annualSettings || []

  // 카테고리별 월별 데이터 맵
  const catMonthlyData = {}  // catMonthlyData[catId][monthIdx] = { taxable, exempt, total }
  patientCatsForAnalysis.forEach(cat => {
    catMonthlyData[cat.id] = Array(12).fill(null).map(() => ({ taxable:0, exempt:0, total:0 }))
  })
  catAnnualByCategory.forEach(r => {
    const catId = r.patient_category_id
    const mIdx = parseInt(r.month) - 1
    if (catMonthlyData[catId] && mIdx >= 0 && mIdx < 12) {
      catMonthlyData[catId][mIdx] = { taxable: r.taxable||0, exempt: r.exempt||0, total: r.total||0 }
    }
  })

  // 카테고리별 목표 설정 맵
  const catAnnualSettingsMap = {}  // [catId][month] = settings
  catAnnualSettingsData.forEach(s => {
    if (!catAnnualSettingsMap[s.patient_category_id]) catAnnualSettingsMap[s.patient_category_id] = {}
    catAnnualSettingsMap[s.patient_category_id][s.month] = s
  })

  const months = Array.from({length:12}, (_,i) => `${i+1}월`)
  // 연간 배열 구성
  const usedByMonth    = Array(12).fill(0)
  const budgetByMonth  = Array(12).fill(0)
  const mealsByMonth   = Array(12).fill(0)
  const patientByMonth = Array(12).fill(0)
  const staffByMonth   = Array(12).fill(0)
  const noncovByMonth  = Array(12).fill(0)
  const guardByMonth   = Array(12).fill(0)
  const targetMpByMonth= Array(12).fill(0)
  const wasteKgByMonth = Array(12).fill(0)
  const wasteCostByMonth=Array(12).fill(0)
  const supplyByMonth  = Array(12).fill(0)

  ;(data.monthly||[]).forEach(m => { usedByMonth[parseInt(m.month)-1] = m.total_used || 0 })
  ;(data.settings||[]).forEach(m => {
    budgetByMonth[m.month-1] = m.total_budget || 0
    targetMpByMonth[m.month-1] = m.meal_price || 0
  })
  ;(data.mealMonthly||[]).forEach(m => {
    const i = parseInt(m.month)-1
    mealsByMonth[i]   = m.total_meals || 0
    patientByMonth[i] = m.total_patient || 0
    staffByMonth[i]   = m.total_staff || 0
    noncovByMonth[i]  = m.total_noncovered || 0
    guardByMonth[i]   = m.total_guardian || 0
  })
  ;(data.wasteAnnual||[]).forEach(m => {
    const i = parseInt(m.month)-1
    wasteKgByMonth[i]  = parseFloat(m.total_waste||0)
    wasteCostByMonth[i]= m.total_cost||0
  })
  // supply 월별
  const supplyMap = {}
  ;(data.supplyAnnual||[]).forEach(m => { supplyMap[parseInt(m.month)-1] = m.total_supply || 0 })

  // 식단가 3종 월별 계산
  const mpTotalByMonth   = Array(12).fill(0)
  const mpNoStaffByMonth = Array(12).fill(0)
  const mpNoSupplyByMonth= Array(12).fill(0)

  // ① 전체 식단가: 카테고리가 있으면 예산비중 가중평균, 없으면 총금액÷총식수
  // data.annualCatDietPrices = [{id, category_key, category_name, monthlyDietPrices:[{month,monthAmt,monthMeals,dietPrice}]}]
  const annualCatPrices = data.annualCatDietPrices || []

  for (let i=0; i<12; i++) {
    const used = usedByMonth[i]
    const patientM  = patientByMonth[i]
    const staffM    = staffByMonth[i]
    const guardM    = guardByMonth[i]
    const tmForPrice = patientM + staffM + guardM
    const mealsNoStaffM = patientM + guardM
    const supCost = supplyMap[i] || 0

    if (used > 0) {
      // ① 전체 식단가 — 카테고리 예산비중 가중평균 우선
      if (annualCatPrices.length > 0) {
        // 이 달에 유효한 카테고리(식단가>0) 수집, 예산 비중 기준
        const activeCats = annualCatPrices
          .map(cat => {
            const md = (cat.monthlyDietPrices || []).find(d => d.month === i + 1) || {}
            return {
              dietPrice: md.dietPrice || 0,
              monthAmt: md.monthAmt || 0,
              monthlyBudget: cat.monthlyBudget || 0
            }
          })
          .filter(c => c.dietPrice > 0)

        if (activeCats.length === 1) {
          // 카테고리 1개: 해당 카테고리 식단가 그대로
          mpTotalByMonth[i] = activeCats[0].dietPrice
        } else if (activeCats.length >= 2) {
          // 카테고리 2개 이상: 예산 비중 가중평균 (예산 미설정 시 발주금액 비중)
          const totalBudgetW = activeCats.reduce((s, c) => s + c.monthlyBudget, 0)
          if (totalBudgetW > 0) {
            // 예산 비중 가중평균: Σ(식단가 × 예산비중)
            mpTotalByMonth[i] = Math.round(
              activeCats.reduce((s, c) => s + c.dietPrice * (c.monthlyBudget / totalBudgetW), 0)
            )
          } else {
            // 예산 미설정 시 발주금액 비중으로 폴백
            const totalAmtW = activeCats.reduce((s, c) => s + c.monthAmt, 0)
            if (totalAmtW > 0) {
              mpTotalByMonth[i] = Math.round(
                activeCats.reduce((s, c) => s + c.dietPrice * (c.monthAmt / totalAmtW), 0)
              )
            }
          }
        } else if (tmForPrice > 0) {
          // 카테고리 데이터 없는 달은 기존 방식 폴백
          mpTotalByMonth[i] = Math.round(used / tmForPrice)
        }
      } else if (tmForPrice > 0) {
        // 카테고리 미설정 병원: 기존 방식
        mpTotalByMonth[i] = Math.round(used / tmForPrice)
      }

      // ② 직원식 제외 식단가
      if (mealsNoStaffM > 0) {
        mpNoStaffByMonth[i] = Math.round(used / mealsNoStaffM)
      }
      // ③ 소모품 제외 식단가
      if (tmForPrice > 0) {
        mpNoSupplyByMonth[i] = Math.round((used - supCost) / tmForPrice)
      }
    }
  }

  // 전년도 비교
  const prevYearMp = Array(12).fill(0)
  const prevYearMeals = Array(12).fill(0)
  ;(data.prevYearMeals||[]).forEach(m => { prevYearMeals[parseInt(m.month)-1] = m.total_meals||0 })
  const prevYearOrders = Array(12).fill(0)
  ;(data.prevYearOrders||[]).forEach(m => { prevYearOrders[parseInt(m.month)-1] = m.total_used||0 })
  for (let i=0; i<12; i++) {
    if (prevYearMeals[i]>0 && prevYearOrders[i]>0) prevYearMp[i] = Math.round(prevYearOrders[i]/prevYearMeals[i])
  }

  // 합계
  const totalUsed    = usedByMonth.reduce((s,v)=>s+v,0)
  const totalBudget  = budgetByMonth.reduce((s,v)=>s+v,0)
  const totalMeals   = mealsByMonth.reduce((s,v)=>s+v,0)
  const totalWasteKg = wasteKgByMonth.reduce((s,v)=>s+v,0)
  const totalWasteCost=wasteCostByMonth.reduce((s,v)=>s+v,0)
  const avgMealPrice = totalMeals>0 ? Math.round(totalUsed/totalMeals) : 0

  // ── 전년도(curYear-1), 전전년도(curYear-2) 데이터 처리 (연도별 비교용) ──
  function processYearData(d) {
    const used = Array(12).fill(0)
    const budget = Array(12).fill(0)
    const meals = Array(12).fill(0)
    const patient = Array(12).fill(0)
    const staff = Array(12).fill(0)
    const guard = Array(12).fill(0)
    const noncov = Array(12).fill(0)
    const waste = Array(12).fill(0)
    const wasteCost = Array(12).fill(0)
    const supMap = {}
    if (!d) return { used, budget, meals, patient, staff, guard, noncov, waste, wasteCost, mpTotal:Array(12).fill(0), mpNoStaff:Array(12).fill(0), mpNoSupply:Array(12).fill(0) }
    ;(d.monthly||[]).forEach(m => { used[parseInt(m.month)-1] = m.total_used||0 })
    ;(d.settings||[]).forEach(m => { budget[m.month-1] = m.total_budget||0 })
    ;(d.mealMonthly||[]).forEach(m => {
      const i=parseInt(m.month)-1
      meals[i]=m.total_meals||0; patient[i]=m.total_patient||0
      staff[i]=m.total_staff||0; noncov[i]=m.total_noncovered||0
      guard[i]=m.total_guardian||0
    })
    ;(d.wasteAnnual||[]).forEach(m => {
      const i=parseInt(m.month)-1
      waste[i]=parseFloat(m.total_waste||0); wasteCost[i]=m.total_cost||0
    })
    ;(d.supplyAnnual||[]).forEach(m => { supMap[parseInt(m.month)-1]=m.total_supply||0 })
    const mpTotal=Array(12).fill(0), mpNoStaff=Array(12).fill(0), mpNoSupply=Array(12).fill(0)
    for (let i=0;i<12;i++) {
      const u=used[i], p=patient[i], s2=staff[i], g=guard[i], sup=supMap[i]||0
      const tm=p+s2+g
      if (tm>0&&u>0) {
        mpTotal[i]=Math.round(u/tm)
        mpNoStaff[i]=(p+g)>0?Math.round(u/(p+g)):0
        mpNoSupply[i]=Math.round((u-sup)/tm)
      }
    }
    const vendorTot={}
    ;(d.vendorAnnual||[]).forEach(v => {
      if (!vendorTot[v.name]) vendorTot[v.name]={name:v.name,monthly:Array(12).fill(0),total:0}
      vendorTot[v.name].monthly[parseInt(v.month)-1]=v.total_used||0
      vendorTot[v.name].total+=v.total_used||0
    })
    return { used, budget, meals, patient, staff, guard, noncov, waste, wasteCost, mpTotal, mpNoStaff, mpNoSupply,
             totalUsed:used.reduce((s,v)=>s+v,0), totalBudget:budget.reduce((s,v)=>s+v,0),
             totalMeals:meals.reduce((s,v)=>s+v,0), avgMp:meals.reduce((s,v)=>s+v,0)>0?Math.round(used.reduce((s,v)=>s+v,0)/meals.reduce((s,v)=>s+v,0)):0,
             vendors:Object.values(vendorTot).sort((a,b)=>b.total-a.total) }
  }
  const yr1 = processYearData(data)   // 당해 (curYear)
  const yr2 = processYearData(data2)  // 전년 (curYear-1)
  const yr3 = processYearData(data3)  // 전전년 (curYear-2)
  yr1.label = `${curYear}년`
  yr2.label = `${curYear-1}년`
  yr3.label = `${curYear-2}년`

  // 전월(현재 선택월 기준) 데이터
  const pm = summaryData?.prevMonth || {}
  const curMp = data.mealPriceTotal || (summaryData?.mealPriceTotal||0)

  // 업체별 연간 집계
  const vendorTotals = {}
  ;(data.vendorAnnual||[]).forEach(v => {
    if (!vendorTotals[v.name]) vendorTotals[v.name] = { name:v.name, category:v.category, monthly:Array(12).fill(0), total:0 }
    vendorTotals[v.name].monthly[parseInt(v.month)-1] = v.total_used||0
    vendorTotals[v.name].total += v.total_used||0
  })
  const vendors = Object.values(vendorTotals).sort((a,b)=>b.total-a.total)

  const hospitalSelectHtml = App.role === 'admin' && hospitals.length > 0 ? `
  <div class="flex items-center gap-3 flex-wrap">
    <label class="text-sm font-semibold text-gray-600">병원 선택</label>
    <select id="analysisHospitalSelect" onchange="renderAnalysis(this.value)"
      class="form-input" style="width:auto;min-width:180px">
      ${hospitals.map(h => `<option value="${h.id}" ${h.id==selectedHospitalId?'selected':''}>${h.name}</option>`).join('')}
    </select>
  </div>` : ''

  content.innerHTML = `
  <!-- 헤더 -->
  <div class="flex items-center justify-between flex-wrap gap-3 mb-4">
    ${hospitalSelectHtml}
    <div class="flex gap-1">
      <button id="anaTab-monthly" onclick="switchAnaTab('monthly')" class="px-3 py-1.5 text-sm font-medium rounded-lg bg-green-600 text-white">
        <i class="fas fa-chart-bar mr-1"></i>월간 분석
      </button>
      <button id="anaTab-annual" onclick="switchAnaTab('annual')" class="px-3 py-1.5 text-sm font-medium rounded-lg bg-white border text-gray-600 hover:bg-gray-50">
        <i class="fas fa-calendar mr-1"></i>연간 분석
      </button>
    </div>
  </div>

  <!-- ════ 연간 분석 탭 ════ -->
  <div id="anaContent-annual" style="display:none">
    <!-- 연도별 요약 카드 (3개년) -->
    <div class="grid grid-cols-3 gap-3 mb-4">
      ${[yr1, yr2, yr3].map(yr => `
        <div class="stat-card border-l-4 ${yr.label===yr1.label?'border-green-500':yr.label===yr2.label?'border-blue-400':'border-gray-300'}">
          <div class="text-xs text-gray-500">${yr.label} 총 사용</div>
          <div class="text-lg font-bold ${yr.label===yr1.label?'text-green-700':yr.label===yr2.label?'text-blue-600':'text-gray-500'}">${yr.totalUsed>0?fmtMan(yr.totalUsed)+'원':'자료없음'}</div>
          <div class="text-xs text-gray-400">예산 ${yr.totalBudget>0?fmtMan(yr.totalBudget)+'원':'미설정'} ${yr.totalBudget>0&&yr.totalUsed>0?'· '+(yr.totalUsed/yr.totalBudget*100).toFixed(1)+'%':''}</div>
          <div class="text-xs text-gray-400 mt-1">식수 ${yr.totalMeals>0?fmt(yr.totalMeals)+'식':'-'} · 식단가 ${yr.avgMp>0?fmt(yr.avgMp)+'원':'-'}</div>
        </div>`).join('')}
    </div>

    <!-- 차트 그리드: 연도별 비교 -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
      <!-- ① 연도별 예산 vs 사용금액 (월별 비교) -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <h3 class="font-bold text-gray-700 text-sm mb-3"><i class="fas fa-won-sign text-green-500 mr-1"></i>연도별 예산 vs 사용금액 비교</h3>
        <canvas id="chart-yrBudget" height="180"></canvas>
      </div>
      <!-- ② 연도별 식단가 3종 비교 -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <h3 class="font-bold text-gray-700 text-sm mb-3"><i class="fas fa-utensils text-blue-500 mr-1"></i>연도별 식단가 3종 + 전년 비교</h3>
        <canvas id="chart-yrMealPrice" height="180"></canvas>
      </div>
      <!-- ③ 연도별 식수 구성 비교 -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <h3 class="font-bold text-gray-700 text-sm mb-3"><i class="fas fa-users text-teal-500 mr-1"></i>연도별 식수 구성 비교</h3>
        <canvas id="chart-yrMeals" height="180"></canvas>
      </div>
      <!-- ④ 연도별 업체별 발주금액 비교 -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <h3 class="font-bold text-gray-700 text-sm mb-3"><i class="fas fa-store text-purple-500 mr-1"></i>연도별 업체별 발주금액 비교</h3>
        <canvas id="chart-yrVendor" height="180"></canvas>
      </div>
      <!-- ⑤ 연도별 잔반 비교 -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <h3 class="font-bold text-gray-700 text-sm mb-3"><i class="fas fa-trash text-amber-500 mr-1"></i>연도별 잔반 (kg) 비교</h3>
        <canvas id="chart-yrWaste" height="180"></canvas>
      </div>
      <!-- ⑥ 연도별 업체별 비중 파이 -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <h3 class="font-bold text-gray-700 text-sm mb-3"><i class="fas fa-chart-pie text-indigo-500 mr-1"></i>업체별 연간 비중 (${curYear}년)</h3>
        <canvas id="chart-yrVendorPie" height="180"></canvas>
      </div>
    </div>

    <!-- 신규: 연도별 항목별 원별 식단가 3종 비교 -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-gray-700 text-sm"><i class="fas fa-coins text-yellow-500 mr-1"></i>연도별 항목별 원별 식단가 3종 + 전년 비교</h3>
        <span class="text-xs text-gray-400">월별 추이 · 3개년 동시 비교</span>
      </div>
      <!-- 식단가 종류 탭 -->
      <div class="flex gap-2 mb-3">
        <button onclick="switchMpTypeTab('total')" id="mpTypeTab-total" class="px-3 py-1 text-xs font-medium rounded-full bg-blue-600 text-white">전체 식단가</button>
        <button onclick="switchMpTypeTab('nostaff')" id="mpTypeTab-nostaff" class="px-3 py-1 text-xs font-medium rounded-full bg-white border text-gray-600 hover:bg-gray-50">직원식 제외</button>
        <button onclick="switchMpTypeTab('nosupply')" id="mpTypeTab-nosupply" class="px-3 py-1 text-xs font-medium rounded-full bg-white border text-gray-600 hover:bg-gray-50">소모품 제외</button>
      </div>
      <canvas id="chart-yrMpDetail" height="140"></canvas>
    </div>

    <!-- 업체별 연간 발주 상세 테이블 -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4">
      <h3 class="font-bold text-gray-700 text-sm mb-3"><i class="fas fa-table text-gray-500 mr-1"></i>업체별 월별 발주 상세 (${curYear}년)</h3>
      <div class="overflow-x-auto" style="min-width:100%">
        <table class="data-table text-xs" style="width:100%;min-width:${130 + months.length*68 + 88}px;table-layout:fixed;border-collapse:separate;border-spacing:0;border:2px solid #d1d5db;border-radius:8px;overflow:hidden">
          <colgroup>
            <col style="width:130px;min-width:130px">
            ${months.map((m,i)=>`<col style="width:68px;min-width:60px">`).join('')}
            <col style="width:88px;min-width:78px">
          </colgroup>
          <thead>
            <tr style="background:#1f2937">
              <th class="text-left pl-3 sticky left-0 z-20" style="min-width:130px;background:#1f2937;color:white;padding:7px 6px;border-right:3px solid #6b7280">업체명</th>
              ${months.map((m,i)=>{
                const isQEnd = (i+1)%3===0
                const isLast = i===months.length-1
                const borderR = isQEnd&&!isLast ? 'border-right:3px solid #6b7280;' : 'border-right:1px solid #4b5563;'
                const bgColor = isQEnd&&!isLast ? 'background:#374151;' : 'background:#1f2937;'
                return `<th class="text-right" style="padding:7px 6px;color:white;${borderR}${bgColor}">${m}</th>`
              }).join('')}
              <th class="text-right" style="padding:7px 8px;color:#86efac;font-weight:800;background:#166534;border-left:3px solid #4ade80">연간합계</th>
            </tr>
          </thead>
          <tbody>
            ${vendors.map((v,ri) => `
            <tr style="${ri%2===0?'background:#f9fafb':'background:white'}">
              <td class="pl-3 font-semibold sticky left-0 z-10" style="min-width:130px;background:${ri%2===0?'#f1f5f9':'#ffffff'};border-right:3px solid #d1d5db;padding:6px 6px;color:#1e293b">${v.name}</td>
              ${v.monthly.map((val,i)=>{
                const isQEnd = (i+1)%3===0
                const isLast = i===v.monthly.length-1
                const borderR = isQEnd&&!isLast ? 'border-right:3px solid #9ca3af;' : 'border-right:1px solid #e5e7eb;'
                const valColor = val>0 ? 'color:#1e293b;font-weight:600;' : 'color:#9ca3af;'
                return `<td class="text-right" style="padding:6px 6px;${borderR}${valColor}">${val>0?fmtMan(val)+'만':'-'}</td>`
              }).join('')}
              <td class="text-right font-bold" style="padding:6px 8px;color:#166534;border-left:3px solid #86efac;background:${ri%2===0?'#f0fdf4':'#ecfdf5'}">${v.total>0?fmtMan(v.total)+'만':'-'}</td>
            </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr style="background:#e8f5e9;border-top:2px solid #4ade80">
              <td class="pl-3 font-bold sticky left-0 z-10" style="background:#dcfce7;border-right:3px solid #4ade80;padding:7px 6px;color:#166534">합 계</td>
              ${usedByMonth.map((v,i)=>{
                const isQEnd = (i+1)%3===0
                const isLast = i===usedByMonth.length-1
                const borderR = isQEnd&&!isLast ? 'border-right:3px solid #4ade80;' : 'border-right:1px solid #bbf7d0;'
                return `<td class="text-right font-bold" style="padding:7px 6px;${borderR}color:#15803d">${v>0?fmtMan(v)+'만':'-'}</td>`
              }).join('')}
              <td class="text-right font-bold" style="padding:7px 8px;color:#166534;border-left:3px solid #4ade80;background:#bbf7d0">${fmtMan(totalUsed)}만</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  </div>


  <!-- ════ 월간 분석 탭 ════ -->
  <div id="anaContent-monthly">
    <!-- 전월 대비 식단가 비교 카드 -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
      ${[
        { label:'전체 식단가', cur: mpTotalByMonth[App.currentMonth-1], prev: mpTotalByMonth[App.currentMonth-2>=0?App.currentMonth-2:11], color:'blue' },
        { label:'직원식 제외', cur: mpNoStaffByMonth[App.currentMonth-1], prev: mpNoStaffByMonth[App.currentMonth-2>=0?App.currentMonth-2:11], color:'purple' },
        { label:'소모품 제외', cur: mpNoSupplyByMonth[App.currentMonth-1], prev: mpNoSupplyByMonth[App.currentMonth-2>=0?App.currentMonth-2:11], color:'orange' }
      ].map(item => {
        const diff = item.cur - item.prev
        const pct = item.prev>0 ? (diff/item.prev*100).toFixed(1) : null
        const up = diff > 0
        return `
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div class="text-xs text-gray-500 mb-2">${item.label} · 전월 대비</div>
          <div class="flex items-end justify-between">
            <div>
              <div class="text-2xl font-bold text-${item.color}-600">${item.cur>0?fmt(item.cur):'집계중'}<span class="text-sm font-normal ml-1">원/식</span></div>
              <div class="text-xs text-gray-400 mt-1">전월: ${item.prev>0?fmt(item.prev)+'원':'자료없음'}</div>
            </div>
            ${pct!==null&&item.cur>0?`
            <div class="text-right">
              <div class="text-lg font-bold ${up?'text-red-500':'text-green-600'}">${up?'▲':'▼'}${Math.abs(diff).toLocaleString()}원</div>
              <div class="text-xs ${up?'text-red-400':'text-green-500'}">${up?'+':''}${pct}%</div>
            </div>`:''}
          </div>
          <div class="mt-2 h-1 bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full rounded-full bg-${item.color}-400" style="width:${item.cur>0&&item.prev>0?Math.min((item.cur/item.prev)*100,150).toFixed(0):50}%"></div>
          </div>
        </div>`
      }).join('')}
    </div>

    <!-- 월간 상세 비교 차트 -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <h3 class="font-bold text-gray-700 text-sm mb-3"><i class="fas fa-utensils text-blue-500 mr-1"></i>식단가 3종 월별 추이 (당해 + 전년)</h3>
        <canvas id="chart-mpMonthly" height="220"></canvas>
      </div>
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <h3 class="font-bold text-gray-700 text-sm mb-3"><i class="fas fa-users text-teal-500 mr-1"></i>식수 구성 변화 (월별 스택)</h3>
        <canvas id="chart-mealStack" height="220"></canvas>
      </div>
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <h3 class="font-bold text-gray-700 text-sm mb-3"><i class="fas fa-won-sign text-green-500 mr-1"></i>예산 달성률 월별 추이</h3>
        <canvas id="chart-budgetPct" height="220"></canvas>
      </div>
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <h3 class="font-bold text-gray-700 text-sm mb-3"><i class="fas fa-trash text-amber-500 mr-1"></i>잔반 발생량 vs 비용 추이</h3>
        <canvas id="chart-wasteMonthly" height="220"></canvas>
      </div>
      <!-- 업체별 월별 사용금액 비교 차트 (신규) -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 col-span-1 lg:col-span-2">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-bold text-gray-700 text-sm"><i class="fas fa-store text-indigo-500 mr-1"></i>업체별 월별 사용금액 비교</h3>
          <span class="text-xs text-gray-400">상위 8개 업체 · 꺾은선 그래프</span>
        </div>
        <canvas id="chart-vendorMonthly" height="120"></canvas>
        <!-- 업체별 월별 사용금액 데이터 테이블 -->
        <div class="mt-4 overflow-x-auto" id="vendorMonthlyTableWrap">
          <table class="text-xs" style="width:100%;min-width:${110 + months.length*60 + 70 + 50}px;table-layout:fixed;border-collapse:separate;border-spacing:0;border:1px solid #c7d2fe;border-radius:6px;overflow:hidden">
            <colgroup>
              <col style="width:110px;min-width:110px">
              ${months.map(()=>`<col style="width:60px;min-width:50px">`).join('')}
              <col style="width:70px;min-width:65px">
              <col style="width:50px;min-width:45px">
            </colgroup>
            <thead>
              <tr class="bg-indigo-700 text-white">
                <th class="text-left pl-3 py-1.5 sticky left-0 bg-indigo-700 z-10" style="border-right:2px solid #4338ca;border-bottom:1px solid #818cf8">업체명</th>
                ${months.map((m,i)=>{
                  const isQEnd=(i+1)%3===0&&i!==months.length-1
                  const isQStart=i>0&&i%3===0
                  const borderR = isQEnd ? 'border-right:3px solid #6366f1;' : 'border-right:1px solid #6366f1;'
                  const borderL = isQStart ? 'border-left:3px solid #6366f1;' : ''
                  const bgQ = isQEnd||isQStart ? 'background:#3730a3;' : ''
                  return `<th class="text-right pr-2 py-1.5 whitespace-nowrap" style="${borderR}${borderL}${bgQ}border-bottom:1px solid #818cf8">${m}</th>`
                }).join('')}
                <th class="text-right pr-2 py-1.5 bg-indigo-800 whitespace-nowrap" style="border-left:2px solid #818cf8;border-right:1px solid #6366f1;border-bottom:1px solid #818cf8">연간합계</th>
                <th class="text-right pr-2 py-1.5 bg-indigo-800 whitespace-nowrap" style="border-bottom:1px solid #818cf8">최고월</th>
              </tr>
            </thead>
            <tbody>
              ${vendors.map((v,vi) => {
                const maxVal = Math.max(...v.monthly)
                const maxIdx = v.monthly.indexOf(maxVal)
                const rowBg = vi%2===0?'bg-white':'bg-indigo-50'
                const borderBottom = vi < vendors.length-1 ? '1px solid #e0e7ff' : 'none'
                return `<tr class="${rowBg} hover:bg-indigo-100">
                  <td class="pl-3 py-1.5 font-medium sticky left-0 z-10 ${rowBg}" style="border-right:2px solid #c7d2fe;border-bottom:${borderBottom}">${v.name}</td>
                  ${v.monthly.map((val,mi)=>{
                    const isQEnd=(mi+1)%3===0&&mi!==months.length-1
                    const isQStart=mi>0&&mi%3===0
                    const borderR = isQEnd ? 'border-right:3px solid #a5b4fc;' : 'border-right:1px solid #e0e7ff;'
                    const borderL = isQStart ? 'border-left:3px solid #a5b4fc;' : ''
                    const bgQ = (isQEnd||isQStart) ? (vi%2===0?'background:#eef2ff;':'background:#e0e7ff;') : ''
                    const isMax = mi===maxIdx&&val>0
                    return `<td class="text-right pr-2 py-1.5 ${isMax?'font-bold text-indigo-700 bg-indigo-100':''}" style="${borderR}${borderL}${bgQ}border-bottom:${borderBottom}">${val>0?fmtMan(val):''}</td>`
                  }).join('')}
                  <td class="text-right pr-2 py-1.5 font-bold text-indigo-700 bg-indigo-50" style="border-left:2px solid #c7d2fe;border-right:1px solid #e0e7ff;border-bottom:${borderBottom}">${fmtMan(v.total)}</td>
                  <td class="text-right pr-2 py-1.5 text-indigo-600" style="border-bottom:${borderBottom}">${maxVal>0?months[maxIdx]:'—'}</td>
                </tr>`
              }).join('')}
            </tbody>
            <tfoot>
              <tr class="bg-indigo-100 font-bold">
                <td class="pl-3 py-1.5 sticky left-0 z-10 bg-indigo-100 text-indigo-800" style="border-right:2px solid #a5b4fc;border-top:2px solid #a5b4fc">월별 합계</td>
                ${usedByMonth.map((v,i)=>{
                  const isQEnd=(i+1)%3===0&&i!==usedByMonth.length-1
                  const isQStart=i>0&&i%3===0
                  const borderR = isQEnd ? 'border-right:3px solid #818cf8;' : 'border-right:1px solid #c7d2fe;'
                  const borderL = isQStart ? 'border-left:3px solid #818cf8;' : ''
                  const bgQ = (isQEnd||isQStart) ? 'background:#ddd6fe;' : ''
                  return `<td class="text-right pr-2 py-1.5 text-indigo-700" style="${borderR}${borderL}${bgQ}border-top:2px solid #a5b4fc">${v>0?fmtMan(v):''}</td>`
                }).join('')}
                <td class="text-right pr-2 py-1.5 text-indigo-800" style="border-left:2px solid #a5b4fc;border-right:1px solid #c7d2fe;border-top:2px solid #a5b4fc">${fmtMan(totalUsed)}</td>
                <td class="text-right pr-2 py-1.5 text-gray-400" style="border-top:2px solid #a5b4fc">—</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  </div>`

  // ── 공통 차트 색상
  // 차트 초기화 전: 모든 탭 content를 잠시 visible로 설정 (hidden 상태에서 chart 초기화 시 0px 크기 방지)
  ;['annual','monthly'].forEach(t => {
    const el = document.getElementById(`anaContent-${t}`)
    if (el) el.style.display = ''
  })

  const COLORS = ['#16a34a','#2563eb','#9333ea','#f59e0b','#ef4444','#06b6d4','#ec4899','#84cc16','#f97316','#6366f1','#14b8a6','#a855f7']

  // 꼭짓점 금액 레이블 플러그인 (업체명 옵션 포함)
  const pointLabelPlugin = {
    id: 'pointLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart
      const showVendorName = chart.config.options?._showVendorName === true
      chart.data.datasets.forEach((ds, di) => {
        if (ds.type === 'line' || chart.config.type === 'line') {
          const meta = chart.getDatasetMeta(di)
          if (meta.hidden) return
          meta.data.forEach((pt, i) => {
            const val = ds.data[i]
            if (!val || val === 0) return
            ctx.save()
            ctx.textAlign = 'center'
            const amtLabel = val >= 1e6 ? `${(val/1e6).toFixed(1)}백만` : val >= 1e4 ? `${(val/1e4).toFixed(0)}만` : val.toLocaleString()
            if (showVendorName) {
              const nameLabel = ds.label || ''
              ctx.font = 'bold 8px sans-serif'
              ctx.fillStyle = ds.borderColor || '#374151'
              ctx.textBaseline = 'bottom'
              ctx.fillText(nameLabel, pt.x, pt.y - 13)
              ctx.font = '8px sans-serif'
              ctx.fillText(amtLabel, pt.x, pt.y - 4)
            } else {
              ctx.font = 'bold 9px sans-serif'
              ctx.fillStyle = ds.borderColor || '#374151'
              ctx.textBaseline = 'bottom'
              ctx.fillText(amtLabel, pt.x, pt.y - 5)
            }
            ctx.restore()
          })
        }
      })
    }
  }

  // 막대 그래프 위 수치 레이블 플러그인
  const barLabelPlugin = {
    id: 'barLabels',
    afterDatasetsDraw(chart) {
      if (!chart.config.options?._showBarLabels) return
      const { ctx } = chart
      chart.data.datasets.forEach((ds, di) => {
        if (ds.type && ds.type !== 'bar') return
        if (chart.config.type !== 'bar' && ds.type !== 'bar') return
        const meta = chart.getDatasetMeta(di)
        if (meta.hidden) return
        meta.data.forEach((bar, i) => {
          const val = ds.data[i]
          if (!val || val === 0) return
          ctx.save()
          ctx.font = 'bold 9px sans-serif'
          ctx.fillStyle = '#374151'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'bottom'
          const label = val >= 1e6 ? `${(val/1e6).toFixed(1)}백만` : val >= 1e4 ? `${(val/1e4).toFixed(0)}만` : val.toLocaleString()
          ctx.fillText(label, bar.x, bar.y - 2)
          ctx.restore()
        })
      })
    }
  }

  // 달성률 막대 위 % 수치 레이블 플러그인
  const pctBarLabelPlugin = {
    id: 'pctBarLabels',
    afterDatasetsDraw(chart) {
      if (!chart.config.options?._showPctLabels) return
      const { ctx } = chart
      chart.data.datasets.forEach((ds, di) => {
        if (ds.type && ds.type !== 'bar') return
        const meta = chart.getDatasetMeta(di)
        if (meta.hidden) return
        meta.data.forEach((bar, i) => {
          const val = ds.data[i]
          if (!val || val === 0) return
          ctx.save()
          ctx.font = 'bold 9px sans-serif'
          ctx.fillStyle = val >= 100 ? '#dc2626' : val >= 90 ? '#d97706' : '#16a34a'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'bottom'
          ctx.fillText(`${val}%`, bar.x, bar.y - 2)
          ctx.restore()
        })
      })
    }
  }

  // 도넛 중앙 텍스트 플러그인
  const doughnutCenterPlugin = {
    id: 'doughnutCenter',
    beforeDraw(chart) {
      if (chart.config.type !== 'doughnut') return
      if (!chart.config.options?._centerText) return
      const { ctx, chartArea } = chart
      if (!chartArea) return
      const cx = (chartArea.left + chartArea.right) / 2
      const cy = (chartArea.top + chartArea.bottom) / 2
      const text = chart.config.options._centerText
      ctx.save()
      ctx.font = 'bold 14px sans-serif'
      ctx.fillStyle = '#374151'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, cx, cy)
      ctx.restore()
    }
  }

  // ── 연간 차트 초기화: annual 탭이 display:none이므로 rAF로 지연 초기화
  requestAnimationFrame(() => {
  // ── 연도별 비교 차트 ①: 예산 vs 사용금액
  new Chart(document.getElementById('chart-yrBudget'), {
    type:'bar', data:{
      labels: months,
      datasets:[
        { label:`${curYear}년 사용`, data:yr1.used, backgroundColor:'rgba(22,163,74,0.75)', borderRadius:4 },
        { label:`${curYear-1}년 사용`, data:yr2.used, backgroundColor:'rgba(37,99,235,0.6)', borderRadius:4 },
        { label:`${curYear-2}년 사용`, data:yr3.used, backgroundColor:'rgba(156,163,175,0.5)', borderRadius:4 },
        { label:`${curYear}년 예산`, data:yr1.budget, type:'line', borderColor:'#ef4444', borderDash:[5,5], borderWidth:1.5, pointRadius:3, fill:false }
      ]
    },
    options:{
      responsive:true,
      plugins:{
        legend:{labels:{boxWidth:11,font:{size:9}}},
        tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${fmtMan(ctx.raw)}원`}}
      },
      scales:{ y:{ ticks:{callback:v=>`${(v/1e7).toFixed(0)}천만`} } }
    },
    plugins:[barLabelPlugin]
  })

  // ── 연도별 비교 차트 ②: 식단가 3종 비교
  new Chart(document.getElementById('chart-yrMealPrice'), {
    type:'line', data:{
      labels: months,
      datasets:[
        { label:`${curYear}년 전체`, data:yr1.mpTotal, borderColor:'#2563eb', borderWidth:2.5, pointRadius:4, fill:false, tension:0.3 },
        { label:`${curYear-1}년 전체`, data:yr2.mpTotal, borderColor:'#93c5fd', borderWidth:1.5, pointRadius:3, fill:false, tension:0.3, borderDash:[4,3] },
        { label:`${curYear-2}년 전체`, data:yr3.mpTotal, borderColor:'#cbd5e1', borderWidth:1.5, pointRadius:2, fill:false, tension:0.3, borderDash:[6,3] },
        { label:`${curYear}년 직원제외`, data:yr1.mpNoStaff, borderColor:'#9333ea', borderWidth:2, pointRadius:3, fill:false, tension:0.3 },
        { label:`${curYear}년 소모품제외`, data:yr1.mpNoSupply, borderColor:'#f59e0b', borderWidth:2, pointRadius:3, fill:false, tension:0.3, borderDash:[4,3] },
        { label:'목표식단가', data:targetMpByMonth, borderColor:'#ef4444', borderWidth:1.5, pointRadius:2, fill:false, borderDash:[8,4] }
      ]
    },
    options:{responsive:true,
      plugins:{legend:{labels:{boxWidth:11,font:{size:9}}},
        tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${ctx.raw.toLocaleString()}원/식`}}},
      scales:{y:{ticks:{callback:v=>`${(v/1000).toFixed(1)}천원`}}}
    },
    plugins:[pointLabelPlugin]
  })

  // ── 연도별 비교 차트 ③: 식수 구성 비교
  new Chart(document.getElementById('chart-yrMeals'), {
    type:'bar', data:{
      labels: months,
      datasets:[
        { label:`${curYear}년 치료식`, data:yr1.patient, backgroundColor:'rgba(37,99,235,0.8)', borderRadius:3 },
        { label:`${curYear-1}년 치료식`, data:yr2.patient, backgroundColor:'rgba(37,99,235,0.4)', borderRadius:3 },
        { label:`${curYear}년 직원식`, data:yr1.staff, backgroundColor:'rgba(22,163,74,0.8)', borderRadius:3 },
        { label:`${curYear-1}년 직원식`, data:yr2.staff, backgroundColor:'rgba(22,163,74,0.4)', borderRadius:3 }
      ]
    },
    options:{responsive:true,
      plugins:{legend:{labels:{boxWidth:11,font:{size:9}}},
        tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${ctx.raw.toLocaleString()}식`}}},
      scales:{y:{ticks:{callback:v=>`${v}식`}}}
    }
  })

  // ── 연도별 비교 차트 ④: 업체별 발주금액 비교 (상위 5개)
  const topVendors5 = vendors.slice(0,5)
  const yrVendorColors = ['#2563eb','#9333ea','#f59e0b','#ef4444','#06b6d4']
  const yrVendorEl = document.getElementById('chart-yrVendor')
  if (yrVendorEl && topVendors5.length > 0) {
    const prevVendorMap = {}
    ;(yr2.vendors||[]).forEach(v => { prevVendorMap[v.name] = v.monthly })
    new Chart(yrVendorEl, {
      type:'bar', data:{
        labels: months,
        datasets: topVendors5.flatMap((v, vi) => [
          { label:`${v.name}(${curYear})`, data:v.monthly, backgroundColor:`${yrVendorColors[vi]}cc`, borderRadius:3, stack:`v${vi}` },
          { label:`${v.name}(${curYear-1})`, data:prevVendorMap[v.name]||Array(12).fill(0), backgroundColor:`${yrVendorColors[vi]}55`, borderRadius:3, stack:`v${vi}` }
        ])
      },
      options:{responsive:true,
        plugins:{legend:{labels:{boxWidth:11,font:{size:9}}},
          tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${fmtMan(ctx.raw)}원`}}},
        scales:{y:{ticks:{callback:v=>`${(v/1e6).toFixed(0)}백만`}}}
      }
    })
  }

  // ── 연도별 비교 차트 ⑤: 잔반 kg 비교
  new Chart(document.getElementById('chart-yrWaste'), {
    type:'bar', data:{
      labels: months,
      datasets:[
        { label:`${curYear}년 잔반(kg)`, data:yr1.waste, backgroundColor:'rgba(245,158,11,0.75)', borderRadius:4 },
        { label:`${curYear-1}년 잔반(kg)`, data:yr2.waste, backgroundColor:'rgba(245,158,11,0.4)', borderRadius:4 },
        { label:`${curYear-2}년 잔반(kg)`, data:yr3.waste, backgroundColor:'rgba(209,213,219,0.5)', borderRadius:4 }
      ]
    },
    options:{responsive:true,
      plugins:{legend:{labels:{boxWidth:11,font:{size:9}}}},
      scales:{y:{ticks:{callback:v=>`${v}kg`}}}
    }
  })

  // ── 연도별 비교 차트 ⑥: 업체별 비중 파이
  const vendorPieLabels = vendors.slice(0,8).map(v=>v.name)
  const vendorPieData = vendors.slice(0,8).map(v=>v.total)
  const vendorPieColors = ['#2563eb','#9333ea','#f59e0b','#ef4444','#06b6d4','#ec4899','#84cc16','#f97316']
  const yrPieEl = document.getElementById('chart-yrVendorPie')
  if (yrPieEl && vendorPieData.some(v=>v>0)) {
    new Chart(yrPieEl, {
      type:'doughnut', data:{
        labels: vendorPieLabels,
        datasets:[{ data:vendorPieData, backgroundColor:vendorPieColors, borderWidth:2 }]
      },
      options:{responsive:true,
        _centerText:`${curYear}년`,
        plugins:{legend:{position:'right',labels:{boxWidth:10,font:{size:9}}},
          tooltip:{callbacks:{label:ctx=>`${ctx.label}: ${fmtMan(ctx.raw)}원 (${(ctx.raw/totalUsed*100).toFixed(1)}%)`}}}
      },
      plugins:[doughnutCenterPlugin]
    })
  }
  }) // end rAF (연간 차트)

  // ── 연도별 항목별 원별 식단가 상세 차트 (탭 전환형)
  let yrMpDetailChart = null
  const _yr1=yr1, _yr2=yr2, _yr3=yr3
  window.switchMpTypeTab = (type) => {
    ;['total','nostaff','nosupply'].forEach(t => {
      const btn = document.getElementById(`mpTypeTab-${t}`)
      if (btn) btn.className = t===type
        ? 'px-3 py-1 text-xs font-medium rounded-full bg-blue-600 text-white'
        : 'px-3 py-1 text-xs font-medium rounded-full bg-white border text-gray-600 hover:bg-gray-50'
    })
    const d1 = type==='total'?_yr1.mpTotal:type==='nostaff'?_yr1.mpNoStaff:_yr1.mpNoSupply
    const d2 = type==='total'?_yr2.mpTotal:type==='nostaff'?_yr2.mpNoStaff:_yr2.mpNoSupply
    const d3 = type==='total'?_yr3.mpTotal:type==='nostaff'?_yr3.mpNoStaff:_yr3.mpNoSupply
    const typeLabel = type==='total'?'전체 식단가':type==='nostaff'?'직원식 제외':'소모품 제외'
    if (yrMpDetailChart) {
      yrMpDetailChart.data.datasets[0].data = d1
      yrMpDetailChart.data.datasets[1].data = d2
      yrMpDetailChart.data.datasets[2].data = d3
      yrMpDetailChart.update()
    } else {
      const el = document.getElementById('chart-yrMpDetail')
      if (!el) return
      yrMpDetailChart = new Chart(el, {
        type:'line', data:{
          labels: months,
          datasets:[
            { label:`${curYear}년 ${typeLabel}`, data:d1, borderColor:'#2563eb', borderWidth:2.5, pointRadius:4, fill:false, tension:0.3 },
            { label:`${curYear-1}년 ${typeLabel}`, data:d2, borderColor:'#93c5fd', borderWidth:2, pointRadius:3, fill:false, tension:0.3, borderDash:[4,3] },
            { label:`${curYear-2}년 ${typeLabel}`, data:d3, borderColor:'#cbd5e1', borderWidth:1.5, pointRadius:2, fill:false, tension:0.3, borderDash:[6,3] },
            { label:'목표식단가', data:targetMpByMonth, borderColor:'#ef4444', borderWidth:1.5, pointRadius:2, fill:false, borderDash:[8,4] }
          ]
        },
        options:{responsive:true,
          plugins:{legend:{labels:{boxWidth:11,font:{size:9}}},
            tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${ctx.raw.toLocaleString()}원/식`}}},
          scales:{y:{ticks:{callback:v=>`${(v/1000).toFixed(1)}천원`}}}
        },
        plugins:[pointLabelPlugin]
      })
    }
  }
  // 초기 렌더
  window.switchMpTypeTab('total')


  // ── 월간 차트 초기화: monthly 보이는 상태에서 단일 rAF로 초기화 후 탭 전환
  requestAnimationFrame(() => {
  new Chart(document.getElementById('chart-mpMonthly'), {
    type:'line', data:{
      labels:months,
      datasets:[
        { label:'전체식단가', data:mpTotalByMonth, borderColor:'#2563eb', borderWidth:2, pointRadius:4, fill:false, tension:0.3 },
        { label:'직원제외',   data:mpNoStaffByMonth, borderColor:'#9333ea', borderWidth:2, pointRadius:4, fill:false, tension:0.3 },
        { label:'소모품제외', data:mpNoSupplyByMonth, borderColor:'#f59e0b', borderWidth:2, pointRadius:4, fill:false, tension:0.3 },
        { label:`${parseInt(App.currentYear)-1}년 식단가`, data:prevYearMp, borderColor:'#94a3b8', borderWidth:1.5, pointRadius:2, fill:false, tension:0.3, borderDash:[5,3] },
        { label:'목표식단가', data:targetMpByMonth, borderColor:'#ef4444', borderWidth:1.5, pointRadius:0, fill:false, borderDash:[8,4] }
      ]
    },
    options:{ responsive:true, plugins:{ legend:{ labels:{boxWidth:12,font:{size:10}} } },
      scales:{ y:{ ticks:{callback:v=>`${(v/1000).toFixed(1)}천원`} } } },
    plugins: [pointLabelPlugin]
  })

  // ── 식수 스택 (막대 내부 숫자 표시)
  const mealStackMonthlyPlugin = {
    id: 'mealStackMonthlyLabel',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx
      chart.data.datasets.forEach((dataset, di) => {
        const meta = chart.getDatasetMeta(di)
        meta.data.forEach((bar, i) => {
          const val = dataset.data[i]
          if (!val || val < 10) return
          const { x, y, width, height } = bar.getProps(['x','y','width','height'], true)
          if (height < 14) return
          ctx.save()
          ctx.font = `bold ${Math.min(10, height*0.55)}px sans-serif`
          ctx.fillStyle = 'rgba(255,255,255,0.95)'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(`${val}`, x, y + height/2)
          ctx.restore()
        })
      })
    }
  }
  new Chart(document.getElementById('chart-mealStack'), {
    type:'bar', data:{
      labels:months,
      datasets:[
        { label:'치료식(환자)', data:patientByMonth, backgroundColor:'rgba(37,99,235,0.8)', borderRadius:3 },
        { label:'직원식',       data:staffByMonth,  backgroundColor:'rgba(22,163,74,0.8)',  borderRadius:3 },
        { label:'비급여',       data:noncovByMonth, backgroundColor:'rgba(147,51,234,0.75)',borderRadius:3 },
        { label:'보호자',       data:guardByMonth,  backgroundColor:'rgba(249,115,22,0.75)',borderRadius:3 }
      ]
    },
    options:{ responsive:true, plugins:{ legend:{ labels:{boxWidth:12,font:{size:10}} } },
      scales:{ x:{stacked:true}, y:{stacked:true, ticks:{callback:v=>`${v}식`}} } },
    plugins: [mealStackMonthlyPlugin]
  })

  // ── 예산 달성률 (막대 위 % 수치)
  const pctByMonth = budgetByMonth.map((b,i)=>b>0?parseFloat((usedByMonth[i]/b*100).toFixed(1)):null)
  new Chart(document.getElementById('chart-budgetPct'), {
    type:'bar', data:{
      labels:months,
      datasets:[
        { label:'달성률(%)', data:pctByMonth, backgroundColor: pctByMonth.map(p=>p===null?'#e5e7eb':p>=100?'rgba(239,68,68,0.75)':p>=90?'rgba(245,158,11,0.75)':'rgba(22,163,74,0.75)'), borderRadius:5 },
        { label:'100% 기준', data:Array(12).fill(100), type:'line', borderColor:'#ef4444', borderDash:[5,5], borderWidth:1.5, pointRadius:0, fill:false }
      ]
    },
    options:{ responsive:true, _showPctLabels: true, plugins:{ legend:{ labels:{boxWidth:12,font:{size:10}} } },
      scales:{ y:{ ticks:{callback:v=>`${v}%`}, suggestedMax:130 } } },
    plugins: [pctBarLabelPlugin]
  })

  // ── 잔반 월간
  new Chart(document.getElementById('chart-wasteMonthly'), {
    type:'bar', data:{
      labels:months,
      datasets:[
        { label:'잔반량(kg)', data:wasteKgByMonth, backgroundColor:'rgba(245,158,11,0.7)', borderRadius:4, yAxisID:'y' },
        { label:'잔반비용',  data:wasteCostByMonth, type:'line', borderColor:'#f97316', borderWidth:2, pointRadius:4, fill:false, yAxisID:'y1' }
      ]
    },
    options:{ responsive:true, plugins:{ legend:{ labels:{boxWidth:12,font:{size:10}} } },
      scales:{
        y:{ ticks:{callback:v=>`${v}kg`}, position:'left' },
        y1:{ ticks:{callback:v=>`${(v/1e4).toFixed(0)}만`}, position:'right', grid:{drawOnChartArea:false} }
      } },
    plugins: [pointLabelPlugin]
  })

  // ── 업체별 월별 사용금액 비교 (업체명+금액 꼭짓점 표시)
  const vendorMonthlyEl = document.getElementById('chart-vendorMonthly')
  if (vendorMonthlyEl && vendors.length > 0) {
    const topVs = vendors.slice(0, 8)
    new Chart(vendorMonthlyEl, {
      type: 'line',
      data: {
        labels: months,
        datasets: topVs.map((v, i) => ({
          label: v.name,
          data: v.monthly,
          borderColor: COLORS[i % COLORS.length],
          backgroundColor: COLORS[i % COLORS.length] + '20',
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: COLORS[i % COLORS.length],
          pointBorderColor: '#fff', pointBorderWidth: 1.5,
          fill: false, tension: 0.3
        }))
      },
      options: {
        responsive: true,
        _showVendorName: true,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtMan(ctx.raw)}원` } }
        },
        scales: { y: { ticks: { callback: v => `${(v/1e6).toFixed(1)}백만` } } }
      },
      plugins: [pointLabelPlugin]
    })
  }

  // ── 환자군별 월별 발주 금액 차트
  const catMonthlyEl = document.getElementById('chart-catMonthly')
  if (catMonthlyEl && patientCatsForAnalysis.length > 0) {
    const catColors = patientCatsForAnalysis.map(cat => getCategoryColorHex(cat.category_key))
    // 꼭짓점 레이블 플러그인 (기존 pointLabelPlugin과 동일 형식)
    const catPointLabelPlugin = {
      id: 'catPointLabel',
      afterDatasetsDraw(chart) {
        const ctx = chart.ctx
        chart.data.datasets.forEach((dataset, di) => {
          const meta = chart.getDatasetMeta(di)
          if (meta.type !== 'bar') return
          meta.data.forEach((bar, i) => {
            const val = dataset.data[i]
            if (!val || val <= 0) return
            const { x, y } = bar.getCenterPoint ? bar.getCenterPoint() : { x: bar.x, y: bar.y }
            ctx.save()
            ctx.font = 'bold 9px sans-serif'
            ctx.fillStyle = dataset.borderColor || '#374151'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'bottom'
            ctx.fillText(`${Math.round(val/1e4)}만`, x, y - 4)
            ctx.restore()
          })
        })
      }
    }
    new Chart(catMonthlyEl, {
      type: 'bar',
      data: {
        labels: months,
        datasets: patientCatsForAnalysis.map((cat, i) => ({
          label: cat.category_name,
          data: (catMonthlyData[cat.id] || Array(12).fill({total:0})).map(m => m?.total || 0),
          backgroundColor: catColors[i] + 'cc',
          borderColor: catColors[i],
          borderWidth: 1.5,
          borderRadius: 4
        }))
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtMan(ctx.raw)}원` } }
        },
        scales: {
          x: { stacked: false },
          y: { ticks: { callback: v => v > 0 ? `${Math.round(v/1e4)}만` : '0' } }
        }
      },
      plugins: [catPointLabelPlugin]
    })
  }

  // ── 환자군별 월별 예산 달성률 차트 (기존 chart-budgetPct와 동일 형식)
  const catBudgetPctEl = document.getElementById('chart-catBudgetPct')
  if (catBudgetPctEl && patientCatsForAnalysis.length > 0) {
    // 달성률 계산
    const pctDatasets = patientCatsForAnalysis.map(cat => {
      const catColor = getCategoryColorHex(cat.category_key)
      const pctData = months.map((_, mi) => {
        const used = catMonthlyData[cat.id]?.[mi]?.total || 0
        const budget = catAnnualSettingsMap[cat.id]?.[mi+1]?.monthly_budget || 0
        return budget > 0 ? parseFloat((used / budget * 100).toFixed(1)) : null
      })
      return {
        label: cat.category_name,
        data: pctData,
        borderColor: catColor,
        backgroundColor: catColor + '20',
        borderWidth: 2,
        pointRadius: 4,
        pointBackgroundColor: catColor,
        pointBorderColor: '#fff', pointBorderWidth: 1.5,
        fill: false, tension: 0.3,
        spanGaps: false
      }
    })
    // 100% 기준선 데이터셋 추가 (기존 chart-budgetPct와 동일)
    pctDatasets.push({
      label: '100% 기준',
      data: Array(12).fill(100),
      type: 'line',
      borderColor: '#ef4444',
      borderDash: [5, 5],
      borderWidth: 1.5,
      pointRadius: 0,
      fill: false
    })

    // 달성률 꼭짓점 레이블 플러그인 (기존 pctBarLabelPlugin과 동일 형식)
    const catPctPointPlugin = {
      id: 'catPctPointLabel',
      afterDatasetsDraw(chart) {
        if (!chart.options._showCatPct) return
        const ctx = chart.ctx
        chart.data.datasets.forEach((dataset, di) => {
          if (dataset.type === 'line' && dataset.label === '100% 기준') return
          const meta = chart.getDatasetMeta(di)
          meta.data.forEach((point, i) => {
            const val = dataset.data[i]
            if (val === null || val === undefined) return
            const { x, y } = point
            ctx.save()
            ctx.font = 'bold 9px sans-serif'
            ctx.fillStyle = val >= 100 ? '#ef4444' : val >= 90 ? '#d97706' : '#16a34a'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'bottom'
            ctx.fillText(`${val}%`, x, y - 5)
            ctx.restore()
          })
        })
      }
    }

    new Chart(catBudgetPctEl, {
      type: 'line',
      data: { labels: months, datasets: pctDatasets },
      options: {
        responsive: true,
        _showCatPct: true,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 }, filter: item => item.text !== '100% 기준' } },
          tooltip: { callbacks: { label: ctx => ctx.raw !== null ? `${ctx.dataset.label}: ${ctx.raw}%` : '목표 미설정' } }
        },
        scales: {
          y: { ticks: { callback: v => `${v}%` }, suggestedMax: 130 }
        }
      },
      plugins: [catPctPointPlugin]
    })
  }

      // 차트 초기화 완료 후 탭 전환
      const _initialTab = activeTab || 'monthly'
      switchAnaTab(_initialTab)
  }) // end rAF
}

window.switchAnaTab = (tab) => {
  ;['annual','monthly'].forEach(t => {
    const btn = document.getElementById(`anaTab-${t}`)
    const cnt = document.getElementById(`anaContent-${t}`)
    if (btn) btn.className = t===tab
      ? 'px-3 py-1.5 text-sm font-medium rounded-lg bg-green-600 text-white'
      : 'px-3 py-1.5 text-sm font-medium rounded-lg bg-white border text-gray-600 hover:bg-gray-50'
    if (cnt) cnt.style.display = t===tab ? '' : 'none'
  })
  // 탭 전환 후 해당 탭 캔버스만 resize (전체 인스턴스 대신 선택적 처리)
  requestAnimationFrame(() => {
    const cnt = document.getElementById(`anaContent-${tab}`)
    if (!cnt || typeof Chart === 'undefined') return
    cnt.querySelectorAll('canvas').forEach(canvas => {
      const chart = Chart.getChart ? Chart.getChart(canvas) : null
      if (chart) { try { chart.resize() } catch(e) {} }
    })
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
  if (res?.success) { showToast('설정이 저장되었습니다', 'success'); sendActivityLog('예산 설정 저장') }
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
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
    <div class="stat-card border-l-4 border-green-500">
      <div class="text-xs text-gray-500 mb-1">관리 병원</div>
      <div class="text-2xl font-bold text-green-700">${hospitals.length}<span class="text-sm font-normal text-gray-400 ml-1">개</span></div>
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
  <div class="flex gap-0.5 mb-3 border-b border-gray-200 overflow-x-auto" style="-webkit-overflow-scrolling:touch">
    <button id="adminTab-cards" onclick="switchAdminTab('cards')" class="px-3 py-2 text-xs md:text-sm font-medium border-b-2 border-green-600 text-green-700 whitespace-nowrap flex-shrink-0">
      <i class="fas fa-th-large mr-1"></i>병원별
    </button>
    <button id="adminTab-issues" onclick="switchAdminTab('issues')" class="px-3 py-2 text-xs md:text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 whitespace-nowrap flex-shrink-0">
      <i class="fas fa-exclamation-triangle mr-1 text-amber-500"></i>이슈
    </button>
    <button id="adminTab-chart" onclick="switchAdminTab('chart')" class="px-3 py-2 text-xs md:text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 whitespace-nowrap flex-shrink-0">
      <i class="fas fa-chart-bar mr-1"></i>비교
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
        // 월간 누적 식수 (mealStats + mealCustomTotals 기반)
        const ms = h.mealStats || {}
        const customTotals = h.mealCustomTotals || {}
        const monthStaffMeals = ms.total_staff || 0
        const monthGuardMeals = ms.total_guardian || 0
        const monthNonCovMeals = ms.total_noncovered || 0
        const monthCatCustomTotal = (h.catDietPrices||[]).reduce((s, cat) => {
          return s + (customTotals[`cat_${cat.category_key}`] || 0)
        }, 0)
        const monthGrandTotal = h.totalMeals || (monthStaffMeals + monthGuardMeals + monthCatCustomTotal)

        // 오늘 식수 (카테고리별 실시간) - 조/중/석 표시용
        const tm = h.todayMeals || {}
        const todayCatMeals = h.todayCatMeals || {}
        const todayStaffMeals  = (tm.bs||0)+(tm.ls||0)+(tm.ds||0)
        const todayGuardMeals  = (tm.bg||0)+(tm.lg||0)+(tm.dg||0)
        const todayBreakfast   = (tm.bs||0)+(tm.bg||0)
        const todayLunch       = (tm.ls||0)+(tm.lg||0)
        const todayDinner      = (tm.ds||0)+(tm.dg||0)
        const todayCatCustomBf = (h.catDietPrices||[]).reduce((s,cat) => s+(todayCatMeals[cat.id]||0), 0)
        const todayTotalMeals  = h.todayTotalMeals || (todayStaffMeals + todayGuardMeals + todayCatCustomBf)
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
              <span class="flex flex-col items-end gap-0.5">
                <span class="flex items-center gap-1 text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full border border-green-200">
                  <span class="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                  ${h.online.username || '온라인'} 접속중
                </span>
                ${h.online.last_page ? `<span class="text-xs text-gray-400"><i class="fas fa-map-marker-alt mr-0.5 text-blue-400"></i>${h.online.last_page}</span>` : ''}
                ${h.online.last_action ? `<span class="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200"><i class="fas fa-pencil-alt mr-0.5"></i>${h.online.last_action}</span>` : ''}
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
            <!-- 전월 대비 식단가 비교 -->
            ${h.prevMonth && h.prevMonth.mealPriceTotal > 0 ? (() => {
              const pm = h.prevMonth
              const diff1 = h.mealPriceTotal - pm.mealPriceTotal
              const diff2 = h.mealPriceNoStaff - pm.mealPriceNoStaff
              const arrowCls = (d) => d > 0 ? 'text-red-500' : d < 0 ? 'text-green-600' : 'text-gray-400'
              const arrowSym = (d) => d > 0 ? '▲' : d < 0 ? '▼' : '—'
              return `<div class="mt-1.5 pt-1.5 border-t border-blue-100">
                <div class="text-xs text-indigo-500 font-semibold mb-1"><i class="fas fa-exchange-alt mr-1"></i>전월(${pm.year}년 ${pm.month}월) 대비</div>
                <div class="grid grid-cols-2 gap-1 text-xs">
                  <div class="flex items-center justify-between bg-white rounded-lg px-2 py-1 border border-indigo-50">
                    <span class="text-gray-500">전체</span>
                    <span class="${arrowCls(diff1)} font-bold">${arrowSym(diff1)} ${Math.abs(diff1).toLocaleString()}원</span>
                  </div>
                  <div class="flex items-center justify-between bg-white rounded-lg px-2 py-1 border border-indigo-50">
                    <span class="text-gray-500">직원제외</span>
                    <span class="${arrowCls(diff2)} font-bold">${arrowSym(diff2)} ${Math.abs(diff2).toLocaleString()}원</span>
                  </div>
                </div>
              </div>`
            })() : ''}
            <!-- 환자군별 식단가 (1개: 총액÷식수, 2개+: 가중평균) -->
            ${(h.catDietPrices||[]).length > 0 ? (() => {
              const cats = h.catDietPrices || []
              const isSingle = cats.length === 1
              let wPriceSum = 0, wBudgetSum = 0, wTargetSum = 0, wTargetBudget = 0
              const catRows2 = cats.map(cat => {
                const color = getCategoryColorHex(cat.category_key)
                const targetP = cat.targetPrice || 0
                const catMonthMeals = (h.mealCustomTotals||{})[`cat_${cat.category_key}`] || 0
                const monthDietPrice = catMonthMeals > 0 ? Math.round(cat.monthAmt / catMonthMeals) : 0
                const isOverM = targetP > 0 && monthDietPrice > targetP
                const isWarnM = targetP > 0 && monthDietPrice >= targetP * 0.9 && !isOverM
                const priceColorM = isOverM ? '#dc2626' : isWarnM ? '#d97706' : color
                if (cat.monthAmt > 0 && monthDietPrice > 0) { wBudgetSum += cat.monthAmt; wPriceSum += cat.monthAmt * monthDietPrice }
                if (cat.monthBudget > 0 && targetP > 0) { wTargetBudget += cat.monthBudget; wTargetSum += cat.monthBudget * targetP }
                return `<div class="p-1.5 bg-white rounded-lg border" style="border-color:${color}30">
                  <div class="flex items-center gap-1 mb-1">
                    <span style="width:6px;height:6px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0"></span>
                    <span style="font-size:9px;font-weight:700;color:${color}">${cat.category_name}</span>
                  </div>
                  <div style="font-size:9px;color:#9ca3af;margin-bottom:2px">목표</div>
                  <div style="font-size:10px;font-weight:700;color:${targetP>0?color:'#d1d5db'}">${targetP>0?fmt(targetP)+'원/식':'미설정'}</div>
                  <div style="font-size:9px;color:#9ca3af;margin-top:4px;margin-bottom:2px">현재(월간)</div>
                  <div style="font-size:11px;font-weight:900;color:${monthDietPrice>0?priceColorM:'#d1d5db'}">${monthDietPrice>0?fmt(monthDietPrice)+'원/식':'미입력'}</div>
                  ${isOverM?`<div style="font-size:8px;color:#dc2626">▲ +${fmt(monthDietPrice-targetP)}원 초과</div>`:isWarnM?`<div style="font-size:8px;color:#d97706">▲ 주의</div>`:''}
                </div>`
              })
              // 카테고리 1개: 총발주÷총식수, 2개+: 가중평균
              const totalCatAmt   = cats.reduce((s,c) => s+(c.monthAmt||0), 0)
              const totalCatMeals = cats.reduce((s,c) => s+((h.mealCustomTotals||{})[`cat_${c.category_key}`]||0), 0)
              const wCurrentPrice = isSingle
                ? (totalCatMeals > 0 ? Math.round(totalCatAmt / totalCatMeals) : 0)
                : (wBudgetSum > 0 ? Math.round(wPriceSum / wBudgetSum) : 0)
              const wTargetPrice  = isSingle
                ? (cats[0]?.targetPrice || 0)
                : (wTargetBudget > 0 ? Math.round(wTargetSum / wTargetBudget) : 0)
              const wDiff = wCurrentPrice > 0 && wTargetPrice > 0 ? wCurrentPrice - wTargetPrice : null
              const wOver = wDiff !== null && wDiff > 0
              const wWarn = wDiff !== null && !wOver && wCurrentPrice >= wTargetPrice * 0.9
              const wColor = wOver ? '#dc2626' : wWarn ? '#d97706' : '#16a34a'
              const panelLabel = isSingle ? '식단가 (총발주÷총식수)' : '가중평균 식단가'
              const panelIcon  = isSingle ? 'fa-utensils' : 'fa-balance-scale'
              // 막대그래프
              const barHtml2 = wTargetPrice > 0 && wCurrentPrice > 0 ? (() => {
                const maxV2 = Math.max(wTargetPrice, wCurrentPrice) * 1.15
                const tP2 = Math.min(Math.round(wTargetPrice / maxV2 * 100), 100)
                const cP2 = Math.min(Math.round(wCurrentPrice / maxV2 * 100), 100)
                const bc2 = wOver ? '#dc2626' : wWarn ? '#d97706' : '#16a34a'
                return `<div style="margin-top:4px">
                  <div style="display:flex;justify-content:space-between;font-size:9px;color:#9ca3af;margin-bottom:3px">
                    <span>목표 대비</span>
                    <span style="font-weight:700;color:${bc2}">${Math.round(wCurrentPrice/wTargetPrice*100)}%</span>
                  </div>
                  <div style="margin-bottom:3px">
                    <div style="font-size:8px;color:#9ca3af;margin-bottom:1px">현재 ${fmt(wCurrentPrice)}원</div>
                    <div style="background:#e5e7eb;border-radius:3px;height:9px;position:relative;overflow:visible">
                      <div style="height:100%;width:${cP2}%;background:${bc2};border-radius:3px"></div>
                      <div style="position:absolute;top:-2px;left:${tP2}%;transform:translateX(-50%);width:2px;height:13px;background:#7c3aed;border-radius:1px"></div>
                    </div>
                  </div>
                  <div>
                    <div style="font-size:8px;color:#9ca3af;margin-bottom:1px">목표 ${fmt(wTargetPrice)}원 (▎)</div>
                    <div style="background:#e5e7eb;border-radius:3px;height:6px">
                      <div style="height:100%;width:${tP2}%;background:#c084fc;border-radius:3px"></div>
                    </div>
                  </div>
                </div>`
              })() : ''
              // 전월 식단가 (catDietPrices 기반) - 단일 카테고리 전월 대비용
              const prevCatAmt   = isSingle ? (cats[0]?.prevMonthAmt || 0) : 0
              const prevCatMeals = isSingle ? (cats[0]?.prevMonthMeals || 0) : 0
              const prevSinglePrice = prevCatMeals > 0 ? Math.round(prevCatAmt / prevCatMeals) : 0
              // 전월 대비 (단일 카테고리)
              const singlePrevHtml = isSingle && prevSinglePrice > 0 ? (() => {
                const spDiff = wCurrentPrice - prevSinglePrice
                const spArrow = spDiff > 0 ? '▲' : spDiff < 0 ? '▼' : '—'
                const spColor = spDiff > 0 ? '#dc2626' : spDiff < 0 ? '#16a34a' : '#9ca3af'
                return `<div class="mt-1.5 pt-1.5 border-t border-purple-100">
                  <div class="text-xs text-indigo-500 font-semibold mb-1"><i class="fas fa-exchange-alt mr-1"></i>전월 대비</div>
                  <div class="flex items-center justify-between bg-white rounded-lg px-2 py-1 border border-indigo-50 text-xs">
                    <span class="text-gray-500">${fmt(prevSinglePrice)}원 → ${wCurrentPrice>0?fmt(wCurrentPrice)+'원':'집계중'}</span>
                    <span style="color:${spColor};font-weight:700">${spArrow} ${Math.abs(spDiff).toLocaleString()}원</span>
                  </div>
                </div>`
              })() : ''
              return `<div class="mt-2 pt-2 border-t border-blue-100">
                <div class="text-xs text-purple-600 font-semibold mb-1.5"><i class="fas fa-layer-group mr-1"></i>${isSingle ? cats[0].category_name+' 식단가' : '환자군별 식단가'}</div>
                ${!isSingle ? `<div class="grid grid-cols-${Math.min(cats.length, 2)} gap-1 mb-2">
                  ${catRows2.join('')}
                </div>` : ''}
                <div class="p-2 rounded-xl border" style="background:linear-gradient(135deg,#faf5ff,#f0f9ff);border-color:#c084fc40">
                  <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-bold text-purple-700"><i class="fas ${panelIcon} mr-1"></i>${panelLabel}</span>
                    ${wDiff!==null&&wCurrentPrice>0?`<span style="font-size:9px;font-weight:700;color:${wColor}">${wOver?'▲ +':'▼ '}${fmt(Math.abs(wDiff))}원 ${wOver?'초과':wWarn?'주의':'이내'}</span>`:''}
                  </div>
                  <div class="grid grid-cols-2 gap-1.5">
                    <div class="p-1.5 bg-white rounded-lg border border-purple-100 text-center">
                      <div class="text-xs text-gray-400 mb-0.5">목표</div>
                      <div class="text-sm font-bold text-purple-700">${wTargetPrice>0?fmt(wTargetPrice)+'원/식':'미설정'}</div>
                    </div>
                    <div class="p-1.5 bg-white rounded-lg border text-center" style="border-color:${wCurrentPrice>0?wColor+'40':'#e5e7eb'}">
                      <div class="text-xs text-gray-400 mb-0.5">현재</div>
                      <div class="text-sm font-bold" style="color:${wCurrentPrice>0?wColor:'#d1d5db'}">${wCurrentPrice>0?fmt(wCurrentPrice)+'원/식':'미입력'}</div>
                    </div>
                  </div>
                  ${barHtml2}
                  ${singlePrevHtml}
                </div>
              </div>`
            })() : ''}
          </div>

          <!-- ③ 월간 누적 식수 현황 -->
          <div class="mb-3 p-2.5 bg-gradient-to-r from-teal-50 to-cyan-50 rounded-xl border border-teal-100">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-semibold text-teal-700"><i class="fas fa-people-group mr-1"></i>이번달 누적 식수</span>
              <span class="text-xs font-bold text-teal-800">${monthGrandTotal>0?`전체 ${fmt(monthGrandTotal)}식`:'입력 없음'}</span>
            </div>
            <!-- 직원/보호자/환자군 월간 합계 -->
            <div class="grid grid-cols-${Math.min((h.catDietPrices||[]).length+2, 4)} gap-1 text-center mb-1.5">
              <div class="p-1.5 bg-white rounded-lg border border-blue-100">
                <div class="text-xs text-blue-600 font-medium">직원</div>
                <div class="text-sm font-bold text-blue-700">${monthStaffMeals>0?fmt(monthStaffMeals):'-'}</div>
                <div class="text-xs text-gray-400">식</div>
              </div>
              <div class="p-1.5 bg-white rounded-lg border border-purple-100">
                <div class="text-xs text-purple-600 font-medium">보호자</div>
                <div class="text-sm font-bold text-purple-700">${monthGuardMeals>0?fmt(monthGuardMeals):'-'}</div>
                <div class="text-xs text-gray-400">식</div>
              </div>
              ${(h.catDietPrices||[]).map(cat => {
                const color = getCategoryColorHex(cat.category_key)
                const meals = customTotals[`cat_${cat.category_key}`] || 0
                return `<div class="p-1.5 bg-white rounded-lg border" style="border-color:${color}30">
                  <div class="text-xs font-medium" style="color:${color}">${cat.category_name}</div>
                  <div class="text-sm font-bold" style="color:${color}">${meals>0?fmt(meals):'-'}</div>
                  <div class="text-xs text-gray-400">식</div>
                </div>`
              }).join('')}
            </div>
            <!-- 오늘 입력된 식수 (소형) -->
            ${todayTotalMeals>0 ? `
            <div class="mt-1.5 flex items-center justify-between text-xs bg-white border border-teal-100 rounded-lg px-2 py-1">
              <span class="text-teal-600 font-medium"><i class="fas fa-clock mr-1"></i>오늘 입력</span>
              <span class="font-semibold text-teal-700">${fmt(todayTotalMeals)}식
                <span class="text-gray-400 font-normal ml-1">(조${todayBreakfast}/중${todayLunch}/석${todayDinner}
                ${(h.catDietPrices||[]).map(cat=>`· ${cat.category_name} ${(todayCatMeals[cat.id]||0)}식`).join('')})</span>
              </span>
            </div>` : `
            <div class="mt-1.5 text-center text-xs text-gray-400 py-0.5">오늘 식수 미입력</div>`}
            ${monthNonCovMeals > 0 ? `
            <div class="mt-1 text-xs text-gray-400 text-right">비급여 ${fmt(monthNonCovMeals)}식 (합계 제외)</div>` : ''}
          </div>

          <!-- ④ 발주 현황 & 잔반 -->
          <div class="flex gap-2 text-xs text-gray-500 mb-2">
            <span>오늘발주: <strong class="text-gray-700">${fmtMan(h.todayUsed)}원</strong></span>
            <span>·</span>
            <span>이번주: <strong class="text-gray-700">${fmtMan(h.weekUsed)}원</strong></span>
            ${h.foodWaste.totalWaste > 0 ? `<span>·</span><span>잔반: <strong class="text-amber-600">${h.foodWaste.totalWaste.toFixed(1)}kg</strong></span>` : ''}
          </div>

          <!-- ⑤ 이슈 목록 (접기/펼치기) -->
          ${totalIssues > 0 ? `
          <div>
            <button onclick="toggleHospIssues('hissue-${h.hospital.id}')" class="flex items-center justify-between w-full text-xs text-gray-500 hover:text-gray-700 py-1 px-2 rounded-lg hover:bg-gray-50 transition-colors">
              <span class="font-semibold"><i class="fas fa-chevron-right mr-1 transition-transform" id="hissue-icon-${h.hospital.id}"></i>이슈 목록 ${totalIssues}건</span>
              <span>${dangerIssues.length>0?`<span class="text-red-500 font-bold">위험 ${dangerIssues.length}건</span>`:''} ${warnIssues.length>0?`<span class="text-amber-500">경고 ${warnIssues.length}건</span>`:''}</span>
            </button>
            <div id="hissue-${h.hospital.id}" class="space-y-1 mt-1" style="display:none">
              ${dangerIssues.map(i=>`
              <div class="flex items-center gap-1 text-xs bg-red-50 text-red-700 px-2 py-1 rounded-lg border border-red-100">
                <i class="fas fa-exclamation-circle text-red-400 flex-shrink-0"></i><span>${i.msg}</span>
              </div>`).join('')}
              ${warnIssues.map(i=>`
              <div class="flex items-center gap-1 text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded-lg border border-amber-100">
                <i class="fas fa-exclamation-triangle text-amber-400 flex-shrink-0"></i><span>${i.msg}</span>
              </div>`).join('')}
            </div>
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
    <div class="grid grid-cols-2 gap-2 mb-4">
      <div class="bg-red-50 rounded-xl p-2.5 border border-red-200">
        <div class="text-xs text-red-500 mb-0.5">예산 초과</div>
        <div class="text-xl font-bold text-red-600">${hospitals.filter(h=>h.issues.some(i=>i.type==='budget_over')).length}개</div>
      </div>
      <div class="bg-amber-50 rounded-xl p-2.5 border border-amber-200">
        <div class="text-xs text-amber-500 mb-0.5">업체 초과</div>
        <div class="text-xl font-bold text-amber-600">${hospitals.reduce((s,h)=>s+h.issues.filter(i=>i.type==='vendor_over').length,0)}건</div>
      </div>
      <div class="bg-orange-50 rounded-xl p-2.5 border border-orange-200">
        <div class="text-xs text-orange-500 mb-0.5">일 발주 초과</div>
        <div class="text-xl font-bold text-orange-600">${hospitals.reduce((s,h)=>s+h.issues.filter(i=>i.type==='daily_over').length,0)}건</div>
      </div>
      <div class="bg-purple-50 rounded-xl p-2.5 border border-purple-200">
        <div class="text-xs text-purple-500 mb-0.5">식단가 초과</div>
        <div class="text-xl font-bold text-purple-600">${hospitals.filter(h=>h.issues.some(i=>i.type==='meal_price_over')).length}개</div>
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
              ${h.online?`<span class="text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded">${h.online.username}${h.online.last_action?` · ✏️${h.online.last_action}`:h.online.last_page?` · ${h.online.last_page}`:''}</span>`:''}
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
      <p class="text-xs text-gray-400 mb-4">막대: 실제 사용금액 · 빨간선: 목표예산 · 막대 상단 금액 표시</p>
      <canvas id="adminCompareChart" height="80"></canvas>
    </div>
    <!-- 식단가 비교 차트 (꺾은선) -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4">
      <h3 class="font-bold text-gray-700 mb-1"><i class="fas fa-utensils text-purple-500 mr-2"></i>병원별 식단가 비교 (꺾은선)</h3>
      <p class="text-xs text-gray-400 mb-4">전체 식단가 / 직원식 제외 / 소모품 제외 · 꼭짓점 금액 표시</p>
      <canvas id="adminMealPriceChart" height="80"></canvas>
    </div>
    <!-- 요약 테이블 (개선) -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 overflow-x-auto">
      <h3 class="font-bold text-gray-700 mb-3"><i class="fas fa-table text-gray-500 mr-2"></i>병원별 전체 현황 요약</h3>
      <table class="data-table w-full text-sm">
        <thead>
          <tr>
            <th class="text-left pl-3">병원</th>
            <th class="text-center">상태</th>
            <th class="text-center">일 발주<br><span class="font-normal text-xs opacity-60">목표 대비%</span></th>
            <th class="text-center">주 발주<br><span class="font-normal text-xs opacity-60">목표 대비%</span></th>
            <th class="text-center">월 사용 / 목표<br><span class="font-normal text-xs opacity-60">달성률</span></th>
            <th class="text-center">전체식단가<br><span class="font-normal text-xs opacity-60">목표 대비</span></th>
            <th class="text-center">직원제외</th>
            <th class="text-center">소모품제외</th>
            <th class="text-center">잔반</th>
            <th class="text-center">월 달성률</th>
          </tr>
        </thead>
        <tbody>
          ${hospitals.map(h=>{
            const pct = parseFloat(h.progress)
            const mp = h.mealPriceTotal
            const mpOver = h.targetMealPrice > 0 && mp > h.targetMealPrice
            const mpWarn = !mpOver && h.targetMealPrice > 0 && mp > h.targetMealPrice * 0.95
            const todayPct = h.dailyBudget > 0 ? Math.round(h.todayUsed/h.dailyBudget*100) : 0
            const weekPct = h.weekBudget > 0 ? Math.round(h.weekUsed/h.weekBudget*100) : 0
            const todayColor = todayPct>=100?'text-red-600 font-bold':todayPct>=90?'text-amber-500 font-semibold':'text-green-600'
            const weekColor = weekPct>=100?'text-red-600 font-bold':weekPct>=90?'text-amber-500 font-semibold':'text-green-600'
            const monthColor = pct>=100?'text-red-600 font-bold':pct>=90?'text-amber-500 font-semibold':'text-green-600'
            const mpColor = mpOver?'text-red-600 font-bold':mpWarn?'text-amber-600':'text-blue-600'
            return `
            <tr class="${pct>=100&&h.totalBudget>0?'bg-red-50':pct>=90&&h.totalBudget>0?'bg-amber-50':'hover:bg-gray-50'}">
              <td class="font-semibold pl-3 py-2">${h.hospital.name}</td>
              <td class="text-center py-2">
                ${h.online?`<span class="inline-flex items-center gap-1 text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full border border-green-200"><span class="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>${h.online.username||'온라인'}</span>`
                :'<span class="text-xs text-gray-300">오프라인</span>'}
              </td>
              <td class="text-center text-xs py-2">
                <div class="font-semibold">${fmtMan(h.todayUsed)}원</div>
                <div class="${todayColor}">${todayPct}%</div>
                ${h.dailyBudget>0?`<div class="text-gray-400 text-xs">목표 ${fmtMan(h.dailyBudget)}원</div>`:''}
                <div class="mt-0.5 h-1 bg-gray-100 rounded-full w-16 mx-auto overflow-hidden"><div class="h-full rounded-full ${todayPct>=100?'bg-red-400':todayPct>=90?'bg-amber-400':'bg-green-400'}" style="width:${Math.min(todayPct,100)}%"></div></div>
              </td>
              <td class="text-center text-xs py-2">
                <div class="font-semibold">${fmtMan(h.weekUsed)}원</div>
                <div class="${weekColor}">${weekPct}%</div>
                ${h.weekBudget>0?`<div class="text-gray-400 text-xs">목표 ${fmtMan(h.weekBudget)}원</div>`:''}
                <div class="mt-0.5 h-1 bg-gray-100 rounded-full w-16 mx-auto overflow-hidden"><div class="h-full rounded-full ${weekPct>=100?'bg-red-400':weekPct>=90?'bg-amber-400':'bg-green-400'}" style="width:${Math.min(weekPct,100)}%"></div></div>
              </td>
              <td class="text-center text-xs py-2">
                <div class="font-semibold">${fmtMan(h.totalUsed)}원</div>
                <div class="${monthColor}">${pct.toFixed(1)}%</div>
                ${h.totalBudget>0?`<div class="text-gray-400 text-xs">목표 ${fmtMan(h.totalBudget)}원</div>`:''}
                <div class="mt-0.5 h-1 bg-gray-100 rounded-full w-16 mx-auto overflow-hidden"><div class="h-full rounded-full ${pct>=100?'bg-red-400':pct>=90?'bg-amber-400':'bg-green-400'}" style="width:${Math.min(pct,100)}%"></div></div>
              </td>
              <td class="text-center text-xs py-2">
                <div class="${mpColor}">${mp>0?mp.toLocaleString()+'원':'-'}</div>
                ${h.targetMealPrice>0?`<div class="text-gray-400">목표 ${h.targetMealPrice.toLocaleString()}원</div>`:''}
                ${mpOver?`<div class="text-red-500 font-bold">▲초과</div>`:mpWarn?`<div class="text-amber-500">▲주의</div>`:''}
              </td>
              <td class="text-center text-xs py-2 text-purple-600">${h.mealPriceNoStaff>0?h.mealPriceNoStaff.toLocaleString()+'원':'-'}</td>
              <td class="text-center text-xs py-2 text-orange-600">${h.mealPriceNoSupply>0?h.mealPriceNoSupply.toLocaleString()+'원':'-'}</td>
              <td class="text-center text-xs py-2">${h.foodWaste.totalWaste>0?`<span class="text-amber-600 font-medium">${h.foodWaste.totalWaste.toFixed(1)}kg</span>`:'-'}</td>
              <td class="text-center py-2">
                <div class="inline-flex flex-col items-center">
                  <span class="text-sm font-bold ${pct>=100?'text-red-600':pct>=90?'text-amber-500':'text-green-700'}">${pct.toFixed(1)}%</span>
                  <div class="w-16 h-1.5 bg-gray-100 rounded-full mt-1 overflow-hidden"><div class="h-full rounded-full ${pct>=100?'bg-red-400':pct>=90?'bg-amber-400':'bg-green-500'}" style="width:${Math.min(pct,100)}%"></div></div>
                </div>
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

// 병원별 이슈 접기/펼치기 토글
window.toggleHospIssues = (id) => {
  const el = document.getElementById(id)
  const iconId = id.replace('hissue-', 'hissue-icon-')
  const iconEl = document.getElementById(iconId)
  if (!el) return
  const isHidden = el.style.display === 'none' || el.style.display === ''
  el.style.display = isHidden ? 'block' : 'none'
  if (iconEl) {
    iconEl.className = isHidden
      ? 'fas fa-chevron-down mr-1 transition-transform'
      : 'fas fa-chevron-right mr-1 transition-transform'
  }
}

function renderAdminCompareChart(hospitals) {
  // ── 발주 비교 차트 (목표선 + 꼭짓점 금액 레이블)
  const ctx = document.getElementById('adminCompareChart')
  if (ctx) {
    if (App.charts.adminCompare) { App.charts.adminCompare.destroy(); App.charts.adminCompare = null }
    const labels = hospitals.map(h => h.hospital.name)
    const used = hospitals.map(h => h.totalUsed)
    const budget = hospitals.map(h => h.totalBudget)
    const colors = hospitals.map(h => {
      const pct = h.totalBudget > 0 ? h.totalUsed/h.totalBudget*100 : 0
      return pct >= 100 ? 'rgba(239,68,68,0.8)' : pct >= 90 ? 'rgba(245,158,11,0.8)' : 'rgba(34,197,94,0.8)'
    })
    App.charts.adminCompare = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '사용금액', data: used, backgroundColor: colors, borderRadius: 6,
            borderColor: colors.map(c=>c.replace('0.8','1')), borderWidth: 1
          },
          {
            type: 'line', label: '목표예산', data: budget,
            borderColor: '#ef4444', borderDash: [6,3], borderWidth: 2.5,
            pointRadius: 6, pointBackgroundColor: '#ef4444', pointBorderColor: '#fff', pointBorderWidth: 2,
            fill: false, tension: 0
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.dataset.label}: ${fmt(ctx.raw)}원`,
              afterLabel: ctx => {
                if (ctx.datasetIndex === 0 && budget[ctx.dataIndex] > 0) {
                  const pct = Math.round(used[ctx.dataIndex]/budget[ctx.dataIndex]*100)
                  return `달성률: ${pct}%`
                }
                return ''
              }
            }
          },
          datalabels: false
        },
        scales: {
          y: { ticks: { callback: v => fmtMan(v)+'원' }, beginAtZero: true }
        }
      },
      plugins: [{
        id: 'usedLabels',
        afterDatasetsDraw(chart) {
          const { ctx: c, data } = chart
          data.datasets[0].data.forEach((val, i) => {
            if (!val) return
            const meta = chart.getDatasetMeta(0)
            const bar = meta.data[i]
            if (!bar) return
            c.save()
            c.font = 'bold 10px sans-serif'
            c.fillStyle = '#1f2937'
            c.textAlign = 'center'
            c.textBaseline = 'bottom'
            c.fillText(fmtMan(val)+'원', bar.x, bar.y - 2)
            c.restore()
          })
        }
      }]
    })
  }

  // ── 식단가 비교 차트 (꺾은선으로 변경 + 꼭짓점 금액 표시)
  const ctx2 = document.getElementById('adminMealPriceChart')
  if (ctx2) {
    if (App.charts.adminMealPrice) { App.charts.adminMealPrice.destroy(); App.charts.adminMealPrice = null }
    const labels = hospitals.map(h => h.hospital.name)
    const mp1 = hospitals.map(h => h.mealPriceTotal)
    const mp2 = hospitals.map(h => h.mealPriceNoStaff)
    const mp3 = hospitals.map(h => h.mealPriceNoSupply)
    const targets = hospitals.map(h => h.targetMealPrice)
    App.charts.adminMealPrice = new Chart(ctx2, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '전체 식단가', data: mp1, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.08)',
            borderWidth: 2.5, pointRadius: 6, pointBackgroundColor: '#2563eb',
            pointBorderColor: '#fff', pointBorderWidth: 2, fill: true, tension: 0.3
          },
          {
            label: '직원식 제외', data: mp2, borderColor: '#9333ea', backgroundColor: 'rgba(147,51,234,0.06)',
            borderWidth: 2, pointRadius: 5, pointBackgroundColor: '#9333ea',
            pointBorderColor: '#fff', pointBorderWidth: 2, fill: false, tension: 0.3
          },
          {
            label: '소모품 제외', data: mp3, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.06)',
            borderWidth: 2, pointRadius: 5, pointBackgroundColor: '#f59e0b',
            pointBorderColor: '#fff', pointBorderWidth: 2, fill: false, tension: 0.3, borderDash: [4,2]
          },
          {
            label: '목표 식단가', data: targets,
            borderColor: '#ef4444', borderDash: [8,4], borderWidth: 2,
            pointRadius: 5, pointBackgroundColor: '#ef4444', pointBorderColor: '#fff', pointBorderWidth: 2,
            fill: false, tension: 0
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmt(ctx.raw)}원/식` } }
        },
        scales: { y: { ticks: { callback: v => `${fmt(v)}원` } } }
      },
      plugins: [{
        id: 'mpLabels',
        afterDatasetsDraw(chart) {
          const { ctx: c } = chart
          chart.data.datasets.forEach((ds, di) => {
            if (di > 1) return // 전체/직원제외만 레이블
            const meta = chart.getDatasetMeta(di)
            meta.data.forEach((pt, i) => {
              const val = ds.data[i]
              if (!val) return
              c.save()
              c.font = 'bold 9px sans-serif'
              c.fillStyle = ds.borderColor
              c.textAlign = 'center'
              c.textBaseline = 'bottom'
              c.fillText(val.toLocaleString()+'원', pt.x, pt.y - 6)
              c.restore()
            })
          })
        }
      }]
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

    <div class="overflow-x-auto" style="-webkit-overflow-scrolling:touch;">
      <!-- 모바일 스크롤 안내 -->
      <div class="md:hidden text-center py-1 text-xs text-gray-400 bg-blue-50 border-b border-blue-100">
        <i class="fas fa-hand-point-right mr-1 text-blue-400"></i>좌우로 스크롤하여 전체 스케줄 확인
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;border:2px solid #166534">
        <thead>
          <tr style="background:#166534;color:white;border-bottom:3px solid #14532d">
            <th style="padding:8px 12px;text-align:left;min-width:90px;position:sticky;left:0;background:#166534;z-index:10;border-right:3px solid #14532d;border-bottom:3px solid #14532d">이름/직책</th>
            ${Array.from({length:days},(_,i)=>{
              const day=i+1, dow=getDayOfWeek(App.currentYear,App.currentMonth,day)
              const isWknd=isWeekend(App.currentYear,App.currentMonth,day)
              const isSun=dow==='일', isSat=dow==='토'
              const borderCol = isSun ? '#fca5a5' : isSat ? '#93c5fd' : 'rgba(255,255,255,0.2)'
              return `<th style="padding:6px 2px;text-align:center;min-width:34px;font-weight:${isWknd?'bold':'normal'};color:${isSun?'#fca5a5':isSat?'#93c5fd':'white'};border-left:1px solid ${borderCol};border-bottom:3px solid #14532d;${isWknd?'background:#1a4731;':''}">
                <div style="font-size:12px">${day}</div><div style="font-size:9px;opacity:0.85">${dow}</div>
              </th>`
            }).join('')}
            <th style="padding:8px 6px;min-width:50px;border-left:3px solid #14532d;border-bottom:3px solid #14532d;background:#0f3d25">근무</th>
            <th style="padding:8px 6px;min-width:40px;border-left:1px solid rgba(255,255,255,0.2);border-bottom:3px solid #14532d;background:#0f3d25">연차</th>
          </tr>
        </thead>
        <tbody>
          ${employees.length === 0 ? `
            <tr><td colspan="${days+3}" class="text-center py-12 text-gray-400">
              <i class="fas fa-users text-4xl mb-3 block"></i>
              등록된 직원이 없습니다. 직원을 추가해주세요.
            </td></tr>
          ` : employees.map((emp, empIdx) => {
            const empSchedule = schedMap[emp.id] || {}
            let workDays = 0, annualDays = 0, restDays = 0
            for (let d=1; d<=days; d++) {
              const dateStr = `${App.currentYear}-${String(App.currentMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`
              const shift = empSchedule[dateStr]
              if (shift && shift !== '-' && shift !== '휴' && shift !== '연') workDays++
              if (shift === '연') annualDays++
              if (shift === '휴') restDays++
            }
            const rowBg = empIdx % 2 === 0 ? 'white' : '#fafafa'
            return `<tr style="border-bottom:1px solid #e2e8f0" onmouseover="this.style.background='#f0fdf4'" onmouseout="this.style.background='${rowBg}'">
              <td style="padding:6px 12px;position:sticky;left:0;background:${rowBg};z-index:5;border-right:3px solid #d1fae5;min-width:90px">
                <div style="font-weight:600;color:#1f2937;font-size:12px">${emp.name}</div>
                <div style="font-size:10px;color:#94a3b8">${emp.position}</div>
              </td>
              ${Array.from({length:days},(_,i)=>{
                const day=i+1
                const dateStr=`${App.currentYear}-${String(App.currentMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`
                const shift=empSchedule[dateStr]||''
                const isWknd=isWeekend(App.currentYear,App.currentMonth,day)
                const dow2=getDayOfWeek(App.currentYear,App.currentMonth,day)
                const isSun2=dow2==='일'
                const cellBg=isSun2?'background:#fff1f2;':isWknd?'background:#fffbeb;':`background:${rowBg};`
                const borderLeft = `border-left:1px solid ${isSun2?'#fecaca':isWknd?'#fde68a':'#e5e7eb'};`
                const colorClass=SHIFT_COLORS[shift]||''
                return `<td style="padding:3px 2px;text-align:center;${cellBg}${borderLeft}cursor:pointer;border-bottom:1px solid #e5e7eb" 
                  onclick="cycleShift(${emp.id},'${dateStr}',this)"
                  data-shift="${shift}" data-employee="${emp.id}" data-date="${dateStr}">
                  <span class="inline-flex items-center justify-center w-7 h-7 rounded text-xs font-bold ${colorClass||'bg-gray-50 text-gray-300'}">${shift||'·'}</span>
                </td>`
              }).join('')}
              <td style="padding:6px;text-align:center;background:#f0fdf4;border-left:3px solid #d1fae5;font-weight:700;color:#166534;font-size:13px">${workDays}</td>
              <td style="padding:6px;text-align:center;background:#fef9c3;border-left:1px solid #fde68a;font-weight:700;color:#92400e;font-size:13px">${annualDays}</td>
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

  const [hospitals, closingReqs, recentApproved] = await Promise.all([
    api('GET', '/api/admin/hospitals'),
    api('GET', '/api/admin/closing-requests'),
    api('GET', '/api/admin/closing-requests/recent-approved').catch(() => [])
  ])

  const pendingClosings = closingReqs || []
  const approvedClosings = recentApproved || []

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

  <!-- 최근 승인된 마감 (롤백 가능) -->
  ${approvedClosings.length > 0 ? `
  <div class="mb-5 bg-blue-50 border border-blue-200 rounded-xl p-4">
    <div class="flex items-center gap-2 mb-3">
      <i class="fas fa-history text-blue-500"></i>
      <span class="font-bold text-blue-800">최근 마감 승인 이력 (실수 시 되돌리기 가능)</span>
    </div>
    <div class="space-y-2">
      ${approvedClosings.map(r => `
        <div class="flex items-center justify-between bg-white rounded-lg p-3 border border-blue-100">
          <div>
            <span class="font-semibold text-gray-800">${r.hospital_name}</span>
            <span class="text-sm text-gray-500 ml-2">${r.year}년 ${r.month}월 → ${r.month==12?r.year+1+'년 1':r.year+'년 '+(parseInt(r.month)+1)}월로 전환됨</span>
            <span class="text-xs text-gray-400 ml-2">승인: ${r.approved_at?.split('T')[0]}</span>
          </div>
          <button onclick="rollbackClosing(${r.hospital_id},${r.year},${r.month},'${r.hospital_name}')"
            class="btn btn-sm bg-red-50 text-red-600 border border-red-200 hover:bg-red-100">
            <i class="fas fa-undo mr-1"></i>되돌리기
          </button>
        </div>
      `).join('')}
    </div>
    <p class="text-xs text-blue-500 mt-2"><i class="fas fa-info-circle mr-1"></i>되돌리기를 하면 해당 월의 마감 요청 상태로 복원됩니다. 영양사 페이지도 해당 월로 돌아갑니다.</p>
  </div>` : ''}

  <!-- 병원 목록 -->
  <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
    <div class="p-5 border-b border-gray-100 flex items-center justify-between">
      <h2 class="font-bold text-gray-800"><i class="fas fa-hospital text-green-600 mr-2"></i>병원 목록</h2>
      <span class="text-sm text-gray-400">총 ${(hospitals||[]).length}개 병원</span>
    </div>
    <div class="divide-y divide-gray-50">
      ${(hospitals||[]).map(h => `
        <div class="p-3 md:p-4 hover:bg-gray-50 transition cursor-pointer" onclick="openHospitalDetail(${h.id})">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 md:gap-3 min-w-0">
              <div class="w-9 h-9 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                <i class="fas fa-hospital text-green-600 text-sm"></i>
              </div>
              <div class="min-w-0">
                <div class="font-semibold text-gray-800 text-sm truncate">${h.name}</div>
                <div class="text-xs text-gray-400 truncate">
                  ${getHospitalTypeLabel(h.hospital_type)} · 
                  ${h.licensed_beds||'-'}병상 · 
                  ${h.dietitian_name||'영양사 미등록'}
                  ${h.main_specialty ? ` · <span class="text-green-600 font-medium">${h.main_specialty}</span>` : ''}
                </div>
              </div>
            </div>
            <div class="flex flex-col items-end gap-1 flex-shrink-0 md:flex-row md:items-center md:gap-3">
              <span class="badge ${h.closing_status==='requested'?'badge-yellow':h.closing_status==='closed'?'badge-green':'badge-gray'} text-xs">
                ${h.closing_status==='requested'?'마감요청':h.closing_status==='closed'?'마감':'운영중'}
              </span>
              <span class="text-xs text-green-700 font-semibold">${h.current_year||2026}년 ${h.current_month||3}월</span>
              <i class="fas fa-chevron-right text-gray-300 text-xs hidden md:block"></i>
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

async function rollbackClosing(hospitalId, year, month, hospitalName) {
  if (!confirm(`⚠️ [${hospitalName}] ${year}년 ${month}월로 되돌리시겠습니까?\n\n영양사 페이지가 ${month}월 상태로 복원됩니다.\n실수로 승인한 경우에만 사용하세요.`)) return
  const res = await api('POST', `/api/admin/closing-rollback/${hospitalId}`, { year, month })
  if (res?.success) {
    showToast(res.message || `${year}년 ${month}월로 되돌렸습니다`, 'success')
    renderHospitalManage()
  } else {
    showToast('되돌리기 실패', 'error')
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
  <div class="modal-box" style="max-width:820px;width:100%">
    <div class="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between z-10 md:px-6 md:py-4">
      <h2 class="font-bold text-base text-gray-800 truncate md:text-xl"><i class="fas fa-hospital text-green-600 mr-2"></i>${hosp.name}</h2>
      <div class="flex items-center gap-2 flex-shrink-0">
        <button onclick="saveAllHospitalTabs(${hospitalId})" class="btn btn-primary btn-sm">
          <i class="fas fa-save mr-1"></i>전체 저장
        </button>
        <button onclick="document.getElementById('hospDetailModal').remove()" class="text-gray-400 hover:text-gray-600 text-xl w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100">✕</button>
      </div>
    </div>
    <div class="p-3 space-y-4 md:p-6 md:space-y-6">

      <!-- 탭 -->
      <div class="flex gap-1 border-b border-gray-100 pb-2 overflow-x-auto md:gap-2 md:pb-3">
        <button class="tab-btn active flex-shrink-0" id="tab-info" onclick="switchHospTab('info')">
          <i class="fas fa-info-circle mr-1"></i>기본정보
        </button>
        <button class="tab-btn flex-shrink-0" id="tab-categories" onclick="switchHospTab('categories')">
          <i class="fas fa-layer-group mr-1"></i>환자군설정
        </button>
        <button class="tab-btn flex-shrink-0" id="tab-budget" onclick="switchHospTab('budget')">
          <i class="fas fa-won-sign mr-1"></i>예산설정
        </button>
        <button class="tab-btn flex-shrink-0" id="tab-vendors" onclick="switchHospTab('vendors')">
          <i class="fas fa-store mr-1"></i>업체관리
        </button>
        <button class="tab-btn flex-shrink-0" id="tab-accounts" onclick="switchHospTab('accounts')">
          <i class="fas fa-user-circle mr-1"></i>계정관리
        </button>
      </div>

      <!-- 기본정보 탭 -->
      <div id="hospTab-info">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
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
          <!-- 주소 (카카오 주소검색) -->
          <div class="md:col-span-2">
            <label class="block text-xs font-semibold text-gray-500 mb-1">주소</label>
            <div class="flex gap-2">
              <input id="hi-address" class="form-input flex-1" value="${hosp.address||''}" placeholder="카카오 주소검색 또는 직접 입력" readonly>
              <button type="button" onclick="openKakaoAddressSearch()" class="btn btn-secondary btn-sm whitespace-nowrap">
                <i class="fas fa-search-location mr-1"></i>주소검색
              </button>
            </div>
            <input id="hi-address-detail" class="form-input mt-1" value="${hosp.address_detail||''}" placeholder="상세주소 입력">
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
          <!-- 주종목 드롭다운 (복수 선택 가능) -->
          <div class="md:col-span-2">
            <label class="block text-xs font-semibold text-gray-500 mb-1">주 종목</label>
            <div class="flex flex-wrap gap-2 mb-2" id="specialty-chips">
              ${(hosp.main_specialty||'').split(',').filter(Boolean).map(s=>`
                <span class="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs">
                  ${s.trim()}<button type="button" onclick="removeSpecialtyChip(this)" class="ml-1 text-blue-400 hover:text-red-500">×</button>
                </span>`).join('')}
            </div>
            <div class="flex gap-2">
              <select id="hi-specialty-select" class="form-input flex-1" onchange="addSpecialtyChip(this)">
                <option value="">-- 종목 선택 --</option>
                ${['암','교통사고','척추재활','관절','요양','정신','소아','산부인과','심장','신장','노인요양','호흡기','소화기','뇌졸중','기타'].map(v=>`<option value="${v}">${v}</option>`).join('')}
              </select>
              <input id="hi-specialty-custom" class="form-input" placeholder="직접입력" style="max-width:130px"
                onkeydown="if(event.key==='Enter'){event.preventDefault();addSpecialtyCustom()}">
            </div>
            <input type="hidden" id="hi-specialty" value="${hosp.main_specialty||''}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">급식 운영방식</label>
            <select id="hi-optype" class="form-input" onchange="toggleConsignField(this.value)">
              <option value="direct" ${hosp.operation_type==='direct'?'selected':''}>직영</option>
              <option value="consignment" ${hosp.operation_type==='consignment'?'selected':''}>위탁</option>
            </select>
          </div>
          <div id="hi-consign-wrap" style="${hosp.operation_type==='consignment'?'':'display:none'}">
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
            <label class="block text-xs font-semibold text-gray-500 mb-1">컨설팅 전 평균 식단가 (원/식)</label>
            <input id="hi-curprice" type="number" class="form-input" value="${hosp.current_meal_price||0}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">컨설팅 전 연간 총 급식 예산 (원)</label>
            <input id="hi-annual" type="number" class="form-input" value="${hosp.annual_budget||0}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">컨설팅 전 월평균 예산 (원)</label>
            <div class="flex gap-2">
              <input id="hi-monthly-avg" type="number" class="form-input flex-1" value="${hosp.monthly_avg_budget||0}" placeholder="직접 입력">
            </div>
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">영양사 이름</label>
            <input id="hi-dietname" class="form-input" value="${hosp.dietitian_name||''}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">영양사 연락처</label>
            <input id="hi-dietphone" class="form-input" value="${hosp.dietitian_phone||''}">
          </div>
          <div class="md:col-span-2">
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
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
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
            <label class="block text-xs font-semibold text-gray-500 mb-1">목표 식단가 (원/식)
              <span class="text-green-500 font-normal ml-1"><i class="fas fa-magic mr-0.5"></i>환자군설정 가중평균 자동반영</span>
            </label>
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

      <!-- 환자군 카테고리 탭 -->
      <div id="hospTab-categories" class="hidden">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-semibold text-gray-700"><i class="fas fa-layer-group text-purple-600 mr-1"></i>환자군 카테고리 설정</h3>
          <button onclick="addPatientCategoryRow()" class="btn btn-success btn-sm">
            <i class="fas fa-plus mr-1"></i>카테고리 추가
          </button>
        </div>
        <div class="mb-3 p-3 bg-purple-50 rounded-xl text-xs text-purple-700">
          <i class="fas fa-info-circle mr-1"></i>
          설정한 카테고리는 <strong>발주 입력 화면</strong>에 열(column)로 자동 생성됩니다.<br>
          예: 항암, 재활, 교통사고 등 병원 특성에 맞게 설정하세요.<br>
          각 카테고리별 <strong>과세/면세 금액이 합산</strong>되어 일별·주별·월별 목표와 비교됩니다.
        </div>

        <!-- 사전정의 카테고리 빠른선택 -->
        <div class="mb-4">
          <div class="text-xs font-semibold text-gray-500 mb-2">빠른 선택 (클릭하면 추가)</div>
          <div class="flex flex-wrap gap-1.5">
            ${[
              {key:'general',name:'일반'},
              {key:'cancer',name:'항암'},
              {key:'rehab',name:'재활'},
              {key:'nursing',name:'요양'},
              {key:'traffic',name:'교통사고'},
              {key:'mental',name:'정신'},
              {key:'pediatric',name:'소아'},
              {key:'spine',name:'척추'},
              {key:'joint',name:'관절'},
              {key:'cardiac',name:'심장'},
              {key:'dialysis',name:'투석'},
              {key:'stroke',name:'뇌졸중'},
              {key:'elderly',name:'노인전문'},
              {key:'maternity',name:'산부인과'},
              {key:'other',name:'기타'}
            ].map(c => `<button type="button" onclick="quickAddCategory('${c.key}','${c.name}')"
              class="px-2 py-1 bg-white border border-purple-200 text-purple-700 text-xs rounded-full hover:bg-purple-100 transition">${c.name}</button>`).join('')}
          </div>
        </div>

        <!-- 카테고리 목록 -->
        <div id="patientCategoryList" class="space-y-2">
          <!-- 동적으로 렌더링됨 -->
          <div class="text-xs text-gray-400 text-center py-4">로딩 중...</div>
        </div>

        <!-- 월별 목표 설정 -->
        <div class="mt-5 border-t border-gray-100 pt-4">
          <h4 class="font-semibold text-gray-700 text-sm mb-3">
            <i class="fas fa-target text-green-600 mr-1"></i>
            ${App.currentYear}년 ${App.currentMonth}월 카테고리별 목표 설정
          </h4>
          <div id="categoryBudgetList" class="space-y-2">
            <div class="text-xs text-gray-400 text-center py-2">카테고리를 먼저 저장하세요</div>
          </div>
        </div>

        <div class="mt-4 flex gap-2 justify-end">
          <button onclick="savePatientCategories(${hospitalId})" class="btn btn-primary">
            <i class="fas fa-save mr-1"></i>카테고리 저장
          </button>
          <button onclick="saveCategoryBudgets(${hospitalId})" class="btn btn-success">
            <i class="fas fa-won-sign mr-1"></i>목표금액 저장
          </button>
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
          <div class="relative mt-1">
            <input type="text" id="adminAccountPassword" class="form-input pr-10" placeholder="비밀번호 입력">
            <button type="button" onclick="togglePwVisibility()" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">
              <i class="fas fa-eye" id="pwEyeIcon"></i>
            </button>
          </div>
          <p class="text-xs text-gray-400 mt-1" id="adminAccountPwHint"></p>
        </div>
        <div>
          <label class="text-sm font-medium text-gray-600">영양사 이름</label>
          <input type="text" id="adminAccountNutrName" class="form-input mt-1" placeholder="영양사 이름 (선택)">
        </div>
      </div>
      <!-- 생성 완료 후 표시 영역 -->
      <div id="accountCreatedResult" class="hidden mt-3 p-3 bg-green-50 border border-green-200 rounded-xl text-sm">
        <div class="font-bold text-green-700 mb-1.5"><i class="fas fa-check-circle mr-1"></i>계정 생성 완료</div>
        <div class="space-y-1 text-xs">
          <div class="flex justify-between"><span class="text-gray-500">아이디</span><span class="font-mono font-bold" id="createdUsername"></span></div>
          <div class="flex justify-between"><span class="text-gray-500">비밀번호</span><span class="font-mono font-bold text-red-600" id="createdPassword"></span></div>
          <div class="flex justify-between" id="createdNutrRow"><span class="text-gray-500">영양사</span><span class="font-semibold" id="createdNutrName"></span></div>
        </div>
        <p class="text-xs text-gray-400 mt-2">* 이 화면을 닫으면 비밀번호를 다시 확인할 수 없습니다</p>
      </div>
      <div class="flex gap-2 mt-5" id="accountModalBtns">
        <button onclick="saveAdminAccount()" class="btn btn-primary flex-1">저장</button>
        <button onclick="document.getElementById('adminAccountModal').classList.add('hidden'); document.getElementById('accountCreatedResult').classList.add('hidden')" class="btn btn-secondary flex-1">취소</button>
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
          <input id="hvb-${v.id}" type="number" class="form-input w-40 text-right text-sm py-1.5 vendor-budget-input"
            value="${v.monthly_budget||0}" placeholder="0" oninput="syncVendorBudgetTotal()">
          <span class="text-xs text-gray-400 whitespace-nowrap">원</span>
        </div>
      </div>
    `).join('')}
    <div class="flex items-center gap-3 py-2 border-t-2 border-green-200 bg-green-50 rounded-lg px-2 mt-2">
      <div class="flex-1 font-semibold text-sm text-green-800"><i class="fas fa-calculator mr-1 text-green-600"></i>업체별 합계</div>
      <div class="flex items-center gap-2">
        <span id="vendorBudgetSum" class="font-bold text-green-700 text-sm"></span>
        <span class="text-xs text-gray-400">원</span>
      </div>
    </div>
  </div>`
}

// 업체별 예산 합산 자동 동기화
window.syncVendorBudgetTotal = function() {
  const inputs = document.querySelectorAll('.vendor-budget-input')
  let sum = 0
  inputs.forEach(inp => { sum += parseInt(inp.value||0)||0 })
  const sumEl = document.getElementById('vendorBudgetSum')
  if (sumEl) sumEl.textContent = fmt(sum)
  // 월 총 목표금액 필드 자동 반영
  const totalEl = document.getElementById('hb-total')
  if (totalEl) { totalEl.value = sum; totalEl.style.background = '#f0fdf4' }
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
    ${accounts.map(a => {
      // 실시간 접속 상태: last_active가 3분 이내면 온라인
      const lastActive = a.last_active ? new Date(a.last_active) : null
      const isOnline = lastActive && (Date.now() - lastActive.getTime()) < 3 * 60 * 1000
      const lastPage = a.current_page || ''
      const lastAction = a.last_action || ''
      const lastActiveStr = lastActive ? lastActive.toLocaleTimeString('ko-KR', {hour:'2-digit',minute:'2-digit'}) : '-'
      const pwDisplay = a.password_plain || null
      const pwId = `pw-disp-${a.id}`
      return `
      <div class="flex items-center gap-3 py-3 hover:bg-gray-50 px-2 rounded-lg">
        <div class="w-9 h-9 rounded-full ${isOnline ? 'bg-green-100' : 'bg-gray-100'} flex items-center justify-center flex-shrink-0 relative">
          <i class="fas fa-user ${isOnline ? 'text-green-600' : 'text-gray-400'} text-sm"></i>
          <!-- 온라인 인디케이터 -->
          <span class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${isOnline ? 'bg-green-500' : 'bg-gray-300'}"></span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-medium text-sm">${a.username}</span>
            ${isOnline
              ? `<span class="text-xs font-semibold text-green-600 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded-full">● 접속중</span>`
              : `<span class="text-xs text-gray-400">마지막 ${lastActiveStr}</span>`
            }
          </div>
          ${a.nutritionist_name ? `<div class="text-xs text-blue-600 font-medium"><i class="fas fa-user-nurse mr-1"></i>${a.nutritionist_name}</div>` : ''}
          ${isOnline && lastAction ? `<div class="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded inline-block mt-0.5"><i class="fas fa-pencil-alt mr-0.5"></i>편집 중: ${lastAction}</div>` : ''}
          ${isOnline && !lastAction && lastPage ? `<div class="text-xs text-green-500"><i class="fas fa-eye mr-1"></i>${lastPage}</div>` : ''}
          <!-- 비밀번호 표시 영역 -->
          <div class="flex items-center gap-1.5 mt-0.5">
            <span class="text-xs text-gray-400">PW:</span>
            <span id="${pwId}" class="text-xs font-mono text-gray-300 select-all">••••••</span>
            <button onclick="toggleAccountPw('${pwId}','${pwDisplay ? pwDisplay.replace(/'/g, "\\'") : ''}')"
              class="text-xs text-gray-400 hover:text-gray-700 transition-colors" title="비밀번호 표시/숨김">
              <i class="fas fa-eye text-xs"></i>
            </button>
            ${pwDisplay ? '' : '<span class="text-xs text-amber-500 ml-1">변경 필요</span>'}
          </div>
          <div class="text-xs text-gray-400">생성일: ${a.created_at?.split('T')[0] || '-'}</div>
        </div>
        <div class="flex gap-1">
          <button onclick="editAdminAccount(${a.id}, '${a.username}', '${(a.nutritionist_name||'').replace(/'/g, "\\'")}')"
            class="btn btn-secondary btn-sm px-2" title="계정 수정">
            <i class="fas fa-key text-xs"></i>
          </button>
          <button onclick="deleteAdminAccount(${a.id}, '${a.username}')"
            class="btn btn-danger btn-sm px-2" title="계정 삭제">
            <i class="fas fa-trash text-xs"></i>
          </button>
        </div>
      </div>`
    }).join('')}
  </div>`
}

// 비밀번호 표시/숨김 토글
window.toggleAccountPw = function(spanId, pw) {
  const el = document.getElementById(spanId)
  if (!el) return
  if (!pw) { showToast('저장된 비밀번호 없음. 비밀번호를 변경해주세요.', 'warning'); return }
  if (el.textContent === '••••••') {
    el.textContent = pw
    el.classList.remove('text-gray-300')
    el.classList.add('text-red-600', 'font-bold')
  } else {
    el.textContent = '••••••'
    el.classList.remove('text-red-600', 'font-bold')
    el.classList.add('text-gray-300')
  }
}

function renderAdminVendorRows(vendors) {
  if (!vendors || vendors.length === 0) {
    return `<div class="text-center py-10 text-gray-400">
      <i class="fas fa-store text-4xl mb-3 block text-gray-300"></i>
      <p class="text-sm">등록된 업체가 없습니다</p>
      <p class="text-xs mt-1 text-gray-300">업체 추가 버튼을 눌러 업체를 등록하세요</p>
    </div>`
  }
  return `<div class="divide-y divide-gray-50" id="vendorSortableList">
    ${vendors.map((v, idx) => `
      <div class="flex items-center gap-3 py-3 hover:bg-gray-50 px-2 rounded-lg cursor-grab active:cursor-grabbing select-none" 
           id="avendor-row-${v.id}" draggable="true" data-vendor-id="${v.id}"
           ondragstart="vendorDragStart(event,${v.id})"
           ondragover="vendorDragOver(event)"
           ondragleave="vendorDragLeave(event)"
           ondrop="vendorDrop(event,${v.id})">
        <i class="fas fa-grip-vertical text-gray-300 text-xs cursor-grab flex-shrink-0"></i>
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

// 업체 드래그 정렬
let _dragVendorId = null
window.vendorDragStart = function(e, id) {
  _dragVendorId = id
  e.dataTransfer.effectAllowed = 'move'
  e.currentTarget.style.opacity = '0.5'
}
window.vendorDragOver = function(e) {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  e.currentTarget.style.background = '#f0fdf4'
  e.currentTarget.style.borderTop = '2px solid #16a34a'
}
window.vendorDragLeave = function(e) {
  e.currentTarget.style.background = ''
  e.currentTarget.style.borderTop = ''
}
window.vendorDrop = async function(e, targetId) {
  e.preventDefault()
  e.currentTarget.style.background = ''
  e.currentTarget.style.borderTop = ''
  if (_dragVendorId === targetId) return
  const list = document.getElementById('vendorSortableList')
  if (!list) return
  const rows = Array.from(list.querySelectorAll('[data-vendor-id]'))
  const dragEl = list.querySelector(`[data-vendor-id="${_dragVendorId}"]`)
  const targetEl = e.currentTarget
  if (!dragEl || !targetEl) return
  // DOM 순서 변경
  list.insertBefore(dragEl, targetEl)
  dragEl.style.opacity = '1'
  // 번호 갱신
  Array.from(list.querySelectorAll('[data-vendor-id]')).forEach((el, i) => {
    const numEl = el.querySelectorAll('span')[1]
    if (numEl) numEl.textContent = i + 1
  })
  // 서버에 순서 저장
  const hospitalId = window._adminHospitalId
  if (!hospitalId) return
  const newOrder = Array.from(list.querySelectorAll('[data-vendor-id]')).map((el, i) => ({
    id: parseInt(el.dataset.vendorId), sort_order: i + 1
  }))
  await api('PUT', `/api/admin/hospitals/${hospitalId}/vendors/reorder`, { order: newOrder })
  // window._adminHospVendors 순서도 갱신
  const updated = await api('GET', `/api/admin/hospitals/${hospitalId}/vendors`)
  if (updated) window._adminHospVendors = updated
  showToast('순서가 저장되었습니다', 'success')
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
function togglePwVisibility() {
  const el = document.getElementById('adminAccountPassword')
  const icon = document.getElementById('pwEyeIcon')
  if (!el) return
  if (el.type === 'text') {
    el.type = 'password'
    icon.className = 'fas fa-eye'
  } else {
    el.type = 'text'
    icon.className = 'fas fa-eye-slash'
  }
}

function showAdminAddAccountModal() {
  document.getElementById('adminAccountModalTitle').textContent = '계정 추가'
  document.getElementById('adminAccountId').value = ''
  document.getElementById('adminAccountUsername').value = ''
  document.getElementById('adminAccountUsername').disabled = false
  document.getElementById('adminAccountPassword').value = ''
  document.getElementById('adminAccountPassword').type = 'text'
  document.getElementById('pwEyeIcon').className = 'fas fa-eye-slash'
  document.getElementById('adminAccountPwLabel').textContent = '비밀번호 *'
  document.getElementById('adminAccountPwHint').textContent = ''
  document.getElementById('adminAccountNutrName').value = ''
  document.getElementById('adminAccountNutrName').disabled = false
  document.getElementById('accountCreatedResult').classList.add('hidden')
  document.getElementById('accountModalBtns').innerHTML = `
    <button onclick="saveAdminAccount()" class="btn btn-primary flex-1">저장</button>
    <button onclick="document.getElementById('adminAccountModal').classList.add('hidden'); document.getElementById('accountCreatedResult').classList.add('hidden')" class="btn btn-secondary flex-1">취소</button>`
  document.getElementById('adminAccountModal').classList.remove('hidden')
}

function editAdminAccount(id, username, nutriName) {
  document.getElementById('adminAccountModalTitle').textContent = '계정 수정'
  document.getElementById('adminAccountId').value = id
  document.getElementById('adminAccountUsername').value = username
  document.getElementById('adminAccountUsername').disabled = true
  document.getElementById('adminAccountPassword').value = ''
  document.getElementById('adminAccountPassword').type = 'password'
  document.getElementById('pwEyeIcon').className = 'fas fa-eye'
  document.getElementById('adminAccountPwLabel').textContent = '새 비밀번호 (변경 시에만 입력)'
  document.getElementById('adminAccountPwHint').textContent = '비워두면 기존 비밀번호 유지'
  document.getElementById('adminAccountNutrName').value = nutriName || ''  // ← 현재 영양사 이름 표시
  document.getElementById('adminAccountNutrName').disabled = false  // ← 영양사 이름 수정 가능
  document.getElementById('adminAccountNutrName').placeholder = '영양사 이름 변경 (선택)'
  document.getElementById('accountCreatedResult').classList.add('hidden')
  document.getElementById('accountModalBtns').innerHTML = `
    <button onclick="saveAdminAccount()" class="btn btn-primary flex-1">변경</button>
    <button onclick="document.getElementById('adminAccountModal').classList.add('hidden')" class="btn btn-secondary flex-1">취소</button>`
  document.getElementById('adminAccountModal').classList.remove('hidden')
}

async function saveAdminAccount() {
  const hospitalId = window._adminHospitalId
  if (!hospitalId) return
  const aid = document.getElementById('adminAccountId').value
  const username = document.getElementById('adminAccountUsername').value.trim()
  const password = document.getElementById('adminAccountPassword').value
  const nutritionistName = document.getElementById('adminAccountNutrName')?.value?.trim() || ''

  if (!username) { showToast('아이디를 입력하세요', 'error'); return }
  // 신규 계정은 비밀번호 필수, 수정 시 비밀번호는 선택
  if (!aid) {
    if (!password) { showToast('비밀번호를 입력하세요', 'error'); return }
    if (password.length < 4) { showToast('비밀번호는 4자 이상 입력하세요', 'error'); return }
  } else {
    if (password && password.length < 4) { showToast('비밀번호는 4자 이상 입력하세요', 'error'); return }
  }

  const body = aid
    ? { nutritionistName, ...(password ? { password } : {}) }
    : { username, password, nutritionistName }
  const res = aid
    ? await api('PUT', `/api/admin/hospitals/${hospitalId}/accounts/${aid}`, body)
    : await api('POST', `/api/admin/hospitals/${hospitalId}/accounts`, body)

  if (res?.success) {
    if (!aid) {
      // 신규 계정 생성 - 모달에 결과 표시 (비밀번호 확인 위해)
      document.getElementById('createdUsername').textContent = res.username || username
      document.getElementById('createdPassword').textContent = res.password || password
      const nutrRow = document.getElementById('createdNutrRow')
      if (nutrRow) nutrRow.style.display = res.nutritionistName ? '' : 'none'
      if (document.getElementById('createdNutrName')) document.getElementById('createdNutrName').textContent = res.nutritionistName || ''
      document.getElementById('accountCreatedResult').classList.remove('hidden')
      // 폼 비활성화
      document.getElementById('adminAccountUsername').disabled = true
      document.getElementById('adminAccountPassword').disabled = true
      if (document.getElementById('adminAccountNutrName')) document.getElementById('adminAccountNutrName').disabled = true
      document.getElementById('accountModalBtns').innerHTML = `
        <button onclick="document.getElementById('adminAccountModal').classList.add('hidden'); document.getElementById('accountCreatedResult').classList.add('hidden')" class="btn btn-primary flex-1">확인 후 닫기</button>`
      showToast('계정이 생성되었습니다', 'success')
    } else {
      // 비밀번호 변경 - 바로 닫기
      document.getElementById('adminAccountModal').classList.add('hidden')
      showToast('비밀번호가 변경되었습니다', 'success')
    }
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
  ['info','categories','budget','vendors','accounts'].forEach(t => {
    document.getElementById(`hospTab-${t}`)?.classList.toggle('hidden', t !== tab)
    document.getElementById(`tab-${t}`)?.classList.toggle('active', t === tab)
  })
  // 환자군 탭으로 전환 시 데이터 로드
  if (tab === 'categories' && window._adminHospitalId) {
    loadPatientCategories(window._adminHospitalId)
  }
}

// 전체 탭 한 번에 저장
async function saveAllHospitalTabs(hospitalId) {
  showToast('전체 저장 중...', 'info')
  const results = []
  // 기본정보 저장
  try {
    await saveHospitalInfo(hospitalId)
    results.push('기본정보')
  } catch(e) {}
  // 예산설정 저장
  try {
    await saveHospitalBudget(hospitalId)
    results.push('예산설정')
  } catch(e) {}
  showToast(`저장 완료: ${results.join(', ')}`, 'success')
}

async function saveHospitalInfo(hospitalId) {
  // 주종목 히든 필드 값 동기화
  const chips = document.querySelectorAll('#specialty-chips span')
  if (chips.length > 0) {
    const specialties = Array.from(chips).map(c => c.textContent.replace('×','').trim()).filter(Boolean)
    const hiddenEl = document.getElementById('hi-specialty')
    if (hiddenEl) hiddenEl.value = specialties.join(',')
  }
  // 상세주소 합치기
  const addrMain = document.getElementById('hi-address')?.value || ''
  const addrDetail = document.getElementById('hi-address-detail')?.value || ''
  const fullAddress = addrDetail ? `${addrMain} ${addrDetail}`.trim() : addrMain

  const body = {
    name: document.getElementById('hi-name').value,
    address: fullAddress,
    hospital_type: document.getElementById('hi-type').value,
    licensed_beds: parseInt(document.getElementById('hi-beds').value)||0,
    avg_inpatients: parseInt(document.getElementById('hi-inpatients').value)||0,
    staff_count: parseInt(document.getElementById('hi-staff').value)||0,
    main_specialty: document.getElementById('hi-specialty').value,
    operation_type: document.getElementById('hi-optype').value,
    consignment_company: document.getElementById('hi-consign')?.value || '',
    meals_per_day: parseInt(document.getElementById('hi-meals').value)||3,
    current_meal_price: parseInt(document.getElementById('hi-curprice').value)||0,
    target_meal_price: 0,
    supply_method: document.getElementById('hi-supply').value,
    annual_budget: parseInt(document.getElementById('hi-annual').value)||0,
    monthly_avg_budget: parseInt(document.getElementById('hi-monthly-avg')?.value)||0,
    dietitian_name: document.getElementById('hi-dietname').value,
    dietitian_phone: document.getElementById('hi-dietphone').value,
    admin_memo: document.getElementById('hi-memo').value
  }
  const res = await api('PUT', `/api/admin/hospitals/${hospitalId}/info`, body)
  if (res?.success) showToast('기본정보가 저장되었습니다', 'success')
  else showToast('저장 실패', 'error')
}

// 카카오 주소검색
window.openKakaoAddressSearch = function() {
  // 다음(카카오) 주소검색 API 동적 로드
  if (window.daum && window.daum.Postcode) {
    _execDaumPost()
  } else {
    const s = document.createElement('script')
    s.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
    s.onload = _execDaumPost
    document.head.appendChild(s)
  }
}
function _execDaumPost() {
  if (!window.daum || !window.daum.Postcode) {
    showToast('카카오 주소검색 로드 실패. 직접 입력해주세요.', 'warning'); return
  }
  new window.daum.Postcode({
    oncomplete: function(data) {
      const addr = data.roadAddress || data.jibunAddress
      const el = document.getElementById('hi-address')
      if (el) { el.value = addr; el.readOnly = false }
    }
  }).open()
}

// 주종목 칩 추가/제거
window.addSpecialtyChip = function(select) {
  const val = select.value.trim()
  if (!val) return
  _addChip(val)
  select.value = ''
}
window.addSpecialtyCustom = function() {
  const el = document.getElementById('hi-specialty-custom')
  const val = el.value.trim()
  if (!val) return
  _addChip(val)
  el.value = ''
}
function _addChip(val) {
  const container = document.getElementById('specialty-chips')
  if (!container) return
  // 중복 방지
  const existing = Array.from(container.querySelectorAll('span')).map(s => s.textContent.replace('×','').trim())
  if (existing.includes(val)) return
  const span = document.createElement('span')
  span.className = 'inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs'
  span.innerHTML = `${val}<button type="button" onclick="removeSpecialtyChip(this)" class="ml-1 text-blue-400 hover:text-red-500">×</button>`
  container.appendChild(span)
  _syncSpecialtyHidden()
}
window.removeSpecialtyChip = function(btn) {
  btn.parentElement.remove()
  _syncSpecialtyHidden()
}
function _syncSpecialtyHidden() {
  const chips = document.querySelectorAll('#specialty-chips span')
  const specialties = Array.from(chips).map(c => c.textContent.replace('×','').trim()).filter(Boolean)
  const el = document.getElementById('hi-specialty')
  if (el) el.value = specialties.join(',')
}
window.toggleConsignField = function(val) {
  const wrap = document.getElementById('hi-consign-wrap')
  if (wrap) wrap.style.display = val === 'consignment' ? '' : 'none'
}

// ══════════════════════════════════════════════════════════════
//  환자군 카테고리 관리 함수들
// ══════════════════════════════════════════════════════════════

// 전역 카테고리 상태
window._patientCategories = []

async function loadPatientCategories(hospitalId) {
  const [cats, catSettings] = await Promise.all([
    api('GET', `/api/admin/hospitals/${hospitalId}/patient-categories`),
    api('GET', `/api/admin/hospitals/${hospitalId}/category-settings/${App.currentYear}/${App.currentMonth}`)
  ])
  window._patientCategories = cats || []
  window._adminCatList = cats || []
  renderPatientCategoryList(window._patientCategories)
  renderCategoryBudgetList(window._patientCategories, catSettings || [])
}

function renderPatientCategoryList(cats) {
  const el = document.getElementById('patientCategoryList')
  if (!el) return

  if (!cats || cats.length === 0) {
    el.innerHTML = `<div class="text-xs text-gray-400 text-center py-4">
      등록된 카테고리가 없습니다. 위에서 빠른 선택하거나 직접 추가하세요.
    </div>`
    return
  }

  el.innerHTML = cats.map((cat, i) => `
    <div class="flex items-center gap-2 p-2.5 bg-white border border-gray-200 rounded-xl" id="catRow-${cat.id || 'new'+i}">
      <div class="w-6 h-6 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
           style="background:${getCategoryColor(cat.category_key)}">
        ${cat.category_name.charAt(0)}
      </div>
      <input type="text" value="${cat.category_name}" placeholder="카테고리명"
        class="form-input flex-1 text-sm py-1" style="min-width:80px"
        data-cat-id="${cat.id || ''}" data-field="name">
      <input type="text" value="${cat.order_code || ''}" placeholder="발주코드(선택)"
        class="form-input text-sm py-1" style="width:100px"
        data-cat-id="${cat.id || ''}" data-field="code">
      <select data-cat-id="${cat.id || ''}" data-field="key" class="form-input text-sm py-1" style="width:110px">
        ${[
          {k:'general',n:'일반'},{k:'cancer',n:'항암'},{k:'rehab',n:'재활'},
          {k:'nursing',n:'요양'},{k:'traffic',n:'교통사고'},{k:'mental',n:'정신'},
          {k:'pediatric',n:'소아'},{k:'spine',n:'척추'},{k:'joint',n:'관절'},
          {k:'cardiac',n:'심장'},{k:'dialysis',n:'투석'},{k:'stroke',n:'뇌졸중'},
          {k:'elderly',n:'노인전문'},{k:'maternity',n:'산부인과'},{k:'other',n:'기타'}
        ].map(opt => `<option value="${opt.k}" ${cat.category_key===opt.k?'selected':''}>${opt.n}</option>`).join('')}
      </select>
      <button onclick="removePatientCategoryRow(this)" class="text-red-400 hover:text-red-600 text-sm px-1.5 py-1 rounded hover:bg-red-50 flex-shrink-0">
        <i class="fas fa-trash-alt"></i>
      </button>
    </div>
  `).join('')
}

function renderCategoryBudgetList(cats, settings) {
  const el = document.getElementById('categoryBudgetList')
  if (!el) return

  if (!cats || cats.length === 0) {
    el.innerHTML = `<div class="text-xs text-gray-400 text-center py-2">카테고리를 먼저 저장하세요</div>`
    return
  }

  const settingsMap = {}
  ;(settings || []).forEach(s => { settingsMap[s.patient_category_id] = s })

  el.innerHTML = cats.map(cat => {
    const s = settingsMap[cat.id] || {}
    // 식단가 계산 기준 파싱
    let budgetKeys = []
    let mealsKeys = []
    try { budgetKeys = JSON.parse(cat.budget_include_keys || 'null') || [] } catch(e) {}
    try { mealsKeys = JSON.parse(cat.meals_include_keys || 'null') || [] } catch(e) {}

    // 예산 항목 선택지 구성
    const budgetOptions = cats.map(c => ({
      key: c.category_key, label: c.category_name + ' 예산'
    }))
    // 식수 항목 선택지 구성 (비급여식은 식단가 계산에서 항상 제외 → 선택 불가)
    const mealsOptions = [
      { key: 'staff', label: '직원식' },
      { key: 'guardian', label: '보호자식' },
      ...cats.map(c => ({ key: `cat_${c.category_key}`, label: c.category_name + ' 식수' }))
    ]

    return `
    <div class="p-3 bg-white border border-gray-200 rounded-xl">
      <div class="flex items-center gap-2 mb-2">
        <div class="w-5 h-5 rounded flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
             style="background:${getCategoryColor(cat.category_key)}">
          ${cat.category_name.charAt(0)}
        </div>
        <span class="font-semibold text-gray-700 text-sm">${cat.category_name}</span>
        ${cat.order_code ? `<span class="text-xs text-gray-400">(${cat.order_code})</span>` : ''}
      </div>
      <div class="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label class="block text-xs text-gray-500 mb-1">월 목표금액 (원)</label>
          <input type="number" id="catBudget-${cat.id}" value="${s.monthly_budget||0}"
            class="form-input text-sm py-1" placeholder="0"
            oninput="updateWeightedAvgTarget()">
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">카테고리별 목표 식단가 (원/식)</label>
          <input type="number" id="catMealPrice-${cat.id}" value="${s.target_meal_price||0}"
            class="form-input text-sm py-1" placeholder="0"
            oninput="updateWeightedAvgTarget()">
        </div>
      </div>
      <div class="mb-2">
        <label class="block text-xs text-gray-500 mb-1">영업일수 (일)</label>
        <input type="number" id="catWorkDays-${cat.id}" value="${s.working_days||0}"
          class="form-input text-sm py-1" placeholder="0">
      </div>
      <!-- 식단가 계산 기준 (접기/펼치기) -->
      <div class="border-t border-gray-100 pt-2 mt-1">
        <button type="button" onclick="toggleFormulaSection(${cat.id})"
          class="flex items-center justify-between w-full text-xs font-semibold text-blue-600 hover:text-blue-800">
          <span><i class="fas fa-calculator mr-1"></i>식단가 계산 기준 설정</span>
          <i class="fas fa-chevron-down text-gray-400" id="formulaChevron-${cat.id}"></i>
        </button>
        <div id="formulaSection-${cat.id}" class="hidden mt-2 space-y-2">
          <div class="bg-blue-50 rounded-lg p-2 text-xs text-blue-700 mb-2">
            <i class="fas fa-info-circle mr-1"></i>
            <b>계산식:</b> 선택한 예산 합계 ÷ 선택한 식수 합계<br>
            <span class="text-gray-500">체크 없으면 전체 예산/식수 기준</span><br>
            <span class="text-red-500 font-medium"><i class="fas fa-ban mr-1"></i>비급여 식수는 식단가 계산에서 항상 제외됩니다</span>
          </div>
          <!-- 예산 포함 항목 -->
          <div>
            <div class="text-xs font-semibold text-gray-600 mb-1">📊 예산 포함 항목</div>
            <div class="grid grid-cols-2 gap-1">
              ${budgetOptions.map(opt => `
                <label class="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="checkbox" class="budget-include-cb" data-cat="${cat.id}" value="${opt.key}"
                    ${budgetKeys.includes(opt.key) ? 'checked' : ''}>
                  <span>${opt.label}</span>
                </label>`).join('')}
            </div>
          </div>
          <!-- 식수 포함 항목 -->
          <div>
            <div class="text-xs font-semibold text-gray-600 mb-1">🍽 식수 포함 항목</div>
            <div class="grid grid-cols-2 gap-1">
              ${mealsOptions.map(opt => `
                <label class="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="checkbox" class="meals-include-cb" data-cat="${cat.id}" value="${opt.key}"
                    ${mealsKeys.includes(opt.key) ? 'checked' : ''}>
                  <span>${opt.label}</span>
                </label>`).join('')}
            </div>
          </div>
          <!-- 저장 버튼 -->
          <button type="button" onclick="saveCategoryFormula(${cat.id}, ${window._adminHospitalId})"
            class="w-full py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 mt-1">
            <i class="fas fa-save mr-1"></i>계산 기준 저장
          </button>
          <!-- 계산식 미리보기 -->
          <div id="formulaPreview-${cat.id}" class="text-xs text-gray-500 bg-gray-50 rounded p-1.5 mt-1 hidden"></div>
        </div>
      </div>
    </div>`
  }).join('')

  // 가중평균 목표 식단가 표시 영역 추가 (아직 없을 때만)
  if (!document.getElementById('weightedAvgTargetPanel')) {
    const panel = document.createElement('div')
    panel.id = 'weightedAvgTargetPanel'
    panel.className = 'mt-3 p-3 bg-purple-50 border border-purple-200 rounded-xl'
    panel.innerHTML = `<div class="flex items-center justify-between">
      <span class="text-xs font-semibold text-purple-700"><i class="fas fa-balance-scale mr-1"></i>가중평균 목표 식단가 (자동계산)</span>
      <span id="weightedAvgTargetValue" class="text-sm font-bold text-purple-800">-</span>
    </div>
    <div class="text-xs text-gray-400 mt-1">월 목표금액 비중 기준 가중평균 → <span class="text-green-600 font-semibold">예산설정 탭 "목표 식단가"에 자동 반영</span></div>`
    el.parentNode.insertBefore(panel, el.nextSibling)
  }
  // 초기 계산
  updateWeightedAvgTarget()
}

function updateWeightedAvgTarget() {
  const cats = window._adminCatList || []
  if (cats.length === 0) return

  const panel = document.getElementById('weightedAvgTargetPanel')

  // ── 카테고리 1개: 가중평균 패널 숨기고, 해당 카테고리 목표 식단가를 직접 반영 ──
  if (cats.length === 1) {
    if (panel) panel.style.display = 'none'
    const cat = cats[0]
    const singlePrice = parseFloat(document.getElementById(`catMealPrice-${cat.id}`)?.value || 0)
    const mealPriceEl = document.getElementById('hb-mealprice')
    if (mealPriceEl && singlePrice > 0) {
      mealPriceEl.value = Math.round(singlePrice)
      mealPriceEl.style.background = '#f0fdf4'
      mealPriceEl.style.borderColor = '#22c55e'
      clearTimeout(mealPriceEl._resetTimer)
      mealPriceEl._resetTimer = setTimeout(() => {
        mealPriceEl.style.background = ''
        mealPriceEl.style.borderColor = ''
      }, 2000)
    }
    return
  }

  // ── 카테고리 2개 이상: 가중평균 계산 후 반영 ──
  if (panel) panel.style.display = ''
  const totalBudget = cats.reduce((s, cat) => {
    const b = parseFloat(document.getElementById(`catBudget-${cat.id}`)?.value || 0)
    return s + b
  }, 0)
  let weighted = 0
  if (totalBudget > 0) {
    weighted = cats.reduce((s, cat) => {
      const b = parseFloat(document.getElementById(`catBudget-${cat.id}`)?.value || 0)
      const p = parseFloat(document.getElementById(`catMealPrice-${cat.id}`)?.value || 0)
      return s + p * (b / totalBudget)
    }, 0)
  }
  const roundedWeighted = Math.round(weighted)
  const el = document.getElementById('weightedAvgTargetValue')
  if (el) {
    el.textContent = roundedWeighted > 0 ? `${roundedWeighted.toLocaleString()}원/식` : '-'
  }
  // 예산설정 탭의 목표 식단가(hb-mealprice) 자동 적용
  const mealPriceEl = document.getElementById('hb-mealprice')
  if (mealPriceEl && roundedWeighted > 0) {
    mealPriceEl.value = roundedWeighted
    mealPriceEl.style.background = '#f0fdf4'
    mealPriceEl.style.borderColor = '#22c55e'
    clearTimeout(mealPriceEl._resetTimer)
    mealPriceEl._resetTimer = setTimeout(() => {
      mealPriceEl.style.background = ''
      mealPriceEl.style.borderColor = ''
    }, 2000)
  }
}

function addPatientCategoryRow() {
  const list = document.getElementById('patientCategoryList')
  if (!list) return

  // 빈 메시지 제거
  const empty = list.querySelector('.text-gray-400')
  if (empty) empty.remove()

  const idx = Date.now()
  const row = document.createElement('div')
  row.className = 'flex items-center gap-2 p-2.5 bg-white border border-purple-200 rounded-xl'
  row.id = `catRow-new${idx}`
  row.innerHTML = `
    <div class="w-6 h-6 rounded-lg bg-purple-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">+</div>
    <input type="text" placeholder="카테고리명 *" class="form-input flex-1 text-sm py-1" style="min-width:80px" data-cat-id="" data-field="name">
    <input type="text" placeholder="발주코드(선택)" class="form-input text-sm py-1" style="width:100px" data-cat-id="" data-field="code">
    <select data-cat-id="" data-field="key" class="form-input text-sm py-1" style="width:110px">
      ${[
        {k:'general',n:'일반'},{k:'cancer',n:'항암'},{k:'rehab',n:'재활'},
        {k:'nursing',n:'요양'},{k:'traffic',n:'교통사고'},{k:'mental',n:'정신'},
        {k:'pediatric',n:'소아'},{k:'spine',n:'척추'},{k:'joint',n:'관절'},
        {k:'cardiac',n:'심장'},{k:'dialysis',n:'투석'},{k:'stroke',n:'뇌졸중'},
        {k:'elderly',n:'노인전문'},{k:'maternity',n:'산부인과'},{k:'other',n:'기타'}
      ].map(opt => `<option value="${opt.k}">${opt.n}</option>`).join('')}
    </select>
    <button onclick="removePatientCategoryRow(this)" class="text-red-400 hover:text-red-600 text-sm px-1.5 py-1 rounded hover:bg-red-50 flex-shrink-0">
      <i class="fas fa-trash-alt"></i>
    </button>
  `
  list.appendChild(row)
}

function quickAddCategory(key, name) {
  // 이미 있는지 확인
  const existingInputs = document.querySelectorAll('[data-field="name"]')
  for (const inp of existingInputs) {
    if (inp.value.trim() === name) {
      showToast(`'${name}'이(가) 이미 추가되어 있습니다`, 'warning')
      return
    }
  }
  const list = document.getElementById('patientCategoryList')
  if (!list) return

  const empty = list.querySelector('.text-gray-400')
  if (empty) empty.remove()

  const idx = Date.now()
  const row = document.createElement('div')
  row.className = 'flex items-center gap-2 p-2.5 bg-white border border-purple-200 rounded-xl'
  row.id = `catRow-new${idx}`
  row.innerHTML = `
    <div class="w-6 h-6 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
         style="background:${getCategoryColor(key)}">${name.charAt(0)}</div>
    <input type="text" value="${name}" placeholder="카테고리명 *" class="form-input flex-1 text-sm py-1" style="min-width:80px" data-cat-id="" data-field="name">
    <input type="text" placeholder="발주코드(선택)" class="form-input text-sm py-1" style="width:100px" data-cat-id="" data-field="code">
    <select data-cat-id="" data-field="key" class="form-input text-sm py-1" style="width:110px">
      ${[
        {k:'general',n:'일반'},{k:'cancer',n:'항암'},{k:'rehab',n:'재활'},
        {k:'nursing',n:'요양'},{k:'traffic',n:'교통사고'},{k:'mental',n:'정신'},
        {k:'pediatric',n:'소아'},{k:'spine',n:'척추'},{k:'joint',n:'관절'},
        {k:'cardiac',n:'심장'},{k:'dialysis',n:'투석'},{k:'stroke',n:'뇌졸중'},
        {k:'elderly',n:'노인전문'},{k:'maternity',n:'산부인과'},{k:'other',n:'기타'}
      ].map(opt => `<option value="${opt.k}" ${opt.k===key?'selected':''}>${opt.n}</option>`).join('')}
    </select>
    <button onclick="removePatientCategoryRow(this)" class="text-red-400 hover:text-red-600 text-sm px-1.5 py-1 rounded hover:bg-red-50 flex-shrink-0">
      <i class="fas fa-trash-alt"></i>
    </button>
  `
  list.appendChild(row)
  showToast(`'${name}' 카테고리 추가됨 (저장 버튼 클릭 필요)`, 'success')
}

function removePatientCategoryRow(btn) {
  btn.closest('[id^="catRow-"]')?.remove()
}

async function savePatientCategories(hospitalId) {
  const rows = document.querySelectorAll('#patientCategoryList [id^="catRow-"]')
  const categories = []
  for (const row of rows) {
    const name = row.querySelector('[data-field="name"]')?.value?.trim()
    const code = row.querySelector('[data-field="code"]')?.value?.trim() || ''
    const key = row.querySelector('[data-field="key"]')?.value || 'other'
    if (!name) continue
    categories.push({ category_key: key, category_name: name, order_code: code })
  }

  if (categories.length === 0) {
    showToast('최소 1개 이상의 카테고리를 입력하세요', 'warning')
    return
  }

  const res = await api('PUT', `/api/admin/hospitals/${hospitalId}/patient-categories`, { categories })
  if (res?.success) {
    window._patientCategories = res.categories || []
    window._adminCatList = res.categories || []
    showToast(`${categories.length}개 카테고리 저장 완료`, 'success')
    renderPatientCategoryList(window._patientCategories)
    // 저장 후 목표설정 탭 갱신
    const settingsData = await api('GET', `/api/admin/hospitals/${hospitalId}/category-settings/${App.currentYear}/${App.currentMonth}`)
    renderCategoryBudgetList(window._patientCategories, settingsData || [])
  } else {
    showToast('저장 실패', 'error')
  }
}

// ── 식단가 계산 기준 섹션 토글
window.toggleFormulaSection = (catId) => {
  const sec = document.getElementById(`formulaSection-${catId}`)
  const chevron = document.getElementById(`formulaChevron-${catId}`)
  if (!sec) return
  const isHidden = sec.classList.contains('hidden')
  sec.classList.toggle('hidden', !isHidden)
  if (chevron) {
    chevron.className = isHidden
      ? 'fas fa-chevron-up text-gray-400'
      : 'fas fa-chevron-down text-gray-400'
  }
}

// ── 식단가 계산 기준 저장
window.saveCategoryFormula = async (catId, hospitalId) => {
  const hid = hospitalId || window._adminHospitalId
  if (!hid) { showToast('병원 ID를 찾을 수 없습니다', 'error'); return }

  // 체크된 예산 항목 수집
  const budgetChecks = document.querySelectorAll(`.budget-include-cb[data-cat="${catId}"]:checked`)
  const budgetKeys = budgetChecks.length > 0 ? Array.from(budgetChecks).map(cb => cb.value) : null

  // 체크된 식수 항목 수집
  const mealsChecks = document.querySelectorAll(`.meals-include-cb[data-cat="${catId}"]:checked`)
  const mealsKeys = mealsChecks.length > 0 ? Array.from(mealsChecks).map(cb => cb.value) : null

  const res = await api('PUT', `/api/admin/hospitals/${hid}/patient-categories/${catId}/formula`, {
    budget_include_keys: budgetKeys,
    meals_include_keys: mealsKeys
  })

  if (res?.success) {
    showToast('계산 기준 저장 완료', 'success')
    // _adminCatList 업데이트
    const cats = window._adminCatList || []
    const idx = cats.findIndex(c => c.id === catId)
    if (idx >= 0) {
      cats[idx].budget_include_keys = budgetKeys ? JSON.stringify(budgetKeys) : null
      cats[idx].meals_include_keys = mealsKeys ? JSON.stringify(mealsKeys) : null
    }
    // 미리보기 표시
    const preview = document.getElementById(`formulaPreview-${catId}`)
    if (preview) {
      const budgetLabel = budgetKeys ? budgetKeys.join(', ') + ' 예산' : '전체 예산'
      const mealsLabel = mealsKeys ? mealsKeys.join(', ') + ' 식수' : '전체 식수'
      preview.textContent = `계산식: (${budgetLabel}) ÷ (${mealsLabel})`
      preview.classList.remove('hidden')
    }
  } else {
    showToast('저장 실패', 'error')
  }
}

async function saveCategoryBudgets(hospitalId) {
  const cats = window._patientCategories || []
  if (cats.length === 0) {
    showToast('카테고리를 먼저 저장하세요', 'warning')
    return
  }

  const settings = cats.map(cat => ({
    patient_category_id: cat.id,
    monthly_budget: parseInt(document.getElementById(`catBudget-${cat.id}`)?.value || 0) || 0,
    target_meal_price: parseInt(document.getElementById(`catMealPrice-${cat.id}`)?.value || 0) || 0,
    working_days: parseInt(document.getElementById(`catWorkDays-${cat.id}`)?.value || 0) || 0,
    daily_meal_count: 0
  }))

  const res = await api('POST', `/api/admin/hospitals/${hospitalId}/category-settings/${App.currentYear}/${App.currentMonth}`, { settings })
  if (res?.success) showToast('카테고리별 목표 저장 완료', 'success')
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
      <button onclick="showPrintPreview()" class="btn btn-secondary btn-sm">
        <i class="fas fa-search mr-1"></i>인쇄 미리보기
      </button>
      <button onclick="window.print()" class="btn btn-secondary btn-sm">
        <i class="fas fa-print mr-1"></i>인쇄/PDF저장
      </button>
      <button onclick="exportReportPPT('${hospitalName}',${reportYear},${reportMonth})" class="btn btn-primary btn-sm">
        <i class="fas fa-file-powerpoint mr-1"></i>PPT 다운로드
      </button>
    </div>
  </div>

  <!-- ══ 보고서 본문 (인쇄 대상) ══ -->
  <div id="reportBody" class="space-y-6" style="print-color-adjust:exact">

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
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
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
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        ${[
          { label:'환자식(치료식)', val:fmt((ms.total_patient||0)), icon:'fa-procedures', color:'bg-blue-50 text-blue-700' },
          { label:'직원식', val:fmt((ms.total_staff||0)), icon:'fa-user-md', color:'bg-green-50 text-green-700' },
          { label:'비급여식', val:fmt((ms.total_noncovered||0)), icon:'fa-user', color:'bg-purple-50 text-purple-700' },
          { label:'보호자식', val:fmt((ms.total_guardian||0)), icon:'fa-users', color:'bg-orange-50 text-orange-700' }
        ].map(item => `
          <div class="rounded-xl p-4 text-center ${item.color.split(' ')[0]}">
            <i class="fas ${item.icon} text-2xl ${item.color.split(' ')[1]} mb-2"></i>
            <div class="text-xs text-gray-500 mb-1">${item.label}</div>
            <div class="text-xl font-bold ${item.color.split(' ')[1]}">${item.val}식</div>
          </div>`).join('')}
      </div>
      <canvas id="rpt-mealMonthChart" style="max-height:220px"></canvas>
    </div>

    <!-- 슬라이드 6: 식단가 분석 (3종 + 전월비교) -->
    <div class="report-slide bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 class="report-slide-title"><i class="fas fa-coins text-green-600 mr-2"></i>식단가 월별 비교 분석 (3종)</h2>
      <canvas id="rpt-mealPriceChart" style="max-height:220px"></canvas>
      <div class="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
        ${[
          { label:'전체 식단가', val:summaryData?.mealPriceTotal||0, color:'text-blue-700' },
          { label:'직원식 제외', val:summaryData?.mealPriceNoStaff||0, color:'text-purple-700' },
          { label:'소모품 제외', val:summaryData?.mealPriceNoSupply||0, color:'text-orange-700' },
          { label:'목표 식단가', val:s.targetMealPrice||0, color:'text-green-700' }
        ].map(item=>`
        <div class="bg-gray-50 rounded-xl p-3 text-center">
          <div class="text-xs text-gray-500 mb-1">${item.label}</div>
          <div class="text-lg font-bold ${item.color}">${item.val>0?fmtWon(item.val):'집계중'}</div>
        </div>`).join('')}
      </div>
      <!-- 전월 비교 -->
      ${summaryData?.prevMonth?.mealPriceTotal>0?`
      <div class="mt-4 p-3 bg-indigo-50 rounded-xl border border-indigo-100">
        <div class="text-xs font-bold text-indigo-700 mb-2"><i class="fas fa-exchange-alt mr-1"></i>전월(${summaryData.prevMonth.year}년 ${summaryData.prevMonth.month}월) 대비 변동</div>
        <div class="grid grid-cols-3 gap-2 text-xs">
          ${[
            { label:'전체', cur:summaryData.mealPriceTotal, prev:summaryData.prevMonth.mealPriceTotal },
            { label:'직원제외', cur:summaryData.mealPriceNoStaff, prev:summaryData.prevMonth.mealPriceNoStaff },
            { label:'소모품제외', cur:summaryData.mealPriceNoSupply, prev:summaryData.prevMonth.mealPriceNoSupply }
          ].map(item=>{
            const diff=item.cur-item.prev
            const pct=item.prev>0?(diff/item.prev*100).toFixed(1):null
            return `<div class="bg-white rounded-lg p-2 text-center">
              <div class="text-gray-500">${item.label}</div>
              <div class="font-bold ${diff>0?'text-red-600':diff<0?'text-green-600':'text-gray-700'}">${diff>0?'▲':'▼'} ${Math.abs(diff).toLocaleString()}원</div>
              ${pct?`<div class="text-gray-400">${diff>0?'+':''}${pct}%</div>`:''}
            </div>`
          }).join('')}
        </div>
      </div>` : ''}
    </div>

    <!-- 슬라이드 7: 연간 식단가 3종 + 예산 추이 -->
    <div class="report-slide bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 class="report-slide-title"><i class="fas fa-chart-line text-indigo-600 mr-2"></i>${reportYear}년 연간 비교분석 — 식단가 3종 추이</h2>
      <canvas id="rpt-annualMpChart" style="max-height:260px"></canvas>
    </div>

    <!-- 슬라이드 8: 연간 식수 구성 + 업체별 -->
    <div class="report-slide bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 class="report-slide-title"><i class="fas fa-chart-bar text-teal-600 mr-2"></i>${reportYear}년 연간 식수 구성 & 업체별 발주</h2>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <p class="text-xs text-gray-500 mb-2">식수 구성 월별</p>
          <canvas id="rpt-annualMealChart" style="max-height:220px"></canvas>
        </div>
        <div>
          <p class="text-xs text-gray-500 mb-2">업체별 발주 비중</p>
          <canvas id="rpt-annualVendorPie" style="max-height:220px"></canvas>
        </div>
      </div>
    </div>

    <!-- 슬라이드 9: 연간 예산 달성률 + 잔반 -->
    <div class="report-slide bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 class="report-slide-title"><i class="fas fa-chart-area text-green-600 mr-2"></i>${reportYear}년 예산 달성률 & 잔반 추이</h2>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <p class="text-xs text-gray-500 mb-2">월별 예산 달성률(%)</p>
          <canvas id="rpt-annualBudgetPct" style="max-height:220px"></canvas>
        </div>
        <div>
          <p class="text-xs text-gray-500 mb-2">잔반량(kg) & 비용</p>
          <canvas id="rpt-annualWaste" style="max-height:220px"></canvas>
        </div>
      </div>
    </div>

  </div>`

  // ── 차트 렌더링 ──
  // 보고서용 공통 플러그인
  const rptBarLabelPlugin = {
    id: 'rptBarLabels',
    afterDatasetsDraw(chart) {
      if (!chart.config.options?._showBarLabels) return
      const { ctx } = chart
      chart.data.datasets.forEach((ds, di) => {
        if (ds.type && ds.type !== 'bar') return
        if (chart.config.type !== 'bar' && ds.type !== 'bar') return
        const meta = chart.getDatasetMeta(di)
        if (meta.hidden) return
        meta.data.forEach((bar, i) => {
          const val = ds.data[i]
          if (!val || val === 0) return
          ctx.save()
          ctx.font = 'bold 9px sans-serif'
          ctx.fillStyle = '#374151'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'bottom'
          const label = val >= 1e6 ? `${(val/1e6).toFixed(1)}백만` : val >= 1e4 ? `${(val/1e4).toFixed(0)}만` : val.toLocaleString()
          ctx.fillText(label, bar.x, bar.y - 2)
          ctx.restore()
        })
      })
    }
  }
  const rptPctLabelPlugin = {
    id: 'rptPctLabels',
    afterDatasetsDraw(chart) {
      if (!chart.config.options?._showPctLabels) return
      const { ctx } = chart
      chart.data.datasets.forEach((ds, di) => {
        if (ds.type && ds.type !== 'bar') return
        const meta = chart.getDatasetMeta(di)
        if (meta.hidden) return
        meta.data.forEach((bar, i) => {
          const val = ds.data[i]
          if (!val || val === 0) return
          ctx.save()
          ctx.font = 'bold 9px sans-serif'
          ctx.fillStyle = val >= 100 ? '#dc2626' : val >= 90 ? '#d97706' : '#16a34a'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'bottom'
          ctx.fillText(`${val}%`, bar.x, bar.y - 2)
          ctx.restore()
        })
      })
    }
  }
  const rptPointLabelPlugin = {
    id: 'rptPointLabels',
    afterDatasetsDraw(chart) {
      if (!chart.config.options?._showPointLabels) return
      const { ctx } = chart
      chart.data.datasets.forEach((ds, di) => {
        if (ds.type === 'line' || chart.config.type === 'line') {
          const meta = chart.getDatasetMeta(di)
          if (meta.hidden) return
          meta.data.forEach((pt, i) => {
            const val = ds.data[i]
            if (!val || val === 0) return
            ctx.save()
            ctx.font = 'bold 9px sans-serif'
            ctx.fillStyle = ds.borderColor || '#374151'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'bottom'
            const label = val >= 1e4 ? `${(val/1e4).toFixed(0)}만` : val.toLocaleString()
            ctx.fillText(label, pt.x, pt.y - 5)
            ctx.restore()
          })
        }
      })
    }
  }
  const rptDoughnutCenterPlugin = {
    id: 'rptDoughnutCenter',
    beforeDraw(chart) {
      if (chart.config.type !== 'doughnut') return
      if (!chart.config.options?._centerText) return
      const { ctx, chartArea } = chart
      if (!chartArea) return
      const cx = (chartArea.left + chartArea.right) / 2
      const cy = (chartArea.top + chartArea.bottom) / 2
      ctx.save()
      ctx.font = 'bold 13px sans-serif'
      ctx.fillStyle = '#374151'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(chart.config.options._centerText, cx, cy)
      ctx.restore()
    }
  }

  // 업체별 도넛차트 (중앙 총합 + 각 조각 금액 표시)
  const vendorLabels = vendors.map(v=>v.name)
  const vendorData = vendors.map(v=>v.total_used)
  const vendorTotal = vendorData.reduce((s,v)=>s+v,0)
  const rptDoughnutSlicePlugin = {
    id: 'rptDoughnutSlice',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx
      const dataset = chart.data.datasets[0]
      const total = dataset.data.reduce((s,v)=>s+v,0)
      if (!total) return
      chart.getDatasetMeta(0).data.forEach((arc, i) => {
        const val = dataset.data[i]
        if (!val || val/total < 0.04) return
        const { startAngle, endAngle, outerRadius, innerRadius, x, y } = arc
        const midAngle = (startAngle + endAngle) / 2
        const r = (outerRadius + innerRadius) / 2
        const cx = x + Math.cos(midAngle) * r
        const cy = y + Math.sin(midAngle) * r
        ctx.save()
        ctx.font = 'bold 10px sans-serif'
        ctx.fillStyle = 'rgba(255,255,255,0.95)'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(fmtMan(val), cx, cy)
        ctx.restore()
      })
    }
  }
  if (document.getElementById('rpt-vendorChart') && vendorData.some(v=>v>0)) {
    App.charts.rptVendor = new Chart(document.getElementById('rpt-vendorChart'), {
      type: 'doughnut',
      data: {
        labels: vendorLabels,
        datasets: [{ data: vendorData,
          backgroundColor: ['#16a34a','#15803d','#22c55e','#86efac','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899','#64748b'] }]
      },
      options: {
        responsive:true,
        _centerText: fmtMan(vendorTotal),
        plugins:{ legend:{ position:'right', labels:{ font:{size:11} } } }
      },
      plugins: [rptDoughnutCenterPlugin, rptDoughnutSlicePlugin]
    })
  }

  // 일별 바차트 (막대 위 수치)
  App.charts.rptDaily = new Chart(document.getElementById('rpt-dailyChart'), {
    type: 'bar',
    data: {
      labels: dailyLabels,
      datasets: [{ label:'일별 매입금액', data:dailyValues, backgroundColor:'rgba(22,163,74,0.7)', borderRadius:4 }]
    },
    options: { responsive:true,
      _showBarLabels: true,
      plugins:{ legend:{display:false} },
      scales:{ y:{ ticks:{ callback:v=>`${(v/10000).toFixed(0)}만` } } }
    },
    plugins: [rptBarLabelPlugin]
  })

  // 연간 데이터 계산
  const rMonths = Array.from({length:12}, (_,i)=>`${i+1}월`)
  const rUsed = Array(12).fill(0); (annualData?.monthly||[]).forEach(m=>{ rUsed[parseInt(m.month)-1]=m.total_used||0 })
  const rBudget = Array(12).fill(0); (annualData?.settings||[]).forEach(m=>{ rBudget[m.month-1]=m.total_budget||0 })
  const rMeals = Array(12).fill(0), rPatient=Array(12).fill(0), rStaff=Array(12).fill(0), rNoncov=Array(12).fill(0), rGuard=Array(12).fill(0)
  ;(annualData?.mealMonthly||[]).forEach(m=>{ const i=parseInt(m.month)-1; rMeals[i]=m.total_meals||0; rPatient[i]=m.total_patient||0; rStaff[i]=m.total_staff||0; rNoncov[i]=m.total_noncovered||0; rGuard[i]=m.total_guardian||0 })
  const rWasteKg = Array(12).fill(0), rWasteCost = Array(12).fill(0)
  ;(annualData?.wasteAnnual||[]).forEach(m=>{ const i=parseInt(m.month)-1; rWasteKg[i]=parseFloat(m.total_waste||0); rWasteCost[i]=m.total_cost||0 })
  const rSupplyMap = {}; (annualData?.supplyAnnual||[]).forEach(m=>{ rSupplyMap[parseInt(m.month)-1]=m.total_supply||0 })
  const rStaffCost = Array(12).fill(0); (annualData?.staffAnnual||[]).forEach(m=>{ const i=parseInt(m.month)-1; if(m.total_meals>0) rStaffCost[i]=Math.round(rUsed[i]*m.total_staff/m.total_meals) })
  const rMpTotal=Array(12).fill(0), rMpNoStaff=Array(12).fill(0), rMpNoSupply=Array(12).fill(0), rTargetMp=Array(12).fill(0)
  ;(annualData?.settings||[]).forEach(m=>{ rTargetMp[m.month-1]=m.meal_price||0 })
  for(let i=0;i<12;i++){
    if(rMeals[i]>0&&rUsed[i]>0){
      rMpTotal[i]=Math.round(rUsed[i]/rMeals[i])
      rMpNoStaff[i]=(rMeals[i]-rStaff[i])>0?Math.round((rUsed[i]-rStaffCost[i])/(rMeals[i]-rStaff[i])):0
      rMpNoSupply[i]=Math.round((rUsed[i]-(rSupplyMap[i]||0))/rMeals[i])
    }
  }
  const rPrevYearMp = Array(12).fill(0)
  const rPrevMeals = Array(12).fill(0), rPrevOrders = Array(12).fill(0)
  ;(annualData?.prevYearMeals||[]).forEach(m=>{ rPrevMeals[parseInt(m.month)-1]=m.total_meals||0 })
  ;(annualData?.prevYearOrders||[]).forEach(m=>{ rPrevOrders[parseInt(m.month)-1]=m.total_used||0 })
  for(let i=0;i<12;i++){ if(rPrevMeals[i]>0&&rPrevOrders[i]>0) rPrevYearMp[i]=Math.round(rPrevOrders[i]/rPrevMeals[i]) }

  const rVendorTotals = {}
  ;(annualData?.vendorAnnual||[]).forEach(v=>{
    if(!rVendorTotals[v.name]) rVendorTotals[v.name]={name:v.name,total:0}
    rVendorTotals[v.name].total += v.total_used||0
  })
  const rVendors = Object.values(rVendorTotals).sort((a,b)=>b.total-a.total)

  // 월별 식수 차트 (구성 스택)
  App.charts.rptMealMonth = new Chart(document.getElementById('rpt-mealMonthChart'), {
    type: 'bar', data:{
      labels: rMonths,
      datasets:[
        { label:'치료식', data:rPatient, backgroundColor:'rgba(37,99,235,0.75)', borderRadius:3 },
        { label:'직원식', data:rStaff,   backgroundColor:'rgba(22,163,74,0.7)',  borderRadius:3 },
        { label:'비급여', data:rNoncov,  backgroundColor:'rgba(147,51,234,0.65)',borderRadius:3 },
        { label:'보호자', data:rGuard,   backgroundColor:'rgba(249,115,22,0.65)',borderRadius:3 }
      ]
    },
    options:{ responsive:true, plugins:{legend:{labels:{font:{size:10},boxWidth:10}}},
      scales:{ x:{stacked:true}, y:{stacked:true, ticks:{callback:v=>`${v}식`}} } }
  })

  // 식단가 3종 차트 (꼭짓점 수치)
  App.charts.rptMealPrice = new Chart(document.getElementById('rpt-mealPriceChart'), {
    type: 'line', data:{
      labels: rMonths,
      datasets:[
        { label:'전체 식단가', data:rMpTotal, borderColor:'#2563eb', backgroundColor:'rgba(37,99,235,0.08)', fill:true, tension:0.4, pointRadius:4 },
        { label:'직원식 제외', data:rMpNoStaff, borderColor:'#9333ea', borderWidth:2, pointRadius:3, fill:false, tension:0.3 },
        { label:'소모품 제외', data:rMpNoSupply, borderColor:'#f59e0b', borderWidth:2, pointRadius:3, fill:false, tension:0.3, borderDash:[4,3] },
        { label:'목표식단가',  data:rTargetMp, borderColor:'#ef4444', borderWidth:1.5, pointRadius:0, fill:false, borderDash:[6,4] }
      ]
    },
    options:{ responsive:true, _showPointLabels: true, plugins:{legend:{labels:{font:{size:10},boxWidth:10}}},
      scales:{ y:{ ticks:{callback:v=>`${(v/1000).toFixed(1)}천원`} } } },
    plugins: [rptPointLabelPlugin]
  })

  // 슬라이드 7: 연간 식단가 3종 추이 (꼭짓점 수치)
  new Chart(document.getElementById('rpt-annualMpChart'), {
    type:'line', data:{
      labels:rMonths,
      datasets:[
        { label:'전체식단가', data:rMpTotal, borderColor:'#2563eb', borderWidth:2, pointRadius:4, fill:false, tension:0.3 },
        { label:'직원제외',   data:rMpNoStaff, borderColor:'#9333ea', borderWidth:2, pointRadius:3, fill:false, tension:0.3 },
        { label:'소모품제외', data:rMpNoSupply, borderColor:'#f59e0b', borderWidth:2, pointRadius:3, fill:false, tension:0.3, borderDash:[4,3] },
        { label:`전년도 식단가`, data:rPrevYearMp, borderColor:'#94a3b8', borderWidth:1.5, pointRadius:2, fill:false, tension:0.3, borderDash:[6,3] },
        { label:'목표식단가', data:rTargetMp, borderColor:'#ef4444', borderWidth:1.5, pointRadius:0, fill:false, borderDash:[8,4] }
      ]
    },
    options:{ responsive:true, _showPointLabels: true, plugins:{legend:{labels:{font:{size:11},boxWidth:10}}},
      scales:{ y:{ ticks:{callback:v=>`${(v/1000).toFixed(1)}천원`} } } },
    plugins: [rptPointLabelPlugin]
  })

  // 슬라이드 8: 식수구성
  new Chart(document.getElementById('rpt-annualMealChart'), {
    type:'bar', data:{
      labels:rMonths,
      datasets:[
        { label:'치료식', data:rPatient, backgroundColor:'rgba(37,99,235,0.75)', borderRadius:3 },
        { label:'직원식', data:rStaff,   backgroundColor:'rgba(22,163,74,0.7)',  borderRadius:3 },
        { label:'비급여', data:rNoncov,  backgroundColor:'rgba(147,51,234,0.65)',borderRadius:3 },
        { label:'보호자', data:rGuard,   backgroundColor:'rgba(249,115,22,0.65)',borderRadius:3 }
      ]
    },
    options:{ responsive:true, plugins:{legend:{labels:{font:{size:10},boxWidth:8}}},
      scales:{ x:{stacked:true}, y:{stacked:true, ticks:{callback:v=>`${v}식`}} } }
  })

  // 업체별 연간 파이 (중앙 총합 + 조각 금액)
  const rVendorTotal = rVendors.reduce((s,v)=>s+v.total,0)
  const rDoughnutSlicePlugin = {
    id: 'rDoughnutSlice',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx
      const dataset = chart.data.datasets[0]
      const total = dataset.data.reduce((s,v)=>s+v,0)
      if (!total) return
      chart.getDatasetMeta(0).data.forEach((arc, i) => {
        const val = dataset.data[i]
        if (!val || val/total < 0.04) return
        const { startAngle, endAngle, outerRadius, innerRadius, x, y } = arc
        const midAngle = (startAngle + endAngle) / 2
        const r = (outerRadius + innerRadius) / 2
        const cx = x + Math.cos(midAngle) * r
        const cy = y + Math.sin(midAngle) * r
        ctx.save()
        ctx.font = 'bold 10px sans-serif'
        ctx.fillStyle = 'rgba(255,255,255,0.95)'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(fmtMan(val), cx, cy)
        ctx.restore()
      })
    }
  }
  new Chart(document.getElementById('rpt-annualVendorPie'), {
    type:'doughnut', data:{
      labels:rVendors.map(v=>v.name),
      datasets:[{ data:rVendors.map(v=>v.total),
        backgroundColor:['#16a34a','#2563eb','#9333ea','#f59e0b','#ef4444','#06b6d4','#ec4899','#84cc16','#f97316','#6366f1','#14b8a6'].map(c=>c+'cc'), borderWidth:1 }]
    },
    options:{
      responsive:true,
      _centerText: fmtMan(rVendorTotal),
      plugins:{legend:{position:'right', labels:{font:{size:10},boxWidth:8}}}
    },
    plugins: [rptDoughnutCenterPlugin, rDoughnutSlicePlugin]
  })

  // 예산 달성률 (막대 위 % 수치)
  const rPct = rBudget.map((b,i)=>b>0?parseFloat((rUsed[i]/b*100).toFixed(1)):null)
  new Chart(document.getElementById('rpt-annualBudgetPct'), {
    type:'bar', data:{
      labels:rMonths,
      datasets:[
        { label:'달성률(%)', data:rPct, backgroundColor:rPct.map(p=>p===null?'#e5e7eb':p>=100?'rgba(239,68,68,0.75)':p>=90?'rgba(245,158,11,0.75)':'rgba(22,163,74,0.75)'), borderRadius:4 },
        { label:'100%기준', data:Array(12).fill(100), type:'line', borderColor:'#ef4444', borderDash:[5,5], borderWidth:1.5, pointRadius:0, fill:false }
      ]
    },
    options:{ responsive:true, _showPctLabels: true, plugins:{legend:{labels:{font:{size:10},boxWidth:8}}},
      scales:{ y:{ ticks:{callback:v=>`${v}%`}, suggestedMax:130 } } },
    plugins: [rptPctLabelPlugin]
  })

  // 잔반 추이 (꼭짓점 수치)
  new Chart(document.getElementById('rpt-annualWaste'), {
    type:'bar', data:{
      labels:rMonths,
      datasets:[
        { label:'잔반(kg)', data:rWasteKg, backgroundColor:'rgba(245,158,11,0.7)', borderRadius:4, yAxisID:'y' },
        { label:'비용',     data:rWasteCost, type:'line', borderColor:'#f97316', borderWidth:2, pointRadius:3, fill:false, yAxisID:'y1' }
      ]
    },
    options:{ responsive:true, _showBarLabels: true, plugins:{legend:{labels:{font:{size:10},boxWidth:8}}},
      scales:{
        y:{ ticks:{callback:v=>`${v}kg`}, position:'left' },
        y1:{ ticks:{callback:v=>`${(v/1e4).toFixed(0)}만`}, position:'right', grid:{drawOnChartArea:false} }
      } },
    plugins: [rptBarLabelPlugin]
  })
}

// 캔버스를 고화질 PNG DataURL로 변환 (devicePixelRatio 4배 적용)
function canvasToHiResPng(canvas) {
  if (!canvas) return null
  try {
    // 4배 해상도로 offscreen canvas 생성
    const scale = 4
    const off = document.createElement('canvas')
    off.width = canvas.offsetWidth * scale || canvas.width * scale
    off.height = canvas.offsetHeight * scale || canvas.height * scale
    const ctx2 = off.getContext('2d')
    ctx2.imageSmoothingEnabled = true
    ctx2.imageSmoothingQuality = 'high'
    // 흰 배경 채우기 (투명 배경 방지)
    ctx2.fillStyle = '#ffffff'
    ctx2.fillRect(0, 0, off.width, off.height)
    ctx2.scale(scale, scale)
    ctx2.drawImage(canvas, 0, 0, canvas.offsetWidth || canvas.width, canvas.offsetHeight || canvas.height)
    return off.toDataURL('image/png', 1.0)
  } catch(e) {
    return canvas.toDataURL('image/png', 1.0)
  }
}

// PPT 슬라이드에 그래프 + 내용 요약 칸 추가 헬퍼
function addChartSlideWithSummary(pptx, title, titleColor, canvasData, summaryLabel) {
  const slide = pptx.addSlide()
  // 상단 헤더 배경
  slide.addShape(pptx.ShapeType.rect, { x:0, y:0, w:'100%', h:0.7, fill:{ color: titleColor || '166534' } })
  slide.addText(title, { x:0.4, y:0.1, w:12.2, h:0.5, fontSize:20, bold:true, color:'FFFFFF' })
  // 그래프 이미지 (고화질)
  if (canvasData) {
    slide.addImage({ data: canvasData, x:0.4, y:0.85, w:12.2, h:4.0 })
  } else {
    slide.addShape(pptx.ShapeType.rect, { x:0.4, y:0.85, w:12.2, h:4.0, fill:{ color:'F3F4F6' }, line:{ color:'D1D5DB', width:1 } })
    slide.addText('차트 데이터 없음', { x:0.4, y:2.5, w:12.2, h:0.5, fontSize:14, color:'9CA3AF', align:'center' })
  }
  // 내용 요약 칸
  const summaryY = 5.0
  slide.addShape(pptx.ShapeType.rect, { x:0.4, y:summaryY, w:12.2, h:1.8, fill:{ color:'F9FAFB' }, line:{ color:'D1D5DB', width:1 } })
  slide.addText(summaryLabel || '내용 요약', { x:0.5, y:summaryY+0.05, w:3, h:0.3, fontSize:10, bold:true, color:'374151' })
  slide.addText('', { x:0.5, y:summaryY+0.35, w:12.0, h:1.35, fontSize:11, color:'6B7280',
    placeholder: true, isTextBox: true })
  return slide
}

// ── 인쇄 미리보기 모달 ─────────────────────────────────────────
window.showPrintPreview = function() {
  // 기존 미리보기 모달 제거
  const existing = document.getElementById('printPreviewModal')
  if (existing) existing.remove()

  const reportBody = document.getElementById('reportBody')
  if (!reportBody) { showToast('보고서를 먼저 불러오세요', 'warning'); return }

  // 슬라이드 목록 수집
  const slides = reportBody.querySelectorAll('.report-slide')
  const totalPages = slides.length

  const modal = document.createElement('div')
  modal.id = 'printPreviewModal'
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;'
  modal.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:#1f2937;color:white;flex-shrink:0;">
      <div style="display:flex;align-items:center;gap:12px;">
        <i class="fas fa-print" style="color:#60a5fa"></i>
        <span style="font-weight:700;font-size:15px">인쇄 미리보기</span>
        <span id="ppPageInfo" style="font-size:12px;color:#9ca3af">페이지 1 / ${totalPages}</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button onclick="document.getElementById('printPreviewModal').remove()" 
          style="background:#374151;color:white;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px;">
          <i class="fas fa-times mr-1"></i>닫기
        </button>
        <button onclick="window.print()" 
          style="background:#3b82f6;color:white;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:700;">
          <i class="fas fa-print mr-1"></i>인쇄/PDF저장
        </button>
      </div>
    </div>
    <!-- 페이지 네비게이션 -->
    <div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:8px;background:#111827;flex-shrink:0;">
      <button id="ppPrevBtn" onclick="changePrintPage(-1)" 
        style="background:#374151;color:white;border:none;padding:5px 14px;border-radius:5px;cursor:pointer;font-size:12px;">
        <i class="fas fa-chevron-left mr-1"></i>이전
      </button>
      <div id="ppPageDots" style="display:flex;gap:4px;flex-wrap:wrap;justify-content:center;max-width:600px;">
        ${Array.from(slides).map((_,i) => 
          `<button onclick="jumpPrintPage(${i})" id="ppDot-${i}" 
            style="width:28px;height:28px;border-radius:5px;border:none;cursor:pointer;font-size:10px;font-weight:700;
            background:${i===0?'#3b82f6':'#374151'};color:white;transition:all 0.2s;">${i+1}</button>`
        ).join('')}
      </div>
      <button id="ppNextBtn" onclick="changePrintPage(1)" 
        style="background:#374151;color:white;border:none;padding:5px 14px;border-radius:5px;cursor:pointer;font-size:12px;">
        다음<i class="fas fa-chevron-right ml-1"></i>
      </button>
    </div>
    <!-- 슬라이드 미리보기 영역 -->
    <div style="flex:1;overflow:auto;display:flex;justify-content:center;align-items:flex-start;padding:20px;background:#374151;">
      <div id="ppSlideContainer" style="background:white;box-shadow:0 8px 32px rgba(0,0,0,0.5);border-radius:8px;overflow:hidden;width:100%;max-width:960px;min-height:400px;">
      </div>
    </div>
    <!-- 안내 문구 -->
    <div style="padding:8px;text-align:center;color:#9ca3af;font-size:11px;background:#111827;flex-shrink:0;">
      <i class="fas fa-info-circle mr-1"></i>
      인쇄/PDF 저장 시 모든 ${totalPages}페이지가 자동으로 출력됩니다. Chrome에서 최적 출력됩니다.
    </div>
  `
  document.body.appendChild(modal)

  // 현재 페이지 전역 변수
  window._ppCurrentPage = 0
  window._ppSlides = Array.from(slides)
  window._ppTotal = totalPages
  renderPrintPreviewPage(0)
}

window._ppCurrentPage = 0
window._ppSlides = []
window._ppTotal = 0

function renderPrintPreviewPage(idx) {
  const container = document.getElementById('ppSlideContainer')
  const pageInfo = document.getElementById('ppPageInfo')
  if (!container || !window._ppSlides[idx]) return

  // 슬라이드 복제
  const clone = window._ppSlides[idx].cloneNode(true)
  clone.style.cssText = 'margin:0!important;border-radius:0!important;box-shadow:none!important;padding:24px!important;display:block!important;'
  container.innerHTML = ''
  container.appendChild(clone)

  // 페이지 정보 업데이트
  if (pageInfo) pageInfo.textContent = `페이지 ${idx+1} / ${window._ppTotal}`

  // 점(dot) 버튼 상태 업데이트
  window._ppSlides.forEach((_,i) => {
    const dot = document.getElementById(`ppDot-${i}`)
    if (dot) dot.style.background = i===idx ? '#3b82f6' : '#374151'
  })

  // 이전/다음 버튼 활성화
  const prev = document.getElementById('ppPrevBtn')
  const next = document.getElementById('ppNextBtn')
  if (prev) prev.style.opacity = idx===0 ? '0.4' : '1'
  if (next) next.style.opacity = idx===window._ppTotal-1 ? '0.4' : '1'
}

window.changePrintPage = function(dir) {
  const newIdx = window._ppCurrentPage + dir
  if (newIdx < 0 || newIdx >= window._ppTotal) return
  window._ppCurrentPage = newIdx
  renderPrintPreviewPage(newIdx)
}

window.jumpPrintPage = function(idx) {
  window._ppCurrentPage = idx
  renderPrintPreviewPage(idx)
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

  // 고화질 캔버스 데이터 미리 추출
  const chartIds = ['rpt-vendorChart','rpt-dailyChart','rpt-mealMonthChart','rpt-mealPriceChart','rpt-annualMpChart','rpt-annualMealChart','rpt-annualVendorPie','rpt-annualBudgetPct','rpt-annualWaste']
  const chartData = {}
  chartIds.forEach(id => {
    const el = document.getElementById(id)
    chartData[id] = el ? canvasToHiResPng(el) : null
  })

  // 슬라이드 1: 표지
  const s1 = pptx.addSlide()
  s1.background = { color: '166534' }
  s1.addShape(pptx.ShapeType.rect, { x:2, y:1.2, w:9, h:5, fill:{ color:'14532D', transparency:60 }, line:{ color:'FFFFFF', width:1 } })
  s1.addText(`${hospitalName}`, { x:1, y:1.5, w:11, h:1, fontSize:36, bold:true, color:'FFFFFF', align:'center' })
  s1.addText('급식 운영 월간 보고서', { x:1, y:2.7, w:11, h:0.7, fontSize:22, color:'CCFFCC', align:'center' })
  s1.addText(`${year}년 ${month}월`, { x:1, y:3.6, w:11, h:0.8, fontSize:28, bold:true, color:'FFFFFF', align:'center' })
  s1.addText(`작성일: ${new Date().toLocaleDateString('ko-KR')}`, { x:1, y:5.2, w:11, h:0.4, fontSize:13, color:'AAFFAA', align:'center' })

  // 슬라이드 2: 예산 요약 + 내용 요약칸
  addChartSlideWithSummary(pptx, `${year}년 ${month}월 예산 요약 — 업체별 발주금액`, '166534', chartData['rpt-vendorChart'], '📊 예산 요약')

  // 슬라이드 3: 일별 매입금액 + 내용 요약칸
  addChartSlideWithSummary(pptx, `${year}년 ${month}월 일별 매입금액`, '166534', chartData['rpt-dailyChart'], '📅 일별 매입 요약')

  // 슬라이드 4: 식수 현황 + 내용 요약칸
  addChartSlideWithSummary(pptx, `${year}년 ${month}월 식수 현황 월별 추이`, '0F766E', chartData['rpt-mealMonthChart'], '🍽️ 식수 현황 요약')

  // 슬라이드 5: 식단가 분석 + 내용 요약칸
  addChartSlideWithSummary(pptx, `${year}년 ${month}월 식단가 월별 비교`, '1D4ED8', chartData['rpt-mealPriceChart'], '💰 식단가 분석 요약')

  // 슬라이드 6: 연간 식단가 3종 추이 + 내용 요약칸
  addChartSlideWithSummary(pptx, `${year}년 연간 식단가 3종 추이`, '1D4ED8', chartData['rpt-annualMpChart'], '📈 연간 식단가 추이 요약')

  // 슬라이드 7: 연간 식수 구성 + 업체별 파이 (나란히) + 내용 요약칸
  const s7 = pptx.addSlide()
  s7.addShape(pptx.ShapeType.rect, { x:0, y:0, w:'100%', h:0.7, fill:{ color:'0F766E' } })
  s7.addText(`${year}년 연간 식수 구성 & 업체별 발주 비중`, { x:0.4, y:0.1, w:12.2, h:0.5, fontSize:20, bold:true, color:'FFFFFF' })
  if (chartData['rpt-annualMealChart']) s7.addImage({ data: chartData['rpt-annualMealChart'], x:0.4, y:0.85, w:6.0, h:4.0 })
  if (chartData['rpt-annualVendorPie']) s7.addImage({ data: chartData['rpt-annualVendorPie'], x:6.6, y:0.85, w:6.0, h:4.0 })
  s7.addShape(pptx.ShapeType.rect, { x:0.4, y:5.0, w:12.2, h:1.8, fill:{ color:'F9FAFB' }, line:{ color:'D1D5DB', width:1 } })
  s7.addText('🥘 식수구성 & 업체 비중 요약', { x:0.5, y:5.05, w:6, h:0.3, fontSize:10, bold:true, color:'374151' })

  // 슬라이드 8: 예산 달성률 + 잔반 추이 (나란히) + 내용 요약칸
  const s8 = pptx.addSlide()
  s8.addShape(pptx.ShapeType.rect, { x:0, y:0, w:'100%', h:0.7, fill:{ color:'15803D' } })
  s8.addText(`${year}년 예산 달성률 & 잔반 추이`, { x:0.4, y:0.1, w:12.2, h:0.5, fontSize:20, bold:true, color:'FFFFFF' })
  if (chartData['rpt-annualBudgetPct']) s8.addImage({ data: chartData['rpt-annualBudgetPct'], x:0.4, y:0.85, w:6.0, h:4.0 })
  if (chartData['rpt-annualWaste']) s8.addImage({ data: chartData['rpt-annualWaste'], x:6.6, y:0.85, w:6.0, h:4.0 })
  s8.addShape(pptx.ShapeType.rect, { x:0.4, y:5.0, w:12.2, h:1.8, fill:{ color:'F9FAFB' }, line:{ color:'D1D5DB', width:1 } })
  s8.addText('📉 예산달성률 & 잔반 요약', { x:0.5, y:5.05, w:6, h:0.3, fontSize:10, bold:true, color:'374151' })

  pptx.writeFile({ fileName: `${hospitalName}_${year}년${month}월_보고서.pptx` })
  showToast('PPT 다운로드 완료! (고화질)', 'success')
}
