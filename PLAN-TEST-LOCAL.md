# 00yellowcarcounter — Fix & Test Local Plan

> **Goal:** Fixer les erreurs du code, tester localement avec Docker, puis deploy sur VPS quand tout est clean.

**Architecture:** Node.js + Express + PostgreSQL, Docker Compose pour le local, Cloudflare Tunnel pour la prod.

**Tech Stack:** Node.js 20, Express 5, PostgreSQL 15, Docker

---

## Phase 1: Fixes Critiques

### Task 1: Supprimer les doublons dans `frontend/app.js`

**Objective:** Supprimer `loadNotifications()` et `closeNotificationsModal()` qui sont définies 2 fois

**Files:**
- Modify: `frontend/app.js:796-827`

**Step 1:** Supprimer le 2ème `loadNotifications()` (lignes 796-823) et le 2ème `closeNotificationsModal()` (lignes 825-827)

**Step 2:** Vérifier qu'il ne reste qu'une seule définition de chaque

**Step 3:** Commit

---

### Task 2: Fixer le path des fichiers statics dans `backend/server.js`

**Objective:** Corriger `express.static('../frontend')` pour que ça marche dans Docker

**Files:**
- Modify: `backend/server.js:33`

**Step 1:** Changer le path pour être relatif au lieu du working directory

```javascript
// Avant
app.use(express.static('../frontend'));

// Après
const path = require('path');
app.use(express.static(path.join(__dirname, '../frontend')));
```

**Step 2:** Commit

---

### Task 3: Ajouter un endpoint de health check

**Objective:** Ajouter `GET /api/health` pour Docker health check

**Files:**
- Modify: `backend/server.js` (ajouter avant les routes)

**Step 1:** Ajouter le endpoint

```javascript
// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
```

**Step 2:** Commit

---

## Phase 2: Setup Local

### Task 4: Créer le fichier `.env` pour le test local

**Variables nécessaires:**
```
PORT=3001
NODE_ENV=development
DATABASE_URL=postgres://yellowcar_user:yellowcar_pass@db:5432/yellowcar_db
JWT_SECRET=local-test-secret-key-123
```

**Step 1:** Créer `.env` à la racine du projet

**Step 2:** Commit (`.env` est dans `.gitignore`)

---

### Task 5: Ajouter un script d'init SQL pour la DB

**Objective:** Automatiser l'initialisation de la base de données

**Files:**
- Create: `database/init.sql`

**Step 1:** Créer `init.sql` qui inclut:
- `schema.sql` (users, spottings, user_stats)
- `migration_friends_notifications.sql` (friends, notifications)

**Step 2:** Modifier `docker-compose.yml` pour monter le script

```yaml
db:
  image: postgres:15-alpine
  volumes:
    - yellowcar-db-data:/var/lib/postgresql/data
    - ./database/init.sql:/docker-entrypoint-initdb.d/01-init.sql
```

**Step 3:** Commit

---

### Task 6: Ajouter health check dans Docker Compose

**Files:**
- Modify: `docker-compose.yml`

**Step 1:** Ajouter le health check

```yaml
app:
  healthcheck:
    test: ["CMD", "wget", "--spider", "-q", "http://localhost:3001/api/health"]
    interval: 30s
    timeout: 5s
    retries: 3
```

**Step 2:** Commit

---

## Phase 3: Test Local

### Task 7: Lancer Docker Compose local

**Commande:**
```bash
cd C:\Users\jerem\Documents\00yellowcarcounter
docker-compose up --build
```

**Expected:**
- Container `yellowcar-app` démarre sur port 3001
- Container `yellowcar-db` démarre sur port 5432
- Logs montrent "🚗 YellowCar server running"
- DB initialisée avec toutes les tables

---

### Task 8: Tester l'API

**Tests à faire:**

1. **Health check:**
```bash
curl http://localhost:3001/api/health
# Expected: {"status":"ok","timestamp":"..."}
```

2. **Register:**
```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","email":"test@test.com","password":"test123"}'
# Expected: {"id":1,"username":"testuser"}
```

3. **Login:**
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test123"}'
# Expected: {"token":"...","username":"testuser"}
```

4. **Spot a car** (avec le token):
```bash
curl -X POST http://localhost:3001/api/spot \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN_HERE" \
  -d '{"latitude":45.5017,"longitude":-73.5673,"car_type":"Yellow Car"}'
# Expected: spotting créé avec location "Montreal, Canada"
```

5. **Dashboard:**
```bash
curl http://localhost:3001/api/dashboard \
  -H "Authorization: Bearer TOKEN_HERE"
# Expected: stats + recent spottings
```

---

### Task 9: Tester le Frontend

**Commande:**
```bash
# Ouvrir dans le navigateur
start http://localhost:3001
```

**Vérifier:**
- [ ] Page de login s'affiche
- [ ] On peut register un nouveau compte
- [ ] On peut login
- [ ] Dashboard affiche les stats
- [ ] Bouton "Spot" fonctionne
- [ ] Pas d'erreurs dans la console

---

## Phase 4: Cleanup

### Task 10: Nettoyer les logs sensibles

**Files:**
- Modify: `backend/server.js:187,198,214`

**Step 1:** Supprimer ou réduire les `console.log` qui affichent l'email

```javascript
// Avant
console.log(`Login attempt for email: ${email}`);

// Après
console.log('Login attempt');
```

**Step 2:** Commit

---

## Phase 5: Deploy VPS

### Task 11: Push sur GitHub

```bash
git add .
git commit -m "fix: cleanup, health check, init SQL, remove duplicates"
git push origin main
```

---

### Task 12: Deploy sur VPS (207.180.243.187)

**Commandes SSH:**
```bash
ssh root@207.180.243.187

# Cloner le repo
cd /opt
git clone https://github.com/pipilincomenta-glitch/00yellowcarcounter.git
cd 00yellowcarcounter

# Créer .env production
cat > .env << EOF
PORT=3001
NODE_ENV=production
DATABASE_URL=postgres://yellowcar_user:PASSWORD_HERE@yellowcar-db:5432/yellowcar_db
JWT_SECRET=SECRET_HERE
EOF

# Lancer
docker-compose -f docker-compose.production.yml up -d

# Vérifier
docker ps
curl http://localhost:3001/api/health
```

---

### Task 13: Configurer Cloudflare Tunnel

**Ajouter le sous-domaine:**
- Domaine: `yellowcar.pipilacha.ca`
- Target: `http://yellowcar-app:3001`

---

## Risques & Open Questions

| Question | Réponse |
|----------|---------|
| PostgreSQL password pour la prod? | À générer avec `openssl rand -hex 16` |
| JWT secret pour la prod? | À générer avec `openssl rand -hex 32` |
| Est-ce que le VPS a assez de RAM? | 12GB dispo, devrait suffire |
| Cloudflare Tunnel déjà configuré? | Oui, pour 00Lyric — juste ajouter un route |

---

## Fichiers qui vont changer

| Fichier | Action |
|---------|--------|
| `frontend/app.js` | Supprimer doublons |
| `backend/server.js` | Fix static path, ajouter health check, nettoyer logs |
| `database/init.sql` | Créer (fusion schema + migration) |
| `docker-compose.yml` | Ajouter health check, monter init.sql |
| `.env` | Créer (local) |
