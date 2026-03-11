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

// ── 관리자 전용 API ───────────────────────────────────────────────
app.use('/api/admin/*', async (c, next) => {
  const user = c.get('user')
  if (!user || user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403)
  return next()
})
app.route('/api/admin', adminRoute)

// ── 페이지 라우트 ─────────────────────────────────────────────────
app.get('/login', (c) => c.html(getLoginPage()))
app.get('/', (c) => c.html(getAppShell()))
app.get('/dashboard', (c) => c.html(getAppShell()))
app.get('/orders', (c) => c.html(getAppShell()))
app.get('/meals', (c) => c.html(getAppShell()))
app.get('/schedule', (c) => c.html(getAppShell()))
app.get('/analysis', (c) => c.html(getAppShell()))
app.get('/settings', (c) => c.html(getAppShell()))
app.get('/admin', (c) => c.html(getAppShell()))
app.get('/report', (c) => c.html(getAppShell()))

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
    <button type="submit" class="btn-login w-full text-white font-semibold py-3 rounded-xl transition-all duration-200 shadow-md mt-2">
      <i class="fas fa-sign-in-alt mr-2"></i>로그인
    </button>
  </form>
  
  <div class="mt-6 p-4 bg-gray-50 rounded-xl text-xs text-gray-500">
    <p class="font-medium mb-1">🔐 테스트 계정</p>
    <p>관리자: <span class="font-mono bg-white px-1 rounded">admin</span> / <span class="font-mono bg-white px-1 rounded">admin1234</span></p>
    <p>병원: <span class="font-mono bg-white px-1 rounded">amina</span> / <span class="font-mono bg-white px-1 rounded">hospital1234</span></p>
  </div>
</div>

<script>
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const username = document.getElementById('username').value
  const password = document.getElementById('password').value
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
    localStorage.setItem('token', data.token)
    localStorage.setItem('role', data.role)
    localStorage.setItem('hospitalName', data.hospitalName || '')
    localStorage.setItem('username', data.username)
    window.location.href = data.role === 'admin' ? '/admin' : '/dashboard'
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
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>병원 급식 예산 관리</title>
<link rel="icon" href="/favicon.ico" type="image/x-icon">
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<link rel="stylesheet" href="/static/styles.css">
</head>
<body class="bg-gray-50">

<!-- 사이드바 + 메인 레이아웃 -->
<div class="flex h-screen overflow-hidden">

  <!-- 사이드바 -->
  <aside id="sidebar" class="sidebar w-64 flex-shrink-0 flex flex-col">
    <!-- 로고 -->
    <div class="p-5 border-b border-white/10">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
          <i class="fas fa-hospital text-white text-lg"></i>
        </div>
        <div>
          <div class="text-white font-bold text-sm leading-tight">급식 예산 관리</div>
          <div id="hospitalNameDisplay" class="text-white/60 text-xs mt-0.5">로딩중...</div>
        </div>
      </div>
    </div>

    <!-- 월 선택 -->
    <div class="px-4 py-3 border-b border-white/10">
      <div class="flex items-center gap-2">
        <button onclick="changeMonth(-1)" class="text-white/70 hover:text-white w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10">
          <i class="fas fa-chevron-left text-xs"></i>
        </button>
        <div class="flex-1 text-center">
          <span id="currentMonthDisplay" class="text-white font-semibold text-sm"></span>
        </div>
        <button onclick="changeMonth(1)" class="text-white/70 hover:text-white w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10">
          <i class="fas fa-chevron-right text-xs"></i>
        </button>
      </div>
    </div>

    <!-- 메뉴 -->
    <nav class="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
      <div id="menuContainer"></div>
    </nav>

    <!-- 로그아웃 -->
    <div class="p-4 border-t border-white/10">
      <div class="flex items-center gap-3 mb-3">
        <div class="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
          <i class="fas fa-user text-white text-xs"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div id="usernameDisplay" class="text-white text-xs font-medium truncate"></div>
          <div id="roleDisplay" class="text-white/50 text-xs"></div>
        </div>
      </div>
      <button onclick="logout()" class="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 text-sm transition">
        <i class="fas fa-sign-out-alt"></i><span>로그아웃</span>
      </button>
    </div>
  </aside>

  <!-- 메인 컨텐츠 -->
  <main class="flex-1 flex flex-col overflow-hidden">
    <!-- 상단 헤더 -->
    <header class="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
      <div>
        <h1 id="pageTitle" class="text-xl font-bold text-gray-800"></h1>
        <p id="pageSubtitle" class="text-sm text-gray-500 mt-0.5"></p>
      </div>
      <div class="flex items-center gap-3">
        <span id="headerMonth" class="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full"></span>
      </div>
    </header>

    <!-- 페이지 컨텐츠 -->
    <div id="pageContent" class="flex-1 overflow-y-auto p-6"></div>
  </main>
</div>

<script src="/static/app.js"></script>
</body>
</html>`
}
