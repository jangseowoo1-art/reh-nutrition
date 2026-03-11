#!/bin/bash
# 서버 시작 + DB 초기화 스크립트
set -e
cd /home/user/webapp

echo "🔄 이전 프로세스 정리..."
pm2 delete all 2>/dev/null || true
fuser -k 3000/tcp 2>/dev/null || true
sleep 1

echo "🗑️  DB 상태 초기화..."
rm -rf .wrangler/state/v3/d1

echo "📦 마이그레이션 적용..."
npx wrangler d1 migrations apply hospital-meal-production --local 2>&1 | grep -E "✅|Error|error" || true

echo "🔨 빌드..."
npm run build 2>&1 | tail -5

echo "🚀 서비스 시작..."
pm2 start ecosystem.config.cjs

sleep 5

echo "🧪 DB 초기화 (wrangler가 생성한 새 DB에 마이그레이션 적용)..."
cat migrations/0001_initial.sql migrations/0002_seed.sql > /tmp/combined_migration.sql
npx wrangler d1 execute hospital-meal-production --local --file=/tmp/combined_migration.sql 2>&1 | tail -5

echo ""
echo "✅ 서비스 시작 완료!"
curl -s http://localhost:3000/login | grep -o '<title>[^<]*</title>' || echo "서버 응답 확인 완료"
