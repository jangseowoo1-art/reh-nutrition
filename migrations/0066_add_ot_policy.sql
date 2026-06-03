-- ════════════════════════════════════════════════════════════════
-- OT 자동생성 정책 (근무조 정책 중심 / 단일 ON-OFF 컬럼)
-- ════════════════════════════════════════════════════════════════
-- 배경:
--   "8시간 초과 = 무조건 OT" 구조가 병원 운영 현실과 불일치.
--   A6/A7.5/F 등은 11~12h 근무라도 '정규 근무조'(OT 아님).
-- 설계:
--   ot_auto_enabled = 1(기본) → 8h 초과분 자동 OT 계산 (현행 동일, 회귀 0)
--   ot_auto_enabled = 0        → 자동 OT 미생성 (정규 근무조). 수동 OT는 그대로 우선.
--   ※ 야간/휴일 시간 계산은 정책과 무관하게 항상 유지됨.
--   ※ ot_threshold_hours 는 도입하지 않음(근무조 단위 ON/OFF 로 충분, YAGNI).
-- ════════════════════════════════════════════════════════════════

ALTER TABLE schedule_shifts ADD COLUMN ot_auto_enabled INTEGER DEFAULT 1;

-- (가) 방식: 실근무 8h 초과 7개 근무조를 '초기값만' OFF 로 세팅.
--   하드코딩이 아니라 초기 시드 성격 — 운영자는 이후 화면에서 언제든 ON/OFF 변경 가능.
--   아미나 F(1) / 무이재 A6·A7.5(2) / 무이재 의원 A·B(4)
--   / 리엔에이치 한방 F(5) / 리엔에이치 요양 F(10)
UPDATE schedule_shifts SET ot_auto_enabled = 0
 WHERE is_active = 1
   AND ( (hospital_id = 1  AND shift_code = 'F')
      OR (hospital_id = 2  AND shift_code IN ('A6', 'A7.5'))
      OR (hospital_id = 4  AND shift_code IN ('A', 'B'))
      OR (hospital_id = 5  AND shift_code = 'F')
      OR (hospital_id = 10 AND shift_code = 'F') );
