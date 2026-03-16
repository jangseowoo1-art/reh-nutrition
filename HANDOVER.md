# 병원 급식 예산 관리 시스템 HANDOVER.md

## 📌 시스템 개요

**프로젝트명**: 병원 급식 예산 관리 시스템 (Hospital Meal Budget System)  
**기술 스택**: Hono (TypeScript) + Cloudflare Pages + D1 SQLite  
**로컬 서버**: `http://localhost:3000`  
**DB 이름**: `hospital-meal-production` (wrangler.jsonc 바인딩: `DB`)  

---

## 🔐 테스트 계정

| 계정 | 비밀번호 | 역할 |
|------|---------|------|
| admin | admin1234 | 관리자 (전체 병원 관리) |
| amina | hospital1234 | 아미나 병원 (hospital ID: 1) |
| muijae | hospital1234 | 무이재 한방병원 (hospital ID: 2) |
| hosp03~07 | hospital1234 | 병원3~7 |

---

## 🏗️ 프로젝트 구조

```
webapp/
├── src/
│   ├── index.tsx            # 메인 앱 (Hono + HTML 쉘 렌더링)
│   ├── middleware/auth.ts   # JWT 미들웨어
│   ├── utils/auth.ts        # JWT 검증/해시 유틸
│   └── routes/
│       ├── auth.ts          # 로그인/로그아웃
│       ├── dashboard.ts     # 대시보드 (월별 요약, 연간 분석)
│       ├── orders.ts        # 발주 입력 (일별/카테고리별)
│       ├── meals.ts         # 식수 입력 (커스텀 필드 포함)
│       ├── vendors.ts       # 업체 관리
│       ├── settings.ts      # 월 설정, 잔반, 공휴일, 세션
│       ├── schedule.ts      # 직원 스케줄 관리
│       ├── card_expenses.ts # 법인카드 지출 내역
│       └── admin.ts         # 관리자 전용 (병원/업체/계정/이슈 관리)
├── public/static/
│   ├── app.js               # 프론트엔드 SPA (모든 페이지 렌더링)
│   ├── styles.css           # 메인 CSS
│   └── style.css            # 보조 CSS
├── migrations/              # DB 마이그레이션 (0001~0016)
├── ecosystem.config.cjs     # PM2 설정
├── wrangler.jsonc           # Cloudflare Workers 설정
└── vite.config.ts           # 빌드 설정
```

---

## 📡 API 목록

### 인증
| Method | Path | 설명 |
|--------|------|------|
| POST | /api/auth/login | 로그인 (username, password) |

### 대시보드
| Method | Path | 설명 |
|--------|------|------|
| GET | /api/dashboard/summary/:year/:month | 월별 요약 (예산, 식단가, 업체별) |
| GET | /api/dashboard/annual/:year | 연간 월별 비교 |
| GET | /api/dashboard/admin/overview/:year/:month | 관리자용 전체 병원 현황 |

### 발주 (Orders)
| Method | Path | 설명 |
|--------|------|------|
| GET | /api/orders/date/:date | 특정 날짜 발주 조회 |
| GET | /api/orders/budget-status/:year/:month/:date | 일/주/월 예산 현황 |
| POST | /api/orders/save | 단건 발주 저장 |
| POST | /api/orders/save-batch | 일괄 발주 저장 |
| DELETE | /api/orders/:id | 발주 삭제 |
| GET | /api/orders/patient-categories | 환자군 카테고리 목록 |
| GET | /api/orders/category-monthly/:year/:month | 카테고리별 월간 발주 |
| GET | /api/orders/category-daily/:year/:month | 카테고리별 일별 발주 |
| POST | /api/orders/save-category | 카테고리별 발주 저장 |
| GET | /api/orders/category-annual/:year | 카테고리별 연간 발주 |
| GET | /api/orders/:year/:month | 월별 발주 목록 |

### 식수 (Meals)
| Method | Path | 설명 |
|--------|------|------|
| GET | /api/meals/custom-fields | 커스텀 식수 필드 목록 |
| POST | /api/meals/custom-fields | 커스텀 필드 생성 |
| DELETE | /api/meals/custom-fields/:id | 커스텀 필드 삭제 |
| PUT | /api/meals/custom-fields/:id | 커스텀 필드 수정 |
| GET | /api/meals/:year/:month | 월별 식수 조회 |
| GET | /api/meals/date/:date | 특정 날짜 식수 조회 |
| POST | /api/meals/save | 식수 저장 |

### 업체 (Vendors)
| Method | Path | 설명 |
|--------|------|------|
| GET | /api/vendors | 업체 목록 |
| POST | /api/vendors | 업체 추가 |
| PUT | /api/vendors/:id | 업체 수정 |
| DELETE | /api/vendors/:id | 업체 삭제 |

### 설정 (Settings)
| Method | Path | 설명 |
|--------|------|------|
| GET | /api/settings/:year/:month | 월별 설정 조회 |
| POST | /api/settings/save | 월별 설정 저장 |
| GET | /api/settings/hospital | 병원 정보 조회 |
| GET | /api/settings/active-month | 현재 활성 월 조회 |
| POST | /api/settings/closing-request | 마감 요청 |
| GET | /api/settings/holidays/:year/:month | 공휴일 조회 |
| POST | /api/settings/session/heartbeat | 세션 heartbeat |
| POST | /api/settings/session/activity | 세션 액션 기록 |
| GET | /api/settings/food-waste/:year/:month | 잔반 기록 조회 |
| POST | /api/settings/food-waste | 잔반 기록 저장 |

### 법인카드 지출 (Card Expenses)
| Method | Path | 설명 |
|--------|------|------|
| GET | /api/card-expenses/monthly/:year/:month | 월별 법인카드 지출 조회 |
| GET | /api/card-expenses/daily/:vendorId/:date | 일별 지출 조회 |
| POST | /api/card-expenses/save | 지출 저장 (upsert batch) |
| DELETE | /api/card-expenses/:id | 지출 삭제 |
| GET | /api/card-expenses/admin/:hospitalId/:year/:month | 관리자용 조회 |

### 관리자 (Admin) - /api/admin/*
| Method | Path | 설명 |
|--------|------|------|
| GET | /api/admin/hospitals | 병원 목록 (기본정보 포함) |
| GET | /api/admin/hospitals/:id | 병원 상세 |
| PUT | /api/admin/hospitals/:id/info | 병원 기본정보 저장 |
| GET | /api/admin/hospitals/:id/budget/:year/:month | 월 예산 설정 조회 |
| POST | /api/admin/hospitals/:id/budget/:year/:month | 월 예산 설정 저장 |
| POST | /api/admin/closing-approve/:hospitalId | 마감 승인 |
| POST | /api/admin/closing-rollback/:hospitalId | 마감 롤백 |
| GET | /api/admin/notifications | 알림 목록 |
| POST | /api/admin/notifications/read-all | 알림 전체 읽음 |
| GET | /api/admin/online-hospitals | 온라인 병원 목록 |
| GET | /api/admin/dashboard/:year/:month | 관리자 전체 현황 |
| GET | /api/admin/hospitals/:id/vendors | 업체 목록 (관리자용) |
| POST | /api/admin/hospitals/:id/vendors | 업체 추가 (관리자용) |
| PUT | /api/admin/hospitals/:id/vendors/reorder | 업체 순서 변경 |
| PUT | /api/admin/hospitals/:id/vendors/:vid | 업체 수정 (관리자용) |
| DELETE | /api/admin/hospitals/:id/vendors/:vid | 업체 삭제 (관리자용) |
| GET | /api/admin/holidays/:year | 공휴일 목록 |
| POST | /api/admin/holidays | 공휴일 추가 |
| DELETE | /api/admin/holidays/:date | 공휴일 삭제 |
| GET | /api/admin/hospitals/:id/accounts | 계정 목록 |
| POST | /api/admin/hospitals/:id/accounts | 계정 생성 |
| PUT | /api/admin/hospitals/:id/accounts/:uid | 계정 수정 |
| DELETE | /api/admin/hospitals/:id/accounts/:uid | 계정 삭제 |
| GET | /api/admin/daily-issues | 이슈 목록 |
| POST | /api/admin/daily-issues | 이슈 수동 저장 |
| POST | /api/admin/daily-issues/auto-save/:year/:month | 이슈 자동 저장 |
| GET | /api/admin/close-requests/pending | 마감 요청 목록 |
| GET | /api/admin/closing-requests | 마감 요청 전체 목록 |
| GET | /api/admin/closing-requests/recent-approved | 최근 승인 이력 |
| POST | /api/admin/budget-carryover/:hospitalId | 예산 이월 |
| GET | /api/admin/hospitals/:id/patient-categories | 환자군 카테고리 목록 |
| PUT | /api/admin/hospitals/:id/patient-categories | 카테고리 일괄 저장 |
| PUT | /api/admin/hospitals/:id/patient-categories/:catId/formula | 식단가 계산 기준 저장 |
| GET | /api/admin/hospitals/:id/category-settings/:year/:month | 카테고리별 월 목표 조회 |
| POST | /api/admin/hospitals/:id/category-settings/:year/:month | 카테고리별 월 목표 저장 |
| GET | /api/admin/hospitals/:id/category-orders/:year/:month | 카테고리별 발주 현황 |
| GET | /api/admin/hospitals/:id/category-annual/:year | 카테고리별 연간 집계 |

---

## 🗄️ DB 테이블 목록

| 테이블 | 설명 |
|--------|------|
| hospitals | 병원 기본 정보 |
| users | 사용자 계정 (admin/hospital) |
| hospital_info | 병원 상세 정보, 활성 연월, 마감 상태 |
| vendors | 업체 목록 (병원별) |
| monthly_settings | 월별 예산 설정 |
| daily_orders | 일별 발주 내역 |
| daily_meals | 일별 식수 데이터 |
| meal_custom_fields | 커스텀 식수 필드 (환자군 포함) |
| hospital_patient_categories | 환자군 카테고리 (암/요양 등) |
| category_order_settings | 카테고리별 월 목표 설정 |
| employees | 직원 (스케줄용) |
| daily_schedules | 일별 근무 스케줄 |
| food_waste_records | 잔반 기록 |
| holidays | 공휴일 |
| monthly_closings | 월 마감 이력 |
| notifications | 알림 (마감 요청/승인) |
| hospital_sessions | 병원 세션 (온라인 현황) |
| daily_issues | 데일리 이슈 (예산 초과 등) |
| card_expenses | 법인카드 지출 내역 |
| category_budgets | 카테고리별 예산 (하위 호환) |

---

## 🔄 최근 변경사항 (마이그레이션 이력)

| 파일 | 내용 |
|------|------|
| 0001_initial | 기본 테이블 (병원, 사용자, 업체, 발주, 식수, 직원, 스케줄) |
| 0002_seed | 초기 데이터 (아미나, 무이재 병원 + 계정) |
| 0003_hospital_info | 병원 상세정보 테이블, hospital_info, monthly_closings, notifications |
| 0003_online_foodwaste | 온라인 상태, 잔반 기록 테이블 |
| 0004_specialty | 전문과목, 법인카드 관련, holidays, category_budgets |
| 0005_daily_issues_accounts | daily_issues, 계정 영양사이름, password_plain |
| 0006_improvements | hospital_info 확장 (closing_status, current_year/month) |
| 0007_password_plain | password_plain 컬럼 추가 |
| 0008_session_activity | hospital_sessions.last_action 컬럼 |
| 0009_meal_custom_fields | meal_custom_fields 테이블 |
| 0010_custom_field_unit_type | unit_type 컬럼 (meal/ea) |
| 0011_patient_categories | hospital_patient_categories, category_order_settings |
| 0012_category_daily_meal_count | category_order_settings.daily_meal_count |
| 0013_sync_meal_custom_with_categories | meal_custom_fields UNIQUE(hospital_id, field_key) |
| 0014_migrate_custom_data_keys | custom_data 키 마이그레이션 (patient_ → cat_) |
| 0015_category_diet_price_formula | budget_include_keys, meals_include_keys (식단가 계산 수식) |
| **0016_card_expenses** | **법인카드 업체 지원 (vendors.is_card_type), card_expenses 테이블** |

---

## 🚀 서버 시작 방법

```bash
# 1. 빌드
cd /home/user/webapp && npm run build

# 2. PM2 시작
pm2 start ecosystem.config.cjs

# 3. PM2 상태 확인
pm2 list

# 4. 서버 로그 확인
pm2 logs hospital-meal --nostream

# 5. 재시작
pm2 restart hospital-meal

# DB 마이그레이션 (새 마이그레이션 추가 시)
npx wrangler d1 migrations apply hospital-meal-production --local
```

---

## 💡 주요 비즈니스 로직

### 식단가 계산 (3종)
1. **전체 식단가**: 총발주금액 ÷ (직원+보호자+환자군커스텀)
2. **직원식 제외 식단가**: 총발주금액 ÷ (보호자+환자군) 
3. **소모품 제외 식단가**: (총발주 - supply/card) ÷ 전체식수

### 환자군(카테고리별) 식단가 수식 (formula)
- `budget_include_keys`: 발주금액 계산에 포함할 카테고리 키 배열
- `meals_include_keys`: 식수 계산에 포함할 키 (staff, guardian, cat_xxx)
- 수식 미설정 시: 해당 카테고리 발주 ÷ (카테고리식수+직원+보호자)

### 법인카드 지출 흐름
- `card_expenses` 저장 → `daily_orders` 합계 자동 동기화
- 업체의 `is_card_type=1`이어야 법인카드로 인식

### 월 마감 흐름
1. 병원이 마감 요청 (closing_request)
2. 관리자가 승인 (closing_approve)
3. hospital_info.current_month → 다음 달로 자동 전환
4. 예산 이월 자동 실행

### 설정 fallback 규칙
- 해당 월 설정 없으면 → 해당 월 **이전** 중 가장 가까운 설정 사용
- 소급 방지: 3월 설정이 있어도 1월 조회 시 1월 이전 설정만 적용

---

## 📋 현재 구현된 화면

| 경로 | 설명 |
|------|------|
| /login | 로그인 |
| /dashboard | 월별 예산 대시보드 |
| /orders | 발주 입력 (업체별/카테고리별) |
| /meals | 식수 입력 |
| /schedule | 직원 스케줄 |
| /analysis | 연간 분석 |
| /settings | 월 설정, 잔반, 법인카드 |
| /report | 월별 리포트 |
| /hospital-manage | 병원 관리 (관리자) |
| /holiday-manage | 공휴일 관리 (관리자) |
| /admin | 관리자 대시보드 |

---

## ⚠️ 알려진 이슈 / 추가 개발 필요 사항

- [ ] admin.ts 일부 라우트에서 `patientCatsList` 변수 참조 전 선언 순서 문제 가능성 있음 (admin dashboard 내)
- [ ] hospital_info 기본 연/월이 하드코딩(2026, 3)으로 되어 있음 → 동적 처리 필요
- [ ] HANDOVER.md 및 backup_db_dump.sql은 백업에 포함되지 않음 (시드 데이터로 복원)
