# 🏥 병원 급식 예산 관리 시스템 — 신규 개발자 인수인계 문서

> **작성일**: 2026년 4월 1일  
> **현재 앱 버전**: v=20260401f  
> **작성 목적**: 영양사 메뉴 관리 프로그램(신규) 개발 시 기존 시스템과의 연동을 위한 기술 레퍼런스 제공

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|------|------|
| **프로젝트명** | 병원 급식 예산 관리 시스템 (Hospital Meal Budget System) |
| **배포 플랫폼** | Cloudflare Pages |
| **Wrangler 프로젝트명** | `hospital-meal-budget` |
| **D1 데이터베이스명** | `hospital-meal-production` |
| **D1 Database ID** | `8cd39977b63bb3122ba4bce948af09ffc1cd80e74253123a1208272811ea0b15` |
| **코드 위치** | `/home/user/webapp/` |
| **현재 운영 URL** | Cloudflare Pages 배포 주소 |

---

## 2. 기술 스택

### 백엔드
| 기술 | 버전 | 역할 |
|------|------|------|
| **Hono** | ^4.12.5 | 백엔드 웹 프레임워크 (Cloudflare Workers 특화) |
| **TypeScript** | 5.x | 타입 안전성 |
| **Cloudflare D1** | SQLite | 메인 데이터베이스 |
| **Wrangler** | ^4.4.0 | 빌드 / 배포 CLI |

### 프론트엔드
| 기술 | 출처 | 역할 |
|------|------|------|
| **Tailwind CSS** | CDN (`cdn.tailwindcss.com`) | 유틸리티 CSS 프레임워크 |
| **Font Awesome 6.4.0** | CDN (jsdelivr) | 아이콘 |
| **Chart.js** | CDN (jsdelivr) | 차트 (관리자 대시보드) |
| **Axios 1.6.0** | CDN (jsdelivr) | HTTP 클라이언트 |
| **Vanilla JS (SPA)** | `public/static/app.js` | 모든 UI 로직 (단일 파일 SPA) |

### 인프라
- **Edge Runtime**: Cloudflare Workers (서버리스, Node.js 아님)
- **로컬 개발**: `wrangler pages dev dist --local` + PM2
- **빌드 도구**: Vite (`@hono/vite-cloudflare-pages` 플러그인)

---

## 3. 프로젝트 디렉토리 구조

```
/home/user/webapp/
├── src/
│   ├── index.tsx              # 앱 진입점, 라우트 마운트, 로그인 HTML, 미들웨어
│   ├── middleware/
│   │   └── auth.ts            # JWT_SECRET 상수
│   ├── utils/
│   │   └── auth.ts            # JWT 생성/검증, SHA256 해시 (Web Crypto API 기반)
│   └── routes/
│       ├── auth.ts            # 로그인 API
│       ├── admin.ts           # 관리자 전용 API (병원 관리, 예산 설정 등)
│       ├── dashboard.ts       # 월별 대시보드 API (예산 현황, 인력비 등)
│       ├── orders.ts          # 발주 입력/조회 API
│       ├── meals.ts           # 식수 입력/조회 API
│       ├── vendors.ts         # 업체 관리 API
│       ├── settings.ts        # 설정 API (식단가, 공휴일, 잔반, 식재료 단가)
│       ├── schedule.ts        # 스케줄 관리 API (직원, 연차, 교대, 인건비 분석)
│       ├── card_expenses.ts   # 법인카드 지출 API
│       ├── ceo-dashboard.ts   # CEO/운영진 대시보드 API
│       ├── transaction.ts     # 거래명세서 분석 API (식재료 단가 이력)
│       └── executive.ts       # 운영진 전용 API
├── public/
│   └── static/
│       ├── app.js             # ★ 메인 프론트엔드 SPA (약 28,000줄, 빌드 시 dist에 복사)
│       └── styles.css         # ★ 메인 CSS (커스텀 컴포넌트 스타일)
├── migrations/                # D1 마이그레이션 SQL (0001~0047)
├── dist/                      # 빌드 결과물 (배포 대상)
├── wrangler.jsonc             # Cloudflare 설정
├── vite.config.ts             # Vite 빌드 설정
├── package.json               # 의존성 및 스크립트
├── ecosystem.config.cjs       # PM2 로컬 개발 서버 설정
└── tsconfig.json              # TypeScript 설정
```

---

## 4. 색상 테마 (디자인 시스템)

### 메인 컬러 팔레트 (진녹색 계열)
```css
/* 어두운 순 → 밝은 순 */
#1a4731  /* 가장 어두운 녹색 - 사이드바 상단, 로그인 배경 */
#15502b  /* 사이드바 중간 */
#123d22  /* 사이드바 하단 */
#166534  /* 기본 녹색 - 버튼, 테이블 헤더, 진행바 */
#15803d  /* 중간 녹색 - 버튼 호버, 진행바 */
#16a34a  /* 밝은 녹색 - 기본 버튼(.btn-primary), 탭 활성, 로딩 스피너 */
#22c55e  /* 가장 밝은 녹색 - 성공 버튼(.btn-success) */
```

### 보조 컬러
```css
/* 위험/오류 */
#ef4444, #dc2626  /* 빨강 - 에러, 위험 버튼, 예산 초과 알림 */

/* 경고 */
#f59e0b, #d97706  /* 황색 - 경고 토스트, 다일치 발주 셀 */
#fef9c3           /* 연황색 - 주말 행 배경 */

/* 정보/탭 활성 */
#1e40af           /* 진파랑 - 탭 활성 border/text (.tab-active) */
#2563eb, #0284c7  /* 파랑 - 정보 배지, 현재 주 하이라이트 */

/* 보건증 알림 */
#fee2e2 / #dc2626  /* 빨강 - 만료 */
#fff7ed / #f97316  /* 주황 - 3일 이내 만료 임박 */
#fefce8 / #ca8a04  /* 황색 - 경고 (10일 이내) */
```

### CSS 클래스 네이밍 규칙
```css
/* 컴포넌트 클래스 (styles.css) */
.stat-card        /* 통계 카드 */
.data-table       /* 데이터 테이블 */
.form-input       /* 입력 필드 */
.btn              /* 기본 버튼 */
.btn-primary      /* 메인 버튼 (녹색) */
.btn-danger       /* 삭제/위험 버튼 (빨강) */
.btn-secondary    /* 보조 버튼 (회색) */
.badge            /* 상태 배지 */
.badge-green      /* 녹색 배지 */
.badge-red        /* 빨강 배지 */
.tab-btn          /* 탭 버튼 */
.modal-overlay    /* 모달 오버레이 */
.modal-box        /* 모달 박스 */
.toast            /* 알림 토스트 */
.toast-success    /* 성공 토스트 */
.toast-error      /* 오류 토스트 */
.loading-spinner  /* 로딩 스피너 */
.schedule-cell    /* 스케줄 셀 */
.order-table      /* 발주 테이블 */
.meal-table       /* 식수 테이블 */
```

### 스케줄 셀 색상 코드
```css
.schedule-a     /* A조 - 연녹색 배경 #dcfce7, 진녹 글자 #166534 */
.schedule-b     /* B조 - 연녹색 #f0fdf4 */
.schedule-c     /* C조 - 핑크 배경 #fce7f3, 분홍 글자 */
.schedule-za    /* ZA조 - 연보라 #e0e7ff */
.schedule-zb    /* ZB조 - 연녹색 #f0fdf4 */
.schedule-F     /* F조 - 연빨강 #fee2e2 */
.schedule-rest  /* 휴무 - 연황색 #fef9c3 */
.schedule-annual/* 연차 - 핑크 #fce7f3 */
.schedule-empty /* 비어있음 - 회색 #f1f5f9 */
```

---

## 5. 사용자 권한 구조

### 역할(Role) 종류
| Role | 설명 | 접근 범위 |
|------|------|-----------|
| `admin` | 시스템 관리자 | 모든 기능 + `/api/admin/*` 전용 |
| `hospital` | 영양사 (병원별) | 자기 병원 데이터만 + 스케줄 관리 수정 권한 |
| `executive` | 운영진 (본부) | CEO 대시보드, 전체 병원 조회 전용 |

### 권한 구분 로직
```typescript
// 백엔드 (src/routes/schedule.ts)
function isAdmin(user)        { return user?.role === 'admin' }
function isNutritionist(user) { return user?.role === 'hospital' || user?.role === 'admin' }
function getHospitalId(user, paramHospitalId?) {
  if (isAdmin(user) && paramHospitalId) return parseInt(paramHospitalId)
  return user.hospitalId  // hospital 역할은 자기 병원만
}
```

```javascript
// 프론트엔드 (app.js)
// App.role: 'admin' | 'hospital' | 'executive'
// App.hospitalId: 현재 병원 ID
// App.adminHospitalId: 관리자가 선택한 병원 ID (admin 전용)

if (App.role === 'admin') { /* 관리자 전용 UI */ }
if (App.role === 'hospital') { /* 영양사 전용 UI */ }
if (App.role === 'admin' || App.role === 'hospital') { /* 공통 접근 */ }
```

### 메뉴 구성 (역할별)
```javascript
// admin 메뉴
['dashboard', 'orders', 'meals', 'schedule', 'report', 'ceo-dashboard', 
 'admin', 'hospital-manage', 'staff-manage', 'transaction-analysis', 'expense-doc', 'settings']

// hospital (영양사) 메뉴
['dashboard', 'orders', 'meals', 'schedule', 'report']

// executive 메뉴
['ceo-dashboard']
```

### JWT 페이로드 구조
```typescript
{
  id: number,         // 사용자 ID
  username: string,
  role: 'admin' | 'hospital' | 'executive',
  hospitalId: number, // 병원 ID (hospital 역할)
  iat: number,        // 발급 시각 (Unix timestamp)
  exp: number         // 만료 시각 (24시간)
}
```

---

## 6. 데이터베이스 스키마 (전체 테이블 목록)

### 핵심 테이블 (47개 마이그레이션 누적)

#### 기본 구조
| 테이블 | 설명 |
|--------|------|
| `hospitals` | 병원 정보 (id, name, code, address) |
| `users` | 사용자 계정 (hospital_id, username, password_hash, role) |
| `vendors` | 업체 정보 (hospital_id, name, category, tax_type, monthly_budget) |
| `monthly_settings` | 월별 설정 (total_budget, meal_price, working_days 등) |

#### 발주/식수
| 테이블 | 설명 |
|--------|------|
| `daily_orders` | 일별 발주 (vendor_id, order_date, taxable, exempt, vat, total) |
| `daily_meals` | 일별 식수 (환자/직원/비급여/보호자 × 조식/중식/석식) |
| `order_inspections` | 발주 검수 상태 |
| `inspection_issues` | 검수 이슈 기록 |
| `order_multiday_settings` | 다일치 발주 설정 |
| `meal_custom_fields` | 식수 커스텀 필드 |

#### 환자 식단 관리
| 테이블 | 설명 |
|--------|------|
| `hospital_patient_categories` | 환자군별 설정 (항암, 재활, 일반 등) |
| `category_budgets` | 환자군별 예산 |
| `category_order_settings` | 환자군별 발주 설정 |
| `diet_categories` | 식이 카테고리 (저잔사, 저지방 등) |
| `diet_category_presets` | 식이 카테고리 프리셋 |
| `hospital_meal_price_settings` | 환자군별 식단가 설정 |

#### 스케줄 관리
| 테이블 | 설명 |
|--------|------|
| `employees` | 직원 정보 (name, position, section, phone, annual_leave_total) |
| `employee_positions` | 직책 정의 (조리장, 부조리장 등) |
| `schedule_shifts` | 교대 정의 (코드, 시작시간, 종료시간, 색상) |
| `daily_schedules` | 일별 스케줄 (employee_id, work_date, shift_code) |
| `employee_leaves` | 연차 정보 (total_days, used_days, **carried_over_days**, allowance_paid) |
| `employee_leave_history` | 연차 사용 이력 |
| `substitute_off_days` | 대체 휴일 부여 |
| `holidays` | 공휴일 (병원별) |
| `schedule_min_staff` | 최소 인원 설정 |
| `hospital_work_settings` | 근무 설정 (기본 근무시간 등) |
| `monthly_work_summary` | 월별 근무 집계 |
| `employee_ot_settings` | OT 설정 (기본급, 시급 등) |
| `labor_cost_settings` | 인건비 설정 |
| `dispatch_schedules` | 파출/알바 스케줄 |
| `external_workers` | 외부 근로자 (파트타임, 알바) |
| `external_schedules` | 외부 근로자 스케줄 |

#### 재무/분석
| 테이블 | 설명 |
|--------|------|
| `card_expenses` | 법인카드 지출 |
| `transaction_files` | 거래명세서 파일 |
| `transaction_documents` | 거래명세서 문서 |
| `transaction_items` | 거래명세서 항목 (식재료명, 수량, 단가) |
| `transaction_item_categories` | 거래명세서 항목 카테고리 |
| `transaction_vendor_templates` | 업체별 파싱 템플릿 |
| `ingredient_prices` | 식재료 단가 이력 |
| `hospital_invoice_vendors` | 병원별 명세서 업체 매핑 |
| `invoice_supplier_classifications` | 공급처 분류 |

#### 시스템
| 테이블 | 설명 |
|--------|------|
| `hospital_sessions` | 세션 관리 (접속 이력) |
| `hospital_info` | 병원 상세 정보 |
| `monthly_closings` | 월 마감 이력 |
| `close_month_requests` | 마감 요청 |
| `notifications` | 알림 메시지 |
| `daily_issues` | 일별 이슈 기록 |
| `food_waste_records` | 잔반 기록 |
| `care_type_codes` | 간호 유형 코드 |

---

## 7. API 엔드포인트 전체 목록

> 모든 API에 `Authorization: Bearer <JWT>` 헤더 필요 (로그인 제외)

### 인증 `/api/auth`
| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/auth/login` | 로그인 (username, password → JWT) |

### 대시보드 `/api/dashboard`
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/dashboard/summary/:year/:month` | 월별 대시보드 요약 (예산, 발주, 식수, TOP3 업체 등) |
| GET | `/api/dashboard/annual/:year` | 연간 요약 |
| GET | `/api/dashboard/admin/overview/:year/:month` | 관리자 전체 병원 개요 |
| GET | `/api/dashboard/staff-labor/:year/:month` | **인력 & 인건비 현황** ← 영양사 대시보드 사용 |

### 발주 `/api/orders`
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/orders/:year/:month` | 월별 발주 목록 |
| GET | `/api/orders/date/:date` | 일별 발주 조회 |
| POST | `/api/orders/save` | 발주 저장 |
| POST | `/api/orders/save-batch` | 발주 일괄 저장 |
| DELETE | `/api/orders/:id` | 발주 삭제 |
| GET | `/api/orders/budget-status/:year/:month/:date` | 예산 현황 |
| GET | `/api/orders/category-monthly/:year/:month` | 환자군별 월 발주 |
| POST | `/api/orders/save-category` | 환자군별 발주 저장 |
| GET | `/api/orders/inspection/pending/:year/:month` | 검수 미완료 발주 |
| PUT | `/api/orders/inspection/:orderId` | 검수 완료 처리 |
| PUT | `/api/orders/inspection/batch` | 검수 일괄 처리 |
| POST | `/api/orders/inspection/issue` | 검수 이슈 등록 |
| GET | `/api/orders/inspection/issues/:year/:month` | 검수 이슈 목록 |

### 식수 `/api/meals`
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/meals/:year/:month` | 월별 식수 목록 |
| GET | `/api/meals/date/:date` | 일별 식수 조회 |
| POST | `/api/meals/save` | 식수 저장 |
| GET | `/api/meals/custom-fields` | 커스텀 필드 목록 |
| POST | `/api/meals/custom-fields` | 커스텀 필드 추가 |
| PUT | `/api/meals/custom-fields/:id` | 커스텀 필드 수정 |
| DELETE | `/api/meals/custom-fields/:id` | 커스텀 필드 삭제 |

### 업체 `/api/vendors`
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/vendors` | 업체 목록 |
| POST | `/api/vendors` | 업체 추가 |
| PUT | `/api/vendors/:id` | 업체 수정 |
| DELETE | `/api/vendors/:id` | 업체 삭제 |

### 설정 `/api/settings`
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/settings/:year/:month` | 월별 설정 조회 |
| POST | `/api/settings/save` | 설정 저장 |
| GET | `/api/settings/hospital` | 병원 정보 조회 |
| GET | `/api/settings/holidays/:year/:month` | 공휴일 목록 |
| GET | `/api/settings/ingredient-prices/:year/:month` | 식재료 단가 |
| POST | `/api/settings/ingredient-prices` | 식재료 단가 저장 |
| GET | `/api/settings/food-waste/:year/:month` | 잔반 기록 |
| POST | `/api/settings/food-waste` | 잔반 기록 저장 |

### 스케줄 `/api/schedule` ← ★ 연동 핵심
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/schedule/employees` | 직원 목록 |
| POST | `/api/schedule/employees` | 직원 추가 |
| PUT | `/api/schedule/employees/:id` | 직원 수정 |
| DELETE | `/api/schedule/employees/:id` | 직원 삭제 |
| GET | `/api/schedule/:year/:month` | 월별 스케줄 + leave_map |
| POST | `/api/schedule/save` | 스케줄 저장 |
| POST | `/api/schedule/save-batch` | 스케줄 일괄 저장 |
| GET | `/api/schedule/alerts/leave` | **연차 미사용 알림** ← 영양사 대시보드 사용 |
| GET | `/api/schedule/alerts/health` | **보건증 갱신 임박 알림** ← 영양사 대시보드 사용 |
| GET | `/api/schedule/employees/:id/leaves` | 직원 연차 조회 |
| POST | `/api/schedule/employees/:id/leaves` | 연차 등록/자동부여 |
| PUT | `/api/schedule/employees/:id/leaves` | **연차 수정** (이월연차, 수당지급 포함) |
| GET | `/api/schedule/leaves/all` | 전체 직원 연차 목록 |
| GET | `/api/schedule/labor-cost-report/:year/:month` | 인건비 분석 보고서 |
| GET | `/api/schedule/analysis/:year/:month` | 스케줄 분석 (근무일, OT 등) |
| GET | `/api/schedule/shifts` | 교대 목록 |
| POST | `/api/schedule/shifts` | 교대 추가 |
| PUT | `/api/schedule/shifts/:id` | 교대 수정 |
| GET | `/api/schedule/positions` | 직책 목록 |
| POST | `/api/schedule/positions` | 직책 추가 |
| GET | `/api/schedule/holidays/:year` | 공휴일 목록 |
| POST | `/api/schedule/holidays` | 공휴일 추가 |

### 거래명세서 `/api/transaction` ← ★ 식재료 단가 연동
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/transaction/categories` | 카테고리 목록 |
| GET | `/api/transaction/files` | 업로드 파일 목록 |
| POST | `/api/transaction/upload` | 명세서 파일 업로드 |
| GET | `/api/transaction/analysis/monthly` | 월별 거래 분석 |
| GET | `/api/transaction/price-trend` | **식재료 단가 추이** ← 메뉴 원가 계산 연동 포인트 |
| GET | `/api/transaction/invoice/ingredient-price-history` | **식재료 단가 이력** |
| GET | `/api/transaction/invoice/vendor-ingredient-prices` | 업체별 식재료 단가 |
| GET | `/api/transaction/invoice/top-items` | 상위 식재료 목록 |

### 관리자 전용 `/api/admin` (role=admin만 접근)
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/admin/hospitals` | 전체 병원 목록 |
| GET | `/api/admin/hospitals/:id` | 병원 상세 |
| PUT | `/api/admin/hospitals/:id/info` | 병원 정보 수정 |
| GET | `/api/admin/hospitals/:id/budget/:year/:month` | 병원 예산 설정 |
| POST | `/api/admin/hospitals/:id/budget/:year/:month` | 병원 예산 저장 |
| GET | `/api/admin/dashboard/:year/:month` | 관리자 대시보드 |
| GET | `/api/admin/staff-labor/:year/:month` | 전체 인력 현황 |
| POST | `/api/admin/closing-approve/:hospitalId` | 마감 승인 |
| POST | `/api/admin/closing-rollback/:hospitalId` | 마감 취소 |
| GET | `/api/admin/notifications` | 알림 목록 |
| GET | `/api/admin/hospitals/:id/accounts` | 병원 계정 목록 |
| POST | `/api/admin/hospitals/:id/accounts` | 계정 생성 |
| GET | `/api/admin/hospitals/:id/diet-categories` | 식이 카테고리 |
| POST | `/api/admin/hospitals/:id/sync-invoice-vendors` | 명세서 업체 동기화 |

### CEO 대시보드 `/api/ceo-dashboard`
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/ceo-dashboard/kpi/:year/:month` | KPI 요약 |
| GET | `/api/ceo-dashboard/hospitals/:year/:month` | 병원별 현황 |
| GET | `/api/ceo-dashboard/graphs/:year/:month` | 그래프 데이터 |
| GET | `/api/ceo-dashboard/alerts/:year/:month` | 이상 알림 |

---

## 8. 프론트엔드 SPA 구조 (`public/static/app.js`)

### 전역 상태 객체
```javascript
const App = {
  token: localStorage.getItem('token'),  // JWT
  role: localStorage.getItem('role'),    // 'admin' | 'hospital' | 'executive'
  hospitalId: ...,                       // 현재 병원 ID
  hospitalName: ...,                     // 현재 병원명
  adminHospitalId: ...,                  // 관리자 선택 병원 ID (admin 전용)
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth() + 1,
  currentPage: 'dashboard',             // 현재 활성 페이지
  currentHospital: null,                // 현재 병원 상세 데이터
}
```

### 페이지 렌더 함수 목록
| 함수명 | 페이지 | 역할 |
|--------|--------|------|
| `renderDashboard()` | 월별 대시보드 | 예산, 발주, 식수 요약 + 알림 배너들 |
| `renderOrders()` | 발주 입력 | 업체별 발주 입력 테이블 |
| `renderMeals()` | 식수 입력 | 일별 식수 입력 |
| `renderSchedule()` | 스케줄 관리 | 직원 스케줄 + 연차 관리 탭 |
| `renderReport()` | 보고서 출력 | 인쇄용 보고서 |
| `renderAdminDashboard()` | 관리자 대시보드 | 전체 병원 현황 (admin 전용) |
| `renderHospitalManage()` | 병원 관리 | 병원 설정/계정 (admin 전용) |
| `renderSettings()` | 설정 | 식단가, 공휴일, 업체 관리 |
| `renderCeoDashboard()` | CEO 대시보드 | KPI, 그래프 (executive 전용) |

### 주요 유틸리티 함수
```javascript
api(path, options)   // fetch wrapper (토큰 자동 주입)
fmt(n)               // 숫자 → 천단위 콤마 포맷 (예: 1234567 → "1,234,567")
showToast(msg, type) // 토스트 알림 표시 ('success'|'error'|'warning')
navigate(page)       // 페이지 이동
```

### 영양사 대시보드 알림 배너 현재 순서
```
1. 인력 & 인건비 현황 (renderDashStaffLabor)
2. 연차 미사용 알림 (renderDashLeaveAlertBanner)
3. 검수 미완료 알림
4. 보건증 갱신 임박 알림 (renderHealthAlertBanner)
5. 예산 초과 알림
6. 월별 예산 현황 카드들
```

---

## 9. 로컬 개발 환경 설정

### 필요 조건
- Node.js 18+
- npm

### 의존성 설치
```bash
cd /home/user/webapp
npm install
```

### 로컬 DB 마이그레이션
```bash
npx wrangler d1 migrations apply hospital-meal-production --local
```

### 빌드 + 서버 실행
```bash
npm run build
pm2 start ecosystem.config.cjs
# 또는
npx wrangler pages dev dist --d1=hospital-meal-production --local --ip 0.0.0.0 --port 3000
```

### 빌드 스크립트
```json
"build": "vite build && cp public/static/app.js dist/static/app.js && cp public/static/styles.css dist/static/styles.css"
```
> ⚠️ `app.js`와 `styles.css`는 Vite 번들링 대상이 아니라 수동으로 dist에 복사됩니다.

### 테스트 계정
| 역할 | 아이디 | 비밀번호 | 병원 |
|------|--------|----------|------|
| 관리자 | `admin` | `admin123` | - |
| 영양사 | `amina` | `hospital1234` | 아미나 병원 (ID: 1) |
| 영양사 | `muijae` | `hospital1234` | 무이재 한방병원 (ID: 2) |

---

## 10. Cloudflare 배포

### 배포 명령
```bash
npm run build
npx wrangler pages deploy dist --project-name hospital-meal-budget
```

### 프로덕션 DB 마이그레이션
```bash
npx wrangler d1 migrations apply hospital-meal-production
```

### 환경변수/시크릿 추가
```bash
npx wrangler pages secret put JWT_SECRET --project-name hospital-meal-budget
```

---

## 11. 개발 히스토리 (최근 주요 커밋)

```
1a2f0e4  fix: 영양사 대시보드 알림 순서 재정렬 - 인력&인건비 최상단
cb45d5c  fix: 대시보드 알림 순서 변경 - 보건증 갱신 임박을 예산 초과 알림 앞으로
49f2127  fix: 영양사 대시보드 연차알림 표시 수정 + 인력&인건비 상단 배치
8758ff9  fix: 월간 스케줄 이월연차 합산 수정 + 영양사 대시보드 연차 미사용 알림 추가
b81de09  fix: 이월연차 합산 전면 수정 + 관리자 직원관리 연차수정 추가
fde3036  feat: 연차관리 이월연차·수당지급 기능 추가
098fc3b  feat: 월별 대시보드에 보건증 갱신 임박 알림 카드 추가
6d392b2  feat: 연차관리 영양사(hospital) 계정 수정 권한 부여
e1f7e90  refactor: 스케줄 탭 버튼 기능별 그룹핑
7a1f84c  feat: 스케줄 관리 탭 순서 변경 및 기본 화면을 월간 스케줄로 설정
```

---

## 12. 메뉴 프로그램 연동 가이드

새로 개발될 **영양사 메뉴 관리 프로그램**과 이 시스템을 연동하기 위한 핵심 포인트입니다.

### 연동 포인트 1: 로그인 토큰 공유 (SSO)

**기존 시스템 로그인 API:**
```http
POST /api/auth/login
Content-Type: application/json

{ "username": "amina", "password": "hospital1234" }
```

**응답:**
```json
{
  "token": "eyJ...",
  "role": "hospital",
  "hospitalId": 1,
  "hospitalName": "아미나 병원",
  "username": "amina"
}
```

**메뉴 프로그램에서 활용:**
- 동일한 `users` 테이블 사용 → 같은 DB에 메뉴 데이터 추가 테이블 생성
- JWT 검증 로직 (`src/utils/auth.ts`의 `verifyToken`) 재사용
- `JWT_SECRET`은 동일 값 사용 (Cloudflare 시크릿으로 관리)

### 연동 포인트 2: 식재료 단가 (거래명세서 → 메뉴 원가 계산)

**이미 구축된 API:**
```http
GET /api/transaction/price-trend?year=2026&month=3
Authorization: Bearer <JWT>
```
→ 품목별 최근 3개월 평균 단가 반환

```http
GET /api/transaction/invoice/ingredient-price-history?item=닭가슴살
Authorization: Bearer <JWT>
```
→ 특정 식재료의 가격 이력 반환

**메뉴 프로그램에서 활용:**
- 메뉴 원가 계산 시 위 API 호출하여 현재 단가 자동 반영
- 예산 내 메뉴 추천 로직에 적용

### 연동 포인트 3: 식수 정보 (메뉴 → 발주 연동)

**이미 구축된 API:**
```http
GET /api/meals/:year/:month
Authorization: Bearer <JWT>
```
→ 일별 환자수(식수) 반환

**메뉴 프로그램에서 활용:**
- 주간 메뉴 확정 시 인분 수 기반 재료 소요량 계산
- `POST /api/orders/save`로 자동 발주 데이터 생성 가능

### 새 프로그램을 같은 DB에 추가할 경우 권장 테이블명

```sql
-- 메뉴 카테고리 (대/중/소분류)
CREATE TABLE menu_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER,
  level INTEGER, -- 1:대분류, 2:중분류, 3:소분류
  name TEXT NOT NULL,
  code TEXT,
  sort_order INTEGER DEFAULT 0
);

-- 메뉴 마스터 (레시피)
CREATE TABLE menus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,       -- 또는 NULL(공통)
  category_id INTEGER,
  name TEXT NOT NULL,
  description TEXT,
  servings INTEGER DEFAULT 1,         -- 기준 인분
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
);

-- 주간 메뉴 계획
CREATE TABLE weekly_menus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  week_start TEXT NOT NULL,           -- YYYY-MM-DD (월요일)
  meal_date TEXT NOT NULL,            -- YYYY-MM-DD
  meal_type TEXT NOT NULL,            -- 'breakfast'|'lunch'|'dinner'
  menu_id INTEGER,
  servings INTEGER,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (menu_id) REFERENCES menus(id)
);
```

---

## 13. 주의사항 및 알려진 제약

### 백엔드 제약 (Cloudflare Workers 환경)
- **Node.js API 사용 불가**: `fs`, `path`, `child_process` 등 사용 불가
- **Web Crypto API 사용**: SHA256 해시는 `crypto.subtle.digest()` 사용
- **요청당 CPU 10ms 제한** (Free plan): 무거운 연산 최소화 필요
- **번들 크기 10MB 제한**: 대형 라이브러리 사용 금지

### 프론트엔드 특이사항
- `app.js`는 단일 파일 SPA (약 28,000줄) — Vite 번들링 없이 직접 작성
- 빌드 시 `cp public/static/app.js dist/static/app.js` 로 복사됨
- 브라우저 캐시 방지를 위해 `?v=YYYYMMDD[a-f]` 버전 쿼리 사용
  - 버전 위치: `src/index.tsx` 348번째 줄 근처
  - 변경 후 반드시 빌드 재실행

### 연차 계산 로직 (중요)
```javascript
// 올바른 계산법 (2026년 4월 수정됨)
const carriedOver = lv?.allowance_paid ? 0 : (lv?.carried_over_days ?? 0)
const effectiveTotal = total + carriedOver  // 이월연차 포함 합계
const remain = effectiveTotal - used         // 실제 잔여 연차
```

---

## 14. 파일 수정 가이드

### 자주 수정하는 파일

| 파일 | 수정 후 해야 할 일 |
|------|-----------------|
| `src/**/*.ts` | `npm run build` 실행 |
| `public/static/app.js` | `npm run build` 실행 (cp 포함) |
| `public/static/styles.css` | `npm run build` 실행 (cp 포함) |
| `migrations/*.sql` | `npx wrangler d1 migrations apply --local` |
| `wrangler.jsonc` | 빌드 재실행 필요 없음 (런타임 설정) |

### 버전 태그 업데이트 방법
```typescript
// src/index.tsx 약 348번째 줄
<script src="/static/app.js?v=20260401f"></script>
//                              ↑ 날짜+알파벳 순으로 증가
```

---

*이 문서는 신규 메뉴 관리 프로그램 개발 시 활용하기 위한 기술 인수인계 목적으로 작성되었습니다.*
*질문이 있으면 기존 채팅방(급식 예산 관리)에서 확인하거나 코드를 직접 참고하세요.*
