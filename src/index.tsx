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
app.use('/api/*', cors())

// favicon - 빈 204로 브라우저 에러 방지
app.get('/favicon.ico', (c) => new Response(null, { status: 204 }))

// ── 인증 미들웨어 (API) ──────────────────────────────────────────
app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/auth/login') return next()
  
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
<title>급식 예산 관리 - 로그인</title>
<link rel="icon" href="/favicon.ico" type="image/x-icon">
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
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
    <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style="background:linear-gradient(135deg,#1a4731,#16a34a)">
      <i class="fas fa-hospital text-white text-2xl"></i>
    </div>
    <h1 class="text-2xl font-bold text-gray-800">병원 급식 예산 관리</h1>
    <p class="text-gray-500 text-sm mt-1">Hospital Meal Budget System</p>
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
    <p class="font-medium mb-1">🔐 테스트 계정</p>
    <p>관리자: <span class="font-mono bg-white px-1 rounded">admin</span> / <span class="font-mono bg-white px-1 rounded">admin123</span></p>
    <p>병원: <span class="font-mono bg-white px-1 rounded">amina</span> / <span class="font-mono bg-white px-1 rounded">hospital1234</span></p>
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
<title>병원 급식 예산 관리</title>
<link rel="icon" href="/favicon.ico" type="image/x-icon">
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js"></script>
<script src="/static/jspdf.umd.min.js" defer></script>
<link rel="stylesheet" href="/static/styles.css?v=20260330d">
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
        <div class="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
          <i class="fas fa-hospital text-white text-base"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-white font-bold text-sm leading-tight">급식 예산 관리</div>
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

<script src="/static/app.js?v=20260401f"></script>
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
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
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
  <!-- 콘텐츠 영역 -->
  <div id="execContent" class="hidden space-y-6"></div>
</main>

<script src="/static/executive.js?v=20260330d"></script>
</body>
</html>`
}
