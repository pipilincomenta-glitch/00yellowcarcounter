#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# 00yellowcarcounter — Deploy Script for VPS
# Run as root on 207.180.243.187 (Contabo)
# ═══════════════════════════════════════════════════════════════

set -e

echo "🚗 YellowCar Counter — Deploy on VPS"

# 1. Clone / Pull repo
if [ -d "/opt/00yellowcarcounter" ]; then
    echo "📦 Repo exists, pulling..."
    cd /opt/00yellowcarcounter
    git pull origin main
else
    echo "📦 Cloning repo..."
    cd /opt
    git clone https://github.com/pipilincomenta-glitch/00yellowcarcounter.git
    cd /opt/00yellowcarcounter
fi

# 2. Generate secrets
DB_PASSWORD=*** &-hex 16)
JWT_SECRET=*** &-hex 32)

# 3. Create .env for production
echo "🔑 Creating .env..."
cat > .env << EOF
PORT=3001
NODE_ENV=production
DATABASE_URL=postgres://yellowcar_user:***@db:5432/yellowcar_db
JWT_SECRET=*** 4. Stop old containers
echo "🛑 Stopping old containers..."
docker-compose -f docker-compose.production.yml down 2>/dev/null || true

# 5. Build and start
echo "🐳 Building and starting..."
docker-compose -f docker-compose.production.yml up --build -d

# 6. Wait for health check
echo "⏳ Waiting for health check..."
sleep 10
for i in $(seq 1 12); do
    if curl -sf http://localhost:3001/api/health > /dev/null 2>&1; then
        echo "✅ Server is healthy!"
        break
    fi
    echo "   Attempt $i/12..."
    sleep 5
done

# 7. Show status
echo ""
echo "📊 Container Status:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep yellowcar

echo ""
echo "🌐 App running at: http://localhost:3001"
echo "🔐 DB Password: \$DB_PASSWORD"
echo "🔐 JWT Secret: \$JWT_SECRET"
echo ""
echo "✅ Deploy complete!"
echo ""
echo "Next: Configure Cloudflare Tunnel to route yellowcar.pipilacha.ca -> http://yellowcar-app:3001"
