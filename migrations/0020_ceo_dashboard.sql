-- ════════════════════════════════════════════════════════════════
-- CEO 대시보드 지원 마이그레이션
-- 1) hospital_info 에 care_type 추가 (항암/요양/재활 운영유형)
-- 2) users 에 sub_role 추가 (추후 경영진 권한 세분화용)
-- ════════════════════════════════════════════════════════════════

-- care_type: 확장형 구조 (기본 6개 + 추후 추가 가능)
-- 허용 값: oncology | nursing_care | rehab |
--          oncology_nursing | oncology_rehab | nursing_rehab | general
ALTER TABLE hospital_info ADD COLUMN care_type TEXT DEFAULT 'general';

-- sub_role: 추후 경영진 권한 세분화용 (현재는 admin 전체 접근)
-- 허용 값: NULL(일반 admin) | representative | executive | ops_manager
ALTER TABLE users ADD COLUMN sub_role TEXT DEFAULT NULL;

-- care_type 코드 참조 테이블 (확장형 지원: 런타임에 추가 가능)
CREATE TABLE IF NOT EXISTS care_type_codes (
  code        TEXT PRIMARY KEY,           -- 내부 코드 (oncology 등)
  label_ko    TEXT NOT NULL,              -- 한글 표시명
  sort_order  INTEGER DEFAULT 99,
  is_active   INTEGER DEFAULT 1,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 기본 6개 + general 시드
INSERT OR IGNORE INTO care_type_codes (code, label_ko, sort_order) VALUES
  ('oncology',         '항암',        1),
  ('nursing_care',     '요양',        2),
  ('rehab',            '재활',        3),
  ('oncology_nursing', '항암+요양',   4),
  ('oncology_rehab',   '항암+재활',   5),
  ('nursing_rehab',    '요양+재활',   6),
  ('general',          '일반',        99);
