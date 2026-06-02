# Baseline 스냅샷 (수정 전) — 2026-05 / 프로덕션

> 수집: P2 식수 일원화 작업 전 기준값. 회귀 테스트의 비교 대상.
> 환경: https://reh-nutrition.pages.dev (프로덕션 D1), main HEAD = 3ab1d7c

## 아미나병원 (hospital_id=1) / 2026-05
| 항목 | 영양사(dashboard) | 운영진(executive) | 일치 |
|---|---|---|---|
| totalUsed | 55,803,781 | 100,335,471(budget.totalUsed)※주의 | - |
| totalMeals | 6,633 | 6,633 | ✅ |
| customFieldTotals 합 | 6,633 | 6,633 | ✅ |
| daysEntered | 31 | 31 | ✅ |
| 대표 식단가(mealPriceTotal/currentMealPrice) | 8,413 | 8,413 | ✅ |
| 운영 식단가(mealPriceOperating) | 9,177 | 9,339 | ❌ (162 차이) |

## 무이재한방병원 (hospital_id=2) / 2026-05
| 항목 | 영양사(dashboard) | 운영진(executive) | 일치 |
|---|---|---|---|
| totalUsed | 100,335,471 | - | - |
| totalMeals | 13,238 | 13,238 | ✅ |
| customFieldTotals 합 | 13,444 | 13,444 | ✅ |
| daysEntered | 31 | 31 | ✅ |
| 대표 식단가 | 7,579 | 7,579 | ✅ |
| 운영 식단가(mealPriceOperating) | 7,957 | 7,986 | ❌ (29 차이) |

## 발견된 불일치
1. **운영 식단가(mealPriceOperating)**: 두 병원 모두 영양사 ≠ 운영진
   - 아미나: 9,177 vs 9,339
   - 무이재: 7,957 vs 7,986
   - 원인 추정(P3): 소모품/카드 분모(식수) 또는 소모품 포함액 산출 경로 차이
2. **totalMeals(13,238) ≠ customFieldTotals 합(13,444)** [무이재]
   - 차이 206 = meals_include_keys에 포함 안 된 custom 필드(예: nc_rice_extra 등)
   - 영양사/운영진 모두 동일하게 13,238 → 식수 자체는 이미 일치(P2 totalMeals는 OK)
3. **totalMeals는 영양사=운영진 일치** → P4 수정 효과로 식수 총량은 이미 동일

## 원본 JSON
- docs/dash_1.json, docs/exec_1.json (아미나)
- docs/dash_2.json, docs/exec_2.json (무이재)
