import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'
import { verifyToken, hashPassword } from './utils/auth'
import { JWT_SECRET } from './middleware/auth'
import authRoute from './routes/auth'
import dashboardRoute from './routes/dashboard'
import ordersRoute from './routes/orders'
import mealsRoute from './routes/meals'
import vendorsRoute from './routes/vendors'
import settingsRoute from './routes/settings'
import scheduleRoute from './routes/schedule'
import adminRoute from './routes/admin'
import cardExpensesRoute from './routes/card_expenses'
import ceoDashboardRoute from './routes/ceo-dashboard'
import transactionRoute from './routes/transaction'
import executiveRoute from './routes/executive'

type Bindings = { DB: D1Database }
type Variables = { user: any }

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

app.use('/static/*', serveStatic({ root: './' }))
// 정적 파일 캐시 (1시간) - 로컬 번들 파일의 빠른 서빙
app.use('/static/*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'public, max-age=3600')
})
app.use('/api/*', cors())

// favicon - 빈 204로 브라우저 에러 방지
app.get('/favicon.ico', (c) => new Response(null, { status: 204 }))

// ── 인증 미들웨어 (API) ──────────────────────────────────────────
app.use('/api/*', async (c, next) => {
  // 인증 불필요 경로
  if (c.req.path === '/api/auth/login') return next()
  // QR 공유 페이지용 public 라우트 (토큰 자체가 인증 수단)
  if (c.req.path.startsWith('/api/schedule/public/')) return next()
  // 팀 전체 스케줄 공개 라우트
  if (c.req.path.startsWith('/api/schedule/team-public/')) return next()
  
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)
  
  const payload = await verifyToken(token, JWT_SECRET)
  if (!payload) return c.json({ error: 'Invalid token' }, 401)
  
  c.set('user', payload)
  return next()
})

// ── API 라우트 ────────────────────────────────────────────────────
app.route('/api/auth', authRoute)
app.route('/api/dashboard', dashboardRoute)
app.route('/api/orders', ordersRoute)
app.route('/api/meals', mealsRoute)
app.route('/api/vendors', vendorsRoute)
app.route('/api/settings', settingsRoute)
app.route('/api/schedule', scheduleRoute)
app.route('/api/card-expenses', cardExpensesRoute)
app.route('/api/ceo-dashboard', ceoDashboardRoute)
app.route('/api/transaction', transactionRoute)
app.route('/api/executive', executiveRoute)

// ── 관리자 전용 API ───────────────────────────────────────────────
app.use('/api/admin/*', async (c, next) => {
  const user = c.get('user')
  if (!user || user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403)
  return next()
})
app.route('/api/admin', adminRoute)

// ── 페이지 라우트 ─────────────────────────────────────────────────
app.get('/login', (c) => c.html(getLoginPage()))
app.get('/', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/dashboard', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/orders', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/meals', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/schedule', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/analysis', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/settings', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/admin', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/report', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/hospital-manage', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/holiday-manage', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/ceo-dashboard', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/expense-doc', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/ingredient-prices', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/transaction-analysis', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/executive', (c) => { c.header('Cache-Control','no-store'); return c.html(getExecutiveShell()) })

// ── 직원용 개인 스케줄 공유 페이지 (QR 코드 스캔 후 표시) ──────
app.get('/my-schedule/:token', (c) => {
  c.header('Cache-Control', 'no-store')
  const token = c.req.param('token')
  return c.html(getMySchedulePage(token))
})

// ── 팀 전체 스케줄 공유 페이지 ─────────────────────────────────
app.get('/team-schedule/:token', (c) => {
  c.header('Cache-Control', 'no-store')
  const token = c.req.param('token')
  return c.html(getTeamSchedulePage(token))
})

// ── 전역 notFound / onError 핸들러 (500 방지) ────────────────────
app.notFound((c) => c.json({ error: 'Not Found' }, 404))
app.onError((err, c) => {
  console.error('API Error:', err?.message || err, err?.stack?.split('\n').slice(0,3).join(' | '))
  try {
    return c.json({ error: err?.message || 'Internal Server Error' }, 500)
  } catch(e2) {
    console.error('onError fallback:', e2)
    return new Response(JSON.stringify({ error: err?.message || 'Internal Server Error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
})

export default app

// ── 로그인 페이지 HTML ────────────────────────────────────────────
function getLoginPage(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Re&amp;H 급식 예산관리 시스템</title>
<link rel="icon" href="/favicon.ico" type="image/x-icon">
<script src="/static/tailwind.min.js"></script>
<link href="/static/fontawesome.min.css" rel="stylesheet">
<style>
  body { background: linear-gradient(135deg, #1a4731 0%, #15803d 60%, #166534 100%); min-height: 100vh; }
  .login-card { backdrop-filter: blur(10px); background: rgba(255,255,255,0.97); }
  .btn-login { background: linear-gradient(135deg, #166534, #15803d); }
  .btn-login:hover { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 6px 20px rgba(21,128,61,0.4); }
</style>
</head>
<body class="flex items-center justify-center min-h-screen p-4">
<div class="login-card rounded-2xl shadow-2xl p-8 w-full max-w-md">
  <div class="text-center mb-8">
    <div class="inline-flex items-center justify-center mb-4">
      <img src="/static/logo.png" alt="Re&H 로고" class="w-20 h-20 object-contain">
    </div>
    <h1 class="text-2xl font-bold text-gray-800">Re&amp;H 급식 예산관리</h1>
    <p class="text-gray-500 text-sm mt-1">Re&amp;H Nutrition Management System</p>
  </div>
  
  <div id="errorMsg" class="hidden bg-red-50 border border-red-200 text-red-600 rounded-lg p-3 mb-4 text-sm"></div>
  
  <form id="loginForm" class="space-y-4">
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1">아이디</label>
      <div class="relative">
        <i class="fas fa-user absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
        <input id="username" type="text" placeholder="아이디를 입력하세요"
          class="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-600 focus:border-transparent"
          autocomplete="username">
      </div>
    </div>
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1">비밀번호</label>
      <div class="relative">
        <i class="fas fa-lock absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
        <input id="password" type="password" placeholder="비밀번호를 입력하세요"
          class="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-600 focus:border-transparent"
          autocomplete="current-password">
      </div>
    </div>
    <div class="flex items-center justify-between">
      <label class="flex items-center gap-2 cursor-pointer select-none">
        <input id="rememberMe" type="checkbox" class="w-4 h-4 accent-green-600 rounded">
        <span class="text-sm text-gray-600">아이디·비밀번호 저장</span>
      </label>
      <button type="button" onclick="clearSavedLogin()" class="text-xs text-gray-400 hover:text-red-500 transition-colors">저장 삭제</button>
    </div>
    <button type="submit" class="btn-login w-full text-white font-semibold py-3 rounded-xl transition-all duration-200 shadow-md mt-2">
      <i class="fas fa-sign-in-alt mr-2"></i>로그인
    </button>
  </form>
  
  <div class="mt-6 p-4 bg-gray-50 rounded-xl text-xs text-gray-500">

  </div>
</div>

<script>
// 저장된 로그인 정보 불러오기
(function() {
  const saved = localStorage.getItem('savedLogin')
  if (saved) {
    try {
      const { username, password } = JSON.parse(saved)
      document.getElementById('username').value = username || ''
      document.getElementById('password').value = password || ''
      document.getElementById('rememberMe').checked = true
    } catch(e) {}
  }
})()

function clearSavedLogin() {
  localStorage.removeItem('savedLogin')
  document.getElementById('rememberMe').checked = false
  document.getElementById('username').value = ''
  document.getElementById('password').value = ''
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const username = document.getElementById('username').value
  const password = document.getElementById('password').value
  const rememberMe = document.getElementById('rememberMe').checked
  const errEl = document.getElementById('errorMsg')
  errEl.classList.add('hidden')

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
    const data = await res.json()
    if (!res.ok) {
      errEl.textContent = data.error || '로그인 실패'
      errEl.classList.remove('hidden')
      return
    }
    // 자동저장 처리
    if (rememberMe) {
      localStorage.setItem('savedLogin', JSON.stringify({ username, password }))
    } else {
      localStorage.removeItem('savedLogin')
    }
    localStorage.setItem('token', data.token)
    localStorage.setItem('role', data.role)
    localStorage.setItem('hospitalName', data.hospitalName || '')
    localStorage.setItem('username', data.username)
    window.location.href = data.role === 'admin' ? '/admin' : data.role === 'executive' ? '/executive' : '/dashboard'
  } catch(err) {
    errEl.textContent = '서버 연결 오류'
    errEl.classList.remove('hidden')
  }
})
</script>
</body>
</html>`
}

// ── 앱 메인 쉘 HTML ────────────────────────────────────────────────
function getAppShell(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Re&amp;H 급식 예산관리 시스템</title>
<link rel="icon" href="/favicon.ico" type="image/x-icon">
<script src="/static/tailwind.min.js"></script>
<link href="/static/fontawesome.min.css" rel="stylesheet">
<script src="/static/chart.umd.min.js"></script>
<script src="/static/axios.min.js"></script>
<script src="/static/xlsx.bundle.js"></script>
<script src="/static/jspdf.umd.min.js" defer></script>
<link rel="stylesheet" href="/static/styles.css?v=20260601-restore">
</head>
<body class="bg-gray-50">

<!-- 모바일 사이드바 오버레이 -->
<div id="sidebarOverlay" class="sidebar-overlay" onclick="closeSidebar()"></div>

<!-- 사이드바 + 메인 레이아웃 -->
<div class="flex h-screen overflow-hidden">

  <!-- 사이드바 -->
  <aside id="sidebar" class="sidebar w-64 flex-shrink-0 flex flex-col">
    <!-- 로고 + 모바일 닫기 버튼 -->
    <div class="p-4 border-b border-white/10">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
          <img src="/static/logo.png" alt="Re&H" class="w-8 h-8 object-contain" style="filter:brightness(0) invert(1)">
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-white font-bold text-sm leading-tight">Re&amp;H 급식 예산관리</div>
          <div id="hospitalNameDisplay" class="text-white/60 text-xs mt-0.5 truncate">로딩중...</div>
        </div>
        <!-- 모바일 전용 닫기 버튼 -->
        <button onclick="closeSidebar()" class="sidebar-close-btn text-white/70 hover:text-white w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10">
          <i class="fas fa-times text-sm"></i>
        </button>
      </div>
    </div>

    <!-- 월 선택 -->
    <div class="px-4 py-3 border-b border-white/10">
      <div class="flex items-center gap-2">
        <button onclick="changeMonth(-1)" class="text-white/70 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 active:bg-white/20">
          <i class="fas fa-chevron-left text-xs"></i>
        </button>
        <div class="flex-1 text-center">
          <span id="currentMonthDisplay" class="text-white font-semibold text-sm"></span>
        </div>
        <button onclick="changeMonth(1)" class="text-white/70 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 active:bg-white/20">
          <i class="fas fa-chevron-right text-xs"></i>
        </button>
      </div>
    </div>

    <!-- 메뉴 -->
    <nav class="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
      <div id="menuContainer"></div>
    </nav>

    <!-- 사용자 정보 + 로그아웃 -->
    <div class="p-3 border-t border-white/10">
      <div class="flex items-center gap-2 mb-2 px-1">
        <div class="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
          <i class="fas fa-user text-white text-xs"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div id="usernameDisplay" class="text-white text-xs font-medium truncate"></div>
          <div id="roleDisplay" class="text-white/50 text-xs"></div>
        </div>
      </div>
      <button onclick="logout()" class="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 text-xs transition active:bg-white/20">
        <i class="fas fa-sign-out-alt text-xs"></i><span>로그아웃</span>
      </button>
    </div>
  </aside>

  <!-- 메인 컨텐츠 -->
  <main class="flex-1 flex flex-col overflow-hidden min-w-0">
    <!-- 상단 헤더 -->
    <header class="bg-white border-b border-gray-200 px-3 py-2 flex items-center gap-2 flex-shrink-0 md:px-6 md:py-4">
      <!-- 모바일 햄버거 버튼 -->
      <button id="hamburgerBtn" onclick="openSidebar()" class="hamburger-btn w-9 h-9 flex items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 active:bg-gray-200 flex-shrink-0">
        <i class="fas fa-bars text-base"></i>
      </button>
      <!-- 타이틀 -->
      <div class="flex-1 min-w-0">
        <h1 id="pageTitle" class="text-base font-bold text-gray-800 truncate md:text-xl"></h1>
        <p id="pageSubtitle" class="text-xs text-gray-500 truncate hidden md:block"></p>
      </div>
      <!-- 우측 정보 -->
      <div class="flex items-center gap-1.5 flex-shrink-0">
        <span id="headerMonth" class="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full font-medium md:text-sm md:px-3"></span>
        <button id="copyUrlBtn" onclick="copyServiceUrl()" title="서비스 URL 복사"
          class="hidden md:flex items-center gap-1.5 text-sm text-gray-500 bg-gray-100 hover:bg-green-100 hover:text-green-700 px-3 py-1 rounded-full transition-all duration-150 border border-transparent hover:border-green-300">
          <i class="fas fa-link text-xs"></i>
          <span id="copyUrlLabel">URL 복사</span>
        </button>
      </div>
    </header>

    <!-- 페이지 컨텐츠 -->
    <div id="pageContent" class="flex-1 overflow-y-auto p-3 md:p-6"></div>
    <!-- 발주/식수 입력: DOM 보존용 영구 패널 -->
    <div id="orders-panel" style="display:none" class="flex-1 overflow-y-auto p-2 md:p-6" style="overflow-x:hidden;min-width:0;box-sizing:border-box"></div>
    <div id="meals-panel"  style="display:none" class="flex-1 overflow-y-auto p-2 md:p-6"></div>
  </main>
</div>

<!-- 모바일 하단 네비게이션 바 -->
<nav id="mobileBottomNav" class="mobile-bottom-nav">
  <div id="mobileNavItems" class="flex justify-around items-center h-full px-1"></div>
</nav>

<script src="/static/app.js?v=20260603-leave-ssot"></script>
</body>
</html>`
}

// ── 운영진 전용 페이지 Shell ─────────────────────────────────────
function getExecutiveShell(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<title>운영 현황 대시보드</title>
<link rel="icon" href="/favicon.ico" type="image/x-icon">
<script src="/static/tailwind.min.js"></script>
<link href="/static/fontawesome.min.css" rel="stylesheet">
<script src="/static/chart.umd.min.js"></script>
<style>
  * { box-sizing: border-box; }
  body { background: #f0f4f8; font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif; }
  .exec-card { background: white; border-radius: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
  .kpi-card { background: white; border-radius: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); transition: transform 0.2s; }
  .kpi-card:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.12); }
  .gradient-blue { background: linear-gradient(135deg, #1e40af, #3b82f6); }
  .gradient-green { background: linear-gradient(135deg, #166534, #16a34a); }
  .gradient-amber { background: linear-gradient(135deg, #92400e, #d97706); }
  .gradient-purple { background: linear-gradient(135deg, #581c87, #9333ea); }
  .gradient-red { background: linear-gradient(135deg, #991b1b, #ef4444); }
  .progress-bar { height: 8px; border-radius: 4px; background: #e5e7eb; overflow: hidden; }
  .progress-fill { height: 100%; border-radius: 4px; transition: width 0.8s ease; }
  .badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; }
  .tab-active { border-bottom: 3px solid #1e40af; color: #1e40af; font-weight: 700; }
  .vs-btn { cursor: pointer; border: none; background: transparent; white-space: nowrap; }
  .vs-btn:hover { background: #f1f5f9; color: #334155; }
  .vs-active { background: linear-gradient(135deg, #166534, #16a34a) !important; color: #fff !important; box-shadow: 0 2px 8px rgba(22,163,74,0.35); }
  .vs-active:hover { color: #fff !important; }
  .loading-spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 768px) {
    .hide-mobile { display: none !important; }
    .grid-mobile-1 { grid-template-columns: 1fr !important; }
  }
</style>
</head>
<body>
<!-- 헤더 -->
<header style="background:linear-gradient(135deg,#1a4731,#15803d)" class="sticky top-0 z-50 shadow-lg">
  <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
        <i class="fas fa-chart-line text-white"></i>
      </div>
      <div>
        <div id="execHospName" class="text-white font-bold text-base leading-tight">운영 현황</div>
        <div id="execPeriodLabel" class="text-green-200 text-xs">로딩 중...</div>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <!-- 월 선택 -->
      <div class="flex items-center gap-1 bg-white/10 rounded-xl px-3 py-1.5">
        <button onclick="execChangeMonth(-1)" class="text-white/70 hover:text-white transition px-1">
          <i class="fas fa-chevron-left text-xs"></i>
        </button>
        <span id="execMonthDisplay" class="text-white text-sm font-semibold min-w-[70px] text-center"></span>
        <button onclick="execChangeMonth(1)" class="text-white/70 hover:text-white transition px-1">
          <i class="fas fa-chevron-right text-xs"></i>
        </button>
      </div>
      <!-- 새로고침 -->
      <button onclick="loadExecData()" class="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition" title="새로고침">
        <i class="fas fa-sync-alt text-sm" id="execRefreshIcon"></i>
      </button>
      <!-- 로그아웃 -->
      <button onclick="execLogout()" class="w-9 h-9 rounded-xl bg-white/10 hover:bg-red-500/40 flex items-center justify-center text-white transition" title="로그아웃">
        <i class="fas fa-sign-out-alt text-sm"></i>
      </button>
    </div>
  </div>
</header>

<!-- 메인 콘텐츠 -->
<main class="max-w-7xl mx-auto px-4 py-6" id="execMain">
  <!-- 로딩 -->
  <div id="execLoading" class="flex items-center justify-center py-20">
    <div class="text-center">
      <i class="fas fa-circle-notch text-4xl text-green-600 loading-spin mb-3 block"></i>
      <p class="text-gray-500">데이터 불러오는 중...</p>
    </div>
  </div>
  <!-- 뷰 전환 토글 (요약 / 분석 / 원본) -->
  <div id="execViewToggle" class="hidden mb-5 flex items-center gap-1 bg-white border border-gray-200 rounded-2xl p-1 shadow-sm w-full sm:w-auto">
    <button id="vsBtn-SUMMARY" onclick="execSetViewStyle('SUMMARY')" class="vs-btn flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-gray-500 transition">
      <i class="fas fa-gauge-high text-xs"></i><span>요약</span>
    </button>
    <button id="vsBtn-ANALYSIS" onclick="execSetViewStyle('ANALYSIS')" class="vs-btn flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-gray-500 transition">
      <i class="fas fa-chart-column text-xs"></i><span>분석</span>
    </button>
    <button id="vsBtn-DETAIL" onclick="execSetViewStyle('DETAIL')" class="vs-btn flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-gray-500 transition">
      <i class="fas fa-table-list text-xs"></i><span>원본</span>
    </button>
  </div>
  <!-- 콘텐츠 영역 -->
  <div id="execContent" class="hidden space-y-6"></div>
</main>

<script src="/static/executive.js?v=20260601-analysissplit"></script>
</body>
</html>`
}

// ── 직원용 개인 스케줄 모바일 페이지 ──────────────────────────
function getMySchedulePage(token: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>내 근무표</title>
<link rel="stylesheet" href="/static/fontawesome.min.css">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0fdf4;min-height:100vh;}
.header{background:linear-gradient(135deg,#166534,#15803d);color:white;padding:16px 20px;position:sticky;top:0;z-index:10;box-shadow:0 2px 8px rgba(0,0,0,.2);}
.header h1{font-size:18px;font-weight:700;}
.header .sub{font-size:12px;opacity:.8;margin-top:2px;}
.month-nav{display:flex;align-items:center;gap:8px;background:white;padding:10px 16px;border-bottom:1px solid #e5e7eb;}
.month-nav button{width:32px;height:32px;border:1px solid #d1d5db;border-radius:8px;background:white;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;}
.month-nav .month-label{flex:1;text-align:center;font-weight:700;font-size:15px;color:#166534;}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:12px 16px;background:white;border-bottom:1px solid #e5e7eb;}
.stat-card{background:#f9fafb;border-radius:10px;padding:10px;text-align:center;}
.stat-card .val{font-size:22px;font-weight:800;color:#166534;}
.stat-card .lbl{font-size:10px;color:#6b7280;margin-top:2px;}
.calendar{padding:12px 16px 80px;}
.cal-header{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px;}
.cal-header div{text-align:center;font-size:10px;font-weight:700;color:#6b7280;padding:4px 0;}
.cal-header div.sun{color:#ef4444;}
.cal-header div.sat{color:#3b82f6;}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;}
.cal-day{min-height:56px;border-radius:10px;padding:4px;display:flex;flex-direction:column;align-items:center;gap:2px;background:white;border:1px solid #f3f4f6;}
.cal-day.empty{background:transparent;border-color:transparent;}
.cal-day.today .day-num{background:#166534;color:white;border-radius:50%;}
.cal-day.off-day{background:#fff1f2;}
.cal-day .day-num{width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#374151;}
.cal-day.sun .day-num{color:#ef4444;}
.cal-day.sat .day-num{color:#3b82f6;}
.shift-badge{padding:2px 6px;border-radius:5px;font-size:9px;font-weight:700;width:100%;text-align:center;max-width:38px;}
.code-legend{display:flex;flex-wrap:wrap;gap:6px;padding:10px 16px;background:white;border-bottom:1px solid #e5e7eb;}
.legend-item{display:flex;align-items:center;gap:4px;font-size:10px;color:#374151;}
.legend-dot{width:10px;height:10px;border-radius:3px;}
.bottom-bar{position:fixed;bottom:0;left:0;right:0;background:white;border-top:1px solid #e5e7eb;padding:12px 16px;display:flex;gap:8px;z-index:10;box-shadow:0 -2px 8px rgba(0,0,0,.08);}
.btn-print{flex:1;padding:10px;border-radius:10px;background:#166534;color:white;border:none;font-size:13px;font-weight:700;cursor:pointer;}
.btn-share{padding:10px 14px;border-radius:10px;background:#f3f4f6;color:#374151;border:none;font-size:13px;cursor:pointer;}
.loading{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:12px;}
.spinner{width:40px;height:40px;border:4px solid #d1fae5;border-top-color:#166534;border-radius:50%;animation:spin .8s linear infinite;}
@keyframes spin{to{transform:rotate(360deg)}}
.error-box{margin:20px;padding:20px;background:#fff1f2;border-radius:12px;text-align:center;color:#b91c1c;}
.change-log{background:white;margin:0 0 80px;border-top:4px solid #f0fdf4;}
.change-log-header{padding:12px 16px;display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;border-bottom:1px solid #f3f4f6;}
.change-log-header span{font-size:13px;font-weight:700;color:#374151;flex:1;}
.change-log-body{padding:0 16px 12px;}
.change-item{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f9fafb;font-size:12px;}
.change-item:last-child{border-bottom:none;}
@media print{.bottom-bar,.month-nav button,.change-log{display:none!important;} body{background:white;} .header{background:#166534 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
</style>
</head>
<body>
<div id="app">
  <div class="loading"><div class="spinner"></div><p style="color:#6b7280;font-size:13px;">근무표 불러오는 중...</p></div>
</div>
<script>
const TOKEN = '${token}'
let curY = new Date().getFullYear(), curM = new Date().getMonth()+1

async function load() {
  document.getElementById('app').innerHTML = '<div class="loading"><div class="spinner"></div><p style="color:#6b7280;font-size:13px;">불러오는 중...</p></div>'
  try {
    const r = await fetch('/api/schedule/public/'+TOKEN+'?year='+curY+'&month='+curM)
    if (!r.ok) throw new Error('유효하지 않은 링크입니다')
    render(await r.json())
  } catch(e) {
    document.getElementById('app').innerHTML = '<div class="error-box"><i class="fas fa-exclamation-triangle" style="font-size:24px;margin-bottom:8px;display:block"></i><b>오류</b><p style="margin-top:6px;font-size:13px;">'+e.message+'</p></div>'
  }
}

function style(code, shifts) {
  if (!code) return ''
  const sf = shifts.find(s => s.shift_code === code)
  if (sf && sf.color) return 'background:'+sf.color+'22;color:'+sf.color
  const m = {'연':'background:#fef9c3;color:#92400e','휴':'background:#fee2e2;color:#b91c1c','오전':'background:#ede9fe;color:#6d28d9','오후':'background:#dbeafe;color:#1d4ed8','경조':'background:#fce7f3;color:#9d174d','OT':'background:#ecfdf5;color:#065f46'}
  return m[code] || 'background:#f3f4f6;color:#374151'
}

function render(d) {
  const {employee:emp, hospital, year, month, schedMap, workDays, codeCount, shifts, totalDays, changeLog} = d
  const td = new Date(), todayStr = td.getFullYear()+'-'+String(td.getMonth()+1).padStart(2,'0')+'-'+String(td.getDate()).padStart(2,'0')

  // 페이지 타이틀 업데이트
  document.title = emp.name + ' 님의 근무표 | ' + hospital.name

  const legend = shifts.filter(s=>s.shift_code).map(s=>'<div class="legend-item"><div class="legend-dot" style="background:'+s.color+'33;border:1.5px solid '+s.color+'"></div><span>'+s.shift_code+(s.shift_name&&s.shift_name!==s.shift_code?' ('+s.shift_name+')':'')+'</span></div>').join('')+
    ['연','휴'].map(c=>{const s=style(c,[]);const bg=s.match(/background:([^;]+)/);return '<div class="legend-item"><div class="legend-dot" style="background:'+(bg?bg[1]:'#eee')+'"></div><span>'+c+'</span></div>'}).join('')

  const statsItems = Object.entries(codeCount).slice(0,2).map(([k,v])=>'<div class="stat-card"><div class="val" style="font-size:18px">'+v+'</div><div class="lbl">'+k+'</div></div>').join('')

  const firstDow = new Date(year, month-1, 1).getDay()
  let cells = ''
  for (let i=0;i<firstDow;i++) cells += '<div class="cal-day empty"></div>'
  for (let day=1;day<=totalDays;day++) {
    const ds = year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0')
    const dow = new Date(year,month-1,day).getDay()
    const code = (schedMap[ds] && schedMap[ds].shift_code) || ''
    const isOff = code==='연'||code==='휴'
    const cls = 'cal-day'+(dow===0?' sun':'')+(dow===6?' sat':'')+(isOff?' off-day':'')+(ds===todayStr?' today':'')
    const st = style(code, shifts)
    cells += '<div class="'+cls+'"><div class="day-num">'+day+'</div>'+(code?'<div class="shift-badge" style="'+st+'">'+code+'</div>':(dow===0?'<div style="font-size:8px;color:#fca5a5">휴</div>':''))+'</div>'
  }

  // 변경 이력 섹션
  const logs = changeLog || []
  let changeHtml = ''
  if (logs.length > 0) {
    const items = logs.map(lg => {
      const dt = lg.work_date  // 'YYYY-MM-DD'
      const [y2,m2,d2] = dt.split('-')
      const dateStr = parseInt(m2)+'월 '+parseInt(d2)+'일'
      const oldTxt = lg.old_shift_code || '없음'
      const newTxt = lg.new_shift_code || '삭제'
      const oldSt = style(lg.old_shift_code, shifts)
      const newSt = style(lg.new_shift_code, shifts)
      const timeStr = lg.changed_at ? lg.changed_at.slice(0,16).replace('T',' ') : ''
      return '<div class="change-item">'+
        '<div style="width:52px;font-weight:700;color:#374151;flex-shrink:0">'+dateStr+'</div>'+
        '<div style="padding:2px 7px;border-radius:5px;font-weight:700;font-size:11px;'+(oldSt||'background:#f3f4f6;color:#9ca3af')+'">'+oldTxt+'</div>'+
        '<i class="fas fa-arrow-right" style="color:#9ca3af;font-size:10px;flex-shrink:0"></i>'+
        '<div style="padding:2px 7px;border-radius:5px;font-weight:700;font-size:11px;'+(newSt||'background:#f3f4f6;color:#9ca3af')+'">'+newTxt+'</div>'+
        '<div style="margin-left:auto;font-size:10px;color:#9ca3af;flex-shrink:0">'+timeStr+'</div>'+
        '</div>'
    }).join('')
    changeHtml = '<div class="change-log">'+
      '<div class="change-log-header" onclick="toggleChangeLog(this)">'+
      '<i class="fas fa-history" style="color:#166534;font-size:13px"></i>'+
      '<span>최근 스케줄 변경 이력 ('+logs.length+'건)</span>'+
      '<i class="fas fa-chevron-down" style="color:#9ca3af;font-size:11px"></i>'+
      '</div>'+
      '<div class="change-log-body">'+items+'</div>'+
      '</div>'
  }

  document.getElementById('app').innerHTML =
    '<div class="header"><div style="display:flex;align-items:center;gap:10px"><div style="width:40px;height:40px;background:rgba(255,255,255,.2);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas fa-user" style="font-size:16px"></i></div><div><h1 style="font-size:17px;font-weight:800"><span style="opacity:.9;font-weight:500;font-size:14px">'+emp.name+'</span> 님의 근무표</h1><div class="sub">'+hospital.name+(emp.position?' · '+emp.position:'')+'</div></div></div></div>'+
    '<div class="month-nav"><button onclick="prev()"><i class="fas fa-chevron-left"></i></button><div class="month-label">'+year+'년 '+month+'월</div><button onclick="next()"><i class="fas fa-chevron-right"></i></button></div>'+
    '<div class="stats"><div class="stat-card"><div class="val">'+workDays+'</div><div class="lbl">근무일수</div></div>'+statsItems+'</div>'+
    '<div class="code-legend">'+legend+'</div>'+
    '<div class="calendar"><div class="cal-header"><div class="sun">일</div><div>월</div><div>화</div><div>수</div><div>목</div><div>금</div><div class="sat">토</div></div><div class="cal-grid">'+cells+'</div></div>'+
    changeHtml+
    '<div class="bottom-bar"><button class="btn-print" onclick="window.print()"><i class="fas fa-print" style="margin-right:6px"></i>인쇄 / PDF 저장</button><button class="btn-share" onclick="share()" title="링크 복사"><i class="fas fa-share-alt"></i></button></div>'
}

function prev(){curM--;if(curM<1){curM=12;curY--}load()}
function next(){curM++;if(curM>12){curM=1;curY++}load()}
function share(){const u=location.href;if(navigator.share)navigator.share({title:'내 근무표',url:u});else if(navigator.clipboard)navigator.clipboard.writeText(u).then(()=>alert('링크가 복사되었습니다'))}
function toggleChangeLog(el){const b=el.nextElementSibling;if(b)b.style.display=b.style.display==='none'?'block':'none'}
load()
</script>
</body>
</html>`
}

// ── 전체 팀 스케줄 공유 페이지 (직원 공유 뷰 완전 동일) ─────
function getTeamSchedulePage(token: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<title>전체 근무표</title>
<link rel="icon" href="/favicon.ico" type="image/x-icon">
<link href="/static/fontawesome.min.css" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
html,body{height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f1f5f9;font-size:12px;}
.page-wrap{max-width:1600px;margin:0 auto;padding:14px 14px 32px;}
/* 헤더 */
.pg-header{background:linear-gradient(135deg,#1e40af,#2563eb);border-radius:16px 16px 0 0;padding:14px 18px 10px;}
.pg-header h1{font-size:17px;font-weight:900;color:white;margin:0;}
.pg-header .sub{font-size:10px;color:rgba(255,255,255,.75);margin:3px 0 0;}
.pg-header .actions{display:flex;gap:6px;margin-top:10px;}
.pg-header .actions button{padding:6px 12px;background:rgba(255,255,255,.2);backdrop-filter:blur(4px);color:white;border:1px solid rgba(255,255,255,.35);border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;}
.pg-header .actions button:hover{background:rgba(255,255,255,.3);}
/* 범례 */
.legend-box{padding:8px 14px;background:#f8fafc;border-bottom:1px solid #e5e7eb;display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;}
.legend-inner{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
.leg-tag{font-size:10px;font-weight:700;color:#374151;margin-right:2px;}
.leg-badge{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:18px;border-radius:4px;font-size:9px;font-weight:800;}
.leg-item{display:inline-flex;align-items:center;gap:4px;font-size:10px;color:#374151;}
/* 테이블 영역 */
.tbl-scroll{overflow-x:auto;max-height:68vh;}
table.sched-tbl{width:100%;border-collapse:collapse;font-size:11px;}
/* 이름 고정 셀 */
.name-td{padding:5px 8px;min-width:90px;max-width:110px;position:sticky;left:0;z-index:5;border-right:4px solid var(--gc,#2563eb);}
.name-td .emp-name{font-size:12px;font-weight:800;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.name-td .emp-pos{font-size:9px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
/* 날짜 헤더 */
th.date-th{padding:2px 0;min-width:26px;text-align:center;font-size:9px;border-left:1px solid #e2e8f0;font-weight:800;}
th.date-th .dn{font-size:10px;font-weight:800;}
th.date-th .dd{font-size:9px;}
/* 통계 헤더 */
th.stat-hd{padding:3px 4px;min-width:34px;text-align:center;font-size:9px;color:#64748b;border-left:2px solid #e2e8f0;background:#f8fafc;}
th.stat-hd.sum-hd{min-width:80px;text-align:left;padding:3px 6px;border-left:1px solid #e2e8f0;}
/* 직원 행 날짜 셀 */
td.day-td{padding:2px 1px;text-align:center;min-width:26px;vertical-align:middle;}
/* 통계 셀 */
td.work-td{padding:3px 4px;text-align:center;min-width:34px;border-left:2px solid #e2e8f0;background:#f8fafc;white-space:nowrap;}
td.off-td{padding:3px 4px;text-align:center;min-width:34px;border-left:1px solid #e2e8f0;background:#f8fafc;white-space:nowrap;}
td.sum-td{padding:3px 6px;min-width:80px;border-left:1px solid #e2e8f0;background:#f9fafb;}
/* 그룹 헤더 */
tr.grp-hdr td{padding:0;}
.grp-title{border-top:3px solid var(--gc,#2563eb);border-bottom:1px solid #e2e8f0;padding:5px 14px;display:flex;align-items:center;gap:8px;background:white;}
/* 날짜 헤더 행 */
tr.date-hdr-row{background:#f8fafc;border-top:2px solid var(--gc,#2563eb);}
tr.date-hdr-row th.name-th{padding:5px 10px;text-align:left;min-width:90px;position:sticky;left:0;background:#f8fafc;z-index:15;font-size:11px;font-weight:800;border-right:4px solid var(--gc,#2563eb);}
/* 직원 행 */
tr.emp-row{border-bottom:1px solid #e2e8f0;}
tr.emp-row:hover td{filter:brightness(.97);}
/* 하단 안내 */
.footer-note{padding:8px 14px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:10px;color:#64748b;display:flex;align-items:center;gap:6px;border-radius:0 0 16px 16px;}
/* 로딩/에러 */
.loading{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:12px;}
.spinner{width:40px;height:40px;border:4px solid #dbeafe;border-top-color:#2563eb;border-radius:50%;animation:spin .8s linear infinite;}
@keyframes spin{to{transform:rotate(360deg)}}
.error-box{margin:20px;padding:20px;background:#fff1f2;border-radius:12px;text-align:center;color:#b91c1c;}
/* 월 네비 */
.month-nav-bar{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.15);border-radius:10px;padding:5px 10px;margin-top:8px;}
.month-nav-bar button{width:24px;height:24px;border:1px solid rgba(255,255,255,.4);border-radius:6px;background:rgba(255,255,255,.15);color:white;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center;}
.month-nav-bar button:hover{background:rgba(255,255,255,.3);}
.month-nav-bar .mlabel{flex:1;text-align:center;font-weight:800;font-size:13px;color:white;}
/* 인쇄 */
@media print{
  .pg-header .actions,.month-nav-bar{display:none!important;}
  .pg-header{-webkit-print-color-adjust:exact;print-color-adjust:exact;border-radius:0;}
  .grp-title,.tbl-scroll{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  body{background:white;}
  .tbl-scroll{overflow:visible;max-height:none;}
  table.sched-tbl{font-size:8px;}
  th,td{padding:2px 1px!important;}
  @page{margin:8mm;size:A4 landscape;}
}
.emp-row:hover td{filter:brightness(.97);}
</style>
</head>
<body>
<div class="page-wrap">
  <div id="app">
    <div class="loading"><div class="spinner"></div><p style="color:#6b7280;font-size:13px;">근무표 불러오는 중...</p></div>
  </div>
</div>
<script>
const TOKEN = '${token}'
let curY = new Date().getFullYear(), curM = new Date().getMonth()+1

async function load() {
  document.getElementById('app').innerHTML = '<div class="loading"><div class="spinner"></div><p style="color:#6b7280;font-size:13px;">불러오는 중...</p></div>'
  try {
    const r = await fetch('/api/schedule/team-public/'+TOKEN+'?year='+curY+'&month='+curM)
    if (!r.ok) throw new Error('유효하지 않은 링크입니다')
    render(await r.json())
  } catch(e) {
    document.getElementById('app').innerHTML = '<div class="error-box"><i class="fas fa-exclamation-triangle" style="font-size:24px;margin-bottom:8px;display:block"></i><b>오류</b><p style="margin-top:6px;font-size:13px;">'+e.message+'</p></div>'
  }
}

const REST_CODES = new Set(['연','휴','경조','병가'])
const FIXED_LEGEND = [
  {code:'연',label:'연차',color:'#f59e0b'},
  {code:'휴',label:'휴무',color:'#ef4444'},
  {code:'경조',label:'경조사',color:'#a855f7'},
  {code:'OT',label:'초과근무',color:'#059669'}
]
const STAFF_GROUPS = [
  {key:'nutritionist',label:'영양사',     icon:'fa-heartbeat', color:'#9d174d', filter:e=>e.team==='nutrition'||(e.position_name||e.position||'').includes('영양')},
  {key:'chef',        label:'조리장/셰프',icon:'fa-crown',     color:'#92400e', filter:e=>e.team!=='nutrition'&&/(장|셰프|chef|수석|책임)/i.test(e.position_name||e.position||'')},
  {key:'cook',        label:'조리사',     icon:'fa-utensils',  color:'#166534', filter:e=>e.team!=='nutrition'&&/(조리사)/.test(e.position_name||e.position||'')},
  {key:'assistant',   label:'조리원',     icon:'fa-user-cog',  color:'#1e40af', filter:e=>e.team!=='nutrition'&&/(조리원)/.test(e.position_name||e.position||'')},
  {key:'manager',     label:'매니저',     icon:'fa-user-tie',  color:'#5b21b6', filter:e=>e.team!=='nutrition'&&/(매니저|manager)/i.test(e.position_name||e.position||'')},
  {key:'parttime',    label:'파트타이머', icon:'fa-user-clock',color:'#0e7490', filter:e=>e.team!=='nutrition'&&/(파트|part)/i.test(e.position_name||e.position||'')},
  {key:'other',       label:'기타',       icon:'fa-users',     color:'#374151', filter:null}
]

function getCodeBadge(code, isSun, isSat, isHoliday, shiftColorMap) {
  if (!code || code==='-') return ''
  let bg, fg
  if (shiftColorMap[code]) {
    bg = shiftColorMap[code]+'18'; fg = shiftColorMap[code]
  } else {
    const dm = {'연':'#854d0e,#fefce8','휴':'#991b1b,#fef2f2','경조':'#6b21a8,#fdf4ff','병가':'#3730a3,#eef2ff','OT':'#14532d,#f0fdf4'}
    const parts = (dm[code]||'#1e293b,#f8fafc').split(',')
    fg=parts[0]; bg=parts[1]
  }
  const isOff = REST_CODES.has(code)
  const border = isHoliday&&!isOff ? 'border:1.5px solid '+fg+'66;' : ''
  return '<span style="display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;border-radius:5px;font-size:11px;font-weight:800;background:'+bg+';color:'+fg+';'+border+'">'+code+'</span>'
}

function render(d) {
  const {hospital, year, month, totalDays, employees, schedMap, shifts, holidays} = d
  document.title = hospital.name + ' ' + year + '년 ' + month + '월 전체 근무표'

  const shiftColorMap = {}
  shifts.forEach(s => { shiftColorMap[s.shift_code] = s.color })

  const holSet = new Set((holidays||[]).map(h => h.date||h))
  const dayNames = ['일','월','화','수','목','금','토']

  // 팀별 그룹핑
  const assignedIds = new Set()
  const staffGroups = []
  STAFF_GROUPS.forEach(grp => {
    const members = grp.filter
      ? employees.filter(e => !assignedIds.has(e.id) && grp.filter(e))
      : employees.filter(e => !assignedIds.has(e.id))
    members.forEach(e => assignedIds.add(e.id))
    if (members.length > 0) staffGroups.push({...grp, members})
  })

  // 날짜 헤더 빌더
  function buildDateHeader(grpColor) {
    const ths = Array.from({length: totalDays}, (_, i) => {
      const day = i+1
      const ds = year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0')
      const dow = new Date(year, month-1, day).getDay()
      const isSun=dow===0, isSat=dow===6, isHol=holSet.has(ds)
      const bg = isHol||isSun ? '#fce7f3' : isSat ? '#eff6ff' : '#f8fafc'
      const tc = isHol||isSun ? '#9d174d' : isSat ? '#1e40af' : '#334155'
      return '<th class="date-th" style="background:'+bg+';color:'+tc+'">'+
        '<div class="dn">'+day+'</div>'+
        '<div class="dd">'+dayNames[dow]+'</div>'+
        (isHol ? '<div style="font-size:6px;color:#be185d">★</div>' : '')+
        '</th>'
    }).join('')
    return '<tr class="date-hdr-row" style="--gc:'+grpColor+'">'+
      '<th class="name-th" style="color:'+grpColor+'">이름/직위</th>'+
      ths+
      '<th class="stat-hd">근무</th>'+
      '<th class="stat-hd">휴무</th>'+
      '<th class="stat-hd sum-hd">유형요약</th>'+
      '</tr>'
  }

  // 직원 행 빌더
  function buildEmpRow(emp, empIdx, grpColor) {
    const empSched = schedMap[emp.id] || {}
    let workCount=0, offCount=0
    const codeCounts = {}

    const cells = Array.from({length: totalDays}, (_, i) => {
      const day = i+1
      const ds = year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0')
      const dow = new Date(year, month-1, day).getDay()
      const isSun=dow===0, isSat=dow===6, isHol=holSet.has(ds)
      const code = empSched[ds] || ''
      const isOff = REST_CODES.has(code)
      if (code && !isOff && code!=='-') { workCount++; codeCounts[code]=(codeCounts[code]||0)+1 }
      if (isOff) offCount++
      const cellBg = isOff ? (code==='연'?'#fefce8':(code==='경조'?'#fdf4ff':'#fef2f2'))
                   : isHol ? '#fdf2f8'
                   : isSun ? '#fdf2f8'
                   : isSat ? '#f0f4ff'
                   : (empIdx%2===0 ? '#fff' : '#f9fafb')
      const borderCol = isHol ? '#f9a8d4' : isSun ? '#fce7f3' : isSat ? '#e0e7ff' : '#e2e8f0'
      const badge = getCodeBadge(code, isSun, isSat, isHol, shiftColorMap)
      const hDot = isHol&&!code ? '<span style="display:block;width:5px;height:5px;border-radius:50%;background:#be185d;margin:2px auto 0"></span>' : ''
      return '<td class="day-td" style="border-left:1px solid '+borderCol+';background:'+cellBg+'">'+badge+hDot+'</td>'
    }).join('')

    const summaryItems = Object.entries(codeCounts).sort((a,b)=>b[1]-a[1]).map(([c,cnt]) => {
      const fg = shiftColorMap[c] || '#6b7280'
      return '<span style="display:inline-flex;align-items:center;gap:2px;font-size:9px;background:'+fg+'18;color:'+fg+';border-radius:4px;padding:1px 5px;font-weight:700">'+c+' <span style="opacity:.7">'+cnt+'</span></span>'
    }).join('')

    const rowBg = empIdx%2===0 ? '#fff' : '#f9fafb'
    return '<tr class="emp-row">'+
      '<td class="name-td" style="background:'+rowBg+';--gc:'+grpColor+'">'+
        '<div class="emp-name">'+emp.name+'</div>'+
        '<div class="emp-pos">'+(emp.position_name||emp.position||'')+'</div>'+
      '</td>'+
      cells+
      '<td class="work-td"><div style="font-size:13px;font-weight:900;color:#166534">'+workCount+'</div><div style="font-size:8px;color:#86efac">근무</div></td>'+
      '<td class="off-td"><div style="font-size:13px;font-weight:900;color:#b45309">'+offCount+'</div><div style="font-size:8px;color:#fbbf24">휴무</div></td>'+
      '<td class="sum-td"><div style="display:flex;flex-wrap:wrap;gap:2px">'+summaryItems+'</div></td>'+
      '</tr>'
  }

  // 그룹 rows 조립
  let allGroupRows = ''
  staffGroups.forEach(grp => {
    allGroupRows += '<tr class="grp-hdr"><td colspan="'+(totalDays+4)+'">'+
      '<div class="grp-title" style="--gc:'+grp.color+'">'+
        '<i class="fas '+grp.icon+'" style="color:'+grp.color+';font-size:12px"></i>'+
        '<span style="font-size:12px;font-weight:800;color:'+grp.color+'">'+grp.label+'</span>'+
        '<span style="font-size:10px;color:#94a3b8">('+grp.members.length+'명)</span>'+
      '</div>'+
    '</td></tr>'
    allGroupRows += buildDateHeader(grp.color)
    grp.members.forEach((emp, idx) => { allGroupRows += buildEmpRow(emp, idx, grp.color) })
  })

  // 범례 HTML
  const legendShifts = shifts.filter(s=>s.shift_code).map(s =>
    '<span class="leg-item">'+
      '<span class="leg-badge" style="background:'+s.color+'28;color:'+s.color+';border:1px solid '+s.color+'44">'+s.shift_code+'</span>'+
      (s.shift_name||s.shift_code)+
    '</span>'
  ).join('')
  const fixedLegend = FIXED_LEGEND.map(l =>
    '<span class="leg-item">'+
      '<span class="leg-badge" style="background:'+l.color+'18;color:'+l.color+';border:1px solid '+l.color+'44">'+l.code+'</span>'+
      l.label+
    '</span>'
  ).join('')
  const holListHtml = (holidays||[]).length
    ? (holidays||[]).map(h => {
        const hd = typeof h==='string'?h:(h?.date||'')
        if (!hd) return ''
        return '<span style="font-size:10px;color:#b91c1c;background:#fff1f2;border:1px solid #fecaca;border-radius:5px;padding:2px 7px">'+hd.substring(5)+' '+(h?.name||'')+'</span>'
      }).filter(Boolean).join('')
    : '<span style="font-size:10px;color:#9ca3af">공휴일 없음</span>'

  document.getElementById('app').innerHTML =
    '<div style="background:white;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden">'+
    '<div class="pg-header">'+
      '<div class="month-nav-bar">'+
        '<button onclick="prev()"><i class="fas fa-chevron-left"></i></button>'+
        '<div class="mlabel">'+year+'년 '+month+'월</div>'+
        '<button onclick="next()"><i class="fas fa-chevron-right"></i></button>'+
      '</div>'+
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:8px">'+
        '<div>'+
          '<h1>'+hospital.name+'</h1>'+
          '<p class="sub"><i class="fas fa-shield-alt" style="margin-right:4px"></i>'+year+'년 '+month+'월 전체 근무표 · 직원 공유용</p>'+
        '</div>'+
        '<div class="actions">'+
          '<button onclick="window.print()"><i class="fas fa-print" style="margin-right:4px"></i>인쇄/PDF</button>'+
        '</div>'+
      '</div>'+
    '</div>'+
    '<div class="legend-box">'+
      '<div class="legend-inner">'+
        '<span class="leg-tag"><i class="fas fa-tag" style="margin-right:3px;color:#2563eb"></i>근무조</span>'+
        legendShifts+fixedLegend+
      '</div>'+
      ((holidays||[]).length ?
        '<div class="legend-inner">'+
          '<span class="leg-tag" style="color:#b91c1c"><i class="fas fa-calendar-times" style="margin-right:3px"></i>공휴일</span>'+
          holListHtml+
        '</div>' : '')+
    '</div>'+
    '<div class="tbl-scroll">'+
      '<table class="sched-tbl"><tbody>'+allGroupRows+'</tbody></table>'+
    '</div>'+
    '<div class="footer-note">'+
      '<i class="fas fa-info-circle" style="color:#94a3b8"></i>'+
      '<span>★ 표시는 공휴일 · 분홍 배경은 일요일/공휴일 · 파랑 배경은 토요일</span>'+
    '</div>'+
    '</div>'
}

function prev(){curM--;if(curM<1){curM=12;curY--}load()}
function next(){curM++;if(curM>12){curM=1;curY++}load()}
load()
</script>
</body>
</html>`
}
