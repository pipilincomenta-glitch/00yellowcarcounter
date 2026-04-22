const API_URL = '/api';
let token = localStorage.getItem('yc_token');
let username = localStorage.getItem('yc_username') || '';
let currentTab = 'dashboard';
let currentStatsPeriod = 'week';
let currentLbScope = 'global';
let historyPage = 1;

// ─── Security Helpers ──────────────────────────────────────────
const esc = (text) => {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
};

// ─── SCREEN / TAB MANAGEMENT
const showScreen = (screenId) => {
    const authBg = document.getElementById('auth-bg');
    const mainScreen = document.getElementById('main-screen');
    if (screenId === 'main-screen') {
        authBg.classList.add('hidden');
        mainScreen.classList.remove('hidden');
    } else {
        authBg.classList.remove('hidden');
        mainScreen.classList.add('hidden');
        document.querySelectorAll('.auth-screen').forEach(s => s.classList.add('hidden'));
        document.getElementById(screenId).classList.remove('hidden');
    }
};

const switchTab = (tab) => {
    currentTab = tab;
    document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
    document.getElementById(`tab-${tab}`).classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    if (tab === 'dashboard') updateDashboard();
    if (tab === 'stats')     loadStats(currentStatsPeriod);
    if (tab === 'social')    loadLeaderboard(currentLbScope);
    if (tab === 'historial') { historyPage = 1; loadHistory(1); }
    if (tab === 'perfil')    loadProfile();
    if (tab === 'friends')   loadFriendsData();
    if (tab === 'notifications') loadNotifications(1);
};

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

const showMsg = (id, message, type = 'error') => {
    const el = document.getElementById(id);
    el.textContent = (type === 'error' ? '⚠️ ' : '') + message;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 4000);
};

// ── Init ───────────────────────────────────────────────────────
if (token) {
    showScreen('main-screen');
    document.getElementById('welcome-msg').textContent = `Hola, ${username} 👋`;
    updateDashboard();
    startNotificationPolling();
}

// ═══════════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════════
document.getElementById('go-to-register').addEventListener('click', e => { e.preventDefault(); showScreen('register-screen'); });
document.getElementById('go-to-login').addEventListener('click',    e => { e.preventDefault(); showScreen('login-screen'); });

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
        const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: document.getElementById('email').value, password: document.getElementById('password').value })
        });
        const data = await res.json();
        if (data.token) {
            localStorage.setItem('yc_token', data.token);
            localStorage.setItem('yc_username', data.username);
            token = data.token; username = data.username;
            document.getElementById('welcome-msg').textContent = `Hola, ${username} 👋`;
            showScreen('main-screen');
            updateDashboard();
        } else {
            showMsg('login-error', data.error || 'Error al entrar');
        }
    } catch { showMsg('login-error', 'Error de conexión'); }
    finally { btn.disabled = false; }
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
        const res = await fetch(`${API_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: document.getElementById('reg-username').value,
                email: document.getElementById('reg-email').value,
                password: document.getElementById('reg-password').value
            })
        });
        const data = await res.json();
        if (res.status === 201) {
            const lr = await fetch(`${API_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: document.getElementById('reg-email').value, password: document.getElementById('reg-password').value })
            });
            const ld = await lr.json();
            if (ld.token) {
                localStorage.setItem('yc_token', ld.token);
                localStorage.setItem('yc_username', ld.username);
                token = ld.token; username = ld.username;
                document.getElementById('welcome-msg').textContent = `Hola, ${username} 👋`;
                showScreen('main-screen');
                updateDashboard();
            }
        } else {
            showMsg('register-error', data.error || 'Error al registrar');
        }
    } catch { showMsg('register-error', 'Error de conexión'); }
    finally { btn.disabled = false; }
});

document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('yc_token');
    localStorage.removeItem('yc_username');
    token = null; username = '';
    showScreen('login-screen');
});

// ═══════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════
async function updateDashboard() {
    if (!token) return;
    try {
        const res = await fetch(`${API_URL}/dashboard`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.status === 401 || res.status === 403) { expireSession(); return; }
        const data = await res.json();
        document.getElementById('today-count').textContent = data.stats.today_count ?? 0;
        document.getElementById('total-career').textContent = data.stats.total_count ?? 0;
        document.getElementById('current-streak').textContent = `${data.stats.current_streak ?? 0} Días`;
        const container = document.getElementById('spottings-container');
        if (!data.recent || data.recent.length === 0) {
            container.innerHTML = '<p class="empty-state">¡Aún no has visto ningún auto amarillo! 👀</p>';
            return;
        }
        container.innerHTML = data.recent.map(s => renderSpotItem(s)).join('');
    } catch (err) { console.error(err); }
}

document.getElementById('spot-btn').addEventListener('click', () => {
    if (window.navigator.vibrate) window.navigator.vibrate([50, 30, 50]);
    document.getElementById('spot-btn').disabled = true;
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async pos => await sendSpot({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, car_type: 'Yellow Car' }),
            async ()  => await sendSpot({ car_type: 'Yellow Car' }),
            { timeout: 5000 }
        );
    } else {
        sendSpot({ car_type: 'Yellow Car' });
    }
});

async function sendSpot(spotData) {
    const btn = document.getElementById('spot-btn');
    try {
        const res = await fetch(`${API_URL}/spot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(spotData)
        });
        if (res.ok) {
            btn.classList.add('spot-success');
            setTimeout(() => btn.classList.remove('spot-success'), 800);
            updateDashboard();
        }
    } catch (err) { console.error(err); }
    finally { btn.disabled = false; }
}

// ═══════════════════════════════════════════════════════════════
//  STATS SCREEN
// ═══════════════════════════════════════════════════════════════
document.querySelectorAll('.period-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        document.querySelectorAll('.period-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        currentStatsPeriod = pill.dataset.period;
        loadStats(currentStatsPeriod);
    });
});

async function loadStats(period = 'week') {
    if (!token) return;
    try {
        const res = await fetch(`${API_URL}/stats?period=${period}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.status === 401 || res.status === 403) { expireSession(); return; }
        const data = await res.json();

        const periodLabels = { week: 'Esta Semana', month: 'Último Mes', alltime: 'Toda la Vida' };
        document.getElementById('chart-period-label').textContent = periodLabels[period] || 'Esta Semana';
        document.getElementById('stats-week-total').textContent = `${data.periodTotal} autos`;

        const barsEl   = document.getElementById('week-bars');
        const labelsEl = document.getElementById('week-labels');
        const dataMap  = {};
        data.chart.forEach(d => { dataMap[String(d.label).slice(0, 10)] = d.count; });

        let slots = [];
        if (period === 'week') {
            slots = getLast7Days().map(d => ({
                key: d.date, label: d.label,
                isToday: d.date === new Date().toISOString().slice(0, 10)
            }));
        } else if (period === 'month') {
            const today = new Date();
            for (let i = 29; i >= 0; i--) {
                const d = new Date(); d.setDate(today.getDate() - i);
                const key = d.toISOString().slice(0, 10);
                slots.push({ key, label: i === 0 ? 'Hoy' : (i % 5 === 0 ? `${d.getDate()}` : ''), isToday: i === 0 });
            }
        } else {
            data.chart.forEach(d => {
                const [year, month] = String(d.label).split('-');
                const mNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
                slots.push({ key: String(d.label), label: `${mNames[parseInt(month)-1]} ${year.slice(2)}`, isToday: false });
            });
        }

        const maxCount = Math.max(...slots.map(s => dataMap[s.key] || 0), 1);
        barsEl.innerHTML = slots.map(s => {
            const count = dataMap[s.key] || 0;
            const pct = Math.round((count / maxCount) * 100);
            return `<div class="bar-wrap">
                <div class="bar-count">${count > 0 ? count : ''}</div>
                <div class="bar ${s.isToday ? 'bar-today' : ''}" style="height:${Math.max(pct, 3)}%"></div>
            </div>`;
        }).join('');
        labelsEl.innerHTML = slots.map(s => `<span>${esc(s.label)}</span>`).join('');

        document.getElementById('stats-best-day').textContent    = data.bestDay ? `${data.bestDay.count} autos` : '—';
        document.getElementById('stats-best-streak').textContent = `${data.stats.best_streak ?? 0} días`;
        document.getElementById('stats-total').textContent       = data.stats.total_count ?? 0;
        document.getElementById('stats-streak').textContent      = `${data.stats.current_streak ?? 0} días`;
    } catch (err) { console.error(err); }
}

function getLast7Days() {
    const dayNames = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (6 - i));
        return { date: d.toISOString().slice(0, 10), label: i === 6 ? 'Hoy' : dayNames[d.getDay()] };
    });
}

// ═══════════════════════════════════════════════════════════════
//  SOCIAL — LEADERBOARD
// ═══════════════════════════════════════════════════════════════
document.querySelectorAll('.lb-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        document.querySelectorAll('.lb-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        currentLbScope = pill.dataset.scope;
        loadLeaderboard(currentLbScope);
    });
});

const SCOPE_LABELS = {
    global:    { title: 'Los mejores cazadores del mundo',  name: 'mundo' },
    continent: { title: 'Los mejores de tu continente',     name: 'continente' },
    country:   { title: 'Los mejores de tu país',           name: 'país' },
    city:      { title: 'Los mejores de tu ciudad',         name: 'ciudad' }
};

async function loadLeaderboard(scope = 'global') {
    if (!token) return;
    try {
        const res = await fetch(`${API_URL}/leaderboard?scope=${scope}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.status === 401 || res.status === 403) { expireSession(); return; }
        const data = await res.json();

        const info = SCOPE_LABELS[scope] || SCOPE_LABELS.global;
        document.getElementById('lb-scope-label').textContent = info.title;

        const noLocEl = document.getElementById('lb-no-location');
        const { country, city, continent } = data.userLocation || {};

        // Show "no location" prompt for scoped views when user has no location set
        const needsLocation = (scope === 'country' && !country) ||
                              (scope === 'city' && !city) ||
                              (scope === 'continent' && !continent);

        if (needsLocation) {
            noLocEl.classList.remove('hidden');
            document.getElementById('lb-scope-name').textContent = info.name;
            document.getElementById('lb-podium').innerHTML = '';
            document.getElementById('lb-list').innerHTML = '';
            document.getElementById('lb-my-rank').classList.add('hidden');
            return;
        }
        noLocEl.classList.add('hidden');

        // My rank banner
        const myRankEl = document.getElementById('lb-my-rank');
        if (data.myRank > 0) {
            myRankEl.classList.remove('hidden');
            document.getElementById('lb-rank-num').textContent = `#${data.myRank}`;
        } else {
            myRankEl.classList.add('hidden');
        }

        const top3 = data.leaders.slice(0, 3);
        const rest = data.leaders.slice(3);
        const medals = ['🥇', '🥈', '🥉'];

        // ── Podium ────────────────────────────────────────────────
        const podiumEl = document.getElementById('lb-podium');
        if (top3.length === 0) {
            podiumEl.innerHTML = '<p class="empty-state">¡Sé el primero en aparecer aquí! 👀</p>';
        } else if (top3.length < 3) {
            podiumEl.innerHTML = top3.map((u, i) => renderPodiumCard(u, i + 1, medals[i])).join('');
        } else {
            podiumEl.innerHTML = `
                <div class="podium-grid">
                    ${renderPodiumCard(top3[1], 2, medals[1], 'silver')}
                    ${renderPodiumCard(top3[0], 1, medals[0], 'gold')}
                    ${renderPodiumCard(top3[2], 3, medals[2], 'bronze')}
                </div>`;
        }

        // ── Rest of list ──────────────────────────────────────────
        const listEl = document.getElementById('lb-list');
        listEl.innerHTML = rest.length === 0 ? '' :
            rest.map(u => `
                <div class="lb-row ${u.isMe ? 'lb-row-me' : ''}" onclick="openPublicProfile('${esc(u.username)}')">
                    <div class="lb-rank-badge">#${u.rank}</div>
                    <div class="lb-user-info">
                        <div class="lb-username">${u.isMe ? '👤 ' : ''}${esc(u.username)}${u.isMe ? ' (tú)' : ''}</div>
                        <div class="lb-location">${[u.city, u.country].filter(Boolean).map(esc).join(', ') || '🌎 Sin ubicación'}</div>
                    </div>
                    <div class="lb-score">
                        <div class="lb-score-num">${u.total_count}</div>
                        <div class="lb-score-label">autos</div>
                    </div>
                </div>
            `).join('');
    } catch (err) { console.error(err); }
}

function renderPodiumCard(user, rank, medal, tier = '') {
    const isGold = tier === 'gold';
    return `<div class="podium-card ${isGold ? 'podium-gold' : ''} ${user.isMe ? 'podium-me' : ''}" onclick="openPublicProfile('${esc(user.username)}')">
        <div class="podium-medal">${medal}</div>
        <div class="podium-avatar">${esc(user.username.charAt(0).toUpperCase())}</div>
        <div class="podium-username">${esc(user.username)}${user.isMe ? ' 👤' : ''}</div>
        <div class="podium-location">${esc(user.country) || '—'}</div>
        <div class="podium-score">${user.total_count} <span>🚗</span></div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
//  HISTORIAL SCREEN
// ═══════════════════════════════════════════════════════════════
async function loadHistory(page = 1) {
    if (!token) return;
    historyPage = page;
    try {
        const res = await fetch(`${API_URL}/history?page=${page}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.status === 401 || res.status === 403) { expireSession(); return; }
        const data = await res.json();
        document.getElementById('history-total-label').textContent = `${data.total} avistamiento${data.total !== 1 ? 's' : ''} en total`;
        const container = document.getElementById('history-container');
        if (!data.items || data.items.length === 0) {
            container.innerHTML = '<p class="empty-state">Sin avistamientos aún. ¡Sal a buscar! 🚗</p>';
            document.getElementById('history-pagination').innerHTML = '';
            return;
        }
        const groups = {};
        data.items.forEach(spot => {
            const key = new Date(spot.spotted_at).toDateString();
            if (!groups[key]) groups[key] = [];
            groups[key].push(spot);
        });
        container.innerHTML = Object.entries(groups).map(([dateKey, spots]) =>
            `<div class="history-group">
                <div class="history-date-label">${formatDateGroup(dateKey)}</div>
                ${spots.map(s => renderSpotItem(s)).join('')}
            </div>`
        ).join('');
        const pag = document.getElementById('history-pagination');
        if (data.pages <= 1) { pag.innerHTML = ''; return; }
        pag.innerHTML = `
            <button class="pag-btn" onclick="loadHistory(${page-1})" ${page<=1?'disabled':''}>← Anterior</button>
            <span class="pag-info">Página ${page} de ${data.pages}</span>
            <button class="pag-btn" onclick="loadHistory(${page+1})" ${page>=data.pages?'disabled':''}>Siguiente →</button>`;
    } catch (err) { console.error(err); }
}

// ═══════════════════════════════════════════════════════════════
//  PERFIL SCREEN
// ═══════════════════════════════════════════════════════════════
async function loadProfile() {
    if (!token) return;
    try {
        const res = await fetch(`${API_URL}/profile`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.status === 401 || res.status === 403) { expireSession(); return; }
        const data = await res.json();
        const { user, stats, achievements } = data;
        document.getElementById('profile-avatar').textContent      = user.username.charAt(0).toUpperCase();
        document.getElementById('profile-name').textContent        = user.username;
        document.getElementById('profile-email').textContent       = user.email;
        document.getElementById('profile-since').textContent       = `Miembro desde ${new Date(user.created_at).toLocaleDateString('es', { year:'numeric', month:'long' })}`;
        document.getElementById('profile-total').textContent       = stats.total_count ?? 0;
        document.getElementById('profile-best-streak').textContent = `${stats.best_streak ?? 0} días`;

        // Pre-fill location & social
        if (user.city || user.country) {
            document.getElementById('loc-current-info').classList.remove('hidden');
            document.getElementById('loc-summary-text').textContent = [user.city, user.country].filter(Boolean).join(', ');
        }
        if (user.instagram_handle) document.getElementById('loc-instagram').value = user.instagram_handle;

        const ac = document.getElementById('achievements-container');
        ac.innerHTML = achievements.length === 0
            ? '<p class="empty-state">¡Consigue tu primer auto amarillo para desbloquear logros!</p>'
            : achievements.map(a => `
                <div class="achievement-card">
                    <div class="achievement-icon">${a.icon}</div>
                    <div class="achievement-info">
                        <div class="achievement-title">${esc(a.title)}</div>
                        <div class="achievement-desc">${esc(a.desc)}</div>
                    </div>
                </div>`).join('');
    } catch (err) { console.error(err); }
}

// Public Profile Modal
async function openPublicProfile(targetUsername) {
    try {
        const res = await fetch(`${API_URL}/profile/${targetUsername}`);
        if (!res.ok) return;
        const data = await res.json();
        
        document.getElementById('pp-username').textContent = data.username;
        document.getElementById('pp-avatar').textContent   = data.username.charAt(0).toUpperCase();
        document.getElementById('pp-location').textContent = [data.city, data.country].filter(Boolean).join(', ') || 'Explorador sin rumbo';
        document.getElementById('pp-rank').textContent     = `#${data.rank || '—'}`;
        document.getElementById('pp-total').textContent    = data.total_count || 0;
        
        const igContainer = document.getElementById('pp-instagram-container');
        const igLink = document.getElementById('pp-instagram-link');
        if (data.instagram_handle) {
            igContainer.classList.remove('hidden');
            igLink.href = `https://instagram.com/${data.instagram_handle}`;
        } else {
            igContainer.classList.add('hidden');
        }
        
        document.getElementById('public-profile-modal').classList.remove('hidden');
    } catch (err) { console.error(err); }
}

function closePublicProfile() {
    document.getElementById('public-profile-modal').classList.add('hidden');
}

// Auto-location detection button
document.getElementById('detect-location-btn').addEventListener('click', () => {
    const btn = document.getElementById('detect-location-btn');
    btn.disabled = true;
    btn.textContent = '⌛ Detectando...';

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async pos => {
                try {
                    const res = await fetch(`${API_URL}/profile/update`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ latitude: pos.coords.latitude, longitude: pos.coords.longitude })
                    });
                    const data = await res.json();
                    if (data.success) {
                        document.getElementById('loc-current-info').classList.remove('hidden');
                        document.getElementById('loc-summary-text').textContent = [data.location.city, data.location.country].filter(Boolean).join(', ');
                        showMsg('location-success', '✅ Ubicación detectada y guardada', 'success');
                    }
                } catch (err) { console.error(err); }
                finally { 
                    btn.disabled = false; 
                    btn.textContent = '📍 Detectar automáticamente';
                }
            },
            err => {
                showMsg('location-error', 'Permiso de ubicación denegado o error');
                btn.disabled = false;
                btn.textContent = '📍 Detectar automáticamente';
            }
        );
    } else {
        showMsg('location-error', 'Geolocalización no soportada');
        btn.disabled = false;
        btn.textContent = '📍 Detectar automáticamente';
    }
});

// Update Profile form
document.getElementById('location-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('save-location-btn');
    const address = document.getElementById('loc-address').value.trim();
    const instagram = document.getElementById('loc-instagram').value.trim();
    
    btn.disabled = true;
    btn.textContent = '⌛ Guardando...';

    try {
        const body = { instagram_handle: instagram || null };
        if (address) body.address = address;

        const res = await fetch(`${API_URL}/profile/update`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (res.ok) {
            showMsg('location-success', '✅ Perfil actualizado', 'success');
            if (data.location.city) {
                document.getElementById('loc-current-info').classList.remove('hidden');
                document.getElementById('loc-summary-text').textContent = [data.location.city, data.location.country].filter(Boolean).join(', ');
                document.getElementById('loc-address').value = ''; // Clear input if successful
            }
            loadLeaderboard(currentLbScope);
        } else {
            showMsg('location-error', data.error || 'Error al actualizar perfil');
        }
    } catch { showMsg('location-error', 'Error de conexión'); }
    finally { 
        btn.disabled = false; 
        btn.textContent = 'Guardar Cambios';
    }
});

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════
function renderSpotItem(spot) {
    const date = new Date(spot.spotted_at);
    const isToday = date.toDateString() === new Date().toDateString();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = isToday
        ? `Hoy ${timeStr}`
        : date.toLocaleDateString('es', { day:'numeric', month:'short' }) + ` ${timeStr}`;
    return `<div class="spot-item">
        <div class="spot-icon">🚗</div>
        <div class="spot-info">
            <h4>${esc(spot.car_type) || 'Auto Amarillo'}</h4>
            <p>📍 ${esc(spot.location_name) || 'Ubicación desconocida'}</p>
        </div>
        <div class="spot-time">${esc(dateStr)}</div>
    </div>`;
}

function formatDateGroup(dateKey) {
    const date = new Date(dateKey);
    const today = new Date();
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString())     return '📅 Hoy';
    if (date.toDateString() === yesterday.toDateString()) return '📅 Ayer';
    return '📅 ' + date.toLocaleDateString('es', { weekday:'long', day:'numeric', month:'long' });
}

function expireSession() {
    localStorage.removeItem('yc_token');
    localStorage.removeItem('yc_username');
    token = null;
    stopNotificationPolling();
    showScreen('login-screen');
}

// ═══════════════════════════════════════════════════════════════
//  POLLING FOR NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════
let notificationPollInterval = null;
let lastNotificationCount = 0;

async function checkNotifications() {
    if (!token) return;
    try {
        const res = await fetch(`${API_URL}/notifications/unread-count`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401 || res.status === 403) { 
            stopNotificationPolling();
            return; 
        }
        const data = await res.json();
        updateNotificationBadge(data.count);
        
        if (data.count > lastNotificationCount) {
            showNewNotificationToast();
        }
        lastNotificationCount = data.count;
    } catch (err) { console.error('Notification poll error:', err); }
}

function updateNotificationBadge(count) {
    let badge = document.getElementById('notification-badge');
    if (!badge) return;
    
    if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function showNewNotificationToast() {
    const toast = document.getElementById('notification-toast');
    if (toast) {
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 5000);
    }
}

function startNotificationPolling() {
    checkNotifications();
    notificationPollInterval = setInterval(checkNotifications, 30000);
}

function stopNotificationPolling() {
    if (notificationPollInterval) {
        clearInterval(notificationPollInterval);
        notificationPollInterval = null;
    }
}

// ═══════════════════════════════════════════════════════════════
//  NOTIFICATIONS UI
// ═══════════════════════════════════════════════════════════════
let currentNotificationsPage = 1;

async function loadNotifications(page = 1) {
    if (!token) return;
    currentNotificationsPage = page;
    
    try {
        const res = await fetch(`${API_URL}/notifications?page=${page}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401 || res.status === 403) { expireSession(); return; }
        const data = await res.json();
        
        const container = document.getElementById('notifications-container');
        if (!data.notifications || data.notifications.length === 0) {
            container.innerHTML = '<p class="empty-state">No tienes notificaciones aún 🔔</p>';
            document.getElementById('notifications-pagination').innerHTML = '';
            return;
        }
        
        container.innerHTML = data.notifications.map(n => renderNotificationItem(n)).join('');
        
        const pag = document.getElementById('notifications-pagination');
        if (data.pages <= 1) { pag.innerHTML = ''; return; }
        pag.innerHTML = `
            <button class="pag-btn" onclick="loadNotifications(${page-1})" ${page<=1?'disabled':''}>← Anterior</button>
            <span class="pag-info">Página ${page} de ${data.pages}</span>
            <button class="pag-btn" onclick="loadNotifications(${page+1})" ${page>=data.pages?'disabled':''}>Siguiente →</button>`;
    } catch (err) { console.error(err); }
}

function renderNotificationItem(notif) {
    const date = new Date(notif.created_at);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = date.toLocaleDateString('es', { day:'numeric', month:'short' });
    
    const typeIcons = {
        'yellow_car_spotted': '🚗',
        'friend_request': '🤝',
        'friend_accepted': '🎉',
        'achievement': '🏆'
    };
    
    const icon = typeIcons[notif.type] || '🔔';
    const readClass = notif.is_read ? '' : 'notification-unread';
    
    return `<div class="notification-item ${readClass}" data-id="${notif.id}">
        <div class="notification-icon">${icon}</div>
        <div class="notification-content">
            <p class="notification-message">${esc(notif.message)}</p>
            <span class="notification-time">${dateStr} ${timeStr}</span>
        </div>
        <div class="notification-actions">
            ${!notif.is_read ? `<button class="notif-action-btn" onclick="markNotificationRead(${notif.id})" title="Marcar como leída">✓</button>` : ''}
            <button class="notif-action-btn" onclick="deleteNotification(${notif.id})" title="Eliminar">×</button>
        </div>
    </div>`;
}

async function markNotificationRead(id) {
    try {
        const res = await fetch(`${API_URL}/notifications/${id}/read`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const item = document.querySelector(`.notification-item[data-id="${id}"]`);
            if (item) item.classList.remove('notification-unread');
            checkNotifications();
        }
    } catch (err) { console.error(err); }
}

async function markAllNotificationsRead() {
    try {
        const res = await fetch(`${API_URL}/notifications/read-all`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            document.querySelectorAll('.notification-item.notification-unread').forEach(el => {
                el.classList.remove('notification-unread');
            });
            checkNotifications();
        }
    } catch (err) { console.error(err); }
}

async function deleteNotification(id) {
    try {
        const res = await fetch(`${API_URL}/notifications/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const item = document.querySelector(`.notification-item[data-id="${id}"]`);
            if (item) item.remove();
            checkNotifications();
        }
    } catch (err) { console.error(err); }
}

function openNotificationsModal() {
    loadNotificationsModal(1);
    document.getElementById('notifications-modal').classList.remove('hidden');
}

function closeNotificationsModal() {
    document.getElementById('notifications-modal').classList.add('hidden');
}

async function loadNotificationsModal(page = 1) {
    if (!token) return;
    currentNotificationsPage = page;
    
    try {
        const res = await fetch(`${API_URL}/notifications?page=${page}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401 || res.status === 403) { expireSession(); return; }
        const data = await res.json();
        
        const container = document.getElementById('notifications-container-modal');
        if (!data.notifications || data.notifications.length === 0) {
            container.innerHTML = '<p class="empty-state">No tienes notificaciones aún 🔔</p>';
            document.getElementById('notifications-pagination-modal').innerHTML = '';
            return;
        }
        
        container.innerHTML = data.notifications.map(n => renderNotificationItem(n)).join('');
        
        const pag = document.getElementById('notifications-pagination-modal');
        if (data.pages <= 1) { pag.innerHTML = ''; return; }
        pag.innerHTML = `
            <button class="pag-btn" onclick="loadNotificationsModal(${page-1})" ${page<=1?'disabled':''}>← Anterior</button>
            <span class="pag-info">Página ${page} de ${data.pages}</span>
            <button class="pag-btn" onclick="loadNotificationsModal(${page+1})" ${page>=data.pages?'disabled':''}>Siguiente →</button>`;
    } catch (err) { console.error(err); }
}

async function loadNotifications(page = 1) {
    if (!token) return;
    currentNotificationsPage = page;
    
    try {
        const res = await fetch(`${API_URL}/notifications?page=${page}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401 || res.status === 403) { expireSession(); return; }
        const data = await res.json();
        
        const container = document.getElementById('notifications-container');
        if (!data.notifications || data.notifications.length === 0) {
            container.innerHTML = '<p class="empty-state">No tienes notificaciones aún 🔔</p>';
            document.getElementById('notifications-pagination').innerHTML = '';
            return;
        }
        
        container.innerHTML = data.notifications.map(n => renderNotificationItem(n)).join('');
        
        const pag = document.getElementById('notifications-pagination');
        if (data.pages <= 1) { pag.innerHTML = ''; return; }
        pag.innerHTML = `
            <button class="pag-btn" onclick="loadNotifications(${page-1})" ${page<=1?'disabled':''}>← Anterior</button>
            <span class="pag-info">Página ${page} de ${data.pages}</span>
            <button class="pag-btn" onclick="loadNotifications(${page+1})" ${page>=data.pages?'disabled':''}>Siguiente →</button>`;
    } catch (err) { console.error(err); }
}

function closeNotificationsModal() {
    document.getElementById('notifications-modal').classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════════
//  FRIENDS MANAGEMENT UI
// ═══════════════════════════════════════════════════════════════
let currentFriendsTab = 'friends'; // friends, requests, search

async function loadFriendsData() {
    if (!token) return;
    try {
        const res = await fetch(`${API_URL}/friends`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401 || res.status === 403) { expireSession(); return; }
        const data = await res.json();
        
        renderFriendsList(data.friends);
        renderPendingRequests(data.pendingRequests);
    } catch (err) { console.error(err); }
}

function renderFriendsList(friends) {
    const container = document.getElementById('friends-list');
    if (!friends || friends.length === 0) {
        container.innerHTML = '<p class="empty-state">No tienes amigos aún. ¡Agrega algunos! 👥</p>';
        return;
    }
    
    container.innerHTML = friends.map(f => {
        const friendUsername = f.username || 'Unknown';
        const friendCity = f.city || null;
        const friendCountry = f.country || null;
        const friendId = f.id || f.friend_id || 0;
        const locationStr = [friendCity, friendCountry].filter(Boolean).join(', ') || 'Sin ubicación';
        
        return `<div class="friend-item">
            <div class="friend-avatar">${esc(friendUsername.charAt(0).toUpperCase())}</div>
            <div class="friend-info">
                <div class="friend-name">${esc(friendUsername)}</div>
                <div class="friend-location">${esc(locationStr)}</div>
            </div>
            <button class="friend-action-btn" onclick="openPublicProfile('${esc(friendUsername)}')" title="Ver perfil">👁️</button>
            <button class="friend-action-btn friend-remove" onclick="removeFriend(${friendId})" title="Eliminar amigo">×</button>
        </div>`;
    }).join('');
}

function renderPendingRequests(requests) {
    const container = document.getElementById('friend-requests-list');
    if (!requests || requests.length === 0) {
        container.innerHTML = '<p class="empty-state">No tienes solicitudes pendientes 📭</p>';
        return;
    }
    
    container.innerHTML = requests.map(r => {
        const reqUsername = r.username || 'Unknown';
        const reqCity = r.city || null;
        const reqCountry = r.country || null;
        const reqId = r.id || 0;
        const locationStr = [reqCity, reqCountry].filter(Boolean).join(', ') || 'Sin ubicación';
        
        return `<div class="friend-request-item">
            <div class="friend-avatar">${esc(reqUsername.charAt(0).toUpperCase())}</div>
            <div class="friend-info">
                <div class="friend-name">${esc(reqUsername)}</div>
                <div class="friend-location">${esc(locationStr)}</div>
            </div>
            <div class="friend-request-actions">
                <button class="accept-btn" onclick="acceptFriendRequest(${reqId})">✓ Aceptar</button>
                <button class="reject-btn" onclick="rejectFriendRequest(${reqId})">×</button>
            </div>
        </div>`;
    }).join('');
}

async function searchUsers(query) {
    if (!token || query.length < 2) return;
    try {
        const res = await fetch(`${API_URL}/friends/search?q=${encodeURIComponent(query)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Error en la búsqueda');
        const data = await res.json();
        
        const container = document.getElementById('search-results');
        if (!data || data.length === 0) {
            container.innerHTML = '<p class="empty-state">No se encontraron usuarios 🔍</p>';
            return;
        }
        
        container.innerHTML = data.map(u => `
            <div class="friend-item">
                <div class="friend-avatar">${esc(u.username.charAt(0).toUpperCase())}</div>
                <div class="friend-info">
                    <div class="friend-name">${esc(u.username)}</div>
                    <div class="friend-location">${[u.city, u.country].filter(Boolean).join(', ') || 'Sin ubicación'}</div>
                </div>
                <button class="add-friend-btn" onclick="sendFriendRequest('${esc(u.username)}')">+ Agregar</button>
            </div>
        `).join('');
    } catch (err) { 
        console.error(err);
        const container = document.getElementById('search-results');
        container.innerHTML = '<p class="empty-state">Error al buscar usuarios 🔍</p>';
    }
}

async function sendFriendRequest(username) {
    try {
        const res = await fetch(`${API_URL}/friends/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ friendUsername: username })
        });
        const data = await res.json();
        if (res.ok) {
            showMsg('friend-search-message', 'Solicitud enviada! ✉️', 'success');
            document.getElementById('search-results').innerHTML = '';
            document.getElementById('search-input').value = '';
        } else {
            showMsg('friend-search-message', data.error || 'Error al enviar solicitud', 'error');
        }
    } catch (err) { showMsg('friend-search-message', 'Error de conexión', 'error'); }
}

async function acceptFriendRequest(id) {
    try {
        const res = await fetch(`${API_URL}/friends/accept/${id}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            showMsg('friend-requests-message', 'Amigo agregado! 🎉', 'success');
            loadFriendsData();
        } else {
            const data = await res.json();
            showMsg('friend-requests-message', data.error || 'Error al aceptar solicitud', 'error');
        }
    } catch (err) { 
        console.error(err);
        showMsg('friend-requests-message', 'Error de conexión', 'error');
    }
}

async function rejectFriendRequest(id) {
    try {
        const res = await fetch(`${API_URL}/friends/reject/${id}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            const data = await res.json();
            showMsg('friend-requests-message', data.error || 'Error al rechazar', 'error');
        }
    } catch (err) { 
        console.error(err);
        showMsg('friend-requests-message', 'Error de conexión', 'error');
    }
}

async function removeFriend(id) {
    if (!confirm('¿Estás seguro de eliminar este amigo?')) return;
    try {
        const res = await fetch(`${API_URL}/friends/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            const data = await res.json();
            showMsg('friends-message', data.error || 'Error al eliminar amigo', 'error');
        }
    } catch (err) { 
        console.error(err);
        showMsg('friends-message', 'Error de conexión', 'error');
    }
}

function switchFriendsTab(tab) {
    currentFriendsTab = tab;
    document.querySelectorAll('.friends-subtab').forEach(t => t.classList.add('hidden'));
    document.getElementById(`friends-${tab}`).classList.remove('hidden');
    document.querySelectorAll('.friends-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.friends-tab-btn[data-tab="${tab}"]`).classList.add('active');
    
    if (tab === 'friends') loadFriendsData();
    if (tab === 'requests') loadFriendsData();
}

let searchTimeout = null;
document.addEventListener('input', (e) => {
    if (e.target.id === 'search-input') {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();
        if (query.length >= 2) {
            searchTimeout = setTimeout(() => searchUsers(query), 500);
        }
    }
});
