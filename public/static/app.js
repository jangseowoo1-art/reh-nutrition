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
  charts: {},
  lockedMonths: []  // 마감 승인된 읽기전용 월 목록 ["2026-02", ...]
}

// ── 읽기전용 헬퍼 ────────────────────────────────────────────
// 관리자는 항상 편집 가능, 영양사는 마감 승인된 달은 읽기전용
function isReadOnly(year, month) {
  if (App.role === 'admin') return false
  const key = `${year}-${String(month).padStart(2,'0')}`
  return App.lockedMonths.includes(key)
}

// 읽기전용 배너 HTML (페이지 상단에 표시)
function readOnlyBanner() {
  return `<div class="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-4 text-sm text-amber-800">
    <i class="fas fa-lock text-amber-500"></i>
    <span><strong>마감 완료된 달</strong>입니다. 데이터를 수정할 수 없습니다. (조회만 가능)</span>
  </div>`
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
  // 운영진(executive) 역할이면 전용 대시보드로 리다이렉트
  if (App.role === 'executive') { window.location.href = '/executive'; return }

  // 병원 계정이면 DB의 활성 월(current_year/month)로 App 상태 동기화
  if (App.role !== 'admin') {
    try {
      const am = await api('GET', '/api/settings/active-month')
      if (am?.year) {
        App.currentYear = am.year
        App.currentMonth = am.month
      }
      // 마감 승인된 월 목록 저장 (읽기전용 처리용)
      if (am?.lockedMonths) App.lockedMonths = am.lockedMonths
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
    { id: 'ingredient-prices', icon: 'fa-leaf', label: '식재료 단가 분석', section: '분석' },
    { id: 'analysis', icon: 'fa-chart-bar', label: '비교 분석', section: null },
    { id: 'settings', icon: 'fa-flag-checkered', label: '마감 요청', section: '관리' },
    { id: 'expense-doc', icon: 'fa-file-invoice-dollar', label: '지출결의서', section: null }
  ]
}

function getAdminMenus() {
  return [
    { id: 'admin', icon: 'fa-th-large', label: '전체 현황', section: '관리자' },
    { id: 'hospital-manage', icon: 'fa-hospital', label: '병원 관리', section: null },
    { id: 'holiday-manage', icon: 'fa-calendar-times', label: '공휴일 관리', section: null },
    { id: 'analysis', icon: 'fa-chart-bar', label: '비교 분석', section: '분석' },
    { id: 'report', icon: 'fa-file-pdf', label: '보고서 출력', section: null },
    { id: 'ceo-dashboard', icon: 'fa-crown', label: '경영 대시보드', section: '경영' },
    { id: 'transaction-analysis', icon: 'fa-file-invoice', label: '거래명세서 분석', section: '데이터 분석' }
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
    report: { title: '보고서 출력', sub: 'PPT/PDF 월별 리포트' },
    'expense-doc': { title: '지출결의서', sub: '법인카드 사용 내역 결의서' },
    'ceo-dashboard': { title: '경영 대시보드', sub: 'CEO · 경영진 운영 현황 분석' },
    'transaction-analysis': { title: '거래명세서 분석', sub: '업체별 납품 명세서 업로드 · 파싱 · 비용 분석' }
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
    report: renderReport,
    'expense-doc': renderExpenseDoc,
    'ingredient-prices': renderIngredientPricesPage,  // #8 독립 메뉴
    'ceo-dashboard': renderCeoDashboard,
    'transaction-analysis': renderTransactionAnalysis
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
function fmtMan(n) {
  const v = Math.round(n || 0)
  if (v >= 100000000) return `${(v/100000000).toFixed(1)}억`
  if (v >= 10000000) return `${Math.round(v/10000).toLocaleString('ko-KR')}만`  // 1000만 이상: X,XXX만
  if (v >= 1000000) return `${(v/10000).toFixed(1)}만`   // 100만 이상: XX.X만
  if (v >= 10000) return `${(v/10000).toFixed(1)}만`     // 1만 이상: X.X만
  return `${v.toLocaleString('ko-KR')}`
}
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
  return { mixed:'과세+면세', taxable:'과세', exempt:'면세', mixed_total:'과+면(합산)' }[t] || t
}

// 환자군 카테고리 색상 (hex) - 소프트 톤으로 조정
function getCategoryColorHex(key) {
  const colors = {
    general: '#6b7280',
    cancer:  '#e05252',  // 진한 빨강 → 부드러운 로즈레드
    rehab:   '#3b82f6',  // 파랑 유지
    nursing: '#22c55e',  // 진한 초록 → 부드러운 그린
    traffic: '#f59e0b',  // 주황 유지
    mental:  '#8b5cf6',  // 보라 유지
    pediatric: '#ec4899',
    spine:   '#0ea5e9',
    joint:   '#10b981',
    cardiac: '#f43f5e',
    dialysis:'#0284c7',
    stroke:  '#a855f7',
    elderly: '#84cc16',
    maternity:'#f472b6',
    other:   '#6b7280'
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

  // ── 관리자: 병원 선택 처리 ──────────────────────────────────────
  if (App.role === 'admin') {
    // 아직 선택된 병원이 없으면 첫 번째 병원 자동 선택
    if (!App.adminHospitalId) {
      const hList = await api('GET', '/api/admin/hospitals')
      const hospitals = Array.isArray(hList) ? hList : (hList?.hospitals || hList?.data || [])
      if (hospitals.length === 0) {
        content.innerHTML = '<div class="text-gray-400 p-6 text-center"><i class="fas fa-hospital text-4xl mb-3 block"></i>등록된 병원이 없습니다.</div>'
        return
      }
      App.adminHospitalId = hospitals[0].id
      App._adminHospitals = hospitals
    }
  }

  const hqParam = App.role === 'admin' ? `?hospitalId=${App.adminHospitalId}` : ''

  const [data, catData, dashCardData] = await Promise.all([
    api('GET', `/api/dashboard/summary/${App.currentYear}/${App.currentMonth}${hqParam}`),
    api('GET', `/api/orders/category-monthly/${App.currentYear}/${App.currentMonth}${hqParam}`),
    api('GET', `/api/card-expenses/monthly/${App.currentYear}/${App.currentMonth}${hqParam}`)
  ])
  if (!data || data.error) {
    content.innerHTML = `<div class="text-red-500 p-6">데이터 로드 실패: ${data?.error || '알 수 없는 오류'}</div>`
    return
  }

  // 법인카드 집계 (monthly API: vendorTotals.total, expenses 사용)
  const dashCardExpenses = dashCardData?.expenses || []
  const _dashVendorTotals = (dashCardData?.vendorTotals || [])
    .filter(r => (r.total || 0) > 0)
    .map(r => ({
      vendor_id: Number(r.vendor_id),
      total: Number(r.total) || 0,
      count: dashCardExpenses.filter(e => Number(e.vendor_id) === Number(r.vendor_id)).length
    }))
  const dashCardMonthTotal = _dashVendorTotals.reduce((s, r) => s + r.total, 0)
  const _subtypeMap = {food:'식재료',supplies:'소모품',online:'온라인',other:'기타'}
  const dashCardBySubtype = {}
  // subtype 초기화 (is_card_type 업체 기준)
  ;(dashCardData?.cardVendors || []).filter(v => v.is_card_type).forEach(v => {
    const k = v.card_subtype || 'other'
    if (!dashCardBySubtype[k]) dashCardBySubtype[k] = { label: _subtypeMap[k]||'기타', total: 0, count: 0 }
  })
  // 실적 누적
  _dashVendorTotals.forEach(r => {
    const vn = (dashCardData?.cardVendors || []).find(v => Number(v.id) === r.vendor_id)
    const k = vn?.card_subtype || 'other'
    if (!dashCardBySubtype[k]) dashCardBySubtype[k] = { label: _subtypeMap[k]||'기타', total: 0, count: 0 }
    dashCardBySubtype[k].total += r.total
    dashCardBySubtype[k].count += r.count
  })
  // total > 0인 subtype만 필터링
  const _dashCardBySubtypeFiltered = Object.values(dashCardBySubtype).filter(st => st.total > 0)

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
  // ── 2.2 월말 예상 식단가 / 2.3 예산 소진 예상일 / 2.4 적정성 / 2.5 이상탐지 ──
  const proj = data.projection || {}
  const budgetDepl = data.budgetDepletion || {}
  const orderAppr = data.orderAppropriateness || {}
  const anomalies = data.anomalies || []
  const autoAnalysis = data.autoAnalysis || []
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

  // 검수 미완료 데이터 비동기 로드
  let inspectionSummary = null
  try {
    const inspResult = await api('GET', `/api/orders/inspection/pending/${App.currentYear}/${App.currentMonth}`)
    inspectionSummary = inspResult?.summary || null
  } catch(e) {}

  // ── 관리자: 병원 선택 드롭다운 HTML ──────────────────────────────
  const adminHospitalBar = App.role === 'admin' && App._adminHospitals?.length > 0 ? `
  <div class="mb-4 bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center gap-3">
    <i class="fas fa-hospital text-blue-500"></i>
    <span class="text-sm font-medium text-blue-700">병원 선택:</span>
    <select onchange="App.adminHospitalId=+this.value; renderDashboard()"
      class="text-sm border border-blue-200 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-blue-300 focus:outline-none">
      ${App._adminHospitals.map(h => `<option value="${h.id}" ${h.id==App.adminHospitalId?'selected':''}>${h.name}</option>`).join('')}
    </select>
  </div>` : ''

  content.innerHTML = `
  ${adminHospitalBar}
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

  <!-- 검수 미완료 알림 배너 -->
  ${inspectionSummary && inspectionSummary.pendingCount > 0 ? `
  <div class="mb-4 bg-orange-50 border border-orange-300 rounded-xl p-3">
    <div class="flex items-center justify-between gap-2 flex-wrap">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center flex-shrink-0">
          <i class="fas fa-clipboard-check text-orange-500 text-sm"></i>
        </div>
        <div>
          <div class="font-bold text-orange-700 text-sm">
            <i class="fas fa-exclamation-circle mr-1"></i>검수 미완료 ${inspectionSummary.pendingCount}건
          </div>
          <div class="text-xs text-orange-600">
            미검수 금액: ${fmtMan(inspectionSummary.pendingAmount)}원 · 전체 ${inspectionSummary.total}건 중 ${inspectionSummary.completedCount}건 완료
          </div>
        </div>
      </div>
      <button onclick="openInspectionModal()" class="text-xs font-semibold px-3 py-1.5 rounded-lg text-white flex-shrink-0" style="background:#ea580c">
        <i class="fas fa-clipboard-check mr-1"></i>검수 현황 보기
      </button>
    </div>
    <!-- 검수 현황 미니 테이블 (날짜별) -->
    <div id="inspStatusTable" class="mt-2">
      <div class="overflow-x-auto">
        <table style="width:100%;border-collapse:collapse;font-size:11px;background:white;border-radius:8px;overflow:hidden">
          <thead>
            <tr style="background:#fed7aa;color:#7c2d12">
              <th style="padding:5px 8px;text-align:left;font-weight:700">날짜</th>
              <th style="padding:5px 8px;text-align:left;font-weight:700">업체</th>
              <th style="padding:5px 8px;text-align:right;font-weight:700">발주금액</th>
              <th style="padding:5px 8px;text-align:center;font-weight:700">상태</th>
              <th style="padding:5px 8px;text-align:center;font-weight:700">처리</th>
            </tr>
          </thead>
          <tbody>
            ${(inspectionSummary.pendingList || []).slice(0, 5).map((r, idx) => {
              const isUnregistered = !r.vendor_name || r.category == null
              const vendorDisplay = isUnregistered
                ? `<span style="color:#dc2626;font-weight:700">⚠️ ${r.vendor_name||'미등록 업체'}</span><br><span style="font-size:9px;color:#ef4444">업체 미등록 발주</span>`
                : r.vendor_name
              return `
            <tr style="border-bottom:1px solid #fed7aa;background:${idx%2===0?'#fff7ed':'white'}">
              <td style="padding:5px 8px;color:#6b7280">${r.order_date||''}</td>
              <td style="padding:5px 8px;font-weight:600;color:#374151">${vendorDisplay}</td>
              <td style="padding:5px 8px;text-align:right;color:#1d4ed8;font-weight:600">${fmt(r.total_amount||0)}원</td>
              <td style="padding:5px 8px;text-align:center">
                <span style="background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:4px;font-weight:600;font-size:10px">⏳ 미검수</span>
              </td>
              <td style="padding:5px 8px;text-align:center">
                <button onclick="quickInspect(${r.id})" style="background:#059669;color:white;border:none;padding:3px 8px;border-radius:4px;font-size:10px;cursor:pointer;font-weight:600">
                  <i class="fas fa-check"></i> 완료
                </button>
              </td>
            </tr>`}).join('')}
            ${(inspectionSummary.pendingList||[]).length > 5 ? `
            <tr><td colspan="5" style="padding:5px 8px;text-align:center;color:#9ca3af;font-style:italic">+${(inspectionSummary.pendingList||[]).length - 5}건 더... (전체보기 클릭)</td></tr>` : ''}
          </tbody>
        </table>
      </div>
    </div>
  </div>` : ''}

  <!-- ────────────────────────────────────────────────────────
       2.2 월말 예상 식단가 / 2.3 예산 소진 예상일 / 2.4 적정성 / 2.5 이상탐지
       ──────────────────────────────────────────────────────── -->
  ${(proj.projectedMonthEndMealPrice > 0 || budgetDepl.budgetDepletionDate || anomalies.length > 0 || orderAppr.diffRatio !== undefined) ? `
  <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">

    <!-- 2.2 월말 예상 식단가 -->
    <div class="bg-white rounded-2xl shadow-sm border ${proj.projectedMealPriceDiff > 0 ? 'border-red-200' : 'border-green-200'} p-4">
      <div class="flex items-center gap-2 mb-2">
        <div class="w-8 h-8 rounded-lg ${proj.projectedMealPriceDiff > 0 ? 'bg-red-50' : 'bg-green-50'} flex items-center justify-center">
          <i class="fas fa-chart-line ${proj.projectedMealPriceDiff > 0 ? 'text-red-500' : 'text-green-500'} text-sm"></i>
        </div>
        <span class="text-xs text-gray-500 font-semibold">월말 예상 식단가</span>
      </div>
      <div class="text-lg font-bold ${proj.projectedMealPriceDiff > 0 ? 'text-red-600' : 'text-gray-800'}">
        ${proj.projectedMonthEndMealPrice > 0 ? fmt(proj.projectedMonthEndMealPrice) + '원' : '집계중'}
      </div>
      <div class="text-xs text-gray-400 mt-1">현재: ${fmt(data.mealPriceTotal||0)}원 · 목표: ${fmt(proj.targetMealPrice||0)}원</div>
      ${proj.projectedMealPriceDiff !== 0 && proj.projectedMonthEndMealPrice > 0 ? `
      <div class="text-xs font-semibold mt-1 ${proj.projectedMealPriceDiff > 0 ? 'text-red-500' : 'text-green-600'}">
        ${proj.projectedMealPriceDiff > 0 ? '▲' : '▼'} ${fmt(Math.abs(proj.projectedMealPriceDiff))}원
        (${proj.projectedMealPriceDiff > 0 ? '+' : ''}${proj.projectedMealPriceDiffPct}%)
        ${proj.projectedMealPriceDiff > 0 ? '초과 예상' : '여유'}
      </div>` : (proj.projectedMonthEndMealPrice > 0 ? '<div class="text-xs text-green-600 font-semibold mt-1">✓ 목표 범위 내</div>' : '')}
      <div class="text-xs text-gray-300 mt-1">${proj.elapsedDays||0}일 경과 기준 추세</div>
    </div>

    <!-- 2.3 예산 소진 예상일 -->
    <div class="bg-white rounded-2xl shadow-sm border ${budgetDepl.budgetDepletionStatus==='exceeded'?'border-red-300':budgetDepl.budgetDepletionStatus==='warning'?'border-yellow-300':'border-gray-100'} p-4">
      <div class="flex items-center gap-2 mb-2">
        <div class="w-8 h-8 rounded-lg ${budgetDepl.budgetDepletionStatus==='exceeded'?'bg-red-50':budgetDepl.budgetDepletionStatus==='warning'?'bg-yellow-50':'bg-purple-50'} flex items-center justify-center">
          <i class="fas fa-hourglass-half ${budgetDepl.budgetDepletionStatus==='exceeded'?'text-red-500':budgetDepl.budgetDepletionStatus==='warning'?'text-yellow-500':'text-purple-500'} text-sm"></i>
        </div>
        <span class="text-xs text-gray-500 font-semibold">예산 소진 예상일</span>
      </div>
      <div class="text-lg font-bold ${budgetDepl.budgetDepletionStatus==='exceeded'?'text-red-600':budgetDepl.budgetDepletionStatus==='warning'?'text-yellow-600':'text-gray-800'}">
        ${budgetDepl.budgetDepletionDate || (s.totalBudget > 0 ? '발주 없음' : '예산 미설정')}
      </div>
      <div class="text-xs text-gray-400 mt-1">잔여: ${fmtMan(budgetDepl.remaining||0)}원</div>
      ${budgetDepl.budgetDepletionStatus === 'warning' ? '<div class="text-xs text-yellow-600 font-semibold mt-1">⚠️ 월말 이전 소진 예상</div>' : ''}
      ${budgetDepl.budgetDepletionStatus === 'exceeded' ? '<div class="text-xs text-red-600 font-semibold mt-1">🚨 예산 초과</div>' : ''}
      ${budgetDepl.budgetDepletionStatus === 'normal' && budgetDepl.budgetDepletionDate ? '<div class="text-xs text-green-600 font-semibold mt-1">✓ 월말 초과 예상 없음</div>' : ''}
      <div class="text-xs text-gray-300 mt-1">일평균 ${fmtMan(budgetDepl.dailyAvgUsed||0)}원 기준</div>
    </div>

    <!-- 2.4 식수 대비 발주 적정성 (#6 개선: 일별/주별/월별 구분) -->
    <div class="bg-white rounded-2xl shadow-sm border ${orderAppr.label==='over'?'border-orange-200':orderAppr.label==='under'?'border-blue-200':'border-green-200'} p-4">
      <div class="flex items-center gap-2 mb-2">
        <div class="w-8 h-8 rounded-lg ${orderAppr.label==='over'?'bg-orange-50':orderAppr.label==='under'?'bg-blue-50':'bg-green-50'} flex items-center justify-center">
          <i class="fas fa-balance-scale ${orderAppr.label==='over'?'text-orange-500':orderAppr.label==='under'?'text-blue-500':'text-green-500'} text-sm"></i>
        </div>
        <span class="text-xs text-gray-500 font-semibold">발주 적정성</span>
      </div>
      <div class="text-base font-bold ${orderAppr.label==='over'?'text-orange-600':orderAppr.label==='under'?'text-blue-600':'text-green-700'}">
        ${orderAppr.label==='over' ? '⚠ 과다 발주' : orderAppr.label==='under' ? '▼ 과소 발주' : (orderAppr.targetMealPrice > 0 ? '✓ 적정 수준' : '목표 미설정')}
      </div>
      <!-- #6 일별/주별/월별 적정성 3단계 표시 -->
      ${orderAppr.targetMealPrice > 0 ? (() => {
        const todayPct = s.dailyBudget > 0 ? Math.round(s.todayUsed / s.dailyBudget * 100) : null
        const weekPct  = s.weeklyBudget > 0 ? Math.round(s.weekUsed / s.weeklyBudget * 100) : null
        const monthPct = parseFloat(s.progress || 0)
        const rows = [
          { label:'일별', pct: todayPct, used: s.todayUsed, budget: s.dailyBudget },
          { label:'주별', pct: weekPct,  used: s.weekUsed,  budget: s.weeklyBudget },
          { label:'월별', pct: monthPct, used: s.totalUsed, budget: s.totalBudget },
        ]
        return `<div style="margin-top:8px;display:flex;flex-direction:column;gap:5px">
          ${rows.map(r => {
            if (r.pct === null || r.budget <= 0) return `<div style="display:flex;align-items:center;gap:6px"><span style="font-size:10px;font-weight:700;color:#6b7280;width:24px">${r.label}</span><span style="font-size:10px;color:#9ca3af">미설정</span></div>`
            const c = r.pct >= 100 ? '#dc2626' : r.pct >= 80 ? '#f59e0b' : '#10b981'
            const status = r.pct >= 110 ? '초과' : r.pct >= 80 ? '주의' : '정상'
            return `<div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:10px;font-weight:700;color:#374151;width:24px">${r.label}</span>
              <div style="flex:1;height:6px;background:#f3f4f6;border-radius:3px;overflow:hidden">
                <div style="height:100%;width:${Math.min(r.pct,100)}%;background:${c};border-radius:3px"></div>
              </div>
              <span style="font-size:10px;font-weight:700;color:${c};width:34px;text-align:right">${r.pct}%</span>
              <span style="font-size:9px;color:${c};background:${c}20;padding:1px 4px;border-radius:8px;white-space:nowrap">${status}</span>
            </div>`
          }).join('')}
        </div>`
      })() : `
      <div class="text-xs text-gray-400 mt-1">
        실제: ${fmtMan(orderAppr.actualOrderAmt||0)}원 · 적정: ${fmtMan(orderAppr.appropriateOrderAmt||0)}원
      </div>
      ${orderAppr.diffRatio !== undefined && orderAppr.appropriateOrderAmt > 0 ? `
      <div class="text-xs font-semibold mt-1 ${orderAppr.label==='over'?'text-orange-600':orderAppr.label==='under'?'text-blue-600':'text-green-600'}">
        ${orderAppr.diffRatio > 0 ? '+' : ''}${orderAppr.diffRatio}%
        (${fmtMan(Math.abs(orderAppr.diffAmt||0))}원 ${orderAppr.label==='over'?'초과':orderAppr.label==='under'?'부족':'차이'})
      </div>` : ''}
      <div class="text-xs text-gray-300 mt-1">목표 식단가 미설정</div>`}
    </div>

    <!-- 2.5 발주 이상 탐지 -->
    <div class="bg-white rounded-2xl shadow-sm border ${anomalies.some(a=>a.severity==='high')?'border-red-200':anomalies.some(a=>a.severity==='medium')?'border-yellow-200':'border-gray-100'} p-4">
      <div class="flex items-center gap-2 mb-2">
        <div class="w-8 h-8 rounded-lg ${anomalies.some(a=>a.severity==='high')?'bg-red-50':anomalies.some(a=>a.severity==='medium')?'bg-yellow-50':'bg-gray-50'} flex items-center justify-center">
          <i class="fas fa-radar ${anomalies.some(a=>a.severity==='high')?'text-red-500':anomalies.some(a=>a.severity==='medium')?'text-yellow-500':'text-gray-400'} text-sm"></i>
        </div>
        <span class="text-xs text-gray-500 font-semibold">이상 탐지</span>
        ${anomalies.length > 0 ? `<span class="ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${anomalies.some(a=>a.severity==='high')?'bg-red-100 text-red-700':anomalies.some(a=>a.severity==='medium')?'bg-yellow-100 text-yellow-700':'bg-gray-100 text-gray-600'}">${anomalies.length}</span>` : ''}
      </div>
      ${anomalies.length === 0 ? `
        <div class="text-lg font-bold text-green-700">정상</div>
        <div class="text-xs text-gray-400 mt-1">이상 패턴 감지 없음</div>
      ` : `
        <div class="space-y-1.5 max-h-20 overflow-y-auto">
          ${anomalies.slice(0,3).map(a => `
            <div class="text-xs ${a.severity==='high'?'text-red-600':a.severity==='medium'?'text-yellow-600':'text-gray-500'} leading-tight">
              ${a.severity==='high'?'🚨':a.severity==='medium'?'⚠️':'ℹ️'} ${a.message}
            </div>
          `).join('')}
          ${anomalies.length > 3 ? `<div class="text-xs text-gray-400">+${anomalies.length-3}개 더...</div>` : ''}
        </div>
      `}
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
      <div class="text-xs ${s.remaining<0?'text-red-500 font-semibold':'text-gray-400'} mt-1">${s.remaining<0?'⚠️ 예산 초과!':'남은 예산'}</div>
      <!-- #6 잔여 예산 Progress Bar 시각화 -->
      ${s.totalBudget > 0 ? `
      <div class="mt-2">
        <div style="display:flex;justify-content:space-between;font-size:10px;color:#9ca3af;margin-bottom:3px">
          <span>사용 ${fmtMan(s.totalUsed)}원</span>
          <span>목표 ${fmtMan(s.totalBudget)}원</span>
        </div>
        <div style="position:relative;height:10px;background:#f3f4f6;border-radius:6px;overflow:hidden">
          <div style="position:absolute;left:0;top:0;height:100%;border-radius:6px;transition:width 0.5s;
            background:${parseFloat(s.progress)>=100?'#dc2626':parseFloat(s.progress)>=80?'#f59e0b':'#10b981'};
            width:${Math.min(parseFloat(s.progress||0),100)}%"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;margin-top:3px">
          <span style="font-weight:700;color:${parseFloat(s.progress)>=100?'#dc2626':parseFloat(s.progress)>=80?'#d97706':'#059669'}">${s.progress}% 사용</span>
          <span style="color:#6b7280">잔여 ${remainingDays}일</span>
        </div>
        <div style="font-size:10px;color:#6b7280;margin-top:2px">일 가용: ${fmtMan(remainingDays>0?Math.round(s.remaining/remainingDays):0)}원/일</div>
      </div>` : '<div class="text-xs text-gray-400 mt-1">예산 미설정</div>'}
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
        ${(mealCustomFields.length > 0
          ? mealCustomFields.map(f => ({ label: f.field_name, value: mealCustomTotals[f.field_key]||0, color: f.unit_type==='ea'?'bg-orange-100 text-orange-700':'bg-indigo-100 text-indigo-700', icon: 'fa-utensils', unit: f.unit_type||'meal' }))
          : [
              { label: '환자식', value: ms.total_patient, color: 'bg-blue-100 text-blue-700', icon: 'fa-bed' },
              { label: '직원식', value: ms.total_staff, color: 'bg-green-100 text-green-700', icon: 'fa-user' },
              { label: '비급여', value: ms.total_noncovered, color: 'bg-purple-100 text-purple-700', icon: 'fa-receipt' },
              { label: '보호자', value: ms.total_guardian, color: 'bg-orange-100 text-orange-700', icon: 'fa-users' },
            ]
        ).map(item => `
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

        // ① 전체 식단가: 서버에서 계산된 총발주÷총식수 (올바른 가중평균)
        // mealPriceTotal = 총발주금액 / 총식수 (카테고리별 발주+식수 합산)
        // 예산비중 가중평균(식단가×예산비중)은 잘못된 방식 → 사용 안 함
        const dbWeightedCurrent = mealPriceTotal || (() => {
          // mealPriceTotal 없을 때 폴백: 총발주÷총식수 직접 계산
          const totalO = activeCats.reduce((s,c) => s + (c.monthAmt||0), 0)
          const totalM = activeCats.reduce((s,c) => s + (c.monthMeals||0), 0)
          return totalM > 0 ? Math.round(totalO / totalM) : 0
        })()

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
        const panelTitle = isSingleCat ? `전체 식단가 (${catPriceList[0]?.category_name||''} 기준)` : '전체 식단가 (총발주÷총식수 가중평균)'
        const panelIcon  = isSingleCat ? 'fa-utensils' : 'fa-balance-scale'
        const panelDesc  = isSingleCat
          ? `${catPriceList[0]?.category_name||''} 발주금액 ÷ 설정 식수`
          : activeCats.map(c => `${c.category_name} ${c.monthMeals||0}식`).join(' + ') + ' (식수비중 가중평균)'
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
        </div>
        <!-- 2.6 카테고리별 식단가 비교 테이블 -->
        ${catPriceList.length > 0 ? `
        <div class="mt-3 overflow-x-auto">
          <table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead>
              <tr style="background:#f3f4f6">
                <th style="padding:6px 8px;text-align:left;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb">카테고리</th>
                <th style="padding:6px 8px;text-align:right;color:#7c3aed;font-weight:600;border-bottom:2px solid #e5e7eb">목표 식단가</th>
                <th style="padding:6px 8px;text-align:right;color:#1d4ed8;font-weight:600;border-bottom:2px solid #e5e7eb">실제 식단가</th>
                <th style="padding:6px 8px;text-align:right;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb">차이</th>
              </tr>
            </thead>
            <tbody>
              ${catPriceList.map(cat => {
                const color = getCategoryColorHex(cat.category_key)
                const targetP = cat.targetPrice || 0
                const actualP = cat._dietPrice || 0
                const diff = targetP > 0 && actualP > 0 ? actualP - targetP : null
                const diffPct = diff !== null && targetP > 0 ? ((diff / targetP) * 100).toFixed(1) : null
                const isOver = diff !== null && diff > 0
                const diffColor = isOver ? '#dc2626' : diff < 0 ? '#16a34a' : '#6b7280'
                return `<tr style="border-bottom:1px solid #f3f4f6">
                  <td style="padding:6px 8px">
                    <span style="display:inline-flex;align-items:center;gap:4px">
                      <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
                      <span style="font-weight:600;color:#374151">${cat.category_name}</span>
                    </span>
                  </td>
                  <td style="padding:6px 8px;text-align:right;color:#7c3aed;font-weight:600">${targetP > 0 ? fmt(targetP)+'원' : '<span style="color:#d1d5db">미설정</span>'}</td>
                  <td style="padding:6px 8px;text-align:right;font-weight:700;color:${actualP>0?(diff!==null&&diff>0?'#dc2626':'#1d4ed8'):'#d1d5db'}">${actualP > 0 ? fmt(actualP)+'원' : '미입력'}</td>
                  <td style="padding:6px 8px;text-align:right;font-weight:700;color:${diffColor}">
                    ${diff !== null ? `${diff > 0 ? '+' : ''}${fmt(diff)}원 (${diff > 0 ? '+' : ''}${diffPct}%)` : '<span style="color:#d1d5db">-</span>'}
                  </td>
                </tr>`
              }).join('')}
            </tbody>
          </table>
        </div>` : ''}
        `
      })() : ''}

      <!-- 자동 분석 문장 (AI 해석) -->
      ${autoAnalysis.length > 0 ? `
      <div class="mt-3 p-3 bg-indigo-50 rounded-xl border border-indigo-100">
        <div class="flex items-center gap-2 mb-2">
          <i class="fas fa-lightbulb text-indigo-500 text-xs"></i>
          <span class="text-xs font-bold text-indigo-700">운영 자동 분석</span>
        </div>
        <ul class="space-y-1.5">
          ${autoAnalysis.map(msg => `
            <li class="text-xs text-indigo-800 flex items-start gap-1.5">
              <span class="text-indigo-400 mt-0.5 flex-shrink-0">•</span>
              <span>${msg}</span>
            </li>
          `).join('')}
        </ul>
      </div>` : ''}

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

      <!-- 법인카드 현황 (데이터 있을 때만) -->
      ${dashCardMonthTotal > 0 ? `
      <div class="mt-3 border-t border-gray-100 pt-3">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-bold text-gray-700"><i class="fas fa-credit-card text-purple-500 mr-1"></i>법인카드 사용 현황</span>
          <span class="text-sm font-bold text-purple-700">${fmtMan(dashCardMonthTotal)}원</span>
        </div>
        ${_dashCardBySubtypeFiltered.length > 0 ? `
        <div class="grid grid-cols-${Math.min(_dashCardBySubtypeFiltered.length, 3)} gap-1.5 mb-2">
          ${_dashCardBySubtypeFiltered.map(st => `
          <div class="p-2 bg-purple-50 rounded-lg border border-purple-100 text-center">
            <div class="text-xs text-purple-500 mb-0.5">${st.label}</div>
            <div class="text-xs font-bold text-purple-700">${fmtMan(st.total)}원</div>
            <div class="text-xs text-gray-400">${st.count}건</div>
          </div>`).join('')}
        </div>` : ''}
        ${_dashVendorTotals.length > 0 ? `
        <div class="max-h-32 overflow-y-auto space-y-1">
          ${_dashVendorTotals.map(r => {
            const vn = (dashCardData?.cardVendors||[]).find(v => Number(v.id) === r.vendor_id)
            const subtypeLabel = _subtypeMap[vn?.card_subtype||'other'] || '기타'
            return `<div class="flex items-center justify-between text-xs bg-purple-50/50 rounded-lg px-2 py-1 border border-purple-100/50">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="shrink-0 text-purple-400 text-[10px] bg-purple-100 rounded px-1">${subtypeLabel}</span>
                <span class="text-gray-600 font-medium truncate">${vn?.name || '업체'}</span>
              </div>
              <div class="flex items-center gap-2 shrink-0 ml-1">
                <span class="font-bold text-purple-700">${fmtMan(r.total)}원</span>
                <span class="text-gray-400">${r.count}건</span>
              </div>
            </div>`
          }).join('')}
        </div>` : ''}
      </div>` : ''}

      <!-- 2.8 잔반 비용 분석 -->
      <div class="mt-3 border-t border-gray-100 pt-3">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-bold text-gray-700"><i class="fas fa-recycle text-amber-500 mr-1"></i>잔반 비용 분석</span>
          <div class="flex gap-2">
            <button onclick="showIngredientPricesModal(${App.currentYear},${App.currentMonth})" class="text-xs text-green-600 hover:underline font-medium"><i class="fas fa-leaf mr-1"></i>식재료 단가</button>
            <button onclick="showFoodWasteModal(${App.currentYear},${App.currentMonth})" class="text-xs text-blue-500 hover:underline">잔반 입력 →</button>
          </div>
        </div>
        ${foodWasteData.length > 0 ? (() => {
          const totalL = foodWasteData.reduce((s,w)=>s+(w.waste_amount||0),0)
          const totalCost = foodWasteData.reduce((s,w)=>s+(w.waste_cost||0),0)
          const wasteBudget = data?.settings?.food_waste_budget || 0
          const budgetPct = wasteBudget > 0 ? Math.round(totalCost/wasteBudget*100) : 0
          const costOverBudget = wasteBudget > 0 && totalCost > wasteBudget
          return `
          <div class="space-y-1.5">
            ${foodWasteData.map(w=>`
            <div class="flex items-center justify-between text-xs bg-amber-50 rounded-lg px-3 py-1.5">
              <span class="text-gray-600">${w.week}주차</span>
              <span class="font-semibold text-amber-700">${(w.waste_amount||0).toFixed(1)}L</span>
              ${w.waste_cost>0?`<span class="text-gray-500">${fmtMan(w.waste_cost)}원</span>`:'<span class="text-gray-300">-</span>'}
              ${w.memo?`<span class="text-gray-400 truncate max-w-20">${w.memo}</span>`:''}
            </div>`).join('')}
            <div class="flex items-center justify-between text-xs font-bold bg-amber-100 rounded-lg px-3 py-1.5">
              <span class="text-amber-800">합계</span>
              <span class="text-amber-800">${totalL.toFixed(1)}L</span>
              <span class="${costOverBudget?'text-red-600':'text-amber-700'}">${fmtMan(totalCost)}원 ${costOverBudget?'🚨':''}</span>
            </div>
            ${wasteBudget > 0 ? `
            <div class="mt-1">
              <div class="flex justify-between text-xs text-gray-500 mb-0.5">
                <span>목표 대비 사용률</span>
                <span class="${costOverBudget?'text-red-500 font-bold':'text-gray-600'}">${budgetPct}%</span>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-1.5">
                <div class="h-1.5 rounded-full ${costOverBudget?'bg-red-500':'bg-amber-400'}" style="width:${Math.min(budgetPct,100)}%"></div>
              </div>
              <div class="text-xs text-gray-400 mt-0.5">목표: ${fmtMan(wasteBudget)}원</div>
            </div>` : ''}
          </div>`
        })() : `<div class="text-xs text-gray-400 py-2 text-center">잔반 기록 없음 · <button onclick="showFoodWasteModal(${App.currentYear},${App.currentMonth})" class="text-blue-500 hover:underline">입력하기</button></div>`}
      </div>
    </div>

    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <!-- 헤더 -->
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-bold text-gray-800 text-sm flex items-center gap-1.5">
          <i class="fas fa-chart-pie text-indigo-500"></i> 업체 카테고리별 발주 분석
        </h2>
      </div>

      <!-- 좌우 2단 레이아웃: 도넛+범례 | 상세분석 -->
      <div style="display:flex;gap:14px;align-items:flex-start">

        <!-- 왼쪽: 도넛 차트 + 카테고리 범례 -->
        <div style="flex-shrink:0;width:148px">
          <div style="width:120px;height:120px;position:relative;margin:0 auto 8px">
            <canvas id="vendorPieChart" width="120" height="120"></canvas>
          </div>
          <div id="vendorPieLegend"></div>
        </div>

        <!-- 세로 구분선 -->
        <div style="width:1px;background:#f3f4f6;align-self:stretch;flex-shrink:0"></div>

        <!-- 오른쪽: 상세 분석 -->
        <div id="vendorPieDetailContent" style="flex:1;min-width:0"></div>
      </div>
    </div>
  </div>`

  // ── 업체 카테고리별 상세 분석 데이터 계산 ──
  const _vendorAnalysis = (() => {
    const totalUsed = vendors.reduce((s, v) => s + (v.total_used||0), 0)
    // 카테고리별 집계
    const catMap = {}
    vendors.forEach(v => {
      if ((v.total_used||0) === 0) return
      const catKey = v.category || 'general'
      const catLabel = getCategoryLabel(catKey)
      if (!catMap[catLabel]) catMap[catLabel] = { label: catLabel, key: catKey, total: 0, budget: 0, vendors: [] }
      catMap[catLabel].total   += v.total_used || 0
      catMap[catLabel].budget  += v.monthly_budget || 0
      catMap[catLabel].vendors.push(v)
    })
    const cats = Object.values(catMap).sort((a, b) => b.total - a.total)

    // TOP3 업체
    const top3 = [...vendors].filter(v => v.total_used > 0).sort((a, b) => b.total_used - a.total_used).slice(0, 3)
    // 예산 초과 업체
    const overBudget = vendors.filter(v => v.monthly_budget > 0 && v.total_used > v.monthly_budget)
    // 미발주 업체
    const noOrder = vendors.filter(v => v.total_used === 0)
    // 과세/면세 합계
    const totalTaxable = vendors.reduce((s, v) => s + (v.total_taxable||0), 0)
    const totalExempt  = vendors.reduce((s, v) => s + (v.total_exempt||0), 0)
    const totalVat     = vendors.reduce((s, v) => s + (v.total_vat||0), 0)

    return { totalUsed, cats, top3, overBudget, noOrder, totalTaxable, totalExempt, totalVat }
  })()

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

  // ── 도넛 차트 (카테고리별 비중) ──
  const pieColors = ['#4f46e5','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899','#16a34a','#6b7280']
  const vendorCatData = {}
  const vendorCatKeys = {}
  vendors.forEach(v => {
    if (v.total_used > 0) {
      const cat = getCategoryLabel(v.category)
      vendorCatData[cat] = (vendorCatData[cat] || 0) + v.total_used
      vendorCatKeys[cat] = v.category
    }
  })
  const catLabels = Object.keys(vendorCatData)
  const catValues = Object.values(vendorCatData)
  const totalUsedPie = catValues.reduce((s, v) => s + v, 0)

  const ctx2 = document.getElementById('vendorPieChart')
  if (ctx2 && catLabels.length > 0) {
    // 도넛 중앙 합계 플러그인
    const pieCenterPlugin = {
      id: 'pieCenter',
      afterDraw(chart) {
        if (chart.config.type !== 'doughnut') return
        const { ctx: c, chartArea: { top, left, width, height } } = chart
        const cx = left + width/2, cy = top + height/2
        c.save()
        c.textAlign = 'center'; c.textBaseline = 'middle'
        c.font = 'bold 12px sans-serif'; c.fillStyle = '#1f2937'
        c.fillText(fmtMan(totalUsedPie), cx, cy - 7)
        c.font = '9px sans-serif'; c.fillStyle = '#9ca3af'
        c.fillText('월 발주 합계', cx, cy + 8)
        c.restore()
      }
    }
    App.charts.pie = new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels: catLabels,
        datasets: [{ data: catValues, backgroundColor: pieColors.slice(0, catLabels.length), borderWidth: 2, borderColor: '#fff' }]
      },
      options: {
        responsive: true, cutout: '60%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            label: (ctx) => {
              const pct = totalUsedPie > 0 ? ((ctx.raw / totalUsedPie) * 100).toFixed(1) : 0
              return `${ctx.label}: ${fmt(ctx.raw)}원 (${pct}%)`
            }
          }}
        }
      },
      plugins: [pieCenterPlugin]
    })

    // ── 범례 (도넛 아래) ──
    const legendEl = document.getElementById('vendorPieLegend')
    if (legendEl) {
      legendEl.innerHTML = catLabels.map((label, i) => {
        const amt = catValues[i]
        const pct = totalUsedPie > 0 ? ((amt / totalUsedPie) * 100).toFixed(1) : 0
        // 해당 카테고리 업체들
        const cvs = vendors.filter(v => getCategoryLabel(v.category) === label && v.total_used > 0)
        const budgetTotal = cvs.reduce((s, v) => s + (v.monthly_budget||0), 0)
        const budgetPct = budgetTotal > 0 ? Math.round(amt/budgetTotal*100) : null
        const budColor = budgetPct === null ? '#9ca3af' : budgetPct >= 100 ? '#dc2626' : budgetPct >= 80 ? '#f59e0b' : '#10b981'
        return `<div style="display:flex;align-items:center;gap:5px;padding:3px 0;border-bottom:1px solid #f9fafb">
          <div style="width:8px;height:8px;border-radius:2px;background:${pieColors[i]};flex-shrink:0"></div>
          <div style="flex:1;min-width:0">
            <div style="font-size:10px;color:#374151;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${label}</div>
            <div style="font-size:9px;color:#9ca3af">${fmtMan(amt)}원 · <span style="color:${pieColors[i]};font-weight:700">${pct}%</span>${budgetPct !== null ? ` · <span style="color:${budColor};font-weight:600">목표${budgetPct}%</span>` : ''}</div>
          </div>
        </div>`
      }).join('')
    }
  }

  // ── 상세 분석 뷰 렌더링 ──
  const detailEl = document.getElementById('vendorPieDetailContent')
  if (detailEl && _vendorAnalysis) {
    const { totalUsed, cats, top3, overBudget, noOrder, totalTaxable, totalExempt, totalVat } = _vendorAnalysis

    detailEl.innerHTML = `
      <!-- TOP 3 업체 -->
      ${top3.length > 0 ? `
      <div style="margin-bottom:8px">
        <div style="font-size:10px;font-weight:700;color:#1f2937;margin-bottom:4px">🏆 TOP 발주 업체</div>
        ${top3.map((v, i) => {
          const pct = totalUsed > 0 ? ((v.total_used/totalUsed)*100).toFixed(1) : 0
          const budgetPct = v.monthly_budget > 0 ? Math.round(v.total_used/v.monthly_budget*100) : null
          const budColor = budgetPct === null ? '#9ca3af' : budgetPct >= 100 ? '#dc2626' : budgetPct >= 80 ? '#f59e0b' : '#10b981'
          const medal = i===0?'🥇':i===1?'🥈':'🥉'
          return `<div style="display:flex;align-items:center;gap:5px;padding:3px 5px;background:#f9fafb;border-radius:5px;margin-bottom:2px">
            <span style="font-size:12px">${medal}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:10px;font-weight:700;color:#1f2937;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${v.name}</div>
              <div style="font-size:8px;color:#9ca3af">${getCategoryLabel(v.category)} · ${pct}%${budgetPct!==null?` · <span style="color:${budColor}">목표${budgetPct}%</span>`:''}</div>
            </div>
            <div style="font-size:10px;font-weight:700;color:#4f46e5;flex-shrink:0">${fmtMan(v.total_used)}</div>
          </div>`
        }).join('')}
      </div>` : ''}

      <!-- 카테고리별 요약 -->
      <div style="margin-bottom:8px">
        <div style="font-size:10px;font-weight:700;color:#1f2937;margin-bottom:4px">📦 카테고리별 현황</div>
        ${cats.map((cat, i) => {
          const pct = totalUsed > 0 ? ((cat.total/totalUsed)*100).toFixed(1) : 0
          const budgetPct = cat.budget > 0 ? Math.round(cat.total/cat.budget*100) : null
          const barColor = budgetPct !== null && budgetPct >= 100 ? '#ef4444' : budgetPct !== null && budgetPct >= 80 ? '#f59e0b' : pieColors[i%pieColors.length]
          return `<div style="margin-bottom:4px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
              <div style="display:flex;align-items:center;gap:3px">
                <div style="width:7px;height:7px;border-radius:2px;background:${pieColors[i%pieColors.length]}"></div>
                <span style="font-size:10px;font-weight:600;color:#374151">${cat.label}</span>
                <span style="font-size:8px;color:#9ca3af">${cat.vendors.length}업체</span>
              </div>
              <div style="font-size:10px;font-weight:700;color:${pieColors[i%pieColors.length]}">${fmtMan(cat.total)} <span style="color:#9ca3af;font-weight:400;font-size:8px">${pct}%</span></div>
            </div>
            <div style="background:#e5e7eb;border-radius:3px;height:4px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px"></div>
            </div>
            ${budgetPct !== null ? `<div style="font-size:8px;color:${budgetPct>=100?'#dc2626':budgetPct>=80?'#f59e0b':'#10b981'};margin-top:1px;text-align:right">목표 대비 ${budgetPct}%</div>` : ''}
          </div>`
        }).join('')}
      </div>

      <!-- 예산 초과 업체 경고 -->
      ${overBudget.length > 0 ? `
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:6px;margin-bottom:6px">
        <div style="font-size:9px;font-weight:700;color:#dc2626;margin-bottom:3px">⚠️ 예산 초과 (${overBudget.length}개)</div>
        ${overBudget.map(v => {
          const over = v.total_used - v.monthly_budget
          const pct = Math.round(v.total_used/v.monthly_budget*100)
          return `<div style="display:flex;justify-content:space-between;font-size:9px;color:#374151;padding:1px 0">
            <span style="font-weight:600">${v.name}</span>
            <span style="color:#dc2626;font-weight:700">+${fmtMan(over)} (${pct}%)</span>
          </div>`
        }).join('')}
      </div>` : `<div style="background:#f0fdf4;border-radius:6px;padding:5px;text-align:center;font-size:9px;color:#16a34a;font-weight:600;margin-bottom:6px">✅ 모든 업체 예산 내</div>`}

      <!-- 미발주 업체 -->
      ${noOrder.length > 0 ? `
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:6px">
        <div style="font-size:9px;font-weight:700;color:#6b7280;margin-bottom:2px">📭 미발주 업체 (${noOrder.length}개)</div>
        <div style="font-size:9px;color:#9ca3af">${noOrder.map(v=>v.name).join(' · ')}</div>
      </div>` : ''}
    `
  }

  // switchVendorPieView는 더 이상 차트/상세를 전환하지 않음 (동시 표시로 변경됨)
  window.switchVendorPieView = function(view) { /* 레거시 - 현재는 미사용 */ }
}

// ══════════════════════════════════════════════════════════════
//  발주 입력 페이지 (v2.0 - 다일치 발주 지원)
// ══════════════════════════════════════════════════════════════
async function renderOrders() {
  const content = document.getElementById('orders-panel') || document.getElementById('pageContent')
  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`

  const [vendors, orderData, settingsData, dashData, patientCats, catOrderData, cardData] = await Promise.all([
    api('GET', '/api/vendors'),
    api('GET', `/api/orders/${App.currentYear}/${App.currentMonth}`),
    api('GET', `/api/settings/${App.currentYear}/${App.currentMonth}`),
    api('GET', `/api/dashboard/summary/${App.currentYear}/${App.currentMonth}`),
    api('GET', '/api/orders/patient-categories'),
    api('GET', `/api/orders/category-monthly/${App.currentYear}/${App.currentMonth}`),
    api('GET', `/api/card-expenses/monthly/${App.currentYear}/${App.currentMonth}`)
  ])
  // 법인카드 일별 합계 맵 구성 { vendorId: { dateStr: total } }
  window._cardDailyMap = {}
  window._cardDailyCountMap = {}
  ;(cardData?.dailyTotals || []).forEach(r => {
    if (!window._cardDailyMap[r.vendor_id]) window._cardDailyMap[r.vendor_id] = {}
    if (!window._cardDailyCountMap[r.vendor_id]) window._cardDailyCountMap[r.vendor_id] = {}
    window._cardDailyMap[r.vendor_id][r.expense_date] = r.daily_total || 0
    window._cardDailyCountMap[r.vendor_id][r.expense_date] = r.item_count || 0
  })

  if (!vendors) { content.innerHTML = '<div class="text-red-500 p-6">데이터 로드 실패</div>'; return }

  // 업체 목록 캐시 (법인카드 모달에서 업체 정보 조회에 사용)
  window._vendorsCache = vendors || []

  // 환자군 카테고리 전역 저장
  window._patientCats = patientCats || []
  window._catOrderSettings = (catOrderData?.settings) || []
  window._catDailyOrders = (catOrderData?.dailyByVendorCat) || []  // 실제 카테고리 발주 데이터
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

  // 이번 주 시작/끝 (월요일 기준) - 날짜 문자열로 저장하여 UTC 파싱 문제 방지
  const _ws = new Date(today)
  _ws.setDate(today.getDate() - (today.getDay() === 0 ? 6 : today.getDay() - 1))
  const _we = new Date(_ws)
  _we.setDate(_ws.getDate() + 6)
  const weekStartStr2 = `${_ws.getFullYear()}-${String(_ws.getMonth()+1).padStart(2,'0')}-${String(_ws.getDate()).padStart(2,'0')}`
  const weekEndStr2   = `${_we.getFullYear()}-${String(_we.getMonth()+1).padStart(2,'0')}-${String(_we.getDate()).padStart(2,'0')}`
  // 하위 호환용 Date 객체 (weeklyData 계산에서 사용)
  const weekStart = _ws
  const weekEnd   = _we

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
  // dailyByVendorCat 순회 - 날짜 문자열 직접 비교로 UTC 시간대 버그 방지
  ;(catDailyData).forEach(r => {
    const dateStr2 = r.order_date
    const isToday2    = dateStr2 === todayStr
    const isThisWeek2 = dateStr2 >= weekStartStr2 && dateStr2 <= weekEndStr2
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
    // 날짜 문자열 직접 비교 (UTC 파싱 버그 방지)
    if (r.order_date >= weekStartStr2 && r.order_date <= weekEndStr2) catWeekTotal += r.total || 0
  })
  let normalTodayTotal = 0, normalWeekTotal = 0
  ;(orderData||[]).forEach(o => {
    if (o.order_date === todayStr) normalTodayTotal += o.total_amount||0
    if (o.order_date >= weekStartStr2 && o.order_date <= weekEndStr2) normalWeekTotal += o.total_amount||0
  })
  const todayTotal = hasCatsData ? catTodayTotal : normalTodayTotal
  const weekTotal  = hasCatsData ? catWeekTotal  : normalWeekTotal

  // ── 이번 달 주차별 계산 (1주~6주) ──
  // 날짜 문자열에서 로컬 Date 생성 헬퍼 (UTC 파싱 버그 방지)
  function localDate(dateStr) {
    const [y, m, d2] = dateStr.split('-').map(Number)
    return new Date(y, m-1, d2)
  }
  // Date → YYYY-MM-DD 문자열 (로컬 기준)
  function toDateStr(dt) {
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`
  }
  const weeklyData = []
  const seenWeeks = new Set()
  for (let d = 1; d <= days; d++) {
    const ds = `${App.currentYear}-${String(App.currentMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    const dObj = localDate(ds)
    const mon = new Date(dObj); mon.setDate(dObj.getDate() - (dObj.getDay()===0?6:dObj.getDay()-1))
    const sun = new Date(mon); sun.setDate(mon.getDate()+6)
    const wk = toDateStr(mon)
    if (seenWeeks.has(wk)) continue
    seenWeeks.add(wk)
    const wkEnd = toDateStr(sun)
    // 이 주차에 속하는 해당 월의 실제 일수 계산 (월 경계 처리)
    let wDays = 0
    for (let x = 1; x <= days; x++) {
      const xs = `${App.currentYear}-${String(App.currentMonth).padStart(2,'0')}-${String(x).padStart(2,'0')}`
      if (xs >= wk && xs <= wkEnd) wDays++
    }
    // 주차별 목표: 해당 월 내 실제 일수 × 일 예산 (1주차 1일이면 1일치, 6주차 2일이면 2일치)
    const wBudget = dailyBudget > 0 ? dailyBudget * wDays : 0
    // 카테고리 모드이면 catDailyData에서 주합계 계산, 아니면 orderData 사용
    let wTotal = 0
    if (hasCatsData) {
      wTotal = catDailyData.filter(r => r.order_date >= wk && r.order_date <= wkEnd).reduce((s,r) => s+(r.total||0), 0)
    } else {
      wTotal = (orderData||[]).filter(o=>o.order_date>=wk&&o.order_date<=wkEnd).reduce((s,o)=>s+(o.total_amount||0),0)
    }
    const wPct = wBudget>0?Math.round(wTotal/wBudget*100):0
    // 이번 주 여부
    const isCurWeek = todayStr>=wk && todayStr<=wkEnd
    weeklyData.push({ wk, wkEnd, wTotal, wPct, isCurWeek, wDays, wBudget })
  }

  // 현재 주 예산: 이번 주차의 실제 일수 기반 (todayStr이 속한 주)
  const curWeekData = weeklyData.find(w => w.isCurWeek)
  const weekBudget = curWeekData ? curWeekData.wBudget : (dailyBudget * 5)

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

  // ── 마감 완료 달 읽기전용 처리 ──
  const _ordersReadOnly = isReadOnly(App.currentYear, App.currentMonth)

  content.innerHTML = `
  ${_ordersReadOnly ? readOnlyBanner() : ''}
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
      const grandBudget = cats.reduce((s,c) => s+(catBudgetsMap[c.id]||0), 0)
      // 발주 데이터도 없고 예산도 없으면 숨김
      if (grandAmt === 0 && grandBudget === 0) return ''
      // 환자군 1개이면 점유(A안)는 항상 100%라 의미없으므로 숨김
      const showProportion = cats.length > 1
      const rows = cats.map(cat => {
        const color = getCategoryColorHex(cat.category_key)
        const amt = catTotalsMap[cat.id] || 0
        const budget = catBudgetsMap[cat.id] || 0
        // A안: 실적 비율 (전체 발주 중 이 카테고리 비중) - 2개 이상일 때만
        const aPct = grandAmt > 0 ? Math.round(amt/grandAmt*100) : 0
        // B안: 예산 달성률 (카테고리 목표 대비)
        const bPct = budget > 0 ? Math.round(amt/budget*100) : null
        const bColor = bPct===null?'#9ca3af':bPct>=100?'#dc2626':bPct>=80?'#d97706':color
        return `<div style="display:flex;align-items:center;gap:5px;margin-bottom:5px">
          <span style="display:inline-block;background:${color};color:white;font-size:8px;font-weight:700;padding:1px 5px;border-radius:8px;min-width:28px;text-align:center;white-space:nowrap">${cat.category_name}</span>
          <div style="flex:1;display:flex;flex-direction:column;gap:2px">
            ${showProportion && grandAmt > 0 ? `<div style="display:flex;align-items:center;gap:3px">
              <div style="flex:1;height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden">
                <div id="catABar-${periodLabel}-${cat.id}" style="height:100%;width:${aPct}%;background:${color};border-radius:3px;transition:width 0.4s"></div>
              </div>
              <span id="catAPct-${periodLabel}-${cat.id}" style="font-size:9px;color:${color};font-weight:700;min-width:26px;text-align:right">${aPct}%</span>
              <span style="font-size:8px;color:#9ca3af">점유</span>
            </div>` : ''}
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
            <div id="catAmt-${periodLabel}-${cat.id}" style="font-size:9px;font-weight:700;color:${color}">${amt>0?fmtMan(amt):'-'}</div>
            ${budget>0?`<div style="font-size:8px;color:#9ca3af">${fmtMan(budget)}</div>`:''}
          </div>
        </div>`
      }).join('')
      const sectionTitle = cats.length === 1
        ? `<i class="fas fa-chart-bar" style="color:#8b5cf6;font-size:8px"></i> ${cats[0].category_name} 달성률`
        : `<i class="fas fa-chart-bar" style="color:#8b5cf6;font-size:8px"></i> 환자군별 비중·달성률`
      return `<div style="border-top:1px dashed #e5e7eb;margin-top:6px;padding-top:6px">
        <div style="font-size:9px;font-weight:700;color:#6b7280;margin-bottom:5px;display:flex;align-items:center;gap:3px">
          ${sectionTitle}
        </div>
        ${rows}
      </div>`
    }

    // 카테고리별 예산 (일별/주별/월별)
    const catMonthBudgets = {}
    const catDailyBudgets = {}
    // catWeekBudgets는 현재 주 실제 일수 기반 (고정 5일 아님)
    const catWeekBudgets  = {}
    const curWeekDays = curWeekData ? curWeekData.wDays : 5
    ;(catSettings2||[]).forEach(s => {
      const id = s.patient_category_id
      catMonthBudgets[id] = s.monthly_budget || 0
      catDailyBudgets[id] = s.working_days > 0 ? Math.round((s.monthly_budget||0)/s.working_days) : 0
      catWeekBudgets[id]  = catDailyBudgets[id] * curWeekDays
    })

    // 각 카드에 카테고리 섹션 삽입하기 위해 miniCardWithCats 헬퍼
    function miniCardWithCats(id, label, pct, amt, budget, barId, amtId, pctId, isCurrent, isToday, catTotalsMap, catBudgetsMap, periodLbl) {
      const base = miniCard(id, label, pct, amt, budget, barId, amtId, pctId, isCurrent, isToday)
      const catSection = makeCatSection(catTotalsMap, catBudgetsMap, periodLbl)
      // base의 닫는 </div> 직전에 삽입
      return base.replace(/(<\/div>)\s*$/, catSection + '$1')
    }

    // 주차 카드들 - 각 주차별 catTotals 계산
    const weekCards = weeklyData.map((w,i) => {
      // 주차 라벨: 해당 월의 실제 일수 표시 (1일짜리 주차 등 구분)
      const lbl = `${i+1}주 (${w.wk.slice(5).replace('-','/')}~${w.wkEnd.slice(5).replace('-','/')})`
      // 각 주차별 카테고리 합계 계산
      const wCatTotals = {}
      ;(catDailyData).forEach(r => {
        if (r.order_date >= w.wk && r.order_date <= w.wkEnd) {
          wCatTotals[r.patient_category_id] = (wCatTotals[r.patient_category_id]||0) + (r.total||0)
        }
      })
      // 각 주차별 카테고리 예산: 해당 주 실제 일수 × 일예산 (고정 5일 아님)
      const wCatBudgets = {}
      ;(catSettings2||[]).forEach(s => {
        const id = s.patient_category_id
        const daily = s.working_days > 0 ? Math.round((s.monthly_budget||0)/s.working_days) : 0
        wCatBudgets[id] = daily * (w.wDays || 0)
      })
      // 각 주차별 목표: 해당 주 실제 일수 × 일예산 (고정 5일 아님)
      const thisWeekBudget = w.wBudget || weekBudget
      return miniCardWithCats(`week${i+1}`, lbl, w.wPct, w.wTotal, thisWeekBudget, `weekBar${i+1}`, `weekAmt${i+1}`, `weekPct${i+1}`, w.isCurWeek, false, wCatTotals, wCatBudgets, `w${i+1}`)
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

  <div class="bg-white rounded-2xl shadow-sm border border-gray-100" style="min-width:0;max-width:100%;box-sizing:border-box;contain:layout style">
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
        <button onclick="openInspectionModal()" class="btn btn-sm" style="background:#ecfdf5;color:#059669;border:1px solid #6ee7b7" title="발주 검수 관리">
          <i class="fas fa-clipboard-check"></i> <span class="hidden sm:inline">검수</span>
        </button>
        <button onclick="showMonthAllOrdersModal()" class="btn btn-sm" style="background:#fff7ed;color:#c2410c;border:1px solid #fed7aa" title="월 전체 발주 펼쳐보기">
          <i class="fas fa-table"></i> <span class="hidden sm:inline">전체보기</span>
        </button>
        <button onclick="downloadOrdersExcel()" class="btn btn-sm" style="background:#f0fdf4;color:#166534;border:1px solid #bbf7d0" title="발주 데이터 엑셀 다운로드">
          <i class="fas fa-file-excel"></i> <span class="hidden sm:inline">엑셀</span>
        </button>
        <!-- #4 거래내역 엑셀 자동 입력 -->
        <button onclick="openAutoImportDialog()" style="background:#7c3aed;color:white;border:none;border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:4px;white-space:nowrap" title="업체 거래내역 엑셀 업로드 → 발주 자동 입력">
          <i class="fas fa-file-import"></i><span class="hidden sm:inline">자동입력</span>
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
          const isMixedTotal = v.tax_type==='mixed_total'
          const taxLabel = isMixedTotal?'합산':v.tax_type==='mixed'?'과+면':v.tax_type==='taxable'?'과세':'면세'
          const taxBg = isMixedTotal?'#f3e8ff':v.tax_type==='mixed'?'#dbeafe':v.tax_type==='taxable'?'#dcfce7':'#fef9c3'
          const taxColor = isMixedTotal?'#7c3aed':v.tax_type==='mixed'?'#1d4ed8':v.tax_type==='taxable'?'#166534':'#92400e'
          const chipBorder = isMixedTotal?'1px solid #d8b4fe':'1px solid #e5e7eb'
          return `<span style="display:inline-flex;align-items:center;gap:3px;background:white;border:${chipBorder};border-radius:20px;padding:2px 8px;font-size:10px;font-weight:600;color:#374151;cursor:pointer;white-space:nowrap" onclick="openTodayDetailForVendor(${v.id})" title="클릭하면 오늘 발주 입력 열기">
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
          const isMixedTotal2 = v.tax_type==='mixed_total'
          const taxLabel = isMixedTotal2?'합산':v.tax_type==='mixed'?'과+면':v.tax_type==='taxable'?'과세':'면세'
          const taxTagBg = isMixedTotal2?'#f3e8ff':v.tax_type==='mixed'?'#dbeafe':v.tax_type==='taxable'?'#dcfce7':'#fef9c3'
          const taxTagColor = isMixedTotal2?'#7c3aed':v.tax_type==='mixed'?'#1d4ed8':v.tax_type==='taxable'?'#166534':'#92400e'
          return `<div id="vsum-${v.id}" style="min-width:100px;background:white;border-radius:10px;border:1px solid ${borderColor};padding:8px 10px;cursor:pointer;transition:box-shadow 0.15s" onclick="openTodayDetailForVendor(${v.id})" title="클릭 → 오늘 발주 입력">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">
              <span style="font-size:10px;font-weight:700;color:#1f2937;white-space:nowrap;max-width:72px;overflow:hidden;text-overflow:ellipsis">${v.name}</span>
              <span style="font-size:8px;padding:0 3px;border-radius:4px;background:${taxTagBg};color:${taxTagColor};font-weight:700">${taxLabel}</span>
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
    <div id="ordersInsightPanel" style="background:white;border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,0.06);border:1px solid #e5e7eb;padding:12px 16px;margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;cursor:pointer" onclick="toggleInsightPanel()">
        <div style="display:flex;align-items:center;gap:6px">
          <i class="fas fa-chart-pie" style="color:#8b5cf6;font-size:14px"></i>
          <span style="font-size:13px;font-weight:700;color:#1f2937">발주 현황 인사이트</span>
        </div>
        <span id="insightPanelArrow" style="font-size:12px;color:#9ca3af">▼</span>
      </div>
      <div id="insightPanelBody">
        <!-- 3열 그리드: 월 예산 예측 + 식단가 현황 + 업체별 발주 비중 -->
        <div style="display:grid;grid-template-columns:1fr 1fr 2fr;gap:10px;align-items:start">
          <!-- 월 예산 초과 예측 -->
          <div id="budgetForecastCard" style="background:#fffbeb;border-radius:10px;border:1px solid #fde68a;padding:10px">
            <div style="font-size:10px;font-weight:700;color:#92400e;margin-bottom:6px;display:flex;align-items:center;gap:4px">
              <i class="fas fa-calculator" style="color:#f59e0b"></i> 월 예산 예측
            </div>
            <div id="budgetForecastContent">
              <div style="font-size:10px;color:#9ca3af">데이터 계산 중...</div>
            </div>
            <div id="budgetForecastWarn" style="display:none"></div>
          </div>
          <!-- 식단가 경고 -->
          <div id="dietPriceAlertCard" style="background:#f0fdf4;border-radius:10px;border:1px solid #bbf7d0;padding:10px">
            <div style="font-size:10px;font-weight:700;color:#166534;margin-bottom:6px;display:flex;align-items:center;gap:4px">
              <i class="fas fa-utensils" style="color:#10b981"></i> 식단가 현황
            </div>
            <div id="dietPriceAlertContent">
              <div style="font-size:10px;color:#9ca3af">데이터 계산 중...</div>
            </div>
          </div>
          <!-- 업체 발주 비중 (#7 개선: 도넛 + 상세 분석 패널) -->
          <div id="vendorShareCard" style="background:#eff6ff;border-radius:10px;border:1px solid #bfdbfe;padding:10px">
            <div style="font-size:10px;font-weight:700;color:#1d4ed8;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;gap:4px">
              <span><i class="fas fa-chart-pie" style="color:#3b82f6"></i> 업체별 발주 분석</span>
              <div style="display:flex;gap:4px;align-items:center">
                <button onclick="toggleVendorShareView('chart')" id="vsBtn_chart" style="font-size:9px;padding:1px 5px;border-radius:3px;border:1px solid #bfdbfe;background:#1d4ed8;color:white;cursor:pointer">차트</button>
                <button onclick="toggleVendorShareView('table')" id="vsBtn_table" style="font-size:9px;padding:1px 5px;border-radius:3px;border:1px solid #bfdbfe;background:white;color:#1d4ed8;cursor:pointer">목록</button>
              </div>
            </div>
            <!-- 차트 뷰 -->
            <div id="vendorShareChartView">
              <div style="position:relative;height:110px;display:flex;align-items:center;justify-content:center">
                <canvas id="vendorShareDonut" width="110" height="110"></canvas>
              </div>
              <div id="vendorShareLegend" style="margin-top:6px"></div>
            </div>
            <!-- 테이블 뷰 (숨김) -->
            <div id="vendorShareTableView" style="display:none">
              <div id="vendorShareContent">
                <div style="font-size:10px;color:#9ca3af">데이터 계산 중...</div>
              </div>
            </div>
            <div id="vendorBiasAlert" style="display:none"></div>
            <!-- TOP3/5 집중도 요약 -->
            <div id="vendorTop3Summary" style="display:none;margin-top:6px;padding:5px 8px;background:#dbeafe;border-radius:6px;font-size:9px;color:#1d4ed8"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="orders-scroll-wrap" id="ordersScrollWrap" style="position:relative;padding-bottom:0">
      <!-- 모바일 스크롤 안내 -->
      <div class="scroll-hint">
        <i class="fas fa-arrows-left-right"></i>좌우로 스크롤하여 전체 발주 입력
      </div>
      <!-- 상단 가로 스크롤바 (데스크탑용 미러 - 테이블 위에 위치) -->
      <div id="orders-hscroll-top" style="overflow-x:auto;overflow-y:hidden;height:14px;border-bottom:1px solid #d1fae5;background:#f0fdf4;border-radius:4px 4px 0 0">
        <div id="orders-hscroll-top-inner" style="height:1px"></div>
      </div>
      <!-- 가로 스크롤 컨테이너 -->
      <div id="ordersTableScroller" style="overflow-x:auto;overflow-y:visible;width:100%;max-width:100%;-webkit-overflow-scrolling:touch;scroll-behavior:smooth">
      <table class="order-table" id="ordersTable" style="table-layout:auto;border-collapse:collapse;width:100%;min-width:max-content">
        <thead style="position:sticky;top:0;z-index:20">
          <tr>
            <th class="sticky left-0 z-30 bg-gray-800" style="width:30px;min-width:30px;padding:5px 3px;font-size:12px;font-weight:700">일</th>
            <th class="sticky z-30 bg-gray-800" style="width:24px;min-width:24px;left:30px;padding:5px 3px;font-size:12px;font-weight:700">요</th>
            <th class="sticky z-30 bg-gray-800" style="width:56px;min-width:56px;left:54px;font-size:10px;font-weight:600;padding:5px 3px" title="몇 일분 발주인지 선택합니다. 예: 2일 선택 시 일 목표금액×2 기준으로 진행률 계산">몇일분<br><span style="font-size:9px;opacity:0.85;font-weight:500">발주</span></th>
            ${patientCats.map((cat, ci) => {
              const catColor = getCategoryColorHex(cat.category_key)
              const bl = ci === 0 ? 'border-left:3px solid #334155;' : 'border-left:2px solid #475569;'
              const thMinW = patientCats.length <= 1 ? 72 : 82
              return `<th style="${bl}min-width:${thMinW}px;background:${catColor}cc;font-size:12px;font-weight:700;padding:6px 5px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.25);line-height:1.4">${cat.category_name}<br><span style="font-size:10px;opacity:0.9;font-weight:600;background:rgba(0,0,0,0.12);padding:1px 5px;border-radius:8px">합계</span></th>`
            }).join('')}
            ${patientCats.length === 0 ? `<th style="min-width:80px;background:#166534;border-left:3px solid #334155;font-size:12px;font-weight:700">일합계</th>` : ''}
            <th class="sticky z-30" style="min-width:84px;background:#1e3a5f;left:110px;padding:5px 4px;font-size:12px;font-weight:700;line-height:1.4">합계<br><span style="font-size:10px;opacity:0.85;font-weight:500">/ 진행률</span></th>
            <th class="sticky-right-btn" style="min-width:68px;background:#374151;font-size:11px;font-weight:600;padding:5px 3px;box-shadow:-2px 0 6px rgba(0,0,0,0.18);line-height:1.5">업체별<br><span style="font-size:9px;opacity:0.8;font-weight:500">입력</span></th>
          </tr>
        </thead>
        <tbody id="ordersTbody">
          <tr><td colspan="99" class="text-center py-8 text-gray-400" style="font-size:13px"><div class="loading-spinner" style="display:inline-block;margin-right:8px"></div>발주 데이터 로딩 중...</td></tr>
        </tbody>
        <tfoot id="ordersTfoot"></tfoot>
      </table>
      </div>
      <!-- 하단 가로 스크롤바 (데스크탑용 미러) -->
      <div id="orders-hscroll-bar" style="overflow-x:auto;overflow-y:hidden;height:14px;border-top:1px solid #e5e7eb;background:#f9fafb;border-radius:0 0 4px 4px">
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
  const weekStartStr = weekStartStr2
  const weekEndStr = weekEndStr2
  window._ordersBudget = { totalBudget, dailyBudget, weekBudget, todayStr, weekStart, weekEnd, weekStartStr, weekEndStr, vendorDailyBudgets: vendorDailyBudgets2, vendorWeeklyBudgets: Object.fromEntries(Object.entries(vendorDailyBudgets2).map(([k,v])=>[k,v*(curWeekData?.wDays||5)])), workingDays, weeklyData }
  window._ordersData = orderData || []
  window._catDailyOrders = catOrderData?.dailyByVendorCat || []
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
    // 전체 설정의 working_days (일 목표 계산 기준)
    const _globalWorkingDays = window._ordersBudget?.workingDays || 0

    // ── 카테고리 수에 따른 컬럼 폭 동적 계산 ──
    // 카테고리 1개: 컬럼 폭 축소 (합계·업체별 버튼이 기본 화면에 보이도록)
    // 카테고리 2개+: 기존 폭 유지
    const numCats = patientCats.length
    const catColW = numCats <= 1 ? 72 : 82   // 1개: 72px, 2개+: 82px
    const catMinW = numCats <= 1 ? 68 : 76   // td min-width (요약행/주차행)

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

      const dateObjL = localDate(dateStr)
      const thisMon = new Date(dateObjL)
      thisMon.setDate(dateObjL.getDate() - (dateObjL.getDay()===0 ? 6 : dateObjL.getDay()-1))
      const thisSun = new Date(thisMon); thisSun.setDate(thisMon.getDate()+6)
      const weekKey = toDateStr(thisMon)
      const weekEndKey = toDateStr(thisSun)

      // ── 주간 요약 행 ──
      if (!renderedWeeks.has(weekKey)) {
        renderedWeeks.add(weekKey)
        weekNumber++
        const hasCatsForWeek = patientCats.length > 0
        // 해당 주차의 실제 일수 계산 (월 경계 처리: 이번 달 날짜만 카운트)
        let wDaysInMonth = 0
        for (let x = 1; x <= days; x++) {
          const xs = `${App.currentYear}-${String(App.currentMonth).padStart(2,'0')}-${String(x).padStart(2,'0')}`
          if (xs >= weekKey && xs <= weekEndKey) wDaysInMonth++
        }
        // 해당 주차 예산 = 이번 달 내 실제 일수 × 일 예산
        const thisWeekBudget = dailyBudget > 0 ? dailyBudget * wDaysInMonth : weekBudget
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
        const wPct = thisWeekBudget>0 ? Math.round(wTotal/thisWeekBudget*100) : null
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
          return `<td style="${bl}background:${isCurrentWeek?'#ede9fe20':'#f5f3ff15'};padding:3px 4px;text-align:center;vertical-align:middle;min-width:${catMinW}px">
            <div style="font-size:10px;font-weight:700;color:${catAmt>0?catColor:'#d1d5db'}">${catAmt>0?fmtMan(catAmt):'-'}</div>
          </td>`
        }).join('')

        // 카테고리 없을 때 일합계 열 (비어있는 주간행)
        const weekNoCatCell = patientCats.length === 0 ? `<td style="background:${wBg};padding:3px 4px"></td>` : ''

        // colspan 계산: 날짜(1) + 요일(1) + 일수(1) = 3
        rows.push(`<tr class="week-summary-row${isCurrentWeek?' current-week-row':''}" data-week-key="${weekKey}" data-week-num="${weekNumber}" style="background:${wBg};border-top:${wBW} ${wBS} ${wBorderColor};border-bottom:${wBW} ${wBS} ${wBorderColor};">
          <td colspan="3" class="sticky left-0" id="weekPctCell-${weekKey}" data-week-num="${weekNumber}" data-week-is-current="${isCurrentWeek?'1':'0'}" data-week-label="${wLabel}" data-week-budget="${thisWeekBudget}" data-week-days="${wDaysInMonth}" style="background:${wBg};padding:3px 5px;min-width:110px;border-right:3px solid ${wBorderColor};">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:3px">
              <div style="display:inline-flex;align-items:center;background:${wBadgeBg};color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:9px;white-space:nowrap">${weekNumber}주${isCurrentWeek?'(현재)':''}</div>
              <span style="font-size:${isCurrentWeek?'13px':'12px'};font-weight:800;color:${wColor};white-space:nowrap">${wPct!==null?wPct+'%':'-'}${wOver?' 🚨':wWarn?' ⚠️':''}</span>
            </div>
            <div style="font-size:8px;color:#6b7280;margin-top:1px;white-space:nowrap">${wLabel}<span style="color:#9ca3af;margin-left:3px">(${wDaysInMonth}일)</span></div>
            <div style="font-size:9px;font-weight:700;color:${wColor};white-space:nowrap">${fmtMan(wTotal)}<span style="color:#9ca3af;font-size:8px;font-weight:400"> /${fmtMan(thisWeekBudget)}</span></div>
            ${wPctBar}
          </td>
          ${weekCatCells}
          ${weekNoCatCell}
          <td style="background:${wBg};padding:3px 4px;text-align:center;min-width:80px"><div style="font-size:11px;font-weight:700;color:${wColor}">${wTotal>0?fmtMan(wTotal):'-'}</div><div style="font-size:9px;color:${wColor};font-weight:600">${wPct!==null?wPct+'%':''}</div></td>
          <td class="sticky-right-btn" style="background:${wBg};text-align:center;vertical-align:middle;padding:2px"><div style="font-size:9px;font-weight:700;color:${wBadgeBg};opacity:0.8;white-space:nowrap">${weekNumber}\uc8fc</div></td>
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
        // 카테고리 working_days가 비정상(0 또는 과다)이면 전체 설정의 working_days 사용
        const catWD2 = (catSettings2.working_days > 0 && catSettings2.working_days <= 31) ? catSettings2.working_days : _globalWorkingDays
        const catDB = catWD2 > 0 ? Math.round((catSettings2.monthly_budget||0)/catWD2) : 0
        const catAdjBudget = isCovered ? 0 : catDB * multiDayCount
        const catPct = catAdjBudget > 0 ? Math.round(catAmt/catAdjBudget*100) : null
        const catOver = catPct!==null&&catPct>=100; const catWarn = catPct!==null&&catPct>=80&&!catOver
        const catAmtColor = catOver?'#dc2626':catWarn?'#d97706':(catAmt>0?catColor:'#9ca3af')
        const bl = ci === 0 ? `border-left:3px solid ${catColor}80;` : `border-left:2px solid ${catColor}40;`
        return `<td id="summCatAmt-${cat.id}-${dateStr}" style="${bl}${summaryBorderTop}padding:3px 4px;background:${catAmt>0?catColor+'12':summaryRowBg};text-align:center;vertical-align:middle;min-width:${catMinW}px;${pastOpacity}">
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
      const detailToggleBtn = hasCats ? `<button class="detail-toggle-btn" data-date="${dateStr}" data-hasamt="${displayTotal>0?'1':'0'}" onclick="toggleOrderDetail('${dateStr}')" style="border:none;background:${initBtnBg};color:${initBtnColor};border-radius:6px;padding:4px 7px;font-size:11px;cursor:pointer;white-space:nowrap;font-weight:700;display:flex;align-items:center;gap:3px;line-height:1.3" title="업체별 상세 발주 입력">
        <span class="detail-arrow" data-date="${dateStr}" style="font-size:10px">${initArrow}</span><span style="font-size:10px">업체별</span>
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
        <td class="sticky-right-btn" style="text-align:center;vertical-align:middle;${summaryBorderTop}background:white;padding:3px 2px;border-left:1px solid #e5e7eb;min-width:52px">
          ${hasCats ? detailToggleBtn : ''}
          ${!hasCats ? `<button class="detail-toggle-btn" data-date="${dateStr}" data-hasamt="${displayTotal>0?'1':'0'}" onclick="toggleOrderDetail('${dateStr}')" style="border:none;background:${displayTotal>0?'#2563eb':'#e5e7eb'};color:${displayTotal>0?'white':'#6b7280'};border-radius:6px;padding:4px 7px;font-size:11px;cursor:pointer;white-space:nowrap;font-weight:700;display:flex;align-items:center;gap:3px;line-height:1.3"><span class="detail-arrow" data-date="${dateStr}" style="font-size:10px">▼</span><span style="font-size:10px">업체별</span></button>` : ''}}
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
          // 카테고리 working_days가 비정상(0 또는 31 초과)이면 전체 설정값 사용
          const catWD2 = (catSettings2.working_days > 0 && catSettings2.working_days <= 31) ? catSettings2.working_days : _globalWorkingDays
          const catDB2 = catWD2 > 0 ? Math.round(catMonthBudget/catWD2) : 0
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
            const vCols = getVendorCols(v.tax_type, v.is_card_type)

            // 업체 일 누적 (이 카테고리) - dateStr 이하 날짜만 합산
            let vCatMonthAccum = 0
            if (v.is_card_type) {
              // 법인카드형 업체: _cardDailyMap 에서 dateStr 이하 날짜 합계
              const vendorCardMap = window._cardDailyMap?.[v.id] || {}
              Object.entries(vendorCardMap).forEach(([dk, amt]) => { if (dk <= dateStr) vCatMonthAccum += amt || 0 })
            } else {
              Object.keys(catDailyMap).forEach(dk => {
                if (dk > dateStr) return
                const r2 = (catDailyMap[dk]?.[v.id]?.[cat.id]) || {}
                vCatMonthAccum += r2.total || 0
              })
            }
            const vRemain = catMonthBudget > 0 ? Math.round(catMonthBudget / vendors.length) - vCatMonthAccum : null
            const taxLabel = v.is_card_type ? '법인카드' : (v.tax_type==='mixed'?'과+면':v.tax_type==='taxable'?'과세':v.tax_type==='mixed_total'?'합산':'면세')
            const taxBg = v.is_card_type ? '#f3e8ff' : (v.tax_type==='mixed'?'#dbeafe':v.tax_type==='taxable'?'#dcfce7':v.tax_type==='mixed_total'?'#f3e8ff':'#fef9c3')
            const taxColor = v.is_card_type ? '#7c3aed' : (v.tax_type==='mixed'?'#1d4ed8':v.tax_type==='taxable'?'#166534':v.tax_type==='mixed_total'?'#7c3aed':'#92400e')

            // 입력 필드
            let inputFields = ''
            if (v.is_card_type) {
              // 법인카드형 업체: 클릭 시 상세입력 모달
              const cardTotal = (window._cardDailyMap?.[v.id]?.[dateStr]) || total
              const cardCount = (window._cardDailyCountMap?.[v.id]?.[dateStr]) || 0
              const hasCardData = cardTotal > 0
              const subtypeLabel = {food:'식재료',supplies:'소모품',online:'온라인',other:'기타'}[v.card_subtype||'food']||''
              inputFields = `
                <div style="margin-top:4px">
                  <button class="card-expense-btn w-full text-left rounded-lg border transition-all"
                    data-vendor="${v.id}" data-date="${dateStr}"
                    style="width:100%;padding:5px 7px;font-size:11px;cursor:pointer;text-align:left;${hasCardData
                      ? 'background:#f5f3ff;border:1.5px solid #8b5cf6;color:#6d28d9;'
                      : 'background:#faf5ff;border:1.5px dashed #c4b5fd;color:#a78bfa;'}"
                    onclick="openCardExpenseModal(${v.id},'${dateStr}')">
                    <div style="font-size:8px;color:#8b5cf6;font-weight:600;margin-bottom:2px">${subtypeLabel}</div>
                    ${hasCardData
                      ? `<div style="font-weight:700;font-size:12px">${cardTotal.toLocaleString()}</div><div style="font-size:9px;color:#7c3aed">${cardCount}건 입력됨</div>`
                      : `<div style="font-size:11px"><i class="fas fa-plus-circle" style="font-size:9px"></i> 상세입력</div>`}
                  </button>
                </div>`
            } else if (vCols === 3) {
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
            } else if (v.tax_type === 'mixed_total') {
              // 합산입력: 총액 1칸
              inputFields = `
                <div style="margin-top:4px">
                  <div style="font-size:8px;color:#9ca3af;margin-bottom:1px">총액 (과+면 합산)</div>
                  <input type="text" inputmode="numeric" pattern="[0-9,]*" class="cat-order-input" style="width:100%;font-size:11px;text-align:right;padding:3px 4px;border:1.5px solid ${catColor}60;border-radius:4px;background:${total>0?catColor+'15':'white'}" data-category="${cat.id}" data-vendor="${v.id}" data-field="total" data-date="${dateStr}" value="${total>0?fmt(total):''}" placeholder="0">
                </div>`
            } else {
              inputFields = `
                <div style="margin-top:4px">
                  <div style="font-size:8px;color:#9ca3af;margin-bottom:1px">금액</div>
                  <input type="text" inputmode="numeric" pattern="[0-9,]*" class="cat-order-input" style="width:100%;font-size:11px;text-align:right;padding:3px 4px;border:1.5px solid ${catColor}60;border-radius:4px;background:${total>0?catColor+'15':'white'}" data-category="${cat.id}" data-vendor="${v.id}" data-field="total" data-date="${dateStr}" value="${total>0?fmt(total):''}" placeholder="0">
                </div>`
            }

            // 업체 일 목표: v.monthly_budget ÷ 전체 working_days (설정 기준)
            // v.monthly_budget 우선, 없으면 카테고리 예산 균등 배분 → 일별 목표로 변환
            const vRawMonthBudget = (v.monthly_budget > 0) ? v.monthly_budget : (catMonthBudget > 0 ? Math.round(catMonthBudget / vendors.length) : 0)
            const vMonthBudget = _globalWorkingDays > 0 ? Math.round(vRawMonthBudget / _globalWorkingDays) : 0
            const vMonthPct = vMonthBudget > 0 ? Math.round(vCatMonthAccum / vMonthBudget * 100) : null
            const vMonthOver = vMonthPct!==null&&vMonthPct>=100
            const vMonthWarn = vMonthPct!==null&&vMonthPct>=80&&!vMonthOver
            const vMonthColor = vMonthOver?'#dc2626':vMonthWarn?'#d97706':catColor
            const vRemainAmt = vMonthBudget > 0 ? vMonthBudget - vCatMonthAccum : null

            return `<div id="vendor-card-${v.id}-${cat.id}-${dateStr}" style="background:white;border-radius:8px;border:1.5px solid ${total>0?catColor+'80':'#e5e7eb'};padding:8px 10px;min-width:${numCats<=1?120:140}px;flex:1">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
                <span style="font-size:11px;font-weight:700;color:#1f2937;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:90px">${v.name}</span>
                <span style="font-size:8px;padding:1px 4px;border-radius:4px;background:${taxBg};color:${taxColor};font-weight:700">${taxLabel}</span>
              </div>
              ${inputFields}
              <div style="margin-top:6px;padding-top:5px;border-top:1px solid #f3f4f6">
                <div style="display:flex;justify-content:space-between;font-size:9px;color:#6b7280;margin-bottom:2px">
                  <span>일 누적</span>
                  <span id="vcat-month-accum-${v.id}-${cat.id}" style="font-weight:700;color:${vMonthColor}">${vCatMonthAccum>0?fmtMan(vCatMonthAccum):'0'}</span>
                </div>
                ${vMonthBudget > 0 ? `
                <div style="display:flex;justify-content:space-between;font-size:9px;color:#9ca3af;margin-bottom:3px">
                  <span>일 목표</span>
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
    // 카테고리 수에 따른 컬럼 폭 (tbody와 동일 기준)
    const numCatsFoot = patientCats.length
    const catMinWFoot = numCatsFoot <= 1 ? 68 : 76

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
        return `<td style="${bl}text-align:center;padding:3px 4px;min-width:${catMinWFoot}px;background:${catAmt>0?catColor+'10':''}"><div style="font-size:10px;font-weight:700;color:${catAmt>0?catColor:'#9ca3af'}">${catAmt>0?fmtMan(catAmt):'-'}</div></td>`
      }).join('') : `<td class="text-center bg-gray-100 py-1" id="vfoot-month-pct" style="color:${monthPct>=100?'#dc2626':monthPct>=80?'#d97706':'#16a34a'};font-weight:700;font-size:10px">${monthPct}%<div style="font-size:8px;color:#6b7280;font-weight:400">${fmtMan(totalBudget)}</div></td>`}
      <td class="text-center sticky bg-gray-100" id="vfoot-month-total" style="left:110px;font-size:11px;min-width:80px;font-weight:700;color:${monthPct>=100?'#dc2626':monthPct>=80?'#d97706':'#16a34a'}">${fmtMan(monthTotal)}<div style="font-size:9px;font-weight:600">${monthPct}%</div></td>
      <td class="sticky-right-btn" style="background:#f3f4f6;text-align:center;padding:3px 2px;font-size:9px;color:#6b7280;font-weight:600">월간<br>상세</td>
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
  const firstDetailRow = detailRows[0]

  // #10 버그 수정: 탭 전환 후 요양→항암 display:none 상태에서도
  // "하나라도 보이면 열린 상태"로 판단 (첫 번째 행만 체크하면 오탐)
  const isOpen = Array.from(detailRows).some(row => row.style.display !== 'none')

  if (isOpen) {
    // 닫기: 모든 상세 행 숨기기
    detailRows.forEach(row => { row.style.display = 'none' })
  } else {
    // 열기: 현재 활성 탭 인덱스를 유지하면서 해당 탭 행만 표시
    // 활성 탭 인덱스: 마지막으로 클릭된 탭(data-active-tab) 또는 0
    const activeTabIdx = parseInt(
      document.querySelector(`.order-detail-row.cat-tab-row[data-date="${dateStr}"]`)
        ?.closest('tbody')
        ?.querySelector(`tr[data-date="${dateStr}"][data-active-tab]`)
        ?.dataset?.activeTab ?? '0'
    )
    detailRows.forEach(row => {
      const tabIdx = row.dataset.tabIndex
      if (tabIdx === undefined) {
        row.style.display = ''  // 비탭 구조
      } else {
        // 활성 탭 인덱스에 맞는 행만 표시
        row.style.display = parseInt(tabIdx) === activeTabIdx ? '' : 'none'
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

  // #10 버그 수정: 활성 탭 인덱스를 tr 행에 data-active-tab 속성으로 저장
  // toggleOrderDetail이 이 값을 읽어 올바른 탭 행만 표시하도록 함
  detailRows.forEach(row => {
    row.dataset.activeTab = String(tabIndex)
  })

  // 탭 버튼 스타일 업데이트 (활성/비활성)
  const tabBtns = document.querySelectorAll(`[data-date="${dateStr}"] .cat-tab-btn, span[onclick*="switchOrderDetailTab('${dateStr}'"]`)
  tabBtns.forEach(btn => {
    const btnIdx = parseInt(btn.dataset?.tabIdx ?? btn.getAttribute('onclick')?.match(/,(\d+)\)/)?.[1] ?? '-1')
    if (btnIdx === -1) return
    // 탭 버튼 스타일 처리는 HTML에서 동적으로 생성되므로 건너뜀
  })

  // 탭 전환 후 첫 입력에 포커스
  const activeRow = document.querySelector(`.order-detail-row.cat-tab-row[data-date="${dateStr}"][data-tab-index="${tabIndex}"]`)
  if (activeRow) {
    const inp = activeRow.querySelector('input.cat-order-input')
    if (inp) setTimeout(() => inp.focus(), 80)
  }
  setTimeout(() => setupOrdersScrollSync(), 50)
}

// ── 발주 테이블 스크롤 3방향 동기화 ─────────────────────────────
// 상단 스크롤바 ↔ 테이블 스크롤러 ↔ 하단 스크롤바 모두 연동
function setupOrdersScrollSync() {
  requestAnimationFrame(() => {
    const scroller = document.getElementById('ordersTableScroller')
    const table    = document.getElementById('ordersTable')
    const topBar   = document.getElementById('orders-hscroll-top')
    const topInner = document.getElementById('orders-hscroll-top-inner')
    const botBar   = document.getElementById('orders-hscroll-bar')
    const botInner = document.getElementById('orders-hscroll-inner')
    if (!scroller || !table) return

    const isMobile = window.innerWidth <= 768

    // inner 너비를 테이블 실제 너비로 맞춤
    const syncWidth = () => {
      const w = table.scrollWidth + 'px'
      if (topInner) topInner.style.width = w
      if (botInner) botInner.style.width = w
    }
    syncWidth()

    if (isMobile) {
      // 모바일: CSS media query로 두 스크롤바 모두 숨김
      return
    }

    // ── 3방향 동기화 (이벤트 중복 방지: cloneNode로 기존 리스너 제거) ──
    const newTop = topBar ? topBar.cloneNode(true) : null
    const newBot = botBar ? botBar.cloneNode(true) : null
    if (newTop) topBar.parentNode.replaceChild(newTop, topBar)
    if (newBot) botBar.parentNode.replaceChild(newBot, botBar)

    const tBar   = newTop || document.getElementById('orders-hscroll-top')
    const bBar   = newBot || document.getElementById('orders-hscroll-bar')
    const tInner = tBar?.firstElementChild
    const bInner = bBar?.firstElementChild

    // inner 너비 재초기화 (cloneNode 후)
    const w = table.scrollWidth + 'px'
    if (tInner) tInner.style.width = w
    if (bInner) bInner.style.width = w

    let lock = null  // 현재 scroll 이벤트 주체: 'top' | 'bot' | 'scroller'

    const onTopScroll = () => {
      if (lock && lock !== 'top') return
      lock = 'top'
      scroller.scrollLeft = tBar.scrollLeft
      if (bBar) bBar.scrollLeft = tBar.scrollLeft
      requestAnimationFrame(() => { lock = null })
    }
    const onBotScroll = () => {
      if (lock && lock !== 'bot') return
      lock = 'bot'
      scroller.scrollLeft = bBar.scrollLeft
      if (tBar) tBar.scrollLeft = bBar.scrollLeft
      requestAnimationFrame(() => { lock = null })
    }
    const onTableScroll = () => {
      if (lock && lock !== 'scroller') return
      lock = 'scroller'
      if (tBar) tBar.scrollLeft = scroller.scrollLeft
      if (bBar) bBar.scrollLeft = scroller.scrollLeft
      const ww = table.scrollWidth + 'px'
      if (tInner) tInner.style.width = ww
      if (bInner) bInner.style.width = ww
      requestAnimationFrame(() => { lock = null })
    }

    if (tBar) tBar.addEventListener('scroll', onTopScroll)
    if (bBar) bBar.addEventListener('scroll', onBotScroll)
    scroller.addEventListener('scroll', onTableScroll)

    // ResizeObserver: 테이블 너비 변경(열 추가/접기 등) + zoom 대응
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        const ww = table.scrollWidth + 'px'
        if (tInner) tInner.style.width = ww
        if (bInner) bInner.style.width = ww
        if (scroller) scroller.style.maxWidth = '100%'
      })
      ro.observe(table)
      ro.observe(scroller)
    }
  })
}

// ── 발주 전체 수동 저장 ────────────────────────────────────────
window.saveAllOrders = async () => {
  // 마감 완료 달 읽기전용 체크
  if (isReadOnly(App.currentYear, App.currentMonth)) {
    showToast('⛔ 마감 완료된 달은 수정할 수 없습니다.', 'error'); return
  }
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

// ── #2 월 전체 발주 확인 모달 ────────────────────────────────────
window.showMonthAllOrdersModal = function() {
  const vendors = window._vendorsCache || []
  const patientCats = window._patientCats || []
  // 실제 카테고리별 발주 데이터 (_catDailyOrders) 사용
  const catDailyOrders = window._catDailyOrders || []
  const orderData = window._ordersData || []
  const year = App.currentYear
  const month = App.currentMonth
  const daysInMonth = new Date(year, month, 0).getDate()
  const mm = String(month).padStart(2,'0')

  // 날짜 목록
  const days = []
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${mm}-${String(d).padStart(2,'0')}`
    const dayOfWeek = new Date(dateStr).getDay()
    const dow = ['일','월','화','수','목','금','토'][dayOfWeek]
    days.push({ dateStr, d, dow, isWeekend: dayOfWeek === 0 || dayOfWeek === 6 })
  }

  // 발주 맵 구성
  const normalOrderMap = {}
  ;(orderData || []).forEach(o => {
    const k = `${o.order_date}__${o.vendor_id}`
    normalOrderMap[k] = o
  })
  // 카테고리 발주 맵: patient_category_id 기반
  const catOrderMap = {}
  ;(catDailyOrders || []).forEach(s => {
    const key = `${s.order_date}__${s.patient_category_id}__${s.vendor_id}`
    catOrderMap[key] = s
  })

  // 환자군 유무 판단
  const hasCats = patientCats && patientCats.length > 0

  // ── 컬럼 정의 (업체별 과세/면세/부가세/합계 서브컬럼) ──
  // 컬럼 구조: { catName, vendorId, vendorName, taxType, subType }
  // subType: 'taxable'|'exempt'|'vat'|'total'|'mixed_total'
  const columns = []

  if (hasCats) {
    patientCats.forEach(cat => {
      vendors.forEach(v => {
        if (v.tax_type === 'mixed_total') {
          columns.push({ catName: cat.name, catId: cat.id, vendorId: v.id, vendorName: v.name, taxType: v.tax_type, subType: 'mixed_total' })
        } else if (v.tax_type === 'taxable') {
          columns.push({ catName: cat.name, catId: cat.id, vendorId: v.id, vendorName: v.name, taxType: v.tax_type, subType: 'taxable' })
          columns.push({ catName: cat.name, catId: cat.id, vendorId: v.id, vendorName: v.name, taxType: v.tax_type, subType: 'vat' })
        } else if (v.tax_type === 'exempt') {
          columns.push({ catName: cat.name, catId: cat.id, vendorId: v.id, vendorName: v.name, taxType: v.tax_type, subType: 'exempt' })
        } else { // mixed
          columns.push({ catName: cat.name, catId: cat.id, vendorId: v.id, vendorName: v.name, taxType: v.tax_type, subType: 'taxable' })
          columns.push({ catName: cat.name, catId: cat.id, vendorId: v.id, vendorName: v.name, taxType: v.tax_type, subType: 'exempt' })
          columns.push({ catName: cat.name, catId: cat.id, vendorId: v.id, vendorName: v.name, taxType: v.tax_type, subType: 'vat' })
        }
      })
    })
  } else {
    vendors.forEach(v => {
      if (v.tax_type === 'mixed_total') {
        columns.push({ catName: null, catId: null, vendorId: v.id, vendorName: v.name, taxType: v.tax_type, subType: 'mixed_total' })
      } else if (v.tax_type === 'taxable') {
        columns.push({ catName: null, catId: null, vendorId: v.id, vendorName: v.name, taxType: v.tax_type, subType: 'taxable' })
        columns.push({ catName: null, catId: null, vendorId: v.id, vendorName: v.name, taxType: v.tax_type, subType: 'vat' })
      } else if (v.tax_type === 'exempt') {
        columns.push({ catName: null, catId: null, vendorId: v.id, vendorName: v.name, taxType: v.tax_type, subType: 'exempt' })
      } else { // mixed
        columns.push({ catName: null, catId: null, vendorId: v.id, vendorName: v.name, taxType: v.tax_type, subType: 'taxable' })
        columns.push({ catName: null, catId: null, vendorId: v.id, vendorName: v.name, taxType: v.tax_type, subType: 'exempt' })
        columns.push({ catName: null, catId: null, vendorId: v.id, vendorName: v.name, taxType: v.tax_type, subType: 'vat' })
      }
    })
  }

  // 셀값 추출 함수
  function getCellValue(col, dateStr) {
    if (col.catId) {
      const k = `${dateStr}__${col.catId}__${col.vendorId}`
      const s = catOrderMap[k]
      if (!s) return 0
      // dailyByVendorCat API 응답: taxable, exempt, vat, total 필드 사용
      const taxable = s.taxable || s.taxable_amount || 0
      const exempt = s.exempt || s.exempt_amount || 0
      const vat = s.vat != null ? s.vat : (s.vat_amount != null ? s.vat_amount : Math.round(taxable * 0.1))
      const total = s.total || s.total_amount || (taxable + exempt + vat)
      if (col.subType === 'taxable') return taxable
      if (col.subType === 'exempt') return exempt
      if (col.subType === 'vat') return vat
      if (col.subType === 'mixed_total') return total
      return 0
    } else {
      const k = `${dateStr}__${col.vendorId}`
      const o = normalOrderMap[k]
      if (!o) return 0
      if (col.subType === 'taxable') return o.taxable_amount || 0
      if (col.subType === 'exempt') return o.exempt_amount || 0
      if (col.subType === 'vat') return o.vat_amount || 0
      if (col.subType === 'mixed_total') return o.total_amount || 0
      return 0
    }
  }

  // 컬럼 합계
  const colTotals = columns.map(() => 0)

  // 서브타입 라벨/색
  const subLabel = { taxable:'과세', exempt:'면세', vat:'부가세', mixed_total:'합계' }
  const subColor = { taxable:'#16a34a', exempt:'#d97706', vat:'#6b7280', mixed_total:'#1d4ed8' }
  const subBg    = { taxable:'#f0fdf4', exempt:'#fffbeb', vat:'#f9fafb', mixed_total:'#eff6ff' }

  // ── 그룹 헤더 (업체명 colspan) 빌드 ──
  // vendor별 컬럼 수 계산
  function vendorColSpan(v) {
    if (v.tax_type==='mixed_total') return 1
    if (v.tax_type==='taxable')  return 2
    if (v.tax_type==='exempt')   return 1
    return 3 // mixed
  }

  let groupHeaderHtml = ''
  if (hasCats) {
    patientCats.forEach(cat => {
      vendors.forEach(v => {
        const span = vendorColSpan(v)
        groupHeaderHtml += `<th colspan="${span}" style="text-align:center;padding:4px 4px;font-size:10px;border-left:2px solid #e5e7eb;background:#f8fafc;white-space:nowrap">
          <div style="font-size:9px;color:#7c3aed;font-weight:600">${cat.name}</div>
          <div style="font-weight:700;color:#1f2937">${v.name}</div>
        </th>`
      })
    })
  } else {
    vendors.forEach(v => {
      const span = vendorColSpan(v)
      groupHeaderHtml += `<th colspan="${span}" style="text-align:center;padding:5px 4px;font-size:11px;border-left:2px solid #e5e7eb;background:#f8fafc;white-space:nowrap;font-weight:700;color:#1f2937">${v.name}</th>`
    })
  }

  // 서브헤더 (과세/면세/부가세/합계)
  let subHeaderHtml = ''
  columns.forEach((col, ci) => {
    const isFirst = ci === 0 || columns[ci-1].vendorId !== col.vendorId || columns[ci-1].catId !== col.catId
    subHeaderHtml += `<th style="text-align:right;padding:4px 5px;font-size:10px;white-space:nowrap;${isFirst?'border-left:2px solid #e5e7eb':'border-left:1px solid #f0f0f0'};background:${subBg[col.subType]};color:${subColor[col.subType]};font-weight:600">
      ${subLabel[col.subType]}
    </th>`
  })

  // 행 생성
  let tbody = ''
  let grandTotal = 0

  days.forEach(({ dateStr, d, dow, isWeekend }) => {
    let rowTotal = 0
    let cells = ''
    columns.forEach((col, ci) => {
      const v = getCellValue(col, dateStr)
      colTotals[ci] += v
      rowTotal += (col.subType === 'vat' || col.subType === 'taxable' || col.subType === 'exempt' || col.subType === 'mixed_total') && col.subType !== 'vat' && col.subType !== 'taxable' ? 0 : 0
      // 일 합계에는 total/mixed_total만 포함 (과세+부가세중복 방지)
      if (col.subType === 'mixed_total') rowTotal += v
      else if (col.subType === 'exempt') rowTotal += v
      else if (col.subType === 'taxable') rowTotal += v
      // vat는 taxable에 포함되므로 따로 합산 안 함 (하지만 표시는 함)

      const isFirst = ci === 0 || columns[ci-1].vendorId !== col.vendorId || columns[ci-1].catId !== col.catId
      cells += `<td style="text-align:right;padding:3px 5px;font-size:11px;${isFirst?'border-left:2px solid #e5e7eb':'border-left:1px solid #f0f0f0'};${v>0?`color:${subColor[col.subType]};font-weight:600`:'color:#e5e7eb'}">${v>0?v.toLocaleString():'-'}</td>`
    })
    // 실제 일 합계: 업체별 total 합산
    rowTotal = 0
    if (hasCats) {
      vendors.forEach(v => {
        patientCats.forEach(cat => {
          const k = `${dateStr}__${cat.id}__${v.id}`
          const s = catOrderMap[k]
          if (s) {
            // dailyByVendorCat API 응답: total, taxable, exempt, vat 필드
            rowTotal += s.total || s.total_amount || 0
          }
        })
      })
    } else {
      vendors.forEach(v => {
        const k = `${dateStr}__${v.id}`
        const o = normalOrderMap[k]
        if (o) rowTotal += o.total_amount || 0
      })
    }
    grandTotal += rowTotal

    const rowBg = isWeekend ? '#fafafa' : 'white'
    const dowColor = dow==='일'?'#dc2626':dow==='토'?'#2563eb':'#374151'
    tbody += `<tr style="background:${rowBg};border-bottom:1px solid #f3f4f6">
      <td style="padding:4px 8px;font-size:11px;font-weight:700;white-space:nowrap;position:sticky;left:0;background:${rowBg};z-index:1;border-right:1px solid #e5e7eb">
        <span style="color:${dowColor}">${d}일(${dow})</span>
      </td>
      ${cells}
      <td style="text-align:right;padding:4px 8px;font-size:11px;font-weight:800;color:${rowTotal>0?'#1d4ed8':'#d1d5db'};white-space:nowrap;position:sticky;right:0;background:${rowBg};border-left:2px solid #bfdbfe">${rowTotal>0?rowTotal.toLocaleString():'-'}</td>
    </tr>`
  })

  // 합계 행
  let totalCells = ''
  columns.forEach((col, ci) => {
    const t = colTotals[ci]
    const isFirst = ci === 0 || columns[ci-1].vendorId !== col.vendorId || columns[ci-1].catId !== col.catId
    totalCells += `<td style="text-align:right;padding:5px 5px;font-size:11px;font-weight:700;color:${t>0?subColor[col.subType]:'#9ca3af'};${isFirst?'border-left:2px solid #bfdbfe':'border-left:1px solid #dbeafe'}">${t>0?t.toLocaleString():'-'}</td>`
  })

  // ── 모달 생성 ──
  const existing = document.getElementById('monthAllOrdersModal')
  if (existing) existing.remove()

  const modal = document.createElement('div')
  modal.id = 'monthAllOrdersModal'
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.55);display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto'
  modal.innerHTML = `
    <div style="background:white;border-radius:16px;width:100%;max-width:1200px;box-shadow:0 20px 60px rgba(0,0,0,0.3);margin:auto">
      <!-- 헤더 -->
      <div style="padding:14px 20px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:white;border-radius:16px 16px 0 0;z-index:10">
        <div>
          <h2 style="font-weight:700;color:#1f2937;font-size:16px;margin:0"><i class="fas fa-table" style="color:#ea580c;margin-right:8px"></i>${year}년 ${mm}월 전체 발주 현황</h2>
          <p style="font-size:12px;color:#6b7280;margin:3px 0 0">월 합계: <strong style="color:#1d4ed8">${grandTotal.toLocaleString()}원</strong> · ${columns.length}개 컬럼 · ${vendors.length}개 업체</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button onclick="downloadOrdersExcel()" style="background:#16a34a;color:white;border:none;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:5px">
            <i class="fas fa-file-excel"></i>엑셀 다운로드
          </button>
          <button onclick="document.getElementById('monthAllOrdersModal').remove()" style="background:#f3f4f6;color:#374151;border:none;border-radius:8px;padding:7px 12px;font-size:14px;cursor:pointer;font-weight:700">✕</button>
        </div>
      </div>
      <!-- 범례 -->
      <div style="padding:8px 16px;background:#f8fafc;border-bottom:1px solid #e5e7eb;display:flex;gap:12px;flex-wrap:wrap;font-size:10px">
        <span style="color:#16a34a;font-weight:600">■ 과세</span>
        <span style="color:#d97706;font-weight:600">■ 면세</span>
        <span style="color:#6b7280;font-weight:600">■ 부가세</span>
        <span style="color:#1d4ed8;font-weight:600">■ 합계(합산)</span>
        ${hasCats ? patientCats.map(c=>`<span style="color:#7c3aed;font-weight:600">● ${c.name}</span>`).join('') : ''}
      </div>
      <!-- 테이블 -->
      <div style="overflow:auto;max-height:68vh">
        <table style="width:100%;border-collapse:collapse;min-width:400px;font-size:12px">
          <thead style="position:sticky;top:0;z-index:5">
            <!-- 업체명 그룹 헤더 -->
            <tr style="background:#f0f4ff;border-bottom:1px solid #e5e7eb">
              <th style="padding:6px 8px;text-align:left;position:sticky;left:0;background:#f0f4ff;z-index:6;font-size:11px;white-space:nowrap;border-right:1px solid #e5e7eb">날짜</th>
              ${groupHeaderHtml}
              <th style="padding:6px 8px;text-align:right;position:sticky;right:0;background:#e0e7ff;z-index:6;border-left:2px solid #bfdbfe;white-space:nowrap;font-size:11px">일 합계</th>
            </tr>
            <!-- 과세/면세/부가세 서브헤더 -->
            <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb">
              <th style="padding:4px 8px;text-align:left;position:sticky;left:0;background:#f9fafb;z-index:6;font-size:10px;border-right:1px solid #e5e7eb"></th>
              ${subHeaderHtml}
              <th style="padding:4px 8px;position:sticky;right:0;background:#eff6ff;z-index:6;border-left:2px solid #bfdbfe"></th>
            </tr>
          </thead>
          <tbody>${tbody}</tbody>
          <tfoot>
            <tr style="background:#eff6ff;border-top:2px solid #bfdbfe;font-weight:700">
              <td style="padding:6px 8px;font-size:12px;position:sticky;left:0;background:#eff6ff;z-index:1;border-right:1px solid #bfdbfe">합계</td>
              ${totalCells}
              <td style="text-align:right;padding:6px 8px;font-size:12px;font-weight:800;color:#1d4ed8;position:sticky;right:0;background:#dbeafe;border-left:2px solid #bfdbfe">${grandTotal.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove() })
  document.body.appendChild(modal)
}

// ── #2 발주 엑셀 다운로드 ────────────────────────────────────────
window.downloadOrdersExcel = async function() {
  if (typeof XLSX === 'undefined') {
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
    script.onload = () => { showToast('라이브러리 로드 완료. 다시 클릭해주세요.', 'info') }
    document.head.appendChild(script)
    showToast('엑셀 라이브러리 로딩 중...', 'warning')
    return
  }

  const vendors = window._vendorsCache || []
  const patientCats = window._patientCats || []
  // 실제 카테고리 발주 데이터 사용
  const catDailyOrders = window._catDailyOrders || []
  const orderData = window._ordersData || []
  const year = App.currentYear
  const month = App.currentMonth
  const mm = String(month).padStart(2,'0')
  const daysInMonth = new Date(year, month, 0).getDate()
  const DOWK = ['일','월','화','수','목','금','토']
  const hasCats = patientCats && patientCats.length > 0

  const normalOrderMap = {}
  ;(orderData || []).forEach(o => { normalOrderMap[`${o.order_date}__${o.vendor_id}`] = o })
  const catOrderMapXl = {}
  ;(catDailyOrders || []).forEach(s => { catOrderMapXl[`${s.order_date}__${s.patient_category_id}__${s.vendor_id}`] = s })

  function getCellVal(vendorId, catId, dateStr, subType, taxType) {
    if (catId) {
      const s = catOrderMapXl[`${dateStr}__${catId}__${vendorId}`]
      if (!s) return ''
      const tx = s.taxable || s.taxable_amount || 0
      const ex = s.exempt || s.exempt_amount || 0
      const vt = s.vat != null ? s.vat : (s.vat_amount != null ? s.vat_amount : Math.round(tx*0.1))
      const tot = s.total || s.total_amount || (tx+ex+vt)
      if (subType==='taxable') return tx||''
      if (subType==='exempt')  return ex||''
      if (subType==='vat')     return vt||''
      return tot||''
    } else {
      const o = normalOrderMap[`${dateStr}__${vendorId}`]
      if (!o) return ''
      if (subType==='taxable') return o.taxable_amount||''
      if (subType==='exempt')  return o.exempt_amount||''
      if (subType==='vat')     return o.vat_amount||''
      return o.total_amount||''
    }
  }

  const subLabel = { taxable:'과세', exempt:'면세', vat:'부가세', mixed_total:'합계' }
  const wb = XLSX.utils.book_new()
  const wsData = []

  // ── 헤더 행1: 업체명 (병합 예정)
  const hdr1 = ['날짜','요일']
  // ── 헤더 행2: 과세/면세/부가세/합계
  const hdr2 = ['','']
  // ── 컬럼 정보
  const colDefs = []
  const merges = []
  let colIdx = 2 // 0=날짜, 1=요일

  function addVendorCols(vendorId, vendorName, catId, catName, taxType) {
    let subs = []
    if (taxType==='mixed_total') subs = ['mixed_total']
    else if (taxType==='taxable') subs = ['taxable','vat']
    else if (taxType==='exempt') subs = ['exempt']
    else subs = ['taxable','exempt','vat']

    const label = catName ? `[${catName}] ${vendorName}` : vendorName
    hdr1.push(label)
    for (let i=1; i<subs.length; i++) hdr1.push('')
    if (subs.length > 1) {
      merges.push({ s:{r:0,c:colIdx}, e:{r:0,c:colIdx+subs.length-1} })
    }
    subs.forEach(sub => {
      hdr2.push(subLabel[sub])
      colDefs.push({ vendorId, catId, subType: sub, taxType })
      colIdx++
    })
  }

  if (hasCats) {
    patientCats.forEach(cat => vendors.forEach(v => addVendorCols(v.id, v.name, cat.id, cat.name, v.tax_type)))
  } else {
    vendors.forEach(v => addVendorCols(v.id, v.name, null, null, v.tax_type))
  }
  hdr1.push('일 합계')
  hdr2.push('')
  wsData.push(hdr1)
  wsData.push(hdr2)

  // 날짜 행 + 합계 배열
  const colTotals = new Array(colDefs.length).fill(0)
  let grandTotal = 0

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${mm}-${String(d).padStart(2,'0')}`
    const dow = DOWK[new Date(dateStr).getDay()]
    const row = [dateStr, dow]
    let dayTotal = 0

    colDefs.forEach((cd, i) => {
      const v = getCellVal(cd.vendorId, cd.catId, dateStr, cd.subType, cd.taxType)
      const n = typeof v === 'number' ? v : (parseInt(String(v).replace(/[^\d]/g,''))||0)
      row.push(v)
      colTotals[i] += n
      // 일 합계: total/mixed_total/exempt 만 (과세+부가세 = 공급대가이므로 중복방지)
      if (cd.subType==='mixed_total' || cd.subType==='exempt') dayTotal += n
      else if (cd.subType==='taxable') dayTotal += n
    })
    row.push(dayTotal||'')
    grandTotal += dayTotal
    wsData.push(row)
  }

  // 합계 행
  const totalRow = ['합계', '']
  colDefs.forEach((_, i) => totalRow.push(colTotals[i]||''))
  totalRow.push(grandTotal)
  wsData.push(totalRow)

  const ws = XLSX.utils.aoa_to_sheet(wsData)

  // 병합 셀
  ws['!merges'] = merges

  // 열 너비
  ws['!cols'] = [{ wch:13 }, { wch:4 }]
  colDefs.forEach(() => ws['!cols'].push({ wch:11 }))
  ws['!cols'].push({ wch:13 })

  // 헤더 행 높이
  ws['!rows'] = [{ hpt:24 }, { hpt:18 }]

  // ── 셀 스타일 적용 (헤더/합계행 강조) ──
  const totalRows = wsData.length
  const totalCols = hdr1.length
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  function colLetter(n) {
    if (n < 26) return LETTERS[n]
    return LETTERS[Math.floor(n/26)-1] + LETTERS[n%26]
  }

  // 헤더 행1 스타일
  for (let c = 0; c < totalCols; c++) {
    const addr = colLetter(c) + '1'
    if (!ws[addr]) ws[addr] = { v: '', t: 's' }
    ws[addr].s = {
      fill: { fgColor: { rgb: 'E0E7FF' } },
      font: { bold: true, sz: 11, color: { rgb: '1D4ED8' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: { top:{style:'thin',color:{rgb:'BFDBFE'}}, bottom:{style:'thin',color:{rgb:'BFDBFE'}}, left:{style:'thin',color:{rgb:'BFDBFE'}}, right:{style:'thin',color:{rgb:'BFDBFE'}} }
    }
  }

  // 헤더 행2 (과세/면세/부가세 서브헤더) 스타일
  for (let c = 0; c < totalCols; c++) {
    const addr = colLetter(c) + '2'
    if (!ws[addr]) ws[addr] = { v: '', t: 's' }
    const subVal = String(ws[addr].v || '')
    const subFg = subVal==='과세'?'16A34A':subVal==='면세'?'D97706':subVal==='부가세'?'6B7280':subVal==='합계'?'1D4ED8':'374151'
    ws[addr].s = {
      fill: { fgColor: { rgb: 'F8FAFC' } },
      font: { bold: true, sz: 10, color: { rgb: subFg } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: { top:{style:'thin',color:{rgb:'E5E7EB'}}, bottom:{style:'medium',color:{rgb:'CBD5E1'}}, left:{style:'thin',color:{rgb:'E5E7EB'}}, right:{style:'thin',color:{rgb:'E5E7EB'}} }
    }
  }

  // 데이터 행 스타일
  for (let r = 2; r < totalRows - 1; r++) {
    const rowNum = r + 1
    const isWeekendRow = (() => {
      const d = wsData[r][0]
      if (!d || d === '합계') return false
      const dStr = String(d)
      const day = new Date(dStr).getDay()
      return day === 0 || day === 6
    })()
    for (let c = 0; c < totalCols; c++) {
      const addr = colLetter(c) + rowNum
      if (!ws[addr]) ws[addr] = { v: '', t: 's' }
      ws[addr].s = {
        fill: { fgColor: { rgb: isWeekendRow ? 'F9FAFB' : 'FFFFFF' } },
        font: { sz: 10 },
        alignment: { horizontal: c <= 1 ? 'center' : 'right', vertical: 'center' },
        border: { top:{style:'thin',color:{rgb:'F3F4F6'}}, bottom:{style:'thin',color:{rgb:'F3F4F6'}}, left:{style:'thin',color:{rgb:'E5E7EB'}}, right:{style:'thin',color:{rgb:'E5E7EB'}} }
      }
    }
  }

  // 합계 행 스타일 (마지막 행)
  for (let c = 0; c < totalCols; c++) {
    const addr = colLetter(c) + totalRows
    if (!ws[addr]) ws[addr] = { v: '', t: 's' }
    ws[addr].s = {
      fill: { fgColor: { rgb: 'EFF6FF' } },
      font: { bold: true, sz: 11, color: { rgb: '1D4ED8' } },
      alignment: { horizontal: c <= 1 ? 'center' : 'right', vertical: 'center' },
      border: { top:{style:'medium',color:{rgb:'BFDBFE'}}, bottom:{style:'medium',color:{rgb:'BFDBFE'}}, left:{style:'thin',color:{rgb:'BFDBFE'}}, right:{style:'thin',color:{rgb:'BFDBFE'}} }
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, `${year}년${mm}월_발주내역`)
  XLSX.writeFile(wb, `발주내역_${year}년${mm}월.xlsx`)
  showToast('✅ 엑셀 다운로드 완료!', 'success')
}

// ══════════════════════════════════════════════════════════════
// 2.1 발주 검수 관리 모달
// ══════════════════════════════════════════════════════════════

// 빠른 단건 검수 완료 (대시보드 알림에서 호출)
window.quickInspect = async (orderId) => {
  try {
    await api('PUT', `/api/orders/inspection/${orderId}`, {
      is_inspected: true, actual_amount: null, inspection_memo: null, received_date: null
    })
    showToast('검수 완료 처리되었습니다', 'success')
    // 알림 배너 새로고침
    setTimeout(() => renderDashboard(), 800)
  } catch(e) {
    showToast('검수 처리 실패', 'error')
  }
}

window.openInspectionModal = async () => {
  const year = App.currentYear, month = App.currentMonth
  let inspData = null
  try {
    inspData = await api('GET', `/api/orders/inspection/pending/${year}/${month}`)
  } catch(e) { showToast('검수 데이터 로드 실패', 'error'); return }

  const s = inspData.summary || {}
  const all = inspData.all || []

  const modal = document.createElement('div')
  modal.id = 'inspection-modal'
  modal.className = 'fixed inset-0 z-50 flex items-start justify-center bg-black bg-opacity-40 pt-8 px-2 pb-4 overflow-y-auto'
  modal.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl">
      <div class="flex items-center justify-between px-5 py-4 border-b">
        <div>
          <h2 class="font-bold text-gray-800 text-base"><i class="fas fa-clipboard-check text-green-600 mr-2"></i>발주 검수 관리</h2>
          <p class="text-xs text-gray-400 mt-0.5">${year}년 ${month}월 · 총 ${s.total}건</p>
        </div>
        <button onclick="document.getElementById('inspection-modal').remove()" class="text-gray-400 hover:text-gray-600 p-1">
          <i class="fas fa-times text-lg"></i>
        </button>
      </div>

      <!-- 검수 요약 -->
      <div class="grid grid-cols-3 gap-3 px-5 py-3 bg-gray-50 border-b">
        <div class="text-center">
          <div class="text-xs text-gray-500">미검수</div>
          <div class="text-lg font-bold ${s.pendingCount > 0 ? 'text-orange-600' : 'text-gray-400'}">${s.pendingCount}건</div>
          <div class="text-xs text-gray-400">${fmtMan(s.pendingAmount)}원</div>
        </div>
        <div class="text-center">
          <div class="text-xs text-gray-500">검수완료</div>
          <div class="text-lg font-bold text-green-600">${s.completedCount}건</div>
          <div class="text-xs text-gray-400">${fmtMan(s.completedAmount)}원</div>
        </div>
        <div class="text-center">
          <div class="text-xs text-gray-500">실제 입고금액</div>
          <div class="text-lg font-bold text-blue-600">${fmtMan(s.actualAmount)}원</div>
          ${s.actualAmount !== s.completedAmount ? `<div class="text-xs text-red-500">차이: ${fmtMan(s.actualAmount - s.completedAmount)}원</div>` : '<div class="text-xs text-green-500">발주액과 일치</div>'}
        </div>
      </div>

      <!-- 일괄 검수 버튼 -->
      ${s.pendingCount > 0 ? `
      <div class="px-5 py-2 border-b bg-orange-50 flex items-center gap-2">
        <i class="fas fa-exclamation-circle text-orange-500 text-sm"></i>
        <span class="text-xs text-orange-700">미검수 ${s.pendingCount}건 일괄 처리:</span>
        <button onclick="batchInspectAll()" class="btn btn-sm text-xs" style="background:#059669;color:white;border:none;padding:4px 10px">
          <i class="fas fa-check-double mr-1"></i>전체 검수완료
        </button>
      </div>` : ''}

      <!-- 발주 목록 -->
      <div class="px-4 py-2 overflow-x-auto" style="max-height:60vh;overflow-y:auto">
        ${all.length === 0 ? '<div class="text-center py-8 text-gray-400">이 달 발주 데이터가 없습니다.</div>' : `
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead style="position:sticky;top:0;background:white;z-index:1">
            <tr style="border-bottom:2px solid #e5e7eb">
              <th style="padding:6px 8px;text-align:left;font-weight:600;color:#6b7280">날짜</th>
              <th style="padding:6px 8px;text-align:left;font-weight:600;color:#6b7280">업체</th>
              <th style="padding:6px 8px;text-align:right;font-weight:600;color:#6b7280">발주금액</th>
              <th style="padding:6px 8px;text-align:right;font-weight:600;color:#6b7280">실제금액</th>
              <th style="padding:6px 8px;text-align:center;font-weight:600;color:#6b7280">상태</th>
              <th style="padding:6px 8px;text-align:center;font-weight:600;color:#6b7280">처리</th>
            </tr>
          </thead>
          <tbody>
            ${all.map(r => {
              const statusMap = {
                pending: {label:'⏳ 미검수', bg:'#fef3c7', color:'#d97706'},
                completed_ok: {label:'✓ 검수완료', bg:'#dcfce7', color:'#16a34a'},
                completed_issue: {label:'⚠ 이슈발생', bg:'#fff7ed', color:'#ea580c'},
                returned: {label:'↩ 반품발생', bg:'#fee2e2', color:'#dc2626'}
              }
              const statusInfo = statusMap[r.inspection_status || (r.is_inspected ? 'completed_ok' : 'pending')] || statusMap.pending
              return `
            <tr id="insp-row-${r.id}" style="border-bottom:1px solid #f3f4f6;${r.is_inspected?'background:#f0fdf4':''}">
              <td style="padding:6px 8px;color:#6b7280">${r.order_date}</td>
              <td style="padding:6px 8px;font-weight:600;color:#374151">${r.vendor_name}</td>
              <td style="padding:6px 8px;text-align:right;color:#1d4ed8">${fmt(r.total_amount)}원</td>
              <td style="padding:6px 8px;text-align:right">
                ${r.is_inspected ? `
                  <span class="font-bold ${(r.actual_amount||r.total_amount)!==r.total_amount?'text-orange-600':'text-green-600'}">${fmt(r.actual_amount||r.total_amount)}원</span>
                  ${r.deduction_amount !== 0 && r.deduction_amount != null ? `<div style="font-size:10px;color:${r.deduction_amount>0?'#dc2626':'#16a34a'}">변동: ${r.deduction_amount>0?'-':'+'}${fmt(Math.abs(r.deduction_amount))}원 (${r.deduction_amount>0?'차감':'증액'})</div>` : ''}
                ` : `
                  <input type="number" id="actual-${r.id}" value="${r.total_amount}"
                    style="width:90px;padding:2px 4px;border:1px solid #d1d5db;border-radius:4px;text-align:right;font-size:11px">
                `}
              </td>
              <td style="padding:6px 8px;text-align:center">
                <span style="background:${statusInfo.bg};color:${statusInfo.color};padding:2px 8px;border-radius:12px;font-size:10px;font-weight:600">${statusInfo.label}</span>
              </td>
              <td style="padding:6px 8px;text-align:center">
                ${r.is_inspected ? `
                  <button onclick="undoInspection(${r.id})" class="text-xs text-gray-400 hover:text-red-500" title="검수 취소">
                    <i class="fas fa-undo"></i>
                  </button>
                ` : `
                  <div style="display:flex;flex-direction:column;gap:3px;align-items:center">
                    <button onclick="completeInspection(${r.id},'completed_ok')" style="background:#059669;color:white;border:none;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer;white-space:nowrap">
                      ✓ 검수완료
                    </button>
                    <button onclick="openIssueForm(${r.id},'${r.vendor_name}',${r.total_amount})" style="background:#ea580c;color:white;border:none;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer;white-space:nowrap">
                      ⚠ 이슈기록
                    </button>
                  </div>
                `}
              </td>
            </tr>
            ${r.is_inspected && r.inspection_memo ? `
            <tr style="border-bottom:1px solid #f3f4f6;background:#f0fdf4">
              <td colspan="6" style="padding:2px 8px 6px 24px;font-size:10px;color:#6b7280">
                📝 ${r.inspection_memo}
              </td>
            </tr>` : ''}
            <!-- 이슈 입력 폼 (숨김 상태) -->
            <tr id="issue-form-${r.id}" style="display:none;background:#fff7ed;border-bottom:1px solid #fed7aa">
              <td colspan="6" style="padding:12px 16px">
                <div style="font-weight:700;color:#ea580c;font-size:12px;margin-bottom:8px">
                  <i class="fas fa-exclamation-triangle mr-1"></i>${r.vendor_name} 이슈 기록
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
                  <div>
                    <label style="font-size:11px;color:#6b7280;display:block;margin-bottom:3px">이슈 유형 *</label>
                    <select id="issue-type-${r.id}" style="width:100%;padding:5px 8px;border:1px solid #fdba74;border-radius:6px;font-size:12px">
                      <option value="미입고">미입고</option>
                      <option value="품질불량">품질 불량</option>
                      <option value="반품">반품</option>
                      <option value="수량부족">수량 부족</option>
                      <option value="단가오류">단가 오류</option>
                      <option value="기타">기타</option>
                    </select>
                  </div>
                  <div>
                    <label style="font-size:11px;color:#6b7280;display:block;margin-bottom:3px">검수 상태</label>
                    <select id="issue-status-${r.id}" style="width:100%;padding:5px 8px;border:1px solid #fdba74;border-radius:6px;font-size:12px">
                      <option value="completed_issue">이슈 발생</option>
                      <option value="returned">반품 발생</option>
                    </select>
                  </div>
                  <div>
                    <label style="font-size:11px;color:#6b7280;display:block;margin-bottom:3px">품목명</label>
                    <input type="text" id="issue-item-${r.id}" placeholder="예: 돼지고기 1kg" style="width:100%;padding:5px 8px;border:1px solid #fdba74;border-radius:6px;font-size:12px;box-sizing:border-box">
                  </div>
                  <div>
                    <label style="font-size:11px;color:#6b7280;display:block;margin-bottom:3px">변동금액 (원, - 입력 가능)</label>
                    <input type="number" id="issue-deduction-${r.id}" placeholder="0" value="0"
                      oninput="updateActualFromDeduction(${r.id},${r.total_amount})"
                      style="width:100%;padding:5px 8px;border:1px solid #fdba74;border-radius:6px;font-size:12px;box-sizing:border-box">
                  </div>
                </div>
                <div style="margin-bottom:8px">
                  <label style="font-size:11px;color:#6b7280;display:block;margin-bottom:3px">실제 입고 금액: <strong id="issue-actual-display-${r.id}" style="color:#ea580c">${fmt(r.total_amount)}원</strong> (발주: ${fmt(r.total_amount)}원)</label>
                </div>
                <div style="margin-bottom:10px">
                  <label style="font-size:11px;color:#6b7280;display:block;margin-bottom:3px">이슈 상세 내용</label>
                  <textarea id="issue-detail-${r.id}" rows="2" placeholder="상세 내용을 입력하세요..."
                    style="width:100%;padding:5px 8px;border:1px solid #fdba74;border-radius:6px;font-size:12px;resize:vertical;box-sizing:border-box"></textarea>
                </div>
                <div style="display:flex;gap:8px;justify-content:flex-end">
                  <button onclick="cancelIssueForm(${r.id})" style="background:#f3f4f6;color:#374151;border:none;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer">취소</button>
                  <button onclick="saveInspectionIssue(${r.id},'${r.vendor_name}',${r.total_amount})" style="background:#ea580c;color:white;border:none;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer">
                    <i class="fas fa-save mr-1"></i>이슈 저장
                  </button>
                </div>
              </td>
            </tr>
            `}).join('')}
          </tbody>
        </table>`}
      </div>

      <div class="px-5 py-3 border-t flex justify-end">
        <button onclick="document.getElementById('inspection-modal').remove()" class="btn btn-secondary btn-sm">닫기</button>
      </div>
    </div>
  `
  document.body.appendChild(modal)
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove() })
}

window.completeInspection = async (orderId, status = 'completed_ok') => {
  const actualEl = document.getElementById(`actual-${orderId}`)
  const actualAmount = actualEl ? parseInt(actualEl.value.replace(/,/g,'')) || 0 : null
  const memo = null

  try {
    await api('PUT', `/api/orders/inspection/${orderId}`, {
      is_inspected: true, actual_amount: actualAmount, inspection_memo: memo,
      status: status
    })
    const row = document.getElementById(`insp-row-${orderId}`)
    if (row) {
      row.style.background = '#f0fdf4'
      row.querySelector('td:nth-child(5)').innerHTML = `<span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:600">✓ 검수완료</span>`
      row.querySelector('td:nth-child(6)').innerHTML = `<button onclick="undoInspection(${orderId})" class="text-xs text-gray-400 hover:text-red-500" title="검수 취소"><i class="fas fa-undo"></i></button>`
      if (actualEl) {
        const td = actualEl.parentElement
        td.innerHTML = `<span class="font-bold text-green-600">${fmt(actualAmount)}원</span>`
      }
    }
    showToast('검수 완료 처리됨', 'success')
  } catch(e) { showToast('처리 실패', 'error') }
}

// #1 이슈 입력 폼 열기/닫기
window.openIssueForm = function(orderId, vendorName, orderAmount) {
  document.getElementById(`issue-form-${orderId}`).style.display = ''
  document.getElementById(`actual-${orderId}`) && (document.getElementById(`actual-${orderId}`).closest('tr').style.display = 'none')
}
window.cancelIssueForm = function(orderId) {
  document.getElementById(`issue-form-${orderId}`).style.display = 'none'
}
window.updateActualFromDeduction = function(orderId, orderAmount) {
  // 변동금액: + 이면 증액, - 이면 차감
  const deduction = parseInt(document.getElementById(`issue-deduction-${orderId}`)?.value||'0')||0
  const actual = orderAmount - deduction  // 변동금액 차감 (음수면 증액됨)
  const dispEl = document.getElementById(`issue-actual-display-${orderId}`)
  const sign = deduction > 0 ? '차감' : deduction < 0 ? '증액' : ''
  if (dispEl) dispEl.innerHTML = `<span style="color:${actual<orderAmount?'#dc2626':actual>orderAmount?'#16a34a':'#374151'}">${fmt(actual)}원</span>${sign ? ` <span style="font-size:10px;color:#6b7280">(${sign} ${fmt(Math.abs(deduction))}원)</span>` : ''}`
}

// #1 이슈 저장
window.saveInspectionIssue = async function(orderId, vendorName, orderAmount) {
  const issueType = document.getElementById(`issue-type-${orderId}`)?.value
  const issueStatus = document.getElementById(`issue-status-${orderId}`)?.value || 'completed_issue'
  const itemName = document.getElementById(`issue-item-${orderId}`)?.value || ''
  const deduction = parseInt(document.getElementById(`issue-deduction-${orderId}`)?.value||'0')||0
  const detail = document.getElementById(`issue-detail-${orderId}`)?.value || ''
  const actualAmount = orderAmount - deduction  // 변동금액 반영 (음수=증액, 양수=차감)

  if (!issueType) { showToast('이슈 유형을 선택하세요', 'error'); return }

  try {
    await api('POST', '/api/orders/inspection/issue', {
      order_id: orderId,
      vendor_name: vendorName,
      item_name: itemName,
      issue_type: issueType,
      issue_detail: detail,
      deduction_amount: deduction,
      order_amount: orderAmount,
      actual_amount: actualAmount,
      inspection_status: issueStatus
    })
    showToast('이슈가 기록되었습니다', 'success')
    // 모달 새로고침
    document.getElementById('inspection-modal')?.remove()
    openInspectionModal()
  } catch(e) { showToast('이슈 저장 실패', 'error') }
}

window.undoInspection = async (orderId) => {
  try {
    await api('PUT', `/api/orders/inspection/${orderId}`, { is_inspected: false })
    showToast('검수 취소됨', 'info')
    openInspectionModal()
  } catch(e) { showToast('처리 실패', 'error') }
}

window.batchInspectAll = async () => {
  const year = App.currentYear, month = App.currentMonth
  let inspData = null
  try {
    inspData = await api('GET', `/api/orders/inspection/pending/${year}/${month}`)
  } catch(e) { return }
  const pendingIds = (inspData.pending || []).map(r => r.id)
  if (pendingIds.length === 0) { showToast('미검수 항목 없음', 'info'); return }
  try {
    const res = await api('PUT', '/api/orders/inspection/batch', { orderIds: pendingIds })
    showToast(`${res.updated}건 일괄 검수 완료`, 'success')
    document.getElementById('inspection-modal')?.remove()
    openInspectionModal()
  } catch(e) { showToast('일괄 처리 실패', 'error') }
}

// mixed: 과세+면세 2칸+소계(3열), mixed_total: 합산총액 1칸, taxable/exempt: 1칸
function getVendorCols(taxType, isCardType) {
  if (isCardType) return 1
  return taxType === 'mixed' ? 3 : 1
}

function getVendorSubHeaders(taxType, isCardType) {
  if (isCardType) return `<th style="min-width:80px;font-size:10px;color:#7c3aed">합계</th>`
  if (taxType === 'mixed') return `<th style="min-width:60px;font-size:10px">과세</th><th style="min-width:60px;font-size:10px">면세</th><th style="min-width:60px;font-size:10px;background:#1a2f4a">소계</th>`
  if (taxType === 'taxable') return `<th style="min-width:60px;font-size:10px">과세</th>`
  if (taxType === 'mixed_total') return `<th style="min-width:68px;font-size:10px">합산총액</th>`
  return `<th style="min-width:60px;font-size:10px">면세</th>`
}

function getVendorInputCells(v, order, dateStr, addBorder = false) {
  const taxable = order.taxable_amount || 0
  const exempt = order.exempt_amount || 0
  const total = order.total_amount || 0
  const multiDay = order.is_multi_day ? `title="${order.multi_day_start}~${order.multi_day_end} 다일치"` : ''
  const borderStyle = addBorder ? 'border-left:3px solid #cbd5e1;' : ''
  const fmtV = (v) => v > 0 ? v.toLocaleString() : ''
  // ── 법인카드형 업체: 클릭 시 상세입력 모달 열기 ──
  if (v.is_card_type) {
    const cardTotal = window._cardDailyMap?.[v.id]?.[dateStr] || total
    const cardCount = window._cardDailyCountMap?.[v.id]?.[dateStr] || 0
    const hasData = cardTotal > 0
    const subtypeLabel = {food:'식재료',supplies:'소모품',online:'온라인',other:'기타'}[v.card_subtype||'food']||''
    return `<td style="${borderStyle}min-width:80px;padding:2px 2px">
      <button class="card-expense-btn w-full text-left px-1.5 py-1 rounded-lg border transition-all"
        data-vendor="${v.id}" data-date="${dateStr}"
        style="min-width:76px;font-size:11px;${hasData
          ? 'background:#f5f3ff;border-color:#8b5cf6;color:#6d28d9;'
          : 'background:#faf5ff;border-color:#e9d5ff;color:#a78bfa;'}"
        onclick="openCardExpenseModal(${v.id},'${dateStr}')">
        <div style="font-size:9px;color:#8b5cf6;font-weight:600;">${subtypeLabel}</div>
        ${hasData
          ? `<div style="font-weight:700">${cardTotal.toLocaleString()}</div><div style="font-size:9px;color:#7c3aed;">${cardCount}건</div>`
          : `<div style="color:#c4b5fd">+ 상세입력</div>`}
      </button>
    </td>`
  }
  if (v.tax_type === 'mixed') {
    return `<td style="${borderStyle}min-width:64px;padding:2px 2px"><input type="text" inputmode="numeric" pattern="[0-9,]*" class="order-input" data-vendor="${v.id}" data-type="taxable" data-date="${dateStr}" value="${fmtV(taxable)}" placeholder="0" style="width:60px;min-width:60px"></td>
            <td style="min-width:64px;padding:2px 2px"><input type="text" inputmode="numeric" pattern="[0-9,]*" class="order-input" data-vendor="${v.id}" data-type="exempt" data-date="${dateStr}" value="${fmtV(exempt)}" placeholder="0" style="width:60px;min-width:60px"></td>
            <td class="total-col text-center text-xs ${order.is_multi_day?'multi-day-cell':''}" id="vt-${v.id}-${dateStr}" style="min-width:64px;padding:2px 2px" ${multiDay}>${total>0?fmt(total):''}</td>`
  }
  if (v.tax_type === 'mixed_total') {
    // 합산 입력: 총액 1칸 (과세+면세 영수증이 총액으로만 청구되는 간납 업체)
    return `<td style="${borderStyle}min-width:72px;padding:2px 2px"><input type="text" inputmode="numeric" pattern="[0-9,]*" class="order-input" data-vendor="${v.id}" data-type="total" data-date="${dateStr}" value="${fmtV(total)}" placeholder="0" style="width:68px;min-width:68px"></td>`
  }
  if (v.tax_type === 'taxable') {
    return `<td style="${borderStyle}min-width:72px;padding:2px 2px"><input type="text" inputmode="numeric" pattern="[0-9,]*" class="order-input" data-vendor="${v.id}" data-type="taxable" data-date="${dateStr}" value="${fmtV(taxable)}" placeholder="0" style="width:68px;min-width:68px"></td>`
  }
  return `<td style="${borderStyle}min-width:72px;padding:2px 2px"><input type="text" inputmode="numeric" pattern="[0-9,]*" class="order-input" data-vendor="${v.id}" data-type="exempt" data-date="${dateStr}" value="${fmtV(exempt)}" placeholder="0" style="width:68px;min-width:68px"></td>`
}

function getVendorTotalCells(v, orderData) {
  // 법인카드형 업체: total_amount 합산
  if (v.is_card_type) {
    const total = orderData.filter(o => o.vendor_id === v.id).reduce((s, o) => s + (o.total_amount||0), 0)
    return `<td class="text-right pr-2 text-purple-700 font-bold text-xs total-col">${total>0?fmt(total):''}</td>`
  }
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
  // 법인카드형 업체
  if (v.is_card_type) {
    const firstBorder = borderLeft ? `style="${borderLeft}${vBgStyle}min-width:80px;font-size:10px"` : `style="${vBgStyle}min-width:80px;font-size:10px"`
    const sumBg = `style="${vBgStyle}min-width:56px;font-size:9px;border-left:1px dashed rgba(255,255,255,0.3)"`
    return `<th ${firstBorder}>합계</th>${hasCats ? `<th ${sumBg}>업체합산</th>` : ''}`
  }
  const colW = v.tax_type === 'mixed' ? 68 : 76
  const firstBorder = borderLeft ? `style="${borderLeft}${vBgStyle}min-width:${colW}px;font-size:10px"` : `style="${vBgStyle}min-width:${colW}px;font-size:10px"`
  const subBg = vBgStyle ? `style="${vBgStyle}min-width:${colW}px;font-size:10px"` : `style="min-width:${colW}px;font-size:10px"`
  const sumBg = `style="${vBgStyle}min-width:56px;font-size:9px;border-left:1px dashed rgba(255,255,255,0.3)"`
  if (v.tax_type === 'mixed') {
    return `<th ${firstBorder}>과세</th><th ${subBg}>면세</th><th style="${vBgStyle}min-width:${colW}px;font-size:10px;opacity:0.85">소계</th>${hasCats ? `<th ${sumBg}>업체합산</th>` : ''}`
  }
  if (v.tax_type === 'mixed_total') {
    return `<th ${firstBorder}>합산총액</th>${hasCats ? `<th ${sumBg}>업체합산</th>` : ''}`
  }
  if (v.tax_type === 'taxable') {
    return `<th ${firstBorder}>과세</th>${hasCats ? `<th ${sumBg}>업체합산</th>` : ''}`
  }
  return `<th ${firstBorder}>면세</th>${hasCats ? `<th ${sumBg}>업체합산</th>` : ''}`
}

// 업체 합계 셀 (주 진행률 열 없음 — 합계행에 월 달성률만 id로 남김)
function getVendorTotalCellsWithPct(v, orderData) {
  // 법인카드형 업체
  if (v.is_card_type) {
    const total = orderData.filter(o => o.vendor_id === v.id).reduce((s, o) => s + (o.total_amount||0), 0)
    return `<td class="text-center text-purple-700 font-bold text-xs total-col py-1" id="vfoot-amt-${v.id}">${total>0?fmt(total):''}</td>`
  }
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
    const totalEl   = tbody.querySelector(`input.order-input[data-vendor="${vendorId}"][data-type="total"][data-date="${date}"]`)

    let taxable = 0, exempt = 0, vat = 0, total = 0
    if (totalEl) {
      // mixed_total: 합산 총액 1칸 입력 (과세+면세 영수증 총액)
      total = parseOrderVal(totalEl.value)
      totalEl.value = total > 0 ? total.toLocaleString() : ''
      taxable = 0; exempt = 0; vat = 0
    } else {
      taxable = parseOrderVal(taxableEl?.value)
      exempt  = parseOrderVal(exemptEl?.value)
      if (taxableEl) taxableEl.value = taxable > 0 ? taxable.toLocaleString() : ''
      if (exemptEl)  exemptEl.value  = exempt  > 0 ? exempt.toLocaleString()  : ''
      vat = Math.round(taxable * 0.1)
      total = taxable + exempt + vat
    }
    const subtotalEl = document.getElementById(`vt-${vendorId}-${date}`)
    if (subtotalEl) subtotalEl.textContent = total > 0 ? fmt(total) : ''
    updateDayTotal(date)
    showAutoSaveIndicator('saving')
    const res = await api('POST', '/api/orders/save', {
      vendorId: parseInt(vendorId), orderDate: date,
      taxableAmount: taxable, exemptAmount: exempt, vatAmount: vat,
      totalAmount: total
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
      const totalDirectEl = tbody.querySelector(`input.order-input[data-vendor="${vendorId}"][data-type="total"][data-date="${date}"]`)
      if (totalDirectEl) {
        // mixed_total: 합산 총액 1칸 - 소계셀 없음, 그냥 dayTotal만 업데이트
        updateDayTotal(date)
        updateBudgetProgressPanel()
      } else {
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
      }
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

    // #3 수정: Tab(다음칸) / Shift+Tab(이전칸) 모두 처리
    if (input.classList.contains('order-input')) {
      const inputs = [...tbody.querySelectorAll('.order-input')].filter(el => el.offsetParent !== null)
      const idx = inputs.indexOf(input)
      if (e.shiftKey) {
        // Shift+Tab: 이전 입력칸으로 이동
        if (idx > 0) { e.preventDefault(); inputs[idx - 1].focus() }
      } else {
        // Tab 또는 Enter: 다음 입력칸으로 이동
        if (idx < inputs.length - 1) { e.preventDefault(); inputs[idx + 1].focus() }
      }
    } else if (input.classList.contains('cat-order-input')) {
      const inputs = [...tbody.querySelectorAll('.cat-order-input')].filter(el => el.offsetParent !== null)
      const idx = inputs.indexOf(input)
      if (e.shiftKey) {
        // Shift+Tab: 이전 입력칸으로 이동
        if (idx > 0) { e.preventDefault(); inputs[idx - 1].focus() }
      } else {
        // Tab 또는 Enter: 다음 입력칸으로 이동
        if (idx < inputs.length - 1) { e.preventDefault(); inputs[idx + 1].focus() }
      }
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

  let taxable = 0, exempt = 0, vat = 0, totalOverride = null
  if (taxableEl) taxable = parseOrderVal(taxableEl.value)
  if (exemptEl)  exempt  = parseOrderVal(exemptEl.value)
  if (totalEl) {
    const val = parseOrderVal(totalEl.value)
    if (field === 'exempt') {
      // 순수 면세 단일칸
      exempt = val
    } else if (field === 'total') {
      // mixed_total: 과세+면세 합산 총액 1칸 (taxable/exempt 없음)
      // taxable/exempt 둘 다 없는 경우에만 totalOverride 사용
      if (!taxableEl && !exemptEl) {
        totalOverride = val
      } else {
        // fallback: taxable로 처리 (기존 동작)
        taxable = val
      }
    } else {
      // 과세 단일칸
      taxable = val
    }
  }

  vat = Math.round(taxable * 0.1)

  showAutoSaveIndicator('saving')
  const savePayload = {
    vendorId: parseInt(vendorId),
    orderDate: date,
    patientCategoryId: parseInt(categoryId),
    taxableAmount: taxable,
    exemptAmount: exempt,
    vatAmount: vat
  }
  // mixed_total: totalOverride가 있으면 totalAmount를 직접 전달
  if (totalOverride !== null) {
    savePayload.taxableAmount = 0
    savePayload.exemptAmount = 0
    savePayload.vatAmount = 0
    savePayload.totalAmount = totalOverride
  }
  const res = await api('POST', '/api/orders/save-category', savePayload)
  showAutoSaveIndicator(res?.success ? 'saved' : 'error')
  // 서브행 합계 셀 업데이트
  const dispTotal = totalOverride !== null ? totalOverride : taxable + exempt + vat

  // ── 저장 성공 시 _catDailyMap 즉시 업데이트 (월 누적 실시간 반영) ──
  if (res?.success) {
    if (!window._catDailyMap) window._catDailyMap = {}
    if (!window._catDailyMap[date]) window._catDailyMap[date] = {}
    if (!window._catDailyMap[date][parseInt(vendorId)]) window._catDailyMap[date][parseInt(vendorId)] = {}
    const savedTotal = totalOverride !== null ? totalOverride : taxable + exempt + vat
    window._catDailyMap[date][parseInt(vendorId)][parseInt(categoryId)] = {
      order_date: date,
      vendor_id: parseInt(vendorId),
      patient_category_id: parseInt(categoryId),
      taxable: totalOverride !== null ? 0 : taxable,
      exempt: totalOverride !== null ? 0 : exempt,
      vat: totalOverride !== null ? 0 : vat,
      total: savedTotal
    }
  }

  updateCatSubrowTotal(categoryId, vendorId, date, taxable, exempt, vat, totalOverride)
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

// 서브행 합계 셀 실시간 업데이트 (과세+면세+vat 또는 mixed_total 합산)
function updateCatSubrowTotal(categoryId, vendorId, date, taxable, exempt, vat, totalOverride) {
  // totalOverride: mixed_total 타입일 때 직접 합산 총액
  const total = totalOverride !== undefined && totalOverride !== null
    ? totalOverride
    : taxable + exempt + vat
  // 간단히 dayTotal 업데이트만 수행 (세부 셀은 updateDayTotal 내부에서 처리됨)
  updateDayTotal(date)
  updateBudgetProgressPanel()
}

// 카테고리 월 합계 업데이트 (_catDailyMap 기반 - 정확한 월 전체 합산)
function updateCatMonthTotal(categoryId) {
  const dailyMap = window._catDailyMap || {}
  const vendors = window._ordersVendors || []
  const patientCats = window._patientCats || []

  // _catDailyMap 기반 전체 월 합산
  let grandMonthTotal = 0
  const catMonthTotals = {}
  patientCats.forEach(cat => { catMonthTotals[cat.id] = 0 })

  Object.keys(dailyMap).forEach(dk => {
    Object.keys(dailyMap[dk]).forEach(vid => {
      Object.keys(dailyMap[dk][vid]).forEach(cid => {
        const r = dailyMap[dk][vid][cid] || {}
        const t = r.total || 0
        grandMonthTotal += t
        if (catMonthTotals[cid] !== undefined) catMonthTotals[cid] += t
        else catMonthTotals[cid] = (catMonthTotals[cid] || 0) + t
      })
    })
  })
  // 법인카드형 업체 합산
  ;(vendors || []).filter(v => v.is_card_type).forEach(v => {
    const cardMap = window._cardDailyMap?.[v.id] || {}
    Object.values(cardMap).forEach(amt => { grandMonthTotal += amt || 0 })
  })

  // tfoot 월 합계 셀 업데이트
  const footMonthEl = document.getElementById('vfoot-month-total')
  if (footMonthEl) footMonthEl.textContent = grandMonthTotal > 0 ? fmt(grandMonthTotal) : ''

  // tfoot 업체별 합계 셀 업데이트
  vendors.forEach(v => {
    const footEl = document.getElementById(`vfoot-amt-${v.id}`)
    if (!footEl) return
    let vTotal = 0
    if (v.is_card_type) {
      const cardMap = window._cardDailyMap?.[v.id] || {}
      Object.values(cardMap).forEach(amt => { vTotal += amt || 0 })
    } else {
      Object.keys(dailyMap).forEach(dk => {
        patientCats.forEach(cat => {
          const r = (dailyMap[dk]?.[v.id]?.[cat.id]) || {}
          vTotal += r.total || 0
        })
      })
    }
    footEl.textContent = vTotal > 0 ? fmt(vTotal) : ''
    // 인접 월누적 표시 td도 업데이트 (vfoot-amt 다음 td)
    const nextTd = footEl.nextElementSibling
    if (nextTd) nextTd.textContent = vTotal > 0 ? fmt(vTotal) : ''
  })
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
    const _showProportion2 = patientCats.length > 1  // 환자군 2개 이상일때만 점유 표시
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

        // 환자군 2개 이상일때만 점유 바 업데이트
        if (_showProportion2) {
          if (aBar)   aBar.style.width = aPct + '%'
          if (aPctEl) aPctEl.textContent = aPct + '%'
        }
        if (bBar)   { bBar.style.width = Math.min(bPct||0,100) + '%'; bBar.style.background = bColor }
        if (bPctEl) { bPctEl.textContent = (bPct!==null ? bPct+'%' : ''); bPctEl.style.color = bColor }
        if (amtEl)  amtEl.textContent = fmtMan(amt)
      })
    }

    const catDailyBudgets2 = {}; const catMonthBudgets2 = {}; const catWeekBudgets2 = {}
    const _curWeekDays2 = window._ordersBudget?.weeklyData?.find(w=>w.isCurWeek)?.wDays || 5
    ;(window._catOrderSettings||[]).forEach(s => {
      const id = s.patient_category_id
      catMonthBudgets2[id] = s.monthly_budget || 0
      catDailyBudgets2[id] = s.working_days > 0 ? Math.round((s.monthly_budget||0)/s.working_days) : 0
      catWeekBudgets2[id]  = catDailyBudgets2[id] * _curWeekDays2
    })

    updateCatBars(catTodayAcc,  catDailyBudgets2, 'today')
    updateCatBars(catMonthAcc,  catMonthBudgets2, 'month')
    // 주차 바 업데이트: 각 주차 카드의 실제 일수(data-week-days) 기반으로 카테고리 예산 계산
    document.querySelectorAll('[id^="week"][id$="-card"]').forEach(el => {
      const num = el.id.replace('-card','').replace('week','')
      if (isNaN(num)) return
      // 해당 주차 카드의 실제 일수 읽기
      const weekPctCell = document.getElementById(`weekPctCell-${el.id.replace('-card','')}`) ||
        document.querySelector(`[data-week-num="${num}"]`)
      const wDaysCard = parseInt(weekPctCell?.dataset?.weekDays || 0)
      if (wDaysCard > 0) {
        // 이 주차용 카테고리 예산 생성
        const wCatBudgets2 = {}
        ;(window._catOrderSettings||[]).forEach(s => {
          const id = s.patient_category_id
          const daily = s.working_days > 0 ? Math.round((s.monthly_budget||0)/s.working_days) : 0
          wCatBudgets2[id] = daily * wDaysCard
        })
        updateCatBars(catWeekAcc, wCatBudgets2, `w${num}`)
      } else {
        updateCatBars(catWeekAcc, catWeekBudgets2, `w${num}`)
      }
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
      // mixed_total: data-type="total" 직접 합산 총액
      const totalDirectEl = document.querySelector(`input.order-input[data-vendor="${vendor}"][data-type="total"][data-date="${date}"]`)
      let total = 0
      if (totalDirectEl) {
        total = parseOrderVal(totalDirectEl.value)
      } else {
        const taxableEl = document.querySelector(`input.order-input[data-vendor="${vendor}"][data-type="taxable"][data-date="${date}"]`)
        const exemptEl = document.querySelector(`input.order-input[data-vendor="${vendor}"][data-type="exempt"][data-date="${date}"]`)
        const t = parseOrderVal(taxableEl?.value)
        const e = parseOrderVal(exemptEl?.value)
        total = t + Math.round(t*0.1) + e
      }
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
      // mixed_total: data-type="total" 직접 합산 총액
      const totDirEl = document.querySelector(`input.order-input[data-vendor="${vendor}"][data-type="total"][data-date="${date}"]`)
      let tot2 = 0
      if (totDirEl) {
        tot2 = parseOrderVal(totDirEl.value)
      } else {
        const tx = document.querySelector(`input.order-input[data-vendor="${vendor}"][data-type="taxable"][data-date="${date}"]`)
        const ex = document.querySelector(`input.order-input[data-vendor="${vendor}"][data-type="exempt"][data-date="${date}"]`)
        const t2 = parseOrderVal(tx?.value)
        const e2 = parseOrderVal(ex?.value)
        tot2 = t2 + Math.round(t2 * 0.1) + e2
      }
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
        // mixed_total: data-type="total" 직접 합산 총액
        const totDirEl = document.querySelector(`input.order-input[data-vendor="${v.id}"][data-type="total"][data-date="${d}"]`)
        if (totDirEl) {
          vMonthTotal += parseOrderVal(totDirEl.value)
        } else {
          const tx = document.querySelector(`input.order-input[data-vendor="${v.id}"][data-type="taxable"][data-date="${d}"]`)
          const ex = document.querySelector(`input.order-input[data-vendor="${v.id}"][data-type="exempt"][data-date="${d}"]`)
          const t = parseOrderVal(tx?.value)
          const e = parseOrderVal(ex?.value)
          vMonthTotal += t + Math.round(t*0.1) + e
        }
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
          // 구버전 'staff' 단일키 + 신버전 st_key_ 개별항목 호환
          if (mealsKeys3.includes('staff') || mealsKeys3.some(k => k.startsWith('st_key_'))) catMonthMeals += staffMeals3
          if (mealsKeys3.includes('guardian')) catMonthMeals += guardianMeals3
          mealsKeys3.filter(k => k.startsWith('cat_')).forEach(k => { catMonthMeals += (orderMealStats[k] || 0) })
          // 비급여식 식수: nc_key_{diet_key} 형식 - mealCustomTotals에서 diet_key로 조회
          mealsKeys3.filter(k => k.startsWith('nc_key_')).forEach(k => {
            const dietKey = k.replace('nc_key_', '')
            catMonthMeals += (orderMealStats[dietKey] || 0)
          })
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

  // ── 업체별 버튼 색상 실시간 갱신 ──
  // 날짜별 입력값 합산 후 저장 여부와 무관하게 실제 입력된 값으로 파란/회색 결정
  ;(() => {
    const hasCatsBtn = (window._patientCats || []).length > 0
    // 날짜별 입력합계 집계
    const dateTotalsLive = {}
    if (hasCatsBtn) {
      const seen = new Set()
      document.querySelectorAll('.cat-order-input').forEach(inp => {
        const date = inp.dataset.date
        const vendor = inp.dataset.vendor
        const field = inp.dataset.field
        const key = `${date}-${vendor}-${field}`
        if (seen.has(key)) return; seen.add(key)
        const val = parseOrderVal(inp.value)
        if (val === 0) return
        const amt = field === 'taxable' ? val + Math.round(val * 0.1) : val
        dateTotalsLive[date] = (dateTotalsLive[date] || 0) + amt
      })
    } else {
      const seen = new Set()
      document.querySelectorAll('.order-input').forEach(inp => {
        const date = inp.dataset.date
        const vendor = inp.dataset.vendor
        const key = `${date}-${vendor}`
        if (seen.has(key)) return; seen.add(key)
        const tx = document.querySelector(`input.order-input[data-vendor="${vendor}"][data-type="taxable"][data-date="${date}"]`)
        const ex = document.querySelector(`input.order-input[data-vendor="${vendor}"][data-type="exempt"][data-date="${date}"]`)
        const t = parseOrderVal(tx?.value)
        const e = parseOrderVal(ex?.value)
        const tot = t + Math.round(t * 0.1) + e
        if (tot === 0) return
        dateTotalsLive[date] = (dateTotalsLive[date] || 0) + tot
      })
    }
    // 버튼 DOM 갱신
    document.querySelectorAll('.detail-toggle-btn[data-date]').forEach(btn => {
      const date = btn.dataset.date
      const hasAmt = (dateTotalsLive[date] || 0) > 0
      const isOpenNow = btn.textContent.trim().startsWith('▲') || btn.querySelector('.detail-arrow')?.textContent === '▲'
      btn.dataset.hasamt = hasAmt ? '1' : '0'
      if (!isOpenNow) {
        // 닫힌 상태에서만 색상 반영 (열린 상태는 #64748b 유지)
        const todayStr2 = window._ordersBudget?.todayStr || ''
        const isToday2 = date === todayStr2
        if (hasAmt) {
          btn.style.background = '#2563eb'
          btn.style.color = 'white'
        } else if (isToday2) {
          btn.style.background = '#16a34a'
          btn.style.color = 'white'
        } else {
          btn.style.background = '#e5e7eb'
          btn.style.color = '#6b7280'
        }
      }
    })
  })()
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
  const processedCardVendors = new Set()
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
  // 법인카드형 업체 월 합계 추가
  if (window._cardDailyMap) {
    Object.entries(window._cardDailyMap).forEach(([vendorId, dateMap]) => {
      if (processedCardVendors.has(vendorId)) return
      processedCardVendors.add(vendorId)
      Object.values(dateMap).forEach(amt => { monthOrdered += amt })
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
        // 구버전 'staff' 단일키 + 신버전 st_key_ 개별항목 호환
        if (mealsKeys2.includes('staff') || mealsKeys2.some(k => k.startsWith('st_key_'))) catMealCount += staffMeals2
        if (mealsKeys2.includes('guardian')) catMealCount += guardianMeals2
        mealsKeys2.filter(k => k.startsWith('cat_')).forEach(k => { catMealCount += (orderMealStats2[k] || 0) })
        // 비급여식 식수: nc_key_{diet_key} 형식
        mealsKeys2.filter(k => k.startsWith('nc_key_')).forEach(k => {
          const dietKey = k.replace('nc_key_', '')
          catMealCount += (orderMealStats2[dietKey] || 0)
        })
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

  // ── 4. 업체 발주 비중 (#7 완전 개선: 도넛+상세분석) ──
  const vendorShareEl = document.getElementById('vendorShareContent')
  const vendorShareDonutCanvas = document.getElementById('vendorShareDonut')
  if ((vendorShareEl || vendorShareDonutCanvas) && vendors.length > 0) {
    // 업체별 발주 합계 (현재 입력값 + 저장된 데이터 병합)
    const vendorTotals = {}
    vendors.forEach(v => { vendorTotals[v.id] = 0 })

    // 1) 화면 입력값 집계
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

    // 2) 입력값이 없으면 저장된 데이터(_ordersData / _catDailyOrders) 사용
    const liveGrand = Object.values(vendorTotals).reduce((a,b)=>a+b,0)
    if (liveGrand === 0) {
      if (hasCats) {
        ;(window._catDailyOrders || []).forEach(r => {
          if (vendorTotals[r.vendor_id] !== undefined) {
            vendorTotals[r.vendor_id] += r.total || 0
          }
        })
      } else {
        ;(window._ordersData || []).forEach(o => {
          if (vendorTotals[o.vendor_id] !== undefined) {
            vendorTotals[o.vendor_id] += o.total_amount || 0
          }
        })
      }
    }
    const grandV = Object.values(vendorTotals).reduce((a,b)=>a+b,0)
    const vendorColors = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#84cc16','#ec4899','#f97316','#14b8a6']

    // 업체를 발주액 내림차순 정렬
    const sortedVendors = vendors
      .map((v, vi) => ({ ...v, amt: vendorTotals[v.id]||0, color: vendorColors[vi%vendorColors.length] }))
      .filter(v => v.amt > 0)
      .sort((a, b) => b.amt - a.amt)

    // ── 도넛 차트 렌더링 ──
    if (vendorShareDonutCanvas && grandV > 0) {
      if (window._vendorShareChart) { try { window._vendorShareChart.destroy() } catch(e){} }
      if (typeof Chart !== 'undefined') {
        const doughnutCenterPlugin2 = {
          id: 'dCenter2',
          afterDraw(chart) {
            if (chart.config.type !== 'doughnut') return
            const { ctx, chartArea: { top, left, width, height } } = chart
            const cx = left + width/2, cy = top + height/2
            ctx.save()
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
            ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#1d4ed8'
            ctx.fillText(fmtMan(grandV), cx, cy-6)
            ctx.font = '9px sans-serif'; ctx.fillStyle = '#6b7280'
            ctx.fillText('월 합계', cx, cy+7)
            ctx.restore()
          }
        }
        window._vendorShareChart = new Chart(vendorShareDonutCanvas, {
          type: 'doughnut',
          data: {
            labels: sortedVendors.map(v => v.name),
            datasets: [{ data: sortedVendors.map(v => v.amt), backgroundColor: sortedVendors.map(v => v.color), borderWidth: 1, borderColor: '#fff' }]
          },
          options: {
            responsive: false, cutout: '62%',
            plugins: { legend: { display: false }, tooltip: {
              callbacks: {
                label(ctx2) {
                  const v = sortedVendors[ctx2.dataIndex]
                  const pct = grandV > 0 ? Math.round(v.amt/grandV*100) : 0
                  const budgetPct = v.monthly_budget > 0 ? Math.round(v.amt/v.monthly_budget*100) : null
                  return [`${v.name}: ${v.amt.toLocaleString()}원 (${pct}%)`, budgetPct !== null ? `목표 대비: ${budgetPct}%` : '목표 미설정']
                }
              }
            }}
          },
          plugins: [doughnutCenterPlugin2]
        })
      }

      // 범례 (도넛 아래)
      const legendEl = document.getElementById('vendorShareLegend')
      if (legendEl) {
        legendEl.innerHTML = sortedVendors.map((v, rank) => {
          const pct = grandV > 0 ? Math.round(v.amt/grandV*100) : 0
          const budgetPct = v.monthly_budget > 0 ? Math.round(v.amt/v.monthly_budget*100) : null
          const budColor = budgetPct === null ? '#9ca3af' : budgetPct >= 100 ? '#dc2626' : budgetPct >= 80 ? '#f59e0b' : '#10b981'
          const rankBadge = rank < 3 ? `<span style="font-size:8px;font-weight:800;color:white;background:${rank===0?'#f59e0b':rank===1?'#6b7280':'#cd7c30'};padding:0 3px;border-radius:3px;margin-right:2px;flex-shrink:0">${rank+1}</span>` : `<span style="font-size:8px;color:#9ca3af;width:14px;text-align:center;flex-shrink:0">${rank+1}</span>`
          return `<div style="display:flex;align-items:center;gap:3px;margin-bottom:3px;font-size:9px">
            ${rankBadge}
            <div style="width:8px;height:8px;border-radius:2px;background:${v.color};flex-shrink:0"></div>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#374151;font-weight:600" title="${v.name}">${v.name}</span>
            <span style="color:${v.color};font-weight:700">${pct}%</span>
            ${budgetPct !== null ? `<span style="color:${budColor};font-size:8px">목표${budgetPct}%</span>` : ''}
          </div>`
        }).join('')
      }
    }

    // ── 테이블 뷰 (상세) ──
    if (vendorShareEl) {
      vendorShareEl.innerHTML = grandV > 0 ? `
        <table style="width:100%;font-size:9px;border-collapse:collapse">
          <thead><tr style="background:#dbeafe;color:#1d4ed8">
            <th style="padding:3px 4px;text-align:left">순위</th>
            <th style="padding:3px 4px;text-align:left">업체</th>
            <th style="padding:3px 4px;text-align:right">발주금액</th>
            <th style="padding:3px 4px;text-align:right">비중</th>
            <th style="padding:3px 4px;text-align:right">목표대비</th>
          </tr></thead>
          <tbody>
            ${sortedVendors.map((v, rank) => {
              const pct = grandV > 0 ? Math.round(v.amt/grandV*100) : 0
              const budgetPct = v.monthly_budget > 0 ? Math.round(v.amt/v.monthly_budget*100) : null
              const budColor = budgetPct === null ? '#9ca3af' : budgetPct >= 100 ? '#dc2626' : budgetPct >= 80 ? '#f59e0b' : '#10b981'
              const rankEmoji = rank===0?'🥇':rank===1?'🥈':rank===2?'🥉':`${rank+1}`
              return `<tr style="border-bottom:1px solid #eff6ff">
                <td style="padding:3px 4px;text-align:center;font-weight:700">${rankEmoji}</td>
                <td style="padding:3px 4px;font-weight:700;color:${v.color};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60px" title="${v.name}">${v.name}</td>
                <td style="padding:3px 4px;text-align:right;color:#1f2937;font-weight:600">${fmtMan(v.amt)}</td>
                <td style="padding:3px 4px;text-align:right">
                  <div style="display:flex;align-items:center;gap:2px;justify-content:flex-end">
                    <div style="width:28px;height:5px;background:#e5e7eb;border-radius:3px;overflow:hidden">
                      <div style="height:100%;width:${pct}%;background:${v.color};border-radius:3px"></div>
                    </div>
                    <span style="color:${v.color};font-weight:700">${pct}%</span>
                  </div>
                </td>
                <td style="padding:3px 4px;text-align:right;color:${budColor};font-weight:700">${budgetPct !== null ? `${budgetPct}%` : '-'}</td>
              </tr>`
            }).join('')}
          </tbody>
        </table>
      ` : `<div style="font-size:10px;color:#9ca3af;text-align:center;padding:8px">발주 데이터 없음</div>`
    }

    // ── TOP3/5 집중도 ──
    const top3El = document.getElementById('vendorTop3Summary')
    if (grandV > 0 && sortedVendors.length > 0 && top3El) {
      const top3 = sortedVendors.slice(0, 3)
      const top5 = sortedVendors.slice(0, Math.min(5, sortedVendors.length))
      const top3pct = Math.round(top3.reduce((s,v)=>s+v.amt,0)/grandV*100)
      const top5pct = Math.round(top5.reduce((s,v)=>s+v.amt,0)/grandV*100)
      const concColor = top3pct >= 80 ? '#dc2626' : top3pct >= 60 ? '#d97706' : '#16a34a'
      const concLabel = top3pct >= 80 ? '⚠ 편중 위험' : top3pct >= 60 ? '집중도 높음' : '분산 양호'
      top3El.style.display = 'block'
      top3El.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-weight:700">🏆 업체 집중도</span>
          <span style="color:${concColor};font-weight:700">${concLabel}</span>
        </div>
        <div style="display:flex;gap:6px">
          <div style="flex:1;background:${top3pct>=80?'#fee2e2':top3pct>=60?'#fef3c7':'#dcfce7'};border-radius:4px;padding:4px 6px;text-align:center">
            <div style="font-size:8px;color:#6b7280">TOP 3</div>
            <div style="font-size:13px;font-weight:800;color:${concColor}">${top3pct}%</div>
            <div style="font-size:8px;color:#9ca3af">${top3.map(v=>v.name.slice(0,4)).join(', ')}</div>
          </div>
          <div style="flex:1;background:#eff6ff;border-radius:4px;padding:4px 6px;text-align:center">
            <div style="font-size:8px;color:#6b7280">TOP 5</div>
            <div style="font-size:13px;font-weight:800;color:#1d4ed8">${top5pct}%</div>
            <div style="font-size:8px;color:#9ca3af">${top5.map(v=>v.name.slice(0,3)).join(', ')}</div>
          </div>
        </div>`
    }

    // ── 업체 편중 감지 ──
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
          biasEl.innerHTML = `<div style="font-size:9px;background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:4px 7px;margin-top:5px">⚠️ <strong style="color:#d97706">${v.name}</strong> 발주 집중 <strong style="color:#dc2626">${bpct}%</strong></div>`
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
      else if (field === 'total') {
        // mixed_total 합산 총액: taxable/exempt 없을 때만 합산 (중복 방지)
        const v2 = inp.dataset.vendor
        const d2 = inp.dataset.date
        const c2 = inp.dataset.category
        const hasTaxable = c2
          ? document.querySelector(`.cat-order-input[data-vendor="${v2}"][data-category="${c2}"][data-field="taxable"][data-date="${d2}"]`)
          : document.querySelector(`input.order-input[data-vendor="${v2}"][data-type="taxable"][data-date="${d2}"]`)
        if (!hasTaxable) liveTotal2 += val
      } else {
        liveTotal2 += val
      }
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
    // mixed_total: data-type="total" 입력 (합산 총액)
    const totalDirectEl = document.querySelector(`input.order-input[data-vendor="${vendorId}"][data-type="total"][data-date="${date}"]`)
    if (totalDirectEl) {
      const vTotal = parseOrderVal(totalDirectEl.value)
      total += vTotal
      vendorTotals[vendorId] = vTotal
      return
    }
    const taxableEl = document.querySelector(`input.order-input[data-vendor="${vendorId}"][data-type="taxable"][data-date="${date}"]`)
    const exemptEl = document.querySelector(`input.order-input[data-vendor="${vendorId}"][data-type="exempt"][data-date="${date}"]`)
    const t = parseOrderVal(taxableEl?.value)
    const e = parseOrderVal(exemptEl?.value)
    const vTotal = t + Math.round(t*0.1) + e
    total += vTotal
    vendorTotals[vendorId] = vTotal
  })

  // 법인카드형 업체: card-expense-btn에서 합계 포함
  document.querySelectorAll(`.card-expense-btn[data-date="${date}"]`).forEach(btn => {
    const vendorId = String(btn.dataset.vendor)
    if (processedVendors.has(vendorId)) return
    processedVendors.add(vendorId)
    const cardTotal = (window._cardDailyMap?.[vendorId]?.[date]) || 0
    total += cardTotal
    vendorTotals[vendorId] = cardTotal
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
    // 법인카드형 업체 금액도 grandTotal에 포함
    let cardTotalForDay = 0
    ;(window._ordersVendors || []).filter(v => v.is_card_type).forEach(v => {
      cardTotalForDay += (window._cardDailyMap?.[v.id]?.[date]) || 0
    })
    const grandTotal = Object.values(catTotals).reduce((a,b)=>a+b,0) + cardTotalForDay

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

    // ── 탭 내 업체 일 누적 금액 실시간 업데이트 (_catDailyMap 기반 - date 이하 날짜 합산) ──
    patientCats.forEach(cat => {
      const catColor = getCategoryColorHex(cat.category_key)
      const catSettings5 = (window._catSettingsMap || {})[cat.id] || {}
      const catMonthBudget5 = catSettings5.monthly_budget || 0
      // 일 목표는 전체 설정의 working_days 기준 (카테고리별 working_days는 용도가 다름)
      const _globalWD5 = window._ordersBudget?.workingDays || 0
      const vendorsBudget = window._ordersVendors || []
      const vCount = vendorsBudget.length || 1

      vendorsBudget.forEach(v => {
        const accumEl = document.getElementById(`vcat-month-accum-${v.id}-${cat.id}`)
        if (!accumEl) return
        // _catDailyMap 기반 date 이하 날짜 누적 합산 (일 누적)
        let vCatLiveTotal = 0
        if (v.is_card_type) {
          const vendorCardMap = window._cardDailyMap?.[v.id] || {}
          Object.entries(vendorCardMap).forEach(([dk, amt]) => { if (dk <= date) vCatLiveTotal += amt || 0 })
        } else {
          const dailyMap = window._catDailyMap || {}
          Object.keys(dailyMap).forEach(dk => {
            if (dk > date) return
            const r = (dailyMap[dk]?.[v.id]?.[cat.id]) || {}
            vCatLiveTotal += r.total || 0
          })
        }

        // 업체 일 목표: v.monthly_budget ÷ 전체 working_days
        const vRawMonthBudget5 = (v.monthly_budget > 0) ? v.monthly_budget : (catMonthBudget5 > 0 ? Math.round(catMonthBudget5 / vCount) : 0)
        const vMonthBudget5 = _globalWD5 > 0 ? Math.round(vRawMonthBudget5 / _globalWD5) : 0
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

  // data-week-budget 속성에 해당 주차 실제 일수 기반 예산 저장됨
  const weekBudget = parseInt(weekPctCell.dataset.weekBudget || 0) || budget.weekBudget || 0
  const wDaysInMonth = parseInt(weekPctCell.dataset.weekDays || 0)
  const wPct = weekBudget > 0 ? Math.round(wTotal / weekBudget * 100) : null
  const wOver = wPct !== null && wPct >= 100
  const wWarn = wPct !== null && wPct >= 80 && !wOver
  const wColor = wOver ? '#dc2626' : wWarn ? '#d97706' : '#166534'
  const isCurrentWeek = weekPctCell.dataset.weekIsCurrent === '1'
  const weekNum = weekPctCell.dataset.weekNum || ''
  const weekLabel = weekPctCell.dataset.weekLabel || ''
  const wBadgeBg = isCurrentWeek ? '#0284c7' : (wOver ? '#dc2626' : wWarn ? '#d97706' : '#166634')
  const wPctBar = wPct !== null
    ? `<div style="height:4px;background:rgba(255,255,255,0.3);border-radius:2px;margin-top:3px"><div style="height:4px;width:${Math.min(wPct,100)}%;background:${wColor};border-radius:2px"></div></div>`
    : ''
  weekPctCell.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:3px">
      <div style="display:inline-flex;align-items:center;background:${wBadgeBg};color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:9px;white-space:nowrap">${weekNum}주${isCurrentWeek?'(현재)':''}</div>
      <span style="font-size:${isCurrentWeek?'13px':'12px'};font-weight:800;color:${wColor};white-space:nowrap">${wPct !== null ? wPct + '%' : '-'}${wOver?' 🚨':wWarn?' ⚠️':''}</span>
    </div>
    <div style="font-size:8px;color:#6b7280;margin-top:1px;white-space:nowrap">${weekLabel}${wDaysInMonth>0?`<span style="color:#9ca3af;margin-left:3px">(${wDaysInMonth}일)</span>`:''}</div>
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
  window._mealDietCats = Array.isArray(resp) ? [] : (resp.dietCategories || [])

  // 카테고리별 월 발주 합계: { catId: amount }
  const catMonthTotals = {}
  ;(catOrderData?.monthly || []).forEach(r => {
    catMonthTotals[r.patient_category_id] = (catMonthTotals[r.patient_category_id]||0) + (r.total||0)
  })
  window._catMonthTotals = catMonthTotals

  // 카테고리 설정(예산/목표식단가) 저장 - 발주 페이지에서 이미 로드됐으면 덮어쓰지 않음
  window._catOrderSettings = catOrderData?.settings || window._catOrderSettings || []

  renderMealsContent(content, mealData, window._mealCustomFields, window._mealPatientCats, window._mealDietCats || [])
}

function renderMealsContent(content, mealData, customFields, patientCats, dietCats) {
  patientCats = patientCats || []
  dietCats = dietCats || []

  // ── dietCats 우선 사용, 없으면 기존 customFields fallback ──
  const useDietGroups = dietCats.length > 0

  const DIET_GROUP_ORDER = ['patient','therapy','noncovered','staff']
  const DIET_GROUP_META_MEAL = {
    patient:    { name:'일반식',   color:'#2563eb', bg:'#eff6ff', border:'#93c5fd', icon:'fa-bed' },
    therapy:    { name:'치료식',   color:'#16a34a', bg:'#f0fdf4', border:'#86efac', icon:'fa-pills' },
    noncovered: { name:'비급여식', color:'#9333ea', bg:'#faf5ff', border:'#d8b4fe', icon:'fa-hand-holding-usd' },
    staff:      { name:'직원식',   color:'#d97706', bg:'#fffbeb', border:'#fcd34d', icon:'fa-user-tie' },
  }

  // ── 환자군별 일반식+치료식 그룹화 구조 ──
  // patientGroups: 환자군(patient 타입) 목록
  // 각 환자군에 연결된 치료식(linked_patient_group 매칭)을 하위로 붙임
  // 비연결 치료식은 독립 치료식으로 처리
  const patientGroupDefs = dietCats.filter(dc => dc.parent_type === 'patient')
  const therapyDefs = dietCats.filter(dc => dc.parent_type === 'therapy')
  const noncoveredDefs = dietCats.filter(dc => dc.parent_type === 'noncovered')
  const staffDefs = dietCats.filter(dc => dc.parent_type === 'staff')

  // 환자군별 구조: { pgKey: { groupDef, therapyItems[] } }
  const patientGroupStructure = patientGroupDefs.map(pg => {
    const pgKey = pg.patient_group || pg.diet_key
    // 이 환자군에 연결된 치료식
    const linkedTherapies = therapyDefs.filter(t => (t.linked_patient_group || t.patient_group) === pgKey)
    return { groupDef: pg, therapyItems: linkedTherapies }
  })
  // 연결되지 않은(독립) 치료식
  const linkedTherapyIds = new Set(patientGroupStructure.flatMap(pg => pg.therapyItems.map(t => t.id)))
  const unlinkedTherapies = therapyDefs.filter(t => !linkedTherapyIds.has(t.id))

  // dietCats를 커스텀필드 형태로 변환 (field_key = legacy_field_key || diet_key)
  const toFieldObj = (dc) => ({
    field_key: dc.legacy_field_key || dc.diet_key,
    field_name: dc.diet_name,
    unit_type: 'meal',
    diet_id: dc.id,
    parent_type: dc.parent_type,
    diet_key: dc.diet_key,
    linked_patient_group: dc.linked_patient_group || dc.patient_group || null,
    include_in_meal_price: dc.include_in_meal_price || 0,
  })

  // ── 테이블 컬럼 순서 구성 ──
  // 일반식(환자군만) | 치료식(모든 치료식) | 비급여식 | 직원식
  // ※ 연결치료식도 치료식 열에 표시 (일반식 열에는 환자군만)
  const dietGroups = {}
  DIET_GROUP_ORDER.forEach(t => { dietGroups[t] = [] })

  if (useDietGroups) {
    // 일반식: 환자군만 (치료식은 치료식 열로 분리)
    patientGroupStructure.forEach(({ groupDef }) => {
      dietGroups['patient'].push(toFieldObj({ ...groupDef, field_name: groupDef.diet_name }))
    })
    // 치료식: 모든 치료식(연결+비연결) 순서대로
    // 연결 치료식은 환자군 순서에 맞춰 그룹핑
    patientGroupStructure.forEach(({ groupDef, therapyItems }) => {
      therapyItems.forEach(t => dietGroups['therapy'].push({ ...toFieldObj(t), _isLinkedTherapy: true, _linkedGroupName: groupDef.diet_name }))
    })
    // 비연결 치료식 추가
    unlinkedTherapies.forEach(t => dietGroups['therapy'].push(toFieldObj(t)))
    // 비급여
    noncoveredDefs.forEach(dc => dietGroups['noncovered'].push(toFieldObj(dc)))
    // 직원
    staffDefs.forEach(dc => dietGroups['staff'].push(toFieldObj(dc)))
  } else {
    // 기존 방식
    dietCats.forEach(dc => {
      if (dietGroups[dc.parent_type]) dietGroups[dc.parent_type].push(toFieldObj(dc))
    })
  }

  // 모든 active dietCat field_key 목록 (합계/헤더용)
  const allDietFields = DIET_GROUP_ORDER.flatMap(t => dietGroups[t])
  // customFields fallback (dietCats 없으면 기존처럼)
  const effectiveCustomFields = useDietGroups ? allDietFields : customFields

  const days = getDaysInMonth(App.currentYear, App.currentMonth)
  const mealMap = {}
  mealData.forEach(m => {
    mealMap[m.meal_date] = m
    // custom_data JSON 파싱
    try { m._custom = JSON.parse(m.custom_data || '{}') } catch(e) { m._custom = {} }
  })

  // 월 합계 계산 (기본 - 환자 컬럼은 화면 표시 없음, 데이터 유지만)
  let monthTotal = { s:0, n:0, g:0, custom:{} }
  effectiveCustomFields.forEach(f => { monthTotal.custom[f.field_key] = 0 })
  mealData.forEach(m => {
    monthTotal.s += (m.breakfast_staff||0)+(m.lunch_staff||0)+(m.dinner_staff||0)
    monthTotal.n += (m.breakfast_noncovered||0)+(m.lunch_noncovered||0)+(m.dinner_noncovered||0)
    monthTotal.g += (m.breakfast_guardian||0)+(m.lunch_guardian||0)+(m.dinner_guardian||0)
    effectiveCustomFields.forEach(f => {
      const cd = m._custom?.[f.field_key] || {}
      monthTotal.custom[f.field_key] = (monthTotal.custom[f.field_key]||0) + (cd.bf||0) + (cd.l||0) + (cd.d||0)
    })
  })

  // 기본 + 커스텀 합계 (커스텀 중 ea 단위는 grandTotal에서 제외)
  // 비급여식 중 include_in_meal_price=0 인 항목은 식단가 계산(grandTotal)에서 제외
  const customTotalForMeals = effectiveCustomFields
    .filter(f => {
      if (f.unit_type === 'ea') return false  // ea 단위 제외
      if (f.parent_type === 'noncovered' && !f.include_in_meal_price) return false  // 비급여 미포함 제외
      return true
    })
    .reduce((s, f) => s + (monthTotal.custom[f.field_key] || 0), 0)
  // 총 식수: ea 제외, 비급여 중 포함여부 OFF 제외
  const grandTotal = customTotalForMeals

  // ── 컬럼 구성: diet category 기반만, baseLabels(직원/비급/보호) 완전 제거 ──
  const customLabels = effectiveCustomFields.map(f => f.field_name)
  const allLabels = [...customLabels]   // 기본(직원/비급/보호) 제거
  const colCount = allLabels.length + 1  // +1 = 소계

  // 2행(대분류): 일반식 | 치료식 | 비급여식 | 직원식 | 합
  // 3행(소분류): 각 대분류 소속 세부항목 (diet category 이름)
  let level2Groups = []
  if (useDietGroups) {
    // 일반식: 환자군 수 (치료식 분리됨)
    if (patientGroupStructure.length > 0) {
      level2Groups.push({ label:'일반식', count: patientGroupStructure.length, color:'#93c5fd', bg:'#1e3a8a', icon:'fa-bed', type:'normal' })
    }
    // 치료식: 모든 치료식 수 (연결+비연결)
    const allTherapyCount = dietGroups['therapy'].length
    if (allTherapyCount > 0) {
      level2Groups.push({ label:'치료식', count: allTherapyCount, color:'#86efac', bg:'#14532d', icon:'fa-pills', type:'therapy' })
    }
    // 비급여식
    if (noncoveredDefs.length > 0) {
      level2Groups.push({ label:'비급여식', count: noncoveredDefs.length, color:'#d8b4fe', bg:'#4a044e', icon:'fa-hand-holding-usd', type:'noncovered' })
    }
    // 직원식
    if (staffDefs.length > 0) {
      level2Groups.push({ label:'직원식', count: staffDefs.length, color:'#fcd34d', bg:'#78350f', icon:'fa-user-tie', type:'staff' })
    }
  }
  const hasLevel2 = level2Groups.length > 0

  // ── 마감 완료 달 읽기전용 처리 ──
  const _mealsReadOnly = isReadOnly(App.currentYear, App.currentMonth)

  // 1행 조/중/석/합계 설정 - 어두운 테마 + 선명한 색상 차별
  const mealSections = [
    { label:'조  식', border:'#3b82f6', bg:'#1e40af', textColor:'#e0f2fe' },
    { label:'중  식', border:'#16a34a', bg:'#14532d', textColor:'#bbf7d0' },
    { label:'석  식', border:'#a855f7', bg:'#581c87', textColor:'#f3e8ff' },
    { label:'합  계', border:'#94a3b8', bg:'#0f172a', textColor:'#f1f5f9' },
  ]

  content.innerHTML = `
  ${_mealsReadOnly ? readOnlyBanner() : ''}
  <!-- 월 합계 요약 카드 -->
  <div class="flex flex-wrap gap-2 mb-4" id="mealSummaryCards">
    ${buildMealSummaryCards(monthTotal, effectiveCustomFields, grandTotal, patientGroupStructure, unlinkedTherapies, noncoveredDefs, staffDefs)}
  </div>

  <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
    <div class="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
      <div>
        <h2 class="font-bold text-gray-800 text-sm md:text-base">${App.currentYear}년 ${App.currentMonth}월 식수 현황</h2>
        <p class="text-xs text-gray-400 mt-0.5 hidden md:block">조식/중식/석식 × 식수 카테고리</p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <button onclick="saveMealBatch()" class="btn btn-success btn-sm" ${_mealsReadOnly ? 'disabled title="마감 완료 달은 수정 불가"' : ''}>
          <i class="fas fa-save"></i> ${_mealsReadOnly ? '🔒 저장불가' : '저장'}
        </button>
      </div>
    </div>
    <div class="overflow-x-auto" style="-webkit-overflow-scrolling:touch;">
      <div class="scroll-hint"><i class="fas fa-arrows-left-right"></i>좌우로 스크롤하여 전체 식수 입력</div>
      <table class="meal-table w-full" id="mealMainTable" style="font-size:12px;border-collapse:collapse">
        <thead>
          <!-- 1행: 식사 구분 (조식/중식/석식/합계) - 큰 글씨, 진한 색, 명확한 구분 -->
          <tr>
            <th rowspan="${hasLevel2 ? 3 : 2}" style="min-width:30px;border:2px solid #374151;background:#1f2937;color:#e5e7eb;font-size:13px;font-weight:700;padding:6px 4px">일</th>
            <th rowspan="${hasLevel2 ? 3 : 2}" style="min-width:24px;border:2px solid #374151;background:#1f2937;color:#e5e7eb;font-size:13px;font-weight:700;padding:6px 2px">요</th>
            ${mealSections.map((s, si) => {
              const span = si < 3 ? colCount : allLabels.length + 1
              return `<th colspan="${span}" style="
                border:3px solid ${s.border};
                border-bottom:3px solid ${s.border};
                background:${s.bg};
                color:${s.textColor};
                font-size:16px;
                font-weight:900;
                padding:9px 4px;
                letter-spacing:4px;
                text-align:center;
                text-shadow:0 1px 3px rgba(0,0,0,0.4);
              ">${s.label}</th>`
            }).join('')}
          </tr>
          <!-- 2행: 대분류 그룹 헤더 (일반식/치료식/비급여식/직원식/합) -->
          ${hasLevel2 ? `
          <tr>
            ${mealSections.map((sec, mi) => {
              const isTot = mi===3
              const groupCells = level2Groups.map((g, gi) => {
                const isFirst = gi===0
                const bl = isFirst ? `border-left:3px solid ${sec.border}` : `border-left:2px solid ${g.color}50`
                return `<th colspan="${g.count}" style="
                  padding:6px 4px;
                  ${bl};
                  border-top:2px solid ${sec.border};
                  border-bottom:2px solid ${sec.border}80;
                  background:#111827;
                  color:${g.color};
                  font-size:13px;
                  font-weight:800;
                  white-space:nowrap;
                  text-align:center;
                "><i class="fas ${g.icon}" style="margin-right:3px;font-size:11px"></i>${g.label}</th>`
              }).join('')
              return groupCells + `<th style="
                border-left:2px solid rgba(255,255,255,0.25);
                border-right:3px solid ${sec.border};
                border-top:2px solid ${sec.border};
                border-bottom:2px solid ${sec.border}80;
                background:#111827;
                font-size:12px;
                font-weight:800;
                color:${isTot ? '#a5b4fc' : '#f8fafc'};
                text-align:center;
              ">합</th>`
            }).join('')}
          </tr>` : ''}
          <!-- 3행: 세부항목 헤더 (환자군명, 치료식명, 비급여항목명, 직원식항목명) -->
          <tr>
            ${mealSections.map((sec, mi) => {
              const isTot = mi===3
              return allLabels.map((label, li) => {
                const isFirst = li===0
                const isLast = li===allLabels.length-1
                const fieldObj = effectiveCustomFields[li]
                const ptype = fieldObj?.parent_type || 'patient'
                const isLinkedTherapy = fieldObj?._isLinkedTherapy
                // diet type별 배경색 구분 (3행: 약간 밝게)
                const bgMap = {
                  patient:    isTot ? '#0f172a' : '#1e3a8a',
                  therapy:    isTot ? '#0f172a' : '#14532d',
                  noncovered: isTot ? '#0f172a' : '#4a044e',
                  staff:      isTot ? '#0f172a' : '#78350f',
                }
                const colorMap = {
                  patient:    isTot ? '#bfdbfe' : '#bfdbfe',
                  therapy:    isTot ? '#bbf7d0' : '#bbf7d0',
                  noncovered: isTot ? '#e9d5ff' : '#e9d5ff',
                  staff:      isTot ? '#fde68a' : '#fde68a',
                }
                const bg = `background:${bgMap[ptype]||bgMap.patient};`
                const textColor = `color:${colorMap[ptype]||colorMap.patient};`
                const bl = isFirst ? `border-left:3px solid ${sec.border};` : `border-left:1px solid ${sec.border}40;`
                const br = isLast ? `;border-right:1px solid ${sec.border}40` : ''
                const titleAttr = isLinkedTherapy ? `title="${fieldObj._linkedGroupName} 치료식"` : ''
                return `<th ${titleAttr} style="${bl}${bg}${textColor}border-top:2px solid ${sec.border}80;border-bottom:2px solid ${sec.border};${br}padding:6px 3px;font-size:11px;font-weight:700;white-space:nowrap;text-align:center">${isLinkedTherapy?'↳ ':''}${label}</th>`
              }).join('') + `<th style="border-left:2px solid rgba(255,255,255,0.25);border-right:3px solid ${sec.border};border-top:2px solid ${sec.border}80;border-bottom:2px solid ${sec.border};padding:6px 3px;background:${isTot?'#0f172a':'#1e3a8a'};color:#93c5fd;font-size:11px;font-weight:800;text-align:center">합</th>`
            }).join('')}
          </tr>
        </thead>
        <tbody id="mealTableBody">
          ${Array.from({ length: days }, (_, i) => buildMealRow(i+1, mealMap, effectiveCustomFields, colCount)).join('')}
        </tbody>
        <tfoot>
          ${buildMealFooter(mealData, effectiveCustomFields, monthTotal, grandTotal, colCount)}
        </tfoot>
      </table>
    </div>
  </div>

  `
  // 환자군별 식단가 현황은 월별 대시보드로 이동됨

  bindMealInputEvents()
}

function buildMealSummaryCards(monthTotal, customFields, grandTotal, patientGroupStructure, unlinkedTherapies, noncoveredDefs, staffDefs) {
  const useDiet = (window._mealDietCats||[]).length > 0
  const dietCats = window._mealDietCats || []

  let customCards = []

  if (useDiet && patientGroupStructure && patientGroupStructure.length > 0) {
    // ── 일반식 카드 (환자군별) ──
    const pgColors = ['blue','indigo','sky','cyan','teal','violet']
    patientGroupStructure.forEach(({ groupDef, therapyItems }, pi) => {
      const color = pgColors[pi % pgColors.length]
      const pgFkey = groupDef.legacy_field_key || groupDef.diet_key
      const pgVal = monthTotal.custom[pgFkey] || 0
      customCards.push({
        label: groupDef.diet_name, val: pgVal,
        color, id: `mealSummary-${pgFkey}`, unit: 'meal', groupType: 'patient'
      })
    })

    // ── 치료식 카드 (연결+비연결 모두) ──
    // 연결 치료식
    patientGroupStructure.forEach(({ groupDef, therapyItems }) => {
      therapyItems.forEach(t => {
        const tfkey = t.legacy_field_key || t.diet_key
        customCards.push({
          label: t.diet_name, val: monthTotal.custom[tfkey]||0,
          color: 'green', id: `mealSummary-${tfkey}`, unit: 'meal', small: true,
          subLabel: `↳${groupDef.diet_name}`, groupType: 'therapy'
        })
      })
    })
    // 비연결 치료식
    if (unlinkedTherapies && unlinkedTherapies.length > 0) {
      unlinkedTherapies.forEach(t => {
        const tfkey = t.legacy_field_key || t.diet_key
        customCards.push({
          label: t.diet_name, val: monthTotal.custom[tfkey]||0,
          color: 'green', id: `mealSummary-${tfkey}`, unit: 'meal', groupType: 'therapy'
        })
      })
    }

    // ── 비급여식 카드 ──
    if (noncoveredDefs && noncoveredDefs.length > 0) {
      noncoveredDefs.forEach(nc => {
        const nfkey = nc.legacy_field_key || nc.diet_key
        customCards.push({
          label: nc.diet_name, val: monthTotal.custom[nfkey]||0,
          color: 'purple', id: `mealSummary-${nfkey}`, unit: 'meal', groupType: 'noncovered'
        })
      })
    }
    // ── 직원식 카드 ──
    if (staffDefs && staffDefs.length > 0) {
      staffDefs.forEach(sf => {
        const sfkey = sf.legacy_field_key || sf.diet_key
        customCards.push({
          label: sf.diet_name, val: monthTotal.custom[sfkey]||0,
          color: 'amber', id: `mealSummary-${sfkey}`, unit: 'meal', groupType: 'staff'
        })
      })
    }
  } else if (useDiet) {
    // 기존 diet 구조 (환자군 구조 없는 경우)
    ;(window._mealDietCats||[]).forEach(dc => {
      const fkey = dc.legacy_field_key || dc.diet_key
      const DIET_COLORS = { patient:'blue', therapy:'green', noncovered:'purple', staff:'amber' }
      customCards.push({
        label: dc.diet_name, val: monthTotal.custom[fkey]||0,
        color: DIET_COLORS[dc.parent_type]||'indigo',
        id: `mealSummary-${fkey}`, unit: 'meal'
      })
    })
  } else {
    customCards = customFields.map(f => ({
      label: f.field_name, val: monthTotal.custom[f.field_key]||0,
      color:'indigo', id:`mealSummary-${f.field_key}`, unit: f.unit_type||'meal'
    }))
  }

  // baseCards(직원식/비급여/보호자) 완전 제거 - 비급여식/직원식은 이미 dietCat에 포함됨
  const totalCard = { label:'총식수', val:grandTotal, color:'gray', id:'mealSummary-total', bold:true, unit:'meal' }
  return [...customCards, totalCard].map(item => {
    const unitStr = item.unit === 'ea' ? '개' : '식'
    const cardStyle = item.small ? 'min-width:60px;opacity:0.85' : 'min-width:72px'
    const valSize = item.small ? 'text-sm' : 'text-base'
    return `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-2 text-center" style="${cardStyle}">
      <div class="text-xs text-gray-500 font-medium mb-0.5" style="font-size:${item.small?'9px':'11px'}">${item.label}${item.unit==='ea'?'<span style="font-size:9px;color:#f97316">(ea)</span>':''}</div>
      <div class="${valSize} font-bold text-${item.color}-600" id="${item.id}">${fmt(item.val)}</div>
      ${item.subLabel ? `<div style="font-size:8px;color:#9ca3af;line-height:1.2">${item.subLabel}</div>` : ''}
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
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px">
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

  // 커스텀 값만 (diet category 기반) - 기본(직원/비급/보호) 입력칸 제거
  const cVals = customFields.map(f => ({
    key: f.field_key,
    bf: cd[f.field_key]?.bf || 0,
    l:  cd[f.field_key]?.l  || 0,
    d:  cd[f.field_key]?.d  || 0,
    parent_type: f.parent_type || 'patient',
    include_in_meal_price: f.include_in_meal_price || 0,
  }))

  // 소계: 커스텀 필드만 합산 (기본칸 제거)
  const bfSum = cVals.reduce((s,c)=>s+c.bf,0)
  const lSum  = cVals.reduce((s,c)=>s+c.l,0)
  const dSum  = cVals.reduce((s,c)=>s+c.d,0)
  // grandTotal: 비급여 include_in_meal_price=0 제외
  const cValsForGrand = cVals.filter(c => !(c.parent_type==='noncovered' && !c.include_in_meal_price))
  const tGrand = cValsForGrand.reduce((s,c)=>s+c.bf+c.l+c.d,0)

  const mealSections = [
    { prefix:'bf', border:'#3b82f6', bg:'#dbeafe', cPrefix:'bf', sum:bfSum, sumId:`bf-sum-${dateStr}`, sumBg:'bg-blue-50 text-blue-800' },
    { prefix:'l',  border:'#22c55e', bg:'#dcfce7', cPrefix:'l',  sum:lSum,  sumId:`l-sum-${dateStr}`,  sumBg:'bg-green-50 text-green-800' },
    { prefix:'d',  border:'#a855f7', bg:'#f3e8ff', cPrefix:'d',  sum:dSum,  sumId:`d-sum-${dateStr}`,  sumBg:'bg-purple-50 text-purple-800' },
  ]

  let cells = ''
  // 환자 hidden input (레거시 데이터 보존)
  cells += `<td style="display:none">${makeMealInput('bf_p', dateStr, bp)}</td>`
  cells += `<td style="display:none">${makeMealInput('l_p', dateStr, lp)}</td>`
  cells += `<td style="display:none">${makeMealInput('d_p', dateStr, dp)}</td>`

  // diet type별 입력 배경색
  const ptypeBg = { patient:'#f0f9ff', therapy:'#f0fdf4', noncovered:'#faf5ff', staff:'#fffbeb' }

  mealSections.forEach(sec => {
    // 커스텀 칸들만 (기본 직원/비급/보호 칸 제거)
    cVals.forEach((cv, ci) => {
      const bl = ci===0 ? `border-left:3px solid ${sec.border};` : `border-left:1px solid ${sec.bg};`
      const rowBg = ptypeBg[cv.parent_type] || '#fafafa'
      const inputVal = sec.cPrefix === 'bf' ? cv.bf : sec.cPrefix === 'l' ? cv.l : cv.d
      cells += `<td style="${bl}border-top:1px solid ${sec.bg};border-bottom:1px solid ${sec.bg};border-right:1px solid ${sec.bg};background:${rowBg}">${makeMealInput(`${sec.cPrefix}_c_${cv.key}`, dateStr, inputVal)}</td>`
    })
    cells += `<td class="font-semibold text-center ${sec.sumBg}" id="${sec.sumId}" style="border-left:1px solid ${sec.bg};border-right:3px solid ${sec.border}">${sec.sum||''}</td>`
  })

  // 합계 열 - 커스텀 필드만
  cVals.forEach((cv, ci) => {
    const bl = ci===0 ? 'border-left:3px solid #6b7280;' : ''
    const totBg = { patient:'#eff6ff', therapy:'#f0fdf4', noncovered:'#faf5ff', staff:'#fffbeb' }[cv.parent_type] || '#f8fafc'
    cells += `<td class="text-center font-medium" id="t-${cv.key}-${dateStr}" style="${bl}border:1px solid #e0e7ff;background:${totBg}">${(cv.bf+cv.l+cv.d)||''}</td>`
  })
  cells += `<td class="font-bold text-center bg-blue-100 text-blue-900" id="t-total-${dateStr}" style="border:2px solid #93c5fd;border-left:3px solid #6b7280">${tGrand||''}</td>`

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
  // 커스텀 필드만 합산 (기본 직원/비급/보호 제거)
  const bfTotal = customFields.reduce((s,f)=>s+cBf[f.field_key],0)
  const lTotal  = customFields.reduce((s,f)=>s+cL[f.field_key],0)
  const dTotal  = customFields.reduce((s,f)=>s+cD[f.field_key],0)

  // diet type별 배경색
  const footBg = { patient:'bg-blue-50', therapy:'bg-green-50', noncovered:'bg-purple-50', staff:'bg-amber-50' }

  let cells = `<td colspan="2" class="text-center py-2 font-bold">월 합계</td>`
  // 조식: 커스텀 필드만
  customFields.forEach(f => {
    const bg = footBg[f.parent_type] || ''
    cells += `<td class="text-center ${bg}" id="mealFoot-bf-${f.field_key}">${fmt(cBf[f.field_key])}</td>`
  })
  cells += `<td class="text-center bg-blue-100 font-bold" id="mealFoot-bf-sum">${fmt(bfTotal)}</td>`
  // 중식: 커스텀 필드만
  customFields.forEach(f => {
    const bg = footBg[f.parent_type] || ''
    cells += `<td class="text-center ${bg}" id="mealFoot-l-${f.field_key}">${fmt(cL[f.field_key])}</td>`
  })
  cells += `<td class="text-center bg-green-100 font-bold" id="mealFoot-l-sum">${fmt(lTotal)}</td>`
  // 석식: 커스텀 필드만
  customFields.forEach(f => {
    const bg = footBg[f.parent_type] || ''
    cells += `<td class="text-center ${bg}" id="mealFoot-d-${f.field_key}">${fmt(cD[f.field_key])}</td>`
  })
  cells += `<td class="text-center bg-purple-100 font-bold" id="mealFoot-d-sum">${fmt(dTotal)}</td>`
  // 합계: 커스텀 필드만
  customFields.forEach(f => {
    const bg = footBg[f.parent_type] || 'bg-indigo-100'
    cells += `<td class="text-center ${bg} font-bold" id="mealFoot-t-${f.field_key}">${fmt(monthTotal.custom[f.field_key]||0)}</td>`
  })
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
  // dietCats 우선, 없으면 기존 _mealCustomFields
  const fields = (window._mealDietCats||[]).length > 0
    ? (window._mealDietCats||[]).map(dc => ({ field_key: dc.legacy_field_key || dc.diet_key }))
    : (window._mealCustomFields || [])
  fields.forEach(f => {
    customData[f.field_key] = {
      bf: getMealVal(`bf_c_${f.field_key}`, date),
      l:  getMealVal(`l_c_${f.field_key}`, date),
      d:  getMealVal(`d_c_${f.field_key}`, date),
    }
  })
  return customData
}

async function saveMealRow(date) {
  if (isReadOnly(App.currentYear, App.currentMonth)) {
    showToast('⛔ 마감 완료된 달은 수정할 수 없습니다.', 'error'); return
  }
  // diet category 기반: 기본 s/n/g 컬럼은 항상 0 (diet category로 대체됨)
  await api('POST', '/api/meals/save', {
    mealDate: date,
    breakfastPatient: 0, breakfastStaff: 0, breakfastNoncovered: 0, breakfastGuardian: 0,
    lunchPatient: 0, lunchStaff: 0, lunchNoncovered: 0, lunchGuardian: 0,
    dinnerPatient: 0, dinnerStaff: 0, dinnerNoncovered: 0, dinnerGuardian: 0,
    customData: buildCustomData(date)
  })
}

function updateMealRowTotals(date) {
  const g = (k) => getMealVal(k, date)
  // dietCats 우선
  const cf = (window._mealDietCats||[]).length > 0
    ? (window._mealDietCats||[]).map(dc => ({
        field_key: dc.legacy_field_key || dc.diet_key,
        unit_type: 'meal',
        parent_type: dc.parent_type,
        include_in_meal_price: dc.include_in_meal_price || 0,
      }))
    : (window._mealCustomFields || [])

  // 커스텀 합계만 (기본 직원/비급/보호 제거)
  let bfC=0, lC=0, dC=0
  const customTotals = {}
  cf.forEach(f => {
    const bfv=g(`bf_c_${f.field_key}`), lv=g(`l_c_${f.field_key}`), dv=g(`d_c_${f.field_key}`)
    bfC+=bfv; lC+=lv; dC+=dv
    customTotals[f.field_key] = bfv+lv+dv
  })

  const bfSum = bfC, lSum = lC, dSum = dC
  // 총식수: 비급여 include_in_meal_price=0 제외
  const tGrand = cf
    .filter(f => !(f.parent_type==='noncovered' && !f.include_in_meal_price))
    .reduce((s,f) => s+(customTotals[f.field_key]||0), 0)

  const set = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=v||'' }
  set(`bf-sum-${date}`, bfSum)
  set(`l-sum-${date}`, lSum)
  set(`d-sum-${date}`, dSum)
  cf.forEach(f => { set(`t-${f.field_key}-${date}`, customTotals[f.field_key]) })
  set(`t-total-${date}`, tGrand)
  updateMealSummaryCards()
}

function updateMealSummaryCards() {
  // dietCats 우선 (include_in_meal_price, parent_type 포함)
  const cf = (window._mealDietCats||[]).length > 0
    ? (window._mealDietCats||[]).map(dc => ({
        field_key: dc.legacy_field_key || dc.diet_key,
        unit_type: 'meal',
        parent_type: dc.parent_type,
        include_in_meal_price: dc.include_in_meal_price || 0,
      }))
    : (window._mealCustomFields || [])
  const customSums = {}
  const bfC = {}, lC = {}, dC = {}
  cf.forEach(f => { customSums[f.field_key]=0; bfC[f.field_key]=0; lC[f.field_key]=0; dC[f.field_key]=0 })

  document.querySelectorAll('#mealTableBody tr[data-date]').forEach(row => {
    const date = row.dataset.date
    const g = (k) => getMealVal(k, date)
    cf.forEach(f => {
      const bfv=g(`bf_c_${f.field_key}`), lv=g(`l_c_${f.field_key}`), dv=g(`d_c_${f.field_key}`)
      customSums[f.field_key]+=bfv+lv+dv
      bfC[f.field_key]+=bfv; lC[f.field_key]+=lv; dC[f.field_key]+=dv
    })
  })
  // 총식수: 비급여 include_in_meal_price=0 제외
  const grand = cf
    .filter(f => !(f.parent_type==='noncovered' && !f.include_in_meal_price))
    .reduce((s, f) => s + (customSums[f.field_key] || 0), 0)

  const set = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=fmt(v) }
  // 상단 요약 카드 (기본 s/n/g 카드는 제거됨)
  cf.forEach(f => { set(`mealSummary-${f.field_key}`, customSums[f.field_key]) })
  set('mealSummary-total', grand)

  // 환자군 그룹 합산 카드 업데이트 (mealSummary-pg-{fkey})
  const dietCats = window._mealDietCats || []
  if (dietCats.length > 0) {
    const patientDefs = dietCats.filter(dc => dc.parent_type === 'patient')
    patientDefs.forEach(pg => {
      const pgFkey = pg.legacy_field_key || pg.diet_key
      const pgKey = pg.patient_group || pg.diet_key
      const pgVal = customSums[pgFkey] || 0
      const linkedTherapies = dietCats.filter(dc => dc.parent_type === 'therapy' && (dc.linked_patient_group || dc.patient_group) === pgKey)
      const therapySum = linkedTherapies.reduce((s, t) => s + (customSums[t.legacy_field_key || t.diet_key] || 0), 0)
      set(`mealSummary-pg-${pgFkey}`, pgVal + therapySum)
    })
  }

  // 하단 footer 행 실시간 업데이트 (커스텀 필드만)
  const bfTotal = cf.reduce((s,f)=>s+bfC[f.field_key],0)
  const lTotal  = cf.reduce((s,f)=>s+lC[f.field_key],0)
  const dTotal  = cf.reduce((s,f)=>s+dC[f.field_key],0)
  cf.forEach(f => { set(`mealFoot-bf-${f.field_key}`,bfC[f.field_key]); set(`mealFoot-l-${f.field_key}`,lC[f.field_key]); set(`mealFoot-d-${f.field_key}`,dC[f.field_key]) })
  set('mealFoot-bf-sum',bfTotal); set('mealFoot-l-sum',lTotal); set('mealFoot-d-sum',dTotal)
  cf.forEach(f => { set(`mealFoot-t-${f.field_key}`,customSums[f.field_key]) })
  set('mealFoot-t-total',grand)
}

async function saveMealBatch() {
  if (isReadOnly(App.currentYear, App.currentMonth)) {
    showToast('⛔ 마감 완료된 달은 수정할 수 없습니다.', 'error'); return
  }
  const rows = document.querySelectorAll('#mealTableBody tr[data-date]')
  let saved = 0
  const promises = []

  const btn = document.querySelector('button[onclick="saveMealBatch()"]')
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> 저장 중...' }

  rows.forEach(row => {
    const date = row.dataset.date
    const g = (k) => getMealVal(k, date)
    // diet category 기반만 (기본 s/n/g 컬럼 완전 제거)
    const dietCf = (window._mealDietCats||[]).length > 0
      ? (window._mealDietCats||[]).map(dc => ({ field_key: dc.legacy_field_key || dc.diet_key }))
      : (window._mealCustomFields || [])
    const customSum = dietCf.reduce((s,f)=>s+g(`bf_c_${f.field_key}`)+g(`l_c_${f.field_key}`)+g(`d_c_${f.field_key}`),0)
    if (customSum > 0) {
      saved++
      promises.push(api('POST', '/api/meals/save', {
        mealDate: date,
        breakfastPatient: 0, breakfastStaff: 0, breakfastNoncovered: 0, breakfastGuardian: 0,
        lunchPatient: 0, lunchStaff: 0, lunchNoncovered: 0, lunchGuardian: 0,
        dinnerPatient: 0, dinnerStaff: 0, dinnerNoncovered: 0, dinnerGuardian: 0,
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
  // 분석 페이지 재진입 시 기존 Chart 인스턴스 파괴 (canvas 재사용 충돌 방지)
  const anaChartIds = [
    'chart-yrBudget','chart-yrMealPrice','chart-yrMeals','chart-yrVendor','chart-yrWaste',
    'chart-yrVendorPie','chart-yrMpDetail','chart-mpMonthly','chart-mealStack',
    'chart-budgetPct','chart-wasteMonthly','chart-vendorMonthly','chart-catMonthly','chart-catBudgetPct'
  ]
  anaChartIds.forEach(id => {
    const el = document.getElementById(id)
    if (el) { const ch = Chart.getChart ? Chart.getChart(el) : null; if (ch) ch.destroy() }
  })
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
        <h3 class="font-bold text-gray-700 text-sm mb-3"><i class="fas fa-trash text-amber-500 mr-1"></i>연도별 잔반 (L) 비교</h3>
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
  </div>
  <!-- 2.7 식재료 단가 분석 섹션 (동적 로드) -->
  <div id="ingredientAnalysisSection"></div>`
  const ingredientSectionEl = document.getElementById('ingredientAnalysisSection')
  if (ingredientSectionEl) {
    const ingData = await api('GET', `/api/settings/ingredient-prices/${curYear}/${App.currentMonth}${selectedHospitalId ? `?hospitalId=${selectedHospitalId}` : ''}`).catch(()=>[]) || []
    if (ingData.length > 0) {
      const ingRows = ingData.map(r => {
        const momDiff = r.mom_diff
        const yoyDiff = r.yoy_diff
        const momColor = momDiff > 0 ? 'text-red-600' : momDiff < 0 ? 'text-green-600' : 'text-gray-500'
        const yoyColor = yoyDiff > 0 ? 'text-red-600' : yoyDiff < 0 ? 'text-green-600' : 'text-gray-500'
        const momArrow = momDiff > 0 ? '▲' : momDiff < 0 ? '▼' : '—'
        const yoyArrow = yoyDiff > 0 ? '▲' : yoyDiff < 0 ? '▼' : '—'
        return `<tr class="border-b border-gray-100 hover:bg-gray-50">
          <td class="py-2 px-3 font-medium text-gray-800">${r.ingredient_name}</td>
          <td class="py-2 px-3 text-center text-gray-500 text-xs">${r.unit||'kg'}</td>
          <td class="py-2 px-3 text-right font-bold text-gray-900">${fmt(r.unit_price)}원</td>
          <td class="py-2 px-3 text-right text-xs">
            ${r.prev_price > 0 ? `<span class="text-gray-500">${fmt(r.prev_price)}원</span><br><span class="${momColor} font-semibold">${momArrow}${momDiff !== null ? Math.abs(momDiff).toLocaleString()+'원' : ''}</span>` : '<span class="text-gray-300">-</span>'}
          </td>
          <td class="py-2 px-3 text-right text-xs">
            ${r.prev_year_price > 0 ? `<span class="text-gray-500">${fmt(r.prev_year_price)}원</span><br><span class="${yoyColor} font-semibold">${yoyArrow}${yoyDiff !== null ? Math.abs(yoyDiff).toLocaleString()+'원' : ''}</span>` : '<span class="text-gray-300">-</span>'}
          </td>
          <td class="py-2 px-3 text-xs text-gray-400">${r.memo||''}</td>
        </tr>`
      }).join('')

      ingredientSectionEl.innerHTML = `
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mt-4">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-bold text-gray-700 text-sm">
            <i class="fas fa-leaf text-green-500 mr-1"></i>주요 식재료 단가 분석 (${curYear}년 ${App.currentMonth}월)
          </h3>
          <button onclick="showIngredientPricesModal(${curYear},${App.currentMonth})" class="text-xs text-green-600 hover:underline font-medium">
            <i class="fas fa-edit mr-1"></i>단가 입력
          </button>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-green-50 text-xs text-gray-600">
                <th class="text-left py-2 px-3">식재료명</th>
                <th class="text-center py-2 px-3">단위</th>
                <th class="text-right py-2 px-3">당월 단가</th>
                <th class="text-right py-2 px-3">전월 대비</th>
                <th class="text-right py-2 px-3">전년 동월 대비</th>
                <th class="text-left py-2 px-3">메모</th>
              </tr>
            </thead>
            <tbody>${ingRows}</tbody>
          </table>
        </div>
      </div>`
    } else {
      ingredientSectionEl.innerHTML = `
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mt-4">
        <div class="flex items-center justify-between">
          <h3 class="font-bold text-gray-700 text-sm"><i class="fas fa-leaf text-green-500 mr-1"></i>주요 식재료 단가 분석</h3>
          <button onclick="showIngredientPricesModal(${curYear},${App.currentMonth})" class="btn btn-success btn-sm">
            <i class="fas fa-plus mr-1"></i>단가 입력
          </button>
        </div>
        <p class="text-xs text-gray-400 mt-2 text-center py-3">이번 달 식재료 단가 데이터가 없습니다. 단가를 입력해주세요.</p>
      </div>`
    }
  }

  // ── 공통 차트 색상
  // 차트 초기화 전: 모든 탭 content를 잠시 visible로 설정 (hidden 상태에서 chart 초기화 시 0px 크기 방지)
  ;['annual','monthly'].forEach(t => {
    const el = document.getElementById(`anaContent-${t}`)
    if (el) el.style.display = ''
  })

  // 이전 분석 차트 인스턴스 제거 (재방문 시 canvas 재사용 문제 방지)
  const anaCanvasIds = [
    'chart-yrBudget','chart-yrMealPrice','chart-yrMeals','chart-yrVendor',
    'chart-yrWaste','chart-yrVendorPie','chart-yrMpDetail',
    'chart-mpMonthly','chart-mealStack','chart-budgetPct','chart-wasteMonthly',
    'chart-vendorMonthly','chart-catMonthly','chart-catBudgetPct'
  ]
  anaCanvasIds.forEach(id => {
    const el = document.getElementById(id)
    if (el) { const c = typeof Chart !== 'undefined' && Chart.getChart ? Chart.getChart(el) : null; if (c) c.destroy() }
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

  // ── 연도별 비교 차트 ⑤: 잔반 L 비교
  new Chart(document.getElementById('chart-yrWaste'), {
    type:'bar', data:{
      labels: months,
      datasets:[
        { label:`${curYear}년 잔반(L)`, data:yr1.waste, backgroundColor:'rgba(245,158,11,0.75)', borderRadius:4 },
        { label:`${curYear-1}년 잔반(L)`, data:yr2.waste, backgroundColor:'rgba(245,158,11,0.4)', borderRadius:4 },
        { label:`${curYear-2}년 잔반(L)`, data:yr3.waste, backgroundColor:'rgba(209,213,219,0.5)', borderRadius:4 }
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
        { label:'잔반량(L)', data:wasteKgByMonth, backgroundColor:'rgba(245,158,11,0.7)', borderRadius:4, yAxisID:'y' },
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

// ── 2.8 잔반 입력 모달 (업그레이드: 병원별 단가 설정 + 자동계산) ──
window.showFoodWasteModal = async function(year, month) {
  const _ro = isReadOnly(year, month)
  const [existing, summary] = await Promise.all([
    api('GET', `/api/settings/food-waste/${year}/${month}`) || [],
    api('GET', `/api/settings/food-waste-summary/${year}/${month}`).catch(()=>null)
  ])
  const weeks = [1,2,3,4,5]
  const wMap = {}
  ;(existing||[]).forEach(w => { wMap[w.week] = w })
  const unitPrice = summary?.unitPrice || 0

  let modal = document.getElementById('foodWasteModal')
  if (!modal) {
    modal = document.createElement('div')
    modal.id = 'foodWasteModal'
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9000;display:flex;align-items:center;justify-content:center;overflow-y:auto;'
    document.body.appendChild(modal)
  }
  modal.innerHTML = `
  <div class="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg mx-4 my-4">
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-bold text-gray-800"><i class="fas fa-recycle text-amber-500 mr-2"></i>잔반 기록 - ${year}년 ${month}월</h3>
      <button onclick="document.getElementById('foodWasteModal').remove()" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>
    </div>

    <!-- 단가 설정 -->
    <div class="p-3 bg-amber-50 border border-amber-200 rounded-xl mb-4">
      <div class="flex items-center gap-3">
        <div class="flex-1">
          <label class="text-xs font-semibold text-amber-700 mb-1 block"><i class="fas fa-tag mr-1"></i>잔반 처리 단가 (L당, 원)</label>
          <input type="number" id="fw-unit-price" class="form-input text-sm w-full" min="0" step="100"
            value="${unitPrice||''}" placeholder="예: 500 (0이면 비용 직접 입력)">
        </div>
        <button onclick="saveFoodWasteUnitPrice(${year},${month})"
          class="mt-4 px-3 py-2 bg-amber-500 text-white text-xs rounded-lg hover:bg-amber-600 font-semibold whitespace-nowrap">
          단가 저장
        </button>
      </div>
      <p class="text-xs text-amber-600 mt-1">단가 입력 시 kg × 단가로 비용 자동 계산. 개별 비용 직접 입력도 가능합니다.</p>
    </div>

    <!-- 주차별 입력 -->
    <div class="space-y-2">
      ${weeks.map(w => {
        const d = wMap[w] || {}
        return `
        <div class="p-3 bg-gray-50 rounded-xl">
          <div class="font-semibold text-sm text-gray-700 mb-2">${w}주차</div>
          <div class="grid grid-cols-3 gap-2">
            <div>
              <label class="text-xs text-gray-500">잔반량(L)</label>
              <input type="number" id="fw-amount-${w}" class="form-input text-sm" step="0.1" min="0"
                value="${d.waste_amount||''}" placeholder="0.0"
                oninput="autoCalcWasteCost(${w})">
            </div>
            <div>
              <label class="text-xs text-gray-500">비용(원) <span class="text-amber-500 text-xs">(자동/직접)</span></label>
              <input type="number" id="fw-cost-${w}" class="form-input text-sm" min="0"
                value="${d.waste_cost||''}" placeholder="자동계산">
            </div>
            <div>
              <label class="text-xs text-gray-500">메모</label>
              <input type="text" id="fw-memo-${w}" class="form-input text-sm" value="${d.memo||''}" placeholder="">
            </div>
          </div>
        </div>`
      }).join('')}
    </div>

    <!-- 합계 -->
    <div class="mt-3 p-3 bg-gray-100 rounded-xl flex justify-between text-sm font-semibold text-gray-700">
      <span><i class="fas fa-weight text-amber-500 mr-1"></i>총 잔반량: <span id="fw-total-kg">${summary?.totalL?.toFixed(1)||'0.0'}</span> L</span>
      <span><i class="fas fa-won-sign text-red-500 mr-1"></i>총 비용: <span id="fw-total-cost">${fmt(summary?.totalCost||0)}</span> 원</span>
    </div>

    <div class="flex gap-3 mt-4">
      ${_ro
        ? `<div class="flex-1 text-center text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2"><i class="fas fa-lock mr-1"></i>마감 완료된 달은 수정할 수 없습니다.</div>`
        : `<button onclick="saveFoodWaste(${year},${month})" class="btn btn-primary flex-1"><i class="fas fa-save mr-1"></i>저장</button>`
      }
      <button onclick="document.getElementById('foodWasteModal').remove()" class="btn btn-secondary">취소</button>
    </div>
  </div>`
  modal.style.display = 'flex'
}

// 잔반 kg 입력 시 단가 기준 비용 자동계산
window.autoCalcWasteCost = function(week) {
  const unitPrice = parseFloat(document.getElementById('fw-unit-price')?.value || 0) || 0
  if (unitPrice <= 0) return
  const kg = parseFloat(document.getElementById(`fw-amount-${week}`)?.value || 0) || 0
  const costEl = document.getElementById(`fw-cost-${week}`)
  if (costEl) costEl.value = Math.round(kg * unitPrice)
  // 합계 업데이트
  let totalL = 0, totalCost = 0
  for (let w = 1; w <= 5; w++) {
    totalL += parseFloat(document.getElementById(`fw-amount-${w}`)?.value || 0) || 0
    totalCost += parseInt(document.getElementById(`fw-cost-${w}`)?.value || 0) || 0
  }
  const tkEl = document.getElementById('fw-total-kg')
  const tcEl = document.getElementById('fw-total-cost')
  if (tkEl) tkEl.textContent = totalL.toFixed(1)
  if (tcEl) tcEl.textContent = fmt(totalCost)
}

// 잔반 단가 저장
window.saveFoodWasteUnitPrice = async function(year, month) {
  const unitPrice = parseInt(document.getElementById('fw-unit-price')?.value || 0) || 0
  await api('POST', '/api/settings/waste-unit-price', { year, month, waste_unit_price: unitPrice })
  showToast('잔반 단가가 저장되었습니다.', 'success')
  // 자동계산 다시 실행
  for (let w = 1; w <= 5; w++) autoCalcWasteCost(w)
}

window.saveFoodWaste = async function(year, month) {
  if (isReadOnly(year, month)) { showToast('⛔ 마감 완료된 달은 수정할 수 없습니다.', 'error'); return }
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

// ── 2.7 식재료 단가 입력 모달 ─────────────────────────────────────
window.showIngredientPricesModal = async function(year, month) {
  const DEFAULT_INGREDIENTS = [
    { name: '쌀', unit: 'kg' },
    { name: '닭고기', unit: 'kg' },
    { name: '돼지고기', unit: 'kg' },
    { name: '두부', unit: 'kg' },
    { name: '계란', unit: '개' },
    { name: '채소류', unit: 'kg' },
    { name: '생선류', unit: 'kg' },
    { name: '쇠고기', unit: 'kg' },
  ]
  const existing = await api('GET', `/api/settings/ingredient-prices/${year}/${month}`) || []
  const eMap = {}
  existing.forEach(r => { eMap[r.ingredient_name] = r })

  // 기존에 없는 기본 식재료 추가
  const allNames = [...new Set([...DEFAULT_INGREDIENTS.map(d=>d.name), ...existing.map(r=>r.ingredient_name)])]
  const rows = allNames.map(name => {
    const def = DEFAULT_INGREDIENTS.find(d=>d.name===name) || { name, unit:'kg' }
    const ex = eMap[name] || {}
    return { name, unit: ex.unit||def.unit, price: ex.unit_price||'', prevPrice: ex.prev_price||0, prevYearPrice: ex.prev_year_price||0, memo: ex.memo||'' }
  })

  let modal = document.getElementById('ingredientModal')
  if (!modal) {
    modal = document.createElement('div')
    modal.id = 'ingredientModal'
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9000;display:flex;align-items:center;justify-content:center;overflow-y:auto;'
    document.body.appendChild(modal)
  }

  const prevM = month===1 ? 12 : month-1
  const prevMLabel = `${month===1?year-1:year}년 ${prevM}월`
  const prevYLabel = `${year-1}년 ${month}월`

  modal.innerHTML = `
  <div class="bg-white rounded-2xl shadow-xl p-6 w-full max-w-2xl mx-4 my-4">
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-bold text-gray-800"><i class="fas fa-leaf text-green-500 mr-2"></i>주요 식재료 단가 - ${year}년 ${month}월</h3>
      <button onclick="document.getElementById('ingredientModal').remove()" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>
    </div>
    <p class="text-xs text-gray-500 mb-3">식재료별 당월 단가를 입력하세요. 전월·전년 대비 변동이 자동으로 표시됩니다.</p>

    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-gray-100 text-xs text-gray-600">
            <th class="py-2 px-2 text-left">식재료</th>
            <th class="py-2 px-2 text-center">단위</th>
            <th class="py-2 px-2 text-right">당월 단가(원)</th>
            <th class="py-2 px-2 text-right">${prevMLabel}</th>
            <th class="py-2 px-2 text-right">${prevYLabel}</th>
            <th class="py-2 px-2 text-left">메모</th>
          </tr>
        </thead>
        <tbody id="ingredient-tbody">
          ${rows.map((r,i) => `
          <tr class="border-b border-gray-100" data-idx="${i}">
            <td class="py-2 px-2">
              <input type="text" class="form-input text-xs py-1" id="ing-name-${i}" value="${r.name}" style="width:90px">
            </td>
            <td class="py-2 px-2 text-center">
              <select class="form-input text-xs py-1" id="ing-unit-${i}" style="width:60px">
                <option value="kg" ${r.unit==='kg'?'selected':''}>kg</option>
                <option value="개" ${r.unit==='개'?'selected':''}>개</option>
                <option value="박스" ${r.unit==='박스'?'selected':''}>박스</option>
                <option value="묶음" ${r.unit==='묶음'?'selected':''}>묶음</option>
              </select>
            </td>
            <td class="py-2 px-2">
              <input type="number" class="form-input text-xs py-1 text-right" id="ing-price-${i}"
                value="${r.price||''}" placeholder="0" min="0" style="width:90px"
                oninput="updateIngredientDiff(${i},${r.prevPrice},${r.prevYearPrice})">
            </td>
            <td class="py-2 px-2 text-right text-gray-500 text-xs" id="ing-prev-${i}">
              ${r.prevPrice>0 ? fmt(r.prevPrice)+'원' : '-'}
            </td>
            <td class="py-2 px-2 text-right text-gray-500 text-xs" id="ing-prevy-${i}">
              ${r.prevYearPrice>0 ? fmt(r.prevYearPrice)+'원' : '-'}
            </td>
            <td class="py-2 px-2">
              <input type="text" class="form-input text-xs py-1" id="ing-memo-${i}" value="${r.memo||''}" placeholder="" style="width:80px">
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="flex gap-3 mt-4">
      <button onclick="saveIngredientPrices(${year},${month},${rows.length})" class="btn btn-primary flex-1">
        <i class="fas fa-save mr-1"></i>저장
      </button>
      <button onclick="document.getElementById('ingredientModal').remove()" class="btn btn-secondary">취소</button>
    </div>
  </div>`
  modal.style.display = 'flex'
}

window.updateIngredientDiff = function(idx, prevPrice, prevYearPrice) {
  const cur = parseInt(document.getElementById(`ing-price-${idx}`)?.value||0)||0
  // 시각적 피드백 (전월 대비)
  const prevEl = document.getElementById(`ing-prev-${idx}`)
  if (prevEl && prevPrice > 0 && cur > 0) {
    const diff = cur - prevPrice
    const pct = ((diff/prevPrice)*100).toFixed(1)
    const color = diff > 0 ? 'text-red-500' : diff < 0 ? 'text-green-600' : 'text-gray-500'
    const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '—'
    prevEl.innerHTML = `${fmt(prevPrice)}원<br><span class="${color} font-semibold">${arrow}${Math.abs(diff).toLocaleString()}(${pct>0?'+':''}${pct}%)</span>`
  }
}

window.saveIngredientPrices = async function(year, month, count) {
  const items = []
  for (let i = 0; i < count; i++) {
    const name = document.getElementById(`ing-name-${i}`)?.value?.trim()
    const unit = document.getElementById(`ing-unit-${i}`)?.value || 'kg'
    const price = parseInt(document.getElementById(`ing-price-${i}`)?.value||0)||0
    const memo = document.getElementById(`ing-memo-${i}`)?.value||''
    if (name && price > 0) items.push({ ingredient_name: name, unit, unit_price: price, memo })
  }
  if (!items.length) { showToast('입력된 단가가 없습니다.', 'warning'); return }
  const res = await api('POST', '/api/settings/ingredient-prices', { year, month, items })
  if (res?.success) {
    document.getElementById('ingredientModal')?.remove()
    showToast(`식재료 단가 ${res.saved}건 저장됨`, 'success')
    // 분석 화면 갱신
    if (window._currentPage === 'comparison' || window._currentPage === 'analysis') renderAnalysis?.()
  } else {
    showToast('저장 실패', 'error')
  }
}

// ── #8 식재료 단가 분석 독립 페이지 ──────────────────────────────
async function renderIngredientPricesPage() {
  const content = document.getElementById('pageContent')
  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`

  const year  = App.currentYear
  const month = App.currentMonth

  // 현재 + 전월 + 전년 데이터 병렬 로드
  const prevM = month === 1 ? 12 : month - 1
  const prevY = month === 1 ? year - 1 : year
  const prevMLabel = `${prevY}년 ${prevM}월`
  const prevYLabel = `${year-1}년 ${month}월`

  const [data, prevData, prevYData] = await Promise.all([
    api('GET', `/api/settings/ingredient-prices/${year}/${month}`).catch(()=>[]),
    api('GET', `/api/settings/ingredient-prices/${prevY}/${prevM}`).catch(()=>[]),
    api('GET', `/api/settings/ingredient-prices/${year-1}/${month}`).catch(()=>[]),
  ])

  const DEFAULT_INGREDIENTS = [
    { name: '쌀', unit: 'kg' }, { name: '닭고기', unit: 'kg' }, { name: '돼지고기', unit: 'kg' },
    { name: '두부', unit: 'kg' }, { name: '계란', unit: '개' }, { name: '양파', unit: 'kg' },
    { name: '감자', unit: 'kg' }, { name: '당근', unit: 'kg' }, { name: '배추', unit: 'kg' },
    { name: '양배추', unit: 'kg' }, { name: '대파', unit: 'kg' }, { name: '마늘', unit: 'kg' },
    { name: '쇠고기', unit: 'kg' },
  ]

  const eMap = {}, pMap = {}, pyMap = {}
  ;(data||[]).forEach(r => { eMap[r.ingredient_name] = r })
  ;(prevData||[]).forEach(r => { pMap[r.ingredient_name] = r })
  ;(prevYData||[]).forEach(r => { pyMap[r.ingredient_name] = r })

  const allNames = [...new Set([
    ...DEFAULT_INGREDIENTS.map(d=>d.name),
    ...(data||[]).map(r=>r.ingredient_name)
  ])]
  const rows = allNames.map(name => {
    const def = DEFAULT_INGREDIENTS.find(d=>d.name===name) || { name, unit:'kg' }
    const ex  = eMap[name] || {}
    const prev = pMap[name] || {}
    const prevY = pyMap[name] || {}
    return {
      name, unit: ex.unit || def.unit,
      price: ex.unit_price || '',
      prevPrice: prev.unit_price || 0,
      prevYearPrice: prevY.unit_price || 0,
      memo: ex.memo || ''
    }
  })

  // 단가 변동 분석 카드 (입력된 데이터만)
  const filled = rows.filter(r => r.price > 0)
  const risings = filled.filter(r => r.prevPrice > 0 && r.price > r.prevPrice)
    .sort((a,b) => ((b.price-b.prevPrice)/b.prevPrice) - ((a.price-a.prevPrice)/a.prevPrice))
  const fallings = filled.filter(r => r.prevPrice > 0 && r.price < r.prevPrice)
    .sort((a,b) => ((a.price-a.prevPrice)/a.prevPrice) - ((b.price-b.prevPrice)/b.prevPrice))

  content.innerHTML = `
  <div class="max-w-5xl mx-auto px-2 py-4">
    <!-- 헤더 -->
    <div class="flex items-center justify-between mb-3">
      <div>
        <h1 class="text-xl font-bold text-gray-800 flex items-center gap-2">
          <i class="fas fa-leaf text-green-500"></i>
          식재료 단가 분석
        </h1>
        <p class="text-xs text-gray-400 mt-0.5">${year}년 ${month}월 기준 · 전월(${prevMLabel}) · 전년동월(${prevYLabel}) 비교</p>
      </div>
      <div class="flex gap-2">
        <select id="ingYearSel" class="form-input text-sm py-1.5" onchange="reloadIngPage()">
          ${[year-1,year].map(y=>`<option value="${y}" ${y===year?'selected':''}>${y}년</option>`).join('')}
        </select>
        <select id="ingMonthSel" class="form-input text-sm py-1.5" onchange="reloadIngPage()">
          ${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${i+1===month?'selected':''}>${i+1}월</option>`).join('')}
        </select>
      </div>
    </div>

    <!-- 탭 -->
    <div style="display:flex;gap:2px;margin-bottom:14px;border-bottom:2px solid #e5e7eb">
      <button onclick="switchIngTab('my')" id="ingTab_my" style="padding:7px 16px;font-size:13px;font-weight:600;border:none;background:none;cursor:pointer;border-bottom:2px solid #16a34a;color:#16a34a;margin-bottom:-2px">
        <i class="fas fa-edit mr-1"></i>단가 입력
      </button>
      <button onclick="switchIngTab('vendor')" id="ingTab_vendor" style="padding:7px 16px;font-size:13px;font-weight:600;border:none;background:none;cursor:pointer;color:#9ca3af;border-bottom:2px solid transparent;margin-bottom:-2px">
        <i class="fas fa-store mr-1"></i>업체별 비교
      </button>
    </div>

    <!-- 단가 입력 탭 -->
    <div id="ingTabContent_my">
    ${filled.length > 0 ? `
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-3">
        <div class="text-xs text-gray-400 mb-1">입력 품목</div>
        <div class="text-xl font-bold text-gray-800">${filled.length}<span class="text-xs text-gray-400 ml-1">종</span></div>
      </div>
      <div class="bg-white rounded-xl border border-red-100 shadow-sm p-3">
        <div class="text-xs text-gray-400 mb-1">전월 대비 상승</div>
        <div class="text-xl font-bold text-red-600">${risings.length}<span class="text-xs text-red-400 ml-1">종</span></div>
        ${risings.length > 0 ? `<div class="text-xs text-red-500 mt-1">▲ ${risings[0].name} +${(((risings[0].price-risings[0].prevPrice)/risings[0].prevPrice)*100).toFixed(1)}%</div>` : ''}
      </div>
      <div class="bg-white rounded-xl border border-green-100 shadow-sm p-3">
        <div class="text-xs text-gray-400 mb-1">전월 대비 하락</div>
        <div class="text-xl font-bold text-green-600">${fallings.length}<span class="text-xs text-green-400 ml-1">종</span></div>
        ${fallings.length > 0 ? `<div class="text-xs text-green-600 mt-1">▼ ${fallings[0].name} ${(((fallings[0].price-fallings[0].prevPrice)/fallings[0].prevPrice)*100).toFixed(1)}%</div>` : ''}
      </div>
      <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-3">
        <div class="text-xs text-gray-400 mb-1">미변동</div>
        <div class="text-xl font-bold text-gray-500">${filled.filter(r=>r.prevPrice>0&&r.price===r.prevPrice).length}<span class="text-xs text-gray-400 ml-1">종</span></div>
      </div>
    </div>` : ''}

    <!-- 단가 입력 테이블 -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-4">
      <div class="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <h2 class="font-bold text-gray-800 text-sm"><i class="fas fa-table text-green-500 mr-1"></i>품목별 단가 입력</h2>
        <div class="flex gap-2 flex-wrap">
          <!-- #5 엑셀 자동 분석 버튼 -->
          <label style="background:#7c3aed;color:white;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:5px">
            <i class="fas fa-file-excel"></i>엑셀 자동분석
            <input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="autoAnalyzeIngredientFromExcel(this,${year},${month})">
          </label>
          <button onclick="addIngredientRow()" class="btn btn-secondary btn-sm">
            <i class="fas fa-plus mr-1"></i>품목 추가
          </button>
          <button onclick="saveIngredientPricesPage(${year},${month})" class="btn btn-primary btn-sm">
            <i class="fas fa-save mr-1"></i>저장
          </button>
        </div>
      </div>
      <!-- #5 엑셀 업로드 안내 -->
      <div id="ingExcelHint" style="background:#f5f3ff;border-bottom:1px solid #e9d5ff;padding:10px 16px;font-size:11px;color:#7c3aed;display:flex;align-items:flex-start;gap:8px">
        <i class="fas fa-info-circle mt-0.5"></i>
        <span><strong>엑셀 자동분석:</strong> 삼성웰스토리, 아워홈 등 거래내역 엑셀 파일을 업로드하면 쌀·닭고기·돼지고기 등 주요 식재료 단가를 자동으로 분석합니다.<br>
        분석된 단가는 표에 자동 입력됩니다. (단가 = 금액 ÷ 수량)</span>
        <button onclick="document.getElementById('ingExcelHint').style.display='none'" style="background:none;border:none;color:#a78bfa;cursor:pointer;font-size:14px;flex-shrink:0">✕</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm" id="ingTable">
          <thead>
            <tr class="bg-gray-50 text-xs text-gray-500">
              <th class="py-2.5 px-3 text-left font-semibold">식재료</th>
              <th class="py-2.5 px-3 text-center font-semibold">단위</th>
              <th class="py-2.5 px-3 text-right font-semibold">당월 단가(원)</th>
              <th class="py-2.5 px-3 text-right font-semibold">${prevMLabel}</th>
              <th class="py-2.5 px-3 text-right font-semibold">전월 대비</th>
              <th class="py-2.5 px-3 text-right font-semibold">${prevYLabel}</th>
              <th class="py-2.5 px-3 text-right font-semibold">전년 대비</th>
              <th class="py-2.5 px-3 text-left font-semibold">메모</th>
            </tr>
          </thead>
          <tbody id="ing-page-tbody">
            ${rows.map((r,i) => buildIngRow(i, r, prevMLabel, prevYLabel)).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="text-xs text-gray-400 text-right">* 단가 입력 후 저장 버튼을 클릭하세요.</div>
  </div>`

  window._ingPageRows = rows
}

function buildIngRow(i, r, prevMLabel, prevYLabel) {
  const diffPrev = r.prevPrice > 0 && r.price > 0
    ? (() => {
        const d = r.price - r.prevPrice
        const p = ((d/r.prevPrice)*100).toFixed(1)
        return `<span style="color:${d>0?'#dc2626':d<0?'#16a34a':'#6b7280'};font-weight:700">${d>0?'▲':'▼'} ${Math.abs(d).toLocaleString()}원 (${d>0?'+':''}${p}%)</span>`
      })()
    : '<span style="color:#9ca3af">-</span>'
  const diffYear = r.prevYearPrice > 0 && r.price > 0
    ? (() => {
        const d = r.price - r.prevYearPrice
        const p = ((d/r.prevYearPrice)*100).toFixed(1)
        return `<span style="color:${d>0?'#dc2626':d<0?'#16a34a':'#6b7280'};font-weight:700">${d>0?'▲':'▼'} ${Math.abs(d).toLocaleString()}원 (${d>0?'+':''}${p}%)</span>`
      })()
    : '<span style="color:#9ca3af">-</span>'

  const rowBg = r.price > 0 && r.prevPrice > 0
    ? r.price > r.prevPrice ? 'background:#fff5f5' : r.price < r.prevPrice ? 'background:#f0fdf4' : ''
    : ''

  return `<tr class="border-b border-gray-50" data-ing-idx="${i}" style="${rowBg}">
    <td class="py-2 px-3">
      <input type="text" class="form-input text-xs py-1 ing-name" id="ing-pname-${i}" value="${r.name}" style="width:90px">
    </td>
    <td class="py-2 px-3 text-center">
      <select class="form-input text-xs py-1 ing-unit" id="ing-punit-${i}" style="width:56px">
        ${['kg','개','박스','묶음','L','봉','팩'].map(u=>`<option value="${u}" ${r.unit===u?'selected':''}>${u}</option>`).join('')}
      </select>
    </td>
    <td class="py-2 px-3">
      <input type="number" class="form-input text-xs py-1 text-right ing-price" id="ing-pprice-${i}"
        value="${r.price||''}" placeholder="0" min="0" style="width:90px"
        data-prev-price="${r.prevPrice||0}" data-prev-year-price="${r.prevYearPrice||0}"
        oninput="refreshIngRow(${i},${r.prevPrice},${r.prevYearPrice})">
    </td>
    <td class="py-2 px-3 text-right text-xs text-gray-500" id="ing-pprev-${i}">
      ${r.prevPrice > 0 ? r.prevPrice.toLocaleString()+'원' : '-'}
    </td>
    <td class="py-2 px-3 text-right text-xs" id="ing-pdiff-${i}">${diffPrev}</td>
    <td class="py-2 px-3 text-right text-xs text-gray-500" id="ing-pprevy-${i}">
      ${r.prevYearPrice > 0 ? r.prevYearPrice.toLocaleString()+'원' : '-'}
    </td>
    <td class="py-2 px-3 text-right text-xs" id="ing-pdiffy-${i}">${diffYear}</td>
    <td class="py-2 px-3">
      <input type="text" class="form-input text-xs py-1 ing-memo" id="ing-pmemo-${i}" value="${r.memo||''}" placeholder="" style="width:80px">
    </td>
  </tr>`
}

window.toggleVendorShareView = function(view) {
  const chartView = document.getElementById('vendorShareChartView')
  const tableView = document.getElementById('vendorShareTableView')
  const btnChart  = document.getElementById('vsBtn_chart')
  const btnTable  = document.getElementById('vsBtn_table')
  if (!chartView || !tableView) return
  if (view === 'chart') {
    chartView.style.display = ''; tableView.style.display = 'none'
    if (btnChart) { btnChart.style.background = '#1d4ed8'; btnChart.style.color = 'white' }
    if (btnTable) { btnTable.style.background = 'white'; btnTable.style.color = '#1d4ed8' }
  } else {
    chartView.style.display = 'none'; tableView.style.display = ''
    if (btnTable) { btnTable.style.background = '#1d4ed8'; btnTable.style.color = 'white' }
    if (btnChart) { btnChart.style.background = 'white'; btnChart.style.color = '#1d4ed8' }
  }
}

window.refreshIngRow = function(i, prevPrice, prevYearPrice) {
  const cur = parseInt(document.getElementById(`ing-pprice-${i}`)?.value||0)||0
  const diffEl = document.getElementById(`ing-pdiff-${i}`)
  const diffYEl = document.getElementById(`ing-pdiffy-${i}`)
  const rowEl = document.querySelector(`tr[data-ing-idx="${i}"]`)
  if (diffEl && prevPrice > 0 && cur > 0) {
    const d = cur - prevPrice, p = ((d/prevPrice)*100).toFixed(1)
    diffEl.innerHTML = `<span style="color:${d>0?'#dc2626':d<0?'#16a34a':'#6b7280'};font-weight:700">${d>0?'▲':'▼'} ${Math.abs(d).toLocaleString()}원 (${d>0?'+':''}${p}%)</span>`
    if (rowEl) rowEl.style.background = d > 0 ? '#fff5f5' : d < 0 ? '#f0fdf4' : ''
  }
  if (diffYEl && prevYearPrice > 0 && cur > 0) {
    const d = cur - prevYearPrice, p = ((d/prevYearPrice)*100).toFixed(1)
    diffYEl.innerHTML = `<span style="color:${d>0?'#dc2626':d<0?'#16a34a':'#6b7280'};font-weight:700">${d>0?'▲':'▼'} ${Math.abs(d).toLocaleString()}원 (${d>0?'+':''}${p}%)</span>`
  }
}

window.addIngredientRow = function() {
  const tbody = document.getElementById('ing-page-tbody')
  if (!tbody) return
  const idx = tbody.querySelectorAll('tr').length
  const newRow = buildIngRow(idx, { name:'', unit:'kg', price:'', prevPrice:0, prevYearPrice:0, memo:'' }, '', '')
  tbody.insertAdjacentHTML('beforeend', newRow)
}

window.saveIngredientPricesPage = async function(year, month) {
  const tbody = document.getElementById('ing-page-tbody')
  if (!tbody) return
  const rows = tbody.querySelectorAll('tr[data-ing-idx]')
  const items = []
  rows.forEach(row => {
    const i = row.dataset.ingIdx
    const name = document.getElementById(`ing-pname-${i}`)?.value?.trim()
    const unit = document.getElementById(`ing-punit-${i}`)?.value || 'kg'
    const price = parseInt(document.getElementById(`ing-pprice-${i}`)?.value||0)||0
    const memo  = document.getElementById(`ing-pmemo-${i}`)?.value || ''
    if (name && price > 0) items.push({ ingredient_name: name, unit, unit_price: price, memo })
  })
  if (!items.length) { showToast('입력된 단가가 없습니다', 'warning'); return }
  const res = await api('POST', '/api/settings/ingredient-prices', { year, month, items })
  if (res?.success) {
    showToast(`식재료 단가 ${res.saved}건 저장됨`, 'success')
    renderIngredientPricesPage()  // 저장 후 새로고침
  } else {
    showToast('저장 실패', 'error')
  }
}

window.reloadIngPage = function() {
  const y = parseInt(document.getElementById('ingYearSel')?.value) || App.currentYear
  const m = parseInt(document.getElementById('ingMonthSel')?.value) || App.currentMonth
  App.currentYear  = y
  App.currentMonth = m
  renderIngredientPricesPage()
}

// ── #5 엑셀 자동 분석: 거래내역에서 식재료 단가 추출 ────────────
window.autoAnalyzeIngredientFromExcel = async function(input, year, month) {
  const file = input.files[0]
  if (!file) return
  input.value = ''

  // XLSX 로드 확인
  if (typeof XLSX === 'undefined') {
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
    s.onload = () => window.autoAnalyzeIngredientFromExcel({ files: [file] }, year, month)
    document.head.appendChild(s)
    showToast('라이브러리 로딩 중... 잠시 후 다시 시도해주세요.', 'warning')
    return
  }

  showToast('엑셀 분석 중...', 'info')

  try {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

    // 대상 식재료 키워드 목록
    const TARGETS = [
      { name:'쌀',       keywords:['쌀','백미','현미'] },
      { name:'닭고기',   keywords:['닭','치킨','계육'] },
      { name:'돼지고기', keywords:['돼지','삼겹','앞다리','목살','후지','전지'] },
      { name:'계란',     keywords:['계란','달걀'] },
      { name:'두부',     keywords:['두부'] },
      { name:'양파',     keywords:['양파'] },
      { name:'감자',     keywords:['감자'] },
      { name:'당근',     keywords:['당근'] },
      { name:'배추',     keywords:['배추','절임배추'] },
      { name:'양배추',   keywords:['양배추'] },
      { name:'대파',     keywords:['대파','파'] },
      { name:'마늘',     keywords:['마늘','깐마늘'] },
      { name:'쇠고기',   keywords:['쇠고기','소고기','한우','수입육','등심','불고기','국거리'] },
    ]

    // 컬럼 헤더 행 탐지 (품목명, 수량, 단가/금액 컬럼 찾기)
    let headerRow = -1
    let colItem = -1, colQty = -1, colPrice = -1, colAmt = -1

    const headerKeywords = {
      item:  ['품목','품명','상품명','식재료','재료명','item','name','product'],
      qty:   ['수량','qty','quantity'],
      price: ['단가','unit price','unit_price','단위가','price'],
      amt:   ['금액','amount','합계','공급가','공급액','총액']
    }

    for (let r = 0; r < Math.min(raw.length, 15); r++) {
      const row = raw[r].map(c => String(c).trim().toLowerCase())
      let foundItem = row.findIndex(c => headerKeywords.item.some(k => c.includes(k)))
      if (foundItem >= 0) {
        headerRow = r
        colItem = foundItem
        colQty   = row.findIndex(c => headerKeywords.qty.some(k => c.includes(k)))
        colPrice = row.findIndex(c => headerKeywords.price.some(k => c.includes(k)))
        colAmt   = row.findIndex(c => headerKeywords.amt.some(k => c.includes(k)))
        break
      }
    }

    // 헤더를 못 찾으면 첫 번째 행을 헤더로 간주
    if (headerRow === -1) {
      headerRow = 0
      colItem = 0
      colAmt = raw[0].length - 1
    }

    // 각 식재료별 단가 계산
    const results = {}
    for (let r = headerRow + 1; r < raw.length; r++) {
      const row = raw[r]
      if (!row || row.every(c => c === '' || c === null)) continue

      const itemCell = String(row[colItem] || '').trim()
      if (!itemCell) continue

      const target = TARGETS.find(t => t.keywords.some(k => itemCell.includes(k)))
      if (!target) continue

      // 단가 직접 추출 (단가 컬럼이 있는 경우)
      if (colPrice >= 0 && row[colPrice]) {
        const price = parseFloat(String(row[colPrice]).replace(/[^\d.]/g, ''))
        if (price > 0 && !results[target.name]) {
          results[target.name] = Math.round(price)
        }
        continue
      }

      // 금액 ÷ 수량 으로 단가 계산
      const qty = colQty >= 0 ? parseFloat(String(row[colQty]||'0').replace(/[^\d.]/g,'')) : 0
      const amt = colAmt >= 0 ? parseFloat(String(row[colAmt]||'0').replace(/[^\d,]/g,'').replace(',','')) : 0
      if (qty > 0 && amt > 0) {
        const calcPrice = Math.round(amt / qty)
        if (!results[target.name] || calcPrice < results[target.name]) {
          results[target.name] = calcPrice
        }
      }
    }

    // 결과를 테이블에 반영
    const found = Object.keys(results)
    if (found.length === 0) {
      showToast('식재료 단가를 자동 추출하지 못했습니다.\n품목명·수량·단가 컬럼이 포함된 엑셀인지 확인해주세요.', 'error')
      return
    }

    // 테이블 행 업데이트
    const tbody = document.getElementById('ing-page-tbody')
    if (tbody) {
      const nameInputs = tbody.querySelectorAll('.ing-name')
      nameInputs.forEach((nameEl, i) => {
        const name = nameEl.value.trim()
        if (results[name] !== undefined) {
          const priceEl = document.getElementById(`ing-pprice-${i}`)
          if (priceEl) {
            const prevPrice = parseInt(priceEl.dataset?.prevPrice || 0) || 0
            const prevYearPrice = parseInt(priceEl.dataset?.prevYearPrice || 0) || 0
            priceEl.value = results[name]
            priceEl.style.background = '#faf5ff'
            priceEl.style.borderColor = '#7c3aed'
            refreshIngRow(i, prevPrice, prevYearPrice)
          }
        }
      })
    }

    // 결과 요약 토스트
    const summary = found.map(n => `${n}: ${results[n].toLocaleString()}원`).join(', ')
    showToast(`✅ ${found.length}개 식재료 단가 자동 입력!\n${summary}`, 'success')

    // 저장 안내
    setTimeout(() => showToast('저장 버튼을 눌러 단가를 저장하세요.', 'info'), 2000)

  } catch (e) {
    console.error(e)
    showToast('엑셀 파일 분석 중 오류가 발생했습니다.', 'error')
  }
}

// ── #4 거래내역 엑셀 자동입력 다이얼로그 ──────────────────────────
window.openAutoImportDialog = function() {
  const vendors = window._vendorsCache || []
  const curYear = App.currentYear
  const curMonth = App.currentMonth

  // 선택 가능한 연월 목록 (현재 포함 12개월)
  const monthOptions = []
  for (let i = 0; i < 12; i++) {
    let m = curMonth - i
    let y = curYear
    while (m <= 0) { m += 12; y-- }
    monthOptions.push({ y, m })
  }

  const existing = document.getElementById('autoImportDialog')
  if (existing) existing.remove()

  const dlg = document.createElement('div')
  dlg.id = 'autoImportDialog'
  dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px'
  dlg.innerHTML = `
    <div style="background:white;border-radius:16px;max-width:460px;width:100%;padding:24px;box-shadow:0 25px 50px rgba(0,0,0,0.25)">
      <h3 style="font-size:16px;font-weight:700;color:#1f2937;margin:0 0 4px"><i class="fas fa-file-import" style="color:#7c3aed;margin-right:8px"></i>거래내역 엑셀 자동 입력</h3>
      <p style="font-size:12px;color:#6b7280;margin:0 0 16px">삼성웰스토리, 아워홈, 이산유통 등 각종 거래명세서를 업로드하면 발주 데이터로 자동 입력됩니다.</p>

      <!-- 업체 선택 -->
      <div style="margin-bottom:12px">
        <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px">📦 업체 선택 <span style="color:#9ca3af;font-weight:400">(엑셀에 업체 컬럼 없으면 수동 선택)</span></label>
        <select id="importVendorSel" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px">
          <option value="">자동 감지 (엑셀에서 업체 찾기)</option>
          ${vendors.map(v => `<option value="${v.id}">${v.name} (${v.tax_type==='taxable'?'과세':v.tax_type==='exempt'?'면세':v.tax_type==='mixed'?'과세+면세':'합산'})</option>`).join('')}
        </select>
      </div>

      <!-- 연/월 선택 -->
      <div style="margin-bottom:12px">
        <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px">📅 입력 대상 연월 <span style="color:#9ca3af;font-weight:400">(엑셀 날짜 자동 감지)</span></label>
        <div style="display:flex;gap:8px">
          <select id="importYearSel" style="flex:1;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px">
            ${[...new Set(monthOptions.map(o=>o.y))].map(y=>`<option value="${y}" ${y===curYear?'selected':''}>${y}년</option>`).join('')}
          </select>
          <select id="importMonthSel" style="flex:1;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px">
            ${monthOptions.map(o=>`<option value="${o.m}" ${o.y===curYear&&o.m===curMonth?'selected':''}>${o.m}월</option>`).join('')}
          </select>
        </div>
        <p style="font-size:11px;color:#9ca3af;margin:4px 0 0">※ 현재 월 외에도 과거 거래내역 입력 가능</p>
      </div>

      <!-- 파일 업로드 -->
      <div style="margin-bottom:16px">
        <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px">📂 거래내역 엑셀 파일</label>
        <label style="display:flex;align-items:center;gap:8px;padding:10px 14px;border:2px dashed #d1d5db;border-radius:8px;cursor:pointer;background:#fafafa" id="importFileLabel">
          <i class="fas fa-cloud-upload-alt" style="color:#7c3aed;font-size:16px"></i>
          <span id="importFileName" style="font-size:12px;color:#6b7280">클릭하여 파일 선택 (.xlsx, .xls, .csv)</span>
          <input type="file" id="importFileInput" accept=".xlsx,.xls,.csv" style="display:none" onchange="(function(f){document.getElementById('importFileName').textContent=f.files[0]?.name||'파일 선택'})(this)">
        </label>
      </div>

      <!-- 지원 형식 안내 -->
      <div style="background:#f5f3ff;border-radius:8px;padding:10px 12px;margin-bottom:16px;font-size:11px;color:#6b7280">
        <strong style="color:#7c3aed">지원 거래명세서 형식:</strong><br>
        • 날짜 컬럼: 거래일, 일자, 날짜, 주문일, 배송일, 입고일 등<br>
        • 금액 컬럼: 합계, 금액, 공급대가, 과세금액, 면세금액, 부가세 등<br>
        • 업체 컬럼: 업체명, 거래처, 공급자 등 (없으면 위에서 수동 선택)<br>
        <span style="color:#7c3aed">※ 날짜+금액 컬럼만 있어도 입력 가능</span>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button onclick="document.getElementById('autoImportDialog').remove()" style="background:#f3f4f6;color:#6b7280;border:none;border-radius:8px;padding:9px 18px;font-size:13px;font-weight:600;cursor:pointer">취소</button>
        <button onclick="startAutoImport()" style="background:#7c3aed;color:white;border:none;border-radius:8px;padding:9px 22px;font-size:13px;font-weight:700;cursor:pointer">
          <i class="fas fa-upload mr-1"></i>분석 시작
        </button>
      </div>
    </div>`
  document.body.appendChild(dlg)
}

// ── #4 업체 거래내역 엑셀 자동 입력 ────────────────────────────────
window.startAutoImport = function() {
  const fileInput = document.getElementById('importFileInput')
  if (!fileInput?.files[0]) {
    showToast('파일을 선택해주세요.', 'warning')
    return
  }
  const vendorId = parseInt(document.getElementById('importVendorSel')?.value) || null
  const importYear = parseInt(document.getElementById('importYearSel')?.value) || App.currentYear
  const importMonth = parseInt(document.getElementById('importMonthSel')?.value) || App.currentMonth
  document.getElementById('autoImportDialog')?.remove()
  autoImportOrderFromExcel(fileInput, vendorId, importYear, importMonth)
}

window.autoImportOrderFromExcel = async function(input, forcedVendorId, importYear, importMonth) {
  const file = input.files ? input.files[0] : input
  if (!file) return

  // XLSX 라이브러리 로드
  if (typeof XLSX === 'undefined') {
    showToast('XLSX 라이브러리 로딩 중... 잠시 후 다시 시도해주세요.', 'warning')
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
    s.onload = () => showToast('라이브러리 로드 완료. 다시 시도해주세요.', 'info')
    document.head.appendChild(s)
    return
  }

  showToast('거래내역 분석 중...', 'info')

  try {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array', cellDates: true })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })

    if (raw.length < 2) { showToast('엑셀 데이터가 없습니다.', 'error'); return }

    const vendors = window._vendorsCache || []
    const targetYear = importYear || App.currentYear
    const targetMonth = importMonth || App.currentMonth

    // ── 강화된 헤더 탐지 ──
    // 다양한 거래명세서 형식을 커버하는 키워드 확장
    const HK = {
      date:    ['날짜','일자','거래일','order date','date','주문일','배송일','입고일','전표일','거래일자','발주일','정산일','invoice date'],
      vendor:  ['업체','업체명','거래처','공급자','supplier','vendor','회사명','납품업체','공급업체','매입처'],
      item:    ['품목','품명','상품명','식재료','재료명','item','name','product','품명/규격','내역'],
      qty:     ['수량','qty','quantity','box수','박스수','ea수'],
      unit:    ['단위','unit'],
      price:   ['단가','unit price','unit_price','단위가','price','매입단가','공급단가'],
      taxable: ['과세','과세금액','공급가액','taxable','과세액','과표','과세공급가','과세공급'],
      exempt:  ['면세','면세금액','면세액','exempt','비과세','면세공급가','면세공급'],
      vat:     ['부가세','vat','세액','tax','부가가치세'],
      total:   ['합계','total','총액','합산','금액','공급대가','결제금액','청구금액','총금액','공급가','공급액','실거래금액','거래금액','발주금액','주문금액']
    }

    let headerRow = -1
    let cols = { date:-1, vendor:-1, item:-1, qty:-1, price:-1, taxable:-1, exempt:-1, vat:-1, total:-1 }

    // 헤더 탐지: 최대 25행까지 스캔 (거래명세서마다 헤더 위치 다름)
    for (let r = 0; r < Math.min(raw.length, 25); r++) {
      const row = raw[r].map(c => String(c||'').trim().toLowerCase())
      const dateIdx = row.findIndex(c => HK.date.some(k => c.includes(k)))
      const totalIdx = row.findIndex(c => HK.total.some(k => c === k || c.includes(k)))
      // 날짜 또는 합계 컬럼이 있는 행을 헤더로 판단
      if (dateIdx >= 0 || (totalIdx >= 0 && r < 15)) {
        headerRow = r
        cols.date    = dateIdx
        cols.vendor  = row.findIndex(c => HK.vendor.some(k => c.includes(k)))
        cols.item    = row.findIndex(c => HK.item.some(k => c.includes(k)))
        cols.qty     = row.findIndex(c => HK.qty.some(k => c === k || c.includes(k)))
        cols.price   = row.findIndex(c => HK.price.some(k => c === k || c.includes(k)))
        cols.taxable = row.findIndex(c => HK.taxable.some(k => c.includes(k)))
        cols.exempt  = row.findIndex(c => HK.exempt.some(k => c.includes(k)))
        cols.vat     = row.findIndex(c => HK.vat.some(k => c.includes(k)))
        cols.total   = totalIdx >= 0 ? totalIdx : row.findIndex(c => HK.total.some(k => c.includes(k)))
        break
      }
    }

    // 헤더 못 찾으면 첫 번째 행 사용
    if (headerRow === -1) { headerRow = 0 }

    // 날짜 파싱 (강화)
    function parseDate(cell) {
      if (cell === null || cell === undefined || cell === '') return null
      if (cell instanceof Date) {
        if (isNaN(cell)) return null
        const y = cell.getFullYear(), mo = String(cell.getMonth()+1).padStart(2,'0'), d = String(cell.getDate()).padStart(2,'0')
        return `${y}-${mo}-${d}`
      }
      const s = String(cell).trim()
      // YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD
      let m = s.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)
      if (m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`
      // YYYYMMDD
      m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
      if (m) return `${m[1]}-${m[2]}-${m[3]}`
      // MM/DD or MM.DD (연도 자동)
      m = s.match(/^(\d{1,2})[./](\d{1,2})$/)
      if (m) return `${targetYear}-${String(m[1]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`
      // 엑셀 시리얼
      if (/^\d{4,6}$/.test(s)) {
        const n = parseInt(s)
        if (n > 40000 && n < 60000) {
          const epoch = new Date(Date.UTC(1899,11,30))
          epoch.setDate(epoch.getDate() + n)
          const y2=epoch.getUTCFullYear(), mo=String(epoch.getUTCMonth()+1).padStart(2,'0'), d2=String(epoch.getUTCDate()).padStart(2,'0')
          return `${y2}-${mo}-${d2}`
        }
      }
      return null
    }

    // 금액 파싱
    function parseAmt(cell) {
      if (cell === null || cell === undefined || cell === '') return 0
      const s = String(cell).replace(/[^\d.-]/g,'')
      const n = parseFloat(s)
      return isNaN(n) || n < 0 ? 0 : Math.round(n)
    }

    // 파일명 기반 업체 힌트
    const fileName = file.name.toLowerCase().replace(/[_\s-]/g,'')
    function matchVendorByName(nameStr) {
      if (forcedVendorId) return vendors.find(v=>v.id===forcedVendorId) || null
      if (!nameStr && !fileName) return null
      const nm = String(nameStr||'').replace(/[_\s-]/g,'').toLowerCase()
      // 정확 일치
      let found = vendors.find(v => v.name.replace(/\s/g,'').toLowerCase() === nm)
      if (found) return found
      // 포함 (양방향)
      found = vendors.find(v => {
        const vn = v.name.replace(/\s/g,'').toLowerCase()
        return nm.includes(vn) || vn.includes(nm)
      })
      if (found) return found
      // 파일명에서 업체 감지
      found = vendors.find(v => {
        const vn = v.name.replace(/\s/g,'').toLowerCase()
        return fileName.includes(vn)
      })
      return found || null
    }

    // ── 데이터 파싱 ──
    // 이산유통 등 단가×수량 형식 포함, 날짜 없는 경우 월 합산 처리
    let hasDateCol = cols.date >= 0
    const parsed = []
    const noDateRows = [] // 날짜 없는 행 (월 합산용)

    // ── 이산유통 형식 감지: 단가 컬럼 있고 수량도 있는 경우 ──
    // 날짜별 단가×수량 합산 모드
    const isPriceQtyMode = cols.price >= 0 && cols.qty >= 0 && cols.total < 0 && cols.taxable < 0

    for (let r = headerRow + 1; r < raw.length; r++) {
      const row = raw[r]
      if (!row || row.every(c => !c || c === '' || c === '0')) continue

      let dateStr = hasDateCol ? parseDate(row[cols.date]) : null

      // 날짜 컬럼이 없어도 행에서 날짜처럼 보이는 셀 탐색
      if (!dateStr) {
        for (let ci = 0; ci < Math.min(row.length, 5); ci++) {
          const d = parseDate(row[ci])
          if (d) { dateStr = d; break }
        }
      }

      // ── 단가×수량 계산 모드 (이산유통 등) ──
      let taxable = 0, exempt = 0, vat = 0, total = 0

      if (isPriceQtyMode) {
        const price = parseAmt(row[cols.price])
        const qty   = cols.qty >= 0 ? parseAmt(row[cols.qty]) : 1
        const calculated = price * (qty || 1)
        if (calculated > 0) total = calculated
      } else {
        // 일반 금액 컬럼 모드
        taxable = cols.taxable >= 0 ? parseAmt(row[cols.taxable]) : 0
        exempt  = cols.exempt  >= 0 ? parseAmt(row[cols.exempt])  : 0
        vat     = cols.vat     >= 0 ? parseAmt(row[cols.vat])     : 0
        total   = cols.total   >= 0 ? parseAmt(row[cols.total])   : 0

        // 단가 × 수량 보조 계산 (합계 없을 때)
        if (total === 0 && taxable === 0 && exempt === 0) {
          if (cols.price >= 0 && cols.qty >= 0) {
            const pr2 = parseAmt(row[cols.price])
            const qt2 = parseAmt(row[cols.qty])
            if (pr2 > 0 && qt2 > 0) total = pr2 * qt2
          }
        }

        // 금액 없으면 숫자형 컬럼 중 가장 큰 값 사용
        if (total === 0 && taxable === 0 && exempt === 0) {
          let maxAmt = 0
          row.forEach((cell, ci) => {
            if (ci === cols.date || ci === cols.qty || ci === cols.price) return
            const n = parseAmt(cell)
            if (n > maxAmt) { maxAmt = n }
          })
          if (maxAmt > 100) total = maxAmt
        }
      }

      if (total === 0 && taxable === 0 && exempt === 0) continue

      // 업체 매칭
      const vendorNameCell = cols.vendor >= 0 ? String(row[cols.vendor]||'').trim() : ''
      const vendor = matchVendorByName(vendorNameCell)

      if (!dateStr) {
        noDateRows.push({ vendor, taxable, exempt, vat, total, raw: row })
        continue
      }

      // 날짜 필터: 선택된 연/월과 일치하는 것만
      const [dy, dm] = dateStr.split('-').map(Number)
      if (dy !== targetYear || dm !== targetMonth) continue

      parsed.push({ date: dateStr, vendor, taxable, exempt, vat, total })
    }

    // ── 날짜 없는 행 처리: 업체 감지된 것 중 월 합산 ──
    // noDateRows 중 업체가 있는 것은 해당 월 15일 기준 단일 건으로 처리
    if (noDateRows.length > 0 && parsed.length === 0) {
      const defaultDate = `${targetYear}-${String(targetMonth).padStart(2,'0')}-15`
      noDateRows.forEach(nr => {
        if (nr.vendor) {
          parsed.push({ date: defaultDate, vendor: nr.vendor, taxable: nr.taxable, exempt: nr.exempt, vat: nr.vat, total: nr.total })
        }
      })
    }

    // ── 업체 없는 항목 처리 ──
    const noVendorRows = parsed.filter(p => !p.vendor)
    const withVendorRows = parsed.filter(p => p.vendor)

    // ── 집계: 날짜+업체 기준 합산 ──
    const grouped = {}
    withVendorRows.forEach(p => {
      const key = `${p.date}_${p.vendor.id}`
      if (!grouped[key]) grouped[key] = { date:p.date, vendor:p.vendor, taxable:0, exempt:0, vat:0, total:0, count:0 }
      grouped[key].taxable += p.taxable
      grouped[key].exempt  += p.exempt
      grouped[key].vat     += p.vat
      grouped[key].total   += p.total || (p.taxable + p.exempt + p.vat)
      grouped[key].count++
    })

    // ── 업체 세금 유형 기반 금액 재분류 ──
    // total만 있고 taxable/exempt가 0인 경우, 업체의 tax_type으로 자동 분류
    Object.values(grouped).forEach(g => {
      if (g.total > 0 && g.taxable === 0 && g.exempt === 0) {
        const v = g.vendor
        if (v.tax_type === 'taxable') {
          // 과세: 공급가액 = total/1.1, 부가세 = total - 공급가액
          g.taxable = Math.round(g.total / 1.1)
          g.vat = g.total - g.taxable
        } else if (v.tax_type === 'exempt') {
          g.exempt = g.total
        } else if (v.tax_type === 'mixed') {
          // 혼합 유형: 합계를 과세로 일단 처리 (사용자가 확인)
          g.taxable = g.total
        }
        // mixed_total은 total 그대로 유지
      }
    })

    const items = Object.values(grouped).sort((a,b) => a.date.localeCompare(b.date))

    if (items.length === 0 && noVendorRows.length === 0) {
      const totalAmt = noDateRows.reduce((s,r)=>s+(r.total||r.taxable||0),0)
      if (totalAmt === 0) {
        showToast(`${targetYear}년 ${targetMonth}월 발주 데이터를 찾지 못했습니다.\n날짜·금액 컬럼이 포함된 파일인지 확인해주세요.`, 'error')
        return
      }
    }

    // 업체 미매칭 행이 있으면 수동 선택 모달
    if (noVendorRows.length > 0 && items.length === 0) {
      const totalUnmatched = noVendorRows.reduce((s,p)=>s+(p.total||p.taxable||0),0)
      const uniqueDates = [...new Set(noVendorRows.filter(p=>p.date).map(p=>p.date))].slice(0,5).join(', ')
      _showManualVendorSelect(noVendorRows, targetYear, targetMonth,
        `${noVendorRows.length}건 · 합계 ${totalUnmatched.toLocaleString()}원${uniqueDates ? `\n날짜: ${uniqueDates}` : ''}`)
      return
    }

    // 업체 미매칭이 일부 있는 경우 알림
    if (noVendorRows.length > 0) {
      showToast(`⚠ ${noVendorRows.length}건 업체 미매칭으로 제외됨`, 'warning')
    }

    // 미리보기 모달
    _showImportPreview(items, file.name, targetYear, targetMonth)

  } catch(e) {
    console.error('[autoImportOrderFromExcel]', e)
    showToast('엑셀 분석 오류: ' + e.message, 'error')
  }
}

// 수동 업체 선택 모달
function _showManualVendorSelect(rows, year, month, hint) {
  const vendors = window._vendorsCache || []
  const sel = document.createElement('div')
  sel.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px'
  sel.innerHTML = `
    <div style="background:white;border-radius:16px;max-width:420px;width:100%;padding:24px;box-shadow:0 25px 50px rgba(0,0,0,0.25)">
      <h3 style="font-size:15px;font-weight:700;color:#1f2937;margin:0 0 6px"><i class="fas fa-store" style="color:#7c3aed;margin-right:6px"></i>업체를 수동으로 선택해주세요</h3>
      <p style="font-size:12px;color:#6b7280;margin:0 0 14px">엑셀에서 업체 정보를 찾지 못했습니다.<br>${hint}</p>
      <select id="manualVndSel2" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;margin-bottom:14px">
        <option value="">-- 업체 선택 --</option>
        ${vendors.map(v=>`<option value="${v.id}">${v.name} (${v.tax_type==='taxable'?'과세':v.tax_type==='exempt'?'면세':v.tax_type==='mixed'?'과+면':'합산'})</option>`).join('')}
      </select>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button onclick="this.closest('div[style]').remove()" style="background:#f3f4f6;color:#6b7280;border:none;border-radius:8px;padding:8px 16px;font-size:13px;cursor:pointer">취소</button>
        <button id="manualVndBtn2" onclick="(function(){
          const vid=parseInt(document.getElementById('manualVndSel2').value)
          if(!vid){alert('업체를 선택하세요');return}
          const vnd=(window._vendorsCache||[]).find(v=>v.id===vid)
          if(!vnd)return
          this.closest('div[style]').remove()
          const rows=window._noVendorRows||[]
          delete window._noVendorRows
          const grouped={}
          rows.forEach(p=>{
            const key=p.date+'_'+vid
            if(!grouped[key])grouped[key]={date:p.date,vendor:vnd,taxable:0,exempt:0,vat:0,total:0,count:0}
            grouped[key].taxable+=p.taxable
            grouped[key].exempt+=p.exempt
            grouped[key].vat+=p.vat
            grouped[key].total+=(p.total||(p.taxable+p.exempt+p.vat))
            grouped[key].count++
          })
          const items=Object.values(grouped).sort((a,b)=>a.date.localeCompare(b.date))
          _showImportPreview(items,'',${year},${month})
        }).call(this)" style="background:#7c3aed;color:white;border:none;border-radius:8px;padding:8px 20px;font-size:13px;font-weight:700;cursor:pointer">
          <i class="fas fa-check mr-1"></i>이 업체로 입력
        </button>
      </div>
    </div>`
  window._noVendorRows = rows
  document.body.appendChild(sel)
}

// 미리보기 모달
function _showImportPreview(items, fileName, year, month) {
  if (!items || !items.length) {
    showToast('입력할 데이터가 없습니다.', 'error')
    return
  }

  const grandTotal = items.reduce((s,it)=>s+(it.total||0),0)

  document.getElementById('importOrderModal')?.remove()
  const modal = document.createElement('div')
  modal.id = 'importOrderModal'
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px'
  modal.innerHTML = `
    <div style="background:white;border-radius:16px;max-width:720px;width:100%;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 25px 50px rgba(0,0,0,0.25)">
      <div style="padding:14px 20px;border-bottom:1px solid #f3f4f6;display:flex;align-items:center;justify-content:space-between">
        <div>
          <h3 style="font-size:15px;font-weight:700;color:#1f2937;margin:0"><i class="fas fa-file-import" style="color:#7c3aed;margin-right:8px"></i>발주 자동입력 미리보기</h3>
          <p style="font-size:12px;color:#6b7280;margin:2px 0 0">${year}년 ${month}월 · <strong style="color:#7c3aed">${items.length}건</strong> · 합계 <strong style="color:#1d4ed8">${grandTotal.toLocaleString()}원</strong>${fileName?` ← ${fileName}`:''}</p>
        </div>
        <button onclick="document.getElementById('importOrderModal').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#9ca3af">✕</button>
      </div>
      <div style="overflow-y:auto;flex:1;padding:12px 16px">
        <table style="width:100%;font-size:12px;border-collapse:collapse">
          <thead>
            <tr style="background:#f9fafb;color:#6b7280">
              <th style="padding:6px 8px;text-align:left;font-weight:600">날짜</th>
              <th style="padding:6px 8px;text-align:left;font-weight:600">업체</th>
              <th style="padding:6px 8px;text-align:right;font-weight:600;color:#16a34a">과세</th>
              <th style="padding:6px 8px;text-align:right;font-weight:600;color:#d97706">면세</th>
              <th style="padding:6px 8px;text-align:right;font-weight:600;color:#6b7280">부가세</th>
              <th style="padding:6px 8px;text-align:right;font-weight:600;color:#1d4ed8">합계</th>
              <th style="padding:6px 8px;text-align:center;font-weight:600">행수</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(it => {
              const t = it.total || (it.taxable + it.exempt + it.vat)
              const ttStr = t > 0 ? t.toLocaleString() : '-'
              return `<tr style="border-bottom:1px solid #f3f4f6">
                <td style="padding:5px 8px;color:#374151">${it.date}</td>
                <td style="padding:5px 8px;font-weight:600;color:#1f2937">${it.vendor?.name||'?'}</td>
                <td style="padding:5px 8px;text-align:right;color:#16a34a">${it.taxable>0?it.taxable.toLocaleString():'-'}</td>
                <td style="padding:5px 8px;text-align:right;color:#d97706">${it.exempt>0?it.exempt.toLocaleString():'-'}</td>
                <td style="padding:5px 8px;text-align:right;color:#6b7280">${it.vat>0?it.vat.toLocaleString():'-'}</td>
                <td style="padding:5px 8px;text-align:right;font-weight:700;color:#1d4ed8">${ttStr}</td>
                <td style="padding:5px 8px;text-align:center;color:#9ca3af;font-size:11px">${it.count||1}행</td>
              </tr>`
            }).join('')}
          </tbody>
        </table>
      </div>
      <div style="padding:12px 16px;border-top:1px solid #f3f4f6;display:flex;gap:8px;justify-content:flex-end;align-items:center">
        <span style="font-size:11px;color:#9ca3af;flex:1">기존 동일 날짜/업체 데이터는 덮어쓰기됩니다.</span>
        <button onclick="document.getElementById('importOrderModal').remove()" style="background:#f3f4f6;color:#6b7280;border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer">취소</button>
        <button id="importOrderConfirmBtn" onclick="confirmImportOrders()" style="background:#7c3aed;color:white;border:none;border-radius:8px;padding:8px 20px;font-size:13px;font-weight:700;cursor:pointer">
          <i class="fas fa-check mr-1"></i>발주 자동 입력 (${items.length}건)
        </button>
      </div>
    </div>`
  window._importOrderItems = items
  window._importOrderYear = year
  window._importOrderMonth = month
  document.body.appendChild(modal)
}

// ── #4 발주 자동입력 확정 ────────────────────────────────────────
window.confirmImportOrders = async function() {
  const items = window._importOrderItems
  if (!items || !items.length) return

  const btn = document.getElementById('importOrderConfirmBtn')
  if (btn) { btn.disabled = true; btn.textContent = '저장 중...' }

  let success = 0, fail = 0
  for (const it of items) {
    try {
      const isMixedTotal = it.vendor.tax_type === 'mixed_total'
      const payload = isMixedTotal
        ? { vendorId: it.vendor.id, orderDate: it.date, totalAmount: it.total, taxableAmount:0, exemptAmount:0, vatAmount:0, note:'엑셀자동입력' }
        : { vendorId: it.vendor.id, orderDate: it.date, taxableAmount: it.taxable, exemptAmount: it.exempt, vatAmount: it.vat, note:'엑셀자동입력' }
      const res = await api('POST', '/api/orders/save', payload)
      if (res?.success) success++
      else fail++
    } catch(e) {
      fail++
    }
  }

  document.getElementById('importOrderModal')?.remove()
  delete window._importOrderItems

  if (success > 0) {
    showToast(`✅ ${success}건 발주 자동 입력 완료!${fail > 0 ? ` (실패 ${fail}건)` : ''}`, 'success')
    // 저장된 연월로 화면 전환 후 갱신
    const savedYear = window._importOrderYear || App.currentYear
    const savedMonth = window._importOrderMonth || App.currentMonth
    delete window._importOrderYear
    delete window._importOrderMonth
    App.currentYear = savedYear
    App.currentMonth = savedMonth
    if (App._panelReady) {
      delete App._panelReady[`orders-${savedYear}-${savedMonth}`]
    }
    renderOrders()
  } else {
    showToast(`발주 입력 실패 (${fail}건)`, 'error')
  }
}

window.submitClosingRequest = async function(year, month) {
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
            <!-- 2.2 월말 예상 식단가 + 2.3 예산 소진 예상일 (관리자 카드) -->
            ${(h.projectedMonthEndMealPrice > 0 || h.budgetDepletionDate) ? `
            <div class="mt-1.5 pt-1.5 border-t border-blue-100">
              <div class="text-xs text-gray-400 mb-1" style="font-size:9px"><i class="fas fa-chart-line mr-1"></i>현재 추세 기준 예측</div>
              <div class="grid grid-cols-2 gap-1">
              ${h.projectedMonthEndMealPrice > 0 ? `
              <div class="bg-white rounded-lg px-2 py-1.5 border ${h.projectedMonthEndMealPrice > (h.targetMealPrice||0) && h.targetMealPrice > 0 ? 'border-red-200 bg-red-50' : 'border-green-100'}">
                <div class="text-xs text-gray-400" style="font-size:9px">월말 예상 식단가</div>
                <div class="text-xs font-bold ${h.projectedMonthEndMealPrice > (h.targetMealPrice||0) && h.targetMealPrice > 0 ? 'text-red-600' : 'text-gray-700'}">${h.projectedMonthEndMealPrice.toLocaleString()}원/식</div>
                ${h.targetMealPrice > 0 ? `<div class="text-xs" style="font-size:9px;color:${h.projectedMonthEndMealPrice > h.targetMealPrice ? '#dc2626' : '#16a34a'}">${h.projectedMonthEndMealPrice > h.targetMealPrice ? '▲목표초과' : '▼목표이하'}</div>` : ''}
              </div>` : '<div></div>'}
              ${h.budgetDepletionDate ? `
              <div class="rounded-lg px-2 py-1.5 border ${h.budgetDepletionDate.includes('🚨') ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'}">
                <div class="text-xs" style="font-size:9px;color:${h.budgetDepletionDate.includes('🚨') ? '#991b1b' : '#92400e'}">예산 소진 예상일</div>
                <div class="text-xs font-bold ${h.budgetDepletionDate.includes('🚨') ? 'text-red-700' : 'text-yellow-700'}">${h.budgetDepletionDate}</div>
                <div class="text-xs" style="font-size:9px;color:#9ca3af">이달 내 소진 예상</div>
              </div>` : '<div></div>'}
              </div>
            </div>` : ''}
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

          <!-- ④ 법인카드 사용 현황 -->
          ${h.cardExpenses && h.cardExpenses.monthTotal > 0 ? `
          <div class="mb-3 p-2.5 bg-gradient-to-r from-purple-50 to-violet-50 rounded-xl border border-purple-100">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-semibold text-purple-700"><i class="fas fa-credit-card mr-1"></i>법인카드 사용 현황</span>
              <span class="text-xs font-bold text-purple-800">${fmtMan(h.cardExpenses.monthTotal)}원</span>
            </div>
            <div class="grid grid-cols-3 gap-1 text-center">
              ${(h.cardExpenses.bySubtype||[]).map(st => `
              <div class="p-1.5 bg-white rounded-lg border border-purple-100">
                <div class="text-xs text-purple-500">${st.label}</div>
                <div class="text-xs font-bold text-purple-700">${fmtMan(st.total)}원</div>
                <div class="text-xs text-gray-400">${st.count}건</div>
              </div>`).join('')}
            </div>
          </div>` : ''}

          <!-- ④ 발주 현황 & 잔반 -->
          <div class="flex gap-2 text-xs text-gray-500 mb-2">
            <span>오늘발주: <strong class="text-gray-700">${fmtMan(h.todayUsed)}원</strong></span>
            <span>·</span>
            <span>이번주: <strong class="text-gray-700">${fmtMan(h.weekUsed)}원</strong></span>
            ${h.foodWaste.totalWaste > 0 ? `<span>·</span><span>잔반: <strong class="text-amber-600">${h.foodWaste.totalWaste.toFixed(1)}L</strong></span>` : ''}
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
  const [hosp, budget, vendorList, accounts, execAccounts] = await Promise.all([
    api('GET', `/api/admin/hospitals/${hospitalId}`),
    api('GET', `/api/admin/hospitals/${hospitalId}/budget/${App.currentYear}/${App.currentMonth}`),
    api('GET', `/api/admin/hospitals/${hospitalId}/vendors`),
    api('GET', `/api/admin/hospitals/${hospitalId}/accounts`),
    api('GET', `/api/admin/hospitals/${hospitalId}/executive-accounts`)
  ])
  if (!hosp) return

  const s = budget?.settings || {}
  const isFallback = budget?.isFallback || false
  const fallbackYearMonth = budget?.fallbackYearMonth || ''
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
        <!-- 탭별 저장 버튼 (탭 전환 시 해당 버튼만 표시) -->
        <button id="tabSaveBtn-info" onclick="saveHospitalInfo(${hospitalId})" class="btn btn-primary btn-sm">
          <i class="fas fa-save mr-1"></i>기본정보 저장
        </button>
        <button id="tabSaveBtn-categories" onclick="saveDietAndBudgets(${hospitalId})" class="btn btn-primary btn-sm hidden">
          <i class="fas fa-save mr-1"></i>환자군 저장
        </button>
        <button id="tabSaveBtn-vendors" class="btn btn-success btn-sm hidden" onclick="showAdminAddVendorModal()">
          <i class="fas fa-plus mr-1"></i>업체 추가
        </button>
        <button id="tabSaveBtn-budget" onclick="saveHospitalBudget(${hospitalId})" class="btn btn-primary btn-sm hidden">
          <i class="fas fa-save mr-1"></i>예산 저장
        </button>
        <button id="tabSaveBtn-accounts" class="btn btn-success btn-sm hidden" onclick="showAdminAddAccountModal()">
          <i class="fas fa-plus mr-1"></i>계정 추가
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
        <button class="tab-btn flex-shrink-0" id="tab-vendors" onclick="switchHospTab('vendors')">
          <i class="fas fa-store mr-1"></i>업체관리
        </button>
        <button class="tab-btn flex-shrink-0" id="tab-budget" onclick="switchHospTab('budget')">
          <i class="fas fa-won-sign mr-1"></i>예산설정
        </button>
        <button class="tab-btn flex-shrink-0" id="tab-accounts" onclick="switchHospTab('accounts')">
          <i class="fas fa-user-circle mr-1"></i>계정관리
        </button>
      </div>
      <!-- 현재 탭 안내 -->
      <div id="currentTabLabel" class="text-xs text-gray-400 mb-1"><i class="fas fa-circle-dot mr-1"></i>현재: <strong class="text-gray-600">기본정보</strong> 탭 — 우측 상단 버튼으로 저장</div>

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
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">운영 유형 (케어)</label>
            <select id="hi-caretype" class="form-input">
              <option value="general"          ${(hosp.care_type||'general')==='general'          ?'selected':''}>일반</option>
              <option value="oncology"         ${hosp.care_type==='oncology'         ?'selected':''}>항암</option>
              <option value="nursing_care"     ${hosp.care_type==='nursing_care'     ?'selected':''}>요양</option>
              <option value="rehab"            ${hosp.care_type==='rehab'            ?'selected':''}>재활</option>
              <option value="oncology_nursing" ${hosp.care_type==='oncology_nursing' ?'selected':''}>항암+요양</option>
              <option value="oncology_rehab"   ${hosp.care_type==='oncology_rehab'   ?'selected':''}>항암+재활</option>
              <option value="nursing_rehab"    ${hosp.care_type==='nursing_rehab'    ?'selected':''}>요양+재활</option>
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
      </div>

      <!-- 예산설정 탭 -->
      <div id="hospTab-budget" class="hidden">
        <!-- 기본 설정 안내 배너 -->
        <div class="mb-3 p-3 rounded-lg border ${isFallback ? 'bg-amber-50 border-amber-200' : 'bg-blue-50 border-blue-200'}">
          <div class="flex items-start gap-2">
            <i class="fas ${isFallback ? 'fa-exclamation-triangle text-amber-500' : 'fa-info-circle text-blue-500'} mt-0.5 text-sm"></i>
            <div>
              <div class="text-sm font-semibold ${isFallback ? 'text-amber-700' : 'text-blue-700'}">
                ${isFallback ? `기본 설정 적용 중 (${fallbackYearMonth} 기준값 사용)` : '기본 예산 설정'}
              </div>
              <div class="text-xs ${isFallback ? 'text-amber-600' : 'text-blue-600'} mt-0.5">
                ${isFallback
                  ? `${App.currentYear}년 ${App.currentMonth}월 설정이 없어 ${fallbackYearMonth} 설정을 기본값으로 표시합니다. 저장하면 현재 월에 새로 저장됩니다.`
                  : `여기서 저장한 값이 설정 없는 모든 달(전월·이후달)에도 기본값으로 자동 적용됩니다.`
                }
              </div>
            </div>
          </div>
        </div>
        <div class="text-sm font-semibold text-gray-600 mb-3">
          <i class="fas fa-cog text-indigo-500 mr-1"></i>기본 예산 설정
          <span class="text-xs font-normal text-gray-400 ml-2">(저장한 월 이후 달에 자동 상속)</span>
        </div>
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
            <label class="block text-xs font-semibold text-gray-500 mb-1">잔반 처리 단가 (원/L)
              <span class="text-amber-500 font-normal ml-1">병원별 설정</span>
            </label>
            <div class="flex gap-2">
              <input id="hb-waste-unit-price" type="number" class="form-input flex-1" value="${s.waste_unit_price||0}" placeholder="예: 500">
              <button onclick="saveWasteUnitPriceAdmin(${hospitalId})" class="btn btn-secondary btn-sm whitespace-nowrap">
                <i class="fas fa-save mr-1"></i>저장
              </button>
            </div>
            <p class="text-xs text-gray-400 mt-1">* 잔반량(L) × 단가로 비용 자동계산. 0이면 직접 입력.</p>
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">해당월 영업일수 (일)</label>
            <input id="hb-workdays" type="number" class="form-input" value="${s.working_days || getDefaultWorkingDays(App.currentYear, App.currentMonth)}" oninput="refreshVendorDayTargets()">
            <p class="text-xs text-gray-400 mt-1">* 자동계산: ${getDefaultWorkingDays(App.currentYear, App.currentMonth)}일 (해당월 전체일수)</p>
          </div>
        </div>

        <!-- 업체별 목표금액 -->
        <div class="border-t border-gray-100 pt-4">
          <h3 class="font-semibold text-gray-700 mb-3"><i class="fas fa-store text-green-600 mr-1"></i>업체별 월 목표금액</h3>
          <p class="text-xs text-gray-400 mb-3"><i class="fas fa-info-circle mr-1"></i>일 목표 = 월 목표금액 ÷ 영업일수(${s.working_days || getDefaultWorkingDays(App.currentYear, App.currentMonth)}일)</p>
          <div id="hospBudgetVendors">
            ${renderBudgetVendorRows(vendors, s.working_days || getDefaultWorkingDays(App.currentYear, App.currentMonth))}
          </div>
        </div>
        <div class="mt-4 flex justify-end">
          <!-- 상단 우측 버튼으로 통합 -->
        </div>
      </div>

      <!-- 업체관리 탭 -->
      <div id="hospTab-vendors" class="hidden">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-semibold text-gray-700"><i class="fas fa-store text-green-600 mr-1"></i>업체 정보 등록</h3>
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
        <!-- 영양사/일반 계정 섹션 -->
        <div class="mb-5">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-semibold text-gray-700 flex items-center gap-2">
              <span class="w-7 h-7 rounded-lg bg-green-100 flex items-center justify-center"><i class="fas fa-user-nurse text-green-600 text-xs"></i></span>
              영양사 / 일반 계정
            </h3>
            <button onclick="showAdminAddAccountModal('hospital')" class="btn btn-success btn-sm">
              <i class="fas fa-plus mr-1"></i>계정 추가
            </button>
          </div>
          <div id="adminAccountList">
            ${renderAdminAccountRows((accounts || []).filter(a => a.role !== 'executive'))}
          </div>
        </div>
        <!-- 구분선 -->
        <div class="border-t border-gray-100 my-4"></div>
        <!-- 운영진 계정 섹션 -->
        <div class="mb-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-semibold text-gray-700 flex items-center gap-2">
              <span class="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center"><i class="fas fa-user-tie text-blue-600 text-xs"></i></span>
              운영진 계정
              <span class="text-xs text-gray-400 font-normal bg-gray-100 px-2 py-0.5 rounded-full">읽기 전용 대시보드</span>
            </h3>
            <button onclick="showAdminAddAccountModal('executive')" class="btn btn-sm" style="background:#1e40af;color:white">
              <i class="fas fa-plus mr-1"></i>운영진 추가
            </button>
          </div>
          <div id="adminExecutiveList">
            ${renderAdminAccountRows(execAccounts || [])}
          </div>
          <div class="mt-3 p-3 bg-blue-50 rounded-xl text-xs text-blue-700">
            <i class="fas fa-shield-alt mr-1"></i>
            운영진 계정은 <strong>읽기 전용</strong> 대시보드에만 접근합니다. 발주/식수 입력·수정 불가. 예산·식단가·법인카드·지출결의서를 한눈에 확인할 수 있습니다.
          </div>
        </div>
        <div class="mt-4 p-3 bg-gray-50 rounded-xl text-xs text-gray-500">
          <i class="fas fa-info-circle mr-1"></i>
          영양사 계정: 발주 입력, 식수 관리, 마감 요청 등 전체 기능 사용 가능
        </div>
      </div>

      <!-- 환자군 카테고리 탭 (식이 분류 설정으로 확장) -->
      <div id="hospTab-categories" class="hidden">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-semibold text-gray-700"><i class="fas fa-layer-group text-purple-600 mr-1"></i>식이 분류 설정 <span class="text-xs text-gray-400 font-normal">(환자군 설정)</span></h3>
          <button onclick="openAddDietModal(${hospitalId})" class="btn btn-success btn-sm">
            <i class="fas fa-plus mr-1"></i>식이 추가
          </button>
        </div>
        <div class="mb-3 p-3 bg-purple-50 rounded-xl text-xs text-purple-700">
          <i class="fas fa-info-circle mr-1"></i>
          설정한 항목은 <strong>식수 입력 화면</strong>에 대분류(환자식/치료식/비급여식/직원식)별 그룹으로 표시됩니다.<br>
          <span class="text-gray-500 mt-0.5 block">💡 <strong>사용여부 OFF</strong> = 완전 비활성화 · <strong>식수노출 OFF</strong> = 식수 입력 숨김 (데이터는 유지)</span>
        </div>

        <!-- 대분류 탭 -->
        <div class="flex gap-1 mb-3 border-b border-gray-200 pb-0" id="dietTypeTabBar">
          ${[
            {k:'patient',   n:'환자식',   color:'#2563eb', icon:'fa-user-injured'},
            {k:'therapy',   n:'치료식',   color:'#16a34a', icon:'fa-pills'},
            {k:'noncovered',n:'비급여식', color:'#9333ea', icon:'fa-hand-holding-usd'},
            {k:'staff',     n:'직원식',   color:'#d97706', icon:'fa-user-tie'},
          ].map((t,i) => `<button id="dietTypeTab-${t.k}" onclick="switchDietTypeTab('${t.k}')"
            class="px-3 py-2 text-xs font-semibold rounded-t-lg border border-b-0 transition ${i===0?'bg-white border-gray-200 text-blue-700':'bg-gray-50 border-transparent text-gray-500 hover:bg-white'}"
            style="${i===0?'margin-bottom:-1px;border-color:#e5e7eb':''}">
            <i class="fas ${t.icon} mr-1" style="color:${t.color}"></i>${t.n}
          </button>`).join('')}
        </div>

        <!-- 프리셋 빠른 추가 -->
        <div class="mb-3" id="dietPresetBar">
          <div class="text-xs font-semibold text-gray-500 mb-1.5">프리셋에서 빠른 추가 <span class="font-normal text-gray-400">(클릭시 즉시 추가)</span></div>
          <div class="flex flex-wrap gap-1" id="dietPresetChips">
            <span class="text-xs text-gray-300">로딩중...</span>
          </div>
        </div>

        <!-- 식이 목록 (대분류별) -->
        <div id="dietCategoryList" class="space-y-2">
          <div class="text-xs text-gray-400 text-center py-4">로딩 중...</div>
        </div>

        <!-- 목표 설정 (기존 유지) -->
        <div class="mt-5 border-t border-gray-100 pt-4">
          <h4 class="font-semibold text-gray-700 text-sm mb-3">
            <i class="fas fa-bullseye text-green-600 mr-1"></i>
            카테고리별 목표 설정
            <span class="text-xs font-normal text-gray-400 ml-1">(환자식만 · 식단가 · 월 목표금액)</span>
          </h4>
          <div class="mb-2 px-2 py-1.5 bg-blue-50 rounded-lg text-xs text-blue-600 border border-blue-100">
            <i class="fas fa-info-circle mr-1"></i>
            <strong>환자군(환자식)만</strong> 목표 설정 가능 · 치료식·비급여식·직원식은 목표 설정 제외
          </div>
          <div id="categoryBudgetList" class="space-y-2">
            <div class="text-xs text-gray-400 text-center py-2">카테고리를 먼저 저장하세요</div>
          </div>
        </div>

        <div class="mt-4 flex gap-2 justify-end">
          <!-- 상단 우측 버튼으로 통합 (환자군 저장 = saveDietAndBudgets) -->
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
              <option value="mixed">과세+면세 (2칸 분리입력)</option>
              <option value="mixed_total">과세+면세 합산입력 (총액 1칸)</option>
              <option value="taxable">과세만</option>
              <option value="exempt">면세만</option>
            </select>
          </div>
        </div>
        <!-- 법인카드형 업체 설정 -->
        <div class="p-3 bg-purple-50 rounded-xl border border-purple-100">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" id="adminVendorIsCard" class="w-4 h-4 accent-purple-600" onchange="toggleAdminCardSubtype()">
            <span class="text-sm font-semibold text-purple-800"><i class="fas fa-credit-card mr-1"></i>법인카드형 업체</span>
          </label>
          <p class="text-xs text-purple-600 mt-1 ml-6">발주 입력 시 상세내역(품목·용도·금액) 다건 입력 방식으로 동작합니다</p>
          <div id="adminCardSubtypeWrap" class="hidden mt-2 ml-6">
            <label class="text-xs font-medium text-gray-600">카드 구분</label>
            <select id="adminVendorCardSubtype" class="form-input mt-1 text-sm">
              <option value="food">식재료</option>
              <option value="supplies">소모품</option>
              <option value="online">온라인</option>
              <option value="other">기타</option>
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
      <input type="hidden" id="adminAccountRole" value="hospital">
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
        <div id="accountNutrNameRow">
          <label class="text-sm font-medium text-gray-600">영양사 이름</label>
          <input type="text" id="adminAccountNutrName" class="form-input mt-1" placeholder="영양사 이름 (선택)">
        </div>
        <div id="accountExecFieldsRow" class="hidden">
          <div class="mb-2">
            <label class="text-sm font-medium text-gray-600">이름 (표시명)</label>
            <input type="text" id="adminAccountDisplayName" class="form-input mt-1" placeholder="홍길동">
          </div>
          <div>
            <label class="text-sm font-medium text-gray-600">직책</label>
            <input type="text" id="adminAccountExecTitle" class="form-input mt-1" placeholder="원장, 이사, 부원장 등">
          </div>
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
function renderBudgetVendorRows(vendors, workingDays) {
  if (!vendors || vendors.length === 0) {
    return `<div class="text-center py-8 text-gray-400">
      <i class="fas fa-store text-3xl mb-2 block text-gray-300"></i>
      <p class="text-sm">등록된 업체가 없습니다</p>
      <p class="text-xs mt-1">업체관리 탭에서 업체를 먼저 추가하세요</p>
    </div>`
  }
  const wd = workingDays || 0
  const initSum = vendors.reduce((s,v) => s + (v.monthly_budget||0), 0)
  return `<div class="space-y-2">
    ${vendors.map(v => {
      const mb = v.monthly_budget || 0
      const dayTarget = (mb > 0 && wd > 0) ? Math.round(mb / wd) : 0
      return `
      <div class="flex items-center gap-3 py-2 border-b border-gray-50">
        <span class="w-2.5 h-2.5 rounded-full flex-shrink-0 ${getCategoryColor(v.category)}"></span>
        <div class="flex-1 min-w-0">
          <span class="font-medium text-sm">${v.name}</span>
          <span class="text-xs text-gray-400 ml-2">${getCategoryLabel(v.category)}</span>
          ${dayTarget > 0 ? `<span class="text-xs text-blue-500 ml-2">일 목표: ${dayTarget.toLocaleString('ko-KR')}원</span>` : ''}
        </div>
        <div class="flex items-center gap-2">
          <input id="hvb-${v.id}" type="number" class="form-input w-40 text-right text-sm py-1.5 vendor-budget-input"
            value="${mb||0}" placeholder="0" oninput="syncVendorBudgetTotal()">
          <span class="text-xs text-gray-400 whitespace-nowrap">원</span>
        </div>
      </div>`
    }).join('')}
    <!-- #9: 업체 합계 + 자동반영 옵션 -->
    <div class="py-3 border-t-2 border-green-200 bg-green-50 rounded-lg px-3 mt-2">
      <div class="flex items-center justify-between mb-2">
        <div class="font-semibold text-sm text-green-800">
          <i class="fas fa-calculator mr-1 text-green-600"></i>업체별 합계
        </div>
        <div class="flex items-center gap-2">
          <span id="vendorBudgetSum" class="font-bold text-green-700 text-base">${fmt(initSum)}</span>
          <span class="text-xs text-gray-400">원</span>
        </div>
      </div>
      <div class="flex items-center justify-between">
        <label class="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" id="autoSyncTotalBudget" onchange="syncVendorBudgetTotal()"
            style="width:14px;height:14px;accent-color:#16a34a">
          <span class="text-xs text-green-700 font-medium">업체 합계 → 월 총 목표금액 자동 반영 <span style="color:#9ca3af;font-weight:400">(직접 반영 시 버튼 사용)</span></span>
        </label>
        <button onclick="syncVendorBudgetTotal(true)" 
          class="text-xs bg-green-600 text-white px-3 py-1 rounded-lg font-semibold hover:bg-green-700">
          <i class="fas fa-sync mr-1"></i>지금 반영
        </button>
      </div>
    </div>
  </div>`
}

// 영업일수 변경 시 업체별 일 목표 실시간 갱신
window.refreshVendorDayTargets = function() {
  const wd = parseInt(document.getElementById('hb-workdays')?.value || '0') || 0
  // 각 vendor-budget-input의 현재 값으로 일 목표 업데이트
  document.querySelectorAll('.vendor-budget-input').forEach(inp => {
    const mb = parseInt(inp.value || '0') || 0
    const dayTarget = (mb > 0 && wd > 0) ? Math.round(mb / wd) : 0
    // 같은 행의 일 목표 span 업데이트 (data-vdaytarget 속성 활용)
    const row = inp.closest('[class*="flex items-center gap-3"]') || inp.parentElement?.parentElement?.parentElement
    if (row) {
      let daySpan = row.querySelector('.vendor-day-target')
      const nameDiv = row.querySelector('.flex-1.min-w-0')
      if (nameDiv) {
        daySpan = nameDiv.querySelector('.vendor-day-target')
        if (!daySpan) {
          daySpan = document.createElement('span')
          daySpan.className = 'text-xs text-blue-500 ml-2 vendor-day-target'
          nameDiv.appendChild(daySpan)
        }
        daySpan.textContent = dayTarget > 0 ? `일 목표: ${dayTarget.toLocaleString('ko-KR')}원` : ''
      }
    }
  })
  syncVendorBudgetTotal()
}

// 업체별 예산 합산 자동 동기화 (#9 개선: 자동반영 체크박스 + 강제반영 옵션)
window.syncVendorBudgetTotal = function(force = false) {
  const inputs = document.querySelectorAll('.vendor-budget-input')
  let sum = 0
  inputs.forEach(inp => { sum += parseInt(inp.value||0)||0 })
  const sumEl = document.getElementById('vendorBudgetSum')
  if (sumEl) sumEl.textContent = fmt(sum)
  // 자동반영 체크박스 확인
  const autoCheckEl = document.getElementById('autoSyncTotalBudget')
  const shouldSync = force || (autoCheckEl ? autoCheckEl.checked : true)
  if (shouldSync) {
    const totalEl = document.getElementById('hb-total')
    if (totalEl) {
      totalEl.value = sum
      totalEl.style.background = '#f0fdf4'
      totalEl.style.borderColor = '#16a34a'
    }
  }
}

// 계정 목록 행 렌더
function renderAdminAccountRows(accounts) {
  if (!accounts || accounts.length === 0) {
    return `<div class="text-center py-8 text-gray-400">
      <i class="fas fa-user-circle text-3xl mb-2 block text-gray-300"></i>
      <p class="text-sm">등록된 계정이 없습니다</p>
    </div>`
  }
  return `<div class="divide-y divide-gray-50">
    ${accounts.map(a => {
      const lastActive = a.last_active ? new Date(a.last_active) : null
      const isOnline = lastActive && (Date.now() - lastActive.getTime()) < 3 * 60 * 1000
      const lastPage = a.current_page || ''
      const lastAction = a.last_action || ''
      const lastActiveStr = lastActive ? lastActive.toLocaleTimeString('ko-KR', {hour:'2-digit',minute:'2-digit'}) : '-'
      const pwDisplay = a.password_plain || null
      const pwId = `pw-disp-${a.id}`
      const isExec = a.role === 'executive'
      const roleBadge = isExec
        ? `<span class="badge text-xs px-2 py-0.5 rounded-full font-semibold" style="background:#dbeafe;color:#1e40af"><i class="fas fa-user-tie mr-1"></i>운영진</span>`
        : `<span class="badge text-xs px-2 py-0.5 rounded-full font-semibold" style="background:#dcfce7;color:#166534"><i class="fas fa-user-nurse mr-1"></i>영양사</span>`
      const titleDisplay = a.executive_title ? `<span class="text-xs text-blue-600 font-medium">${a.executive_title}</span>` : ''
      return `
      <div class="flex items-center gap-3 py-3 hover:bg-gray-50 px-2 rounded-lg">
        <div class="w-9 h-9 rounded-full ${isOnline ? (isExec?'bg-blue-100':'bg-green-100') : 'bg-gray-100'} flex items-center justify-center flex-shrink-0 relative">
          <i class="fas ${isExec?'fa-user-tie':'fa-user'} ${isOnline ? (isExec?'text-blue-600':'text-green-600') : 'text-gray-400'} text-sm"></i>
          <span class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${isOnline ? (isExec?'bg-blue-500':'bg-green-500') : 'bg-gray-300'}"></span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-medium text-sm">${a.username}</span>
            ${roleBadge}
            ${isOnline
              ? `<span class="text-xs font-semibold ${isExec?'text-blue-600 bg-blue-50 border border-blue-200':'text-green-600 bg-green-50 border border-green-200'} px-1.5 py-0.5 rounded-full">● 접속중</span>`
              : `<span class="text-xs text-gray-400">마지막 ${lastActiveStr}</span>`
            }
          </div>
          ${a.nutritionist_name ? `<div class="text-xs text-blue-600 font-medium"><i class="fas fa-user-nurse mr-1"></i>${a.nutritionist_name}</div>` : ''}
          ${titleDisplay}
          ${isOnline && lastAction ? `<div class="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded inline-block mt-0.5"><i class="fas fa-pencil-alt mr-0.5"></i>편집 중: ${lastAction}</div>` : ''}
          ${isOnline && !lastAction && lastPage ? `<div class="text-xs ${isExec?'text-blue-500':'text-green-500'}"><i class="fas fa-eye mr-1"></i>${lastPage}</div>` : ''}
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
          <button onclick="editAdminAccount(${a.id}, '${a.username}', '${(a.nutritionist_name||'').replace(/'/g, "\\'")}', '${a.role||'hospital'}', '${(a.executive_title||'').replace(/'/g, "\\'")}')"
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
          <div class="font-medium text-sm">${v.name}${v.is_card_type?'<span class="ml-1 text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-medium"><i class="fas fa-credit-card mr-0.5"></i>법인카드</span>':''}</div>
          <div class="text-xs text-gray-400">${getCategoryLabel(v.category)} · ${getTaxTypeLabel(v.tax_type)}</div>
        </div>
        <div class="text-sm text-gray-600 font-medium">${v.monthly_budget>0?fmtMan(v.monthly_budget)+'원':'목표없음'}</div>
        <div class="flex gap-1">
          <button onclick="editAdminVendor(${v.id})"
            data-name="${v.name.replace(/"/g,'&quot;')}" data-cat="${v.category}" data-tax="${v.tax_type}" data-budget="${v.monthly_budget}" data-iscard="${v.is_card_type||0}" data-cardsubtype="${v.card_subtype||'food'}"
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

function toggleAdminCardSubtype() {
  const isCard = document.getElementById('adminVendorIsCard').checked
  const wrap = document.getElementById('adminCardSubtypeWrap')
  if (wrap) wrap.classList.toggle('hidden', !isCard)
}

function showAdminAddVendorModal() {
  document.getElementById('adminVendorModalTitle').textContent = '업체 추가'
  document.getElementById('adminVendorId').value = ''
  document.getElementById('adminVendorName').value = ''
  document.getElementById('adminVendorCategory').value = 'general'
  document.getElementById('adminVendorTaxType').value = 'mixed'
  document.getElementById('adminVendorBudget').value = ''
  document.getElementById('adminVendorIsCard').checked = false
  document.getElementById('adminVendorCardSubtype').value = 'food'
  document.getElementById('adminCardSubtypeWrap').classList.add('hidden')
  document.getElementById('adminVendorModal').classList.remove('hidden')
}

function editAdminVendor(id) {
  const btn = document.querySelector(`[onclick="editAdminVendor(${id})"]`)
  const name = btn?.dataset.name || ''
  const category = btn?.dataset.cat || 'general'
  const taxType = btn?.dataset.tax || 'mixed'
  const budget = parseInt(btn?.dataset.budget || 0)
  const isCard = btn?.dataset.iscard === '1'
  const cardSubtype = btn?.dataset.cardsubtype || 'food'
  document.getElementById('adminVendorModalTitle').textContent = '업체 수정'
  document.getElementById('adminVendorId').value = id
  document.getElementById('adminVendorName').value = name
  document.getElementById('adminVendorCategory').value = category
  document.getElementById('adminVendorTaxType').value = taxType
  document.getElementById('adminVendorBudget').value = budget
  document.getElementById('adminVendorIsCard').checked = isCard
  document.getElementById('adminVendorCardSubtype').value = cardSubtype
  document.getElementById('adminCardSubtypeWrap').classList.toggle('hidden', !isCard)
  document.getElementById('adminVendorModal').classList.remove('hidden')
}

async function saveAdminVendor() {
  const hospitalId = window._adminHospitalId
  if (!hospitalId) return
  const vid = document.getElementById('adminVendorId').value
  const isCard = document.getElementById('adminVendorIsCard').checked
  const data = {
    name: document.getElementById('adminVendorName').value.trim(),
    category: document.getElementById('adminVendorCategory').value,
    taxType: document.getElementById('adminVendorTaxType').value,
    monthlyBudget: parseInt(document.getElementById('adminVendorBudget').value||0)||0,
    isCardType: isCard,
    cardSubtype: isCard ? document.getElementById('adminVendorCardSubtype').value : null
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
    // 업체별 목표금액 → 예산탭 자동 반영 (업체 저장 직후 각 input에 monthly_budget 반영)
    ;(updated || []).forEach(v => {
      const inp = document.getElementById(`hvb-${v.id}`)
      if (inp) inp.value = v.monthly_budget || 0
    })
    syncVendorBudgetTotal()
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

function showAdminAddAccountModal(roleType) {
  const isExec = (roleType === 'executive')
  document.getElementById('adminAccountModalTitle').textContent = isExec ? '운영진 계정 추가' : '계정 추가'
  document.getElementById('adminAccountId').value = ''
  document.getElementById('adminAccountRole').value = roleType || 'hospital'
  document.getElementById('adminAccountUsername').value = ''
  document.getElementById('adminAccountUsername').disabled = false
  document.getElementById('adminAccountPassword').value = ''
  document.getElementById('adminAccountPassword').type = 'text'
  document.getElementById('pwEyeIcon').className = 'fas fa-eye-slash'
  document.getElementById('adminAccountPwLabel').textContent = '비밀번호 *'
  document.getElementById('adminAccountPwHint').textContent = ''
  document.getElementById('adminAccountNutrName').value = ''
  document.getElementById('adminAccountNutrName').disabled = false
  // 운영진 전용 필드 표시/숨김
  document.getElementById('accountNutrNameRow').classList.toggle('hidden', isExec)
  document.getElementById('accountExecFieldsRow').classList.toggle('hidden', !isExec)
  if (isExec) {
    document.getElementById('adminAccountDisplayName').value = ''
    document.getElementById('adminAccountExecTitle').value = ''
  }
  document.getElementById('accountCreatedResult').classList.add('hidden')
  document.getElementById('accountModalBtns').innerHTML = `
    <button onclick="saveAdminAccount()" class="btn btn-primary flex-1" style="${isExec?'background:#1e40af':''}">${isExec?'운영진 추가':'저장'}</button>
    <button onclick="document.getElementById('adminAccountModal').classList.add('hidden'); document.getElementById('accountCreatedResult').classList.add('hidden')" class="btn btn-secondary flex-1">취소</button>`
  document.getElementById('adminAccountModal').classList.remove('hidden')
}

function editAdminAccount(id, username, nutriName, role, execTitle) {
  const isExec = (role === 'executive')
  document.getElementById('adminAccountModalTitle').textContent = isExec ? '운영진 계정 수정' : '계정 수정'
  document.getElementById('adminAccountId').value = id
  document.getElementById('adminAccountRole').value = role || 'hospital'
  document.getElementById('adminAccountUsername').value = username
  document.getElementById('adminAccountUsername').disabled = true
  document.getElementById('adminAccountPassword').value = ''
  document.getElementById('adminAccountPassword').type = 'password'
  document.getElementById('pwEyeIcon').className = 'fas fa-eye'
  document.getElementById('adminAccountPwLabel').textContent = '새 비밀번호 (변경 시에만 입력)'
  document.getElementById('adminAccountPwHint').textContent = '비워두면 기존 비밀번호 유지'
  // 운영진 전용 필드 표시/숨김
  document.getElementById('accountNutrNameRow').classList.toggle('hidden', isExec)
  document.getElementById('accountExecFieldsRow').classList.toggle('hidden', !isExec)
  if (isExec) {
    document.getElementById('adminAccountDisplayName').value = nutriName || ''
    document.getElementById('adminAccountExecTitle').value = execTitle || ''
  } else {
    document.getElementById('adminAccountNutrName').value = nutriName || ''
    document.getElementById('adminAccountNutrName').disabled = false
    document.getElementById('adminAccountNutrName').placeholder = '영양사 이름 변경 (선택)'
  }
  document.getElementById('accountCreatedResult').classList.add('hidden')
  document.getElementById('accountModalBtns').innerHTML = `
    <button onclick="saveAdminAccount()" class="btn btn-primary flex-1" style="${isExec?'background:#1e40af':''}">${isExec?'운영진 수정':'변경'}</button>
    <button onclick="document.getElementById('adminAccountModal').classList.add('hidden')" class="btn btn-secondary flex-1">취소</button>`
  document.getElementById('adminAccountModal').classList.remove('hidden')
}

async function saveAdminAccount() {
  const hospitalId = window._adminHospitalId
  if (!hospitalId) return
  const aid = document.getElementById('adminAccountId').value
  const role = document.getElementById('adminAccountRole')?.value || 'hospital'
  const isExec = (role === 'executive')
  const username = document.getElementById('adminAccountUsername').value.trim()
  const password = document.getElementById('adminAccountPassword').value
  const nutritionistName = isExec ? '' : (document.getElementById('adminAccountNutrName')?.value?.trim() || '')
  const displayName = isExec ? (document.getElementById('adminAccountDisplayName')?.value?.trim() || '') : ''
  const executiveTitle = isExec ? (document.getElementById('adminAccountExecTitle')?.value?.trim() || '') : ''

  if (!username) { showToast('아이디를 입력하세요', 'error'); return }
  if (!aid) {
    if (!password) { showToast('비밀번호를 입력하세요', 'error'); return }
    if (password.length < 4) { showToast('비밀번호는 4자 이상 입력하세요', 'error'); return }
  } else {
    if (password && password.length < 4) { showToast('비밀번호는 4자 이상 입력하세요', 'error'); return }
  }

  let res
  if (isExec) {
    const body = aid
      ? { displayName, executiveTitle, ...(password ? { password } : {}) }
      : { username, password, displayName, executiveTitle }
    res = aid
      ? await api('PUT', `/api/admin/hospitals/${hospitalId}/executive-accounts/${aid}`, body)
      : await api('POST', `/api/admin/hospitals/${hospitalId}/executive-accounts`, body)
  } else {
    const body = aid
      ? { nutritionistName, ...(password ? { password } : {}) }
      : { username, password, nutritionistName }
    res = aid
      ? await api('PUT', `/api/admin/hospitals/${hospitalId}/accounts/${aid}`, body)
      : await api('POST', `/api/admin/hospitals/${hospitalId}/accounts`, body)
  }

  if (res?.success) {
    if (!aid) {
      document.getElementById('createdUsername').textContent = username
      document.getElementById('createdPassword').textContent = password
      const nutrRow = document.getElementById('createdNutrRow')
      if (nutrRow) nutrRow.style.display = (isExec ? displayName : nutritionistName) ? '' : 'none'
      if (document.getElementById('createdNutrName')) document.getElementById('createdNutrName').textContent = isExec ? (displayName+(executiveTitle?` (${executiveTitle})`:'')) : nutritionistName
      document.getElementById('accountCreatedResult').classList.remove('hidden')
      document.getElementById('adminAccountUsername').disabled = true
      document.getElementById('adminAccountPassword').disabled = true
      if (document.getElementById('adminAccountNutrName')) document.getElementById('adminAccountNutrName').disabled = true
      document.getElementById('accountModalBtns').innerHTML = `
        <button onclick="document.getElementById('adminAccountModal').classList.add('hidden'); document.getElementById('accountCreatedResult').classList.add('hidden')" class="btn btn-primary flex-1">확인 후 닫기</button>`
      showToast(isExec ? '운영진 계정이 생성되었습니다' : '계정이 생성되었습니다', 'success')
    } else {
      document.getElementById('adminAccountModal').classList.add('hidden')
      showToast(isExec ? '운영진 정보가 수정되었습니다' : '계정이 수정되었습니다', 'success')
    }
    // 목록 새로고침
    const allAccounts = await api('GET', `/api/admin/hospitals/${hospitalId}/accounts`)
    document.getElementById('adminAccountList').innerHTML = renderAdminAccountRows((allAccounts || []).filter(a => a.role !== 'executive'))
    const execAccounts = await api('GET', `/api/admin/hospitals/${hospitalId}/executive-accounts`)
    document.getElementById('adminExecutiveList').innerHTML = renderAdminAccountRows(execAccounts || [])
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
  // 어떤 role인지 판단 (rows에서 data-role 활용 또는 계정 목록 검색)
  // 간단히 두 API 모두 시도 후 성공한 것 처리
  let res = await api('DELETE', `/api/admin/hospitals/${hospitalId}/accounts/${aid}`)
  if (!res?.success) {
    res = await api('DELETE', `/api/admin/hospitals/${hospitalId}/executive-accounts/${aid}`)
  }
  if (res?.success) {
    showToast('계정이 삭제되었습니다', 'success')
    const allAccounts = await api('GET', `/api/admin/hospitals/${hospitalId}/accounts`)
    document.getElementById('adminAccountList').innerHTML = renderAdminAccountRows((allAccounts || []).filter(a => a.role !== 'executive'))
    const execAccounts = await api('GET', `/api/admin/hospitals/${hospitalId}/executive-accounts`)
    document.getElementById('adminExecutiveList').innerHTML = renderAdminAccountRows(execAccounts || [])
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
    document.getElementById(`tabSaveBtn-${t}`)?.classList.toggle('hidden', t !== tab)
  })
  // 현재 탭 안내 라벨 업데이트
  const tabNames = { info:'기본정보', categories:'환자군 설정', vendors:'업체 관리', budget:'예산 설정', accounts:'계정 관리' }
  const lbl = document.getElementById('currentTabLabel')
  if (lbl) lbl.innerHTML = `<i class="fas fa-circle-dot mr-1"></i>현재: <strong class="text-gray-600">${tabNames[tab]||tab}</strong> 탭${ tab==='vendors'||tab==='accounts' ? ' — 우측 버튼으로 추가' : ' — 우측 상단 버튼으로 저장' }`
  // 환자군 탭으로 전환 시 데이터 로드
  if (tab === 'categories' && window._adminHospitalId) {
    loadPatientCategories(window._adminHospitalId)
  }
  // 예산 탭으로 전환 시 업체별 합계 자동 계산
  if (tab === 'budget') {
    setTimeout(() => syncVendorBudgetTotal(), 50)
  }
}

// 환자군 탭: 식이분류 + 목표금액 동시 저장
async function saveDietAndBudgets(hospitalId) {
  showToast('환자군 설정 저장 중...', 'info')
  try {
    await saveDietCategories(hospitalId)
    await saveCategoryBudgets(hospitalId)
    showToast('환자군 설정 저장 완료!', 'success')
  } catch(e) {
    showToast('저장 중 오류 발생', 'error')
  }
}

// 전체 탭 한 번에 저장 (전체저장 제거 대비 레거시 유지)
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
    care_type: document.getElementById('hi-caretype')?.value || 'general',
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
  window._currentAdminHospitalId = hospitalId
  const [cats, catSettingsResp, dietCats, presets] = await Promise.all([
    api('GET', `/api/admin/hospitals/${hospitalId}/patient-categories`),
    api('GET', `/api/admin/hospitals/${hospitalId}/category-settings/${App.currentYear}/${App.currentMonth}`),
    api('GET', `/api/admin/hospitals/${hospitalId}/diet-categories`),
    api('GET', `/api/admin/diet-category-presets`)
  ])
  window._patientCategories = cats || []
  window._adminCatList = cats || []
  window._dietCategories = dietCats || []
  window._dietPresets = presets || []
  window._currentDietTypeTab = 'patient'

  const catSettings = Array.isArray(catSettingsResp) ? catSettingsResp : (catSettingsResp?.settings || [])
  const isCatFallback = catSettingsResp?.isFallback || false
  const catFallbackYearMonth = catSettingsResp?.fallbackYearMonth || ''

  // ── 카테고리별 목표 설정에는 diet_categories의 patient 타입만 표시 ──
  // hospital_patient_categories에 비급여/치료식 항목이 섞여 들어간 경우를 방지
  const patientOnlyDietCats = (dietCats || []).filter(dc => dc.parent_type === 'patient' && dc.is_active)

  // diet_categories patient 항목 → patient_categories 형태로 변환 (예산 설정용)
  let catsForBudget = []
  if (patientOnlyDietCats.length > 0) {
    // diet_categories 기반: category_key = diet_key, category_name = diet_name
    // category-settings는 patient_category_id 기준이므로 legacyKey로 매핑
    catsForBudget = patientOnlyDietCats.map(dc => {
      // hospital_patient_categories에서 같은 이름의 항목 찾기
      const matched = (cats || []).find(c =>
        c.category_name === dc.diet_name ||
        c.category_key === (dc.legacy_field_key || dc.diet_key) ||
        ('legacy_' + c.category_key) === dc.diet_key
      )
      return matched || {
        id: dc.id,  // fallback: diet_cat id 사용
        hospital_id: hospitalId,
        category_name: dc.diet_name,
        category_key: dc.diet_key,
        is_active: dc.is_active,
        sort_order: dc.sort_order || 0,
        order_code: '',
        budget_include_keys: null,
        meals_include_keys: null,
      }
    })
  } else {
    // diet_categories 없는 경우 기존 patient_categories 사용 (대분류만 필터링)
    // category_key 기준: 알려진 비급여/치료 키 제외
    const NON_PATIENT_KEYS = new Set(['other','general','guardian','outpatient','special','staff','night_shift'])
    catsForBudget = (cats || []).filter(c => {
      // diet_categories에 noncovered/therapy로 등록된 항목 제외
      const matchedDiet = (dietCats || []).find(dc =>
        dc.diet_name === c.category_name ||
        ('legacy_' + c.category_key) === dc.diet_key
      )
      if (matchedDiet && matchedDiet.parent_type !== 'patient') return false
      return true
    })
  }

  renderDietCategoryList()
  renderDietPresetChips()
  window._budgetCats = catsForBudget  // 예산 설정용 환자군(대분류만) 저장
  renderCategoryBudgetList(catsForBudget, catSettings, isCatFallback, catFallbackYearMonth)
}

// ── 식이 분류 관련 상수 ──────────────────────────────────────
const DIET_TYPE_META = {
  patient:    { name:'환자식',   color:'#2563eb', bg:'#eff6ff', border:'#bfdbfe', icon:'fa-user-injured' },
  therapy:    { name:'치료식',   color:'#16a34a', bg:'#f0fdf4', border:'#bbf7d0', icon:'fa-pills' },
  noncovered: { name:'비급여식', color:'#9333ea', bg:'#faf5ff', border:'#e9d5ff', icon:'fa-hand-holding-usd' },
  staff:      { name:'직원식',   color:'#d97706', bg:'#fffbeb', border:'#fde68a', icon:'fa-user-tie' },
}

function switchDietTypeTab(type) {
  window._currentDietTypeTab = type
  Object.keys(DIET_TYPE_META).forEach(k => {
    const btn = document.getElementById(`dietTypeTab-${k}`)
    if (!btn) return
    if (k === type) {
      btn.className = 'px-3 py-2 text-xs font-semibold rounded-t-lg border border-b-0 transition bg-white border-gray-200'
      btn.style.marginBottom = '-1px'
      btn.style.borderColor = '#e5e7eb'
      btn.style.color = DIET_TYPE_META[k].color
    } else {
      btn.className = 'px-3 py-2 text-xs font-semibold rounded-t-lg border border-b-0 transition bg-gray-50 border-transparent text-gray-500 hover:bg-white'
      btn.style.marginBottom = ''
      btn.style.borderColor = ''
      btn.style.color = ''
    }
  })
  renderDietCategoryList()
  renderDietPresetChips()
}

function renderDietPresetChips() {
  const el = document.getElementById('dietPresetChips')
  if (!el) return
  const type = window._currentDietTypeTab || 'patient'
  const presets = (window._dietPresets || []).filter(p => p.parent_type === type)
  const existingNames = new Set((window._dietCategories || []).filter(d => d.parent_type === type && d.is_active).map(d => d.diet_name))
  const meta = DIET_TYPE_META[type]
  if (!presets.length) { el.innerHTML = '<span class="text-xs text-gray-300">프리셋 없음</span>'; return }
  el.innerHTML = presets.map(p => {
    const already = existingNames.has(p.preset_name)
    return `<button type="button" onclick="quickAddDietPreset('${p.preset_key}','${p.parent_type}','${p.preset_name.replace(/'/g,"\\'")}',this)"
      class="px-2 py-1 text-xs rounded-full border transition ${already
        ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
        : 'bg-white hover:opacity-80'}"
      style="${already ? '' : `border-color:${meta.border};color:${meta.color};background:${meta.bg}`}"
      ${already ? 'disabled title="이미 추가됨"' : ''}>
      ${already ? '<i class="fas fa-check mr-0.5 text-gray-400"></i>' : '<i class="fas fa-plus mr-0.5"></i>'}${p.preset_name}
    </button>`
  }).join('')
}

async function quickAddDietPreset(presetKey, parentType, presetName, btn) {
  const hid = window._currentAdminHospitalId
  if (!hid) return
  btn.disabled = true
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-0.5"></i>추가중'
  const result = await api('POST', `/api/admin/hospitals/${hid}/diet-categories`, {
    parent_type: parentType,
    diet_name: presetName,
    diet_key: presetKey + '_' + hid,
    is_active: 1,
    show_in_input: 1,
    sort_order: (window._dietCategories || []).filter(d => d.parent_type === parentType).length
  })
  if (result && result.id) {
    window._dietCategories = [...(window._dietCategories || []), result]
    showToast(`'${presetName}' 추가 완료`, 'success')
    renderDietCategoryList()
    renderDietPresetChips()
  } else {
    showToast('추가 실패', 'error')
    btn.disabled = false
  }
}

function renderDietCategoryList() {
  const el = document.getElementById('dietCategoryList')
  if (!el) return
  const type = window._currentDietTypeTab || 'patient'
  const meta = DIET_TYPE_META[type]
  const items = (window._dietCategories || []).filter(d => d.parent_type === type)
  // 환자군 목록 (patient 타입만)
  const patientGroups = (window._dietCategories || []).filter(d => d.parent_type === 'patient' && d.is_active)

  // 환자군 선택 옵션 HTML
  const patientGroupOptions = (grp) => `
    <option value="">-- 미지정 --</option>
    ${patientGroups.map(pg => `<option value="${pg.patient_group || pg.diet_key}" ${(grp === (pg.patient_group || pg.diet_key)) ? 'selected' : ''}>${pg.diet_name}</option>`).join('')}
  `

  if (!items.length) {
    el.innerHTML = `<div class="text-xs text-gray-400 text-center py-6 border-2 border-dashed rounded-xl"
      style="border-color:${meta.border}">
      <i class="fas ${meta.icon} text-2xl mb-2 block" style="color:${meta.border}"></i>
      ${meta.name} 항목이 없습니다.<br>
      <span class="text-gray-300">위 프리셋에서 추가하거나 직접 추가하세요.</span>
    </div>`
    return
  }

  // 타입별 헤더 안내문
  const headerHint = {
    patient: '식단가 설정 대상 · 각 환자군의 일반식+치료식 합산 기준',
    therapy: '치료식은 환자군에 연결하여 식수 입력 시 그룹화됩니다',
    noncovered: '식단가 계산 포함 여부를 항목별로 설정하세요',
    staff: '직원식 세부 항목 (식단가 계산 제외)',
  }[type] || ''

  el.innerHTML = `
  <div class="rounded-xl overflow-hidden border" style="border-color:${meta.border}">
    <div class="px-3 py-2 text-xs font-bold flex items-center gap-2"
      style="background:${meta.bg};color:${meta.color};border-bottom:1px solid ${meta.border}">
      <i class="fas ${meta.icon}"></i>${meta.name} (${items.filter(i=>i.is_active).length}개 활성)
      <span class="ml-auto text-gray-400 font-normal text-right" style="font-size:9px">${headerHint}</span>
    </div>
    ${type === 'patient' ? `
    <div class="px-3 py-2 bg-blue-50 border-b border-blue-100 text-xs text-blue-700">
      <i class="fas fa-info-circle mr-1"></i>
      <strong>환자군</strong>이 식단가 계산의 기준 단위입니다. 식단가(원/식)와 월 목표금액을 환자군별로 설정하세요.<br>
      <span class="text-blue-500">치료식이 이 환자군에 연결되면 치료식 식수도 합산되어 계산됩니다.</span>
    </div>` : ''}
    ${type === 'noncovered' ? `
    <div class="px-3 py-2 bg-purple-50 border-b border-purple-100 text-xs text-purple-700">
      <i class="fas fa-info-circle mr-1"></i>
      <strong>식단가 포함</strong>을 ON으로 설정한 비급여 항목만 식단가 계산 분자(식수)에 포함됩니다.<br>
      <span class="text-purple-500">기본값: 공기밥추가·간식·기타 = OFF (포함 안 함) / 보호자식·외래식·특식 = 관리자 선택</span>
    </div>` : ''}
    ${type === 'therapy' ? `
    <div class="px-3 py-2 bg-green-50 border-b border-green-100 text-xs text-green-700">
      <i class="fas fa-info-circle mr-1"></i>
      치료식은 <strong>환자군 연결</strong>을 설정하면 식수 입력 시 해당 환자군 하위에 그룹화됩니다.<br>
      <span class="text-green-600">연결된 치료식 식수는 해당 환자군의 식단가 계산에 자동 합산됩니다.</span>
    </div>
    <div class="px-3 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-700">
      <i class="fas fa-exclamation-triangle mr-1 text-amber-500"></i>
      <strong>치료식은 별도 목표금액 설정 없음</strong> — 항암식·요양식 등 환자군의 대분류(환자식)에 포함되어 계산됩니다.<br>
      <span class="text-amber-600">예산 목표는 환자군(환자식 탭)에서 설정하세요.</span>
    </div>` : ''}
    <div class="divide-y" style="divide-color:${meta.border}">
    ${items.map((cat, i) => {
      const linkedGrp = cat.linked_patient_group || cat.patient_group || ''
      const includeInPrice = cat.include_in_meal_price || 0
      return `
      <div class="px-3 py-2.5 bg-white hover:bg-gray-50 transition" id="dietRow-${cat.id}">
        <div class="flex items-center gap-2">
          <span class="w-5 h-5 rounded text-white text-center text-xs flex items-center justify-center flex-shrink-0 font-bold"
            style="background:${meta.color};opacity:${cat.is_active?1:0.35}">
            ${cat.diet_name.charAt(0)}
          </span>
          <input type="text" value="${cat.diet_name}" placeholder="식이명"
            class="form-input flex-1 text-sm py-1 min-w-0"
            data-diet-id="${cat.id}" data-field="diet_name"
            onchange="updateDietCatField(${cat.id},'diet_name',this.value)">
          <!-- 사용여부 -->
          <label class="flex flex-col items-center gap-0.5 flex-shrink-0 cursor-pointer">
            <span class="text-gray-400" style="font-size:9px">사용</span>
            <div class="relative">
              <input type="checkbox" class="sr-only" ${cat.is_active ? 'checked' : ''}
                onchange="updateDietCatField(${cat.id},'is_active',this.checked?1:0)">
              <div class="toggle-track w-8 h-4 rounded-full transition" style="background:${cat.is_active?meta.color:'#d1d5db'}"></div>
              <div class="toggle-thumb absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition" style="transform:${cat.is_active?'translateX(16px)':'translateX(0)'}"></div>
            </div>
          </label>
          <!-- 식수노출 -->
          <label class="flex flex-col items-center gap-0.5 flex-shrink-0 cursor-pointer">
            <span class="text-gray-400" style="font-size:9px">노출</span>
            <div class="relative">
              <input type="checkbox" class="sr-only" ${cat.show_in_input ? 'checked' : ''}
                onchange="updateDietCatField(${cat.id},'show_in_input',this.checked?1:0)">
              <div class="toggle-track w-8 h-4 rounded-full transition" style="background:${cat.show_in_input?'#0ea5e9':'#d1d5db'}"></div>
              <div class="toggle-thumb absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition" style="transform:${cat.show_in_input?'translateX(16px)':'translateX(0)'}"></div>
            </div>
          </label>
          ${type === 'patient' ? `
          <!-- 식단가 (환자군만) -->
          <div class="flex flex-col items-center gap-0.5 flex-shrink-0">
            <span class="text-gray-400" style="font-size:9px">식단가(원)</span>
            <input type="number" value="${cat.target_meal_price||0}" min="0" step="100"
              class="form-input text-sm py-0.5 text-center" style="width:68px"
              data-diet-id="${cat.id}" data-field="target_meal_price"
              onchange="updateDietCatField(${cat.id},'target_meal_price',Number(this.value))">
          </div>
          <!-- 월목표 -->
          <div class="flex flex-col items-center gap-0.5 flex-shrink-0">
            <span class="text-gray-400" style="font-size:9px">월목표(만원)</span>
            <input type="number" value="${Math.round((cat.monthly_budget||0)/10000)}" min="0" step="10"
              class="form-input text-sm py-0.5 text-center" style="width:68px"
              data-diet-id="${cat.id}" data-field="monthly_budget"
              onchange="updateDietCatField(${cat.id},'monthly_budget',Number(this.value)*10000)">
          </div>` : ''}
          ${type === 'noncovered' ? `
          <!-- 식단가 포함 여부 -->
          <label class="flex flex-col items-center gap-0.5 flex-shrink-0 cursor-pointer" title="식단가 계산 분자(식수)에 포함">
            <span style="font-size:9px;color:${includeInPrice?'#7c3aed':'#9ca3af'}">식단가포함</span>
            <div class="relative">
              <input type="checkbox" class="sr-only" ${includeInPrice ? 'checked' : ''}
                onchange="updateDietCatField(${cat.id},'include_in_meal_price',this.checked?1:0)">
              <div class="toggle-track w-8 h-4 rounded-full transition" style="background:${includeInPrice?'#7c3aed':'#d1d5db'}"></div>
              <div class="toggle-thumb absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition" style="transform:${includeInPrice?'translateX(16px)':'translateX(0)'}"></div>
            </div>
          </label>` : ''}
          <!-- 삭제 -->
          <button onclick="deleteDietCategory(${cat.id})"
            class="text-red-300 hover:text-red-600 text-sm px-1 py-1 rounded hover:bg-red-50 flex-shrink-0 transition">
            <i class="fas fa-trash-alt"></i>
          </button>
        </div>
        ${type === 'therapy' ? `
        <!-- 치료식: 환자군 연결 선택 -->
        <div class="mt-1.5 ml-7 flex items-center gap-2">
          <span class="text-xs text-gray-400 flex-shrink-0" style="font-size:10px"><i class="fas fa-link mr-0.5 text-green-400"></i>환자군 연결:</span>
          <select class="form-input text-xs py-0.5 flex-1" style="max-width:160px"
            onchange="updateDietCatField(${cat.id},'linked_patient_group',this.value||null)">
            ${patientGroupOptions(linkedGrp)}
          </select>
          <span class="text-xs text-gray-400" style="font-size:9px">${linkedGrp ? `→ ${patientGroups.find(p=>(p.patient_group||p.diet_key)===linkedGrp)?.diet_name||linkedGrp} 그룹에 포함` : '미연결 시 독립 표시'}</span>
        </div>` : ''}
        ${type === 'patient' ? `
        <!-- 환자군: 연결된 치료식 표시 -->
        ${(() => {
          const therapies = (window._dietCategories||[]).filter(d => d.parent_type==='therapy' && d.is_active && (d.linked_patient_group||d.patient_group)===(cat.patient_group||cat.diet_key))
          return therapies.length > 0 ? `
          <div class="mt-1.5 ml-7 flex flex-wrap gap-1 items-center">
            <span class="text-xs text-blue-400" style="font-size:9px"><i class="fas fa-pills mr-0.5"></i>연결된 치료식:</span>
            ${therapies.map(t => `<span class="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs" style="font-size:9px">${t.diet_name}</span>`).join('')}
          </div>` : `
          <div class="mt-1.5 ml-7 text-xs text-gray-300" style="font-size:9px"><i class="fas fa-pills mr-0.5"></i>연결된 치료식 없음</div>`
        })()}` : ''}
      </div>`
    }).join('')}
    </div>
  </div>`
}

function updateDietCatField(id, field, value) {
  const cat = (window._dietCategories || []).find(d => d.id === id)
  if (!cat) return
  cat[field] = value
  // 토글 시각 즉시 반영
  const row = document.getElementById(`dietRow-${id}`)
  if (row && (field === 'is_active' || field === 'show_in_input' || field === 'include_in_meal_price')) {
    const tracks = row.querySelectorAll('.toggle-track')
    const thumbs = row.querySelectorAll('.toggle-thumb')
    const meta = DIET_TYPE_META[cat.parent_type]
    if (field === 'is_active') {
      if (tracks[0]) tracks[0].style.background = value ? meta.color : '#d1d5db'
      if (thumbs[0]) thumbs[0].style.transform = value ? 'translateX(16px)' : 'translateX(0)'
    } else if (field === 'show_in_input') {
      if (tracks[1]) tracks[1].style.background = value ? '#0ea5e9' : '#d1d5db'
      if (thumbs[1]) thumbs[1].style.transform = value ? 'translateX(16px)' : 'translateX(0)'
    } else if (field === 'include_in_meal_price') {
      if (tracks[2]) tracks[2].style.background = value ? '#7c3aed' : '#d1d5db'
      if (thumbs[2]) thumbs[2].style.transform = value ? 'translateX(16px)' : 'translateX(0)'
    }
  }
  // 치료식-환자군 연결 변경 시 환자식 탭 재렌더 (연결된 치료식 표시 갱신)
  if (field === 'linked_patient_group' && window._currentDietTypeTab === 'therapy') {
    // 환자식 탭의 연결 치료식 목록은 환자식 탭 전환 시 반영됨
  }
}

async function deleteDietCategory(id) {
  if (!confirm('이 식이 항목을 삭제(비활성화)할까요?')) return
  const hid = window._currentAdminHospitalId
  await api('DELETE', `/api/admin/hospitals/${hid}/diet-categories/${id}`)
  window._dietCategories = (window._dietCategories || []).filter(d => d.id !== id)
  renderDietCategoryList()
  renderDietPresetChips()
  showToast('삭제 완료', 'success')
}

function openAddDietModal(hospitalId) {
  const type = window._currentDietTypeTab || 'patient'
  const meta = DIET_TYPE_META[type]
  const name = prompt(`새 ${meta.name} 항목 이름을 입력하세요:`)
  if (!name?.trim()) return
  quickAddDietPreset('custom_'+Date.now(), type, name.trim(), { disabled: false, innerHTML: '' })
}

async function saveDietCategories(hospitalId) {
  const cats = window._dietCategories || []
  if (!cats.length) { showToast('저장할 항목이 없습니다', 'warning'); return }
  const btn = event?.target
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>저장중' }
  const res = await api('PUT', `/api/admin/hospitals/${hospitalId}/diet-categories`, { categories: cats })
  if (res?.success) {
    window._dietCategories = res.categories || cats
    showToast('✅ 식이 분류 저장 완료', 'success')
    renderDietCategoryList()
    renderDietPresetChips()
  } else {
    showToast('저장 실패', 'error')
  }
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-1"></i>변경사항 저장' }
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

// ── 체크박스 전체선택/전체해제 헬퍼 ──────────────────────────
window.checkAllFormulaCbs = function(className, catId, check) {
  document.querySelectorAll(`.${className}[data-cat="${catId}"]`).forEach(cb => { cb.checked = check })
}

function renderCategoryBudgetList(cats, settings, isFallback = false, fallbackYearMonth = '') {
  const el = document.getElementById('categoryBudgetList')
  if (!el) return

  if (!cats || cats.length === 0) {
    el.innerHTML = `<div class="text-xs text-gray-400 text-center py-2">카테고리를 먼저 저장하세요</div>`
    return
  }

  // fallback 안내 배너
  const fallbackBanner = isFallback ? `
    <div class="mb-2 p-2 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-1.5">
      <i class="fas fa-exclamation-triangle text-amber-500 text-xs mt-0.5"></i>
      <span class="text-xs text-amber-700">${App.currentYear}년 ${App.currentMonth}월 환자군 목표 설정이 없어 <strong>${fallbackYearMonth}</strong> 기준값을 표시합니다. 저장하면 현재 월에 새로 저장됩니다.</span>
    </div>` : `
    <div class="mb-2 p-2 bg-blue-50 border border-blue-100 rounded-lg flex items-start gap-1.5">
      <i class="fas fa-info-circle text-blue-400 text-xs mt-0.5"></i>
      <span class="text-xs text-blue-600">저장한 목표값이 설정 없는 모든 달에 <strong>기본값</strong>으로 자동 적용됩니다.</span>
    </div>`

  const settingsMap = {}
  ;(settings || []).forEach(s => { settingsMap[s.patient_category_id] = s })

  el.innerHTML = fallbackBanner + cats.map(cat => {
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
    // 식수 항목 선택지 구성: 직원식 개별항목 + 환자군 식수 + 비급여식 (공기밥추가 제외)
    // ※ 기존 '직원식'(staff) 단일항목·'보호자식'(guardian) 단일항목 제거 → 개별 diet_category 항목으로 대체
    const staffDietsForMeals = (window._dietCategories || [])
      .filter(dc => dc.parent_type === 'staff' && dc.is_active)
    const noncoveredForMeals = (window._dietCategories || [])
      .filter(dc => dc.parent_type === 'noncovered' && dc.is_active)
      .filter(dc => {
        // 공기밥추가(rice_extra 포함 key) 제외
        const k = (dc.diet_key || '').toLowerCase()
        return !k.includes('rice_extra') && !k.includes('rice_add')
      })
    const mealsOptions = [
      // 직원식 개별 항목 (st_key_{diet_key}) - 직원식 전체 합계 공유
      ...staffDietsForMeals.map(dc => ({ key: `st_key_${dc.diet_key}`, label: dc.diet_name + ' (직원)' })),
      // 보호자식은 비급여식 개별 항목으로 포함되므로 별도 단일 항목 제거
      ...cats.map(c => ({ key: `cat_${c.category_key}`, label: c.category_name + ' 식수' })),
      ...noncoveredForMeals.map(dc => ({ key: `nc_key_${dc.diet_key}`, label: dc.diet_name + ' (비급여)' }))
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
            <span class="text-amber-600 font-medium"><i class="fas fa-info-circle mr-1"></i>비급여식은 항목별 체크로 식수에 포함/제외 설정 가능 (공기밥추가 제외)</span><br>
            <span class="text-green-700 font-medium"><i class="fas fa-user-tie mr-1"></i>직원식 항목 체크 시 직원 전체 식수 합계가 포함됩니다 (항목별 세분화 미지원)</span>
          </div>
          <!-- 예산 포함 항목 -->
          <div>
            <div class="flex items-center justify-between mb-1">
              <div class="text-xs font-semibold text-gray-600">📊 예산 포함 항목</div>
              <div class="flex gap-1">
                <button type="button" onclick="checkAllFormulaCbs('budget-include-cb','${cat.id}',true)" class="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 font-medium">전체선택</button>
                <button type="button" onclick="checkAllFormulaCbs('budget-include-cb','${cat.id}',false)" class="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 font-medium">전체해제</button>
              </div>
            </div>
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
            <div class="flex items-center justify-between mb-1">
              <div class="text-xs font-semibold text-gray-600">🍽 식수 포함 항목</div>
              <div class="flex gap-1">
                <button type="button" onclick="checkAllFormulaCbs('meals-include-cb','${cat.id}',true)" class="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 font-medium">전체선택</button>
                <button type="button" onclick="checkAllFormulaCbs('meals-include-cb','${cat.id}',false)" class="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 font-medium">전체해제</button>
              </div>
            </div>
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
  // _budgetCats 우선 사용 (diet_categories patient 타입만), 없으면 기존 _patientCategories
  const cats = window._budgetCats || window._patientCategories || []
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
  if (res?.success) {
    showToast(`카테고리별 기본 목표가 저장되었습니다 (모든 달 적용)`, 'success')
    loadPatientCategories(hospitalId)
  } else showToast('저장 실패', 'error')
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
  if (res?.success) {
    showToast(`기본 예산 설정이 저장되었습니다 (${App.currentYear}년 ${App.currentMonth}월 기준 - 모든 달 적용)`, 'success')
    // 예산 설정 탭 안내 배너 업데이트
    openHospitalDetail(hospitalId)
  } else showToast('저장 실패', 'error')
}

// 2.8 관리자 - 병원별 잔반 단가 즉시 저장
window.saveWasteUnitPriceAdmin = async function(hospitalId) {
  const unitPrice = parseInt(document.getElementById('hb-waste-unit-price')?.value||0)||0
  // admin API를 통해 해당 병원의 waste_unit_price 저장
  const res = await api('POST', `/api/admin/hospitals/${hospitalId}/budget/${App.currentYear}/${App.currentMonth}`, {
    waste_unit_price: unitPrice,
    _partial: true  // 부분 업데이트 플래그
  })
  if (res?.success) {
    showToast('잔반 단가가 저장되었습니다.', 'success')
  } else {
    showToast('저장 실패', 'error')
  }
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

  const [summaryData, annualData, nextSettingsData, cardReportData] = await Promise.all([
    api('GET', `/api/dashboard/summary/${reportYear}/${reportMonth}?hospitalId=${targetHospitalId}`),
    api('GET', `/api/dashboard/annual/${reportYear}?hospitalId=${targetHospitalId}`),
    api('GET', `/api/settings/${nextYear}/${nextMonth}?hospitalId=${targetHospitalId}`),
    targetHospitalId
      ? api('GET', `/api/card-expenses/admin/${targetHospitalId}/${reportYear}/${reportMonth}`)
      : api('GET', `/api/card-expenses/monthly/${reportYear}/${reportMonth}`)
  ])

  const s = summaryData?.summary || {}
  const vendors = summaryData?.vendors || []
  const ms = summaryData?.mealStats || {}
  const dailyOrders = summaryData?.dailyOrders || []
  const vendorOrders = summaryData?.vendorOrders || vendors

  // 법인카드 데이터 정리
  const rptCardExpenses = (cardReportData?.expenses || []).sort((a, b) => a.expense_date.localeCompare(b.expense_date))
  const rptCardTotal = rptCardExpenses.reduce((s, e) => s + (e.amount || 0), 0)
  const subtypeLabels = { food:'식재료', supplies:'소모품', online:'온라인', other:'기타' }
  const rptCardBySubtypeMap = {}
  rptCardExpenses.forEach(e => {
    const k = e.card_subtype || 'other'
    if (!rptCardBySubtypeMap[k]) rptCardBySubtypeMap[k] = { subtype: k, label: subtypeLabels[k]||'기타', total: 0, count: 0 }
    rptCardBySubtypeMap[k].total += e.amount || 0
    rptCardBySubtypeMap[k].count++
  })
  const rptCardBySubtype = Object.values(rptCardBySubtypeMap)

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

  // 식단가 계산 (보고서용) - 새 방식: 커스텀 필드 합계 사용 (total_patient/staff/guardian은 이제 항상 0)
  const rptMealCustomTotals = summaryData?.mealCustomTotals || summaryData?.mealCustomFields?.reduce((acc, f) => {
    acc[f.field_key] = 0; return acc
  }, {}) || {}
  const rptCustomFields = summaryData?.mealCustomFields || []
  // 커스텀 필드 합계 (ea 단위 제외)
  const rptCustomMealTotal = rptCustomFields
    .filter(f => f.unit_type !== 'ea')
    .reduce((s, f) => s + (rptMealCustomTotals[f.field_key] || 0), 0)
  // 전체 식수: 커스텀 합계 + 직원(레거시) + 보호자(레거시)
  const rptTotalMeals = rptCustomMealTotal + (ms.total_staff||0) + (ms.total_guardian||0)
  // 대시보드 API의 totalMeals 사용 (서버 계산 우선)
  const rptTotalMealsFromApi = summaryData?.totalMeals || rptTotalMeals
  const mealPriceForRpt = rptTotalMealsFromApi > 0 && (s.totalUsed||0) > 0
    ? Math.round((s.totalUsed||0) / rptTotalMealsFromApi) : (s.mealPrice || 0)

  // ── 새 보고서 섹션용 변수 매핑 ──────────────────────────────────────────
  // settings에서 meal_price 가져오기 (summaryData.settings 혹은 catDietPrices[0].targetPrice)
  const _settings = summaryData?.settings || {}
  const _targetMealPrice = _settings.meal_price || (summaryData?.catDietPrices?.[0]?.targetPrice) || 0

  const rptSummary = {
    progress: parseFloat(s.progress) || 0,
    totalBudget: s.totalBudget || _settings.total_budget || 0,
    usedAmount: s.totalUsed || 0,
    remainAmount: s.remaining || ((s.totalBudget||0) - (s.totalUsed||0)),
    totalPatients: rptTotalMealsFromApi,
    avgPatients: rptTotalMealsFromApi,
    normalCount: rptCustomMealTotal || ms.total_patient || 0,  // 커스텀 합계 (일반식+치료식 등)
    therapeuticCount: ms.total_noncovered || 0,
    softCount: 0,
    staffCount: ms.total_staff || 0,
    normalMealPrice: s.mealPriceTotal || s.normalMealPrice || mealPriceForRpt || 0,
    therapeuticMealPrice: s.therapeuticMealPrice || 0,
    softMealPrice: s.softMealPrice || 0,
    targetMealPrice: _targetMealPrice,
    mealPriceTarget: _targetMealPrice,
    nutritionistName: s.nutritionistName || s.nutritionist_name || '',
  }
  const rptOrders = (vendorOrders || []).map(v => ({
    vendor: v.vendor_name || v.vendorName || v.name || v.vendor || '',
    vendorName: v.vendor_name || v.vendorName || v.name || '',
    totalAmount: v.total_used || v.total_amount || v.totalAmount || v.amount || 0,
    amount: v.total_used || v.total_amount || v.totalAmount || v.amount || 0,
  })).sort((a,b) => b.totalAmount - a.totalAmount)
  const rptDailyOrders = dailyLabels.map((label, i) => ({
    day: label,
    date: label,
    totalAmount: dailyValues[i] || 0,
    amount: dailyValues[i] || 0,
  })).filter(d => d.totalAmount > 0)
  const rptAnnual = annualData || {}
  const rptNextMonth = { goals: null }

  // ── 추가 분석 데이터 (백엔드 응답에서 직접 추출) ──────────────────────
  const rptProjection    = summaryData?.projection || {}
  const rptDepletion     = summaryData?.budgetDepletion || {}
  const rptAnomalies     = summaryData?.anomalies || []
  const rptAutoAnalysis  = summaryData?.autoAnalysis || []
  const rptCatDietPrices = summaryData?.catDietPrices || []
  const rptPrevMonth     = summaryData?.prevMonth || {}
  const rptMealCustomFields = summaryData?.mealCustomFields || []
  // rptMealCustomTotals는 위(line 12698)에서 이미 선언됨 (중복 제거)

  // 카테고리별 식수 (mealCustomTotals에서 전체 커스텀 필드 추출 - cat_ 키 + diet_ 키 포함)
  const rptCatMeals = rptMealCustomFields
    .filter(f => f.unit_type !== 'ea')
    .map(f => ({
      key: f.field_key,
      name: f.field_name || f.field_key,
      count: rptMealCustomTotals[f.field_key] || 0
    }))
    .filter(c => c.count > 0)

  // 월별 식수 추이 (연간 데이터에서)
  const rptMonthlyMeals    = (annualData?.mealMonthly || [])
  const rptMonthlyUsed     = (annualData?.monthly || [])
  const rptMonthlySettings = (annualData?.settings || [])
  // 월별 카테고리별 식수 세분화 데이터 (PAGE 7용)
  const rptMonthCatMeals   = annualData?.monthCatMeals || {}
  const rptAnnualCats      = annualData?.annualCats || []

  // 일별 발주 전체 (0 포함, 추세선용)
  const rptDailyAll = dailyLabels.map((label, i) => ({
    day: parseInt(label),
    amount: dailyValues[i] || 0
  }))

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
    <div class="ml-auto flex gap-2 flex-wrap">
      <button onclick="showPrintPreview()" class="btn btn-sm" style="background:#f0fdf4;color:#166534;border:1px solid #bbf7d0">
        <i class="fas fa-search mr-1"></i>인쇄 미리보기
      </button>
      <button onclick="printReportA4()" class="btn btn-sm" style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe">
        <i class="fas fa-print mr-1"></i>인쇄하기
      </button>
      <button onclick="exportReportPPT('${hospitalName}',${reportYear},${reportMonth})" class="btn btn-secondary btn-sm">
        <i class="fas fa-file-powerpoint mr-1"></i>PPT
      </button>
    </div>
  </div>

  <!-- ══ 보고서 본문 (인쇄 대상) ══ -->
  <div id="reportBody" style="print-color-adjust:exact">

  ${(()=>{
    const docNo = `HM-${reportYear}-${String(reportMonth).padStart(2,'0')}-001`
    const rptDate = `${reportYear}년 ${reportMonth}월`

    const rptHeader = (sectionNum, sectionTitle) => `
      <div style="display:flex;align-items:center;justify-content:space-between;background:#064e3b;color:white;padding:6px 14px;margin:-24px -24px 12px -24px;flex-shrink:0">
        <span style="font-size:10px;opacity:0.7;letter-spacing:1px">HOSPITAL MEAL REPORT · 월간보고서</span>
        <div style="display:flex;gap:16px;font-size:10px;opacity:0.8">
          <span>${hospitalName} 귀중</span><span>${rptDate}</span><span>${docNo}</span>
        </div>
      </div>
      ${sectionNum ? `<div style="font-size:11px;font-weight:700;color:#064e3b;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #064e3b;display:flex;align-items:center;gap:8px;flex-shrink:0">
        <span style="background:#064e3b;color:white;padding:2px 8px;border-radius:3px;font-size:10px">SECTION ${sectionNum}</span>
        <span>${sectionTitle}</span>
      </div>` : ''}
    `

    const rptFooter = (pageInfo) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 14px;border-top:1px solid #e5e7eb;font-size:9px;color:#6b7280;background:white;margin-top:auto;flex-shrink:0">
        <span>Re&H Hospital Meal Management System</span>
        <span style="font-weight:600;color:#064e3b">${pageInfo}</span>
        <span>${hospitalName} | ${rptDate}</span>
      </div>
    `

    const trafficColor = (pct) => pct>=80?'#16a34a':pct>=60?'#d97706':'#dc2626'

    // ══════════════════════════════════════════════════════════
    // 공통 유틸
    // ══════════════════════════════════════════════════════════
    const fmt  = n => (n||0).toLocaleString()
    const fmtM = n => { const v=Math.abs(n||0); return v>=100000000?`${(v/100000000).toFixed(1)}억`:v>=10000?`${(v/10000).toFixed(0)}만`:`${v.toLocaleString()}` }
    const fmtMan = n => { const v=Math.abs(n||0); return v>=100000000?`${(v/100000000).toFixed(1)}억`:v>=10000?`${Math.round(v/10000)}만`:`${v.toLocaleString()}` }
    const tc   = p => p>=90?'#16a34a':p>=80?'#2563eb':p>=60?'#d97706':'#dc2626'
    const tcBg = p => p>=90?'#dcfce7':p>=80?'#dbeafe':p>=60?'#fef3c7':'#fee2e2'

    const s   = rptSummary
    const progress = s.progress||0
    const totalBudget = s.totalBudget||0
    const usedAmount  = s.usedAmount||0
    const remainAmount = s.remainAmount||0
    const isOverBudget = remainAmount<0
    const mealPrice   = mealPriceForRpt||0
    const targetPrice = s.targetMealPrice||0
    const totalMeals  = s.totalPatients||0
    const daysInMonth = new Date(reportYear,reportMonth,0).getDate()
    const elapsedDays = rptProjection.elapsedDays||0
    const dailyAvg    = rptDepletion.dailyAvgUsed||0

    // AI 경고 조건 계산
    const aiWarnings = []
    if(progress>=80) aiWarnings.push({icon:'⚠️',color:'#dc2626',bg:'#fef2f2',text:`예산 집행률 ${progress}% — 초과 위험 구간입니다.`})
    if(targetPrice>0&&mealPrice>targetPrice) aiWarnings.push({icon:'🍱',color:'#d97706',bg:'#fffbeb',text:`현재 식단가(${fmt(mealPrice)}원)가 목표(${fmt(targetPrice)}원) 초과 중입니다.`})
    const topVendorRatio = usedAmount>0&&rptOrders.length>0?Math.round((rptOrders[0].totalAmount||0)/usedAmount*100):0
    if(topVendorRatio>=40) aiWarnings.push({icon:'🏢',color:'#7c3aed',bg:'#faf5ff',text:`${rptOrders[0]?.vendor||''} 발주 집중도 ${topVendorRatio}% — 의존도 위험입니다.`})
    const dailyAmts = rptDailyAll.map(d=>d.amount).filter(v=>v>0)
    const dailyMean = dailyAmts.length?dailyAmts.reduce((a,b)=>a+b,0)/dailyAmts.length:0
    const spikeDay  = rptDailyAll.find(d=>d.amount>dailyMean*2)
    if(spikeDay) aiWarnings.push({icon:'📈',color:'#dc2626',bg:'#fef2f2',text:`${spikeDay.day}일 발주(${fmtM(spikeDay.amount)}원)가 일평균 대비 급증했습니다.`})
    const prevMeals = rptPrevMonth.totalMeals||0
    if(prevMeals>0&&totalMeals>0){const chg=Math.abs(totalMeals-prevMeals)/prevMeals*100;if(chg>20)aiWarnings.push({icon:'👥',color:'#2563eb',bg:'#eff6ff',text:`전월 대비 식수 변동률 ${chg.toFixed(1)}% — 이상 급변입니다.`})}
    ;(rptAnomalies||[]).forEach(a=>{ if(!aiWarnings.find(w=>w.text.includes(a.message?.substring(0,10)||''))) aiWarnings.push({icon:a.severity==='high'?'🚨':'⚠️',color:a.severity==='high'?'#dc2626':'#d97706',bg:a.severity==='high'?'#fef2f2':'#fffbeb',text:a.message||''}) })

    // 자동 분석 텍스트
    const autoText = rptAutoAnalysis.length>0?rptAutoAnalysis[0]:(progress>=80?`예산 집행률 ${progress}%로 목표 범위에 도달했습니다.`:`현재 집행률 ${progress}%입니다.`)

    // 공통 섹션 헤더 (PDF 샘플: 진한 다크그린 배경, PAGE 배지, 우상단 병원명/날짜)
    const SH = (pg,title,sub='') => `
      <div style="display:flex;align-items:center;justify-content:space-between;background:#064e3b;color:white;padding:16px 60px;margin:0 -60px 28px -60px;flex-shrink:0">
        <div style="display:flex;align-items:center;gap:14px">
          <span style="background:rgba(255,255,255,0.18);padding:4px 14px;border-radius:20px;font-size:12px;font-weight:800;letter-spacing:1.5px">PAGE ${pg}</span>
          <span style="font-size:20px;font-weight:800;letter-spacing:0.5px">${title}</span>
          ${sub?`<span style="font-size:14px;opacity:0.6;margin-left:4px">${sub}</span>`:''}
        </div>
        <div style="font-size:13px;opacity:0.85;display:flex;gap:20px;align-items:center">
          <span>${hospitalName}</span>
          <span>${reportYear}.${String(reportMonth).padStart(2,'0')}</span>
          <span>${docNo}</span>
        </div>
      </div>`

    // 공통 AI 박스 (PDF 샘플: 분석/경고 나란히, 충분한 패딩)
    const AIBox = (analysis,warn,accentColor='#064e3b',bg='#f0fdf4') => `
      <div style="display:grid;grid-template-columns:1fr${warn?` 1fr`:''};gap:24px;margin-top:20px;flex-shrink:0">
        <div style="background:${bg};border:1px solid ${accentColor}30;border-left:5px solid ${accentColor};border-radius:10px;padding:14px 20px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="background:${accentColor};color:white;padding:3px 12px;border-radius:12px;font-size:12px;font-weight:700;letter-spacing:0.5px">AI 분석</span>
          </div>
          <div style="font-size:13px;color:#1e3a5f;line-height:1.8;font-weight:500">${analysis}</div>
        </div>
        ${warn?`<div style="background:#fef2f2;border:1px solid #dc262630;border-left:5px solid #dc2626;border-radius:10px;padding:14px 20px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="background:#dc2626;color:white;padding:3px 12px;border-radius:12px;font-size:12px;font-weight:700;letter-spacing:0.5px">AI 경고</span>
          </div>
          <div style="font-size:13px;color:#7f1d1d;line-height:1.8;font-weight:500">${warn}</div>
        </div>`:''}
      </div>`

    // 공통 KPI 카드 (PDF 샘플: 배경색, 왼쪽 컬러 보더, 아이콘 우측 상단)
    const KPI = (label,val,sub,col,bg,icon='') => `
      <div style="background:${bg};border-radius:12px;padding:18px 22px;border-left:5px solid ${col};position:relative;overflow:hidden">
        ${icon?`<span style="position:absolute;top:12px;right:16px;font-size:28px;opacity:0.2">${icon}</span>`:''}
        <div style="font-size:13px;color:#374151;font-weight:700;margin-bottom:6px;letter-spacing:0.3px">${label}</div>
        <div style="font-size:26px;font-weight:900;color:${col};line-height:1.1">${val}</div>
        ${sub?`<div style="font-size:12px;color:#4b5563;margin-top:6px;font-weight:500">${sub}</div>`:''}
      </div>`

    const totalPages = '14'

    // ══ PAGE 1: 표지 (PDF 샘플 스타일: 흰 배경 + 검은 텍스트) ══
    const slide1 = `
    <div class="report-slide" style="position:relative;background:#ffffff;color:#1a1a1a;padding:0;overflow:hidden;display:flex;flex-direction:column;">
      <!-- 상단 헤더 -->
      <div style="display:flex;justify-content:space-between;align-items:center;padding:20px 40px;border-bottom:1px solid #e5e7eb">
        <div style="display:flex;align-items:center;gap:16px">
          <div style="width:36px;height:36px;background:#064e3b;border-radius:8px;display:flex;align-items:center;justify-content:center">
            <span style="color:white;font-weight:900;font-size:15px">R</span>
          </div>
          <div>
            <div style="font-weight:800;font-size:14px;letter-spacing:1.5px;color:#1a1a1a">Re&amp;H</div>
            <div style="font-size:8px;color:#9ca3af;letter-spacing:2px">HOSPITAL MEAL MANAGEMENT</div>
          </div>
        </div>
        <div style="text-align:right;font-size:13px;color:#6b7280">
          <div style="font-weight:600">Report No. ${docNo}</div>
          <div>발행일: ${new Date().toLocaleDateString('ko-KR')}</div>
        </div>
      </div>
      <!-- 메인 콘텐츠 -->
      <div style="flex:1;display:flex;flex-direction:column;justify-content:center;padding:60px 80px 40px 80px">
        <div style="font-size:14px;letter-spacing:6px;color:#9ca3af;margin-bottom:24px;text-transform:uppercase">Monthly Management Report</div>
        <h1 style="font-size:64px;font-weight:900;line-height:1.05;margin:0 0 10px 0;color:#1a1a1a">${reportYear}년 ${String(reportMonth).padStart(0,'0')}월</h1>
        <h2 style="font-size:28px;font-weight:700;margin:0 0 40px 0;color:#374151">급식 운영 월간 보고서</h2>
        <div style="width:48px;height:3px;background:#064e3b;margin-bottom:36px;border-radius:2px"></div>
        <div style="font-size:40px;font-weight:800;letter-spacing:0.5px;color:#1a1a1a">${hospitalName}</div>
        <div style="font-size:16px;color:#9ca3af;margin-top:10px;letter-spacing:1px">Hospital Food Service Division</div>
      </div>
      <!-- KPI 바 (3개) - 하단 -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;border-top:1px solid #e5e7eb">
        ${[
          {label:'TOTAL BUDGET',val:`${fmtMan(totalBudget)}원`,sub:'월 배정 예산'},
          {label:'ACHIEVEMENT',val:`${progress}%`,sub:'예산 집행률'},
          {label:'MEAL PRICE',val:`${fmt(mealPrice)}원`,sub:'평균 식단가'},
        ].map((c,i)=>`
          <div style="padding:20px 28px;${i<2?'border-right:1px solid #e5e7eb':''}">
            <div style="font-size:12px;color:#9ca3af;letter-spacing:1.5px;margin-bottom:8px;text-transform:uppercase">${c.label}</div>
            <div style="font-size:30px;font-weight:900;margin-bottom:5px;color:#1a1a1a">${c.val}</div>
            <div style="font-size:13px;color:#6b7280">${c.sub}</div>
          </div>`).join('')}
      </div>
    </div>`

    // ══ PAGE 2: 운영 요약 ══════════════════════════════════════
    const slide2 = `
    <div class="report-slide rpt-report-page">
      ${SH(2,'운영 요약','Budget Overview')}
      <!-- KPI 6개 (PDF 샘플: 3열 2행, 아이콘 우측 상단) -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-bottom:24px;flex-shrink:0">
        ${[
          {label:'총 예산',val:`${fmtMan(totalBudget)}원`,sub:'월 배정 예산',col:'#064e3b',bg:'#f0fdf4',icon:'💰'},
          {label:'집행 금액',val:`${fmtMan(usedAmount)}원`,sub:`달성률 ${progress}%`,col:'#1d4ed8',bg:'#eff6ff',icon:'📊'},
          {label:isOverBudget?'초과 금액':'잔여 예산',val:`${fmtMan(Math.abs(remainAmount))}원`,sub:isOverBudget?'⚠ 예산 초과':'정상 범위',col:isOverBudget?'#dc2626':'#16a34a',bg:isOverBudget?'#fef2f2':'#f0fdf4',icon:isOverBudget?'⚠️':'✅'},
          {label:'현재 식단가',val:`${fmt(mealPrice)}원`,sub:'1식 기준',col:'#7c3aed',bg:'#faf5ff',icon:'🍱'},
          {label:'총 식수',val:`${fmt(totalMeals)}명`,sub:'이번 달 누적',col:'#0891b2',bg:'#ecfeff',icon:'👥'},
          {label:'예산 집행률',val:`${progress}%`,sub:`목표 80~90%`,col:tc(progress),bg:tcBg(progress),icon:'🎯'},
        ].map(c=>KPI(c.label,c.val,c.sub,c.col,c.bg,c.icon)).join('')}
      </div>
      <!-- Gauge Chart + 상세 -->
      <div style="display:grid;grid-template-columns:1fr 1.6fr;gap:28px;flex:1;min-height:0">
        <div style="display:flex;flex-direction:column;align-items:center;background:#f8fafc;border-radius:12px;padding:14px;border:1px solid #e2e8f0">
          <div style="font-size:14px;font-weight:700;color:#1f2937;margin-bottom:6px;width:100%;text-align:center">예산 사용률</div>
          <div id="rptGaugeChart" style="width:100%;flex:1;min-height:200px"></div>
          <div style="text-align:center;margin-top:4px">
            <div style="font-size:12px;color:#4b5563;font-weight:600">목표 범위: 80 ~ 90%</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:16px">
          <div style="background:#f8fafc;border-radius:12px;padding:14px 18px;border:1px solid #e2e8f0;flex:1">
            <div style="font-size:14px;font-weight:700;color:#1f2937;margin-bottom:10px">예산 집행 현황</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
              ${[
                {label:'일평균 사용액',val:`${fmt(dailyAvg||Math.round(usedAmount/Math.max(elapsedDays,1)))}원`,col:'#d97706'},
                {label:'경과일 / 총일수',val:`${elapsedDays||'—'}일 / ${daysInMonth}일`,col:'#1f2937'},
                {label:'전월 사용금액',val:`${fmtMan(rptPrevMonth.totalUsed||0)}원`,col:'#374151'},
                {label:'전월 대비',val:(()=>{const p=rptPrevMonth.totalUsed||0;if(!p)return'—';const r=(usedAmount-p)/p*100;return (r>0?'+':'')+r.toFixed(1)+'%'})(),col:(rptPrevMonth.totalUsed||0)<usedAmount?'#dc2626':'#16a34a'},
              ].map(i=>`<div style="background:white;border-radius:10px;padding:12px;border:1px solid #e5e7eb;text-align:center">
                <div style="font-size:12px;color:#4b5563;font-weight:600;margin-bottom:4px">${i.label}</div>
                <div style="font-size:16px;font-weight:800;color:${i.col}">${i.val}</div>
              </div>`).join('')}
            </div>
          </div>
          <div style="background:#f8fafc;border-radius:12px;padding:14px 18px;border:1px solid #e2e8f0;flex:1">
            <div style="font-size:14px;font-weight:700;color:#1f2937;margin-bottom:10px">식수 현황 요약</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
              ${[
                {label:'직원식',val:`${fmt(s.staffCount||rptSummary.staffCount||0)}명`,col:'#d97706'},
                {label:'보호자식',val:`${fmt(s.guardianCount||0)}명`,col:'#dc2626'},
                {label:'환자식(합계)',val:`${fmt(s.normalCount||rptSummary.normalCount||0)}명`,col:'#064e3b'},
                {label:'일 평균 식수',val:`${Math.round(totalMeals/Math.max(daysInMonth,1)).toLocaleString()}명`,col:'#1f2937'},
              ].map(r=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:white;border-radius:8px;border:1px solid #e5e7eb">
                <span style="font-size:13px;color:#374151;font-weight:600">${r.label}</span>
                <span style="font-size:16px;font-weight:800;color:${r.col}">${r.val}</span>
              </div>`).join('')}
            </div>
          </div>
        </div>
      </div>
      ${AIBox(
        autoText,
        aiWarnings.length>0?aiWarnings[0].text:null,
        '#064e3b','#f0fdf4'
      )}
    </div>`

    // ══ PAGE 3: 카테고리별 식단가 ══════════════════════════════
    const catColors = ['#064e3b','#1d4ed8','#7c3aed','#dc2626','#d97706','#0891b2','#059669','#9333ea']
    const catBgs    = ['#f0fdf4','#eff6ff','#faf5ff','#fef2f2','#fffbeb','#ecfeff','#ecfdf5','#f5f3ff']
    // 카테고리별 식단가 데이터 준비
    const catPriceData = rptCatDietPrices && rptCatDietPrices.length>0
      ? rptCatDietPrices.map((c,i)=>({
          name:c.category_name||c.name||'',
          price:Math.round(c.mealPrice||c.monthDietPrice||c.meal_price||0),
          target:c.targetPrice||targetPrice,
          monthMeals:c.monthMeals||0,
          monthAmt:c.monthAmt||0,
          col:catColors[i%catColors.length],
          bg:catBgs[i%catBgs.length]
        }))
      : rptCatMeals.map((c,i)=>({name:c.name,price:0,target:targetPrice,monthMeals:0,monthAmt:0,col:catColors[i%catColors.length],bg:catBgs[i%catBgs.length]}))
    const hasCatData = catPriceData.length>0
    const catAnalysis = (() => {
      if(!hasCatData) return '카테고리별 식단가 데이터를 분석합니다. 발주 데이터가 쌓이면 자동으로 분석됩니다.'
      const sorted = [...catPriceData].filter(c=>c.price>0).sort((a,b)=>b.price-a.price)
      if(!sorted.length) return '식단가 데이터가 아직 없습니다.'
      const top = sorted[0]
      const avg = sorted.reduce((s,c)=>s+c.price,0)/sorted.length
      const diff = top.price-avg
      if(diff>0) return `${top.name} 식단가(${fmt(top.price)}원)가 평균(${fmt(Math.round(avg))}원) 대비 ${Math.round(diff/avg*100)}% 높습니다.`
      return `전체 카테고리 식단가는 평균 ${fmt(Math.round(avg))}원으로 유사한 수준을 유지하고 있습니다.`
    })()
    const catWarn = (() => {
      if(!targetPrice||!hasCatData) return null
      const over = catPriceData.filter(c=>c.price>0&&c.price>targetPrice*1.15)
      if(over.length>0) return `⚠ ${over.map(c=>c.name).join(', ')} 식단가가 목표 대비 15% 이상 상승했습니다.`
      const over2 = catPriceData.filter(c=>c.price>0&&c.price>targetPrice)
      if(over2.length>0) return `⚠ ${over2.map(c=>c.name).join(', ')} 식단가가 목표 초과 상태입니다.`
      return null
    })()
    const slide3 = `
    <div class="report-slide rpt-report-page">
      ${SH(3,'카테고리별 평균 식단가 분석','Category Meal Price')}
      ${hasCatData ? `
      <!-- 바 차트 -->
      <div style="background:#f8fafc;border-radius:12px;padding:14px;border:1px solid #e2e8f0;margin-bottom:20px;flex:1">
        <div style="font-size:14px;font-weight:700;color:#1f2937;margin-bottom:10px">카테고리별 식단가 비교 (목표선 포함)</div>
        <div id="rptCatPriceChart" style="width:100%;height:280px"></div>
      </div>
      <!-- 카테고리 카드들 -->
      <div style="display:grid;grid-template-columns:repeat(${Math.min(catPriceData.length,4)},1fr);gap:8px;margin-bottom:10px;flex-shrink:0">
        ${catPriceData.map(c=>`
          <div style="background:${c.bg};border-radius:10px;padding:14px;border-left:4px solid ${c.col};text-align:center">
            <div style="font-size:13px;color:#374151;font-weight:700;margin-bottom:8px">${c.name}</div>
            <div style="font-size:24px;font-weight:900;color:${c.price>0?c.col:'#9ca3af'}">${c.price>0?fmt(c.price)+'원':'<span style="font-size:13px;color:#6b7280;font-weight:600">데이터 없음</span>'}</div>
            ${c.price>0?`
              ${c.target>0?`<div style="font-size:10px;margin-top:5px;color:${c.price>c.target?'#dc2626':'#16a34a'};font-weight:700">${c.price>c.target?'▲ 목표 초과':'✓ 목표 이내'}</div>`:''}
              ${c.monthMeals>0?`<div style="font-size:9px;color:#6b7280;margin-top:3px">${c.monthMeals.toLocaleString()}식</div>`:''}
            `:`<div style="font-size:8.5px;color:#9ca3af;margin-top:4px">${c.monthAmt>0?'식수 데이터 없음':'발주 없음'}</div>`}
          </div>`).join('')}
      </div>
      ` : `
      <div style="flex:1;display:flex;align-items:center;justify-content:center;background:#f8fafc;border-radius:12px;border:2px dashed #e2e8f0;margin-bottom:10px">
        <div style="text-align:center;padding:40px">
          <div style="font-size:40px;margin-bottom:12px">📊</div>
          <div style="font-size:14px;font-weight:700;color:#374151;margin-bottom:6px">카테고리별 식단가 데이터 준비 중</div>
          <div style="font-size:11px;color:#9ca3af">발주 데이터가 누적되면 카테고리별 식단가가 자동으로 표시됩니다.</div>
        </div>
      </div>
      `}
      <!-- 목표 대비 비교 -->
      ${targetPrice>0&&hasCatData?`
      <div style="background:#f8fafc;border-radius:10px;padding:10px 14px;border:1px solid #e2e8f0;margin-bottom:8px;flex-shrink:0">
        <div style="font-size:14px;font-weight:700;color:#374151;margin-bottom:10px">목표 식단가(${fmt(targetPrice)}원) 대비 현황</div>
        <div style="display:flex;flex-direction:column;gap:12px">
          ${catPriceData.filter(c=>c.price>0).map(c=>{
            const pct = Math.round(c.price/targetPrice*100)
            const over = c.price>targetPrice
            return `<div style="display:flex;align-items:center;gap:16px">
              <div style="width:90px;font-size:13px;color:#374151;font-weight:600;flex-shrink:0">${c.name}</div>
              <div style="flex:1;background:#e5e7eb;border-radius:99px;height:10px;overflow:hidden;position:relative">
                <div style="height:100%;width:${Math.min(pct,120)}%;background:${over?'#dc2626':c.col};border-radius:99px;max-width:100%"></div>
                <div style="position:absolute;top:0;left:${Math.min(100,100/1.2)}%;height:100%;width:2px;background:#374151;opacity:0.4"></div>
              </div>
              <div style="width:120px;font-size:13px;font-weight:700;color:${over?'#dc2626':c.col};text-align:right">${fmt(c.price)}원 (${pct}%)</div>
            </div>`
          }).join('')}
        </div>
      </div>`:''}
      ${AIBox(catAnalysis, catWarn, '#7c3aed','#faf5ff')}
    </div>`

    // ══ PAGE 4: 일별 매입금액 ══════════════════════════════════
    const allAmts = rptDailyAll.map(d=>d.amount)
    const nonZero = allAmts.filter(v=>v>0)
    const dlyMean = nonZero.length?nonZero.reduce((a,b)=>a+b,0)/nonZero.length:0
    const dlyMax  = Math.max(...allAmts)
    const dlyMaxDay = rptDailyAll.find(d=>d.amount===dlyMax)
    const dlyAnalysis = nonZero.length===0?'일별 매입 데이터를 분석합니다.'
      :`${reportMonth}월 일평균 매입금액은 ${fmtM(Math.round(dlyMean))}원이며, ${dlyMaxDay?.day||''}일(${fmtM(dlyMax)}원)에 최고 발주가 집중되었습니다.`
    const dlyWarn = (() => {
      const spike = rptDailyAll.find(d=>d.amount>dlyMean*2&&dlyMean>0)
      if(spike) return `⚠ ${spike.day}일 발주금액(${fmtM(spike.amount)}원)이 일평균 대비 ${Math.round(spike.amount/dlyMean*100-100)}% 초과합니다.`
      return null
    })()
    const slide4 = `
    <div class="report-slide rpt-report-page">
      ${SH(4,'일별 매입금액 분석','Daily Purchase')}
      <!-- 차트 -->
      <div style="background:#f8fafc;border-radius:12px;padding:14px;border:1px solid #e2e8f0;margin-bottom:20px;flex:1;min-height:0">
        <div style="font-size:14px;font-weight:700;color:#1f2937;margin-bottom:10px">일별 매입금액 추이 (막대+평균선, 빨간색=평균2배초과)</div>
        <div id="rptDailyChart" style="width:100%;height:280px"></div>
      </div>
      <!-- 일별 상세 테이블 -->
      <div style="margin-bottom:8px;flex-shrink:0">
        <div style="font-size:14px;font-weight:700;color:#1f2937;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #e5e7eb">일별 매입 상세 내역</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#064e3b;color:white">
              <th style="padding:5px 8px">일</th><th style="padding:5px 8px;text-align:right">금액(원)</th>
              <th style="padding:5px 8px">일</th><th style="padding:5px 8px;text-align:right">금액(원)</th>
              <th style="padding:5px 8px">일</th><th style="padding:5px 8px;text-align:right">금액(원)</th>
              <th style="padding:5px 8px">일</th><th style="padding:5px 8px;text-align:right">금액(원)</th>
            </tr>
          </thead>
          <tbody>
            ${(()=>{
              const all=rptDailyAll.filter(d=>d.amount>0)
              const perCol=Math.ceil(all.length/4)||1
              let html=''
              for(let r=0;r<perCol;r++){
                html+=`<tr style="border-bottom:1px solid #f1f5f9">`
                for(let c=0;c<4;c++){
                  const item=all[r+c*perCol]
                  if(item){html+=`<td style="padding:4px 8px;font-weight:600;color:${item.amount===dlyMax?'#dc2626':'#374151'}">${item.day}일</td><td style="padding:4px 8px;text-align:right;color:${item.amount===dlyMax?'#dc2626':'#064e3b'};font-weight:700">${fmt(item.amount)}</td>`}
                  else{html+=`<td style="background:#f9fafb"></td><td style="background:#f9fafb"></td>`}
                }
                html+=`</tr>`
              }
              return html
            })()}
          </tbody>
        </table>
      </div>
      ${AIBox(dlyAnalysis, dlyWarn, '#1d4ed8','#eff6ff')}
    </div>`

    // ══ PAGE 5: 업체별 발주 분석 ══════════════════════════════
    const vendAnalysis = (() => {
      if(!rptOrders||rptOrders.length===0) return '업체별 발주 데이터를 분석합니다.'
      const top3ratio = rptOrders.slice(0,3).reduce((s,o)=>s+(usedAmount>0?(o.totalAmount||0)/usedAmount*100:0),0)
      return `상위 3개 업체 발주 비중이 ${Math.round(top3ratio)}%입니다. ${rptOrders[0]?.vendor||''}이(가) 가장 높은 비중(${usedAmount>0?Math.round((rptOrders[0]?.totalAmount||0)/usedAmount*100):0}%)을 차지합니다.`
    })()
    const vendWarn = topVendorRatio>=40?`⚠ ${rptOrders[0]?.vendor||''} 의존도(${topVendorRatio}%)가 높습니다. 발주 분산 검토가 필요합니다.`:null
    const slide5 = `
    <div class="report-slide rpt-report-page">
      ${SH(5,'업체별 발주 분석','Vendor Orders')}
      <!-- 메인 콘텐츠: 도넛차트 + 업체테이블 -->
      <div style="display:grid;grid-template-columns:1.8fr 1fr;gap:28px;flex:1;min-height:0;overflow:hidden">
        <!-- 도넛 차트 -->
        <div style="background:#f8fafc;border-radius:12px;padding:14px;border:1px solid #e2e8f0;display:flex;flex-direction:column;min-height:0;overflow:hidden">
          <div style="font-size:14px;font-weight:700;color:#1f2937;margin-bottom:10px;flex-shrink:0">업체별 발주 비중 (도넛 차트)</div>
          <div id="rptVendorChart" style="width:100%;flex:1;min-height:0"></div>
        </div>
        <!-- 업체 테이블 + TOP3 -->
        <div style="display:flex;flex-direction:column;gap:10px;min-height:0;overflow:hidden">
          <div style="font-size:14px;font-weight:700;color:#1f2937;padding-bottom:8px;border-bottom:2px solid #064e3b;flex-shrink:0">업체별 발주 금액</div>
          <div style="flex:1;overflow:hidden">
            ${(rptOrders||[]).slice(0,8).map((o,i)=>{
              const amt=o.totalAmount||0
              const pct=usedAmount>0?Math.round(amt/usedAmount*100):0
              const c=['#064e3b','#1d4ed8','#7c3aed','#dc2626','#d97706','#0891b2','#059669','#9333ea']
              return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0 6px 8px;border-bottom:1px solid #f3f4f6">
                <span style="width:24px;height:24px;background:${c[i]||'#374151'};border-radius:5px;flex-shrink:0;display:flex;align-items:center;justify-content:center">
                  <span style="color:white;font-size:11px;font-weight:700">${i+1}</span>
                </span>
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:600;color:#1f2937;word-break:break-all;white-space:normal;line-height:1.3">${o.vendor||'-'}</div>
                  <div style="background:#f3f4f6;border-radius:99px;height:5px;margin-top:4px;overflow:hidden">
                    <div style="height:100%;width:${pct}%;background:${c[i]||'#374151'};border-radius:99px"></div>
                  </div>
                </div>
                <div style="text-align:right;flex-shrink:0;min-width:70px;padding-right:8px">
                  <div style="font-size:15px;font-weight:800;color:${c[i]||'#374151'}">${pct}%</div>
                  <div style="font-size:11px;color:#4b5563;font-weight:500">${fmtM(amt)}원</div>
                </div>
              </div>`
            }).join('')}
          </div>
          <!-- TOP3 박스 -->
          <div style="background:#f0fdf4;border-radius:8px;padding:10px;border:1px solid #bbf7d0;flex-shrink:0">
            <div style="font-size:13px;font-weight:700;color:#064e3b;margin-bottom:6px">🏆 TOP 3 업체</div>
            ${(rptOrders||[]).slice(0,3).map((o,i)=>{
              const pct=usedAmount>0?Math.round((o.totalAmount||0)/usedAmount*100):0
              return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #d1fae5">
                <span style="font-size:11px;color:#374151">${['🥇','🥈','🥉'][i]} ${o.vendor||'-'}</span>
                <span style="font-size:13px;font-weight:700;color:#064e3b">${pct}%</span>
              </div>`
            }).join('')}
          </div>
        </div>
      </div>
      <!-- AI 분석/경고: 슬라이드 하단 고정 (flex-shrink:0) -->
      <div style="display:grid;grid-template-columns:1fr${vendWarn?' 1fr':''};gap:20px;margin-top:14px;flex-shrink:0">
        <div style="background:#eff6ff;border:1px solid #1d4ed830;border-left:5px solid #1d4ed8;border-radius:10px;padding:12px 16px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="background:#1d4ed8;color:white;padding:3px 12px;border-radius:12px;font-size:12px;font-weight:700;letter-spacing:0.5px">AI 분석</span>
          </div>
          <div style="font-size:13px;color:#1e3a5f;line-height:1.7;font-weight:500">${vendAnalysis}</div>
        </div>
        ${vendWarn?`<div style="background:#fef2f2;border:1px solid #dc262630;border-left:5px solid #dc2626;border-radius:10px;padding:12px 16px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="background:#dc2626;color:white;padding:3px 12px;border-radius:12px;font-size:12px;font-weight:700;letter-spacing:0.5px">AI 경고</span>
          </div>
          <div style="font-size:13px;color:#7f1d1d;line-height:1.7;font-weight:500">${vendWarn}</div>
        </div>`:''}
      </div>
    </div>`

    // ══ PAGE 6: 식수 현황 분석 ══════════════════════════════════
    const mealColors = ['#064e3b','#1d4ed8','#7c3aed','#d97706','#dc2626','#0891b2']
    const mealCatList = rptCatMeals.length>0 ? rptCatMeals : [
      {name:'환자식',count:s.normalCount||0},{name:'직원식',count:s.staffCount||0}
    ].filter(c=>c.count>0)
    const totalMealSum = mealCatList.reduce((s,c)=>s+c.count,0)||1
    const staffRatio = totalMeals>0?Math.round((s.staffCount||0)/totalMeals*100):0
    const waterAnalysis = totalMeals===0?'식수 데이터를 분석합니다. 식수 입력 후 자동 분석됩니다.'
      :`이번 달 총 식수는 ${fmt(totalMeals)}명이며, 일 평균 ${Math.round(totalMeals/daysInMonth).toLocaleString()}명 수준입니다.`
    const waterWarn = staffRatio>=70?`⚠ 직원식 비중(${staffRatio}%)이 비정상적으로 높습니다. 환자 식수 데이터를 확인하세요.`:null
    const slide6 = `
    <div class="report-slide rpt-report-page">
      ${SH(6,'식수 현황 분석','Meal Count')}
      <div style="display:grid;grid-template-columns:1.8fr 1fr;gap:28px;flex:1;min-height:0;margin-bottom:20px">
        <!-- 가로 바 차트 -->
        <div style="background:#f8fafc;border-radius:12px;padding:14px;border:1px solid #e2e8f0;display:flex;flex-direction:column">
          <div style="font-size:14px;font-weight:700;color:#1f2937;margin-bottom:10px">식종별 식수 현황 (명수 레이블 포함)</div>
          <div id="rptWaterChart" style="width:100%;flex:1;min-height:280px"></div>
        </div>
        <!-- 식수 카드들 -->
        <div style="display:flex;flex-direction:column;gap:8px">
          ${mealCatList.map((c,i)=>`
            <div style="background:${catBgs[i%catBgs.length]};border-radius:10px;padding:12px 14px;border-left:4px solid ${mealColors[i%mealColors.length]}">
              <div style="font-size:13px;color:#374151;font-weight:700;margin-bottom:6px">${c.name}</div>
              <div style="font-size:24px;font-weight:900;color:${mealColors[i%mealColors.length]}">${fmt(c.count)}<span style="font-size:13px;font-weight:600">명</span></div>
              <div style="font-size:12px;color:#4b5563;font-weight:600">${Math.round(c.count/totalMealSum*100)}%</div>
            </div>`).join('')}
          <div style="background:#f8fafc;border-radius:10px;padding:12px 14px;border:1px solid #e2e8f0;margin-top:2px">
            <div style="font-size:13px;color:#374151;font-weight:700;margin-bottom:6px">총 식수 / 일평균</div>
            <div style="font-size:22px;font-weight:900;color:#064e3b">${fmt(totalMeals)}명</div>
            <div style="font-size:13px;color:#374151">일평균 ${Math.round(totalMeals/daysInMonth).toLocaleString()}명</div>
          </div>
        </div>
      </div>
      ${AIBox(waterAnalysis, waterWarn, '#064e3b','#f0fdf4')}
    </div>`

    // ══ PAGE 7: 월별 식단가 추이 ══════════════════════════════════
    const mthPrices = Array.from({length:12},(_,i)=>{
      const row=(rptMonthlySettings||[]).find(r=>parseInt(r.month)===i+1)
      return row?parseInt(row.meal_price||row.mealPrice||0):0
    })
    const mthUsed = Array.from({length:12},(_,i)=>{
      const row=(rptMonthlyUsed||[]).find(r=>parseInt(r.month)===i+1)
      return row?parseInt(row.total_used||row.totalUsed||0):0
    })
    const mthMealsArr = Array.from({length:12},(_,i)=>{
      const row=(rptMonthlyMeals||[]).find(r=>parseInt(r.month)===i+1)
      return row?parseInt(row.total_meals||row.total_patient||0):0
    })
    const mthActualPrices = Array.from({length:12},(_,i)=>{
      const used=mthUsed[i], meals=mthMealsArr[i]
      return used>0&&meals>0?Math.round(used/meals):0
    })
    const p7ActiveMonthsPx = Array.from({length:12},(_,i)=>i).filter(i=>mthActualPrices[i]>0||mthPrices[i]>0)
    const avgActualPrice = mthActualPrices.filter(v=>v>0).reduce((s,v,_,a)=>s+v/a.length,0)||0
    const maxPx = Math.max(...mthActualPrices.filter(v=>v>0), ...mthPrices.filter(v=>v>0), 1)
    const priceTrend = mthActualPrices.filter(v=>v>0)
    const px7Analysis = priceTrend.length>=2
      ? `평균 식단가 ${fmt(Math.round(avgActualPrice))}원. ${reportMonth}월 ${fmt(mthActualPrices[reportMonth-1])}원으로 ${mthActualPrices[reportMonth-1]>=mthActualPrices[reportMonth-2]&&reportMonth>1?'전월 대비 상승':'안정적인 수준'}입니다.`
      : `현재 ${reportMonth}월 식단가: ${fmt(mthActualPrices[reportMonth-1]||mealPrice)}원`
    const px7Warn = targetPrice>0&&mthActualPrices[reportMonth-1]>targetPrice*1.1?`⚠ 식단가가 목표(${fmt(targetPrice)}원) 대비 10% 이상 초과합니다.`:null
    const slide7 = `
    <div class="report-slide rpt-report-page">
      ${SH(7,'월별 식단가 추이','Monthly Meal Price Trend')}
      <div style="background:#f8fafc;border-radius:12px;padding:20px;border:1px solid #e2e8f0;flex:1;margin-bottom:20px;min-height:0">
        <div style="font-size:14px;font-weight:700;color:#1f2937;margin-bottom:10px">2026년 월별 평균 식단가 추이 (실선=실제, 점선=목표)</div>
        <div id="rptMealPriceTrendChart" style="width:100%;height:280px"></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px;flex-shrink:0">
        ${KPI('현재 식단가',`${fmt(mthActualPrices[reportMonth-1]||mealPrice)}원`,'이번 달','#7c3aed','#faf5ff','🍱')}
        ${KPI('목표 식단가',targetPrice>0?`${fmt(targetPrice)}원`:'미설정','설정값','#1d4ed8','#eff6ff','🎯')}
        ${KPI('연간 평균',`${fmt(Math.round(avgActualPrice))}원`,'1~현재월 평균','#064e3b','#f0fdf4','📊')}
        ${KPI('전월 식단가',mthActualPrices[reportMonth-2]>0?`${fmt(mthActualPrices[reportMonth-2])}원`:'—','전월','#d97706','#fffbeb','📅')}
      </div>
      ${AIBox(px7Analysis, px7Warn, '#7c3aed','#faf5ff')}
    </div>`

    // ══ PAGE 8: 월별 업체별 발주 금액 추이 ══════════════════════════
    // 연간 업체별 월별 데이터 (annualData에서 추출)
    const p8VendorMonthly = (() => {
      const vendors8 = annualData?.vendorMonthly || []
      if (vendors8.length > 0) return vendors8
      // fallback: rptOrders 기반으로 현재 월만 표시
      return rptOrders.slice(0,5).map(v=>({ vendor_name:v.vendor, monthly:Array.from({length:12},(_,i)=>i===reportMonth-1?v.totalAmount:0) }))
    })()
    const p8Colors = ['#10b981','#3b82f6','#8b5cf6','#f59e0b','#ef4444','#0891b2','#ec4899','#64748b']
    const p8TopVendors = p8VendorMonthly.slice(0,5)
    const p8MonthTotals = Array.from({length:12},(_,i)=>p8TopVendors.reduce((s,v)=>s+(v.monthly?.[i]||0),0))
    const p8ActiveMonths = Array.from({length:12},(_,i)=>i).filter(i=>p8MonthTotals[i]>0)
    const p8CurTotal = p8MonthTotals[reportMonth-1]
    const p8PrevTotal = reportMonth>1?p8MonthTotals[reportMonth-2]:0
    const p8Diff = p8PrevTotal>0?Math.round((p8CurTotal-p8PrevTotal)/p8PrevTotal*100):0
    const p8Analysis = p8TopVendors.length>0
      ? `${reportMonth}월 총 발주 ${fmtMan(p8CurTotal)}원. ${p8TopVendors[0]?.vendor_name||''}이(가) 최대 비중입니다.${p8Diff!==0?` 전월 대비 ${p8Diff>0?'+':''}${p8Diff}%.`:''}`
      : '업체별 월별 발주 데이터를 누적 중입니다.'
    const p8Warn = p8TopVendors.length>0&&p8CurTotal>0&&(p8TopVendors[0]?.monthly?.[reportMonth-1]||0)/p8CurTotal>0.6
      ? `⚠ ${p8TopVendors[0]?.vendor_name||'1위 업체'} 발주 집중도 ${Math.round((p8TopVendors[0]?.monthly?.[reportMonth-1]||0)/p8CurTotal*100)}% — 의존도가 높습니다.`
      : null
    const slide8 = `
    <div class="report-slide rpt-report-page">
      ${SH(8,'월별 업체별 발주 금액 추이','Monthly Vendor Order Trend')}
      <div style="background:#f8fafc;border-radius:12px;padding:20px;border:1px solid #e2e8f0;flex:1;margin-bottom:20px;min-height:0">
        <div style="font-size:14px;font-weight:700;color:#1f2937;margin-bottom:10px">2026년 업체별 발주 금액 (누적 막대)</div>
        <div id="rptVendorMonthlyChart" style="width:100%;height:280px"></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(${Math.min(p8TopVendors.length||3,5)},1fr);gap:8px;margin-bottom:10px;flex-shrink:0">
        ${(p8TopVendors.length>0?p8TopVendors:rptOrders.slice(0,3)).map((v,i)=>`
          <div style="background:#f8fafc;border-radius:10px;padding:10px 12px;border-left:4px solid ${p8Colors[i]};position:relative;overflow:hidden">
            <div style="font-size:13px;color:#374151;font-weight:700;margin-bottom:5px;word-break:break-all;white-space:normal;line-height:1.3">${v.vendor_name||v.vendor||'업체'+(i+1)}</div>
            <div style="font-size:20px;font-weight:900;color:${p8Colors[i]};line-height:1.2">${fmtMan(v.monthly?.[reportMonth-1]||v.totalAmount||0)}원</div>
            <div style="font-size:12px;color:#6b7280;margin-top:4px">${reportMonth}월 발주</div>
          </div>`).join('')}
      </div>
      ${AIBox(p8Analysis, p8Warn, '#3b82f6','#eff6ff')}
    </div>`

    // ══ PAGE 9: 월별 총 발주 금액 추이 ══════════════════════════════
    const p9MonthlyTotals = Array.from({length:12},(_,i)=>{
      const row=(rptMonthlyUsed||[]).find(r=>parseInt(r.month)===i+1)
      return row?parseInt(row.total_used||row.totalUsed||0):0
    })
    const p9ActiveMonths = Array.from({length:12},(_,i)=>i).filter(i=>p9MonthlyTotals[i]>0)
    const p9CurAmt = p9MonthlyTotals[reportMonth-1]
    const p9PrevAmt = reportMonth>1?p9MonthlyTotals[reportMonth-2]:0
    const p9Diff = p9PrevAmt>0?Math.round((p9CurAmt-p9PrevAmt)/p9PrevAmt*100):0
    const p9Avg = p9ActiveMonths.length>0?Math.round(p9ActiveMonths.reduce((s,i)=>s+p9MonthlyTotals[i],0)/p9ActiveMonths.length):0
    const p9Max = Math.max(...p9MonthlyTotals.filter(v=>v>0), 1)
    const p9MaxMonth = p9MonthlyTotals.indexOf(p9Max)+1
    const p9Analysis = p9ActiveMonths.length>0
      ? `${reportMonth}월 발주 총액 ${fmtMan(p9CurAmt)}원.${p9Diff!==0?` 전월 대비 ${p9Diff>0?'+':''}${p9Diff}%.`:''} 연평균 ${fmtMan(p9Avg)}원 대비 ${p9CurAmt>=p9Avg?'높은':'낮은'} 수준입니다.`
      : '월별 총 발주 추이 데이터를 누적 중입니다.'
    const p9Warn = p9Diff>20?`⚠ 전월 대비 발주액이 ${p9Diff}% 급증했습니다. 원인 파악이 필요합니다.`
      :p9Diff<-20?`⚠ 전월 대비 발주액이 ${Math.abs(p9Diff)}% 급감했습니다. 운영 현황을 확인하세요.`:null
    const slide9 = `
    <div class="report-slide rpt-report-page">
      ${SH(9,'월별 총 발주 금액 추이','Monthly Total Order Trend')}
      <div style="background:#f8fafc;border-radius:12px;padding:20px;border:1px solid #e2e8f0;flex:1;margin-bottom:20px;min-height:0">
        <div style="font-size:14px;font-weight:700;color:#1f2937;margin-bottom:10px">2026년 월별 총 발주 금액 추이</div>
        <div id="rptMonthlyTotalChart" style="width:100%;height:280px"></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px;flex-shrink:0">
        ${KPI(`${reportMonth}월 발주액`,`${fmtMan(p9CurAmt)}원`,'이번 달','#064e3b','#f0fdf4','💰')}
        ${KPI('전월 발주액',p9PrevAmt>0?`${fmtMan(p9PrevAmt)}원`:'—','전월','#374151','#f9fafb','📅')}
        ${KPI('연평균 발주액',`${fmtMan(p9Avg)}원`,'1~현재월','#1d4ed8','#eff6ff','📊')}
        ${KPI('최대 발주월',`${p9MaxMonth}월`,`${fmtMan(p9Max)}원`,'#d97706','#fffbeb','🏆')}
      </div>
      ${AIBox(p9Analysis, p9Warn, '#064e3b','#f0fdf4')}
    </div>`

    // ══ PAGE 10: 월별 1일-말일 발주 금액 추이 ════════════════════════
    const p10DailyLabels = dailyLabels
    const p10DailyValues = dailyValues
    const p10NonZeroDays = p10DailyValues.filter(v=>v>0)
    const p10Avg = p10NonZeroDays.length>0?Math.round(p10NonZeroDays.reduce((s,v)=>s+v,0)/p10NonZeroDays.length):0
    const p10Max = Math.max(...p10DailyValues,1)
    const p10MaxDay = p10DailyValues.indexOf(p10Max)+1
    const p10Total = p10DailyValues.reduce((s,v)=>s+v,0)
    const p10SpikeDay = rptDailyAll.find(d=>d.amount>p10Avg*2)
    const p10Analysis = p10NonZeroDays.length>0
      ? `${reportMonth}월 일별 발주 현황. 총 ${p10DailyLabels.length}일 중 ${p10NonZeroDays.length}일 발주. 일평균 ${fmtMan(p10Avg)}원, 최대 ${p10MaxDay}일(${fmtMan(p10Max)}원)입니다.`
      : '일별 발주 데이터가 없습니다.'
    const p10Warn = p10SpikeDay?`⚠ ${p10SpikeDay.day}일 발주(${fmtMan(p10SpikeDay.amount)}원)가 일평균 대비 급증했습니다.`:null
    const slide10 = `
    <div class="report-slide rpt-report-page">
      ${SH(10,`${reportMonth}월 일별 발주 금액 추이`,'Daily Order Trend')}
      <div style="background:#f8fafc;border-radius:12px;padding:20px;border:1px solid #e2e8f0;flex:1;margin-bottom:20px;min-height:0">
        <div style="font-size:14px;font-weight:700;color:#1f2937;margin-bottom:10px">${reportYear}년 ${reportMonth}월 1일~말일 일별 발주 금액</div>
        <div id="rptDailyOrderChart" style="width:100%;height:280px"></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px;flex-shrink:0">
        ${KPI('월 총 발주액',`${fmtMan(p10Total)}원`,'이번 달 합계','#064e3b','#f0fdf4','💰')}
        ${KPI('발주 일수',`${p10NonZeroDays.length}일`,`전체 ${daysInMonth}일 중`,'#1d4ed8','#eff6ff','📅')}
        ${KPI('일평균 발주',`${fmtMan(p10Avg)}원`,'발주일 기준','#7c3aed','#faf5ff','📊')}
        ${KPI('최대 발주일',`${p10MaxDay}일`,`${fmtMan(p10Max)}원`,'#d97706','#fffbeb','🏆')}
      </div>
      ${AIBox(p10Analysis, p10Warn, '#d97706','#fffbeb')}
    </div>`

    // ══ PAGE 11: 월별 식수 추이 분석 ══════════════════════════════════
    const p11Cats = rptAnnualCats.length > 0 ? rptAnnualCats : []
    const p11CatColors = ['#10b981','#3b82f6','#8b5cf6','#f59e0b','#ef4444','#0891b2','#ec4899','#64748b']
    const p11StaffColor = '#6366f1'
    const p11GuardColor = '#f97316'
    const p11CatData = p11Cats.map((cat, ci) => ({
      name: cat.category_name,
      key: `cat_${cat.category_key}`,
      color: p11CatColors[ci % p11CatColors.length],
      values: Array.from({length:12}, (_,i) => {
        const mStr = String(i+1)
        return (rptMonthCatMeals[mStr]?.[`cat_${cat.category_key}`]) || 0
      })
    }))
    const p11StaffData = Array.from({length:12}, (_,i) => (rptMonthCatMeals[String(i+1)]?.staff) || 0)
    const p11GuardData = Array.from({length:12}, (_,i) => (rptMonthCatMeals[String(i+1)]?.guardian) || 0)
    const p11TotalData = Array.from({length:12}, (_,i) => {
      const catSum = p11CatData.reduce((s,c) => s + c.values[i], 0)
      return catSum + p11StaffData[i] + p11GuardData[i]
    })
    const p11CurIdx  = reportMonth - 1
    const p11PrevIdx = reportMonth - 2
    const hasPrevP11 = p11PrevIdx >= 0 && p11TotalData[p11PrevIdx] > 0
    const p11Changes = hasPrevP11 ? [
      ...p11CatData.map(cat => {
        const diff = cat.values[p11CurIdx] - cat.values[p11PrevIdx]
        return { name: cat.name, cur: cat.values[p11CurIdx], prev: cat.values[p11PrevIdx], diff, color: diff>0?'#16a34a':diff<0?'#dc2626':'#6b7280' }
      }),
      { name:'직원', cur:p11StaffData[p11CurIdx], prev:p11StaffData[p11PrevIdx], diff:p11StaffData[p11CurIdx]-p11StaffData[p11PrevIdx], color:(p11StaffData[p11CurIdx]-p11StaffData[p11PrevIdx])>0?'#16a34a':(p11StaffData[p11CurIdx]-p11StaffData[p11PrevIdx])<0?'#dc2626':'#6b7280' },
      { name:'보호자', cur:p11GuardData[p11CurIdx], prev:p11GuardData[p11PrevIdx], diff:p11GuardData[p11CurIdx]-p11GuardData[p11PrevIdx], color:(p11GuardData[p11CurIdx]-p11GuardData[p11PrevIdx])>0?'#16a34a':(p11GuardData[p11CurIdx]-p11GuardData[p11PrevIdx])<0?'#dc2626':'#6b7280' }
    ] : []
    const p11AnalysisParts = p11Changes.filter(c=>c.diff!==0).map(c=>`전월 대비 ${c.name} 식수 ${Math.abs(c.diff)}명 ${c.diff>0?'증가':'감소'}`)
    const p11Analysis = p11TotalData.some(v=>v>0)
      ? (p11AnalysisParts.length>0 ? p11AnalysisParts.join(', ') + '했습니다.' : `${reportMonth}월 총 식수 ${fmt(p11TotalData[p11CurIdx])}명으로 전월과 유사한 수준입니다.`)
      : '연간 식수 데이터를 분석합니다.'
    const p11Warn = (() => {
      const totalDiff = hasPrevP11 ? p11TotalData[p11CurIdx] - p11TotalData[p11PrevIdx] : 0
      const totalPct  = hasPrevP11 && p11TotalData[p11PrevIdx] > 0 ? (totalDiff / p11TotalData[p11PrevIdx] * 100) : 0
      return Math.abs(totalPct) > 20 ? `⚠ 총 식수 변동률이 ${Math.abs(totalPct).toFixed(1)}%로 평균 대비 이상 급변입니다.` : null
    })()
    const p11ActiveMonths = Array.from({length:12},(_,i)=>i).filter(i=>p11TotalData[i]>0)
    // 현재 월 식수 KPI
    const p11CurCats = rptCatMeals.length>0?rptCatMeals:[
      {name:'직원',count:ms.total_staff||0},{name:'보호자',count:ms.total_guardian||0}
    ]
    const slide11 = `
    <div class="report-slide rpt-report-page">
      ${SH(11,'월별 식수 추이 분석','Monthly Meal Count Trend')}
      <div style="display:grid;grid-template-columns:1fr;gap:10px;flex:1;min-height:0;margin-bottom:10px">
        <div style="background:#f8fafc;border-radius:12px;padding:14px;border:1px solid #e2e8f0;flex:1;min-height:0">
          <div style="font-size:14px;font-weight:700;color:#1f2937;margin-bottom:10px">2026년 월별 카테고리별 식수 추이 (누적 막대)</div>
          <div id="rptMonthlyMealChart" style="width:100%;height:240px"></div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(${Math.min(p11CurCats.filter(c=>c.count>0).length||2,4)},1fr);gap:8px;margin-bottom:10px;flex-shrink:0">
        ${p11CurCats.filter(c=>c.count>0).slice(0,4).map((c,i)=>`
          <div style="background:${['#f0fdf4','#eff6ff','#faf5ff','#fffbeb'][i%4]};border-radius:10px;padding:10px 12px;border-left:4px solid ${p11CatColors[i]||p11StaffColor};position:relative;overflow:hidden">
            <div style="font-size:9px;color:#374151;font-weight:700;margin-bottom:3px">${c.name}</div>
            <div style="font-size:20px;font-weight:900;color:${p11CatColors[i]||p11StaffColor};line-height:1.1">${c.count.toLocaleString()}<span style="font-size:11px;font-weight:600;margin-left:2px">명</span></div>
            <div style="font-size:9px;color:#6b7280;margin-top:2px">${reportMonth}월 합계</div>
          </div>`).join('')}
      </div>
      ${AIBox(p11Analysis, p11Warn, '#0891b2','#ecfeff')}
    </div>`

    // ══ PAGE 12: 월별 잔반 분석 ══════════════════════════════════════
    const rptFoodWaste = annualData?.foodWasteMonthly || []
    const p12WasteKg = Array.from({length:12},(_,i)=>{
      const row=rptFoodWaste.find(r=>parseInt(r.month)===i+1)
      return row?parseFloat(row.total_kg||row.totalL||0):0
    })
    const p12WasteCost = Array.from({length:12},(_,i)=>{
      const row=rptFoodWaste.find(r=>parseInt(r.month)===i+1)
      return row?parseInt(row.total_cost||row.totalCost||0):0
    })
    const p12ActiveMonths = Array.from({length:12},(_,i)=>i).filter(i=>p12WasteKg[i]>0||p12WasteCost[i]>0)
    const p12CurKg = p12WasteKg[reportMonth-1]
    const p12CurCost = p12WasteCost[reportMonth-1]
    const p12PrevKg = reportMonth>1?p12WasteKg[reportMonth-2]:0
    const p12AvgKg = p12ActiveMonths.length>0?p12ActiveMonths.reduce((s,i)=>s+p12WasteKg[i],0)/p12ActiveMonths.length:0
    const p12KgDiff = p12PrevKg>0?Math.round((p12CurKg-p12PrevKg)/p12PrevKg*100):0
    const hasWasteData = p12ActiveMonths.length>0||p12CurKg>0
    const p12Analysis = hasWasteData
      ? `${reportMonth}월 잔반량 ${p12CurKg.toFixed(1)}L, 비용 ${fmt(p12CurCost)}원.${p12KgDiff!==0?` 전월 대비 ${p12KgDiff>0?'+':''}${p12KgDiff}%.`:''} 연평균 ${p12AvgKg.toFixed(1)}L 대비 ${p12CurKg>=p12AvgKg?'높은':'낮은'} 수준입니다.`
      : '잔반 데이터를 입력하면 월별 추이를 분석합니다.'
    const p12Warn = p12CurKg>0&&p12AvgKg>0&&p12CurKg>p12AvgKg*1.3?`⚠ 이번 달 잔반량이 평균 대비 30% 이상 많습니다. 식단 조정을 검토하세요.`:null
    const slide12 = `
    <div class="report-slide rpt-report-page">
      ${SH(12,'월별 잔반 분석','Monthly Food Waste Analysis')}
      ${hasWasteData ? `
      <div style="background:#f8fafc;border-radius:12px;padding:20px;border:1px solid #e2e8f0;flex:1;margin-bottom:20px;min-height:0">
        <div style="font-size:14px;font-weight:700;color:#1f2937;margin-bottom:10px">2026년 월별 잔반량(L) 및 비용 추이</div>
        <div id="rptFoodWasteChart" style="width:100%;height:260px"></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px;flex-shrink:0">
        ${KPI(`${reportMonth}월 잔반량`,`${p12CurKg.toFixed(1)}L`,'이번 달','#f59e0b','#fffbeb','♻️')}
        ${KPI('잔반 비용',p12CurCost>0?`${fmt(p12CurCost)}원`:'—','이번 달','#ef4444','#fef2f2','💸')}
        ${KPI('전월 잔반량',p12PrevKg>0?`${p12PrevKg.toFixed(1)}L`:'—','전월','#374151','#f9fafb','📅')}
        ${KPI('연평균 잔반',`${p12AvgKg.toFixed(1)}L`,'1~현재월','#6b7280','#f3f4f6','📊')}
      </div>` : `
      <div style="flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px">
        <div style="font-size:48px">♻️</div>
        <div style="font-size:14px;font-weight:700;color:#374151">잔반 데이터 없음</div>
        <div style="font-size:11px;color:#9ca3af;text-align:center">대시보드 > 잔반 기록에서 데이터를 입력하면<br>월별 잔반 추이를 분석합니다.</div>
      </div>`}
      ${AIBox(p12Analysis, p12Warn, '#f59e0b','#fffbeb')}
    </div>`

    // ══ PAGE 13: 종합 운영 점수 ══════════════════════════════════════
    const scoreItems = [
      {label:'예산 관리',val:progress>=80&&progress<=90?95:progress>=70&&progress<80?75:progress>=90?80:55,icon:'📊',desc:`${progress}% 달성`},
      {label:'식단가 관리',val:targetPrice>0?(mealPrice<=targetPrice?90:mealPrice<=targetPrice*1.05?75:mealPrice<=targetPrice*1.1?60:45):70,icon:'🍱',desc:mealPrice>0?`${fmt(mealPrice)}원`:'—'},
      {label:'발주 관리',val:topVendorRatio<40?90:topVendorRatio<60?70:50,icon:'📦',desc:`업체 ${rptOrders.length}개`},
      {label:'식수 안정성',val:totalMeals>0?80:50,icon:'👥',desc:`${fmt(totalMeals)}명`},
      {label:'잔반 관리',val:p12CurKg>0&&p12AvgKg>0?(p12CurKg<=p12AvgKg?90:p12CurKg<=p12AvgKg*1.2?70:50):60,icon:'♻️',desc:p12CurKg>0?`${p12CurKg.toFixed(1)}L`:'데이터없음'},
    ]
    const overallScore = Math.round(scoreItems.reduce((s,i)=>s+i.val,0)/scoreItems.length)
    const scoreAnalysis = rptAutoAnalysis.length>1?rptAutoAnalysis.slice(0,2).join(' ')
      :`이번 달 운영 종합 점수는 ${overallScore}점입니다. ${overallScore>=80?'전반적으로 안정적인 운영이 이루어지고 있습니다.':'개선이 필요한 항목을 중점 관리하세요.'}`
    const scoreWarn = aiWarnings.length>0?aiWarnings[0].text:null
    const slide13 = `
    <div class="report-slide rpt-report-page" style="display:flex;flex-direction:column;gap:0">
      ${SH(13,'종합 운영 점수','Overall Operation Score')}
      <!-- 행1: 레이더 차트(왼) + AI경고요약+서명(오) - 충분한 높이 -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;flex:1;min-height:0;margin-bottom:12px;overflow:hidden">
        <!-- 왼쪽: 레이더 차트 카드 -->
        <div style="background:#f8fafc;border-radius:12px;padding:14px;border:1px solid #e2e8f0;display:flex;flex-direction:column;overflow:hidden">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-shrink:0">
            <div style="font-size:15px;font-weight:800;color:#064e3b">종합 운영 점수</div>
            <div style="font-size:28px;font-weight:900;color:${tc(overallScore)}">${overallScore}<span style="font-size:13px">점</span></div>
          </div>
          <!-- 레이더 차트: 남은 공간 전부 사용 -->
          <div id="rptScoreChart" style="width:100%;flex:1;min-height:0;position:relative"></div>
        </div>
        <!-- 오른쪽: AI 경고 요약 + 서명란 -->
        <div style="display:flex;flex-direction:column;gap:10px;overflow:hidden">
          ${aiWarnings.length>0?`
          <div style="background:#fef2f2;border-radius:12px;padding:14px;border:1px solid #fca5a5;flex:1;display:flex;flex-direction:column;overflow:hidden">
            <div style="font-size:12px;font-weight:800;color:#dc2626;margin-bottom:8px;display:flex;align-items:center;gap:6px;flex-shrink:0">
              <span style="background:#dc2626;color:white;padding:3px 12px;border-radius:10px;font-size:10px">△ AI 경고 요약</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;flex:1;overflow:hidden;justify-content:center">
              ${aiWarnings.slice(0,4).map(w=>`
                <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:rgba(255,255,255,0.7);border-radius:8px;border-left:3px solid ${w.color||'#dc2626'};flex-shrink:0">
                  <span style="font-size:14px;flex-shrink:0">${w.icon||'⚠️'}</span>
                  <div style="font-size:12px;color:#7f1d1d;line-height:1.4">${w.text}</div>
                </div>`).join('')}
            </div>
          </div>`:`
          <div style="background:#f0fdf4;border-radius:12px;padding:14px;border:1px solid #6ee7b7;flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center">
            <div style="font-size:32px;margin-bottom:6px">✅</div>
            <div style="font-size:14px;font-weight:700;color:#065f46;text-align:center">이번 달 경고 없음</div>
            <div style="font-size:12px;color:#047857;margin-top:4px;text-align:center">안정적인 운영이 이루어지고 있습니다</div>
          </div>`}
          <!-- 서명란 -->
          <div style="background:#f8fafc;border-radius:10px;padding:12px;border:1px solid #e5e7eb;flex-shrink:0">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div style="font-size:11px;color:#9ca3af;line-height:1.7">
                <div>본 보고서는 Re&amp;H 급식 운영 관리 시스템에 의해 자동 생성되었습니다.</div>
                <div>보고 기간: ${reportYear}년 ${reportMonth}월 | 작성일: ${new Date().toLocaleDateString('ko-KR')}</div>
              </div>
              <div style="text-align:center;padding:8px 16px;border:1px solid #e5e7eb;border-radius:8px;min-width:100px;background:white;flex-shrink:0">
                <div style="font-size:10px;color:#9ca3af;margin-bottom:6px">영양사 서명 확인</div>
                <div style="font-size:11px;font-weight:700;color:#1f2937">${hospitalName}</div>
                <div style="font-size:11px;color:#6b7280;margin-top:3px">영양사: ${s.nutritionistName||s.nutritionist_name||'(서명)'}</div>
                <div style="font-size:11px;color:#374151;margin-top:6px;letter-spacing:4px">(인)</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <!-- 행2: 5개 점수 카드 (고정 높이, flex-shrink:0) -->
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;flex-shrink:0;margin-bottom:10px">
        ${scoreItems.map(item=>`
          <div style="background:#f8fafc;border-radius:10px;padding:10px 12px;border:1px solid #e2e8f0;border-top:3px solid ${tc(item.val)}">
            <div style="display:flex;align-items:center;gap:5px;margin-bottom:5px">
              <span style="font-size:14px">${item.icon}</span>
              <span style="font-size:11px;font-weight:600;color:#374151">${item.label}</span>
            </div>
            <div style="font-size:20px;font-weight:900;color:${tc(item.val)};margin-bottom:3px">${item.val}<span style="font-size:10px">점</span></div>
            <div style="font-size:10px;color:#6b7280;margin-bottom:5px">${item.desc}</div>
            <div style="background:#e5e7eb;border-radius:99px;height:5px;overflow:hidden">
              <div style="height:100%;width:${item.val}%;background:${tc(item.val)};border-radius:99px"></div>
            </div>
          </div>`).join('')}
      </div>
      <!-- 행3: AI 분석/경고 (고정 높이, flex-shrink:0) -->
      <div style="display:grid;grid-template-columns:1fr${scoreWarn?' 1fr':''};gap:14px;flex-shrink:0">
        <div style="background:#f0fdf4;border:1px solid #064e3b30;border-left:5px solid #064e3b;border-radius:10px;padding:10px 14px">
          <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px">
            <span style="background:#064e3b;color:white;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700">AI 분석</span>
          </div>
          <div style="font-size:12px;color:#1e3a5f;line-height:1.6;font-weight:500">${scoreAnalysis}</div>
        </div>
        ${scoreWarn?`<div style="background:#fef2f2;border:1px solid #dc262630;border-left:5px solid #dc2626;border-radius:10px;padding:10px 14px">
          <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px">
            <span style="background:#dc2626;color:white;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700">AI 경고</span>
          </div>
          <div style="font-size:12px;color:#7f1d1d;line-height:1.6;font-weight:500">${scoreWarn}</div>
        </div>`:''}
      </div>
    </div>`

    // ══ PAGE 14: 다음 달 운영 전략 ══════════════════════════════════
    const nextMealPrice = nextSettingsData?.settings?.meal_price||0
    const slide14 = `
    <div class="report-slide rpt-report-page">
      ${SH(14,'다음 달 운영 전략','Next Month Strategy')}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:28px;flex:1;min-height:0;margin-bottom:12px">
        <!-- 다음 달 목표 -->
        <div style="background:#ecfdf5;border-radius:12px;padding:16px;border:1px solid #6ee7b7;display:flex;flex-direction:column">
          <div style="font-size:16px;font-weight:800;color:#064e3b;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #064e3b;display:flex;align-items:center;gap:8px">
            <span style="background:#064e3b;color:white;padding:3px 12px;border-radius:10px;font-size:10px">다음 달 목표</span>
            ${nextMonth}월 운영 계획
          </div>
          ${[
            {icon:'💰',title:'예산 집행률 목표',text:'80~90% 범위 내 집행 유지',color:'#064e3b',bg:'rgba(255,255,255,0.8)'},
            {icon:'🍱',title:'식단가 목표',text:`${nextMealPrice>0?fmt(nextMealPrice)+'원 수준 유지':(fmt(mealPrice||0)+'원 기준 관리')}`,color:'#7c3aed',bg:'rgba(255,255,255,0.8)'},
            {icon:'📦',title:'발주 구조 개선',text:'업체별 단가 재협상 및 의존도 분산',color:'#1d4ed8',bg:'rgba(255,255,255,0.8)'},
            {icon:'✅',title:'식단 품질 향상',text:'영양 균형 및 다양성 강화',color:'#d97706',bg:'rgba(255,255,255,0.8)'},
            {icon:'♻️',title:'잔반 감소 목표',text:'전월 대비 10% 감소 목표',color:'#f59e0b',bg:'rgba(255,255,255,0.8)'},
          ].map(g=>`
            <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;padding:10px;background:${g.bg};border-radius:8px;border-left:3px solid ${g.color}">
              <span style="font-size:20px;flex-shrink:0">${g.icon}</span>
              <div>
                <div style="font-size:14px;font-weight:700;color:${g.color};margin-bottom:4px">${g.title}</div>
                <div style="font-size:13px;color:#065f46">${g.text}</div>
              </div>
            </div>`).join('')}
        </div>
        <!-- 이번 달 핵심 지표 요약 + KPI -->
        <div style="display:flex;flex-direction:column;gap:16px">
          <div style="background:#f8fafc;border-radius:12px;padding:14px;border:1px solid #e2e8f0;flex:1">
            <div style="font-size:15px;font-weight:800;color:#1f2937;margin-bottom:12px">${reportMonth}월 핵심 성과 요약</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              ${KPI('예산 집행률',`${progress}%`,`목표 80~90%`,tc(progress),'#f8fafc','📊')}
              ${KPI('평균 식단가',`${fmt(mealPrice)}원`,targetPrice>0?`목표 ${fmt(targetPrice)}원`:'—','#7c3aed','#faf5ff','🍱')}
              ${KPI('총 발주액',`${fmtMan(usedAmount)}원`,`${reportMonth}월 합계`,'#064e3b','#f0fdf4','💰')}
              ${KPI('총 식수',`${fmt(totalMeals)}명`,`${reportMonth}월 합계`,'#0891b2','#ecfeff','👥')}
            </div>
          </div>
          <!-- 다음 달 중점 관리 포인트 -->
          ${aiWarnings.length>0?`
          <div style="background:#fffbeb;border-radius:10px;padding:12px;border-left:4px solid #d97706;flex-shrink:0">
            <div style="font-size:13px;font-weight:800;color:#d97706;margin-bottom:8px">⚠ 다음 달 중점 관리 포인트</div>
            ${aiWarnings.slice(0,3).map(w=>`<div style="font-size:13px;color:#92400e;margin-bottom:5px;display:flex;align-items:flex-start;gap:6px"><span>${w.icon||'•'}</span><span>${w.text}</span></div>`).join('')}
          </div>`:
          `<div style="background:#f0fdf4;border-radius:10px;padding:12px;border-left:4px solid #064e3b;flex-shrink:0">
            <div style="font-size:13px;font-weight:800;color:#064e3b;margin-bottom:8px">✅ 이번 달 운영 현황 양호</div>
            <div style="font-size:13px;color:#065f46">주요 지표가 목표 범위 내에서 관리되고 있습니다. 다음 달도 현재 수준을 유지하세요.</div>
          </div>`}
        </div>
      </div>
      ${AIBox(
        `${reportMonth}월 운영을 바탕으로 ${nextMonth}월 목표를 설정했습니다. 예산 집행률 ${progress}%, 식단가 ${fmt(mealPrice)}원 기준으로 다음 달 계획을 수립하세요.`,
        aiWarnings.length>1?aiWarnings[1].text:null,
        '#064e3b','#f0fdf4'
      )}
    </div>`

    return slide1+slide2+slide3+slide4+slide5+slide6+slide7+slide8+slide9+slide10+slide11+slide12+slide13+slide14

  })()}

  </div>`

  // ── 차트 렌더링 (renderReport 스코프 변수 사용) ──
  // innerHTML 완료 후 DOM이 실제로 그려진 다음에 차트를 그리기 위해 setTimeout 사용
  setTimeout(() => {
  // 한 번 더 requestAnimationFrame으로 브라우저 페인트 완료 대기
  requestAnimationFrame(() => {
  try {

    const _s    = rptSummary
    const _prog = _s.progress||0
    const _tot  = _s.totalBudget||0
    const _used = _s.usedAmount||0
    const _tp   = _s.targetMealPrice||0
    const _mp   = mealPriceForRpt||0
    const _days = new Date(reportYear, reportMonth, 0).getDate()
    const _ela  = rptProjection.elapsedDays||0
    const _davg = rptDepletion.dailyAvgUsed||0
    const _dep  = rptDepletion

    // ── 공통 포맷 헬퍼
    const _fmt    = n => (n||0).toLocaleString()
    const _fmtM   = n => { const v=Math.abs(n||0); return v>=100000000?`${(v/100000000).toFixed(1)}억`:v>=10000?`${(v/10000).toFixed(0)}만`:`${v.toLocaleString()}` }
    const _hex2r  = (h,a) => { const r=parseInt(h.slice(1,3),16),g=parseInt(h.slice(3,5),16),b=parseInt(h.slice(5,7),16); return `rgba(${r},${g},${b},${a})` }

    // ── 공통 플러그인 ──────────────────────────────────────────
    const barLabelPlugin = {
      id: '_barLabels',
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
            ctx.textBaseline = chart.config.options?.indexAxis === 'y' ? 'middle' : 'bottom'
            const label = val >= 1e6 ? `${(val/1e6).toFixed(1)}백만` : val >= 1e4 ? `${(val/1e4).toFixed(0)}만` : val.toLocaleString()
            if (chart.config.options?.indexAxis === 'y') {
              ctx.fillText(label, bar.x + 28, bar.y)
            } else {
              ctx.fillText(label, bar.x, bar.y - 3)
            }
            ctx.restore()
          })
        })
      }
    }
    const ptLabelPlugin = {
      id: '_ptLabels',
      afterDatasetsDraw(chart) {
        if (!chart.config.options?._showPointLabels) return
        const { ctx } = chart
        chart.data.datasets.forEach((ds, di) => {
          if (ds.type === 'line' || chart.config.type === 'line' || chart.config.type === 'radar') return
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
        })
      }
    }
    const centerPlugin = {
      id: '_center',
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

    // 안전한 차트 생성 헬퍼 (div 또는 canvas 모두 지원)
    const SC = (id, config, plugins=[]) => {
      let el = document.getElementById(id)
      if (!el) { console.warn('[차트] 컨테이너 없음:', id); return null }
      // div라면 내부에 canvas를 생성
      if (el.tagName.toLowerCase() !== 'canvas') {
        const existing = el.querySelector('canvas')
        if (existing) {
          const oldChart = Chart.getChart(existing)
          if (oldChart) oldChart.destroy()
          el = existing
        } else {
          const canvas = document.createElement('canvas')
          canvas.style.width = '100%'
          canvas.style.height = '100%'
          el.innerHTML = ''
          el.appendChild(canvas)
          el = canvas
        }
      } else {
        if (Chart.getChart(el)) Chart.getChart(el).destroy()
      }
      try {
        const chart = new Chart(el, { ...config, plugins: [...(config.plugins||[]), ...plugins] })
        console.log('[차트] 생성 완료:', id)
        return chart
      } catch(e) { console.warn('[차트] 생성 오류:', id, e.message); return null }
    }

    // 차트 렌더링 시작 로그
    console.log('[보고서] 차트 렌더링 시작, 컨테이너 IDs:', 
      ['rptGaugeChart','rptCatPriceChart','rptDailyChart','rptVendorChart','rptWaterChart',
       'rptMonthlyMealChart','rptMealPriceChart','rptBulletChart','rptBudgetBurnChart','rptCardPieChart','rptScoreChart']
      .map(id => id + ':' + (document.getElementById(id) ? '존재' : '없음'))
      .join(', ')
    )

    // ── PAGE 2: 게이지 차트 (정형화된 반원 게이지 v2) ────────────────
    ;(()=>{
      const container = document.getElementById('rptGaugeChart')
      if (!container) { console.warn('[차트] rptGaugeChart 없음'); return }
      try {
        let el = container.tagName.toLowerCase() === 'canvas' ? container : container.querySelector('canvas')
        if (!el) {
          el = document.createElement('canvas')
          container.innerHTML = ''
          container.appendChild(el)
        }
        const pct = Math.min(Math.max(_prog, 0), 100)
        // 진행률에 따른 메인 색상
        const arcColor = pct >= 90 ? '#dc2626' : pct >= 80 ? '#f59e0b' : '#10b981'

        // 고해상도 렌더링
        const dpr = window.devicePixelRatio || 1
        const W = container.offsetWidth || 320
        const H = container.offsetHeight || 180
        el.width  = W * dpr
        el.height = H * dpr
        el.style.width  = W + 'px'
        el.style.height = H + 'px'
        const ctx = el.getContext('2d')
        ctx.scale(dpr, dpr)
        ctx.clearRect(0, 0, W, H)

        // ── 기하 설정 ──────────────────────────────
        // 반원 중심을 아래쪽 72% 지점에 배치, 상단 여유 확보
        const cx = W / 2
        const cy = H * 0.72
        // 반지름: 너비/2에서 레이블 공간 32px 빼기
        const R = Math.min(W * 0.40, cy - 10)
        const THICK = Math.max(16, R * 0.13)    // 두께 = 반지름의 13%
        const S_ANG = Math.PI       // 180° (왼쪽)
        const E_ANG = 2 * Math.PI   // 360° (오른쪽)
        const pctToAngle = p => S_ANG + (p / 100) * Math.PI

        // ── 1. 배경 트랙 (연한 회색) ──
        ctx.beginPath()
        ctx.arc(cx, cy, R, S_ANG, E_ANG)
        ctx.strokeStyle = '#e5e7eb'
        ctx.lineWidth = THICK
        ctx.lineCap = 'butt'
        ctx.stroke()

        // ── 2. 구간별 색상 트랙 그리기 ──
        // 0–80%: 초록
        ctx.beginPath()
        ctx.arc(cx, cy, R, pctToAngle(0), pctToAngle(80))
        ctx.strokeStyle = '#d1fae5'   // 연한 초록 배경
        ctx.lineWidth = THICK
        ctx.lineCap = 'butt'
        ctx.stroke()
        // 80–90%: 연한 노랑
        ctx.beginPath()
        ctx.arc(cx, cy, R, pctToAngle(80), pctToAngle(90))
        ctx.strokeStyle = '#fde68a'
        ctx.lineWidth = THICK
        ctx.lineCap = 'butt'
        ctx.stroke()
        // 90–100%: 연한 빨강
        ctx.beginPath()
        ctx.arc(cx, cy, R, pctToAngle(90), pctToAngle(100))
        ctx.strokeStyle = '#fecaca'
        ctx.lineWidth = THICK
        ctx.lineCap = 'butt'
        ctx.stroke()

        // ── 3. 진행률 채움 (진한 색) ──
        if (pct > 0) {
          // pct 지점까지 진한 색으로 덮어씌움
          const fillEnd = pctToAngle(Math.min(pct, 80))
          ctx.beginPath()
          ctx.arc(cx, cy, R, pctToAngle(0), fillEnd)
          ctx.strokeStyle = '#10b981'
          ctx.lineWidth = THICK
          ctx.lineCap = 'butt'
          ctx.stroke()
          if (pct > 80) {
            ctx.beginPath()
            ctx.arc(cx, cy, R, pctToAngle(80), pctToAngle(Math.min(pct, 90)))
            ctx.strokeStyle = '#f59e0b'
            ctx.lineWidth = THICK
            ctx.lineCap = 'butt'
            ctx.stroke()
          }
          if (pct > 90) {
            ctx.beginPath()
            ctx.arc(cx, cy, R, pctToAngle(90), pctToAngle(pct))
            ctx.strokeStyle = '#ef4444'
            ctx.lineWidth = THICK
            ctx.lineCap = 'butt'
            ctx.stroke()
          }
        }

        // ── 4. 구간 경계 마크 (80%, 90%) ──
        ;[[80, '#d97706'], [90, '#dc2626']].forEach(([p, c]) => {
          const a = pctToAngle(p)
          const r1 = R - THICK / 2 - 2
          const r2 = R + THICK / 2 + 2
          ctx.beginPath()
          ctx.moveTo(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a))
          ctx.lineTo(cx + r2 * Math.cos(a), cy + r2 * Math.sin(a))
          ctx.strokeStyle = c
          ctx.lineWidth = 2.5
          ctx.lineCap = 'butt'
          ctx.stroke()
        })

        // ── 5. 바늘 (삼각형 + 중심 허브) ──
        const needleA = pctToAngle(pct)
        const nLen    = R - THICK / 2 - 4   // 바늘 끝이 트랙 안쪽에 닿도록
        const hubR    = THICK * 0.5
        // 바늘 삼각형 (얇고 날카로운 형태)
        const baseHalf = hubR * 0.5
        const perpA = needleA + Math.PI / 2
        ctx.beginPath()
        ctx.moveTo(cx + nLen * Math.cos(needleA), cy + nLen * Math.sin(needleA))  // 끝점
        ctx.lineTo(cx + baseHalf * Math.cos(perpA), cy + baseHalf * Math.sin(perpA))   // 왼쪽 밑
        ctx.lineTo(cx - baseHalf * Math.cos(perpA), cy - baseHalf * Math.sin(perpA))   // 오른쪽 밑
        ctx.closePath()
        ctx.fillStyle = '#374151'
        ctx.fill()
        // 허브 원 (흰 테두리 + 진한 채우기)
        ctx.beginPath()
        ctx.arc(cx, cy, hubR, 0, 2 * Math.PI)
        ctx.fillStyle = '#1f2937'
        ctx.fill()
        ctx.beginPath()
        ctx.arc(cx, cy, hubR * 0.55, 0, 2 * Math.PI)
        ctx.fillStyle = 'white'
        ctx.fill()

        // ── 6. 외곽 레이블 (0%, 80%, 90%, 100%) ──
        const labelR = R + THICK / 2 + 13
        ;[
          [0,   '0%',   '#9ca3af', 'right',  'middle'],
          [50,  '50%',  '#9ca3af', 'center', 'bottom'],
          [80,  '80%',  '#d97706', 'center', 'bottom'],
          [90,  '90%',  '#dc2626', 'center', 'bottom'],
          [100, '100%', '#9ca3af', 'left',   'middle'],
        ].forEach(([p, lbl, c, align, base]) => {
          const a = pctToAngle(p)
          const lx = cx + labelR * Math.cos(a)
          const ly = cy + labelR * Math.sin(a)
          const isMark = p === 80 || p === 90
          ctx.font = isMark ? 'bold 10px sans-serif' : '9px sans-serif'
          ctx.fillStyle = c
          ctx.textAlign = align
          ctx.textBaseline = base
          ctx.fillText(lbl, lx, ly)
        })

        // ── 7. 중앙 숫자 표시 (반원 안쪽 중심 위) ──
        // 숫자를 cy 기준으로 약간 위에 크게 표시
        const numY = cy - R * 0.28
        ctx.font = `bold ${Math.round(R * 0.38)}px sans-serif`
        ctx.fillStyle = arcColor
        ctx.textAlign = 'center'
        ctx.textBaseline = 'alphabetic'
        ctx.fillText(`${Math.round(pct)}%`, cx, numY)

        // 서브텍스트 (숫자 바로 아래)
        ctx.font = `${Math.round(R * 0.10)}px sans-serif`
        ctx.fillStyle = '#6b7280'
        ctx.textBaseline = 'top'
        ctx.fillText('목표: 80 ~ 90%', cx, numY + 4)

        // ── 8. 상태 텍스트 (게이지 하단 중심) ──
        const statusY = cy + 12
        const statusText = pct >= 90 ? '⚠ 예산 초과 주의' : pct >= 80 ? '✓ 정상 범위' : '◎ 양호'
        const statusColor = pct >= 90 ? '#dc2626' : pct >= 80 ? '#d97706' : '#059669'
        ctx.font = `bold ${Math.round(R * 0.10)}px sans-serif`
        ctx.fillStyle = statusColor
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText(statusText, cx, statusY)

        console.log('[차트] rptGaugeChart v2 완료, pct:', pct)
      } catch(e){ console.warn('[Gauge]', e.message) }
    })()

    // ── PAGE 3: 카테고리별 식단가 바 차트 (바 위 값 표시 강화) ─────
    ;(()=>{
      const el = document.getElementById('rptCatPriceChart')
      if(!el) return
      const catColors = ['#064e3b','#1d4ed8','#7c3aed','#dc2626','#d97706','#0891b2','#059669','#9333ea']
      const rawCat = rptCatDietPrices && rptCatDietPrices.length>0
        ? rptCatDietPrices.map((c,i)=>({name:c.category_name||c.name||'',price:Math.round(c.monthDietPrice||c.mealPrice||c.meal_price||0),col:catColors[i%catColors.length]}))
        : rptCatMeals.map((c,i)=>({name:c.name,price:0,col:catColors[i%catColors.length]}))
      if(!rawCat.length) return
      const catBarLabel = {
        id:'_catLabel',
        afterDatasetsDraw(chart){
          const {ctx}=chart
          chart.data.datasets.forEach((ds,di)=>{
            if(ds.type==='line') return
            const meta=chart.getDatasetMeta(di)
            meta.data.forEach((bar,i)=>{
              const val=ds.data[i]; if(!val||val===0) return
              ctx.save()
              ctx.font='bold 11px sans-serif'; ctx.fillStyle='#1f2937'
              ctx.textAlign='center'; ctx.textBaseline='bottom'
              ctx.fillText(val.toLocaleString()+'원', bar.x, bar.y-4)
              ctx.restore()
            })
          })
        }
      }
      SC('rptCatPriceChart',{
        type:'bar',
        data:{
          labels:rawCat.map(c=>c.name),
          datasets:[
            {label:'카테고리 식단가',data:rawCat.map(c=>c.price),
             backgroundColor:rawCat.map(c=>_hex2r(c.col,0.8)),
             borderColor:rawCat.map(c=>c.col),borderWidth:1,
             borderRadius:8,barPercentage:0.6},
            ...(_tp>0?[{label:`목표 ${_fmt(_tp)}원`,data:Array(rawCat.length).fill(_tp),
              type:'line',borderColor:'#ef4444',borderDash:[6,4],borderWidth:2.5,pointRadius:0,fill:false}]:[])
          ]
        },
        options:{responsive:true,maintainAspectRatio:false,
          layout:{padding:{top:24}},
          plugins:{legend:{labels:{font:{size:11,weight:'600'},boxWidth:12}}},
          scales:{y:{ticks:{callback:v=>`${(v/1000).toFixed(0)}천원`,font:{size:10},color:'#374151'},
                     grid:{color:'rgba(0,0,0,0.06)'},beginAtZero:true},
                 x:{ticks:{font:{size:11,weight:'600'},color:'#1f2937'}}}
        }
      },[catBarLabel])
    })()

    // ── PAGE 4: 일별 매입금액 바 차트 (바 위 금액 표시 개선) ────────
    ;(()=>{
      const vals = dailyValues
      const nonZ = vals.filter(v=>v>0)
      const avg  = nonZ.length ? Math.round(nonZ.reduce((a,b)=>a+b,0)/nonZ.length) : 0
      const dailyBarLabel = {
        id:'_dailyLabel',
        afterDatasetsDraw(chart){
          const {ctx}=chart
          chart.data.datasets.forEach((ds,di)=>{
            if(ds.type==='line') return
            const meta=chart.getDatasetMeta(di)
            meta.data.forEach((bar,i)=>{
              const val=ds.data[i]; if(!val||val===0) return
              ctx.save()
              const isSpike = val>avg*2&&avg>0
              ctx.font=`bold ${isSpike?'10':'9'}px sans-serif`
              ctx.fillStyle=isSpike?'#dc2626':'#1f2937'
              ctx.textAlign='center'; ctx.textBaseline='bottom'
              const label=val>=1e6?`${(val/1e6).toFixed(1)}백만`:val>=1e4?`${(val/1e4).toFixed(0)}만`:`${val.toLocaleString()}`
              ctx.fillText(label, bar.x, bar.y-3)
              ctx.restore()
            })
          })
        }
      }
      SC('rptDailyChart',{
        type:'bar',
        data:{
          labels:dailyLabels,
          datasets:[
            {label:'일별 매입금액',data:vals,
             backgroundColor:vals.map(v=>v>avg*2&&avg>0?'rgba(220,38,38,0.8)':'rgba(16,185,129,0.75)'),
             borderRadius:5,barPercentage:0.75,order:2},
            ...(avg>0?[{label:`일평균 ${_fmtM(avg)}원`,data:Array(dailyLabels.length).fill(avg),
              type:'line',borderColor:'#f59e0b',borderDash:[5,3],borderWidth:2.5,pointRadius:0,fill:false,order:1}]:[])
          ]
        },
        options:{responsive:true,maintainAspectRatio:false,
          layout:{padding:{top:20}},
          plugins:{legend:{labels:{font:{size:11,weight:'600'},boxWidth:12}}},
          scales:{y:{ticks:{callback:v=>`${(v/10000).toFixed(0)}만`,font:{size:10},color:'#374151'},
                     grid:{color:'rgba(0,0,0,0.06)'},beginAtZero:true},
                 x:{ticks:{font:{size:9},color:'#374151'}}}
        }
      },[dailyBarLabel])
    })()

    // ── PAGE 5: 업체별 도넛 차트 (선명한 색상, 업체명+%, 내반경 55%) ─
    ;(()=>{
      const orders = (rptOrders||[]).slice(0,8)
      if(!orders.length) return
      const vendorLabels = orders.map(v=>v.vendor||v.vendorName||v.name||'')
      const vendorData   = orders.map(v=>v.totalAmount||v.amount||0)
      const vendorTotal  = vendorData.reduce((s,v)=>s+v,0)
      if(!vendorData.some(v=>v>0)) return
      const COLORS=['#16A34A','#2563EB','#9333EA','#F97316','#EF4444','#0891B2','#D97706','#EC4899']
      const slicePlugin = {
        id:'_dSlice',
        afterDatasetsDraw(chart){
          const {ctx}=chart; const ds=chart.data.datasets[0]
          const tot=ds.data.reduce((s,v)=>s+v,0)
          if(!tot) return
          chart.getDatasetMeta(0).data.forEach((arc,i)=>{
            const val=ds.data[i]; if(!val||val/tot<0.04) return
            const {startAngle,endAngle,outerRadius,innerRadius,x,y}=arc
            const mid=(startAngle+endAngle)/2, rad=(outerRadius+innerRadius)/2
            const pct=Math.round(val/tot*100)
            ctx.save()
            ctx.font='bold 11px sans-serif'; ctx.fillStyle='white'
            ctx.textAlign='center'; ctx.textBaseline='middle'
            ctx.fillText(pct+'%', x+Math.cos(mid)*rad, y+Math.sin(mid)*rad-5)
            ctx.font='9px sans-serif'
            const lbl=(vendorLabels[i]||'').length>6?(vendorLabels[i]||'').slice(0,6)+'…':(vendorLabels[i]||'')
            ctx.fillText(lbl, x+Math.cos(mid)*rad, y+Math.sin(mid)*rad+6)
            ctx.restore()
          })
        }
      }
      SC('rptVendorChart',{
        type:'doughnut',
        data:{labels:vendorLabels,datasets:[{data:vendorData,
          backgroundColor:COLORS.slice(0,vendorLabels.length),
          borderWidth:2,borderColor:'white',hoverOffset:8}]},
        options:{responsive:true,maintainAspectRatio:false,
          cutout:'55%',
          _centerText:_fmtM(vendorTotal)+'원',
          plugins:{legend:{position:'right',
            labels:{font:{size:10,weight:'600'},boxWidth:10,padding:8,
              generateLabels(chart){
                const ds=chart.data.datasets[0]; const tot=ds.data.reduce((s,v)=>s+v,0)
                return chart.data.labels.map((lbl,i)=>{
                  const pct=tot>0?Math.round(ds.data[i]/tot*100):0
                  return{text:`${pct}% ${lbl}`,fillStyle:COLORS[i]||'#64748b',strokeStyle:'white',lineWidth:1,index:i}
                })
              }
            }
          }}
        }
      },[centerPlugin, slicePlugin])
    })()

    // ── PAGE 6: 식수 현황 가로 바 (두께 40px, 명수 레이블 강화) ────
    ;(()=>{
      const mealColors = ['#064e3b','#1d4ed8','#9333ea','#f97316','#ef4444','#0891b2']
      let catList = []
      if (rptCatMeals.length > 0) {
        catList = rptCatMeals
      } else {
        const ms = summaryData?.mealStats||{}
        if ((ms.total_patient||0)>0)   catList.push({name:'환자식',   count:ms.total_patient})
        if ((ms.total_staff||0)>0)     catList.push({name:'직원식',   count:ms.total_staff})
        if ((ms.total_guardian||0)>0)  catList.push({name:'보호자식', count:ms.total_guardian})
        if ((ms.total_noncovered||0)>0)catList.push({name:'비급여',   count:ms.total_noncovered})
      }
      if (!catList.length) { console.warn('[차트] rptWaterChart: 식수 데이터 없음'); return }
      const waterLabel = {
        id:'_waterLabel',
        afterDatasetsDraw(chart){
          const {ctx}=chart
          chart.data.datasets.forEach((ds,di)=>{
            const meta=chart.getDatasetMeta(di)
            meta.data.forEach((bar,i)=>{
              const val=ds.data[i]; if(!val||val===0) return
              ctx.save()
              ctx.font='bold 12px sans-serif'; ctx.fillStyle='#1f2937'
              ctx.textAlign='left'; ctx.textBaseline='middle'
              ctx.fillText(val.toLocaleString()+'명', bar.x+8, bar.y)
              ctx.restore()
            })
          })
        }
      }
      SC('rptWaterChart',{
        type:'bar',
        data:{
          labels:catList.map(c=>c.name),
          datasets:[{label:'식수(명)',data:catList.map(c=>c.count),
            backgroundColor:mealColors.slice(0,catList.length).map(c=>_hex2r(c,0.8)),
            borderRadius:6,borderWidth:0,barThickness:40}]
        },
        options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',
          layout:{padding:{right:80}},
          plugins:{legend:{display:false},
            tooltip:{callbacks:{label:(ctx)=>`${ctx.parsed.x.toLocaleString()}명`}}},
          scales:{x:{ticks:{callback:v=>`${v.toLocaleString()}명`,font:{size:10},color:'#374151'},
                     grid:{color:'rgba(0,0,0,0.06)'},beginAtZero:true},
                 y:{ticks:{font:{size:12,weight:'bold'},color:'#1f2937'}}}
        }
      },[waterLabel])
    })()

    // ── PAGE 7: 월별 식수 추이 누적 막대 차트 (카테고리별 세분화) ──
    ;(()=>{
      const el = document.getElementById('rptMonthlyMealChart')
      if (!el) return
      const mMonths = Array.from({length:12},(_,i)=>`${i+1}월`)
      const curIdx = reportMonth - 1
      // 카테고리 + 직원 + 보호자 합쳐서 datasets 구성
      const catColors7 = ['#10b981','#3b82f6','#8b5cf6','#f59e0b','#ef4444','#0891b2','#ec4899']
      const allSeries = [
        ...(rptAnnualCats||[]).map((cat,ci) => ({
          label: cat.category_name,
          color: catColors7[ci % catColors7.length],
          data: Array.from({length:12}, (_,i) => (rptMonthCatMeals[String(i+1)]?.[`cat_${cat.category_key}`]) || 0)
        })),
        { label:'직원', color:'#6366f1', data: Array.from({length:12}, (_,i) => (rptMonthCatMeals[String(i+1)]?.staff) || 0) },
        { label:'보호자', color:'#f97316', data: Array.from({length:12}, (_,i) => (rptMonthCatMeals[String(i+1)]?.guardian) || 0) }
      ].filter(s => s.data.some(v=>v>0))
      // 데이터 없으면 mealMonthly 폴백 (기존 방식)
      if (allSeries.length === 0) {
        const mMeals = Array.from({length:12},(_,i)=>{ const row=(rptMonthlyMeals||[]).find(r=>parseInt(r.month)===i+1); return row?parseInt(row.total_meals||0):0 })
        SC('rptMonthlyMealChart',{
          type:'bar', data:{ labels:mMonths,
            datasets:[{label:'월별 식수', data:mMeals, backgroundColor:mMonths.map((_,i)=>i===curIdx?'rgba(6,78,59,0.9)':'rgba(6,78,59,0.45)'), borderRadius:5, barThickness:28}]
          },
          options:{responsive:true,maintainAspectRatio:false,layout:{padding:{top:20}},
            plugins:{legend:{display:false}},
            scales:{y:{ticks:{callback:v=>`${v.toLocaleString()}명`,font:{size:10}},grid:{color:'rgba(0,0,0,0.06)'},beginAtZero:true},x:{ticks:{font:{size:10}}}}}
        },[])
        return
      }
      // 각 바 위에 합계 표시 플러그인
      const stackTotalLabel = {
        id:'_stackTotal',
        afterDatasetsDraw(chart) {
          const {ctx, data} = chart
          const lastDsIdx = data.datasets.length - 1
          const lastMeta = chart.getDatasetMeta(lastDsIdx)
          data.labels.forEach((_, i) => {
            const total = data.datasets.reduce((s,ds) => s + (ds.data[i]||0), 0)
            if (!total) return
            const bar = lastMeta.data[i]
            ctx.save()
            ctx.font = `bold ${i===curIdx?'11':'10'}px sans-serif`
            ctx.fillStyle = i===curIdx ? '#064e3b' : '#374151'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'bottom'
            ctx.fillText(total.toLocaleString()+'명', bar.x, bar.y - 3)
            ctx.restore()
          })
        }
      }
      SC('rptMonthlyMealChart', {
        type: 'bar',
        data: {
          labels: mMonths,
          datasets: allSeries.map((s,si) => ({
            label: s.label,
            data: s.data,
            backgroundColor: s.data.map((_,i) => i===curIdx ? s.color : s.color+'bb'),
            borderRadius: si===allSeries.length-1 ? 5 : 0,
            borderSkipped: false,
            stack: 'meals',
            barThickness: 32
          }))
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          layout: { padding: { top: 24 } },
          plugins: {
            legend: {
              position: 'top',
              labels: { font: { size: 11, weight: '600' }, boxWidth: 12, padding: 10, color: '#1f2937' }
            },
            tooltip: {
              callbacks: {
                label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString()}명`
              }
            }
          },
          scales: {
            y: { stacked: true, ticks: { callback: v=>`${v.toLocaleString()}명`, font:{size:10}, color:'#374151' }, grid:{color:'rgba(0,0,0,0.06)'}, beginAtZero: true },
            x: { stacked: true, ticks: { font:{size:10}, color:'#374151' } }
          }
        }
      }, [stackTotalLabel])
    })()

    // ── PAGE 8: 식단가 라인 차트 + 불릿 (포인트 값, 숫자 명확) ────
    ;(()=>{
      const mMonths = Array.from({length:12},(_,i)=>`${i+1}월`)
      const mUsed = Array(12).fill(0); (annualData?.monthly||[]).forEach(m=>{ mUsed[parseInt(m.month)-1]=m.total_used||0 })
      const mMeals= Array(12).fill(0); (annualData?.mealMonthly||[]).forEach(m=>{ mMeals[parseInt(m.month)-1]=(m.total_meals||m.total_patient||0) })
      const mTgt  = Array(12).fill(0); (annualData?.settings||[]).forEach(m=>{ mTgt[m.month-1]=m.meal_price||0 })
      const mMp   = mMeals.map((v,i)=>v>0?Math.round(mUsed[i]/v):null)
      const pricePtLabel = {
        id:'_pricePt',
        afterDatasetsDraw(chart){
          const {ctx,data}=chart
          data.datasets.forEach((ds,di)=>{
            if(ds.borderDash&&ds.borderDash.length) return  // 목표선 스킵
            const meta=chart.getDatasetMeta(di)
            meta.data.forEach((pt,i)=>{
              const val=ds.data[i]; if(!val||val===0) return
              ctx.save()
              ctx.font='bold 10px sans-serif'; ctx.fillStyle='#1e40af'
              ctx.textAlign='center'; ctx.textBaseline='bottom'
              ctx.fillText((val/1000).toFixed(1)+'천원', pt.x, pt.y-5)
              ctx.restore()
            })
          })
        }
      }
      SC('rptMealPriceChart',{
        type:'line',
        data:{labels:mMonths,datasets:[
          {label:'식단가(원/식)',data:mMp,
           borderColor:'#2563eb',backgroundColor:'rgba(37,99,235,0.08)',
           fill:true,tension:0.35,borderWidth:2.5,
           pointRadius:5,pointBackgroundColor:'#2563eb',pointBorderColor:'white',pointBorderWidth:2},
          {label:`목표 ${_tp>0?_fmt(_tp)+'원':''}`,data:mTgt.map(v=>v||null),
           borderColor:'#ef4444',borderWidth:2,pointRadius:0,fill:false,borderDash:[7,4]}
        ]},
        options:{responsive:true,maintainAspectRatio:false,
          layout:{padding:{top:22}},
          plugins:{legend:{labels:{font:{size:11,weight:'600'},boxWidth:12}}},
          scales:{y:{ticks:{callback:v=>`${(v/1000).toFixed(1)}천원`,font:{size:10},color:'#374151'},
                     grid:{color:'rgba(0,0,0,0.06)'}},
                 x:{ticks:{font:{size:10},color:'#374151'}}}
        }
      },[pricePtLabel])
      // Bullet 차트 (숫자 명확)
      const bulletLabel = {
        id:'_bulletLabel',
        afterDatasetsDraw(chart){
          if(chart.data.datasets.length<2) return
          const {ctx}=chart
          const meta=chart.getDatasetMeta(1)
          if(!meta.data[0]) return
          const bar=meta.data[0]
          ctx.save()
          ctx.font='bold 13px sans-serif'
          ctx.fillStyle=_mp>_tp*1.1?'#dc2626':_mp>_tp?'#d97706':'#16a34a'
          ctx.textAlign='left'; ctx.textBaseline='middle'
          ctx.fillText(_fmt(_mp)+'원', bar.x+8, bar.y)
          ctx.restore()
        }
      }
      if(_tp>0) SC('rptBulletChart',{
        type:'bar',
        data:{labels:['식단가 현황'],datasets:[
          {label:`목표(${_fmt(_tp)}원)`,data:[_tp],backgroundColor:'rgba(16,185,129,0.2)',
           borderColor:'#10b981',borderWidth:1.5,barThickness:28},
          {label:'현재',data:[_mp],
           backgroundColor:_mp>_tp*1.1?'rgba(220,38,38,0.85)':_mp>_tp?'rgba(217,119,6,0.85)':'rgba(22,163,74,0.85)',
           borderWidth:0,barThickness:14}
        ]},
        options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
          layout:{padding:{right:100}},
          plugins:{legend:{labels:{font:{size:10,weight:'600'},boxWidth:10}}},
          scales:{x:{ticks:{callback:v=>`${(v/1000).toFixed(0)}천원`,font:{size:10}},
                     max:Math.max(_tp,_mp)*1.4,min:0},
                 y:{ticks:{font:{size:11,weight:'bold'},color:'#1f2937'}}}
        }
      },[bulletLabel])
    })()

    // ── PAGE 9: 예산 소진 Burn-down (범례 굵게, 소비율 표시) ──────
    ;(()=>{
      if(!_tot) return
      const days = Array.from({length:_days},(_,i)=>i+1)
      let cum=0
      const actCum = days.map(d=>{
        const found = rptDailyAll.find(r=>parseInt(r.day)===d)
        cum += (found?.amount||0)
        return d<=_ela&&cum>0?cum:null
      })
      const idealLine = days.map(d=>Math.round(_tot/_days*d))
      const trendLine = days.map(d=>d<_ela?null:_davg>0?Math.round(_davg*d):null)
      const burnEndLabel = {
        id:'_burnEnd',
        afterDatasetsDraw(chart){
          const {ctx,data}=chart
          const ds=data.datasets[0]
          const meta=chart.getDatasetMeta(0)
          let lastIdx=-1
          ds.data.forEach((v,i)=>{ if(v!=null) lastIdx=i })
          if(lastIdx<0) return
          const pt=meta.data[lastIdx]
          const val=ds.data[lastIdx]
          const pct=_tot>0?Math.round(val/_tot*100):0
          ctx.save()
          ctx.font='bold 11px sans-serif'; ctx.fillStyle='#1d4ed8'
          ctx.textAlign='left'; ctx.textBaseline='middle'
          ctx.fillText(pct+'% 소비', pt.x+6, pt.y)
          ctx.restore()
        }
      }
      SC('rptBudgetBurnChart',{
        type:'line',
        data:{labels:days.map(d=>`${d}일`),datasets:[
          {label:'실적 누적',data:actCum,
           borderColor:'#1d4ed8',backgroundColor:'rgba(29,78,216,0.12)',
           fill:true,tension:0.3,pointRadius:0,spanGaps:false,borderWidth:2.5},
          {label:'예측 추세',data:trendLine,
           borderColor:'#f59e0b',fill:false,tension:0.3,
           pointRadius:0,spanGaps:false,borderDash:[6,4],borderWidth:2},
          {label:'이상적 사용',data:idealLine,
           borderColor:'#10b981',fill:false,pointRadius:0,borderDash:[3,3],borderWidth:1.5},
          {label:'예산 한도',data:Array(_days).fill(_tot),
           borderColor:'#ef4444',fill:false,pointRadius:0,borderDash:[9,4],borderWidth:2}
        ]},
        options:{responsive:true,maintainAspectRatio:false,
          layout:{padding:{right:70}},
          plugins:{legend:{labels:{
            font:{size:11,weight:'600'},boxWidth:14,padding:10,color:'#1f2937'
          }}},
          scales:{y:{ticks:{callback:v=>`${(v/1e6).toFixed(1)}백만`,font:{size:10},color:'#374151'},
                     grid:{color:'rgba(0,0,0,0.06)'},beginAtZero:true},
                 x:{ticks:{font:{size:9},color:'#374151'}}}
        }
      },[burnEndLabel])
    })()

    // ── PAGE 10: 법인카드 파이 차트 ────────────────────────────
    ;(()=>{
      if(!rptCardBySubtype.length) return
      const sorted = [...rptCardBySubtype].sort((a,b)=>b.total-a.total)
      const cardTotal = rptCardExpenses.reduce((s,e)=>s+(e.amount||0),0)
      SC('rptCardPieChart',{
        type:'doughnut',
        data:{labels:sorted.map(s=>s.label),
          datasets:[{data:sorted.map(s=>s.total),
            backgroundColor:['#16a34a','#1d4ed8','#7c3aed','#d97706','#dc2626','#0891b2','#ec4899'].map(c=>_hex2r(c,0.8)),
            borderWidth:2,borderColor:'white'}]
        },
        options:{responsive:true,maintainAspectRatio:false,_centerText:_fmtM(cardTotal),
          plugins:{legend:{position:'bottom',labels:{font:{size:9.5},boxWidth:8,padding:6}}}
        }
      },[centerPlugin])
    })()

    // ── 마지막 페이지: 종합 점수 레이더 ───────────────────────
    ;(()=>{
      const progress = _prog
      const topVR = _used>0&&rptOrders.length>0?Math.round((rptOrders[0]?.totalAmount||0)/_used*100):0
      const sItemsFull = [
        {label:'예산 관리',val:progress>=80&&progress<=90?95:progress>=70&&progress<80?75:progress>=90?80:55},
        {label:'식단가 관리',val:_tp>0?(_mp<=_tp?90:_mp<=_tp*1.05?75:_mp<=_tp*1.1?60:45):70},
        {label:'발주 관리',val:topVR<40?90:topVR<60?70:50},
        {label:'식수 안정성',val:(_s.totalPatients||0)>0?80:50},
        {label:'잔반 관리',val:60}
      ]
      // rptScoreChart: flex:1 컨테이너 높이 계산 후 차트 렌더
      ;(()=>{
        const scoreEl = document.getElementById('rptScoreChart')
        if (scoreEl) {
          const parentCard = scoreEl.parentElement
          if (parentCard && parentCard.offsetHeight > 0) {
            const titleEl = parentCard.querySelector('div')
            const titleH = titleEl ? titleEl.offsetHeight + 16 : 48
            const chartH = Math.max(180, parentCard.offsetHeight - titleH - 28)
            scoreEl.style.height = chartH + 'px'
            scoreEl.style.flex = 'none'
          }
        }
      })()
      SC('rptScoreChart',{
        type:'radar',
        data:{labels:sItemsFull.map(s=>s.label),datasets:[{
          label:'운영 점수',data:sItemsFull.map(s=>s.val),
          backgroundColor:'rgba(6,78,59,0.15)',borderColor:'#064e3b',borderWidth:2,
          pointBackgroundColor:'#064e3b',pointRadius:4,fill:true
        }]},
        options:{responsive:true,maintainAspectRatio:false,
          plugins:{legend:{display:false}},
          scales:{r:{min:0,max:100,ticks:{stepSize:25,font:{size:8}},
            pointLabels:{font:{size:9.5,weight:'bold'}},grid:{color:'rgba(0,0,0,0.08)'}}}
        }
      })
    })()

    // ── PAGE 7: 월별 식단가 추이 차트 ─────────────────────────────
    ;(()=>{
      const mUsed2 = Array(12).fill(0); (annualData?.monthly||[]).forEach(m=>{ mUsed2[parseInt(m.month)-1]=m.total_used||0 })
      const mMeals2= Array(12).fill(0); (annualData?.mealMonthly||[]).forEach(m=>{ mMeals2[parseInt(m.month)-1]=(m.total_meals||m.total_patient||0) })
      const mTgt2  = Array(12).fill(0); (annualData?.settings||[]).forEach(m=>{ mTgt2[m.month-1]=m.meal_price||0 })
      const mActual= Array(12).fill(null).map((_,i)=>mUsed2[i]>0&&mMeals2[i]>0?Math.round(mUsed2[i]/mMeals2[i]):null)
      const months12 = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']
      SC('rptMealPriceTrendChart',{
        type:'line',
        data:{labels:months12, datasets:[
          {label:'실제 식단가',data:mActual,borderColor:'#7c3aed',backgroundColor:'rgba(124,58,237,0.1)',
           borderWidth:2.5,pointRadius:4,pointBackgroundColor:'#7c3aed',fill:true,tension:0.3,spanGaps:true},
          {label:'목표 식단가',data:mTgt2.map(v=>v>0?v:null),borderColor:'#dc2626',backgroundColor:'transparent',
           borderWidth:2,borderDash:[6,4],pointRadius:3,pointBackgroundColor:'#dc2626',fill:false,spanGaps:true}
        ]},
        options:{responsive:true,maintainAspectRatio:false,
          plugins:{legend:{display:true,position:'top',labels:{font:{size:10},boxWidth:14}}},
          scales:{x:{ticks:{font:{size:9}},grid:{display:false}},
                  y:{ticks:{font:{size:9},callback:v=>v.toLocaleString()+'원'},grid:{color:'rgba(0,0,0,0.05)'}}}
        }
      },[ptLabelPlugin])
    })()

    // ── PAGE 8: 월별 업체별 발주 금액 추이 (stacked bar) ──────────
    ;(()=>{
      const vMonthly = annualData?.vendorMonthly || []
      const months12b = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']
      const vColors = ['#10b981','#3b82f6','#8b5cf6','#f59e0b','#ef4444']
      if (vMonthly.length > 0) {
        SC('rptVendorMonthlyChart',{
          type:'bar',
          data:{labels:months12b, datasets:vMonthly.slice(0,5).map((v,i)=>({
            label:v.vendor_name||('업체'+(i+1)),
            data:v.monthly||Array(12).fill(0),
            backgroundColor:vColors[i]+'cc',borderRadius:3,borderSkipped:false,stack:'v'
          }))},
          options:{responsive:true,maintainAspectRatio:false,
            plugins:{legend:{display:true,position:'top',labels:{font:{size:9},boxWidth:12}}},
            scales:{x:{stacked:true,ticks:{font:{size:9}},grid:{display:false}},
                    y:{stacked:true,ticks:{font:{size:9},callback:v=>(v/10000).toFixed(0)+'만'},grid:{color:'rgba(0,0,0,0.05)'}}}
          }
        })
      } else {
        const mUsedFall = Array(12).fill(0); (annualData?.monthly||[]).forEach(m=>{ mUsedFall[parseInt(m.month)-1]=m.total_used||0 })
        SC('rptVendorMonthlyChart',{
          type:'bar',
          data:{labels:months12b, datasets:[{label:'총 발주액',data:mUsedFall,backgroundColor:'#3b82f6cc',borderRadius:3}]},
          options:{responsive:true,maintainAspectRatio:false,
            plugins:{legend:{display:true,position:'top',labels:{font:{size:9}}}},
            scales:{x:{ticks:{font:{size:9}},grid:{display:false}},
                    y:{ticks:{font:{size:9},callback:v=>(v/10000).toFixed(0)+'만'},grid:{color:'rgba(0,0,0,0.05)'}}}
          }
        })
      }
    })()

    // ── PAGE 9: 월별 총 발주 금액 추이 ────────────────────────────
    ;(()=>{
      const mUsed3 = Array(12).fill(0); (annualData?.monthly||[]).forEach(m=>{ mUsed3[parseInt(m.month)-1]=m.total_used||0 })
      const months12c = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']
      const barColors3 = mUsed3.map((_,i)=>i===reportMonth-1?'#064e3b':'#10b981aa')
      SC('rptMonthlyTotalChart',{
        type:'bar',
        data:{labels:months12c, datasets:[
          {label:'월별 발주액',data:mUsed3,backgroundColor:barColors3,borderRadius:4,yAxisID:'y',order:2},
          {label:'추이선',data:mUsed3.map(v=>v>0?v:null),borderColor:'#1d4ed8',borderWidth:2,
           type:'line',pointRadius:4,pointBackgroundColor:'#1d4ed8',fill:false,
           yAxisID:'y',order:1,spanGaps:true,tension:0.3}
        ]},
        options:{responsive:true,maintainAspectRatio:false,
          plugins:{legend:{display:true,position:'top',labels:{font:{size:9},boxWidth:12}},_showBarLabels:true},
          scales:{x:{ticks:{font:{size:9}},grid:{display:false}},
                  y:{ticks:{font:{size:9},callback:v=>(v/10000).toFixed(0)+'만'},grid:{color:'rgba(0,0,0,0.05)'}}}
        }
      },[barLabelPlugin,ptLabelPlugin])
    })()

    // ── PAGE 10: 일별 발주 금액 bar ──────────────────────────────
    ;(()=>{
      const dCnt2 = _days
      const dLabels2 = Array.from({length:dCnt2},(_,i)=>`${i+1}`)
      const dailyMap2 = {}
      ;(summaryData?.dailyOrders||[]).forEach(d=>{ const day=parseInt(d.order_date.split('-')[2]); dailyMap2[day]=(dailyMap2[day]||0)+d.daily_total })
      const dVals2 = Array.from({length:dCnt2},(_,i)=>dailyMap2[i+1]||0)
      const dAvg2 = dVals2.filter(v=>v>0).reduce((s,v,_,a)=>s+v/a.length,0)||0
      const dColors2 = dVals2.map(v=>v>dAvg2*1.5?'#dc2626':v>0?'#3b82f6':'#e5e7eb')
      SC('rptDailyOrderChart',{
        type:'bar',
        data:{labels:dLabels2, datasets:[
          {label:'일별 발주액',data:dVals2,backgroundColor:dColors2,borderRadius:3},
          {label:'일평균',data:Array(dCnt2).fill(dAvg2>0?Math.round(dAvg2):null),borderColor:'#d97706',
           borderWidth:2,borderDash:[5,4],type:'line',pointRadius:0,fill:false,order:0}
        ]},
        options:{responsive:true,maintainAspectRatio:false,
          plugins:{legend:{display:true,position:'top',labels:{font:{size:9},boxWidth:12}}},
          scales:{x:{ticks:{font:{size:8},maxRotation:0},grid:{display:false}},
                  y:{ticks:{font:{size:9},callback:v=>(v/10000).toFixed(0)+'만'},grid:{color:'rgba(0,0,0,0.05)'}}}
        }
      })
    })()

    // ── PAGE 12: 잔반 분석 차트 (dual-axis) ──────────────────────
    ;(()=>{
      const fwData = annualData?.foodWasteMonthly || []
      if (fwData.length === 0) return
      const months12d = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']
      const fwKg   = Array(12).fill(0); fwData.forEach(r=>{ fwKg[parseInt(r.month)-1]=parseFloat(r.total_kg||r.totalL||0) })
      const fwCost = Array(12).fill(0); fwData.forEach(r=>{ fwCost[parseInt(r.month)-1]=parseInt(r.total_cost||r.totalCost||0) })
      SC('rptFoodWasteChart',{
        type:'bar',
        data:{labels:months12d, datasets:[
          {label:'잔반량(L)',data:fwKg.map(v=>v>0?v:null),backgroundColor:'rgba(245,158,11,0.7)',
           borderRadius:4,yAxisID:'y',order:2},
          {label:'잔반비용',data:fwCost.map(v=>v>0?v:null),borderColor:'#f97316',borderWidth:2.5,
           type:'line',pointRadius:4,pointBackgroundColor:'#f97316',fill:false,
           yAxisID:'y1',order:1,spanGaps:true,tension:0.3}
        ]},
        options:{responsive:true,maintainAspectRatio:false,
          plugins:{legend:{display:true,position:'top',labels:{font:{size:9},boxWidth:12}}},
          scales:{
            x:{ticks:{font:{size:9}},grid:{display:false}},
            y:{position:'left',ticks:{font:{size:9},callback:v=>v+'kg'},grid:{color:'rgba(0,0,0,0.05)'}},
            y1:{position:'right',ticks:{font:{size:9},callback:v=>(v/10000).toFixed(0)+'만원'},grid:{drawOnChartArea:false}}
          }
        }
      },[barLabelPlugin,ptLabelPlugin])
    })()

  } catch(chartErr) {
    console.warn('[보고서] 차트 렌더링 오류:', chartErr)
  }
  }) // inner requestAnimationFrame
  }, 100)  // setTimeout 100ms - DOM 완전 렌더링 대기
  // 페이지 번호 배지 추가 (차트와 별도)
  setTimeout(() => {
  requestAnimationFrame(() => {
    const reportBody = document.getElementById('reportBody')
    if (!reportBody) return
    const slides = reportBody.querySelectorAll('.report-slide')
    slides.forEach((slide, i) => {
      if (i === 0) return // 표지는 제외
      const h2 = slide.querySelector('h2.report-slide-title')
      if (!h2) return
      // 이미 개선된 경우 건너뜀
      if (slide.querySelector('.rpt-page-badge')) return
      const badge = document.createElement('div')
      badge.className = 'rpt-page-badge'
      badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;background:#064e3b;color:white;border-radius:6px;font-size:11px;font-weight:800;margin-right:8px;flex-shrink:0;vertical-align:middle'
      badge.textContent = i + 1
      h2.style.cssText = 'display:flex;align-items:center;font-size:15px;font-weight:700;color:#1f2937;padding-bottom:10px;border-bottom:2px solid #f0fdf4;margin-bottom:16px'
      h2.insertBefore(badge, h2.firstChild)
    })
  }) // requestAnimationFrame
  }, 200) // setTimeout 200ms
}

// 캔버스를 고화질 PNG DataURL로 변환 (devicePixelRatio 4배 적용)
function canvasToHiResPng(canvas) {
  if (!canvas) return null
  try {
    const srcW = (canvas.offsetWidth  > 0 ? canvas.offsetWidth  : canvas.width)  || 300
    const srcH = (canvas.offsetHeight > 0 ? canvas.offsetHeight : canvas.height) || 200
    const scale = 4
    const off = document.createElement('canvas')
    off.width  = srcW * scale
    off.height = srcH * scale
    const ctx2 = off.getContext('2d')
    ctx2.imageSmoothingEnabled = true
    ctx2.imageSmoothingQuality = 'high'
    ctx2.fillStyle = '#ffffff'
    ctx2.fillRect(0, 0, off.width, off.height)
    ctx2.scale(scale, scale)
    ctx2.drawImage(canvas, 0, 0, srcW, srcH)
    return off.toDataURL('image/png', 1.0)
  } catch(e) {
    return canvas.toDataURL('image/png', 1.0)
  }
}

// ══════════════════════════════════════════════════════════════════
//  보고서 슬라이드 캡처 시스템
//  - html2canvas로 화면에 렌더링된 원본 슬라이드를 직접 캡처
//  - 캡처 결과를 window._rptImgCache에 저장하여 미리보기/인쇄/PPT 재사용
//  - 각 슬라이드의 실제 높이 비율을 보존하여 짤림/늘어남 방지
// ══════════════════════════════════════════════════════════════════

// html2canvas CDN 로드 (공통)
async function _loadHtml2Canvas() {
  if (window.html2canvas) return
  await new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'
    s.onload = resolve; s.onerror = reject
    document.head.appendChild(s)
  })
}

// PptxGenJS CDN 로드 (공통)
async function _loadPptxGenJS() {
  if (window.PptxGenJS) return
  await new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js'
    s.onload = resolve; s.onerror = reject
    document.head.appendChild(s)
  })
}

// 슬라이드 캡처 캐시: { imgData, naturalW, naturalH }[]
window._rptImgCache = []
window._rptImgCacheKey = ''  // 마지막 캡처한 병원+년월 키

/**
 * 보고서 슬라이드 전체를 html2canvas로 캡처하여 캐시에 저장
 * ─ 핵심: x/y 좌표 방식 X → 슬라이드를 offscreen 컨테이너에 복사 후 캡처
 *         (뷰포트 밖이어도 100% 캡처 성공)
 */
async function _captureAllSlides(slides, onProgress) {
  await _loadHtml2Canvas()
  const cache = []

  // 16:9 고정 해상도 (1920×1080 기준)
  const SNAP_W = 1920
  const SNAP_H = 1080  // 16:9 고정

  const snapWrap = document.createElement('div')
  snapWrap.style.cssText = [
    'position:fixed',
    'top:0', 'left:-9999px',
    `width:${SNAP_W}px`,
    `height:${SNAP_H}px`,
    'z-index:-1',
    'pointer-events:none',
    'overflow:hidden',
    'background:white'
  ].join(';')
  document.body.appendChild(snapWrap)

  for (let i = 0; i < slides.length; i++) {
    if (onProgress) onProgress(i + 1, slides.length)

    const slide    = slides[i]
    const isCover  = i === 0

    // 슬라이드를 offscreen 컨테이너에 복제 (정확히 1920×1080 크기로)
    const clone = slide.cloneNode(true)
    clone.style.cssText = [
      `width:${SNAP_W}px`,
      `min-height:${SNAP_H}px`,
      `height:${SNAP_H}px`,
      'margin:0', 'padding:0',
      'border-radius:0', 'box-shadow:none',
      'box-sizing:border-box',
      'overflow:hidden',
      'background:white',
      'display:flex',
      'flex-direction:column'
    ].join(';')

    // canvas → 고화질 img 교체 (원본 canvas 데이터 사용)
    const origCanvases  = slide.querySelectorAll('canvas')
    const cloneCanvases = clone.querySelectorAll('canvas')
    origCanvases.forEach((origC, ci) => {
      try {
        const imgEl = document.createElement('img')
        imgEl.src = canvasToHiResPng(origC) || origC.toDataURL('image/png')
        const srcH = origC.offsetHeight > 0 ? origC.offsetHeight : (origC.height || 200)
        imgEl.style.cssText = `width:100%;height:auto;min-height:${srcH}px;display:block;`
        if (cloneCanvases[ci]) cloneCanvases[ci].replaceWith(imgEl)
      } catch(e) {}
    })

    snapWrap.innerHTML = ''
    snapWrap.appendChild(clone)

    // 이미지 로드 대기 + 레이아웃 안정화
    await new Promise(r => setTimeout(r, 300))

    let imgData   = null
    let capturedW = SNAP_W
    let capturedH = SNAP_H

    try {
      const cvs = await window.html2canvas(clone, {
        scale:           2,
        useCORS:         true,
        allowTaint:      true,
        backgroundColor: '#ffffff',
        scrollX:         0,
        scrollY:         0,
        windowWidth:     SNAP_W,
        windowHeight:    SNAP_H,
        width:           SNAP_W,
        height:          SNAP_H,
        logging:         false
      })
      imgData    = cvs.toDataURL('image/png', 1.0)
      capturedW  = SNAP_W
      capturedH  = SNAP_H
    } catch(e) {
      console.warn(`슬라이드 ${i+1} 캡처 실패:`, e)
    }

    cache.push({ imgData, naturalW: capturedW, naturalH: capturedH })
  }

  snapWrap.remove()
  return cache
}

// ── A4 문서형 인쇄 함수 ────────────────────────────────────────
// 각 슬라이드를 html2canvas로 직접 캡처한 이미지를 printLayer에 삽입
// → 화면에 보이는 것과 100% 동일하게 출력, 짤림/늘어남 없음
window.printReportA4 = async function() {
  const reportBody = document.getElementById('reportBody')
  if (!reportBody) { showToast('보고서를 먼저 불러오세요', 'warning'); return }

  const slides = reportBody.querySelectorAll('.report-slide')
  if (slides.length === 0) { showToast('출력할 슬라이드가 없습니다', 'warning'); return }

  showToast('인쇄 준비 중... 잠시 기다려주세요', 'warning')

  // 캡처
  const cache = await _captureAllSlides(Array.from(slides), (cur, tot) => {
    showToast(`인쇄 준비 중... (${cur}/${tot}페이지)`, 'warning')
  })

  // 기존 printLayer 제거
  const existing = document.getElementById('printLayer')
  if (existing) existing.remove()

  const layer = document.createElement('div')
  layer.id = 'printLayer'
  layer.setAttribute('aria-hidden', 'true')

  cache.forEach(({ imgData, naturalW, naturalH }, idx) => {
    const page = document.createElement('div')
    page.className = 'print-page'
    // 이미지 비율을 100% 유지하여 짤림 방지
    // print-page는 @media print에서 page-break-after:always
    page.style.cssText = 'width:100%;margin:0;padding:0;box-sizing:border-box;position:relative;'

    if (imgData) {
      const img = document.createElement('img')
      img.src = imgData
      // 가로 100% + 비율 유지(height:auto) → 절대 짤리지 않음
      img.style.cssText = 'width:100%;height:auto;display:block;max-width:100%;'
      page.appendChild(img)
    } else {
      page.style.background = '#f9fafb'
      page.innerHTML = `<div style="padding:40px;text-align:center;color:#9ca3af;font-size:14px;">페이지 ${idx+1} 캡처 실패</div>`
    }
    layer.appendChild(page)
  })

  document.body.appendChild(layer)

  requestAnimationFrame(() => {
    window.print()
    const cleanup = () => {
      const l = document.getElementById('printLayer')
      if (l) l.remove()
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
    setTimeout(cleanup, 30000)
  })
}

// ── 인쇄 미리보기 모달 ─────────────────────────────────────────
window.showPrintPreview = async function() {
  const existing = document.getElementById('printPreviewModal')
  if (existing) existing.remove()

  const reportBody = document.getElementById('reportBody')
  if (!reportBody) { showToast('보고서를 먼저 불러오세요', 'warning'); return }

  const slides = Array.from(reportBody.querySelectorAll('.report-slide'))
  const totalPages = slides.length

  // 로딩 모달 먼저 표시
  const loadingModal = document.createElement('div')
  loadingModal.id = 'printPreviewModal'
  loadingModal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;'
  loadingModal.innerHTML = `
    <div style="background:#1f2937;border-radius:16px;padding:40px 60px;text-align:center;color:white;">
      <i class="fas fa-spinner fa-spin" style="font-size:32px;color:#60a5fa;margin-bottom:16px;display:block"></i>
      <div style="font-size:16px;font-weight:700;margin-bottom:8px">미리보기 준비 중...</div>
      <div id="ppLoadingText" style="font-size:13px;color:#9ca3af">슬라이드 캡처 중 (0/${totalPages})</div>
      <div style="margin-top:16px;background:#374151;border-radius:99px;height:6px;width:240px;overflow:hidden">
        <div id="ppLoadingBar" style="height:100%;width:0%;background:#3b82f6;border-radius:99px;transition:width 0.3s"></div>
      </div>
    </div>
  `
  document.body.appendChild(loadingModal)

  // 전체 캡처
  const cache = await _captureAllSlides(slides, (cur, tot) => {
    const txt = document.getElementById('ppLoadingText')
    const bar = document.getElementById('ppLoadingBar')
    if (txt) txt.textContent = `슬라이드 캡처 중 (${cur}/${tot})`
    if (bar) bar.style.width = `${Math.round(cur/tot*100)}%`
  })

  // 로딩 모달 제거 후 미리보기 모달 생성
  loadingModal.remove()

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
        <button onclick="document.getElementById('printPreviewModal').remove(); printReportA4()"
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
      <div id="ppPageDots" style="display:flex;gap:4px;flex-wrap:wrap;justify-content:center;max-width:700px;">
        ${cache.map((_,i) =>
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
      <div id="ppSlideContainer" style="box-shadow:0 8px 32px rgba(0,0,0,0.5);border-radius:8px;overflow:hidden;width:100%;max-width:960px;background:white;">
      </div>
    </div>
    <!-- 안내 문구 -->
    <div style="padding:8px;text-align:center;color:#9ca3af;font-size:11px;background:#111827;flex-shrink:0;">
      <i class="fas fa-info-circle mr-1"></i>
      인쇄/PDF 저장 시 모든 ${totalPages}페이지가 자동으로 출력됩니다. Chrome에서 최적 출력됩니다.
    </div>
  `
  document.body.appendChild(modal)

  // 캐시를 전역에 저장 (페이지 이동 시 재사용)
  window._ppImgCache  = cache
  window._ppCurrentPage = 0
  window._ppTotal       = totalPages

  _renderCachedPreviewPage(0)
}

function _renderCachedPreviewPage(idx) {
  const container = document.getElementById('ppSlideContainer')
  const pageInfo  = document.getElementById('ppPageInfo')
  const cache     = window._ppImgCache || []
  if (!container || !cache[idx]) return

  const { imgData, naturalW, naturalH } = cache[idx]

  container.innerHTML = ''
  // 컨테이너 너비에 맞게 비율 유지 (height:auto)
  if (imgData) {
    const img = document.createElement('img')
    img.src = imgData
    img.style.cssText = 'width:100%;height:auto;display:block;border-radius:8px;'
    container.appendChild(img)
  } else {
    container.innerHTML = `<div style="padding:60px;text-align:center;color:#9ca3af;font-size:14px;">페이지 ${idx+1} 캡처 실패</div>`
  }

  // 페이지 번호 배지
  const pgBadge = document.createElement('div')
  pgBadge.style.cssText = 'text-align:right;padding:6px 12px;font-size:10px;color:#9ca3af;background:#f9fafb;border-top:1px solid #e5e7eb;'
  pgBadge.textContent = `${idx+1} / ${window._ppTotal}`
  container.appendChild(pgBadge)

  if (pageInfo) pageInfo.textContent = `페이지 ${idx+1} / ${window._ppTotal}`

  // dot 버튼 상태
  cache.forEach((_,i) => {
    const dot = document.getElementById(`ppDot-${i}`)
    if (dot) dot.style.background = i===idx ? '#3b82f6' : '#374151'
  })

  // 이전/다음 버튼
  const prev = document.getElementById('ppPrevBtn')
  const next = document.getElementById('ppNextBtn')
  if (prev) prev.style.opacity = idx===0 ? '0.4' : '1'
  if (next) next.style.opacity = idx===window._ppTotal-1 ? '0.4' : '1'
}

window.changePrintPage = function(dir) {
  const newIdx = (window._ppCurrentPage || 0) + dir
  if (newIdx < 0 || newIdx >= (window._ppTotal || 0)) return
  window._ppCurrentPage = newIdx
  _renderCachedPreviewPage(newIdx)
}

window.jumpPrintPage = function(idx) {
  window._ppCurrentPage = idx
  _renderCachedPreviewPage(idx)
}

// ── PPT 저장 ─────────────────────────────────────────────────────
// 각 슬라이드를 html2canvas로 캡처 → 실제 비율로 PPT 슬라이드 크기 동적 설정
async function exportReportPPT(hospitalName, year, month) {
  const reportBody = document.getElementById('reportBody')
  if (!reportBody) { showToast('보고서를 먼저 불러오세요', 'warning'); return }

  const slides = Array.from(reportBody.querySelectorAll('.report-slide'))
  if (slides.length === 0) { showToast('슬라이드가 없습니다', 'warning'); return }

  showToast(`PPT 생성 중... (${slides.length}페이지 캡처 중)`, 'warning')

  await _loadPptxGenJS()

  // 전체 슬라이드 캡처
  const cache = await _captureAllSlides(slides, (cur, tot) => {
    showToast(`PPT 생성 중... (${cur}/${tot}페이지 캡처)`, 'warning')
  })

  showToast('PPT 파일 생성 중...', 'warning')

  // PPT 레이아웃: 16:9 고정 (1920×1080 기준 → 인치 변환)
  // 25.4cm × 14.2875cm = 10인치 × 5.625인치 (정확한 16:9)
  const PPT_W = 25.4 / 2.54   // 10인치
  const PPT_H = PPT_W * 0.5625  // 5.625인치 (16:9)

  const pptx = new window.PptxGenJS()
  // 모든 슬라이드 동일한 16:9 레이아웃
  pptx.defineLayout({ name: 'WIDESCREEN_16_9', width: PPT_W, height: PPT_H })
  pptx.layout = 'WIDESCREEN_16_9'

  for (let i = 0; i < cache.length; i++) {
    const { imgData } = cache[i]

    if (!imgData) {
      // 캡처 실패한 슬라이드: 빈 슬라이드 추가
      const s = pptx.addSlide()
      s.addText(`페이지 ${i+1} 캡처 실패`, { x:1, y:2, w:8, h:1, fontSize:16, color:'9CA3AF', align:'center' })
      continue
    }

    // 모든 슬라이드 동일한 16:9 크기 (이미지가 슬라이드 전체를 채움)
    const slide = pptx.addSlide()
    slide.addImage({ data: imgData, x: 0, y: 0, w: PPT_W, h: PPT_H, sizing: { type: 'contain', w: PPT_W, h: PPT_H } })
  }

  await pptx.writeFile({ fileName: `${hospitalName}_${year}년${month}월_보고서.pptx` })
  showToast(`PPT 저장 완료! (${slides.length}페이지)`, 'success')
}

// ══════════════════════════════════════════════════════════════════
//  A4 PDF 보고서 생성 (html2canvas + jsPDF)
//  10페이지 구조: 표지 / 운영요약 / 식단가분석 / 식수분석 /
//                발주분석 / 예산&잔반 / 비교분석 / 자동해석 / 지출결의 / 부록(식재료단가)
// ══════════════════════════════════════════════════════════════════
async function exportReportPDF(hospitalName, year, month) {
  showToast('A4 PDF 보고서 생성 중... (잠시 기다려 주세요)', 'info')

  // CDN 라이브러리 동적 로드
  async function loadScript(src) {
    if (document.querySelector(`script[src="${src}"]`)) return
    return new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = src; s.onload = resolve; s.onerror = reject
      document.head.appendChild(s)
    })
  }
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js')
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
  await new Promise(r => setTimeout(r, 500))

  const { jsPDF } = window.jspdf
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const A4_W = 210, A4_H = 297

  // 데이터 수집
  const summaryData = await api('GET', `/api/dashboard/summary/${year}/${month}?hospitalId=${window._adminHospitalId||''}`)
  const annualData  = await api('GET', `/api/dashboard/annual/${year}?hospitalId=${window._adminHospitalId||''}`)
  const wasteData   = await api('GET', `/api/settings/food-waste-summary/${year}/${month}?hospitalId=${window._adminHospitalId||''}`).catch(()=>null)
  const ingData     = await api('GET', `/api/settings/ingredient-prices/${year}/${month}?hospitalId=${window._adminHospitalId||''}`).catch(()=>[])

  const s      = summaryData?.summary || {}
  const ms     = summaryData?.mealStats || {}
  const proj   = summaryData
  const vendors = summaryData?.vendors || []
  const pm     = summaryData?.prevMonth || {}
  const anomalies = summaryData?.anomalies || []
  const autoAnalysis = summaryData?.autoAnalysis || []

  const monthlyUsed = annualData?.monthly || []
  const monthlyMeals = annualData?.mealMonthly || []
  const monthlySettings = annualData?.settings || []

  // 월별 데이터 배열 구성
  const mUsed = Array(12).fill(0); monthlyUsed.forEach(m=>{ mUsed[parseInt(m.month)-1]=m.total_used||0 })
  const monthCatMeals = annualData?.monthCatMeals || {}
  // mMeals: 커스텀 필드 포함한 정확한 월별 식수 (기존 total_patient 등 대신 커스텀 기반)
  const mMeals = Array(12).fill(0)
  monthlyMeals.forEach(m => {
    const mIdx = parseInt(m.month)-1
    const mStr = String(parseInt(m.month))
    const mCatData = monthCatMeals[mStr] || {}
    const catSum = Object.keys(mCatData).filter(k=>k!=='staff'&&k!=='guardian').reduce((s,k)=>s+(mCatData[k]||0),0)
    const staffSum = mCatData['staff'] || (m.total_staff||0)
    const guardSum = mCatData['guardian'] || (m.total_guardian||0)
    mMeals[mIdx] = catSum > 0 ? catSum + staffSum + guardSum : (m.total_patient||0)+(m.total_staff||0)+(m.total_guardian||0)
  })
  const mBudget = Array(12).fill(0); monthlySettings.forEach(m=>{ mBudget[parseInt(m.month)-1]=m.total_budget||0 })
  const mMp = mMeals.map((v,i)=>v>0?Math.round(mUsed[i]/v):0)
  const mTarget = Array(12).fill(0); monthlySettings.forEach(m=>{ mTarget[parseInt(m.month)-1]=m.meal_price||0 })

  // 숫자 포맷
  const fmtK = v => v>=100000000 ? (v/100000000).toFixed(1)+'억' : v>=10000 ? (v/10000).toFixed(0)+'만' : v.toLocaleString()
  const fmtW = v => (v||0).toLocaleString()+'원'
  const fmtPct = v => (v||0).toFixed(1)+'%'

  // 한글 지원 폰트 (Nanum Gothic base64 - 약식, 기본 한글 지원)
  // 실제로 jsPDF 한글은 별도 font 필요하므로 영문 대체 처리 후 canvas 방식 혼용

  // ── 페이지 생성 헬퍼 ──────────────────────────────────
  let pageNum = 0

  function addPage() {
    if (pageNum > 0) doc.addPage()
    pageNum++
    // 페이지 하단 페이지 번호
    doc.setFontSize(9); doc.setTextColor(150)
    doc.text(`${pageNum}`, A4_W/2, A4_H - 6, { align:'center' })
    doc.setTextColor(30)
  }

  // HTML 섹션을 캔버스로 캡처해서 PDF에 삽입하는 함수
  async function captureSection(elementId, doc, x, y, maxW, maxH) {
    const el = document.getElementById(elementId)
    if (!el) return 0
    // 캡처 직전 잠깐 visibility 해제 (html2canvas는 visibility:hidden 요소 캡처 안 됨)
    const container = document.getElementById('pdfTempContainer')
    if (container) container.style.visibility = 'visible'
    await new Promise(r => setTimeout(r, 100))
    const canvas = await html2canvas(el, { scale: 3, useCORS: true, logging: false, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0, windowWidth: 794, windowHeight: el.scrollHeight || 1123 })
    if (container) container.style.visibility = 'hidden'
    const imgData = canvas.toDataURL('image/jpeg', 0.92)
    const ratio = canvas.width / canvas.height
    let w = maxW, h = maxW / ratio
    if (h > maxH) { h = maxH; w = maxH * ratio }
    doc.addImage(imgData, 'JPEG', x, y, w, h)
    return h
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PAGE 1: 표지
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  addPage()
  // 배경
  doc.setFillColor(22, 101, 52)  // green-800
  doc.rect(0, 0, A4_W, A4_H, 'F')
  // 흰색 박스
  doc.setFillColor(255,255,255)
  doc.roundedRect(20, 60, 170, 160, 8, 8, 'F')
  // 텍스트
  doc.setFontSize(28); doc.setTextColor(22,101,52); doc.setFont('helvetica','bold')
  doc.text('Hospital Meal Report', A4_W/2, 100, { align:'center' })
  doc.setFontSize(14); doc.setTextColor(100)
  doc.text(hospitalName, A4_W/2, 116, { align:'center' })
  doc.setFontSize(36); doc.setTextColor(22,101,52)
  doc.text(`${year}.${String(month).padStart(2,'0')}`, A4_W/2, 150, { align:'center' })
  doc.setFontSize(12); doc.setTextColor(100)
  doc.text('Monthly Meal Management Report', A4_W/2, 168, { align:'center' })
  doc.setFontSize(10); doc.setTextColor(150)
  doc.text(`Generated: ${new Date().toLocaleDateString('ko-KR')}`, A4_W/2, 200, { align:'center' })

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PAGE 2: 운영 요약 (캔버스 캡처)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 임시 A4 렌더링 컨테이너 생성
  const pdfContainer = document.createElement('div')
  pdfContainer.id = 'pdfTempContainer'
  pdfContainer.style.cssText = 'position:absolute;left:0;top:-9999px;width:794px;background:white;font-family:sans-serif;z-index:-1;visibility:hidden'
  document.body.appendChild(pdfContainer)

  // 운영요약 페이지 HTML
  const totalBudget = s.totalBudget || 0
  const totalUsed = s.totalUsed || 0
  const remaining = s.remainingAmount || (totalBudget - totalUsed)
  const progress = totalBudget > 0 ? Math.round(totalUsed/totalBudget*100) : 0
  const mealPriceTotal = proj?.mealPriceTotal || 0
  const targetMealPrice = proj?.settings?.meal_price || 0
  const projectedMp = proj?.projectedMonthEndMealPrice || 0
  const depletionDate = proj?.budgetDepletionDate || null
  const totalMeals = proj?.totalMeals || 0

  pdfContainer.innerHTML = `
  <div id="pdf-page-summary" style="width:794px;padding:40px;background:white;box-sizing:border-box">
    <div style="border-bottom:3px solid #16a34a;padding-bottom:12px;margin-bottom:20px">
      <div style="font-size:11px;color:#16a34a;font-weight:600;letter-spacing:2px">MONTHLY REPORT</div>
      <div style="font-size:22px;font-weight:bold;color:#1f2937">${year}년 ${month}월 운영 요약</div>
      <div style="font-size:13px;color:#6b7280">${hospitalName}</div>
    </div>
    <!-- KPI 카드 4개 -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-bottom:20px">
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:10px;color:#16a34a;font-weight:600">총 예산</div>
        <div style="font-size:18px;font-weight:bold;color:#15803d">${fmtK(totalBudget)}원</div>
      </div>
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:10px;color:#ea580c;font-weight:600">사용금액</div>
        <div style="font-size:18px;font-weight:bold;color:#c2410c">${fmtK(totalUsed)}원</div>
        <div style="font-size:10px;color:#9a3412">${progress}%</div>
      </div>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:10px;color:#2563eb;font-weight:600">잔여예산</div>
        <div style="font-size:18px;font-weight:bold;color:#1d4ed8">${fmtK(remaining)}원</div>
      </div>
      <div style="background:#fdf4ff;border:1px solid #e9d5ff;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:10px;color:#9333ea;font-weight:600">총 식수</div>
        <div style="font-size:18px;font-weight:bold;color:#7e22ce">${totalMeals.toLocaleString()}식</div>
      </div>
    </div>
    <!-- 예산 진행바 -->
    <div style="background:#f9fafb;border-radius:8px;padding:14px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#374151;margin-bottom:6px">
        <span style="font-weight:600">예산 달성률</span>
        <span style="font-weight:700;color:${progress>100?'#dc2626':'#16a34a'}">${progress}%</span>
      </div>
      <div style="background:#e5e7eb;border-radius:4px;height:10px">
        <div style="background:${progress>100?'#dc2626':'#16a34a'};height:10px;border-radius:4px;width:${Math.min(progress,100)}%"></div>
      </div>
    </div>
    <!-- 식단가 / 예산소진예상일 -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
      <div style="background:#f9fafb;border-radius:8px;padding:14px">
        <div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:8px">식단가 현황</div>
        <table style="width:100%;font-size:11px;border-collapse:collapse">
          <tr><td style="color:#6b7280;padding:3px 0">현재 식단가</td><td style="text-align:right;font-weight:700;color:${mealPriceTotal>targetMealPrice&&targetMealPrice>0?'#dc2626':'#1f2937'}">${fmtW(mealPriceTotal)}</td></tr>
          <tr><td style="color:#6b7280;padding:3px 0">목표 식단가</td><td style="text-align:right;color:#6b7280">${fmtW(targetMealPrice)}</td></tr>
          <tr><td style="color:#6b7280;padding:3px 0">월말 예상 식단가</td><td style="text-align:right;font-weight:700;color:${projectedMp>targetMealPrice&&targetMealPrice>0?'#ea580c':'#2563eb'}">${fmtW(projectedMp)}</td></tr>
        </table>
      </div>
      <div style="background:#f9fafb;border-radius:8px;padding:14px">
        <div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:8px">예산 소진 예상</div>
        ${depletionDate ? `
        <div style="font-size:20px;font-weight:bold;color:${proj?.budgetDepletionStatus==='critical'?'#dc2626':proj?.budgetDepletionStatus==='warning'?'#ea580c':'#16a34a'};text-align:center;margin:8px 0">${depletionDate}</div>
        <div style="font-size:10px;color:#6b7280;text-align:center">예상 소진일</div>
        ` : `<div style="font-size:12px;color:#9ca3af;text-align:center;padding:12px">데이터 부족</div>`}
      </div>
    </div>
    <!-- 식수 현황 -->
    <div style="background:#f9fafb;border-radius:8px;padding:14px">
      <div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:8px">식수 현황</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;text-align:center">
        ${(() => {
          const pdfMealCF = summaryData?.mealCustomFields || []
          const pdfMealCT = summaryData?.mealCustomTotals || {}
          const pdfCustomTotal = pdfMealCF.filter(f=>f.unit_type!=='ea').reduce((s,f)=>s+(pdfMealCT[f.field_key]||0),0)
          const pdfTotalMeals = summaryData?.totalMeals || (pdfCustomTotal + (ms.total_staff||0) + (ms.total_guardian||0))
          if (pdfMealCF.length > 0) {
            return pdfMealCF.filter(f=>f.unit_type!=='ea').map(f=>
              `<div><div style="font-size:10px;color:#6b7280">${f.field_name}</div><div style="font-size:13px;font-weight:700">${(pdfMealCT[f.field_key]||0).toLocaleString()}</div></div>`
            ).join('') +
            `<div><div style="font-size:10px;color:#16a34a">합계</div><div style="font-size:14px;font-weight:700;color:#16a34a">${pdfTotalMeals.toLocaleString()}</div></div>`
          } else {
            return `
              <div><div style="font-size:10px;color:#6b7280">환자식</div><div style="font-size:14px;font-weight:700">${(ms.total_patient||0).toLocaleString()}</div></div>
              <div><div style="font-size:10px;color:#6b7280">직원식</div><div style="font-size:14px;font-weight:700">${(ms.total_staff||0).toLocaleString()}</div></div>
              <div><div style="font-size:10px;color:#6b7280">보호자</div><div style="font-size:14px;font-weight:700">${(ms.total_guardian||0).toLocaleString()}</div></div>
              <div><div style="font-size:10px;color:#16a34a">합계</div><div style="font-size:14px;font-weight:700;color:#16a34a">${pdfTotalMeals.toLocaleString()}</div></div>`
          }
        })()}
      </div>
    </div>
  </div>`

  addPage()
  await captureSection('pdf-page-summary', doc, 10, 10, 190, 270)

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PAGE 3: 식단가 분석 (그래프 + 표)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const monthLabels = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']

  // 차트를 임시 캔버스로 그리기
  function createChartCanvas(width, height, chartConfig) {
    return new Promise(resolve => {
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      pdfContainer.appendChild(canvas)
      const chart = new Chart(canvas, chartConfig)
      setTimeout(() => {
        const imgData = canvas.toDataURL('image/jpeg', 0.92)
        chart.destroy(); canvas.remove()
        resolve(imgData)
      }, 600)
    })
  }

  // 식단가 추이 차트
  const mpChartImg = await createChartCanvas(700, 300, {
    type: 'line',
    data: {
      labels: monthLabels,
      datasets: [
        { label: '실제 식단가', data: mMp, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.1)', borderWidth: 2, fill: true, pointRadius: 4 },
        { label: '목표 식단가', data: mTarget, borderColor: '#dc2626', borderDash: [5,5], borderWidth: 2, pointRadius: 0, fill: false }
      ]
    },
    options: { responsive: false, plugins: { legend: { position: 'top' } }, scales: { y: { beginAtZero: false } } }
  })

  pdfContainer.innerHTML = `
  <div id="pdf-page-mealprice" style="width:794px;padding:40px;background:white;box-sizing:border-box">
    <div style="border-bottom:3px solid #2563eb;padding-bottom:12px;margin-bottom:20px">
      <div style="font-size:11px;color:#2563eb;font-weight:600;letter-spacing:2px">ANALYSIS</div>
      <div style="font-size:22px;font-weight:bold;color:#1f2937">식단가 분석</div>
      <div style="font-size:13px;color:#6b7280">${hospitalName} · ${year}년 ${month}월</div>
    </div>
    <!-- 차트 -->
    <div style="background:#f9fafb;border-radius:8px;padding:14px;margin-bottom:16px;text-align:center">
      <div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:8px;text-align:left">식단가 월별 추이</div>
      <img src="${mpChartImg}" style="width:100%;max-height:200px;object-fit:contain">
    </div>
    <!-- 전월/전년 비교표 -->
    <div style="background:#f9fafb;border-radius:8px;padding:14px;margin-bottom:16px">
      <div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:10px">식단가 비교 분석</div>
      <table style="width:100%;font-size:11px;border-collapse:collapse">
        <thead>
          <tr style="background:#dbeafe">
            <th style="padding:6px 8px;text-align:left;border:1px solid #bfdbfe">구분</th>
            <th style="padding:6px 8px;text-align:right;border:1px solid #bfdbfe">당월</th>
            <th style="padding:6px 8px;text-align:right;border:1px solid #bfdbfe">전월</th>
            <th style="padding:6px 8px;text-align:right;border:1px solid #bfdbfe">전월대비</th>
            <th style="padding:6px 8px;text-align:right;border:1px solid #bfdbfe">목표</th>
            <th style="padding:6px 8px;text-align:right;border:1px solid #bfdbfe">목표대비</th>
          </tr>
        </thead>
        <tbody>
          ${[
            ['전체 식단가', proj?.mealPriceTotal||0, pm?.mealPriceTotal||0, targetMealPrice],
            ['직원제외 식단가', proj?.mealPriceTotalNoStaff||0, pm?.mealPriceTotalNoStaff||0, targetMealPrice],
            ['공급비제외', proj?.mealPriceTotalNoSupply||0, pm?.mealPriceTotalNoSupply||0, targetMealPrice],
          ].map(([label, cur, prev, target]) => {
            const diff = prev > 0 ? cur - prev : null
            const diffPct = prev > 0 ? ((cur-prev)/prev*100).toFixed(1) : null
            const targetDiff = target > 0 ? cur - target : null
            const targetPct = target > 0 ? ((cur-target)/target*100).toFixed(1) : null
            return `<tr style="border-bottom:1px solid #e5e7eb">
              <td style="padding:5px 8px;font-weight:600">${label}</td>
              <td style="padding:5px 8px;text-align:right;font-weight:700">${fmtW(cur)}</td>
              <td style="padding:5px 8px;text-align:right;color:#6b7280">${prev>0?fmtW(prev):'-'}</td>
              <td style="padding:5px 8px;text-align:right;color:${diff>0?'#dc2626':diff<0?'#16a34a':'#374151'};font-weight:${diff!==null?'600':'400'}">${diff!==null?(diff>0?'▲':'▼')+Math.abs(diff).toLocaleString()+'원 ('+diffPct+'%)':'-'}</td>
              <td style="padding:5px 8px;text-align:right;color:#6b7280">${target>0?fmtW(target):'-'}</td>
              <td style="padding:5px 8px;text-align:right;color:${targetDiff>0?'#dc2626':'#16a34a'};font-weight:${targetDiff!==null?'600':'400'}">${targetDiff!==null?(targetDiff>0?'▲':'▼')+Math.abs(targetDiff).toLocaleString()+'원':'-'}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>
    <!-- 자동해석 -->
    <div style="background:#eff6ff;border-radius:8px;padding:14px">
      <div style="font-size:11px;font-weight:600;color:#1d4ed8;margin-bottom:6px">자동 분석</div>
      ${autoAnalysis.filter(a=>a.type?.includes('meal_price')||a.type?.includes('spend')).length > 0
        ? autoAnalysis.filter(a=>a.type?.includes('meal_price')||a.type?.includes('spend')).map(a=>`<div style="font-size:11px;color:#374151;padding:3px 0;border-bottom:1px solid #bfdbfe">• ${a.message}</div>`).join('')
        : '<div style="font-size:11px;color:#6b7280">분석 데이터가 충분하지 않습니다.</div>'
      }
    </div>
  </div>`

  addPage()
  await captureSection('pdf-page-mealprice', doc, 10, 10, 190, 270)

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PAGE 4: 식수 분석
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const mealChartImg = await createChartCanvas(700, 300, {
    type: 'bar',
    data: {
      labels: monthLabels,
      datasets: [
        { label: '환자식', data: monthlyMeals.map(m=>m.total_patient||0), backgroundColor: 'rgba(22,163,74,0.75)', borderRadius: 3 },
        { label: '직원식', data: monthlyMeals.map(m=>m.total_staff||0), backgroundColor: 'rgba(37,99,235,0.7)', borderRadius: 3 },
        { label: '보호자', data: monthlyMeals.map(m=>m.total_guardian||0), backgroundColor: 'rgba(147,51,234,0.6)', borderRadius: 3 }
      ]
    },
    options: { responsive: false, plugins: { legend: { position: 'top' } }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }
  })

  pdfContainer.innerHTML = `
  <div id="pdf-page-meals" style="width:794px;padding:40px;background:white;box-sizing:border-box">
    <div style="border-bottom:3px solid #9333ea;padding-bottom:12px;margin-bottom:20px">
      <div style="font-size:11px;color:#9333ea;font-weight:600;letter-spacing:2px">MEAL COUNT</div>
      <div style="font-size:22px;font-weight:bold;color:#1f2937">식수 분석</div>
      <div style="font-size:13px;color:#6b7280">${hospitalName} · ${year}년 ${month}월</div>
    </div>
    <div style="background:#f9fafb;border-radius:8px;padding:14px;margin-bottom:16px;text-align:center">
      <div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:8px;text-align:left">월별 식수 추이 (누적)</div>
      <img src="${mealChartImg}" style="width:100%;max-height:200px;object-fit:contain">
    </div>
    <!-- 당월 식수 상세 -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div style="background:#f9fafb;border-radius:8px;padding:14px">
        <div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:8px">당월 식수 구성</div>
        <table style="width:100%;font-size:11px;border-collapse:collapse">
          ${(() => {
            const pdfMCF = summaryData?.mealCustomFields || []
            const pdfMCT = summaryData?.mealCustomTotals || {}
            const pdfTM = summaryData?.totalMeals || 0
            const rows = pdfMCF.length > 0
              ? pdfMCF.filter(f=>f.unit_type!=='ea').map(f=>[f.field_name, pdfMCT[f.field_key]||0,'#16a34a'])
              : [['환자식',ms.total_patient||0,'#16a34a'],['직원식',ms.total_staff||0,'#2563eb'],['보호자식',ms.total_guardian||0,'#9333ea'],['비급여',ms.total_noncovered||0,'#6b7280']]
            return rows.map(([label,val,color])=>`
          <tr style="border-bottom:1px solid #e5e7eb">
            <td style="padding:4px 0;color:#374151">${label}</td>
            <td style="text-align:right;font-weight:700;color:${color}">${val.toLocaleString()}식</td>
            <td style="text-align:right;color:#9ca3af;font-size:10px">${pdfTM>0?(val/pdfTM*100).toFixed(1)+'%':'-'}</td>
          </tr>`).join('') +
          `<tr style="background:#f0fdf4;font-weight:700">
            <td style="padding:5px 0">합계</td>
            <td style="text-align:right;color:#15803d">${pdfTM.toLocaleString()}식</td>
            <td style="text-align:right;color:#6b7280">100%</td>
          </tr>`
          })()}
        </table>
      </div>
      <div style="background:#f9fafb;border-radius:8px;padding:14px">
        <div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:8px">전월 대비 변동</div>
        <table style="width:100%;font-size:11px;border-collapse:collapse">
          ${[['전체 식수',summaryData?.totalMeals||0,(pm?.totalMeals||0)]].map(([label,cur,prev])=>{
            const diff = prev>0 ? cur-prev : null
            const pct = prev>0 ? ((cur-prev)/prev*100).toFixed(1) : null
            return `<tr style="border-bottom:1px solid #e5e7eb">
              <td style="padding:4px 0">${label}</td>
              <td style="text-align:right;font-weight:700">${cur.toLocaleString()}</td>
              <td style="text-align:right;color:${diff>0?'#16a34a':diff<0?'#dc2626':'#6b7280'};font-size:10px">${diff!==null?(diff>0?'▲':'▼')+Math.abs(diff).toLocaleString()+'('+pct+'%)':'-'}</td>
            </tr>`
          }).join('')}
        </table>
      </div>
    </div>
  </div>`

  addPage()
  await captureSection('pdf-page-meals', doc, 10, 10, 190, 270)

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PAGE 5: 발주 분석
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const vendorSorted = [...vendors].sort((a,b)=>(b.total_amount||0)-(a.total_amount||0))
  const vendorTotal = vendorSorted.reduce((s,v)=>s+(v.total_amount||0),0)

  const vendorChartImg = await createChartCanvas(600, 300, {
    type: 'doughnut',
    data: {
      labels: vendorSorted.slice(0,6).map(v=>v.name),
      datasets: [{ data: vendorSorted.slice(0,6).map(v=>v.total_amount||0),
        backgroundColor: ['#16a34a','#2563eb','#9333ea','#f59e0b','#ef4444','#06b6d4'] }]
    },
    options: { responsive: false, plugins: { legend: { position: 'right' } } }
  })

  pdfContainer.innerHTML = `
  <div id="pdf-page-orders" style="width:794px;padding:40px;background:white;box-sizing:border-box">
    <div style="border-bottom:3px solid #f59e0b;padding-bottom:12px;margin-bottom:20px">
      <div style="font-size:11px;color:#f59e0b;font-weight:600;letter-spacing:2px">ORDER ANALYSIS</div>
      <div style="font-size:22px;font-weight:bold;color:#1f2937">발주 분석</div>
      <div style="font-size:13px;color:#6b7280">${hospitalName} · ${year}년 ${month}월</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <!-- 업체별 파이차트 -->
      <div style="background:#f9fafb;border-radius:8px;padding:14px;text-align:center">
        <div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:8px;text-align:left">업체별 발주 비중</div>
        <img src="${vendorChartImg}" style="width:100%;max-height:180px;object-fit:contain">
      </div>
      <!-- 발주 이상 탐지 -->
      <div style="background:#f9fafb;border-radius:8px;padding:14px">
        <div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:8px">발주 이상 탐지</div>
        ${anomalies.length > 0
          ? anomalies.map(a=>`<div style="background:${a.severity==='high'?'#fef2f2':a.severity==='medium'?'#fff7ed':'#fffbeb'};border-left:3px solid ${a.severity==='high'?'#dc2626':a.severity==='medium'?'#ea580c':'#ca8a04'};padding:6px 8px;border-radius:4px;margin-bottom:6px;font-size:10px">
              <span style="font-weight:700;color:${a.severity==='high'?'#dc2626':a.severity==='medium'?'#ea580c':'#ca8a04'}">[${a.severity==='high'?'HIGH':a.severity==='medium'?'WARN':'INFO'}]</span>
              ${a.message}
            </div>`).join('')
          : '<div style="font-size:11px;color:#6b7280">이상 탐지 없음</div>'
        }
      </div>
    </div>
    <!-- 업체별 상세 표 -->
    <div style="background:#f9fafb;border-radius:8px;padding:14px">
      <div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:8px">업체별 발주 상세</div>
      <table style="width:100%;font-size:10px;border-collapse:collapse">
        <thead>
          <tr style="background:#fef3c7">
            <th style="padding:5px 8px;text-align:left;border:1px solid #fde68a">업체명</th>
            <th style="padding:5px 8px;text-align:center;border:1px solid #fde68a">카테고리</th>
            <th style="padding:5px 8px;text-align:right;border:1px solid #fde68a">발주금액</th>
            <th style="padding:5px 8px;text-align:right;border:1px solid #fde68a">비중</th>
          </tr>
        </thead>
        <tbody>
          ${vendorSorted.slice(0,10).map((v,i)=>{
            const pct = vendorTotal > 0 ? (v.total_amount/vendorTotal*100).toFixed(1) : 0
            return `<tr style="border-bottom:1px solid #fde68a;background:${i%2===0?'white':'#fffbeb'}">
              <td style="padding:4px 8px;font-weight:600">${v.name}</td>
              <td style="padding:4px 8px;text-align:center;color:#6b7280">${v.category||'-'}</td>
              <td style="padding:4px 8px;text-align:right;font-weight:700">${fmtK(v.total_amount||0)}원</td>
              <td style="padding:4px 8px;text-align:right;color:#92400e">${pct}%</td>
            </tr>`
          }).join('')}
          <tr style="background:#fef3c7;font-weight:700">
            <td style="padding:5px 8px" colspan="2">합계</td>
            <td style="padding:5px 8px;text-align:right">${fmtK(vendorTotal)}원</td>
            <td style="padding:5px 8px;text-align:right">100%</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>`

  addPage()
  await captureSection('pdf-page-orders', doc, 10, 10, 190, 270)

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PAGE 6: 예산 & 잔반 분석
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const budgetChartImg = await createChartCanvas(700, 280, {
    type: 'bar',
    data: {
      labels: monthLabels,
      datasets: [
        { label: '사용금액', data: mUsed, backgroundColor: 'rgba(22,163,74,0.7)', borderRadius: 3, order: 2 },
        { label: '목표예산', data: mBudget, type: 'line', borderColor: '#dc2626', borderWidth: 2, pointRadius: 3, fill: false, order: 1 }
      ]
    },
    options: { responsive: false, plugins: { legend: { position: 'top' } }, scales: { y: { beginAtZero: true } } }
  })

  const totalWasteKg = wasteData?.totalL || 0
  const totalWasteCost = wasteData?.totalCost || 0
  const wasteWeeks = wasteData?.weeks || []

  pdfContainer.innerHTML = `
  <div id="pdf-page-budget-waste" style="width:794px;padding:40px;background:white;box-sizing:border-box">
    <div style="border-bottom:3px solid #16a34a;padding-bottom:12px;margin-bottom:20px">
      <div style="font-size:11px;color:#16a34a;font-weight:600;letter-spacing:2px">BUDGET & WASTE</div>
      <div style="font-size:22px;font-weight:bold;color:#1f2937">예산 달성률 & 잔반 분석</div>
      <div style="font-size:13px;color:#6b7280">${hospitalName} · ${year}년 ${month}월</div>
    </div>
    <!-- 예산 차트 -->
    <div style="background:#f9fafb;border-radius:8px;padding:14px;margin-bottom:16px;text-align:center">
      <div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:8px;text-align:left">월별 예산 달성률 추이</div>
      <img src="${budgetChartImg}" style="width:100%;max-height:180px;object-fit:contain">
    </div>
    <!-- 잔반 분석 -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px">
        <div style="font-size:11px;font-weight:600;color:#92400e;margin-bottom:8px">잔반 비용 분석 (${year}년 ${month}월)</div>
        ${totalWasteKg > 0 ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          <div style="text-align:center;background:white;border-radius:6px;padding:8px">
            <div style="font-size:10px;color:#92400e">총 잔반량</div>
            <div style="font-size:18px;font-weight:bold;color:#b45309">${totalWasteKg.toFixed(1)}L</div>
          </div>
          <div style="text-align:center;background:white;border-radius:6px;padding:8px">
            <div style="font-size:10px;color:#92400e">총 비용</div>
            <div style="font-size:18px;font-weight:bold;color:#b45309">${fmtK(totalWasteCost)}원</div>
          </div>
        </div>
        <table style="width:100%;font-size:10px;border-collapse:collapse">
          <thead><tr style="background:#fef3c7"><th style="padding:4px 6px;text-align:left">주차</th><th style="text-align:right;padding:4px 6px">잔반량</th><th style="text-align:right;padding:4px 6px">비용</th></tr></thead>
          <tbody>${wasteWeeks.map(w=>`<tr style="border-bottom:1px solid #fde68a"><td style="padding:3px 6px">${w.week}주차</td><td style="text-align:right">${w.kg.toFixed(1)}kg</td><td style="text-align:right">${fmtK(w.cost)}원</td></tr>`).join('')}</tbody>
        </table>` : '<div style="font-size:11px;color:#6b7280;text-align:center;padding:20px">잔반 기록 없음</div>'}
      </div>
      <div style="background:#f9fafb;border-radius:8px;padding:14px">
        <div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:8px">예산 사용 현황</div>
        <table style="width:100%;font-size:11px;border-collapse:collapse">
          <tr style="border-bottom:1px solid #e5e7eb"><td style="padding:4px 0;color:#374151">총 예산</td><td style="text-align:right;font-weight:700">${fmtK(totalBudget)}원</td></tr>
          <tr style="border-bottom:1px solid #e5e7eb"><td style="padding:4px 0">사용금액</td><td style="text-align:right;font-weight:700;color:${progress>100?'#dc2626':'#16a34a'}">${fmtK(totalUsed)}원</td></tr>
          <tr style="border-bottom:1px solid #e5e7eb"><td style="padding:4px 0">잔여예산</td><td style="text-align:right;font-weight:700">${fmtK(remaining)}원</td></tr>
          <tr style="background:#f0fdf4"><td style="padding:4px 0;font-weight:700">달성률</td><td style="text-align:right;font-weight:700;color:${progress>100?'#dc2626':'#16a34a'}">${progress}%</td></tr>
        </table>
      </div>
    </div>
  </div>`

  addPage()
  await captureSection('pdf-page-budget-waste', doc, 10, 10, 190, 270)

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PAGE 7: 비교 분석 (전월/전년 동월)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  pdfContainer.innerHTML = `
  <div id="pdf-page-compare" style="width:794px;padding:40px;background:white;box-sizing:border-box">
    <div style="border-bottom:3px solid #6366f1;padding-bottom:12px;margin-bottom:20px">
      <div style="font-size:11px;color:#6366f1;font-weight:600;letter-spacing:2px">COMPARISON</div>
      <div style="font-size:22px;font-weight:bold;color:#1f2937">비교 분석</div>
      <div style="font-size:13px;color:#6b7280">${hospitalName} · ${year}년 ${month}월</div>
    </div>
    <!-- 전월 vs 당월 vs 목표 비교표 -->
    <div style="background:#f9fafb;border-radius:8px;padding:14px;margin-bottom:16px">
      <div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:10px">주요 지표 전월 대비</div>
      <table style="width:100%;font-size:11px;border-collapse:collapse">
        <thead>
          <tr style="background:#e0e7ff">
            <th style="padding:6px 8px;text-align:left;border:1px solid #c7d2fe">지표</th>
            <th style="padding:6px 8px;text-align:right;border:1px solid #c7d2fe">당월 (${month}월)</th>
            <th style="padding:6px 8px;text-align:right;border:1px solid #c7d2fe">전월 (${month===1?12:month-1}월)</th>
            <th style="padding:6px 8px;text-align:right;border:1px solid #c7d2fe">변동</th>
            <th style="padding:6px 8px;text-align:right;border:1px solid #c7d2fe">변동률</th>
          </tr>
        </thead>
        <tbody>
          ${[
            ['사용금액', totalUsed, pm?.totalUsed||0],
            ['식단가', proj?.mealPriceTotal||0, pm?.mealPriceTotal||0],
            ['직원제외 식단가', proj?.mealPriceTotalNoStaff||0, pm?.mealPriceTotalNoStaff||0],
            ['총 식수', totalMeals, pm?.totalMeals||0],
          ].map(([label, cur, prev]) => {
            const diff = prev > 0 ? cur - prev : null
            const pct = prev > 0 ? ((cur-prev)/prev*100).toFixed(1) : null
            const isPrice = label.includes('금액') || label.includes('식단가')
            return `<tr style="border-bottom:1px solid #e0e7ff">
              <td style="padding:5px 8px;font-weight:600">${label}</td>
              <td style="padding:5px 8px;text-align:right;font-weight:700">${isPrice?fmtK(cur)+'원':cur.toLocaleString()+(label.includes('식수')?'식':'')}</td>
              <td style="padding:5px 8px;text-align:right;color:#6b7280">${prev>0?(isPrice?fmtK(prev)+'원':prev.toLocaleString()):'-'}</td>
              <td style="padding:5px 8px;text-align:right;color:${diff>0?'#dc2626':diff<0?'#16a34a':'#374151'};font-weight:${diff!==null?'600':'400'}">${diff!==null?(diff>0?'▲':'▼')+(isPrice?fmtK(Math.abs(diff))+'원':Math.abs(diff).toLocaleString()):'-'}</td>
              <td style="padding:5px 8px;text-align:right;color:${pct!==null&&parseFloat(pct)>0?'#dc2626':pct!==null?'#16a34a':'#374151'}">${pct!==null?(parseFloat(pct)>0?'+':'')+pct+'%':'-'}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>
    <!-- 업체 발주 비교 -->
    <div style="background:#f9fafb;border-radius:8px;padding:14px">
      <div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:8px">업체별 발주 현황 (당월 기준)</div>
      <table style="width:100%;font-size:10px;border-collapse:collapse">
        <thead>
          <tr style="background:#e0e7ff">
            <th style="padding:5px 8px;text-align:left;border:1px solid #c7d2fe">업체명</th>
            <th style="padding:5px 8px;text-align:right;border:1px solid #c7d2fe">발주금액</th>
            <th style="padding:5px 8px;text-align:right;border:1px solid #c7d2fe">비중</th>
            <th style="padding:5px 8px;text-align:right;border:1px solid #c7d2fe">전월금액</th>
          </tr>
        </thead>
        <tbody>
          ${vendorSorted.slice(0,8).map((v,i) => {
            const pct = vendorTotal>0?(v.total_amount/vendorTotal*100).toFixed(1):0
            const prevAmt = v.prev_amount || 0
            return `<tr style="border-bottom:1px solid #e0e7ff;background:${i%2===0?'white':'#eef2ff'}">
              <td style="padding:4px 8px;font-weight:600">${v.name}</td>
              <td style="padding:4px 8px;text-align:right;font-weight:700">${fmtK(v.total_amount||0)}원</td>
              <td style="padding:4px 8px;text-align:right;color:#4338ca">${pct}%</td>
              <td style="padding:4px 8px;text-align:right;color:#6b7280">${prevAmt>0?fmtK(prevAmt)+'원':'-'}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>`

  addPage()
  await captureSection('pdf-page-compare', doc, 10, 10, 190, 270)

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PAGE 8: 전체 운영 자동 해석
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 자동 분석 문장 생성
  function generateAutoInterpretation(data) {
    const lines = []
    const s = data?.summary || {}
    const proj = data
    const pm = data?.prevMonth || {}
    const totalUsed = s.totalUsed || 0
    const totalBudget = s.totalBudget || 0
    const progress = totalBudget > 0 ? (totalUsed/totalBudget*100) : 0
    const mp = data?.mealPriceTotal || 0
    const target = data?.settings?.meal_price || 0
    const pmUsed = pm?.totalUsed || 0
    const pmMp = pm?.mealPriceTotal || 0

    // 예산
    if (progress > 100) lines.push({ icon:'🚨', cat:'예산', text: `예산 초과 상태입니다. 현재 달성률 ${progress.toFixed(1)}%로 즉각적인 지출 조정이 필요합니다.`, color:'#dc2626' })
    else if (progress > 85) lines.push({ icon:'⚠️', cat:'예산', text: `예산의 ${progress.toFixed(1)}%를 사용했습니다. 잔여 예산 관리에 주의가 필요합니다.`, color:'#ea580c' })
    else lines.push({ icon:'✅', cat:'예산', text: `예산 사용률 ${progress.toFixed(1)}%로 안정적으로 운영 중입니다.`, color:'#16a34a' })

    // 식단가
    if (mp > 0 && target > 0) {
      const diff = ((mp-target)/target*100)
      if (diff > 10) lines.push({ icon:'🚨', cat:'식단가', text: `현재 식단가(${fmtW(mp)})가 목표(${fmtW(target)}) 대비 ${diff.toFixed(1)}% 초과 상태입니다. 식재료비 절감 방안 검토가 필요합니다.`, color:'#dc2626' })
      else if (diff > 0) lines.push({ icon:'⚠️', cat:'식단가', text: `식단가(${fmtW(mp)})가 목표 대비 ${diff.toFixed(1)}% 초과입니다. 지속 모니터링이 필요합니다.`, color:'#ea580c' })
      else lines.push({ icon:'✅', cat:'식단가', text: `식단가(${fmtW(mp)})가 목표(${fmtW(target)}) 이내로 관리되고 있습니다.`, color:'#16a34a' })
    }

    // 전월 대비 식단가
    if (pmMp > 0 && mp > 0) {
      const chg = ((mp-pmMp)/pmMp*100)
      if (chg > 10) lines.push({ icon:'📈', cat:'전월비교', text: `식단가가 전월 대비 ${chg.toFixed(1)}% 상승했습니다. 원인 파악 및 대응이 필요합니다.`, color:'#dc2626' })
      else if (chg < -10) lines.push({ icon:'📉', cat:'전월비교', text: `식단가가 전월 대비 ${Math.abs(chg).toFixed(1)}% 감소했습니다. 효율적 운영이 이루어지고 있습니다.`, color:'#16a34a' })
      else lines.push({ icon:'➡️', cat:'전월비교', text: `식단가가 전월 대비 ${Math.abs(chg).toFixed(1)}% ${chg>0?'소폭 증가':'소폭 감소'}하여 안정적입니다.`, color:'#6366f1' })
    }

    // 발주 이상
    const anomalies = data?.anomalies || []
    anomalies.forEach(a => {
      if (a.severity === 'high') lines.push({ icon:'🚨', cat:'발주이상', text: a.message, color:'#dc2626' })
      else if (a.severity === 'medium') lines.push({ icon:'⚠️', cat:'발주이상', text: a.message, color:'#ea580c' })
    })

    // 잔반
    if (totalWasteKg > 0) {
      const wastePer = totalMeals > 0 ? (totalWasteKg/totalMeals*1000).toFixed(0) : 0
      lines.push({ icon:'♻️', cat:'잔반', text: `이번 달 잔반 발생량은 ${totalWasteKg.toFixed(1)}L, 비용 ${fmtK(totalWasteCost)}원입니다. 식수 1인당 ${wastePer}g 수준입니다.`, color:'#f59e0b' })
    }

    return lines
  }

  const interp = generateAutoInterpretation(summaryData)

  pdfContainer.innerHTML = `
  <div id="pdf-page-autoanalysis" style="width:794px;padding:40px;background:white;box-sizing:border-box">
    <div style="border-bottom:3px solid #059669;padding-bottom:12px;margin-bottom:20px">
      <div style="font-size:11px;color:#059669;font-weight:600;letter-spacing:2px">AUTO ANALYSIS</div>
      <div style="font-size:22px;font-weight:bold;color:#1f2937">전체 운영 자동 해석</div>
      <div style="font-size:13px;color:#6b7280">${hospitalName} · ${year}년 ${month}월</div>
    </div>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;margin-bottom:16px;font-size:11px;color:#374151">
      본 자동 분석은 당월 데이터를 기반으로 생성된 운영 해석입니다. 실제 운영 상황에 따라 전문가 판단이 필요할 수 있습니다.
    </div>
    <div style="space-y:8px">
      ${interp.map(item => `
      <div style="background:#f9fafb;border-left:4px solid ${item.color};border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:10px">
        <div style="display:flex;align-items:flex-start;gap:16px">
          <span style="font-size:16px;flex-shrink:0">${item.icon}</span>
          <div>
            <span style="font-size:10px;font-weight:700;color:${item.color};background:${item.color}20;padding:2px 6px;border-radius:4px;margin-right:6px">${item.cat}</span>
            <span style="font-size:12px;color:#1f2937;line-height:1.6">${item.text}</span>
          </div>
        </div>
      </div>`).join('')}
    </div>
    <!-- 권고사항 요약 -->
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px;margin-top:16px">
      <div style="font-size:11px;font-weight:600;color:#dc2626;margin-bottom:8px">권고 사항 요약</div>
      ${interp.filter(i=>i.color==='#dc2626'||i.color==='#ea580c').length > 0
        ? interp.filter(i=>i.color==='#dc2626'||i.color==='#ea580c').map(i=>`<div style="font-size:11px;color:#374151;padding:3px 0;border-bottom:1px solid #fecaca">• ${i.text}</div>`).join('')
        : '<div style="font-size:11px;color:#16a34a">특이사항 없음 — 정상 운영 중입니다.</div>'
      }
    </div>
  </div>`

  addPage()
  await captureSection('pdf-page-autoanalysis', doc, 10, 10, 190, 270)

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PAGE 9: 지출 결의 (업체별 상세)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  pdfContainer.innerHTML = `
  <div id="pdf-page-expense" style="width:794px;padding:40px;background:white;box-sizing:border-box">
    <div style="border-bottom:3px solid #374151;padding-bottom:12px;margin-bottom:20px">
      <div style="font-size:11px;color:#374151;font-weight:600;letter-spacing:2px">EXPENSE APPROVAL</div>
      <div style="font-size:22px;font-weight:bold;color:#1f2937">지출 결의서</div>
      <div style="font-size:13px;color:#6b7280">${hospitalName} · ${year}년 ${month}월</div>
    </div>
    <!-- 합계 -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
      <div style="background:#f9fafb;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:10px;color:#6b7280">총 지출금액</div>
        <div style="font-size:20px;font-weight:bold;color:#1f2937">${fmtK(totalUsed)}원</div>
      </div>
      <div style="background:#f9fafb;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:10px;color:#6b7280">업체 수</div>
        <div style="font-size:20px;font-weight:bold;color:#1f2937">${vendors.length}개사</div>
      </div>
      <div style="background:#f9fafb;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:10px;color:#6b7280">예산 달성률</div>
        <div style="font-size:20px;font-weight:bold;color:${progress>100?'#dc2626':'#16a34a'}">${progress}%</div>
      </div>
    </div>
    <!-- 업체별 지출 상세 -->
    <table style="width:100%;font-size:10px;border-collapse:collapse;border:1px solid #d1d5db">
      <thead>
        <tr style="background:#374151;color:white">
          <th style="padding:7px 10px;text-align:left;border-right:1px solid #4b5563">NO</th>
          <th style="padding:7px 10px;text-align:left;border-right:1px solid #4b5563">업체명</th>
          <th style="padding:7px 10px;text-align:center;border-right:1px solid #4b5563">카테고리</th>
          <th style="padding:7px 10px;text-align:right;border-right:1px solid #4b5563">과세금액</th>
          <th style="padding:7px 10px;text-align:right;border-right:1px solid #4b5563">면세금액</th>
          <th style="padding:7px 10px;text-align:right;border-right:1px solid #4b5563">부가세</th>
          <th style="padding:7px 10px;text-align:right">합계</th>
        </tr>
      </thead>
      <tbody>
        ${vendorSorted.map((v,i) => `
        <tr style="border-bottom:1px solid #e5e7eb;background:${i%2===0?'white':'#f9fafb'}">
          <td style="padding:5px 10px;color:#6b7280">${i+1}</td>
          <td style="padding:5px 10px;font-weight:600">${v.name}</td>
          <td style="padding:5px 10px;text-align:center;color:#6b7280">${v.category||'-'}</td>
          <td style="padding:5px 10px;text-align:right">${v.taxable_total>0?fmtK(v.taxable_total)+'원':'-'}</td>
          <td style="padding:5px 10px;text-align:right">${v.exempt_total>0?fmtK(v.exempt_total)+'원':'-'}</td>
          <td style="padding:5px 10px;text-align:right">${v.vat_total>0?fmtK(v.vat_total)+'원':'-'}</td>
          <td style="padding:5px 10px;text-align:right;font-weight:700">${fmtK(v.total_amount||0)}원</td>
        </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr style="background:#374151;color:white;font-weight:700">
          <td colspan="3" style="padding:7px 10px">합  계</td>
          <td style="padding:7px 10px;text-align:right">${fmtK(vendorSorted.reduce((s,v)=>s+(v.taxable_total||0),0))}원</td>
          <td style="padding:7px 10px;text-align:right">${fmtK(vendorSorted.reduce((s,v)=>s+(v.exempt_total||0),0))}원</td>
          <td style="padding:7px 10px;text-align:right">${fmtK(vendorSorted.reduce((s,v)=>s+(v.vat_total||0),0))}원</td>
          <td style="padding:7px 10px;text-align:right">${fmtK(totalUsed)}원</td>
        </tr>
      </tfoot>
    </table>
    <!-- 결재란 -->
    <div style="margin-top:24px;display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px">
      ${['담당','팀장','원장','이사장'].map(r=>`
      <div style="border:1px solid #d1d5db;border-radius:6px;padding:8px;text-align:center">
        <div style="font-size:10px;color:#6b7280;margin-bottom:4px">${r}</div>
        <div style="height:50px;border-bottom:1px solid #e5e7eb"></div>
        <div style="font-size:9px;color:#9ca3af;margin-top:4px">서명/날인</div>
      </div>`).join('')}
    </div>
  </div>`

  addPage()
  await captureSection('pdf-page-expense', doc, 10, 10, 190, 270)

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PAGE 10: 부록 - 식재료 단가 분석
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (ingData && ingData.length > 0) {
    pdfContainer.innerHTML = `
    <div id="pdf-page-appendix" style="width:794px;padding:40px;background:white;box-sizing:border-box">
      <div style="border-bottom:3px solid #059669;padding-bottom:12px;margin-bottom:20px">
        <div style="font-size:11px;color:#059669;font-weight:600;letter-spacing:2px">APPENDIX</div>
        <div style="font-size:22px;font-weight:bold;color:#1f2937">부록: 주요 식재료 단가 분석</div>
        <div style="font-size:13px;color:#6b7280">${hospitalName} · ${year}년 ${month}월</div>
      </div>
      <table style="width:100%;font-size:11px;border-collapse:collapse;border:1px solid #d1fae5">
        <thead>
          <tr style="background:#059669;color:white">
            <th style="padding:8px 10px;text-align:left;border-right:1px solid #10b981">식재료명</th>
            <th style="padding:8px 10px;text-align:center;border-right:1px solid #10b981">단위</th>
            <th style="padding:8px 10px;text-align:right;border-right:1px solid #10b981">당월 단가</th>
            <th style="padding:8px 10px;text-align:right;border-right:1px solid #10b981">전월 단가</th>
            <th style="padding:8px 10px;text-align:right;border-right:1px solid #10b981">전월대비</th>
            <th style="padding:8px 10px;text-align:right;border-right:1px solid #10b981">전년동월</th>
            <th style="padding:8px 10px;text-align:right">전년대비</th>
          </tr>
        </thead>
        <tbody>
          ${ingData.map((r,i) => {
            const momDiff = r.mom_diff
            const yoyDiff = r.yoy_diff
            const momPct = r.prev_price>0 && momDiff!==null ? ((momDiff/r.prev_price)*100).toFixed(1) : null
            const yoyPct = r.prev_year_price>0 && yoyDiff!==null ? ((yoyDiff/r.prev_year_price)*100).toFixed(1) : null
            return `<tr style="border-bottom:1px solid #d1fae5;background:${i%2===0?'white':'#f0fdf4'}">
              <td style="padding:6px 10px;font-weight:600">${r.ingredient_name}</td>
              <td style="padding:6px 10px;text-align:center;color:#6b7280">${r.unit||'kg'}</td>
              <td style="padding:6px 10px;text-align:right;font-weight:700">${fmtW(r.unit_price)}</td>
              <td style="padding:6px 10px;text-align:right;color:#6b7280">${r.prev_price>0?fmtW(r.prev_price):'-'}</td>
              <td style="padding:6px 10px;text-align:right;color:${momDiff>0?'#dc2626':momDiff<0?'#16a34a':'#374151'};font-weight:600">${momDiff!==null?(momDiff>0?'▲':'▼')+Math.abs(momDiff).toLocaleString()+'원'+(momPct?'('+momPct+'%)':''):'-'}</td>
              <td style="padding:6px 10px;text-align:right;color:#6b7280">${r.prev_year_price>0?fmtW(r.prev_year_price):'-'}</td>
              <td style="padding:6px 10px;text-align:right;color:${yoyDiff>0?'#dc2626':yoyDiff<0?'#16a34a':'#374151'};font-weight:600">${yoyDiff!==null?(yoyDiff>0?'▲':'▼')+Math.abs(yoyDiff).toLocaleString()+'원'+(yoyPct?'('+yoyPct+'%)':''):'-'}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
      <div style="margin-top:16px;background:#f0fdf4;border-radius:8px;padding:12px;font-size:10px;color:#374151">
        <strong>참고:</strong> 단가는 ${year}년 ${month}월 기준 수동 입력 데이터입니다. 전월/전년 대비 변동률은 해당 기간 데이터 존재 시에만 표시됩니다.
      </div>
    </div>`

    addPage()
    await captureSection('pdf-page-appendix', doc, 10, 10, 190, 270)
  }

  // 정리
  pdfContainer.remove()

  // PDF 저장
  doc.save(`${hospitalName}_${year}년${String(month).padStart(2,'0')}월_운영보고서.pdf`)
  showToast(`A4 PDF 보고서 생성 완료! (${pageNum}페이지)`, 'success')
}

// ══════════════════════════════════════════════════════════════════
//  법인카드 상세입력 모달
// ══════════════════════════════════════════════════════════════════
window._cardExpenseVendorId = null
window._cardExpenseDate = null
window._cardExpenseItems = []   // [{id?, vendorName, itemName, purpose, amount, memo}]
window._cardExpenseDeletedIds = []

function getCardSubtypeDefaultName(card_subtype) {
  const map = { food:'법인카드(식재료)', supplies:'법인카드(소모품)', online:'법인카드(온라인)', other:'법인카드(기타)' }
  return map[card_subtype] || '법인카드'
}

window.openCardExpenseModal = async function(vendorId, dateStr) {
  window._cardExpenseVendorId = vendorId
  window._cardExpenseDate = dateStr
  window._cardExpenseDeletedIds = []

  // 현재 업체 정보 가져오기
  const vendors = window._vendorsCache || []
  const vendor = vendors.find(v => v.id == vendorId) || {}
  const defaultVendorName = getCardSubtypeDefaultName(vendor.card_subtype)

  // 서버에서 기존 입력 내역 조회
  let items = []
  const resp = await api('GET', `/api/card-expenses/daily/${vendorId}/${dateStr}`)
  if (resp && resp.items && resp.items.length > 0) {
    items = resp.items.map(item => ({
      id: item.id,
      vendorName: item.vendor_name,
      itemName: item.item_name,
      purpose: item.purpose,
      amount: item.amount,
      memo: item.memo || ''
    }))
  } else {
    // 새 입력 행 1개 추가
    items = [{ id: null, vendorName: defaultVendorName, itemName: '', purpose: '', amount: '', memo: '' }]
  }
  window._cardExpenseItems = items

  let modal = document.getElementById('cardExpenseModal')
  if (!modal) {
    modal = document.createElement('div')
    modal.id = 'cardExpenseModal'
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9500;display:flex;align-items:center;justify-content:center;padding:16px;'
    document.body.appendChild(modal)
  }
  renderCardExpenseModal(modal, vendor, dateStr, items)
}

function renderCardExpenseModal(modal, vendor, dateStr, items) {
  const subtypeLabel = getCardSubtypeDefaultName(vendor.card_subtype)
  const [year, month, day] = dateStr.split('-')
  const totalAmt = items.reduce((s, it) => s + (parseInt(it.amount) || 0), 0)

  modal.innerHTML = `
  <div class="bg-white rounded-2xl shadow-2xl w-full mx-auto flex flex-col" style="max-width:720px;max-height:90vh;">
    <!-- 헤더 -->
    <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
      <div>
        <h3 class="font-bold text-gray-800 text-base flex items-center gap-2">
          <span class="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
            <i class="fas fa-credit-card text-purple-600 text-sm"></i>
          </span>
          <span>${vendor.name || subtypeLabel} 상세입력</span>
        </h3>
        <p class="text-xs text-gray-400 mt-0.5 ml-10">${year}년 ${month}월 ${day}일 사용내역</p>
      </div>
      <button onclick="closeCardExpenseModal()" class="text-gray-400 hover:text-gray-600 text-xl w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100">
        <i class="fas fa-times"></i>
      </button>
    </div>

    <!-- 입력 테이블 -->
    <div class="flex-1 overflow-y-auto px-4 py-3">
      <!-- 입력 가이드 -->
      <div class="mb-3 p-3 bg-purple-50 rounded-xl border border-purple-100 text-xs text-purple-700">
        <span class="font-semibold">입력 예시:</span>
        사용 품목 <span class="text-purple-900 font-bold">위생장갑</span> /
        진행 용도 <span class="text-purple-900 font-bold">주방 소모품 구매</span> /
        비고 <span class="text-purple-900 font-bold">긴급 구매</span>
        &nbsp;·&nbsp; 또는 품목 <span class="text-purple-900 font-bold">과일</span> /
        용도 <span class="text-purple-900 font-bold">환자 추가 간식 제공</span> /
        비고 <span class="text-purple-900 font-bold">당일 추가 발주 대체</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm border-collapse" style="min-width:580px;">
          <thead>
            <tr class="bg-purple-50">
              <th class="px-2 py-2 text-left text-xs font-semibold text-purple-700 rounded-tl-lg" style="min-width:110px">업체명</th>
              <th class="px-2 py-2 text-left text-xs font-semibold text-purple-700" style="min-width:110px">사용 품목 <span class="text-red-400">*</span></th>
              <th class="px-2 py-2 text-left text-xs font-semibold text-purple-700" style="min-width:130px">진행 용도 <span class="text-red-400">*</span></th>
              <th class="px-2 py-2 text-right text-xs font-semibold text-purple-700" style="min-width:90px">금액(원)</th>
              <th class="px-2 py-2 text-left text-xs font-semibold text-purple-700" style="min-width:100px">비고</th>
              <th class="px-2 py-2 rounded-tr-lg" style="width:36px"></th>
            </tr>
          </thead>
          <tbody id="cardExpenseRows">
            ${items.map((it, idx) => renderCardExpenseRow(it, idx)).join('')}
          </tbody>
        </table>
      </div>
      <!-- 행 추가 버튼 -->
      <button onclick="addCardExpenseRow()" class="mt-3 flex items-center gap-2 text-purple-600 hover:text-purple-800 text-sm font-medium px-3 py-2 rounded-xl hover:bg-purple-50 transition-colors border-2 border-dashed border-purple-200 w-full justify-center">
        <i class="fas fa-plus-circle"></i>행 추가
      </button>
    </div>

    <!-- 하단 합계 + 버튼 -->
    <div class="px-5 py-4 border-t border-gray-100 flex-shrink-0">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <span class="text-sm text-gray-500">합계</span>
          <span class="text-lg font-bold text-purple-700" id="cardExpenseTotal">${totalAmt > 0 ? totalAmt.toLocaleString() + '원' : '0원'}</span>
          <span class="text-xs text-gray-400" id="cardExpenseCount">${items.length}건</span>
        </div>
        <div class="flex gap-2">
          <button onclick="closeCardExpenseModal()" class="btn btn-secondary px-4 py-2 text-sm">취소</button>
          <button onclick="saveCardExpenseItems()" class="btn btn-primary px-5 py-2 text-sm">
            <i class="fas fa-save mr-1"></i>저장
          </button>
        </div>
      </div>
    </div>
  </div>`
}

function renderCardExpenseRow(item, idx) {
  return `<tr class="card-expense-row border-b border-gray-100 hover:bg-gray-50" data-idx="${idx}" ${item.id ? `data-id="${item.id}"` : ''}>
    <td class="px-1 py-1.5"><input type="text" class="card-exp-input form-input text-xs py-1 px-2" data-field="vendorName" data-idx="${idx}" value="${escHtml(item.vendorName||'')}" placeholder="예: 이마트, 쿠팡" style="width:100%;min-width:100px;"></td>
    <td class="px-1 py-1.5"><input type="text" class="card-exp-input form-input text-xs py-1 px-2" data-field="itemName" data-idx="${idx}" value="${escHtml(item.itemName||'')}" placeholder="예: 위생장갑, 과일" style="width:100%;min-width:100px;" title="사용 품목을 입력하세요 (예: 위생장갑, 과일, 세제)"></td>
    <td class="px-1 py-1.5"><input type="text" class="card-exp-input form-input text-xs py-1 px-2" data-field="purpose" data-idx="${idx}" value="${escHtml(item.purpose||'')}" placeholder="예: 주방소모품 구매" style="width:100%;min-width:120px;" title="진행 용도를 입력하세요 (예: 주방 소모품 구매, 환자 추가 간식 제공)"></td>
    <td class="px-1 py-1.5"><input type="text" inputmode="numeric" class="card-exp-input form-input text-xs py-1 px-2 text-right" data-field="amount" data-idx="${idx}" value="${item.amount > 0 ? parseInt(item.amount).toLocaleString() : ''}" placeholder="0" style="width:100%;min-width:82px;" oninput="this.value=this.value.replace(/[^0-9,]/g,'');updateCardExpenseTotal()"></td>
    <td class="px-1 py-1.5"><input type="text" class="card-exp-input form-input text-xs py-1 px-2" data-field="memo" data-idx="${idx}" value="${escHtml(item.memo||'')}" placeholder="예: 긴급구매" style="width:100%;min-width:90px;" title="비고: 선택 입력 (예: 긴급 구매, 당일 추가 발주 대체)"></td>
    <td class="px-1 py-1.5 text-center">
      <button onclick="removeCardExpenseRow(${idx})" class="text-red-400 hover:text-red-600 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 transition-colors mx-auto">
        <i class="fas fa-trash text-xs"></i>
      </button>
    </td>
  </tr>`
}

function escHtml(str) {
  if (!str) return ''
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

window.addCardExpenseRow = function() {
  const vendors = window._vendorsCache || []
  const vendor = vendors.find(v => v.id == window._cardExpenseVendorId) || {}
  const defaultVendorName = getCardSubtypeDefaultName(vendor.card_subtype)
  const newItem = { id: null, vendorName: defaultVendorName, itemName: '', purpose: '', amount: '', memo: '' }
  window._cardExpenseItems.push(newItem)
  const idx = window._cardExpenseItems.length - 1
  const tbody = document.getElementById('cardExpenseRows')
  if (tbody) {
    const tr = document.createElement('tr')
    tr.innerHTML = renderCardExpenseRow(newItem, idx)
    const inner = tr.querySelector('tr')
    if (inner) {
      tbody.appendChild(inner)
    } else {
      // renderCardExpenseRow returns a tr string
      tbody.insertAdjacentHTML('beforeend', renderCardExpenseRow(newItem, idx))
    }
    // 첫 번째 입력칸으로 포커스
    const firstInput = tbody.querySelectorAll(`[data-idx="${idx}"]`)[0]
    if (firstInput) firstInput.focus()
  }
  updateCardExpenseTotal()
}

window.removeCardExpenseRow = function(idx) {
  const rows = document.querySelectorAll('#cardExpenseRows .card-expense-row')
  if (rows.length <= 1) {
    showToast('최소 1개 항목이 필요합니다', 'info')
    return
  }
  // id 있으면 삭제 목록에 추가
  const row = rows[idx]
  if (row && row.dataset.id) {
    window._cardExpenseDeletedIds.push(parseInt(row.dataset.id))
  }
  if (row) row.remove()
  // idx 재정렬
  document.querySelectorAll('#cardExpenseRows .card-expense-row').forEach((r, i) => {
    r.dataset.idx = i
    r.querySelectorAll('[data-idx]').forEach(el => { el.dataset.idx = i })
  })
  updateCardExpenseTotal()
}

window.updateCardExpenseTotal = function() {
  let total = 0, count = 0
  document.querySelectorAll('#cardExpenseRows .card-expense-row').forEach(row => {
    const amtInput = row.querySelector('[data-field="amount"]')
    if (amtInput) {
      const v = parseInt(amtInput.value.replace(/,/g, '')) || 0
      if (v > 0) { total += v; count++ }
    }
  })
  const totalEl = document.getElementById('cardExpenseTotal')
  const countEl = document.getElementById('cardExpenseCount')
  if (totalEl) totalEl.textContent = total > 0 ? total.toLocaleString() + '원' : '0원'
  if (countEl) countEl.textContent = count + '건'
}

window.saveCardExpenseItems = async function() {
  const vendorId = window._cardExpenseVendorId
  const date = window._cardExpenseDate
  if (!vendorId || !date) return

  // 행 데이터 수집
  const rows = document.querySelectorAll('#cardExpenseRows .card-expense-row')
  const items = []
  let hasError = false
  rows.forEach((row, i) => {
    const get = (field) => {
      const el = row.querySelector(`[data-field="${field}"]`)
      return el ? el.value.trim() : ''
    }
    const vendorName = get('vendorName')
    const itemName = get('itemName')
    const purpose = get('purpose')
    const amountStr = get('amount').replace(/,/g, '')
    const amount = parseInt(amountStr) || 0
    const memo = get('memo')
    const id = row.dataset.id ? parseInt(row.dataset.id) : null

    if (!vendorName || !itemName || !purpose || !amount) {
      // 빈 행은 건너뜀 (모두 비어있을 경우)
      if (!vendorName && !itemName && !purpose && !amount) return
      hasError = true
      row.style.background = '#fef2f2'
      setTimeout(() => { row.style.background = '' }, 2000)
      return
    }
    row.style.background = ''
    items.push({ id, vendorName, itemName, purpose, amount, memo })
  })

  if (hasError) {
    showToast('빈 항목을 모두 입력해주세요 (업체명, 품목, 용도, 금액 필수)', 'error')
    return
  }
  if (items.length === 0) {
    showToast('저장할 항목이 없습니다', 'error')
    return
  }

  const saveBtn = document.querySelector('#cardExpenseModal button[onclick="saveCardExpenseItems()"]')
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>저장중...' }

  const res = await api('POST', '/api/card-expenses/save', {
    vendorId, date, items,
    deletedIds: window._cardExpenseDeletedIds || []
  })

  if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save mr-1"></i>저장' }

  if (res?.success) {
    showToast('저장되었습니다', 'success')
    // 화면 맵 업데이트
    if (!window._cardDailyMap) window._cardDailyMap = {}
    if (!window._cardDailyCountMap) window._cardDailyCountMap = {}
    if (!window._cardDailyMap[vendorId]) window._cardDailyMap[vendorId] = {}
    if (!window._cardDailyCountMap[vendorId]) window._cardDailyCountMap[vendorId] = {}
    window._cardDailyMap[vendorId][date] = res.dayTotal || 0
    window._cardDailyCountMap[vendorId][date] = items.length

    // 발주 테이블에서 해당 버튼 UI 업데이트 (일반 모드 + 카테고리 모드 모두)
    const allBtns = document.querySelectorAll(`.card-expense-btn[data-vendor="${vendorId}"][data-date="${date}"]`)
    allBtns.forEach(btn => {
      const vendors = window._vendorsCache || []
      const v = vendors.find(v => v.id == vendorId) || {}
      const subtypeLabel = {food:'식재료',supplies:'소모품',online:'온라인',other:'기타'}[v.card_subtype||'food']||''
      const hasData = res.dayTotal > 0
      // 일반 모드 버튼 (td 안에 직접)
      if (btn.closest('td') && !btn.closest('.card-expense-btn-wrap')) {
        btn.style.background = hasData ? '#f5f3ff' : '#faf5ff'
        btn.style.borderColor = hasData ? '#8b5cf6' : '#e9d5ff'
        btn.style.color = hasData ? '#6d28d9' : '#a78bfa'
        btn.innerHTML = `<div style="font-size:9px;color:#8b5cf6;font-weight:600;">${subtypeLabel}</div>` +
          (hasData
            ? `<div style="font-weight:700">${res.dayTotal.toLocaleString()}</div><div style="font-size:9px;color:#7c3aed;">${items.length}건</div>`
            : `<div style="color:#c4b5fd">+ 상세입력</div>`)
      } else {
        // 카테고리 모드 버튼
        btn.style.background = hasData ? '#f5f3ff' : '#faf5ff'
        btn.style.borderColor = hasData ? '#8b5cf6' : '#c4b5fd'
        btn.style.color = hasData ? '#6d28d9' : '#a78bfa'
        btn.innerHTML = `<div style="font-size:8px;color:#8b5cf6;font-weight:600;margin-bottom:2px">${subtypeLabel}</div>` +
          (hasData
            ? `<div style="font-weight:700;font-size:12px">${res.dayTotal.toLocaleString()}</div><div style="font-size:9px;color:#7c3aed">${items.length}건 입력됨</div>`
            : `<div style="font-size:11px">+ 상세입력</div>`)
      }
    })
    // 하단 일계 업데이트
    updateDayTotal(date)
    closeCardExpenseModal()
  } else {
    showToast('저장 실패', 'error')
  }
}

window.closeCardExpenseModal = function() {
  const modal = document.getElementById('cardExpenseModal')
  if (modal) modal.remove()
}

// ════════════════════════════════════════════════════════════════
// 지출결의서 페이지
// ════════════════════════════════════════════════════════════════
async function renderExpenseDoc() {
  const content = document.getElementById('pageContent')
  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`

  const year = App.currentYear
  const month = App.currentMonth

  const cardData = await api('GET', `/api/card-expenses/monthly/${year}/${month}`)
  if (!cardData) {
    content.innerHTML = '<div class="text-red-500 p-6">데이터 로드 실패</div>'
    return
  }

  // monthly 엔드포인트가 expenses 필드 포함
  const subtypeLabels = { food:'식재료', supplies:'소모품', online:'온라인', other:'기타' }

  // 상세내역은 monthly.expenses 사용 (이미 포함되어 있음)
  const detailData = cardData

  const allExpenses = (detailData?.expenses || [])
    .sort((a, b) => a.expense_date.localeCompare(b.expense_date) || (a.id - b.id))

  // 월 합계
  const monthTotal = allExpenses.reduce((s, e) => s + (e.amount || 0), 0)
  // 구분별 합계
  const bySubtype = {}
  allExpenses.forEach(e => {
    const k = e.card_subtype || 'other'
    if (!bySubtype[k]) bySubtype[k] = { label: subtypeLabels[k]||'기타', total: 0, count: 0 }
    bySubtype[k].total += e.amount || 0
    bySubtype[k].count++
  })

  const mm = String(month).padStart(2, '0')

  content.innerHTML = `
  <div class="space-y-4">
    <!-- 컨트롤 바 -->
    <div class="flex items-center gap-3 flex-wrap no-print">
      <div class="flex items-center gap-2 text-sm text-gray-600">
        <i class="fas fa-file-invoice-dollar text-purple-500"></i>
        <span class="font-semibold">${year}년 ${month}월 법인카드 지출결의서</span>
      </div>
      <div class="ml-auto flex gap-2">
        <button onclick="openAddExpenseModal()" class="btn btn-primary btn-sm no-print">
          <i class="fas fa-plus mr-1"></i>지출 입력
        </button>
        <button onclick="window.print()" class="btn btn-secondary btn-sm">
          <i class="fas fa-print mr-1"></i>인쇄/PDF
        </button>
        <button onclick="exportExpenseDocExcel()" class="btn btn-primary btn-sm">
          <i class="fas fa-file-excel mr-1"></i>엑셀 다운로드
        </button>
      </div>
    </div>

    <!-- 지출결의서 본문 -->
    <div id="expenseDocBody" style="print-color-adjust:exact">
      <!-- 제목 -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-4">
        <div class="text-center mb-6">
          <h1 class="text-2xl font-bold text-gray-800 mb-1">지  출  결  의  서</h1>
          <div class="text-sm text-gray-500">${App.hospitalName} · ${year}년 ${mm}월</div>
        </div>

        <!-- 요약 그리드 -->
        <div class="grid grid-cols-4 gap-3 mb-6">
          <div class="col-span-1 bg-purple-50 rounded-xl p-3 text-center border border-purple-100">
            <div class="text-xs text-purple-500 mb-1">결제수단</div>
            <div class="text-sm font-bold text-purple-700">법인카드</div>
          </div>
          <div class="col-span-1 bg-purple-50 rounded-xl p-3 text-center border border-purple-100">
            <div class="text-xs text-purple-500 mb-1">사용 기간</div>
            <div class="text-sm font-bold text-purple-700">${year}-${mm}-01 ~ ${year}-${mm}-${new Date(year, month, 0).getDate()}</div>
          </div>
          <div class="col-span-1 bg-purple-50 rounded-xl p-3 text-center border border-purple-100">
            <div class="text-xs text-purple-500 mb-1">총 건수</div>
            <div class="text-sm font-bold text-purple-700">${allExpenses.length}건</div>
          </div>
          <div class="col-span-1 bg-purple-100 rounded-xl p-3 text-center border border-purple-200">
            <div class="text-xs text-purple-600 mb-1 font-semibold">총 금액</div>
            <div class="text-lg font-bold text-purple-800">${monthTotal.toLocaleString()}원</div>
          </div>
        </div>

        <!-- 구분별 소계 -->
        ${Object.values(bySubtype).length > 0 ? `
        <div class="mb-4">
          <h3 class="text-sm font-bold text-gray-700 mb-2"><i class="fas fa-layer-group text-purple-400 mr-1"></i>구분별 소계</h3>
          <div class="grid grid-cols-${Math.min(Object.values(bySubtype).length, 4)} gap-2">
            ${Object.values(bySubtype).map(st => `
            <div class="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <div>
                <span class="inline-block px-2 py-0.5 rounded text-purple-700 text-xs font-bold mr-1" style="background:#f3e8ff">${st.label}</span>
                <span class="text-xs text-gray-400">${st.count}건</span>
              </div>
              <span class="text-sm font-bold text-purple-700">${st.total.toLocaleString()}원</span>
            </div>`).join('')}
          </div>
        </div>` : ''}

        <!-- 상세 내역 테이블 -->
        <h3 class="text-sm font-bold text-gray-700 mb-2"><i class="fas fa-list-alt text-purple-400 mr-1"></i>상세 사용 내역</h3>
        ${allExpenses.length > 0 ? `
        <div class="overflow-x-auto">
          <table class="w-full text-xs border-collapse" id="expenseDocTable">
            <thead>
              <tr style="background:#f3e8ff">
                <th class="border border-purple-200 px-2 py-2 text-left text-purple-800 font-bold">No.</th>
                <th class="border border-purple-200 px-2 py-2 text-left text-purple-800 font-bold">사용일자</th>
                <th class="border border-purple-200 px-2 py-2 text-left text-purple-800 font-bold">지출유형</th>
                <th class="border border-purple-200 px-2 py-2 text-left text-purple-800 font-bold">업체명</th>
                <th class="border border-purple-200 px-2 py-2 text-left text-purple-800 font-bold">사용품목</th>
                <th class="border border-purple-200 px-2 py-2 text-left text-purple-800 font-bold">진행용도</th>
                <th class="border border-purple-200 px-2 py-2 text-right text-purple-800 font-bold">금액</th>
                <th class="border border-purple-200 px-2 py-2 text-left text-purple-800 font-bold">비고</th>
                <th class="border border-purple-200 px-2 py-2 text-center text-purple-800 font-bold no-print">관리</th>
              </tr>
            </thead>
            <tbody>
              ${allExpenses.map((e, i) => `
              <tr style="background:${i%2===0?'white':'#faf5ff'}">
                <td class="border border-purple-100 px-2 py-1.5 text-gray-400">${i+1}</td>
                <td class="border border-purple-100 px-2 py-1.5">${e.expense_date}</td>
                <td class="border border-purple-100 px-2 py-1.5">
                  <span class="inline-block px-1.5 py-0.5 rounded font-semibold text-purple-700" style="background:#f3e8ff;font-size:10px">${e.expense_type||'법인카드'}</span>
                </td>
                <td class="border border-purple-100 px-2 py-1.5 font-medium">${e.vendor_name||e.card_vendor_name||''}</td>
                <td class="border border-purple-100 px-2 py-1.5">${e.item_name||''}</td>
                <td class="border border-purple-100 px-2 py-1.5">${e.purpose||''}</td>
                <td class="border border-purple-100 px-2 py-1.5 text-right font-bold text-purple-700">${(e.amount||0).toLocaleString()}</td>
                <td class="border border-purple-100 px-2 py-1.5 text-gray-400">${e.memo||''}</td>
                <td class="border border-purple-100 px-2 py-1.5 text-center no-print">
                  <button onclick="editExpenseItem(${e.id})" class="text-xs text-indigo-500 hover:text-indigo-700 mr-1"><i class="fas fa-edit"></i></button>
                  <button onclick="deleteExpenseItem(${e.id})" class="text-xs text-red-400 hover:text-red-600"><i class="fas fa-trash"></i></button>
                </td>
              </tr>`).join('')}
            </tbody>
            <tfoot>
              <tr style="background:#ede9fe">
                <td colspan="6" class="border border-purple-200 px-2 py-2 text-right font-bold text-purple-800">합  계</td>
                <td class="border border-purple-200 px-2 py-2 text-right font-bold text-purple-800 text-sm">${monthTotal.toLocaleString()}</td>
                <td colspan="2" class="border border-purple-200 px-2 py-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>` : `
        <div class="text-center py-8 text-gray-400">
          <i class="fas fa-credit-card text-3xl mb-3 text-gray-200"></i>
          <div class="font-semibold">이번 달 지출 내역이 없습니다</div>
          <div class="text-sm mt-1">+ 지출 입력 버튼으로 새 내역을 추가하세요</div>
        </div>`}

        <!-- 결재란 -->
        <div class="mt-8 flex justify-end gap-4">
          ${['작성자', '검토자', '승인자'].map(role => `
          <div class="border-2 border-gray-300 rounded-lg w-28 text-center p-2">
            <div class="text-xs text-gray-500 mb-6 font-semibold">${role}</div>
            <div class="text-xs text-gray-300 mt-2">(서명)</div>
          </div>`).join('')}
        </div>
      </div>
    </div>
  </div>`
}

// ── 지출결의서 직접 입력 기능 ────────────────────────────────
// 지출결의서에 직접 새 항목 추가하는 API (card_expenses POST)
async function saveExpenseDirectly(data) {
  const year = App.currentYear
  const month = App.currentMonth
  const mm = String(month).padStart(2, '0')
  const expDate = data.expenseDate || `${year}-${mm}-${new Date().getDate().toString().padStart(2,'0')}`

  // card_expenses에 직접 INSERT (vendor_id=0 직접 입력형)
  const res = await api('POST', '/api/card-expenses/direct', {
    expense_date: expDate,
    vendor_name:  data.vendorName || '',
    item_name:    data.itemName   || '',
    purpose:      data.purpose    || '',
    amount:       parseInt(data.amount) || 0,
    memo:         data.memo       || '',
    expense_type: data.expenseType || '법인카드'
  })
  return res
}

window.openAddExpenseModal = function(editData) {
  const year  = App.currentYear
  const month = App.currentMonth
  const mm    = String(month).padStart(2, '0')
  const today = `${year}-${mm}-${new Date().getDate().toString().padStart(2,'0')}`
  const EXPENSE_TYPES = ['법인카드','현장구매','추가발주','소모품','기타']

  const isEdit = !!editData?.id
  const modal = document.createElement('div')
  modal.id = 'addExpenseModal'
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50'
  modal.innerHTML = `
    <div class="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-bold text-gray-800"><i class="fas fa-plus-circle text-purple-500 mr-1"></i>${isEdit ? '지출 내역 수정' : '지출 내역 입력'}</h3>
        <button onclick="document.getElementById('addExpenseModal').remove()" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>
      </div>
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs text-gray-500 mb-1 block">사용일자 *</label>
            <input type="date" id="expInput_date" value="${editData?.expense_date||today}" max="${year}-${mm}-31" min="${year}-${mm}-01" class="w-full text-sm border border-gray-200 rounded-lg px-3 py-2">
          </div>
          <div>
            <label class="text-xs text-gray-500 mb-1 block">지출 유형 *</label>
            <select id="expInput_type" class="w-full text-sm border border-gray-200 rounded-lg px-3 py-2">
              ${EXPENSE_TYPES.map(t => `<option value="${t}" ${(editData?.expense_type||'법인카드')===t?'selected':''}>${t}</option>`).join('')}
            </select>
          </div>
        </div>
        <div>
          <label class="text-xs text-gray-500 mb-1 block">업체명 *</label>
          <input type="text" id="expInput_vendor" value="${editData?.vendor_name||''}" placeholder="업체명을 입력하세요" class="w-full text-sm border border-gray-200 rounded-lg px-3 py-2">
        </div>
        <div>
          <label class="text-xs text-gray-500 mb-1 block">사용품목 *</label>
          <input type="text" id="expInput_item" value="${editData?.item_name||''}" placeholder="구입 품목을 입력하세요" class="w-full text-sm border border-gray-200 rounded-lg px-3 py-2">
        </div>
        <div>
          <label class="text-xs text-gray-500 mb-1 block">진행 용도 *</label>
          <input type="text" id="expInput_purpose" value="${editData?.purpose||''}" placeholder="예: 환자식 재료 구입" class="w-full text-sm border border-gray-200 rounded-lg px-3 py-2">
        </div>
        <div>
          <label class="text-xs text-gray-500 mb-1 block">금액 *</label>
          <input type="number" id="expInput_amount" value="${editData?.amount||''}" placeholder="금액 입력 (원)" class="w-full text-sm border border-gray-200 rounded-lg px-3 py-2">
        </div>
        <div>
          <label class="text-xs text-gray-500 mb-1 block">비고</label>
          <input type="text" id="expInput_memo" value="${editData?.memo||''}" placeholder="추가 메모 (선택)" class="w-full text-sm border border-gray-200 rounded-lg px-3 py-2">
        </div>
      </div>
      <div class="flex justify-end gap-2 mt-5">
        <button onclick="document.getElementById('addExpenseModal').remove()" class="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 rounded-lg border border-gray-200">취소</button>
        <button onclick="submitExpenseForm(${isEdit ? editData.id : 'null'})" class="text-sm bg-purple-600 text-white px-5 py-2 rounded-lg hover:bg-purple-700 font-semibold">
          <i class="fas fa-save mr-1"></i>${isEdit ? '수정' : '저장'}
        </button>
      </div>
    </div>
  `
  document.body.appendChild(modal)
}

window.submitExpenseForm = async function(editId) {
  const expDate    = document.getElementById('expInput_date')?.value
  const expType    = document.getElementById('expInput_type')?.value
  const vendorName = document.getElementById('expInput_vendor')?.value?.trim()
  const itemName   = document.getElementById('expInput_item')?.value?.trim()
  const purpose    = document.getElementById('expInput_purpose')?.value?.trim()
  const amount     = parseInt(document.getElementById('expInput_amount')?.value || '0')
  const memo       = document.getElementById('expInput_memo')?.value?.trim()

  if (!expDate || !vendorName || !itemName || !purpose || !amount) {
    showToast('필수 항목을 모두 입력해주세요', 'error')
    return
  }

  const body = { expense_date: expDate, expense_type: expType, vendor_name: vendorName,
                 item_name: itemName, purpose, amount, memo }

  let res
  if (editId) {
    res = await api('PUT', `/api/card-expenses/direct/${editId}`, body)
  } else {
    res = await api('POST', '/api/card-expenses/direct', body)
  }

  if (res?.success || res?.id) {
    showToast(editId ? '지출 내역이 수정되었습니다' : '지출 내역이 저장되었습니다', 'success')
    document.getElementById('addExpenseModal')?.remove()
    renderExpenseDoc()
  } else {
    showToast(res?.error || '저장 실패', 'error')
  }
}

window.editExpenseItem = async function(id) {
  const year  = App.currentYear
  const month = App.currentMonth
  const mm    = String(month).padStart(2, '0')
  const data  = await api('GET', `/api/card-expenses/monthly/${year}/${month}`)
  const item  = (data?.expenses || []).find(e => e.id === id)
  if (!item) { showToast('항목을 찾을 수 없습니다', 'error'); return }
  openAddExpenseModal(item)
}

window.deleteExpenseItem = async function(id) {
  if (!confirm('이 지출 내역을 삭제하시겠습니까?')) return
  const res = await api('DELETE', `/api/card-expenses/direct/${id}`)
  if (res?.success) {
    showToast('삭제되었습니다', 'success')
    renderExpenseDoc()
  } else {
    showToast(res?.error || '삭제 실패', 'error')
  }
}

window.exportExpenseDocExcel = async function() {
  const year = App.currentYear
  const month = App.currentMonth
  const detailData = await api('GET', `/api/card-expenses/monthly/${year}/${month}`)
  const allExpenses = (detailData?.expenses || []).sort((a, b) => a.expense_date.localeCompare(b.expense_date))

  if (allExpenses.length === 0) {
    showToast('다운로드할 데이터가 없습니다', 'error')
    return
  }

  if (typeof XLSX === 'undefined') {
    showToast('엑셀 라이브러리 로딩 중입니다. 잠시 후 다시 시도해주세요.', 'error')
    return
  }

  const mm = String(month).padStart(2, '0')
  const subtypeMap = { food:'식재료', supplies:'소모품', online:'온라인', other:'기타' }
  const hospitalName = App.hospitalName || ''
  const title = `${hospitalName} ${year}년 ${mm}월 법인카드 지출결의서`
  const total = allExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0)

  // ── 구분별 집계 ──
  const subtypeAggr = {}
  allExpenses.forEach(e => {
    const k = e.card_subtype || 'other'
    if (!subtypeAggr[k]) subtypeAggr[k] = { label: subtypeMap[k]||'기타', total: 0, count: 0 }
    subtypeAggr[k].total += Number(e.amount) || 0
    subtypeAggr[k].count++
  })

  // ── 스타일 정의 ──
  const S = {
    title: {
      font: { bold: true, sz: 14, color: { rgb: '1F2937' } },
      fill: { fgColor: { rgb: 'F3F4F6' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: { top:{style:'medium',color:{rgb:'6B7280'}}, bottom:{style:'medium',color:{rgb:'6B7280'}}, left:{style:'medium',color:{rgb:'6B7280'}}, right:{style:'medium',color:{rgb:'6B7280'}} }
    },
    sectionHdr: {
      font: { bold: true, sz: 10, color: { rgb: '5B21B6' } },
      fill: { fgColor: { rgb: 'EDE9FE' } },
      alignment: { horizontal: 'left', vertical: 'center' },
      border: { top:{style:'thin',color:{rgb:'C4B5FD'}}, bottom:{style:'thin',color:{rgb:'C4B5FD'}}, left:{style:'thin',color:{rgb:'C4B5FD'}}, right:{style:'thin',color:{rgb:'C4B5FD'}} }
    },
    colHdr: {
      font: { bold: true, sz: 10, color: { rgb: '374151' } },
      fill: { fgColor: { rgb: 'DDD6FE' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: { top:{style:'thin',color:{rgb:'A78BFA'}}, bottom:{style:'thin',color:{rgb:'A78BFA'}}, left:{style:'thin',color:{rgb:'A78BFA'}}, right:{style:'thin',color:{rgb:'A78BFA'}} }
    },
    data: {
      font: { sz: 10, color: { rgb: '1F2937' } },
      alignment: { vertical: 'center', wrapText: false },
      border: { top:{style:'thin',color:{rgb:'E5E7EB'}}, bottom:{style:'thin',color:{rgb:'E5E7EB'}}, left:{style:'thin',color:{rgb:'E5E7EB'}}, right:{style:'thin',color:{rgb:'E5E7EB'}} }
    },
    dataCenter: {
      font: { sz: 10, color: { rgb: '1F2937' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: { top:{style:'thin',color:{rgb:'E5E7EB'}}, bottom:{style:'thin',color:{rgb:'E5E7EB'}}, left:{style:'thin',color:{rgb:'E5E7EB'}}, right:{style:'thin',color:{rgb:'E5E7EB'}} }
    },
    dataAmt: {
      font: { sz: 10, color: { rgb: '5B21B6' } },
      numFmt: '#,##0',
      alignment: { horizontal: 'right', vertical: 'center' },
      border: { top:{style:'thin',color:{rgb:'E5E7EB'}}, bottom:{style:'thin',color:{rgb:'E5E7EB'}}, left:{style:'thin',color:{rgb:'E5E7EB'}}, right:{style:'thin',color:{rgb:'E5E7EB'}} }
    },
    totalHdr: {
      font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '7C3AED' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: { top:{style:'medium',color:{rgb:'5B21B6'}}, bottom:{style:'medium',color:{rgb:'5B21B6'}}, left:{style:'medium',color:{rgb:'5B21B6'}}, right:{style:'medium',color:{rgb:'5B21B6'}} }
    },
    totalAmt: {
      font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '7C3AED' } },
      numFmt: '#,##0',
      alignment: { horizontal: 'right', vertical: 'center' },
      border: { top:{style:'medium',color:{rgb:'5B21B6'}}, bottom:{style:'medium',color:{rgb:'5B21B6'}}, left:{style:'medium',color:{rgb:'5B21B6'}}, right:{style:'medium',color:{rgb:'5B21B6'}} }
    },
    infoLabel: {
      font: { bold: true, sz: 9, color: { rgb: '6B7280' } },
      fill: { fgColor: { rgb: 'F9FAFB' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: { top:{style:'thin',color:{rgb:'D1D5DB'}}, bottom:{style:'thin',color:{rgb:'D1D5DB'}}, left:{style:'thin',color:{rgb:'D1D5DB'}}, right:{style:'thin',color:{rgb:'D1D5DB'}} }
    },
    infoVal: {
      font: { sz: 9, color: { rgb: '1F2937' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: { top:{style:'thin',color:{rgb:'D1D5DB'}}, bottom:{style:'thin',color:{rgb:'D1D5DB'}}, left:{style:'thin',color:{rgb:'D1D5DB'}}, right:{style:'thin',color:{rgb:'D1D5DB'}} }
    },
    empty: {
      border: { top:{style:'thin',color:{rgb:'F3F4F6'}}, bottom:{style:'thin',color:{rgb:'F3F4F6'}}, left:{style:'thin',color:{rgb:'F3F4F6'}}, right:{style:'thin',color:{rgb:'F3F4F6'}} }
    }
  }

  // ── helper: 셀에 값+스타일 설정 ──
  function sc(ws, r, c, v, t, style) {
    const ref = XLSX.utils.encode_cell({ r, c })
    const cell = { v: v === undefined || v === null ? '' : v }
    if (t) cell.t = t
    else if (typeof v === 'number') cell.t = 'n'
    else cell.t = 's'
    if (style) cell.s = style
    ws[ref] = cell
    // 범위 업데이트
    if (!ws['!ref']) {
      ws['!ref'] = XLSX.utils.encode_range({ s:{r,c}, e:{r,c} })
    } else {
      const range = XLSX.utils.decode_range(ws['!ref'])
      if (r < range.s.r) range.s.r = r
      if (c < range.s.c) range.s.c = c
      if (r > range.e.r) range.e.r = r
      if (c > range.e.c) range.e.c = c
      ws['!ref'] = XLSX.utils.encode_range(range)
    }
    return ws
  }

  const wb = XLSX.utils.book_new()
  const ws = {}
  ws['!merges'] = []
  ws['!rows'] = []
  const COLS = 9 // A~I

  // 열 너비 (단위: 문자 수)
  ws['!cols'] = [
    { wch: 5 },   // A: No.
    { wch: 13 },  // B: 사용일자
    { wch: 9 },   // C: 결제수단
    { wch: 8 },   // D: 구분
    { wch: 18 },  // E: 업체명
    { wch: 20 },  // F: 사용품목
    { wch: 22 },  // G: 구매용도
    { wch: 14 },  // H: 금액
    { wch: 20 }   // I: 메모
  ]

  let row = 0

  // ─── 행 높이 헬퍼 ─────
  function setRowHeight(r, hpx) {
    if (!ws['!rows'][r]) ws['!rows'][r] = {}
    ws['!rows'][r].hpx = hpx
  }

  // ─── 1행: 제목 (A1:I1 병합) ───
  ws['!merges'].push({ s:{r:0,c:0}, e:{r:0,c:8} })
  sc(ws, 0, 0, title, 's', S.title)
  for (let c = 1; c < COLS; c++) sc(ws, 0, c, '', 's', S.title)
  setRowHeight(0, 36)
  row = 1

  // ─── 2행: 빈행 ───
  row = 2

  // ─── 3행: 요약 정보 라벨/값 ───
  // [작성일] [값] [] [기간] [값] [] [총건수] [값] []
  const today = new Date().toLocaleDateString('ko-KR')
  const period = `${year}-${mm}-01 ~ ${year}-${mm}-31`
  sc(ws, row, 0, '작성일', 's', S.infoLabel)
  sc(ws, row, 1, today, 's', S.infoVal)
  sc(ws, row, 2, '', 's', S.empty)
  sc(ws, row, 3, '기간', 's', S.infoLabel)
  ws['!merges'].push({ s:{r:row,c:4}, e:{r:row,c:5} })
  sc(ws, row, 4, period, 's', S.infoVal)
  sc(ws, row, 5, '', 's', S.infoVal)
  sc(ws, row, 6, '총건수', 's', S.infoLabel)
  sc(ws, row, 7, allExpenses.length + '건', 's', S.infoVal)
  sc(ws, row, 8, '', 's', S.empty)
  setRowHeight(row, 22)
  row++

  // ─── 4행: 빈행 ───
  row++

  // ─── 구분별 소계 섹션 ───
  ws['!merges'].push({ s:{r:row,c:0}, e:{r:row,c:8} })
  sc(ws, row, 0, '■ 구분별 소계', 's', S.sectionHdr)
  for (let c = 1; c < COLS; c++) sc(ws, row, c, '', 's', S.sectionHdr)
  setRowHeight(row, 20)
  row++

  // 소계 헤더
  sc(ws, row, 0, '구분', 's', S.colHdr)
  ws['!merges'].push({ s:{r:row,c:1}, e:{r:row,c:6} })
  sc(ws, row, 1, '금액 (원)', 's', S.colHdr)
  for (let c = 2; c <= 6; c++) sc(ws, row, c, '', 's', S.colHdr)
  sc(ws, row, 7, '금액 (원)', 's', S.colHdr)
  sc(ws, row, 8, '건수', 's', S.colHdr)
  setRowHeight(row, 20)
  row++

  Object.values(subtypeAggr).forEach(st => {
    sc(ws, row, 0, st.label, 's', S.dataCenter)
    ws['!merges'].push({ s:{r:row,c:1}, e:{r:row,c:6} })
    sc(ws, row, 1, '', 's', S.data)
    for (let c = 2; c <= 6; c++) sc(ws, row, c, '', 's', S.data)
    sc(ws, row, 7, st.total, 'n', S.dataAmt)
    sc(ws, row, 8, st.count, 'n', S.dataCenter)
    setRowHeight(row, 20)
    row++
  })

  // 빈행
  row++

  // ─── 상세 내역 섹션 ───
  ws['!merges'].push({ s:{r:row,c:0}, e:{r:row,c:8} })
  sc(ws, row, 0, '■ 상세 사용 내역', 's', S.sectionHdr)
  for (let c = 1; c < COLS; c++) sc(ws, row, c, '', 's', S.sectionHdr)
  setRowHeight(row, 20)
  row++

  // 상세 헤더
  const detailHeaders = ['No.', '사용일자', '결제수단', '구분', '업체명', '사용품목', '구매용도', '금액 (원)', '메모']
  detailHeaders.forEach((h, c) => {
    sc(ws, row, c, h, 's', S.colHdr)
  })
  setRowHeight(row, 22)
  row++

  // 상세 데이터 행
  allExpenses.forEach((e, i) => {
    const rowStyles = [S.dataCenter, S.dataCenter, S.dataCenter, S.dataCenter, S.data, S.data, S.data, S.dataAmt, S.data]
    const vals = [
      i + 1,
      e.expense_date,
      '법인카드',
      subtypeMap[e.card_subtype] || '기타',
      e.vendor_name || e.card_vendor_name || e.vendor_display_name || '',
      e.item_name || '',
      e.purpose || '',
      Number(e.amount) || 0,
      e.memo || ''
    ]
    vals.forEach((v, c) => {
      sc(ws, row, c, v, c === 7 ? 'n' : typeof v === 'number' ? 'n' : 's', rowStyles[c])
    })
    setRowHeight(row, 20)
    row++
  })

  // ─── 합계 행 ───
  sc(ws, row, 0, '합계', 's', S.totalHdr)
  ws['!merges'].push({ s:{r:row,c:1}, e:{r:row,c:6} })
  for (let c = 1; c <= 6; c++) sc(ws, row, c, '', 's', S.totalHdr)
  sc(ws, row, 7, total, 'n', S.totalAmt)
  sc(ws, row, 8, allExpenses.length + '건', 's', S.totalHdr)
  setRowHeight(row, 26)
  row++

  // ─── 빈행 ───
  row++

  // ─── 결재란 ───
  ws['!merges'].push({ s:{r:row,c:0}, e:{r:row,c:8} })
  sc(ws, row, 0, '■ 결재', 's', S.sectionHdr)
  for (let c = 1; c < COLS; c++) sc(ws, row, c, '', 's', S.sectionHdr)
  setRowHeight(row, 20)
  row++

  const signRoles = ['작성자', '', '검토자', '', '승인자', '', '']
  const signLabelStyle = {
    font: { bold: true, sz: 10, color: { rgb: '374151' } },
    fill: { fgColor: { rgb: 'F3F4F6' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { top:{style:'thin',color:{rgb:'D1D5DB'}}, bottom:{style:'thin',color:{rgb:'D1D5DB'}}, left:{style:'thin',color:{rgb:'D1D5DB'}}, right:{style:'thin',color:{rgb:'D1D5DB'}} }
  }
  const signBoxStyle = {
    font: { sz: 9, color: { rgb: '9CA3AF' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { top:{style:'thin',color:{rgb:'D1D5DB'}}, bottom:{style:'medium',color:{rgb:'9CA3AF'}}, left:{style:'thin',color:{rgb:'D1D5DB'}}, right:{style:'thin',color:{rgb:'D1D5DB'}} }
  }

  // 결재자 라벨행
  ;[0,2,4].forEach(c => {
    ws['!merges'].push({ s:{r:row,c:c}, e:{r:row,c:c+1} })
    sc(ws, row, c, ['작성자','검토자','승인자'][[0,2,4].indexOf(c)], 's', signLabelStyle)
    sc(ws, row, c+1, '', 's', signLabelStyle)
  })
  sc(ws, row, 6, '', 's', S.empty)
  sc(ws, row, 7, '', 's', S.empty)
  sc(ws, row, 8, '', 's', S.empty)
  setRowHeight(row, 22)
  row++

  // 서명 칸 (2행)
  for (let signRow = 0; signRow < 2; signRow++) {
    ;[0,2,4].forEach(c => {
      ws['!merges'].push({ s:{r:row,c:c}, e:{r:row,c:c+1} })
      sc(ws, row, c, signRow === 0 ? '(서명)' : '', 's', signBoxStyle)
      sc(ws, row, c+1, '', 's', signBoxStyle)
    })
    sc(ws, row, 6, '', 's', S.empty)
    sc(ws, row, 7, '', 's', S.empty)
    sc(ws, row, 8, '', 's', S.empty)
    setRowHeight(row, signRow === 0 ? 30 : 24)
    row++
  }

  XLSX.utils.book_append_sheet(wb, ws, '지출결의서')

  // ── 시트 2: 구분별 집계 ──
  const ws2 = {}
  ws2['!merges'] = []
  ws2['!rows'] = []
  ws2['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 8 }]
  let r2 = 0

  // 제목
  ws2['!merges'].push({ s:{r:0,c:0}, e:{r:0,c:2} })
  sc(ws2, 0, 0, title + ' – 구분별 집계', 's', S.title)
  sc(ws2, 0, 1, '', 's', S.title)
  sc(ws2, 0, 2, '', 's', S.title)
  setRowHeight.call({ '!rows': ws2['!rows'] }, 0, 30)
  ws2['!rows'][0] = { hpx: 30 }
  r2 = 2

  // 헤더
  ;['구분', '금액 (원)', '건수'].forEach((h, c) => sc(ws2, r2, c, h, 's', S.colHdr))
  ws2['!rows'][r2] = { hpx: 22 }
  r2++

  Object.values(subtypeAggr).forEach(st => {
    sc(ws2, r2, 0, st.label, 's', S.dataCenter)
    sc(ws2, r2, 1, st.total, 'n', S.dataAmt)
    sc(ws2, r2, 2, st.count, 'n', S.dataCenter)
    ws2['!rows'][r2] = { hpx: 20 }
    r2++
  })

  r2++ // 빈행
  sc(ws2, r2, 0, '합계', 's', S.totalHdr)
  sc(ws2, r2, 1, total, 'n', S.totalAmt)
  sc(ws2, r2, 2, allExpenses.length, 'n', S.totalHdr)
  ws2['!rows'][r2] = { hpx: 24 }

  // ws2 범위 설정
  ws2['!ref'] = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:r2,c:2} })

  XLSX.utils.book_append_sheet(wb, ws2, '구분별집계')

  // ── 다운로드 ──
  XLSX.writeFile(wb, `법인카드지출결의서_${year}년${mm}월.xlsx`)
  showToast('엑셀 파일이 다운로드되었습니다', 'success')
}

// ══════════════════════════════════════════════════════════════
//  CEO 경영 대시보드
// ══════════════════════════════════════════════════════════════

// ── 공통 헬퍼 ─────────────────────────────────────────────────
const CEO_CARE_TYPE_LABELS = {
  oncology:         '항암',
  nursing_care:     '요양',
  rehab:            '재활',
  oncology_nursing: '항암+요양',
  oncology_rehab:   '항암+재활',
  nursing_rehab:    '요양+재활',
  general:          '일반'
}
const CEO_HOSPITAL_TYPE_LABELS = {
  general:       '종합병원',
  oriental:      '한방병원',
  nursing:       '요양병원',
  rehab:         '재활병원',
  clinic:        '의원',
  care_facility: '요양원'
}
function ceoCareLabel(v)     { return CEO_CARE_TYPE_LABELS[v]    || v || '-' }
function ceoHospTypeLabel(v) { return CEO_HOSPITAL_TYPE_LABELS[v] || v || '-' }

// ── 전역 필터 상태 ──────────────────────────────────────────
window._ceoFilter = {
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  hospitalType: '',
  operationType: '',
  careType: '',
  bedSize: '',
  hospitalId: ''
}

// ── 메인 렌더 함수 ──────────────────────────────────────────
async function renderCeoDashboard() {
  const content = document.getElementById('pageContent')
  if (!content) return
  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`

  try {
    console.log('[CEO] 1. 시작')
    // care_type 목록 로드
    let careTypes = []
    try { careTypes = await api('GET', '/api/ceo-dashboard/care-types') } catch(e) {}
    if (!Array.isArray(careTypes)) careTypes = []
    console.log('[CEO] 2. careTypes:', careTypes.length)

    // 병원 목록 (필터용)
    let allHospitals = []
    try { allHospitals = (await api('GET', '/api/admin/hospitals')) || [] } catch(e) {}
    if (!Array.isArray(allHospitals)) allHospitals = []
    console.log('[CEO] 3. allHospitals:', allHospitals.length)

    if (!window._ceoFilter) {
      const now = new Date()
      window._ceoFilter = { year: now.getFullYear(), month: now.getMonth()+1, hospitalType:'', operationType:'', careType:'', bedSize:'', hospitalId:'' }
    }
    const f = window._ceoFilter
    const qs = new URLSearchParams(Object.fromEntries(
      Object.entries({ hospital_type: f.hospitalType, operation_type: f.operationType, care_type: f.careType, bed_size: f.bedSize, hospital_id: f.hospitalId }).filter(([,v]) => v)
    )).toString()
    const qsStr = qs ? `?${qs}` : ''
    console.log('[CEO] 4. API 호출 시작')

    // 병렬 API 호출
    const [kpiData, hospitalsData, graphsData, alertsData, expensesData] = await Promise.all([
      api('GET', `/api/ceo-dashboard/kpi/${f.year}/${f.month}${qsStr}`).catch(() => null),
      api('GET', `/api/ceo-dashboard/hospitals/${f.year}/${f.month}${qsStr}`).catch(() => []),
      api('GET', `/api/ceo-dashboard/graphs/${f.year}/${f.month}`).catch(() => null),
      api('GET', `/api/ceo-dashboard/alerts/${f.year}/${f.month}`).catch(() => null),
      api('GET', `/api/ceo-dashboard/expenses/${f.year}/${f.month}${qsStr}`).catch(() => [])
    ])
    console.log('[CEO] 5. API 완료 kpi:', !!kpiData, 'hospitals:', Array.isArray(hospitalsData)?hospitalsData.length:'err', 'graphs:', !!graphsData, 'alerts:', !!alertsData, 'expenses:', Array.isArray(expensesData)?expensesData.length:'err')

    const safeHospitals = Array.isArray(hospitalsData) ? hospitalsData : []
    const safeExpenses  = Array.isArray(expensesData)  ? expensesData  : []

    console.log('[CEO] 6. HTML 렌더링 시작')
    const filterBarHtml = renderCeoFilterBar(f, careTypes, allHospitals)
    console.log('[CEO] 6a. filterBar OK')
    const kpiHtml = renderCeoKpi(kpiData)
    console.log('[CEO] 6b. KPI OK')
    const hospitalCardsHtml = renderCeoHospitalCards(safeHospitals)
    console.log('[CEO] 6c. HospitalCards OK')
    const graphSectionHtml = renderCeoGraphSection()
    console.log('[CEO] 6d. GraphSection OK')
    const alertsHtml = renderCeoAlerts(alertsData)
    console.log('[CEO] 6e. Alerts OK')
    const expensesHtml = renderCeoExpenses(safeExpenses, f)
    console.log('[CEO] 6f. Expenses OK')

    content.innerHTML = `
      <!-- 상단 필터 바 -->
      <div id="ceoFilterBar" class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-5 sticky top-0 z-10">
        ${filterBarHtml}
      </div>

      <!-- KPI 카드 8개 -->
      <div id="ceoKpiSection" class="mb-5">
        ${kpiHtml}
      </div>

      <!-- 병원 운영 상태 카드 -->
      <div id="ceoHospitalCards" class="mb-5">
        ${hospitalCardsHtml}
      </div>

      <!-- 비교 그래프 4종 -->
      <div id="ceoGraphSection" class="mb-5">
        ${graphSectionHtml}
      </div>

      <!-- AI 경고 + 인사이트 -->
      <div id="ceoAlertsSection" class="mb-5">
        ${alertsHtml}
      </div>

      <!-- 지출 사용내역 조회 -->
      <div id="ceoExpensesSection">
        ${expensesHtml}
      </div>
    `
    console.log('[CEO] 7. innerHTML 설정 완료')

    // 차트 렌더 (DOM 완성 후)
    requestAnimationFrame(() => {
      renderCeoCharts(graphsData, safeHospitals)
      console.log('[CEO] 8. 차트 렌더 완료')
    })
  } catch(err) {
    console.error('[CeoDashboard] 렌더링 오류:', err)
    content.innerHTML = `
      <div class="bg-white rounded-2xl border border-red-100 p-8 text-center">
        <i class="fas fa-exclamation-triangle text-red-400 text-2xl mb-3"></i>
        <p class="text-sm text-red-600 font-bold mb-1">경영 대시보드 로딩 실패</p>
        <p class="text-xs text-gray-400 mb-4">${err?.message || String(err)}</p>
        <button onclick="renderCeoDashboard()" class="text-xs bg-indigo-500 text-white rounded-lg px-4 py-2 hover:bg-indigo-600">다시 시도</button>
      </div>
    `
  }
}

// ── 필터 바 ────────────────────────────────────────────────
function renderCeoFilterBar(f, careTypes, hospitals) {
  const months = Array.from({length: 12}, (_, i) => i + 1)
  const years  = [f.year - 1, f.year, f.year + 1]
  return `
    <div class="flex flex-wrap gap-2 items-center">
      <i class="fas fa-filter text-indigo-400 mr-1"></i>

      <!-- 기준 년월 -->
      <select id="ceoFilterYear" onchange="ceoFilterChange()" class="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50">
        ${years.map(y => `<option value="${y}" ${f.year===y?'selected':''}>${y}년</option>`).join('')}
      </select>
      <select id="ceoFilterMonth" onchange="ceoFilterChange()" class="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50">
        ${months.map(m => `<option value="${m}" ${f.month===m?'selected':''}>${m}월</option>`).join('')}
      </select>

      <div class="w-px h-5 bg-gray-200 mx-1"></div>

      <!-- 병원 유형 -->
      <select id="ceoFilterHospType" onchange="ceoFilterChange()" class="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50">
        <option value="">전체 병원유형</option>
        ${Object.entries(CEO_HOSPITAL_TYPE_LABELS).map(([v,l]) =>
          `<option value="${v}" ${f.hospitalType===v?'selected':''}>${l}</option>`
        ).join('')}
      </select>

      <!-- 운영 방식 (operation_type: 직영/위탁) -->
      <select id="ceoFilterOperationType" onchange="ceoFilterChange()" class="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50">
        <option value="">전체 운영방식</option>
        <option value="direct"    ${f.operationType==='direct'    ?'selected':''}>직영</option>
        <option value="consigned" ${f.operationType==='consigned' ?'selected':''}>위탁</option>
      </select>

      <!-- 케어 유형 (care_type) -->
      <select id="ceoFilterCareType" onchange="ceoFilterChange()" class="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50">
        <option value="">전체 케어유형</option>
        ${(careTypes.length > 0 ? careTypes : Object.entries(CEO_CARE_TYPE_LABELS).map(([code,label_ko]) => ({code,label_ko}))).map(ct =>
          `<option value="${ct.code}" ${f.careType===ct.code?'selected':''}>${ct.label_ko}</option>`
        ).join('')}
      </select>

      <!-- 병상 규모 -->
      <select id="ceoFilterBedSize" onchange="ceoFilterChange()" class="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50">
        <option value="">전체 병상규모</option>
        <option value="under30"  ${f.bedSize==='under30' ?'selected':''}>30병상 이하</option>
        <option value="31to60"   ${f.bedSize==='31to60'  ?'selected':''}>31~60병상</option>
        <option value="61to100"  ${f.bedSize==='61to100' ?'selected':''}>61~100병상</option>
        <option value="over100"  ${f.bedSize==='over100' ?'selected':''}>100병상 이상</option>
      </select>

      <!-- 병원 직접 선택 -->
      <select id="ceoFilterHospital" onchange="ceoFilterChange()" class="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50">
        <option value="">전체 병원</option>
        ${hospitals.map(h => `<option value="${h.id}" ${f.hospitalId==h.id?'selected':''}>${h.name}</option>`).join('')}
      </select>

      <button onclick="ceoFilterReset()" class="text-xs text-gray-400 hover:text-red-400 ml-1">
        <i class="fas fa-times-circle"></i> 초기화
      </button>
    </div>
  `
}

window.ceoFilterChange = function() {
  const f = window._ceoFilter
  f.year          = parseInt(document.getElementById('ceoFilterYear')?.value         || f.year)
  f.month         = parseInt(document.getElementById('ceoFilterMonth')?.value        || f.month)
  f.hospitalType  = document.getElementById('ceoFilterHospType')?.value      || ''
  f.operationType = document.getElementById('ceoFilterOperationType')?.value || ''
  f.careType      = document.getElementById('ceoFilterCareType')?.value      || ''
  f.bedSize       = document.getElementById('ceoFilterBedSize')?.value       || ''
  f.hospitalId    = document.getElementById('ceoFilterHospital')?.value      || ''
  renderCeoDashboard()
}
window.ceoFilterReset = function() {
  const now = new Date()
  window._ceoFilter = { year: now.getFullYear(), month: now.getMonth()+1, hospitalType:'', operationType:'', careType:'', bedSize:'', hospitalId:'' }
  renderCeoDashboard()
}

// ── KPI 카드 ────────────────────────────────────────────────
function renderCeoKpi(d) {
  if (!d) return '<div class="text-center text-gray-400 py-6 text-sm">데이터를 불러오는 중...</div>'
  const fmtW = v => v >= 10000 ? `${Math.round(v/10000)}만` : v >= 1000 ? `${(v/1000).toFixed(1)}천` : (v||0).toLocaleString()
  const fmtKo = v => (v||0).toLocaleString()

  const catPrices = d.mealPriceByCategory || {}
  const catItems = Object.entries(catPrices)
    .filter(([,v]) => v && (v.avgPrice > 0 || v.targetPrice > 0))
    .map(([k,v]) => ({
      key: k,
      label: v.label || (k === 'cancer' ? '항암' : k === 'nursing' ? '요양' : k) + ' 식단가',
      color: k==='cancer'?'#7c3aed':k==='nursing'?'#0891b2':'#059669',
      price: v.avgPrice || 0,
      targetPrice: v.targetPrice || 0
    }))

  const cards = [
    { icon:'fa-hospital',      color:'#4f46e5', label:'운영 병원',     value:`${d.hospitalCount||0}개`,          sub:'' },
    { icon:'fa-coins',         color:'#0891b2', label:'그룹 총 예산',   value:`${fmtW(d.totalBudget)}원`,        sub:'' },
    { icon:'fa-shopping-cart', color:'#059669', label:'그룹 총 사용',   value:`${fmtW(d.totalUsed)}원`,          sub:'' },
    { icon:'fa-percent',       color: d.avgBudgetPct>=90?'#dc2626':d.avgBudgetPct>=80?'#f59e0b':'#059669',
                                              label:'평균 예산 사용률', value:`${d.avgBudgetPct||0}%`,           sub:'', danger: d.avgBudgetPct>=90, warn: d.avgBudgetPct>=80 },
    { icon:'fa-utensils',      color:'#7c3aed', label:'평균 식단가',    value:`${fmtKo(d.avgMealPrice)}원`,      sub:'' },
    { icon:'fa-exclamation-triangle', color:'#dc2626', label:'예산 위험 병원', value:`${d.dangerBudgetCount||0}개`, sub:'90% 초과', danger: d.dangerBudgetCount>0 },
    { icon:'fa-chart-line',    color:'#f59e0b', label:'식단가 위험 병원', value:`${d.dangerMealCount||0}개`,     sub:'목표 110%↑', warn: d.dangerMealCount>0 },
    { icon:'fa-clipboard-check', color:'#6b7280', label:'검수 미완료 병원', value:`${d.pendingInspectCount||0}개`, sub:'확인 필요', warn: d.pendingInspectCount>0 }
  ]

  const mainCards = cards.map(c => `
    <div class="bg-white rounded-xl border ${c.danger?'border-red-200 bg-red-50':c.warn?'border-yellow-200 bg-yellow-50':'border-gray-100'} p-4 flex items-center gap-3">
      <div class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style="background:${c.color}18">
        <i class="fas ${c.icon} text-sm" style="color:${c.color}"></i>
      </div>
      <div class="min-w-0">
        <div class="text-xs text-gray-500 mb-0.5">${c.label}</div>
        <div class="text-lg font-bold" style="color:${c.color}">${c.value}</div>
        ${c.sub ? `<div class="text-xs text-gray-400">${c.sub}</div>` : ''}
      </div>
    </div>
  `).join('')

  const catCardsHtml = catItems.length > 0 ? `
    <div class="bg-white rounded-xl border border-gray-100 p-4 col-span-full">
      <div class="text-xs font-bold text-gray-600 mb-3"><i class="fas fa-utensils text-purple-400 mr-1"></i>케어유형별 평균 식단가</div>
      <div class="flex gap-4 flex-wrap">
        ${catItems.map(c => {
          const tpct = c.targetPrice > 0 && c.price > 0 ? Math.round(c.price/c.targetPrice*100) : null
          const tColor = tpct === null ? '' : tpct>=110 ? '#dc2626' : tpct>=105 ? '#f59e0b' : '#059669'
          return `
          <div class="text-center px-3">
            <div class="text-xs text-gray-400 mb-1">${c.label}</div>
            <div class="text-base font-bold" style="color:${c.color}">${fmtKo(c.price)}원</div>
            ${c.targetPrice > 0 ? `<div class="text-xs" style="color:${tColor}">목표 ${fmtKo(c.targetPrice)}원${tpct!==null?` (${tpct}%)`:''}</div>` : ''}
          </div>`
        }).join('<div class="w-px bg-gray-200 self-stretch"></div>')}
      </div>
    </div>
  ` : ''

  return `
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      ${mainCards}
      ${catCardsHtml}
    </div>
  `
}

// ── 병원 운영 상태 카드 ──────────────────────────────────────
function renderCeoHospitalCards(hospitals) {
  if (!hospitals.length) return `
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center text-gray-400">
      <i class="fas fa-hospital text-3xl mb-3 text-gray-200"></i>
      <p class="text-sm">선택한 필터에 해당하는 병원이 없습니다</p>
    </div>`

  const fmtMan = v => v >= 10000 ? `${Math.round(v/10000)}만` : (v||0).toLocaleString()
  const fmtKo  = v => (v||0).toLocaleString()

  // 위험도 정렬: danger → warn → safe
  const sorted = [...hospitals].sort((a, b) => {
    const order = { danger:0, warn:1, safe:2 }
    return (order[a.riskLevel]||2) - (order[b.riskLevel]||2)
  })

  const cards = sorted.map(h => {
    const riskBg    = h.riskLevel==='danger' ? '#fef2f2' : h.riskLevel==='warn' ? '#fffbeb' : '#f0fdf4'
    const riskBorder= h.riskLevel==='danger' ? '#fecaca' : h.riskLevel==='warn' ? '#fde68a' : '#bbf7d0'
    const riskBadge = h.riskLevel==='danger'
      ? `<span class="text-xs font-bold text-white bg-red-500 rounded px-1.5 py-0.5">🔴 위험</span>`
      : h.riskLevel==='warn'
      ? `<span class="text-xs font-bold text-white bg-yellow-500 rounded px-1.5 py-0.5">🟡 주의</span>`
      : `<span class="text-xs font-bold text-white bg-green-500 rounded px-1.5 py-0.5">🟢 정상</span>`

    const budgetPct  = h.budgetPct || 0
    const barColor   = budgetPct>=90?'#ef4444':budgetPct>=80?'#f59e0b':'#4f46e5'
    const mpPct      = (h.targetMealPrice||0) > 0 ? Math.round((h.mealPrice||0)/(h.targetMealPrice)*100) : (h.mpPct || null)
    const mpColor    = mpPct===null?'#9ca3af':mpPct>=110?'#dc2626':mpPct>=105?'#f59e0b':'#059669'

    const catMpHtml  = Object.entries(h.mealPriceByCategory||{})
      .filter(([,v]) => v && v.price > 0)
      .map(([k,v]) => {
        const tpct = v.targetPrice > 0 ? Math.round(v.price/v.targetPrice*100) : null
        const col = tpct !== null ? (tpct>=110?'color:#dc2626':tpct>=105?'color:#f59e0b':'color:#059669') : ''
        return `<span class="text-xs text-gray-500">${v.name||k} <b style="${col}">${fmtKo(v.price)}원</b>${tpct!==null?`<span class="text-gray-400">(목표${tpct}%)</span>`:''}</span>`
      })
      .join(' · ')

    const alertHtml  = h.alerts?.length
      ? `<div class="mt-2 flex flex-wrap gap-1">${h.alerts.map(a => `<span class="text-xs bg-red-50 text-red-600 border border-red-100 rounded px-1.5 py-0.5">${a}</span>`).join('')}</div>`
      : ''

    return `
      <div class="rounded-xl border p-4" style="background:${riskBg};border-color:${riskBorder}">
        <div class="flex items-start justify-between mb-2">
          <div>
            <div class="font-bold text-gray-800 text-sm">${h.name}</div>
            <div class="text-xs text-gray-500 mt-0.5">
              ${ceoHospTypeLabel(h.hospitalType)} · ${ceoCareLabel(h.careType)} · ${h.licensedBeds||'-'}병상
            </div>
          </div>
          ${riskBadge}
        </div>

        <!-- 예산 -->
        <div class="mb-2">
          <div class="flex justify-between text-xs mb-1">
            <span class="text-gray-500">예산 사용률</span>
            <span class="font-bold" style="color:${barColor}">${budgetPct}%</span>
          </div>
          <div class="bg-white bg-opacity-60 rounded h-1.5 overflow-hidden">
            <div style="width:${Math.min(budgetPct,100)}%;height:100%;background:${barColor};border-radius:3px"></div>
          </div>
          <div class="text-xs text-gray-400 mt-0.5">
            사용 ${fmtMan(h.used)}원 · 목표 ${fmtMan(h.budget)}원 · 잔여 ${fmtMan(h.remaining)}원
          </div>
        </div>

        <!-- 식단가 -->
        <div class="flex items-center justify-between text-xs mb-1">
          <span class="text-gray-500">전체 식단가</span>
          <span class="font-bold" style="color:${mpColor}">${fmtKo(h.mealPrice)}원 ${mpPct!==null?`<span class="text-gray-400">(목표${mpPct}%)</span>`:''} <span class="text-gray-400 font-normal">${fmtKo(h.totalMeals)}식</span></span>
        </div>
        ${catMpHtml ? `<div class="text-xs flex flex-wrap gap-2 mb-1">${catMpHtml}</div>` : ''}

        <!-- 기타 지표 -->
        <div class="flex gap-3 text-xs text-gray-500 mt-1">
          <span><i class="fas fa-users mr-0.5"></i>총 ${fmtKo(h.totalMeals)}식</span>
          <span><i class="fas fa-shopping-cart mr-0.5"></i>오늘 ${fmtMan(h.todayOrder)}원</span>
          ${h.pendingInspections>0?`<span class="text-yellow-600"><i class="fas fa-clipboard mr-0.5"></i>검수${h.pendingInspections}건</span>`:''}
          ${h.vendorConcentration>=40?`<span class="text-orange-500"><i class="fas fa-store mr-0.5"></i>집중도${h.vendorConcentration}%</span>`:''}
        </div>
        ${alertHtml}
      </div>
    `
  }).join('')

  return `
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="font-bold text-gray-800 text-sm flex items-center gap-1.5">
          <i class="fas fa-hospital text-indigo-500"></i> 병원 운영 상태
          <span class="text-xs font-normal text-gray-400">(${hospitals.length}개 병원)</span>
        </h2>
        <div class="flex gap-2 text-xs text-gray-400">
          <span>🔴 위험: ${hospitals.filter(h=>h.riskLevel==='danger').length}</span>
          <span>🟡 주의: ${hospitals.filter(h=>h.riskLevel==='warn').length}</span>
          <span>🟢 정상: ${hospitals.filter(h=>h.riskLevel==='safe').length}</span>
        </div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">${cards}</div>
    </div>
  `
}

// ── 비교 그래프 섹션 HTML ────────────────────────────────────
function renderCeoGraphSection() {
  return `
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <h2 class="font-bold text-gray-800 text-sm flex items-center gap-1.5 mb-4">
        <i class="fas fa-chart-bar text-indigo-500"></i> 병원 비교 분석
      </h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <div class="text-xs font-bold text-gray-600 mb-2">① 병원유형별 평균 예산 사용률</div>
          <canvas id="ceoChart1" height="160"></canvas>
        </div>
        <div>
          <div class="text-xs font-bold text-gray-600 mb-2">② 케어유형별 평균 식단가</div>
          <canvas id="ceoChart2" height="160"></canvas>
        </div>
        <div>
          <div class="text-xs font-bold text-gray-600 mb-2">③ 병원별 식단가 비교</div>
          <canvas id="ceoChart3" height="160"></canvas>
        </div>
        <div>
          <div class="text-xs font-bold text-gray-600 mb-1">④ 식수 vs 발주금액 (발주 적정성)</div>
          <div class="text-xs text-gray-400 mb-2">X축: 월 총 식수(식), Y축: 월 총 발주금액(원) — 점이 위에 있을수록 발주 단가가 높음</div>
          <canvas id="ceoChart4" height="160"></canvas>
        </div>
      </div>
    </div>
  `
}

// ── 비교 그래프 렌더 (Chart.js) ──────────────────────────────
function renderCeoCharts(graphsData, hospitals) {
  if (!graphsData) return

  // 기존 차트 정리
  ['_ceoChart1','_ceoChart2','_ceoChart3','_ceoChart4'].forEach(k => {
    if (window[k]) { try { window[k].destroy() } catch(e) {} }
  })

  const PALETTE = ['#4f46e5','#0891b2','#059669','#f59e0b','#dc2626','#7c3aed','#db2777','#ea580c']

  // 그래프 1: 병원유형별 평균 예산 사용률 (가로 막대)
  const ctx1 = document.getElementById('ceoChart1')
  if (ctx1 && graphsData.graph1?.length) {
    const labels = graphsData.graph1.map(d => ceoHospTypeLabel(d.type))
    const values = graphsData.graph1.map(d => d.avgBudgetPct)
    const bgColors = values.map(v => v>=90?'#fca5a5':v>=80?'#fde68a':'#a5b4fc')
    window._ceoChart1 = new Chart(ctx1, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: '예산 사용률(%)', data: values, backgroundColor: bgColors, borderRadius: 4 }]
      },
      options: {
        indexAxis: 'y', responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${ctx.raw}%` } },
          datalabels: { display: false }
        },
        scales: { x: { max: 100, ticks: { callback: v => `${v}%`, font: { size: 10 } } }, y: { ticks: { font: { size: 10 } } } },
        animation: {
          onComplete: function() {
            const chart = this
            const ctx = chart.ctx
            ctx.font = 'bold 10px sans-serif'
            ctx.fillStyle = '#374151'
            chart.data.datasets[0].data.forEach((val, i) => {
              const meta = chart.getDatasetMeta(0)
              const bar  = meta.data[i]
              ctx.fillText(`${val}%`, bar.x + 4, bar.y + 4)
            })
          }
        }
      }
    })
  }

  // 그래프 2: 케어유형별 평균 식단가 (막대 + 목표선)
  const ctx2 = document.getElementById('ceoChart2')
  if (ctx2 && graphsData.graph2) {
    // graph2는 {catKey: {avgPrice, label, targetPrice}} 구조
    const g2entries = Object.entries(graphsData.graph2).filter(([,v]) => v && (v.avgPrice > 0 || v.targetPrice > 0))
    if (g2entries.length === 0) {
      const p = document.createElement('p')
      p.style = 'text-align:center;color:#9ca3af;font-size:11px;padding:20px'
      p.textContent = '식수 데이터 없음 (daily_meals 미입력)'
      ctx2.parentNode.replaceChild(p, ctx2)
    } else {
      const labels2  = g2entries.map(([,v]) => v.label || v)
      const values2  = g2entries.map(([,v]) => v.avgPrice || 0)
      const targets2 = g2entries.map(([,v]) => v.targetPrice || null)
      const bgColors2 = g2entries.map(([,v]) => {
        if (!v.targetPrice || !v.avgPrice) return '#a78bfa'
        return v.avgPrice >= v.targetPrice * 1.1 ? '#fca5a5' : v.avgPrice >= v.targetPrice * 1.05 ? '#fde68a' : '#a78bfa'
      })
      window._ceoChart2 = new Chart(ctx2, {
        type: 'bar',
        data: {
          labels: labels2,
          datasets: [
            { label: '평균 식단가(원)', data: values2, backgroundColor: bgColors2, borderRadius: 4 },
            { label: '목표 식단가', data: targets2, type: 'line', borderColor: '#94a3b8', borderDash: [4,3], borderWidth: 1.5, pointRadius: 3, fill: false }
          ]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { labels: { font: { size: 9 }, boxWidth: 10 } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${(ctx.raw||0).toLocaleString()}원` } }
          },
          scales: {
            y: { ticks: { callback: v => `${Math.round(v/1000)}천`, font: { size: 10 } } },
            x: { ticks: { font: { size: 10 } } }
          },
          animation: {
            onComplete: function() {
              const chart = this
              const ctx = chart.ctx
              ctx.font = 'bold 10px sans-serif'
              ctx.textAlign = 'center'
              const meta = chart.getDatasetMeta(0)
              meta.data.forEach((bar, i) => {
                const val = chart.data.datasets[0].data[i]
                const tgt = chart.data.datasets[1].data[i]
                if (val > 0) {
                  ctx.fillStyle = tgt && val >= tgt * 1.1 ? '#dc2626' : '#374151'
                  ctx.fillText(`${val.toLocaleString()}원`, bar.x, bar.y - 4)
                }
              })
            }
          }
        }
      })
    }
  }

  // 그래프 3: 병원별 식단가 비교
  const ctx3 = document.getElementById('ceoChart3')
  if (ctx3 && graphsData.graph3?.length) {
    const g3 = [...graphsData.graph3].sort((a,b) => b.mealPrice - a.mealPrice)
    const labels = g3.map(d => d.name.length>5 ? d.name.slice(0,5)+'…' : d.name)
    const values = g3.map(d => d.mealPrice)
    const targets = g3.map(d => d.target || null)
    const bgColors = g3.map(d => {
      if (!d.target) return '#a5b4fc'
      const r = d.mealPrice/d.target
      return r >= 1.1 ? '#fca5a5' : r >= 1.05 ? '#fde68a' : '#a5b4fc'
    })
    window._ceoChart3 = new Chart(ctx3, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '식단가', data: values, backgroundColor: bgColors, borderRadius: 3 },
          { label: '목표', data: targets, type: 'line', borderColor: '#94a3b8', borderDash: [4,3], borderWidth: 1.5, pointRadius: 2, fill: false }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { font: { size: 9 }, boxWidth: 10 } },
          tooltip: { callbacks: { label: ctx => `${ctx.raw?.toLocaleString()}원` } }
        },
        scales: {
          y: { ticks: { callback: v => `${Math.round(v/1000)}천`, font: { size: 9 } } },
          x: { ticks: { font: { size: 9 }, maxRotation: 30 } }
        },
        animation: {
          onComplete: function() {
            const chart = this
            const ctx = chart.ctx
            ctx.font = 'bold 9px sans-serif'
            ctx.fillStyle = '#374151'
            ctx.textAlign = 'center'
            const meta0 = chart.getDatasetMeta(0)
            meta0.data.forEach((bar, i) => {
              const val = chart.data.datasets[0].data[i]
              if (val > 0) ctx.fillText(`${val.toLocaleString()}원`, bar.x, bar.y - 4)
            })
          }
        }
      }
    })
  }

  // 그래프 4: 식수 vs 발주금액 (산점도)
  const ctx4 = document.getElementById('ceoChart4')
  if (ctx4 && graphsData.graph4?.length) {
    const normal  = graphsData.graph4.filter(d => !d.anomaly)
    const anomaly = graphsData.graph4.filter(d =>  d.anomaly)
    window._ceoChart4 = new Chart(ctx4, {
      type: 'scatter',
      data: {
        datasets: [
          { label: '정상', data: normal.map(d => ({x:d.meals,y:d.used,name:d.name})), backgroundColor: '#818cf8', pointRadius: 5 },
          { label: '주의', data: anomaly.map(d => ({x:d.meals,y:d.used,name:d.name})), backgroundColor: '#f87171', pointRadius: 7, pointStyle: 'triangle' }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { font:{size:9}, boxWidth:10 } },
          tooltip: { callbacks: { label: ctx => `${ctx.raw.name}: 식수 ${ctx.raw.x.toLocaleString()}식, 발주 ${Math.round(ctx.raw.y/10000)}만원` } }
        },
        scales: {
          x: { title: { display:true, text:'총 식수', font:{size:9} }, ticks: { font:{size:9} } },
          y: { title: { display:true, text:'발주금액(원)', font:{size:9} }, ticks: { callback: v => `${Math.round(v/10000)}만`, font:{size:9} } }
        }
      }
    })
  }
}

// ── AI 경고 & 인사이트 ──────────────────────────────────────
function renderCeoAlerts(data) {
  const alerts   = data?.alerts   || []
  const insights = data?.insights || []

  const alertHtml = alerts.length === 0
    ? `<div class="text-sm text-green-600 font-medium py-2"><i class="fas fa-check-circle mr-1"></i>이번 달 특이 경고 사항이 없습니다.</div>`
    : alerts.map(a => {
        const bg  = a.level==='danger' ? '#fef2f2' : '#fffbeb'
        const bc  = a.level==='danger' ? '#fecaca' : '#fde68a'
        const ic  = a.level==='danger' ? 'fa-exclamation-circle text-red-500' : 'fa-exclamation-triangle text-yellow-500'
        return `<div class="flex items-start gap-2 p-3 rounded-lg text-sm mb-2" style="background:${bg};border:1px solid ${bc}">
          <i class="fas ${ic} mt-0.5 flex-shrink-0"></i>
          <span class="text-gray-700">${a.message}</span>
        </div>`
      }).join('')

  const insightHtml = insights.length === 0 ? '' : `
    <div class="mt-4 pt-4 border-t border-gray-100">
      <div class="text-xs font-bold text-gray-600 mb-3"><i class="fas fa-lightbulb text-amber-400 mr-1"></i>AI 운영 인사이트</div>
      ${insights.map(s => `
        <div class="flex items-start gap-2 text-sm text-gray-600 mb-2">
          <i class="fas fa-angle-right text-indigo-300 mt-1 flex-shrink-0"></i>
          <span>${s}</span>
        </div>
      `).join('')}
    </div>
  `

  return `
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <h2 class="font-bold text-gray-800 text-sm flex items-center gap-1.5 mb-4">
        <i class="fas fa-bell text-red-400"></i> AI 경고 시스템
        ${alerts.length>0 ? `<span class="text-xs bg-red-100 text-red-600 rounded-full px-2 py-0.5 font-bold">${alerts.length}건</span>` : ''}
      </h2>
      ${alertHtml}
      ${insightHtml}
    </div>
  `
}

// ── 지출 사용내역 조회 ──────────────────────────────────────
function renderCeoExpenses(expenses, f) {
  const EXPENSE_TYPES = ['법인카드','현장구매','추가발주','소모품','기타']
  const fmtKo = v => (v||0).toLocaleString()

  const total = expenses.reduce((s, e) => s + (e.amount||0), 0)
  const rows  = expenses.slice(0, 200).map(e => `
    <tr class="border-b border-gray-50 hover:bg-gray-50">
      <td class="py-2 px-3 text-xs text-gray-500">${e.expense_date}</td>
      <td class="py-2 px-3 text-xs font-medium text-gray-800">${e.hospital_name}</td>
      <td class="py-2 px-3 text-xs text-gray-600">${e.vendor_name||'-'}</td>
      <td class="py-2 px-3 text-xs font-bold text-right text-indigo-600">${fmtKo(e.amount)}원</td>
      <td class="py-2 px-3 text-xs text-gray-600">${e.item_name||'-'}</td>
      <td class="py-2 px-3 text-xs text-gray-500">${e.usage_purpose||'-'}</td>
      <td class="py-2 px-3">
        <span class="text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">${e.expense_type||'-'}</span>
      </td>
      <td class="py-2 px-3 text-xs text-gray-400">${e.memo||''}</td>
    </tr>
  `).join('')

  return `
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="font-bold text-gray-800 text-sm flex items-center gap-1.5">
          <i class="fas fa-receipt text-indigo-500"></i> 지출 사용내역 조회
        </h2>
        <div class="flex items-center gap-2">
          <select id="ceoExpenseType" onchange="ceoExpenseTypeFilter()" class="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50">
            <option value="">전체 유형</option>
            ${EXPENSE_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
          </select>
          <span class="text-xs text-gray-500">총 ${fmtKo(total)}원 · ${expenses.length}건</span>
        </div>
      </div>
      ${expenses.length === 0
        ? `<div class="text-center text-gray-400 py-8 text-sm">이번 달 지출 내역이 없습니다</div>`
        : `<div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-gray-100">
                  <th class="text-left py-2 px-3 text-xs font-bold text-gray-500">날짜</th>
                  <th class="text-left py-2 px-3 text-xs font-bold text-gray-500">병원</th>
                  <th class="text-left py-2 px-3 text-xs font-bold text-gray-500">업체</th>
                  <th class="text-right py-2 px-3 text-xs font-bold text-gray-500">금액</th>
                  <th class="text-left py-2 px-3 text-xs font-bold text-gray-500">사용 품목</th>
                  <th class="text-left py-2 px-3 text-xs font-bold text-gray-500">진행 용도</th>
                  <th class="text-left py-2 px-3 text-xs font-bold text-gray-500">지출 유형</th>
                  <th class="text-left py-2 px-3 text-xs font-bold text-gray-500">비고</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
            ${expenses.length > 200 ? `<div class="text-center text-xs text-gray-400 mt-2">최대 200건 표시 · 전체 ${expenses.length}건</div>` : ''}
          </div>`}
    </div>
  `
}

window.ceoExpenseTypeFilter = function() {
  const type = document.getElementById('ceoExpenseType')?.value || ''
  const f    = window._ceoFilter
  const qs   = new URLSearchParams({
    ...(f.hospitalId && { hospital_id: f.hospitalId }),
    ...(type         && { expense_type: type })
  }).toString()
  api('GET', `/api/ceo-dashboard/expenses/${f.year}/${f.month}${qs?`?${qs}`:''}`)
    .then(data => {
      const el = document.getElementById('ceoExpensesSection')
      if (el) el.innerHTML = renderCeoExpenses(data||[], f)
      const sel = document.getElementById('ceoExpenseType')
      if (sel) sel.value = type
    })
}


// ══════════════════════════════════════════════════════════════════════
// 거래명세서 분석 페이지 (transaction-analysis)
// ══════════════════════════════════════════════════════════════════════

// ── 전역 상태 ──────────────────────────────────────────────────────────
const TXState = {
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  tab: 'upload',       // upload | preview | monthly | cross
  currentFileId: null,
  previewItems: [],
  categories: [],
  charts: {}
}

// ── 차트 정리 헬퍼 ────────────────────────────────────────────────────
function txDestroyCharts() {
  Object.values(TXState.charts).forEach(c => { try { c.destroy() } catch(_){} })
  TXState.charts = {}
}

// ── 메인 렌더 함수 ───────────────────────────────────────────────────
async function renderTransactionAnalysis() {
  txDestroyCharts()
  const el = document.getElementById('pageContent')
  el.innerHTML = `
  <div class="space-y-4">
    <!-- 헤더 바 -->
    <div class="flex flex-wrap items-center justify-between gap-3 bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background:linear-gradient(135deg,#1e40af,#3b82f6)">
          <i class="fas fa-file-invoice text-white"></i>
        </div>
        <div>
          <div class="font-bold text-gray-800">거래명세서 분석</div>
          <div class="text-xs text-gray-400">업체 납품 명세서 업로드 · 파싱 · 비용 분석</div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <select id="txYear" class="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:outline-none">
          ${[2024,2025,2026,2027].map(y => `<option value="${y}" ${y===TXState.year?'selected':''}>${y}년</option>`).join('')}
        </select>
        <select id="txMonth" class="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:outline-none">
          ${Array.from({length:12},(_,i)=>i+1).map(m => `<option value="${m}" ${m===TXState.month?'selected':''}>${m}월</option>`).join('')}
        </select>
        <button onclick="txLoadDashboard()" class="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 flex items-center gap-1.5 transition">
          <i class="fas fa-sync-alt text-xs"></i> 조회
        </button>
      </div>
    </div>

    <!-- 탭 -->
    <div class="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
      ${[
        {id:'upload',  icon:'fa-cloud-upload-alt', label:'파일 업로드'},
        {id:'preview', icon:'fa-table',            label:'데이터 확인'},
        {id:'monthly', icon:'fa-chart-bar',        label:'월별 분석'},
        {id:'cross',   icon:'fa-exchange-alt',     label:'발주 교차분석'}
      ].map(t => `
        <button id="txTab-${t.id}" onclick="txSwitchTab('${t.id}')"
          class="tx-tab flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${TXState.tab===t.id ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}">
          <i class="fas ${t.icon} text-xs"></i>${t.label}
        </button>`).join('')}
    </div>

    <!-- 탭 컨텐츠 -->
    <div id="txTabContent"></div>
  </div>`

  // 연/월 변경 이벤트
  document.getElementById('txYear').addEventListener('change', e => { TXState.year = +e.target.value })
  document.getElementById('txMonth').addEventListener('change', e => { TXState.month = +e.target.value })

  // 카테고리 로드
  await txLoadCategories()
  // 현재 탭 렌더링
  txSwitchTab(TXState.tab)
}

// ── 탭 전환 ──────────────────────────────────────────────────────────
function txSwitchTab(tab) {
  TXState.tab = tab
  // 탭 버튼 스타일 갱신
  document.querySelectorAll('.tx-tab').forEach(btn => {
    const isActive = btn.id === `txTab-${tab}`
    btn.className = `tx-tab flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${isActive ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`
  })
  txDestroyCharts()
  const c = document.getElementById('txTabContent')
  if (!c) return
  if (tab === 'upload')  txRenderUploadTab(c)
  else if (tab === 'preview') txRenderPreviewTab(c)
  else if (tab === 'monthly') txRenderMonthlyTab(c)
  else if (tab === 'cross')   txRenderCrossTab(c)
}

// ── 카테고리 로드 ─────────────────────────────────────────────────────
async function txLoadCategories() {
  try {
    const res = await axios.get('/api/transaction/categories', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
    TXState.categories = res.data.data || []
  } catch(e) { TXState.categories = [] }
}

// ════════════════════════════════════════
// TAB 1: 파일 업로드
// ════════════════════════════════════════
function txRenderUploadTab(container) {
  container.innerHTML = `
  <div class="space-y-4">
    <!-- ① 업로드 & 설정 영역 -->
    <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <h3 class="font-bold text-gray-700 flex items-center gap-2 mb-4">
        <i class="fas fa-file-upload text-blue-500"></i> 거래명세서 업로드
      </h3>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <!-- 좌: 업로드 존 + 기본 설정 -->
        <div class="space-y-3">
          <!-- 드래그앤드롭 존 -->
          <div id="txDropZone"
            class="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition"
            onclick="document.getElementById('txFileInput').click()"
            ondragover="event.preventDefault()"
            ondragenter="this.classList.add('border-blue-400','bg-blue-50')"
            ondragleave="this.classList.remove('border-blue-400','bg-blue-50')"
            ondrop="txHandleDrop(event)">
            <i class="fas fa-file-excel text-4xl text-gray-300 mb-2"></i>
            <div class="text-gray-500 text-sm font-medium">XLSX / XLS / CSV / PDF</div>
            <div class="text-xs text-gray-400 mt-1">클릭하거나 파일을 드래그하세요</div>
            <input id="txFileInput" type="file" accept=".xlsx,.xls,.csv,.pdf" class="hidden" onchange="txHandleFileSelect(event)">
          </div>

          <!-- 거래기간 자동인식 결과 -->
          <div id="txDetectedPeriod" class="hidden bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
            <i class="fas fa-calendar-check mr-1"></i><span id="txDetectedPeriodText"></span>
          </div>

          <!-- 템플릿 적용 배너 -->
          <div id="txTemplateBanner" class="hidden bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 text-xs text-purple-700 flex items-center justify-between">
            <span><i class="fas fa-magic mr-1"></i><span id="txTemplateBannerText">템플릿 자동 적용됨</span></span>
            <button onclick="txClearTemplate()" class="text-purple-400 hover:text-purple-600 ml-2"><i class="fas fa-times"></i></button>
          </div>

          <!-- 업체명 / 년월 / 병원 -->
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="text-xs text-gray-500 font-medium block mb-1">업체명</label>
              <input id="txVendorName" type="text" placeholder="예: 삼성웰스토리"
                class="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-300 focus:outline-none"
                oninput="txOnVendorNameChange(this.value)">
            </div>
            <div>
              <label class="text-xs text-gray-500 font-medium block mb-1">헤더 행 건너뛰기</label>
              <input id="txSkipRows" type="number" min="0" max="15" value="1"
                class="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-300 focus:outline-none">
            </div>
          </div>
          <div class="grid grid-cols-3 gap-2">
            <div>
              <label class="text-xs text-gray-500 font-medium block mb-1">년도</label>
              <input id="txDocYear" type="number" value="${new Date().getFullYear()}"
                class="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-300 focus:outline-none">
            </div>
            <div>
              <label class="text-xs text-gray-500 font-medium block mb-1">월</label>
              <select id="txDocMonth" class="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-300 focus:outline-none">
                ${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${i+1===new Date().getMonth()+1?'selected':''}>${i+1}월`).join('')}
              </select>
            </div>
            <div id="txHospitalSel" class="${App.role==='admin'?'':'hidden'}">
              <label class="text-xs text-gray-500 font-medium block mb-1">병원</label>
              <select id="txHospitalId" class="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-300 focus:outline-none"></select>
            </div>
          </div>
        </div>

        <!-- 우: 업체 템플릿 목록 -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-medium text-gray-600"><i class="fas fa-bookmark text-purple-400 mr-1"></i>업체 템플릿</span>
            <button onclick="txShowTemplateForm()" class="text-xs bg-purple-600 text-white px-2 py-1 rounded-lg hover:bg-purple-700">
              <i class="fas fa-plus mr-1"></i>추가
            </button>
          </div>
          <div id="txTemplateList" class="space-y-1 max-h-48 overflow-y-auto pr-1"></div>
        </div>
      </div>

      <!-- 업로드 버튼 -->
      <button onclick="txUploadFile()" id="txUploadBtn"
        class="w-full bg-blue-600 text-white font-medium py-2.5 rounded-xl hover:bg-blue-700 transition flex items-center justify-center gap-2">
        <i class="fas fa-upload"></i> 업로드 및 파싱
      </button>
      <div id="txUploadMsg" class="mt-2 hidden"></div>
    </div>

    <!-- ② 엑셀 미리보기 + 컬럼 매핑 (파일 선택 후 표시) -->
    <div id="txColMappingSection" class="hidden bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-gray-700 flex items-center gap-2 text-sm">
          <i class="fas fa-table text-green-500"></i> 열 매핑
          <span id="txAutoDetectBadge" class="hidden text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium ml-1">
            <i class="fas fa-magic mr-0.5"></i>자동감지
          </span>
        </h3>
        <span class="text-xs text-gray-400">드롭다운으로 각 열의 역할을 지정하세요</span>
      </div>
      <!-- 매핑 요약 칩 -->
      <div id="txColMappingSummary" class="flex flex-wrap gap-1 mb-3"></div>
      <!-- 미리보기 테이블 -->
      <div class="overflow-x-auto rounded-lg border border-gray-100">
        <table id="txColMappingTable" class="w-full text-xs border-collapse min-w-max">
          <thead id="txColMappingHead"></thead>
          <tbody id="txColMappingBody"></tbody>
        </table>
      </div>
      <div class="mt-2 text-xs text-gray-400 flex items-center gap-1">
        <i class="fas fa-info-circle"></i> 상위 8행 미리보기 · 색상 열이 선택된 필드
      </div>
    </div>

    <!-- ③ 업로드된 파일 목록 -->
    <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-gray-700 flex items-center gap-2 text-sm">
          <i class="fas fa-history text-indigo-500"></i> 업로드 파일 목록
        </h3>
        <button onclick="txLoadFileList()" class="text-xs text-gray-400 hover:text-gray-600">
          <i class="fas fa-sync-alt"></i>
        </button>
      </div>
      <div id="txFileList"><div class="text-xs text-gray-400 text-center py-4">로딩 중...</div></div>
    </div>

    <!-- ④ 템플릿 추가/수정 폼 -->
    <div id="txTemplateForm" class="hidden bg-white rounded-xl shadow-sm border border-purple-100 p-5">
      <h3 class="font-bold text-gray-700 flex items-center gap-2 text-sm mb-4">
        <i class="fas fa-edit text-purple-500"></i> 템플릿 <span id="txTemplateFormTitle">추가</span>
      </h3>
      <input type="hidden" id="txTplId">
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label class="text-xs text-gray-500 font-medium block mb-1">업체명 *</label>
          <input id="txTplVendor" type="text" placeholder="삼성웰스토리" class="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-300 focus:outline-none">
        </div>
        <div>
          <label class="text-xs text-gray-500 font-medium block mb-1">헤더 건너뛰기</label>
          <input id="txTplSkip" type="number" value="1" min="0" max="20" class="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-300 focus:outline-none">
        </div>
      </div>
      <div class="grid grid-cols-3 gap-2 mb-3">
        ${[
          {id:'txTplItemName',label:'품목명 열번호',def:'1'},
          {id:'txTplQty',     label:'수량 열번호',  def:'4'},
          {id:'txTplUnit',    label:'단위 열번호',  def:'3'},
          {id:'txTplPrice',   label:'단가 열번호',  def:'5'},
          {id:'txTplAmount',  label:'금액 열번호',  def:'6'},
          {id:'txTplTax',     label:'부가세 열번호', def:'7'},
        ].map(f=>`
        <div>
          <label class="text-xs text-gray-500 font-medium block mb-1">${f.label}</label>
          <input id="${f.id}" type="number" min="0" max="20" value="${f.def}"
            class="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-300 focus:outline-none">
        </div>`).join('')}
      </div>
      <div class="flex gap-2">
        <button onclick="txSaveTemplate()" class="flex-1 bg-purple-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-purple-700">저장</button>
        <button onclick="document.getElementById('txTemplateForm').classList.add('hidden')" class="flex-1 bg-gray-100 text-gray-600 py-2 rounded-lg text-sm font-medium hover:bg-gray-200">취소</button>
      </div>
    </div>
  </div>`

  txLoadFileList()
  txLoadTemplateList()
  if (App.role === 'admin') txLoadHospitalSelector()
}

// 컬럼 필드 정의 (색상 포함)
const TX_FIELDS = [
  {id:'colItemCode', label:'품목코드',  color:'bg-gray-100 text-gray-700',    borderColor:'border-gray-400',   headerBg:'bg-gray-50'},
  {id:'colItemName', label:'품목명',    color:'bg-blue-100 text-blue-800',    borderColor:'border-blue-300',   headerBg:'bg-blue-50'},
  {id:'colSpec',     label:'규격',      color:'bg-cyan-100 text-cyan-800',    borderColor:'border-cyan-300',   headerBg:'bg-cyan-50'},
  {id:'colUnit',     label:'단위',      color:'bg-yellow-100 text-yellow-800',borderColor:'border-yellow-300', headerBg:'bg-yellow-50'},
  {id:'colQty',      label:'수량',      color:'bg-green-100 text-green-800',  borderColor:'border-green-300',  headerBg:'bg-green-50'},
  {id:'colPrice',    label:'평균단가',  color:'bg-orange-100 text-orange-800',borderColor:'border-orange-300', headerBg:'bg-orange-50'},
  {id:'colAmount',   label:'금액',      color:'bg-red-100 text-red-800',      borderColor:'border-red-300',    headerBg:'bg-red-50'},
  {id:'colTax',      label:'부가세',    color:'bg-purple-100 text-purple-800',borderColor:'border-purple-300', headerBg:'bg-purple-50'},
  {id:'colTotal',    label:'합계',      color:'bg-pink-100 text-pink-800',    borderColor:'border-pink-300',   headerBg:'bg-pink-50'},
]

// 현재 매핑 상태 (colIdx → fieldId)
// TXState.colMapping = { 0: 'colItemName', 3: 'colQty', ... }

// 테이블 셀 열 색상 업데이트
function txUpdateTableColors() {
  const mapping = TXState.colMapping || {}
  const table = document.getElementById('txColMappingTable')
  if (!table) return

  // 역방향: fieldId → colIdx
  const fieldToCol = {}
  Object.entries(mapping).forEach(([colIdx, fieldId]) => {
    fieldToCol[fieldId] = parseInt(colIdx)
  })

  // 헤더 행 색상
  const ths = table.querySelectorAll('thead th')
  ths.forEach((th, i) => {
    const fieldId = mapping[i]
    th.className = 'px-2 py-1 border border-gray-200 text-center min-w-16 sticky top-0 z-10 '
    if (fieldId) {
      const f = TX_FIELDS.find(f => f.id === fieldId)
      if (f) th.className += f.headerBg + ' border-b-2 ' + f.borderColor
      else th.className += 'bg-gray-50'
    } else {
      th.className += 'bg-gray-50 text-gray-400'
    }
  })

  // 데이터 셀 색상
  const trs = table.querySelectorAll('tbody tr')
  trs.forEach(tr => {
    const tds = tr.querySelectorAll('td')
    tds.forEach((td, i) => {
      const fieldId = mapping[i]
      td.className = 'px-2 py-1 border border-gray-100 text-xs text-center whitespace-nowrap '
      if (fieldId) {
        const f = TX_FIELDS.find(f => f.id === fieldId)
        if (f) td.className += f.headerBg
        else td.className += 'bg-white'
      } else {
        td.className += 'bg-white text-gray-400'
      }
    })
  })

  // 매핑 요약 칩 업데이트
  const summaryEl = document.getElementById('txColMappingSummary')
  if (summaryEl) {
    summaryEl.innerHTML = TX_FIELDS.map(f => {
      const colIdx = fieldToCol[f.id]
      if (colIdx === undefined || colIdx < 0) return `<span class="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-400">${f.label}: 미설정</span>`
      const headerRow = TXState._headerRow || []
      const colName = String(headerRow[colIdx] || `열${colIdx}`).trim()
      return `<span class="px-2 py-0.5 rounded-full text-xs ${f.color} font-medium">${f.label}: ${colName}(${colIdx}열)</span>`
    }).join('')
  }

  // hidden input 동기화 (실제 파싱에 사용)
  TX_FIELDS.forEach(f => {
    const colIdx = fieldToCol[f.id]
    let el = document.getElementById(f.id)
    if (!el) {
      el = document.createElement('input')
      el.type = 'hidden'
      el.id = f.id
      document.body.appendChild(el)
    }
    el.value = (colIdx !== undefined && colIdx >= 0) ? colIdx : (
      f.id === 'colItemCode' ? 0  :
      f.id === 'colItemName' ? 1  :
      f.id === 'colSpec'     ? 2  :
      f.id === 'colUnit'     ? 3  :
      f.id === 'colQty'      ? 4  :
      f.id === 'colPrice'    ? 5  :
      f.id === 'colAmount'   ? 6  :
      f.id === 'colTax'      ? 7  :
      f.id === 'colTotal'    ? 8  : -1
    )
  })
  // skipRows hidden input 동기화
  let skipEl = document.getElementById('txSkipRows')
  if (!skipEl) {
    skipEl = document.createElement('input')
    skipEl.type = 'hidden'
    skipEl.id = 'txSkipRows'
    skipEl.value = '1'
    document.body.appendChild(skipEl)
  }
}

// 드롭다운 변경 핸들러
function txChangeColMapping(colIdx, fieldId) {
  if (!TXState.colMapping) TXState.colMapping = {}
  // 같은 fieldId가 다른 열에 이미 있으면 제거
  if (fieldId !== '') {
    Object.keys(TXState.colMapping).forEach(k => {
      if (TXState.colMapping[k] === fieldId) delete TXState.colMapping[k]
    })
  }
  if (fieldId === '') {
    delete TXState.colMapping[colIdx]
  } else {
    TXState.colMapping[colIdx] = fieldId
  }
  txUpdateTableColors()
}

// 미리보기 테이블 렌더링
function txRenderPreviewTable(rows, autoMap, skipRows) {
  if (!rows || rows.length === 0) return
  TXState._previewRows = rows
  if (!TXState.colMapping) TXState.colMapping = {}
  const safeSkip = (typeof skipRows === 'number' && skipRows >= 1) ? skipRows : 1

  // txColMappingSection이 DOM에 없으면 동적 생성
  let section = document.getElementById('txColMappingSection')
  if (!section) {
    // 업로드 탭 컨테이너 찾기 (txTabContent 우선, 없으면 body)
    const tabContent = document.getElementById('txTabContent') || document.getElementById('txUploadBtn')?.closest('.bg-white, .rounded-xl') || document.body
    const newSection = document.createElement('div')
    newSection.id = 'txColMappingSection'
    newSection.className = 'bg-white rounded-xl shadow-sm border border-gray-100 p-5 mt-4'
    newSection.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-gray-700 flex items-center gap-2 text-sm">
          <i class="fas fa-table text-green-500"></i> 열 매핑
          <span id="txAutoDetectBadge" class="hidden text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium ml-1">
            <i class="fas fa-magic mr-0.5"></i>자동감지
          </span>
        </h3>
        <span class="text-xs text-gray-400">드롭다운으로 각 열의 역할을 지정하세요</span>
      </div>
      <div id="txColMappingSummary" class="flex flex-wrap gap-1 mb-3"></div>
      <div class="overflow-x-auto rounded-lg border border-gray-100">
        <table id="txColMappingTable" class="w-full text-xs border-collapse min-w-max">
          <thead id="txColMappingHead"></thead>
          <tbody id="txColMappingBody"></tbody>
        </table>
      </div>
      <div class="mt-2 text-xs text-gray-400 flex items-center gap-1">
        <i class="fas fa-info-circle"></i> 상위 8행 미리보기 · 색상 열이 선택된 필드
      </div>`
    tabContent.appendChild(newSection)
    section = document.getElementById('txColMappingSection')
  }
  if (section) section.classList.remove('hidden')

  // autoMap으로 초기 매핑 설정
  if (autoMap) {
    TXState.colMapping = {}
    if (autoMap.item_code  >= 0) TXState.colMapping[autoMap.item_code]  = 'colItemCode'
    if (autoMap.item_name  >= 0) TXState.colMapping[autoMap.item_name]  = 'colItemName'
    if (autoMap.spec       >= 0) TXState.colMapping[autoMap.spec]       = 'colSpec'
    if (autoMap.unit       >= 0) TXState.colMapping[autoMap.unit]       = 'colUnit'
    if (autoMap.qty        >= 0) TXState.colMapping[autoMap.qty]        = 'colQty'
    if (autoMap.unit_price >= 0) TXState.colMapping[autoMap.unit_price] = 'colPrice'
    if (autoMap.amount     >= 0) TXState.colMapping[autoMap.amount]     = 'colAmount'
    if (autoMap.tax_type   >= 0) TXState.colMapping[autoMap.tax_type]   = 'colTax'
    if (autoMap.total      >= 0) TXState.colMapping[autoMap.total]      = 'colTotal'
  }

  // 헤더 행 찾기 (safeSkip - 1 이 헤더)
  const headerRowIdx = Math.max(0, safeSkip - 1)
  const headerRow = rows[headerRowIdx] || []
  TXState._headerRow = headerRow

  // 컬럼 수
  const colCount = Math.max(...rows.slice(0, Math.min(10, rows.length)).map(r => (r||[]).length), 0)

  const fieldOptions = `
    <option value="">— 무시 —</option>
    ${TX_FIELDS.map(f => `<option value="${f.id}">${f.label}</option>`).join('')}
  `

  // 드롭다운 헤더 행 (매핑 선택)
  const dropdownHtml = Array.from({length: colCount}, (_, i) => {
    const currentField = (TXState.colMapping || {})[i] || ''
    return `<th class="px-2 py-1 border border-gray-200 bg-gray-50 min-w-16">
      <select class="w-full text-xs border-0 bg-transparent focus:outline-none cursor-pointer font-medium"
        onchange="txChangeColMapping(${i}, this.value)">
        ${TX_FIELDS.map(f => `<option value="${f.id}" ${currentField===f.id?'selected':''}>${f.label}</option>`).join('')}
        <option value="" ${!currentField?'selected':''}>— 무시 —</option>
      </select>
    </th>`
  }).join('')

  // 열 번호 행
  const colNumHtml = Array.from({length: colCount}, (_, i) =>
    `<th class="px-2 py-0.5 border border-gray-100 bg-gray-100 text-center text-xs text-gray-400 font-mono">${i}열</th>`
  ).join('')

  // 헤더 이름 행 (엑셀 헤더)
  const headerHtml = Array.from({length: colCount}, (_, i) => {
    const label = String(headerRow[i] || '').trim()
    return `<th class="px-2 py-1 border border-gray-200 bg-white text-center text-xs font-medium text-gray-700 whitespace-nowrap">${label || '—'}</th>`
  }).join('')

  const thead = document.getElementById('txColMappingHead')
  const tbody = document.getElementById('txColMappingBody')
  if (!thead || !tbody) return

  thead.innerHTML = `
    <tr>${dropdownHtml}</tr>
    <tr>${colNumHtml}</tr>
    <tr>${headerHtml}</tr>
  `

  // 데이터 행 (최대 8행, safeSkip 이후부터)
  const dataRows = rows.slice(safeSkip, safeSkip + 8)
  tbody.innerHTML = dataRows.map((row, ri) => {
    const cells = Array.from({length: colCount}, (_, i) => {
      const val = String((row||[])[i] ?? '').trim()
      return `<td class="px-2 py-1 border border-gray-100 text-xs text-center whitespace-nowrap bg-white">${val || ''}</td>`
    }).join('')
    return `<tr class="${ri%2===0?'bg-white':'bg-gray-50/30'}">${cells}</tr>`
  }).join('')

  // 색상 업데이트
  txUpdateTableColors()
}

// 컬럼 수동 변경 표시 (레거시 호환)
function txMarkColManual(colId) {
  const numEl = document.getElementById(colId)
  if (!numEl) return
  const val = parseInt(numEl.value)
  if (isNaN(val) || val < 0) return
  if (!TXState.colMapping) TXState.colMapping = {}
  // 역방향 적용
  const prev = Object.entries(TXState.colMapping).find(([k,v]) => v === colId)
  if (prev) delete TXState.colMapping[prev[0]]
  TXState.colMapping[val] = colId
  txUpdateTableColors()
}

// 드롭다운 선택 → 숫자 입력 동기화 (레거시 호환)
function txSelectCol(colId, val) {
  const numEl = document.getElementById(colId)
  if (numEl) numEl.value = val
  txMarkColManual(colId)
}

// 헤더 드롭다운 생성 (레거시 호환 - 이제 미리보기 테이블이 대신함)
function txBuildHeaderDropdowns(headerRow) {
  // 미리보기가 이미 있으면 skip
}

// 템플릿 적용
function txApplyTemplate(t) {
  // colMapping에 템플릿 값 적용
  TXState.colMapping = {}
  if (t.col_item_name >= 0) TXState.colMapping[t.col_item_name] = 'colItemName'
  if (t.col_qty >= 0) TXState.colMapping[t.col_qty] = 'colQty'
  if (t.col_unit >= 0) TXState.colMapping[t.col_unit] = 'colUnit'
  if (t.col_unit_price >= 0) TXState.colMapping[t.col_unit_price] = 'colPrice'
  if (t.col_amount >= 0) TXState.colMapping[t.col_amount] = 'colAmount'
  if (t.col_tax >= 0) TXState.colMapping[t.col_tax] = 'colTax'

  const skipEl = document.getElementById('txSkipRows')
  if (skipEl) skipEl.value = t.skip_rows

  // hidden input 동기화
  const fieldMap = {colItemName: t.col_item_name, colQty: t.col_qty, colUnit: t.col_unit, colPrice: t.col_unit_price, colAmount: t.col_amount, colTax: t.col_tax}
  Object.entries(fieldMap).forEach(([id, val]) => {
    let el = document.getElementById(id)
    if (!el) { el = document.createElement('input'); el.type='hidden'; el.id=id; document.body.appendChild(el) }
    el.value = val
  })

  // 미리보기 테이블 드롭다운 업데이트
  if (TXState._previewRows) {
    txRenderPreviewTable(TXState._previewRows, null, parseInt(skipEl?.value||'1'))
  } else {
    txUpdateTableColors()
  }

  // 배너 표시
  const banner = document.getElementById('txTemplateBanner')
  const bannerText = document.getElementById('txTemplateBannerText')
  if (banner) banner.classList.remove('hidden')
  if (bannerText) bannerText.textContent = `'${t.vendor_name}' 템플릿 적용됨 — 헤더 ${t.skip_rows}행 건너뜀`
  TXState._appliedTemplate = t
  showToast(`'${t.vendor_name}' 템플릿이 적용되었습니다`, 'success')
}

// 템플릿 초기화
function txClearTemplate() {
  TXState._appliedTemplate = null
  const banner = document.getElementById('txTemplateBanner')
  if (banner) banner.classList.add('hidden')
}


// ── 업체 템플릿 CRUD ──────────────────────────────────────────────────

async function txLoadTemplateList() {
  const listEl = document.getElementById('txTemplateList')
  if (!listEl) return
  try {
    const res = await axios.get('/api/transaction/vendor-templates', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    })
    const templates = res.data || []
    if (!templates.length) {
      listEl.innerHTML = '<div class="text-xs text-gray-400 text-center py-3">템플릿 없음<br><span class="text-gray-300">추가 버튼으로 업체별 템플릿을 저장하세요</span></div>'
      return
    }
    listEl.innerHTML = templates.map(t => `
      <div class="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 hover:bg-purple-50 transition group">
        <button onclick="txApplyTemplate(${JSON.stringify(t).replace(/"/g,'&quot;')})"
          class="flex-1 text-left text-xs font-medium text-gray-700 hover:text-purple-700 truncate">
          <i class="fas fa-bookmark text-purple-300 mr-1 group-hover:text-purple-500"></i>${t.vendor_name}
          <span class="text-gray-400 font-normal ml-1">헤더${t.skip_rows}행 건너뜀</span>
        </button>
        <div class="flex gap-1 ml-2 opacity-0 group-hover:opacity-100 transition">
          <button onclick="txEditTemplate(${JSON.stringify(t).replace(/"/g,'&quot;')})" class="text-xs text-blue-400 hover:text-blue-600 px-1">
            <i class="fas fa-edit"></i>
          </button>
          <button onclick="txDeleteTemplate(${t.id})" class="text-xs text-red-400 hover:text-red-600 px-1">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>`).join('')
  } catch(e) {
    listEl.innerHTML = '<div class="text-xs text-red-400 text-center py-2">템플릿 로드 실패</div>'
  }
}

function txShowTemplateForm() {
  document.getElementById('txTplId').value = ''
  document.getElementById('txTplVendor').value = ''
  document.getElementById('txTplSkip').value = '1'
  document.getElementById('txTplItemName').value = '1'
  document.getElementById('txTplQty').value = '4'
  document.getElementById('txTplUnit').value = '3'
  document.getElementById('txTplPrice').value = '5'
  document.getElementById('txTplAmount').value = '6'
  document.getElementById('txTplTax').value = '7'
  document.getElementById('txTemplateFormTitle').textContent = '추가'
  document.getElementById('txTemplateForm').classList.remove('hidden')
  document.getElementById('txTemplateForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

function txEditTemplate(t) {
  document.getElementById('txTplId').value = t.id || ''
  document.getElementById('txTplVendor').value = t.vendor_name || ''
  document.getElementById('txTplSkip').value = t.skip_rows ?? 1
  document.getElementById('txTplItemName').value = t.col_item_name ?? 1
  document.getElementById('txTplQty').value = t.col_qty ?? 4
  document.getElementById('txTplUnit').value = t.col_unit ?? 3
  document.getElementById('txTplPrice').value = t.col_unit_price ?? 5
  document.getElementById('txTplAmount').value = t.col_amount ?? 6
  document.getElementById('txTplTax').value = t.col_tax ?? 7
  document.getElementById('txTemplateFormTitle').textContent = '수정'
  document.getElementById('txTemplateForm').classList.remove('hidden')
  document.getElementById('txTemplateForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

async function txSaveTemplate() {
  const id = document.getElementById('txTplId').value
  const vendor_name = document.getElementById('txTplVendor').value.trim()
  if (!vendor_name) { showToast('업체명을 입력해주세요', 'error'); return }
  const body = {
    vendor_name,
    skip_rows: +document.getElementById('txTplSkip').value || 1,
    col_item_name: +document.getElementById('txTplItemName').value,
    col_qty: +document.getElementById('txTplQty').value,
    col_unit: +document.getElementById('txTplUnit').value,
    col_unit_price: +document.getElementById('txTplPrice').value,
    col_amount: +document.getElementById('txTplAmount').value,
    col_tax: +document.getElementById('txTplTax').value,
  }
  try {
    if (id) {
      await axios.put(`/api/transaction/vendor-templates/${id}`, body, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      })
    } else {
      await axios.post('/api/transaction/vendor-templates', body, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      })
    }
    showToast(`'${vendor_name}' 템플릿 저장 완료`, 'success')
    document.getElementById('txTemplateForm').classList.add('hidden')
    txLoadTemplateList()
  } catch(e) {
    showToast('템플릿 저장 실패: ' + (e.response?.data?.error || e.message), 'error')
  }
}

async function txDeleteTemplate(id) {
  if (!confirm('이 템플릿을 삭제하시겠습니까?')) return
  try {
    await axios.delete(`/api/transaction/vendor-templates/${id}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    })
    showToast('템플릿 삭제 완료', 'success')
    txLoadTemplateList()
  } catch(e) {
    showToast('삭제 실패', 'error')
  }
}

async function txLoadHospitalSelector() {

  const sel = document.getElementById('txHospitalId')
  if (!sel) return
  try {
    const res = await axios.get('/api/admin/hospitals',
      { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
    const hospitals = res.data || []
    sel.innerHTML = hospitals.map(h =>
      `<option value="${h.id}">${h.name}</option>`
    ).join('')
    // TXState에 저장
    if (hospitals.length > 0) TXState.selectedHospitalId = hospitals[0].id
    sel.addEventListener('change', e => { TXState.selectedHospitalId = +e.target.value })
  } catch(e) {
    sel.innerHTML = '<option value="1">병원 1 (기본)</option>'
    TXState.selectedHospitalId = 1
  }
}

// ── 드래그앤드롭 처리 ─────────────────────────────────────────────────
// 거래기간 자동인식 (파일 미리보기 데이터에서)
function txDetectPeriodFromRows(rows) {
  const periodPattern = /거래기간.*?(\d{4}[\/\-]\d{2}[\/\-]\d{2}).*?~.*?(\d{4}[\/\-]\d{2}[\/\-]\d{2})/
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const rowStr = (rows[i] || []).map(c => String(c || '')).join(' ')
    const m = rowStr.match(periodPattern)
    if (m) {
      const startDate = m[1].replace(/\//g, '-')
      const endDate   = m[2].replace(/\//g, '-')
      const [year, month] = startDate.split('-')
      const yearEl  = document.getElementById('txDocYear')
      const monthEl = document.getElementById('txDocMonth')
      if (yearEl)  yearEl.value  = year
      if (monthEl) monthEl.value = parseInt(month)
      const periodEl   = document.getElementById('txDetectedPeriod')
      const periodText = document.getElementById('txDetectedPeriodText')
      if (periodEl && periodText) {
        periodText.textContent = `거래기간: ${startDate} ~ ${endDate} (년/월 자동설정됨)`
        periodEl.classList.remove('hidden')
      }
      return { startDate, endDate, year: parseInt(year), month: parseInt(month) }
    }
  }
  return null
}

// 삼성웰스토리 등 카테고리 행 자동인식
const TX_CATEGORY_KEYWORDS = ['가공식품','농산물류','농산물','저장식품','수산/건어물류','수산건어물','육류','축산물','소모품','위생용품','음료']
const TX_CATEGORY_MAP = {
  '가공식품':'PROCESSED','농산물류':'VEGGIE','농산물':'VEGGIE',
  '저장식품':'GRAIN','수산/건어물류':'SEAFOOD','수산건어물':'SEAFOOD',
  '육류':'MEAT','축산물':'MEAT','소모품':'SUPPLIES',
  '위생용품':'SUPPLIES','음료':'PROCESSED'
}

function txIsCategoryRow(row) {
  if (!row || !Array.isArray(row)) return null
  const nonEmpty = row.filter(c => c !== null && c !== undefined && String(c).trim() !== '')
  if (nonEmpty.length === 1) {
    const val = String(nonEmpty[0]).trim()
    for (const kw of TX_CATEGORY_KEYWORDS) {
      if (val.includes(kw)) return kw
    }
  }
  return null
}

function txHandleDrop(e) {
  e.preventDefault()
  document.getElementById('txDropZone').classList.remove('border-blue-400','bg-blue-50')
  const file = e.dataTransfer.files[0]
  if (file) txProcessFile(file)
}

function txHandleFileSelect(e) {
  const file = e.target.files[0]
  if (file) txProcessFile(file)
}

// 선택된 파일을 상태에 저장 + 드롭존 업데이트
function txProcessFile(file) {
  TXState.selectedFile = file
  const zone = document.getElementById('txDropZone')
  if (zone) {
    zone.innerHTML = `
      <i class="fas fa-file-excel text-4xl text-green-400 mb-3"></i>
      <div class="text-gray-700 font-medium">${file.name}</div>
      <div class="text-xs text-gray-400 mt-1">${(file.size/1024).toFixed(1)} KB · ${file.type || '알 수 없는 형식'}</div>
      <button onclick="TXState.selectedFile=null;txRenderUploadTab(document.getElementById('txTabContent'))"
        class="mt-2 text-xs text-red-400 hover:text-red-600">파일 제거</button>`
  }
  // 파일명에서 업체명 자동 추출 시도
  const vendorInput = document.getElementById('txVendorName')
  if (vendorInput && !vendorInput.value) {
    const vendors = ['삼성웰스토리','웰스토리','아워홈','이산유통','푸드힐','CJ프레시웨이']
    for (const v of vendors) {
      if (file.name.includes(v)) { vendorInput.value = v; break }
    }
  }

  // ── 엑셀 파일 자동 미리보기 파싱 ────────────────────────────────
  const ext = file.name.split('.').pop().toLowerCase()
  if (['xlsx','xls','csv'].includes(ext)) {
    txPreviewParse(file)
  }
}

// ── 파일 선택 즉시 미리보기 파싱 (헤더 자동 감지 결과 표시) ─────────
async function txPreviewParse(file) {
  const msgEl = document.getElementById('txUploadMsg')
  if (msgEl) { msgEl.classList.remove('hidden'); msgEl.className = 'mt-2 text-xs text-blue-500'; msgEl.textContent = '⏳ 파일 분석 중...' }

  try {
    // XLSX 라이브러리 로드 확인
    if (!window.XLSX) {
      await new Promise((res, rej) => {
        const s = document.createElement('script')
        s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
        s.onload = res; s.onerror = rej
        document.head.appendChild(s)
      })
    }

    const data = await file.arrayBuffer()
    const wb = XLSX.read(new Uint8Array(data), { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

    // 거래기간 인식 (상위 10행 스캔)
    txDetectPeriodFromRows(rows)

    const autoDetect = txAutoDetectHeader(rows)
    const skipRows = autoDetect ? autoDetect.dataStartIndex : 1

    // skipRows 입력 업데이트
    const skipInput = document.getElementById('txSkipRows')
    if (skipInput) skipInput.value = skipRows

    let autoMap = null
    if (autoDetect) {
      autoMap = txAutoMapColumns(autoDetect.headerRow)
      // 자동감지 배지 표시
      const badge = document.getElementById('txAutoDetectBadge')
      if (badge) badge.classList.remove('hidden')
    }

    // ★ 새로운 방식: 미리보기 테이블 렌더링 (열 매핑 드롭다운 포함)
    txRenderPreviewTable(rows, autoMap, skipRows)

    // 예상 유효 품목 수 계산
    let validCount = 0
    if (autoDetect && autoMap) {
      for (let i = skipRows; i < rows.length; i++) {
        if (!txIsSkipRow(rows[i], autoMap.item_name)) {
          const itemName = String(rows[i][autoMap.item_name] || '').trim()
          const qty = parseFloat(String(rows[i][autoMap.qty] || '0').replace(/[^0-9.-]/g,'')) || 0
          const amount = parseInt(String(rows[i][autoMap.amount] || '0').replace(/[^0-9]/g,'')) || 0
          if (itemName && (qty > 0 || amount > 0)) validCount++
        }
      }
      if (msgEl) {
        msgEl.className = 'mt-2 text-xs text-green-600 bg-green-50 rounded-lg p-2'
        msgEl.innerHTML = `✅ <b>자동 분석 완료!</b> 헤더 ${autoDetect.headerRowIndex+1}행 감지 · 유효 품목 <b>${validCount}개</b> 예상`
      }
    } else {
      if (msgEl) {
        msgEl.className = 'mt-2 text-xs text-yellow-600 bg-yellow-50 rounded-lg p-2'
        msgEl.innerHTML = '⚠️ 헤더 자동 감지 실패. 아래 테이블에서 각 열의 역할을 직접 지정해주세요.'
      }
    }
  } catch(e) {
    console.error('txPreviewParse error:', e)
    if (msgEl) {
      msgEl.className = 'mt-2 text-xs text-red-500 bg-red-50 rounded-lg p-2'
      msgEl.textContent = '⚠️ 파일 분석 오류: ' + e.message
    }
  }
}

// ── 실제 업로드 ───────────────────────────────────────────────────────
async function txUploadFile() {
  const file = TXState.selectedFile
  if (!file) { txShowMsg('txUploadMsg', 'error', '파일을 먼저 선택해주세요.'); return }

  const vendorName  = document.getElementById('txVendorName').value.trim()
  const docYear     = +document.getElementById('txDocYear').value
  const docMonth    = +document.getElementById('txDocMonth').value
  const skipRows    = +document.getElementById('txSkipRows').value || 1

  // TXState.colMapping (열번호 → fieldId) 을 colMap (fieldId → 열번호) 으로 변환
  // 새 UI: TXState.colMapping = { 0: 'colItemCode', 1: 'colItemName', ... }
  const mapping = TXState.colMapping || {}
  const fieldToCol = {}
  Object.entries(mapping).forEach(([colIdx, fieldId]) => {
    if (fieldId) fieldToCol[fieldId] = parseInt(colIdx)
  })

  // TXState.colMapping이 비어있으면 (파일 미선택 후 직접 업로드 시도 등) 기본값 사용
  const hasMapping = Object.keys(fieldToCol).length > 0
  const colMap = {
    item_code:  fieldToCol['colItemCode']  !== undefined ? fieldToCol['colItemCode']  : -1,
    item_name:  fieldToCol['colItemName']  !== undefined ? fieldToCol['colItemName']  : 1,
    spec:       fieldToCol['colSpec']      !== undefined ? fieldToCol['colSpec']      : -1,
    unit:       fieldToCol['colUnit']      !== undefined ? fieldToCol['colUnit']      : 3,
    qty:        fieldToCol['colQty']       !== undefined ? fieldToCol['colQty']       : 4,
    unit_price: fieldToCol['colPrice']     !== undefined ? fieldToCol['colPrice']     : 5,
    amount:     fieldToCol['colAmount']    !== undefined ? fieldToCol['colAmount']    : 6,
    tax_type:   fieldToCol['colTax']       !== undefined ? fieldToCol['colTax']       : -1,
    total:      fieldToCol['colTotal']     !== undefined ? fieldToCol['colTotal']     : -1,
  }
  console.log('[txUploadFile] hasMapping:', hasMapping, 'colMap:', colMap)

  const btn = document.getElementById('txUploadBtn')
  btn.disabled = true
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 파싱 중...'
  txShowMsg('txUploadMsg', 'info', '파일을 읽는 중입니다...')

  try {
    // 파일 읽기 + 파싱 (클라이언트 사이드)
    let parsedRows = []
    const ext = file.name.split('.').pop().toLowerCase()

    if (['xlsx','xls','csv'].includes(ext)) {
      parsedRows = await txParseExcel(file, colMap, skipRows)
    } else if (ext === 'pdf') {
      parsedRows = await txParsePDF(file, colMap, skipRows)
    } else {
      throw new Error('지원하지 않는 파일 형식입니다.')
    }

    if (parsedRows.length === 0) throw new Error('파싱된 데이터가 없습니다. 열 매핑을 확인하거나 파일을 다시 선택해주세요.')

    txShowMsg('txUploadMsg', 'info', `${parsedRows.length}개 항목 파싱 완료. 서버 저장 중...`)

    // 서버 전송
    const hospitalId = TXState.selectedHospitalId || null
    const res = await axios.post('/api/transaction/upload', {
      file_name: file.name,
      file_type: ext,
      file_size: file.size,
      vendor_name: vendorName,
      document_year: docYear,
      document_month: docMonth,
      parsed_rows: parsedRows,
      hospital_id: hospitalId
    }, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })

    if (res.data.ok) {
      txShowMsg('txUploadMsg', 'success', `✅ 저장 완료! ${res.data.row_count}개 품목이 등록됐습니다.`)
      TXState.selectedFile = null
      TXState.currentFileId = res.data.file_id
      txLoadFileList()
      // 3초 후 데이터 확인 탭으로 자동 이동
      setTimeout(() => txSwitchTab('preview'), 2000)
    } else {
      throw new Error(res.data.error || '저장 실패')
    }
  } catch(e) {
    console.error('txUploadFile error:', e)
    const errMsg = e.response?.data?.error || e.message || '알 수 없는 오류'
    txShowMsg('txUploadMsg', 'error', '오류: ' + errMsg)
  } finally {
    btn.disabled = false
    btn.innerHTML = '<i class="fas fa-upload"></i> 업로드 및 파싱'
  }
}

// ── Excel 파싱 (XLSX 라이브러리 사용) ────────────────────────────────
// ── 엑셀 헤더 행 자동 감지 ──────────────────────────────────────────
// '품목명', '품목', '상품명', 'item' 등 품목 관련 키워드가 있는 행을 헤더로 인식
function txAutoDetectHeader(rows) {
  // 정확한 셀 값 기준으로 헤더 감지 (부분 문자열 매칭 금지)
  const exactItemCells = ['품목명','상품명','품명','제품명','물품명','item_name','item','name']
  const qtyKeywords    = ['수량','qty','quantity']

  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i]
    if (!row) continue
    const cells = row.map(c => String(c||'').trim().replace(/\s+/g,'').toLowerCase())

    // 정확히 '품목명' 셀이 존재하고 수량 셀도 있는 경우
    const hasItemName = cells.some(c => exactItemCells.includes(c))
    const hasQty      = cells.some(c => qtyKeywords.includes(c))

    if (hasItemName && hasQty) {
      return { headerRowIndex: i, dataStartIndex: i + 1, headerRow: row }
    }
    // '품목코드' 셀이 있는 경우 (이 형식의 표준 거래명세서)
    if (cells.includes('품목코드') || cells.some(c => c === '품목코드')) {
      return { headerRowIndex: i, dataStartIndex: i + 1, headerRow: row }
    }
  }
  return null // 자동 감지 실패
}

// ── 헤더로부터 컬럼 인덱스 자동 매핑 ───────────────────────────────
function txAutoMapColumns(headerRow) {
  const map = { item_code: -1, item_name: 0, spec: -1, unit: 2, qty: 1, unit_price: 3, amount: 4, tax_type: -1, total: -1 }
  headerRow.forEach((cell, idx) => {
    const t = String(cell||'').replace(/\s/g,'').toLowerCase()
    if (/품목코드|상품코드|코드|item_code|itemcode/.test(t))    map.item_code  = idx
    else if (/품목명|상품명|품명|제품명|물품명/.test(t))         map.item_name  = idx
    else if (/규격|spec|사양/.test(t))                          map.spec       = idx
    else if (/^단위$|^unit$/.test(t))                           map.unit       = idx
    else if (/^수량$|^qty$|^quantity$/.test(t))                 map.qty        = idx
    else if (/평균단가|단가|unit_price/.test(t))                 map.unit_price = idx
    else if (/^금액$|^amount$/.test(t))                         map.amount     = idx
    else if (/부가세|세액|vat|tax/.test(t))                     map.tax_type   = idx
    else if (/^합계$|^total$/.test(t))                          map.total      = idx
  })
  return map
}

// ── 소계/합계/페이지 행 필터 ────────────────────────────────────────
function txIsSkipRow(row, itemNameCol) {
  if (!row || row.length === 0) return true
  const first  = String(row[0] || '').trim()
  const second = String(row[1] || '').trim()
  const itemCell = String(row[itemNameCol] || '').trim()
  // 소계/합계/페이지 표시 행 제거
  if (/소계|합계|subtotal|total/i.test(second)) return true
  if (/소계|합계|subtotal|total/i.test(itemCell)) return true
  if (/^\d+\/\d+$/.test(first)) return true  // "1/1" 같은 페이지 표시
  if (first === '' && second === '' && itemCell === '') return true
  return false
}

// ── 세금 구분 자동 감지 (부가세 금액으로 판단) ──────────────────────
function txGuessTaxType(row, taxCol, amountCol) {
  // 부가세 컬럼이 있으면 그 값으로 판단
  if (taxCol >= 0) {
    const vat = parseInt(String(row[taxCol]||'0').replace(/[^0-9]/g,'')) || 0
    return vat > 0 ? 'taxable' : 'nontaxable'
  }
  return 'nontaxable'
}

async function txParseExcel(file, colMap, skipRows) {
  // XLSX 라이브러리 로드 확인 (txPreviewParse를 건너뛰고 직접 업로드할 경우 대비)
  if (!window.XLSX) {
    await new Promise((res, rej) => {
      const s = document.createElement('script')
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
      s.onload = res; s.onerror = () => rej(new Error('XLSX 라이브러리 로딩 실패'))
      document.head.appendChild(s)
    })
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

        // ① 거래기간 자동인식 (상위 10행 스캔)
        txDetectPeriodFromRows(rows)

        // ② 헤더 자동 감지 시도
        const autoDetect = txAutoDetectHeader(rows)
        let effectiveSkip = skipRows
        let effectiveColMap = { ...colMap }
        let vatCol = -1

        if (autoDetect) {
          effectiveSkip = autoDetect.dataStartIndex
          const autoMap = txAutoMapColumns(autoDetect.headerRow)
          // 사용자가 직접 매핑한 값(colMap)을 우선, 없으면 autoMap 사용
          effectiveColMap = {
            item_code:  colMap.item_code  >= 0 ? colMap.item_code  : autoMap.item_code,
            item_name:  colMap.item_name  >= 0 ? colMap.item_name  : autoMap.item_name,
            spec:       colMap.spec       >= 0 ? colMap.spec       : autoMap.spec,
            unit:       colMap.unit       >= 0 ? colMap.unit       : autoMap.unit,
            qty:        colMap.qty        >= 0 ? colMap.qty        : autoMap.qty,
            unit_price: colMap.unit_price >= 0 ? colMap.unit_price : autoMap.unit_price,
            amount:     colMap.amount     >= 0 ? colMap.amount     : autoMap.amount,
            tax_type:   colMap.tax_type   >= 0 ? colMap.tax_type   : autoMap.tax_type,
            total:      colMap.total      >= 0 ? colMap.total      : autoMap.total,
          }
          vatCol = effectiveColMap.tax_type
        } else {
          // autoDetect 실패 시 사용자 colMap 그대로 사용
          effectiveColMap = { ...colMap }
          vatCol = colMap.tax_type
        }

        const parsed = []
        let currentCategory = null  // 삼성웰스토리 카테고리 행 추적
        const hasCatRows = TXState._appliedTemplate?.has_category_rows === 1
        console.log('[txParseExcel] effectiveColMap:', effectiveColMap, 'effectiveSkip:', effectiveSkip, 'total rows:', rows.length)
        for (let i = effectiveSkip; i < rows.length; i++) {
          const row = rows[i]
          // 카테고리 행 자동인식 (삼성웰스토리 등)
          if (hasCatRows) {
            const catKeyword = txIsCategoryRow(row)
            if (catKeyword) { currentCategory = catKeyword; continue }
          }
          // 소계/합계/페이지 행 자동 제거
          if (txIsSkipRow(row, effectiveColMap.item_name)) continue

          const itemName   = String(row[effectiveColMap.item_name] || '').trim()
          if (!itemName) continue

          const itemCode   = effectiveColMap.item_code  >= 0 ? String(row[effectiveColMap.item_code]  || '').trim() : ''
          const spec       = effectiveColMap.spec       >= 0 ? String(row[effectiveColMap.spec]       || '').trim() : ''
          const qty        = parseFloat(String(row[effectiveColMap.qty]        || '0').replace(/[^0-9.-]/g,'')) || 0
          const unit       = String(row[effectiveColMap.unit] || '').trim()
          const unit_price = parseInt(String(row[effectiveColMap.unit_price]   || '0').replace(/[^0-9]/g,'')) || 0
          // 금액: 직접 입력 금액 → 없으면 합계 열 → 없으면 qty×단가 계산
          const rawAmount  = parseInt(String(row[effectiveColMap.amount]       || '0').replace(/[^0-9]/g,'')) || 0
          const rawTotal   = effectiveColMap.total >= 0 ? parseInt(String(row[effectiveColMap.total] || '0').replace(/[^0-9]/g,'')) || 0 : 0
          const amount     = rawAmount || rawTotal || Math.round(qty * unit_price)
          // 부가세 컬럼 원본값 읽기 (파일에 부가세 금액이 있으면 그대로 사용)
          const rawTaxAmt  = vatCol >= 0 ? (parseInt(String(row[vatCol]||'0').replace(/[^0-9]/g,'')) || 0) : -1
          // 세금 구분: 부가세 컬럼 값으로 자동 판단 (>0이면 과세)
          const tax_type   = rawTaxAmt > 0 ? 'taxable' : (rawTaxAmt === 0 ? 'nontaxable' : txGuessTaxType(row, vatCol, effectiveColMap.amount))

          if (amount <= 0 && qty <= 0) continue  // 금액/수량 모두 0이면 스킵

          parsed.push({
            item_code: itemCode, item_name: itemName, spec,
            quantity: qty, unit, unit_price, amount, tax_type,
            // 원본 파일의 부가세 값 전송 (-1이면 컬럼 없음, 0이면 면세, >0이면 실제 부가세)
            tax_amount_raw: rawTaxAmt,
            category_hint: currentCategory || null,
            raw: JSON.stringify(row)
          })
        }
        resolve(parsed)
      } catch(err) { reject(err) }
    }
    reader.onerror = () => reject(new Error('파일 읽기 실패'))
    reader.readAsArrayBuffer(file)
  })
}

// ── PDF 텍스트 파싱 (기본 패턴 매칭) ─────────────────────────────────
async function txParsePDF(file, colMap, skipRows) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        // PDF.js 동적 로드
        if (!window.pdfjsLib) {
          await new Promise((res, rej) => {
            const s = document.createElement('script')
            s.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js'
            s.onload = res; s.onerror = rej
            document.head.appendChild(s)
          })
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
        }
        const pdf = await window.pdfjsLib.getDocument({ data: e.target.result }).promise
        let fullText = ''
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p)
          const tc = await page.getTextContent()
          fullText += tc.items.map(i => i.str).join(' ') + '\n'
        }
        // 텍스트에서 품목 행 추출 (숫자 패턴 기반)
        const lines = fullText.split('\n').slice(skipRows)
        const parsed = []
        for (const line of lines) {
          const m = line.match(/([가-힣a-zA-Z\s\(\)]+)\s+([\d.]+)\s*([가-힣a-zA-Z]*)\s+([\d,]+)\s+([\d,]+)/)
          if (!m) continue
          const item_name = m[1].trim()
          if (!item_name || item_name.length < 2) continue
          const qty        = parseFloat(m[2]) || 0
          const unit       = m[3] || ''
          const unit_price = parseInt(m[4].replace(/,/g,'')) || 0
          const amount     = parseInt(m[5].replace(/,/g,'')) || Math.round(qty * unit_price)
          parsed.push({ item_name, quantity: qty, unit, unit_price, amount, tax_type: 'taxable', raw: line })
        }
        resolve(parsed)
      } catch(err) { reject(err) }
    }
    reader.onerror = () => reject(new Error('PDF 읽기 실패'))
    reader.readAsArrayBuffer(file)
  })
}

function txNormalizeTax(raw) {
  const s = String(raw).toLowerCase().trim()
  if (s.includes('면세') || s === '0' || s === 'free') return 'nontaxable'
  if (s.includes('영세') || s.includes('exempt')) return 'exempt'
  return 'taxable'
}

// ── 파일 목록 로드 ────────────────────────────────────────────────────
async function txLoadFileList() {
  const el = document.getElementById('txFileList')
  if (!el) return
  try {
    const hParam = TXState.selectedHospitalId ? `&hospital_id=${TXState.selectedHospitalId}` : ''
    const res = await axios.get(`/api/transaction/files?year=${TXState.year}&month=${TXState.month}${hParam}`,
      { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
    const files = res.data.data || []

    if (files.length === 0) {
      el.innerHTML = `<div class="text-center text-gray-400 py-8 text-sm">
        <i class="fas fa-inbox text-3xl mb-2"></i><br>
        ${TXState.year}년 ${TXState.month}월 업로드 파일 없음
      </div>`
      return
    }

    el.innerHTML = files.map(f => `
      <div class="flex items-center justify-between p-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
            f.file_type==='xlsx'||f.file_type==='xls' ? 'bg-green-100' :
            f.file_type==='pdf' ? 'bg-red-100' : 'bg-blue-100'}">
            <i class="fas ${f.file_type==='pdf'?'fa-file-pdf text-red-500':'fa-file-excel text-green-600'} text-sm"></i>
          </div>
          <div class="min-w-0">
            <div class="text-sm font-medium text-gray-700 truncate">${f.file_name}</div>
            <div class="text-xs text-gray-400">${f.vendor_name||'업체 미지정'} · ${f.document_year}년 ${f.document_month}월 · ${(f.row_count||0)}개 항목</div>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0 ml-2">
          <span class="text-xs px-2 py-0.5 rounded-full font-medium ${
            f.parse_status==='completed' ? 'bg-green-100 text-green-700' :
            f.parse_status==='failed'    ? 'bg-red-100 text-red-600' :
            'bg-yellow-100 text-yellow-600'}">
            ${f.parse_status==='completed'?'완료':f.parse_status==='failed'?'실패':'처리중'}
          </span>
          <button onclick="txViewFile(${f.id},'${(f.vendor_name||'').replace(/'/g,"\\'")}',${f.document_year},${f.document_month})"
            class="text-xs text-blue-500 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50">
            <i class="fas fa-eye"></i>
          </button>
          <button onclick="txDeleteFile(${f.id})"
            class="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>`).join('')
  } catch(e) {
    el.innerHTML = `<div class="text-center text-red-400 py-6 text-sm">불러오기 실패: ${e.message}</div>`
  }
}

// ── 파일 클릭 → preview 탭으로 ───────────────────────────────────────
async function txViewFile(fileId, vendor, year, month) {
  TXState.currentFileId = fileId
  TXState.year = year; TXState.month = month
  txSwitchTab('preview')
}

// ── 파일 삭제 ─────────────────────────────────────────────────────────
async function txDeleteFile(fileId) {
  if (!confirm('이 파일과 모든 품목 데이터를 삭제하시겠습니까?')) return
  try {
    await axios.delete(`/api/transaction/files/${fileId}`,
      { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
    txLoadFileList()
    showToast('삭제됐습니다.', 'success')
  } catch(e) {
    showToast('삭제 실패: ' + e.message, 'error')
  }
}

// ════════════════════════════════════════
// TAB 2: 데이터 확인 (미리보기/수정)
// ════════════════════════════════════════
async function txRenderPreviewTab(container) {
  container.innerHTML = `
  <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <h3 class="font-bold text-gray-700 flex items-center gap-2">
        <i class="fas fa-table text-blue-500"></i> 파싱 데이터 확인 및 수정
        ${TXState.currentFileId ? `<span class="text-xs text-gray-400">파일 ID: ${TXState.currentFileId}</span>` : ''}
      </h3>
      <div class="flex items-center gap-2">
        <input id="txPreviewSearch" type="text" placeholder="품목명 검색..."
          class="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-400 focus:outline-none w-40"
          oninput="txFilterPreview(this.value)">
        <button onclick="txLoadPreview()" class="text-sm bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-100 flex items-center gap-1.5">
          <i class="fas fa-sync-alt text-xs"></i> 새로고침
        </button>
      </div>
    </div>
    <div id="txPreviewTable" class="overflow-x-auto">
      <div class="text-center text-gray-400 py-10 text-sm">
        <i class="fas fa-spinner fa-spin text-2xl mb-2"></i><br>데이터 불러오는 중...
      </div>
    </div>
  </div>`

  if (TXState.currentFileId) {
    await txLoadPreview()
  } else {
    document.getElementById('txPreviewTable').innerHTML = `
      <div class="text-center text-gray-400 py-10">
        <i class="fas fa-arrow-left text-2xl mb-2"></i><br>
        <p class="text-sm">파일 업로드 탭에서 파일을 선택해주세요.</p>
        <button onclick="txSwitchTab('upload')" class="mt-3 text-sm text-blue-500 hover:text-blue-700">
          업로드 탭으로 이동 →
        </button>
      </div>`
  }
}

async function txLoadPreview() {
  if (!TXState.currentFileId) return
  const el = document.getElementById('txPreviewTable')
  if (!el) return
  try {
    const res = await axios.get(`/api/transaction/files/${TXState.currentFileId}/items`,
      { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
    TXState.previewItems = res.data.data || []
    txRenderParsedItems(TXState.previewItems)
  } catch(e) {
    el.innerHTML = `<div class="text-red-400 text-sm py-4">불러오기 실패: ${e.message}</div>`
  }
}

function txFilterPreview(q) {
  const filtered = q
    ? TXState.previewItems.filter(r => (r.item_name||'').includes(q) || (r.item_name_normalized||'').includes(q))
    : TXState.previewItems
  txRenderParsedItems(filtered)
}

function txRenderParsedItems(items) {
  const el = document.getElementById('txPreviewTable')
  if (!el) return
  if (!items.length) {
    el.innerHTML = '<div class="text-center text-gray-400 py-8 text-sm">데이터가 없습니다.</div>'
    return
  }

  const catOptions = TXState.categories.map(c =>
    `<option value="${c.id}">${c.name}</option>`).join('')

  // 요약 계산
  const totalAmt    = items.reduce((s,i)=>s+(i.amount||0),0)
  const totalTax    = items.reduce((s,i)=>s+(i.tax_amount||0),0)
  const totalSum    = totalAmt + totalTax  // 합계(금액+부가세)
  const taxableAmt  = items.filter(i=>i.tax_type==='taxable').reduce((s,i)=>s+(i.amount||0),0)
  const nonTaxAmt   = items.filter(i=>i.tax_type!=='taxable').reduce((s,i)=>s+(i.amount||0),0)

  el.innerHTML = `
  <!-- 요약 카드 -->
  <div class="grid grid-cols-4 gap-3 mb-4">
    <div class="bg-blue-50 rounded-lg p-3 text-center">
      <div class="text-xs text-blue-500 mb-1">총 품목 수</div>
      <div class="text-lg font-bold text-blue-700">${items.length}개</div>
    </div>
    <div class="bg-green-50 rounded-lg p-3 text-center">
      <div class="text-xs text-green-500 mb-1">공급가액</div>
      <div class="text-base font-bold text-green-700">${totalAmt.toLocaleString()}원</div>
    </div>
    <div class="bg-orange-50 rounded-lg p-3 text-center">
      <div class="text-xs text-orange-500 mb-1">부가세</div>
      <div class="text-base font-bold text-orange-700">${totalTax.toLocaleString()}원</div>
    </div>
    <div class="bg-purple-50 rounded-lg p-3 text-center">
      <div class="text-xs text-purple-500 mb-1">합계금액</div>
      <div class="text-base font-bold text-purple-700">${totalSum.toLocaleString()}원</div>
    </div>
  </div>
  <div class="text-xs text-gray-400 mb-3 flex gap-4">
    <span>과세: <span class="font-medium text-gray-600">${taxableAmt.toLocaleString()}원</span></span>
    <span>면세+영세: <span class="font-medium text-gray-600">${nonTaxAmt.toLocaleString()}원</span></span>
  </div>

  <!-- 테이블: 열 매핑과 동일한 순서 -->
  <!-- 품목코드 / 품목명 / 규격 / 단위 / 카테고리 / 수량 / 평균단가 / 금액 / 부가세 / 합계 / 과세구분 / 저장 -->
  <div class="overflow-x-auto">
  <table class="w-full text-xs border-collapse min-w-max">
    <thead>
      <tr class="bg-gray-50 sticky top-0 z-10">
        <th class="text-left px-2 py-2 text-gray-500 font-medium border-b whitespace-nowrap">품목코드</th>
        <th class="text-left px-2 py-2 text-gray-500 font-medium border-b whitespace-nowrap min-w-28">품목명</th>
        <th class="text-left px-2 py-2 text-gray-500 font-medium border-b whitespace-nowrap max-w-28">규격</th>
        <th class="text-center px-2 py-2 text-gray-500 font-medium border-b whitespace-nowrap">단위</th>
        <th class="text-left px-2 py-2 text-gray-500 font-medium border-b whitespace-nowrap">카테고리</th>
        <th class="text-right px-2 py-2 text-gray-500 font-medium border-b whitespace-nowrap">수량</th>
        <th class="text-right px-2 py-2 text-gray-500 font-medium border-b whitespace-nowrap">평균단가</th>
        <th class="text-right px-2 py-2 text-gray-500 font-medium border-b whitespace-nowrap">금액</th>
        <th class="text-right px-2 py-2 text-orange-400 font-medium border-b whitespace-nowrap">부가세</th>
        <th class="text-right px-2 py-2 text-purple-500 font-medium border-b whitespace-nowrap">합계</th>
        <th class="text-center px-2 py-2 text-gray-500 font-medium border-b whitespace-nowrap">과세구분</th>
        <th class="text-center px-2 py-2 text-gray-500 font-medium border-b whitespace-nowrap">저장</th>
      </tr>
    </thead>
    <tbody id="txPreviewBody">
      ${items.map((item) => {
        const amt      = item.amount || 0
        const taxAmt   = item.tax_amount || 0
        const sumAmt   = amt + taxAmt
        return `
        <tr class="border-b border-gray-100 hover:bg-blue-50/20 transition ${item.is_verified?'bg-green-50/20':''}" id="txRow-${item.id}">
          <td class="px-2 py-1.5 text-gray-400 text-xs whitespace-nowrap font-mono">${item.item_code||''}</td>
          <td class="px-2 py-1.5">
            <input class="text-xs border border-gray-200 rounded px-1.5 py-1 w-32 focus:ring-1 focus:ring-blue-300 focus:outline-none bg-white"
              value="${(item.item_name||'').replace(/"/g,'&quot;')}" id="txName-${item.id}">
          </td>
          <td class="px-2 py-1.5 text-gray-500 text-xs whitespace-nowrap max-w-28 truncate" title="${item.spec||''}">${item.spec||''}</td>
          <td class="px-2 py-1.5 text-center text-gray-600 text-xs whitespace-nowrap">${item.unit||''}</td>
          <td class="px-2 py-1.5">
            <select class="text-xs border border-gray-200 rounded px-1 py-1 focus:ring-1 focus:ring-blue-300 focus:outline-none bg-white min-w-16" id="txCat-${item.id}">
              <option value="">미분류</option>${catOptions}
            </select>
          </td>
          <td class="px-2 py-1.5">
            <input type="number" class="text-xs border border-gray-200 rounded px-1.5 py-1 w-14 text-right focus:ring-1 focus:ring-blue-300 focus:outline-none bg-white"
              value="${item.quantity||0}" id="txQty-${item.id}">
          </td>
          <td class="px-2 py-1.5">
            <input type="number" class="text-xs border border-gray-200 rounded px-1.5 py-1 w-20 text-right focus:ring-1 focus:ring-blue-300 focus:outline-none bg-white"
              value="${item.unit_price||0}" id="txPrice-${item.id}">
          </td>
          <td class="px-2 py-1.5 text-right font-medium text-gray-700 whitespace-nowrap">${amt.toLocaleString()}</td>
          <td class="px-2 py-1.5 text-right text-orange-600 whitespace-nowrap">${taxAmt > 0 ? taxAmt.toLocaleString() : '<span class="text-gray-300">0</span>'}</td>
          <td class="px-2 py-1.5 text-right font-semibold text-purple-700 whitespace-nowrap">${sumAmt.toLocaleString()}</td>
          <td class="px-2 py-1.5 text-center">
            <select class="text-xs border border-gray-200 rounded px-1 py-1 focus:ring-1 focus:ring-blue-300 focus:outline-none bg-white" id="txTax-${item.id}">
              <option value="taxable" ${item.tax_type==='taxable'?'selected':''}>과세</option>
              <option value="nontaxable" ${item.tax_type==='nontaxable'?'selected':''}>면세</option>
              <option value="exempt" ${item.tax_type==='exempt'?'selected':''}>영세</option>
            </select>
          </td>
          <td class="px-2 py-1.5 text-center">
            <button onclick="txSaveItem(${item.id})"
              class="text-xs ${item.is_verified?'bg-green-100 text-green-600 border border-green-200':'bg-blue-100 text-blue-600 border border-blue-200'} px-2 py-1 rounded hover:opacity-80 transition whitespace-nowrap">
              ${item.is_verified?'✓완료':'저장'}
            </button>
          </td>
        </tr>`
      }).join('')}
    </tbody>
  </table>
  </div>`

  // 카테고리 select 초기값 세팅
  items.forEach(item => {
    const sel = document.getElementById(`txCat-${item.id}`)
    if (sel && item.category_id) sel.value = item.category_id
  })
}

// ── 품목 저장 ─────────────────────────────────────────────────────────
async function txSaveItem(itemId) {
  try {
    const qty       = +document.getElementById(`txQty-${itemId}`)?.value || 0
    const unitPrice = +document.getElementById(`txPrice-${itemId}`)?.value || 0
    const taxType   = document.getElementById(`txTax-${itemId}`)?.value || 'taxable'

    const res = await axios.put(`/api/transaction/items/${itemId}`, {
      item_name:   document.getElementById(`txName-${itemId}`)?.value || '',
      category_id: document.getElementById(`txCat-${itemId}`)?.value || null,
      quantity:    qty,
      unit_price:  unitPrice,
      tax_type:    taxType
    }, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })

    // 버튼 → 완료 상태
    const btn = document.querySelector(`#txRow-${itemId} button`)
    if (btn) {
      btn.className = 'text-xs bg-green-100 text-green-600 border border-green-200 px-2 py-1 rounded hover:opacity-80 transition whitespace-nowrap'
      btn.textContent = '✓완료'
    }
    const row = document.getElementById(`txRow-${itemId}`)
    if (row) {
      row.classList.remove('bg-yellow-50/30')
      row.classList.add('bg-green-50/20')

      // 부가세·합계 셀 즉시 갱신 (서버 응답값 or 클라이언트 계산)
      const updItem = res.data?.data
      const amt      = updItem?.amount     ?? (qty * unitPrice)
      const taxAmt   = updItem?.tax_amount ?? (taxType === 'taxable' ? Math.round(amt / 11) : 0)
      const sumAmt   = amt + taxAmt
      // td 순서: 품목코드(0) 품목명(1) 규격(2) 단위(3) 카테고리(4) 수량(5) 단가(6) 금액(7) 부가세(8) 합계(9)
      const tds = row.querySelectorAll('td')
      if (tds[7]) tds[7].textContent = amt.toLocaleString()
      if (tds[8]) tds[8].innerHTML = taxAmt > 0 ? taxAmt.toLocaleString() : '<span class="text-gray-300">0</span>'
      if (tds[9]) tds[9].textContent = sumAmt.toLocaleString()
    }
    showToast('저장됐습니다.', 'success')
  } catch(e) {
    showToast('저장 실패: ' + e.message, 'error')
  }
}

// ════════════════════════════════════════
// TAB 3: 월별 분석
// ════════════════════════════════════════
async function txRenderMonthlyTab(container) {
  container.innerHTML = `
  <div id="txMonthlyContent">
    <div class="text-center text-gray-400 py-16">
      <i class="fas fa-spinner fa-spin text-3xl mb-3"></i><br>분석 데이터 불러오는 중...
    </div>
  </div>`
  await txLoadMonthlyAnalysis()
}

async function txLoadMonthlyAnalysis() {
  const el = document.getElementById('txMonthlyContent')
  if (!el) return
  try {
    const res = await axios.get(`/api/transaction/analysis/monthly?year=${TXState.year}&month=${TXState.month}`,
      { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
    const d = res.data
    if (!d.ok) throw new Error(d.error)

    const tot = d.totals || {}
    const prevTotal = d.prev_total || 0
    const changePct = prevTotal > 0 ? ((tot.total_amount - prevTotal) / prevTotal * 100).toFixed(1) : null

    el.innerHTML = `
    <div class="space-y-4">
      <!-- 상단 KPI 카드 -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        ${[
          { label:'총 지출', val: (tot.total_amount||0).toLocaleString()+'원', icon:'fa-won-sign', color:'blue',
            sub: changePct ? `전월 대비 ${changePct>0?'+':''}${changePct}%` : '전월 데이터 없음' },
          { label:'과세 금액', val: (tot.taxable_amount||0).toLocaleString()+'원', icon:'fa-receipt', color:'green',
            sub: tot.total_amount ? `${Math.round((tot.taxable_amount||0)/(tot.total_amount||1)*100)}%` : '' },
          { label:'면세 금액', val: (tot.nontaxable_amount||0).toLocaleString()+'원', icon:'fa-tag', color:'purple',
            sub: tot.total_amount ? `${Math.round((tot.nontaxable_amount||0)/(tot.total_amount||1)*100)}%` : '' },
          { label:'거래 업체 수', val: (tot.vendor_count||0)+'개사', icon:'fa-truck', color:'orange',
            sub: `품목 ${tot.item_count||0}개` }
        ].map(k => `
          <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <div class="flex items-center gap-2 mb-2">
              <div class="w-8 h-8 rounded-lg bg-${k.color}-100 flex items-center justify-center">
                <i class="fas ${k.icon} text-${k.color}-500 text-sm"></i>
              </div>
              <span class="text-xs text-gray-500">${k.label}</span>
            </div>
            <div class="text-lg font-bold text-gray-800">${k.val}</div>
            <div class="text-xs text-gray-400 mt-0.5">${k.sub}</div>
          </div>`).join('')}
      </div>

      <!-- AI 알림 -->
      ${d.alerts && d.alerts.length > 0 ? `
      <div class="bg-white rounded-xl shadow-sm border border-orange-200 p-4">
        <h4 class="font-bold text-gray-700 mb-3 flex items-center gap-2">
          <i class="fas fa-robot text-orange-500"></i> AI 분석 알림
        </h4>
        <div class="space-y-2">
          ${d.alerts.map(a => `
            <div class="flex items-start gap-3 p-3 rounded-lg ${a.level==='critical'?'bg-red-50 border border-red-200':a.level==='warning'?'bg-yellow-50 border border-yellow-200':'bg-gray-50'}">
              <i class="fas ${a.level==='critical'?'fa-exclamation-circle text-red-500':'fa-exclamation-triangle text-yellow-500'} mt-0.5"></i>
              <div>
                <div class="text-sm font-medium text-gray-700">${a.title}</div>
                ${a.items ? `<div class="text-xs text-gray-500 mt-1">${a.items.map(i =>
                  a.type==='price_rise' ? `${i.item}: ${i.change_pct>0?'+':''}${i.change_pct}% (${(i.prev||0).toLocaleString()}→${(i.current||0).toLocaleString()}원)` :
                  a.type==='qty_surge'  ? `${i.item}: ${i.ratio}배 증가` : i.item
                ).join(', ')}</div>` : ''}
                ${a.vendor ? `<div class="text-xs text-gray-500 mt-1">${a.vendor} · 집중도 ${a.ratio}%</div>` : ''}
              </div>
            </div>`).join('')}
        </div>
      </div>` : `
      <div class="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2 text-sm text-green-700">
        <i class="fas fa-check-circle"></i> 이상 징후가 감지되지 않았습니다.
      </div>`}

      <!-- 차트 행: 카테고리 파이 + 업체별 바 -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <h4 class="font-bold text-gray-600 mb-3 text-sm">카테고리별 지출</h4>
          <div style="height:220px;position:relative"><canvas id="txCatChart"></canvas></div>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <h4 class="font-bold text-gray-600 mb-3 text-sm">업체별 지출 TOP10</h4>
          <div style="height:220px;position:relative"><canvas id="txVendorChart"></canvas></div>
        </div>
      </div>

      <!-- 트렌드 차트 -->
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <h4 class="font-bold text-gray-600 mb-3 text-sm">최근 6개월 지출 추이</h4>
        <div style="height:180px;position:relative"><canvas id="txTrendChart"></canvas></div>
      </div>

      <!-- 상위 품목 테이블 -->
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <h4 class="font-bold text-gray-600 mb-3 text-sm">상위 지출 품목 TOP10</h4>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead><tr class="bg-gray-50">
              <th class="text-left px-3 py-2 text-gray-500 border-b">품목명</th>
              <th class="text-left px-3 py-2 text-gray-500 border-b">업체</th>
              <th class="text-right px-3 py-2 text-gray-500 border-b">총 수량</th>
              <th class="text-right px-3 py-2 text-gray-500 border-b">평균 단가</th>
              <th class="text-right px-3 py-2 text-gray-500 border-b">총 금액</th>
            </tr></thead>
            <tbody>
              ${(d.top_items||[]).map((item,i) => `
                <tr class="border-b border-gray-50 hover:bg-gray-50">
                  <td class="px-3 py-2 font-medium text-gray-700">
                    <span class="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs mr-1.5 ${i<3?'bg-blue-100 text-blue-600':'bg-gray-100 text-gray-500'}">${i+1}</span>
                    ${item.item_name}
                  </td>
                  <td class="px-3 py-2 text-gray-500">${item.vendor_name||'-'}</td>
                  <td class="px-3 py-2 text-right">${(item.total_qty||0).toLocaleString()}</td>
                  <td class="px-3 py-2 text-right">${(item.avg_price||0).toLocaleString()}원</td>
                  <td class="px-3 py-2 text-right font-semibold text-gray-700">${(item.total||0).toLocaleString()}원</td>
                </tr>`).join('')}
            </tbody>
          </table>
          ${!(d.top_items||[]).length ? '<div class="text-center text-gray-400 py-6 text-xs">데이터 없음</div>' : ''}
        </div>
      </div>
    </div>`

    // 차트 렌더링
    setTimeout(() => {
      txRenderCategoryChart(d.by_category || [])
      txRenderVendorChart(d.by_vendor || [])
      txRenderTrendChart(d.trend || [])
    }, 50)

  } catch(e) {
    el.innerHTML = `
    <div class="bg-white rounded-xl p-8 text-center text-gray-400">
      <i class="fas fa-inbox text-4xl mb-3"></i>
      <p class="text-sm">${TXState.year}년 ${TXState.month}월 데이터가 없습니다.</p>
      <p class="text-xs mt-1 text-gray-300">${e.message}</p>
      <button onclick="txSwitchTab('upload')" class="mt-4 text-sm text-blue-500 hover:text-blue-700">
        파일 업로드 →
      </button>
    </div>`
  }
}

// ── 차트 그리기 ───────────────────────────────────────────────────────
function txRenderCategoryChart(data) {
  const canvas = document.getElementById('txCatChart')
  if (!canvas || !data.length) return
  const ctx = canvas.getContext('2d')
  TXState.charts.cat = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: data.map(d => d.category_name || '미분류'),
      datasets: [{ data: data.map(d => d.total||0),
        backgroundColor: data.map(d => d.color || '#94a3b8'),
        borderWidth: 2, borderColor: '#fff' }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${(ctx.raw||0).toLocaleString()}원` } }
      }
    }
  })
}

function txRenderVendorChart(data) {
  const canvas = document.getElementById('txVendorChart')
  if (!canvas || !data.length) return
  const ctx = canvas.getContext('2d')
  TXState.charts.vendor = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.vendor_name),
      datasets: [{ label: '지출금액', data: data.map(d => d.total||0),
        backgroundColor: 'rgba(59,130,246,0.7)', borderColor: '#3b82f6',
        borderWidth: 1, borderRadius: 4 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${(ctx.raw||0).toLocaleString()}원` } } },
      scales: { x: { ticks: { callback: v => `${Math.round(v/10000)}만`, font: { size: 10 } } },
                y: { ticks: { font: { size: 10 } } } }
    }
  })
}

function txRenderTrendChart(data) {
  const canvas = document.getElementById('txTrendChart')
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  TXState.charts.trend = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map(d => `${d.y}/${String(d.m).padStart(2,'0')}`),
      datasets: [{ label: '월 지출', data: data.map(d => d.total||0),
        borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)',
        fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: '#3b82f6' }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${(ctx.raw||0).toLocaleString()}원` } } },
      scales: {
        y: { ticks: { callback: v => `${Math.round(v/10000)}만`, font: { size: 10 } }, beginAtZero: true },
        x: { ticks: { font: { size: 10 } } }
      }
    }
  })
}

// ════════════════════════════════════════
// TAB 4: 발주 교차 분석
// ════════════════════════════════════════
async function txRenderCrossTab(container) {
  container.innerHTML = `
  <div id="txCrossContent">
    <div class="text-center text-gray-400 py-16">
      <i class="fas fa-spinner fa-spin text-3xl mb-3"></i><br>교차 분석 중...
    </div>
  </div>`
  await txLoadCrossAnalysis()
}

async function txLoadCrossAnalysis() {
  const el = document.getElementById('txCrossContent')
  if (!el) return
  try {
    const res = await axios.get(`/api/transaction/cross-analysis?year=${TXState.year}&month=${TXState.month}`,
      { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
    const d = res.data
    if (!d.ok) throw new Error(d.error)

    const s = d.summary || {}
    const items = d.discrepancies || []

    el.innerHTML = `
    <div class="space-y-4">
      <!-- 요약 -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        ${[
          { label:'발주 총액',    val: (s.total_order_amount||0).toLocaleString()+'원',   icon:'fa-shopping-cart', color:'blue' },
          { label:'명세서 총액',  val: (s.total_invoice_amount||0).toLocaleString()+'원', icon:'fa-file-invoice',  color:'green' },
          { label:'차이 항목',    val: (s.warning_items||0)+'건',                         icon:'fa-exclamation-triangle', color:'yellow' },
          { label:'심각 항목',    val: (s.critical_items||0)+'건',                        icon:'fa-times-circle',  color:'red' }
        ].map(k => `
          <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <div class="flex items-center gap-2 mb-2">
              <div class="w-8 h-8 rounded-lg bg-${k.color}-100 flex items-center justify-center">
                <i class="fas ${k.icon} text-${k.color}-500 text-sm"></i>
              </div>
              <span class="text-xs text-gray-500">${k.label}</span>
            </div>
            <div class="text-lg font-bold text-gray-800">${k.val}</div>
          </div>`).join('')}
      </div>

      <!-- 교차 분석 안내 -->
      <div class="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-700 flex items-start gap-2">
        <i class="fas fa-info-circle mt-0.5"></i>
        <div>발주 데이터와 거래명세서를 품목명 · 업체별로 매핑하여 수량 및 단가 차이를 분석합니다.
        수량 차이 ±20% 이상 또는 단가 차이 ±10% 이상 시 경고가 표시됩니다.</div>
      </div>

      <!-- 교차 분석 테이블 -->
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div class="flex items-center justify-between mb-3">
          <h4 class="font-bold text-gray-700 text-sm">발주 vs 명세서 상세 비교</h4>
          <div class="flex gap-2 text-xs">
            <span class="px-2 py-0.5 bg-red-100 text-red-600 rounded-full">● 심각</span>
            <span class="px-2 py-0.5 bg-yellow-100 text-yellow-600 rounded-full">● 경고</span>
            <span class="px-2 py-0.5 bg-green-100 text-green-600 rounded-full">● 정상</span>
          </div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead><tr class="bg-gray-50">
              <th class="text-left px-3 py-2 text-gray-500 border-b">품목명</th>
              <th class="text-left px-3 py-2 text-gray-500 border-b">업체</th>
              <th class="text-right px-3 py-2 text-gray-500 border-b">발주수량</th>
              <th class="text-right px-3 py-2 text-gray-500 border-b">명세서수량</th>
              <th class="text-right px-3 py-2 text-gray-500 border-b">수량차이</th>
              <th class="text-right px-3 py-2 text-gray-500 border-b">발주단가</th>
              <th class="text-right px-3 py-2 text-gray-500 border-b">명세서단가</th>
              <th class="text-right px-3 py-2 text-gray-500 border-b">단가차이</th>
              <th class="text-center px-3 py-2 text-gray-500 border-b">상태</th>
            </tr></thead>
            <tbody>
              ${items.length === 0 ? `
                <tr><td colspan="9" class="text-center text-gray-400 py-8">
                  발주 데이터 또는 명세서 데이터가 없습니다.
                </td></tr>` :
              items.map(item => `
                <tr class="border-b border-gray-50 hover:bg-gray-50 ${
                  item.alert_level==='critical'?'bg-red-50/40':
                  item.alert_level==='warning' ?'bg-yellow-50/40':''}">
                  <td class="px-3 py-2 font-medium text-gray-700">${item.item_name}</td>
                  <td class="px-3 py-2 text-gray-500 text-xs">${item.vendor_name||'-'}</td>
                  <td class="px-3 py-2 text-right">${(item.ordered_qty||0).toLocaleString()}</td>
                  <td class="px-3 py-2 text-right">${(item.invoice_qty||0).toLocaleString()}</td>
                  <td class="px-3 py-2 text-right font-medium ${item.qty_diff>0?'text-red-600':item.qty_diff<0?'text-blue-600':'text-gray-500'}">
                    ${item.qty_diff>0?'+':''}${(item.qty_diff||0).toFixed(1)}
                    ${item.qty_diff_pct ? `<span class="text-gray-400">(${item.qty_diff_pct}%)</span>` : ''}
                  </td>
                  <td class="px-3 py-2 text-right">${(item.ordered_price||0).toLocaleString()}</td>
                  <td class="px-3 py-2 text-right">${(item.invoice_price||0).toLocaleString()}</td>
                  <td class="px-3 py-2 text-right font-medium ${item.price_diff>0?'text-red-600':item.price_diff<0?'text-blue-600':'text-gray-500'}">
                    ${item.price_diff>0?'+':''}${(item.price_diff||0).toLocaleString()}
                    ${item.price_diff_pct ? `<span class="text-gray-400">(${item.price_diff_pct}%)</span>` : ''}
                  </td>
                  <td class="px-3 py-2 text-center">
                    <span class="px-2 py-0.5 rounded-full text-xs font-medium ${
                      item.alert_level==='critical'?'bg-red-100 text-red-600':
                      item.alert_level==='warning' ?'bg-yellow-100 text-yellow-600':
                      'bg-green-100 text-green-600'}">
                      ${item.alert_level==='critical'?'심각':item.alert_level==='warning'?'경고':'정상'}
                    </span>
                    ${item.alert_memo ? `<div class="text-gray-400 text-xs mt-0.5">${item.alert_memo}</div>` : ''}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`
  } catch(e) {
    el.innerHTML = `
    <div class="bg-white rounded-xl p-8 text-center text-gray-400">
      <i class="fas fa-exchange-alt text-4xl mb-3"></i>
      <p class="text-sm">${TXState.year}년 ${TXState.month}월 교차 분석 데이터가 없습니다.</p>
      <p class="text-xs mt-1 text-gray-300">${e.message}</p>
    </div>`
  }
}

// ── 공통 UI 헬퍼 ─────────────────────────────────────────────────────
function txShowMsg(id, type, msg) {
  const el = document.getElementById(id)
  if (!el) return
  const styles = {
    success: 'bg-green-50 border border-green-200 text-green-700',
    error:   'bg-red-50 border border-red-200 text-red-600',
    info:    'bg-blue-50 border border-blue-200 text-blue-700'
  }
  el.className = `${styles[type]||styles.info} rounded-lg p-3 text-sm`
  el.textContent = msg
  el.classList.remove('hidden')
}

async function txLoadDashboard() {
  TXState.year  = +document.getElementById('txYear').value
  TXState.month = +document.getElementById('txMonth').value
  txSwitchTab(TXState.tab)
}
