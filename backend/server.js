require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const morgan = require('morgan');
const https = require('https');
const rateLimit = require('express-rate-limit');

// Verificar que las variables se cargaron correctamente
console.log('Environment variables loaded:');
console.log(`- PORT: ${process.env.PORT || 'NOT SET'}`);
console.log(`- NODE_ENV: ${process.env.NODE_ENV || 'NOT SET'}`);
console.log(`- DATABASE_URL configured: ${!!process.env.DATABASE_URL}`);
console.log(`- JWT_SECRET configured: ${!!process.env.JWT_SECRET}`);

const app = express();
// Trust proxy for Cloudflare and other reverse proxies
app.set('trust proxy', 1);

const port = process.env.PORT || 3001;

// Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend'))); // Serve frontend

// ─── Rate Limiting ──────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: 'Demasiadas peticiones. Intenta de nuevo en 15 minutos.' }
});

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each IP to 10 login/register attempts per hour
  message: { error: 'Demasiados intentos fallidos. Intenta mañana o en una hora.' }
});

// Apply to all API routes
app.use('/api/', apiLimiter);
// Stricter limit for auth
app.use('/api/auth/', authLimiter);

// ─── Error Handling Helper ────────────────────────────────────
const sendError = (res, err, statusCode = 500) => {
  console.error('SERVER ERROR:', err);
  // Do not expose database/internal details in production
  const message = statusCode === 500 ? 'Error interno del servidor' : err.message;
  res.status(statusCode).json({ error: message });
};

// ─── Authentication Middleware ──────────────────────────────────
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied' });
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// ─── Health Check ───────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Geocoding Helper (Nominatim — free, no API key required) ──
function reverseGeocode(lat, lon) {
  return new Promise((resolve) => {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=16&addressdetails=1`;
    const options = {
      headers: { 'User-Agent': 'YellowCarCounter/1.0' }
    };

    const req = https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const addr = json.address || {};
          
          const city = addr.city || addr.town || addr.village || addr.county || '';
          const country = addr.country || '';
          
          // Basic continent mapping (very simplified)
          let continent = '';
          const cc = addr.country_code?.toLowerCase();
          if (['es', 'fr', 'it', 'de', 'gb', 'pt'].includes(cc)) continent = 'Europa';
          else if (['us', 'ca', 'mx'].includes(cc)) continent = 'Norteamérica';
          else if (['ar', 'br', 'cl', 'co', 'pe', 'uy'].includes(cc)) continent = 'Sudamérica';

          resolve({
            city,
            country,
            continent,
            display_name: [addr.road || addr.pedestrian, city].filter(Boolean).join(', ') || 'Ubicación desconocida'
          });
        } catch {
          resolve({ city: '', country: '', continent: '', display_name: 'Ubicación desconocida' });
        }
      });
    });

    req.on('error', () => resolve({ city: '', country: '', continent: '', display_name: 'Ubicación desconocida' }));
    req.setTimeout(4000, () => {
      req.destroy();
      resolve({ city: '', country: '', continent: '', display_name: 'Ubicación desconocida' });
    });
  });
}

function geocodeAddress(address) {
  return new Promise((resolve) => {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&addressdetails=1`;
    const options = { headers: { 'User-Agent': 'YellowCarCounter/1.0' } };

    const req = https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (!json || json.length === 0) return resolve(null);
          const addr = json[0].address || {};
          const city = addr.city || addr.town || addr.village || addr.suburb || addr.county || '';
          const country = addr.country || '';
          
          let continent = 'Mundo';
          const cc = addr.country_code?.toLowerCase();
          if (['es', 'fr', 'it', 'de', 'gb', 'pt', 'ru', 'nl', 'be', 'ch', 'at', 'se', 'no', 'dk', 'ie'].includes(cc)) continent = 'Europa';
          else if (['us', 'ca', 'mx'].includes(cc)) continent = 'Norteamérica';
          else if (['ar', 'br', 'cl', 'co', 'pe', 'uy', 've', 'ec', 'py', 'bo'].includes(cc)) continent = 'Sudamérica';
          else if (['cn', 'jp', 'kr', 'in', 'id', 'th', 'vn', 'ph'].includes(cc)) continent = 'Asia';

          resolve({ city, country, continent });
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(4000, () => { req.destroy(); resolve(null); });
  });
}

// ═══════════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════════

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const result = await pool.query(
      'INSERT INTO yellowcar.users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username',
      [username, email, passwordHash]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'El email o nombre de usuario ya existe' });
    }
    sendError(res, err);
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }

    console.log('Login attempt');
    
    // Query user
    const result = await pool.query('SELECT * FROM yellowcar.users WHERE email = $1', [email]);
    
    if (result.rows.length === 0) {
      console.log(`User not found: ${email}`);
      return res.status(400).json({ error: 'Usuario no encontrado' });
    }
    
    const user = result.rows[0];
    console.log('User authenticated');
    
    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      console.log('Invalid password');
      return res.status(400).json({ error: 'Contraseña incorrecta' });
    }
    
    // Generate token
    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not configured!');
      throw new Error('JWT_SECRET is not configured');
    }
    
    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '30d' });
    console.log('Login successful');
    
    res.json({ token, username: user.username });
  } catch (err) {
    console.error('Login error:', err);
    sendError(res, err);
  }
});

// ─── Spot a car (with reverse geocoding) ──────────────────────
app.post('/api/spot', authenticateToken, async (req, res) => {
  try {
    const { latitude, longitude, location_name, car_type } = req.body;
    const userId = req.user.id;

    // Resolve location name: use provided name, geocode if coords available, fallback otherwise
    let resolvedLocation = location_name || null;
    let autoLoc = { city: null, country: null, continent: null };

    if (latitude && longitude) {
      const geoData = await reverseGeocode(latitude, longitude);
      if (!resolvedLocation) resolvedLocation = geoData.display_name;
      autoLoc = { city: geoData.city, country: geoData.country, continent: geoData.continent };
      
      // OPTIONAL: Update user location if not set
      await pool.query(
        `UPDATE yellowcar.users 
         SET city = COALESCE(city, $1), 
             country = COALESCE(country, $2), 
             continent = COALESCE(continent, $3) 
         WHERE id = $4`,
        [autoLoc.city, autoLoc.country, autoLoc.continent, userId]
      );
    }
    resolvedLocation = resolvedLocation || 'Ubicación desconocida';

    const result = await pool.query(
      'INSERT INTO yellowcar.spottings (user_id, latitude, longitude, location_name, car_type) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [userId, latitude || null, longitude || null, resolvedLocation, car_type || 'Yellow Car']
    );

    // Stats are updated via the PostgreSQL trigger defined in schema.sql

    // Notify all accepted friends about the new yellow car spotting
    const usernameResult = await pool.query('SELECT username FROM yellowcar.users WHERE id = $1', [userId]);
    const username = usernameResult.rows[0]?.username || 'Un usuario';
    
    // Get all accepted friends
    const friendsResult = await pool.query(
      `SELECT user_id, friend_id FROM yellowcar.friends 
       WHERE (user_id = $1 OR friend_id = $1) AND status = 'accepted'`,
      [userId]
    );

    // Create notifications for each friend
    for (const friendship of friendsResult.rows) {
      const friendId = friendship.user_id === userId ? friendship.friend_id : friendship.user_id;
      
      await pool.query(
        `INSERT INTO yellowcar.notifications (recipient_id, sender_id, type, related_id, message) 
         VALUES ($1, $2, $3, $4, $5)`,
        [
          friendId, 
          userId, 
          'yellow_car_spotted', 
          result.rows[0].id,
          `${username} acaba de avistar un auto amarillo en ${resolvedLocation}! 🚗`
        ]
      );
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Dashboard ─────────────────────────────────────────────────
app.get('/api/dashboard', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // All-time stats
    const statsResult = await pool.query(
      'SELECT * FROM yellowcar.user_stats WHERE user_id = $1',
      [userId]
    );

    // Today's count (in user's local day based on UTC offset)
    const todayResult = await pool.query(
      `SELECT COUNT(*)::int AS today_count
       FROM yellowcar.spottings
       WHERE user_id = $1
         AND spotted_at::date = CURRENT_DATE`,
      [userId]
    );

    // Recent 10 spottings
    const recentResult = await pool.query(
      `SELECT id, car_type, location_name, spotted_at, latitude, longitude
       FROM yellowcar.spottings
       WHERE user_id = $1
       ORDER BY spotted_at DESC
       LIMIT 10`,
      [userId]
    );

    const stats = statsResult.rows[0] || { total_count: 0, current_streak: 0, best_streak: 0, last_spotted_at: null };
    stats.today_count = todayResult.rows[0]?.today_count ?? 0;

    res.json({ stats, recent: recentResult.rows });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Stats (period: week | month | alltime) ───────────────────
app.get('/api/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const period = req.query.period || 'week';

    let chartQuery, chartParams;

    if (period === 'week') {
      chartQuery = `
        SELECT DATE(spotted_at) AS label, COUNT(*)::int AS count
        FROM yellowcar.spottings
        WHERE user_id = $1 AND spotted_at >= CURRENT_DATE - INTERVAL '6 days'
        GROUP BY DATE(spotted_at) ORDER BY label ASC`;
      chartParams = [userId];

    } else if (period === 'month') {
      chartQuery = `
        SELECT DATE(spotted_at) AS label, COUNT(*)::int AS count
        FROM yellowcar.spottings
        WHERE user_id = $1 AND spotted_at >= CURRENT_DATE - INTERVAL '29 days'
        GROUP BY DATE(spotted_at) ORDER BY label ASC`;
      chartParams = [userId];

    } else { // alltime — group by month
      chartQuery = `
        SELECT TO_CHAR(DATE_TRUNC('month', spotted_at), 'YYYY-MM') AS label,
               COUNT(*)::int AS count
        FROM yellowcar.spottings
        WHERE user_id = $1
        GROUP BY DATE_TRUNC('month', spotted_at)
        ORDER BY label ASC`;
      chartParams = [userId];
    }

    const chartResult = await pool.query(chartQuery, chartParams);

    // Best single day ever
    const bestDayResult = await pool.query(
      `SELECT DATE(spotted_at) AS day, COUNT(*)::int AS count
       FROM yellowcar.spottings WHERE user_id = $1
       GROUP BY DATE(spotted_at) ORDER BY count DESC LIMIT 1`,
      [userId]
    );

    // All-time stats
    const statsResult = await pool.query(
      'SELECT * FROM yellowcar.user_stats WHERE user_id = $1', [userId]
    );

    // Period total
    let periodTotalQuery;
    if (period === 'week') {
      periodTotalQuery = `SELECT COUNT(*)::int AS total FROM yellowcar.spottings
        WHERE user_id = $1 AND spotted_at >= CURRENT_DATE - INTERVAL '6 days'`;
    } else if (period === 'month') {
      periodTotalQuery = `SELECT COUNT(*)::int AS total FROM yellowcar.spottings
        WHERE user_id = $1 AND spotted_at >= CURRENT_DATE - INTERVAL '29 days'`;
    } else {
      periodTotalQuery = `SELECT COUNT(*)::int AS total FROM yellowcar.spottings WHERE user_id = $1`;
    }
    const periodTotalResult = await pool.query(periodTotalQuery, [userId]);

    res.json({
      chart: chartResult.rows,
      period,
      periodTotal: periodTotalResult.rows[0]?.total ?? 0,
      bestDay: bestDayResult.rows[0] || null,
      stats: statsResult.rows[0] || { total_count: 0, current_streak: 0, best_streak: 0 }
    });
  } catch (err) {
    sendError(res, err);
  }
});


// ─── History (all spottings, grouped) ─────────────────────────
app.get('/api/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    const result = await pool.query(
      `SELECT id, car_type, location_name, spotted_at, latitude, longitude
       FROM yellowcar.spottings
       WHERE user_id = $1
       ORDER BY spotted_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*)::int AS total FROM yellowcar.spottings WHERE user_id = $1',
      [userId]
    );

    res.json({
      items: result.rows,
      total: countResult.rows[0].total,
      page,
      pages: Math.ceil(countResult.rows[0].total / limit)
    });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Profile (user info + achievements) ───────────────────────
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const userResult = await pool.query(
      'SELECT id, username, email, created_at FROM yellowcar.users WHERE id = $1',
      [userId]
    );

    const statsResult = await pool.query(
      'SELECT * FROM yellowcar.user_stats WHERE user_id = $1',
      [userId]
    );

    const stats = statsResult.rows[0] || { total_count: 0, current_streak: 0, best_streak: 0 };

    // Compute achievements
    const achievements = [];
    if (stats.total_count >= 1)   achievements.push({ id: 'first',    icon: '🌟', title: 'Primer Avistamiento',  desc: '¡Viste tu primer auto amarillo!' });
    if (stats.total_count >= 10)  achievements.push({ id: 'ten',      icon: '🔥', title: '10 Autos',             desc: 'Ya vas 10 autos amarillos.' });
    if (stats.total_count >= 50)  achievements.push({ id: 'fifty',    icon: '🏆', title: '50 Autos',             desc: '¡Eres todo un cazador!' });
    if (stats.total_count >= 100) achievements.push({ id: 'hundred',  icon: '💎', title: 'Centenario',           desc: '100 autos. Leyenda.' });
    if (stats.best_streak >= 3)   achievements.push({ id: 'streak3',  icon: '⚡', title: 'Racha de 3 Días',      desc: '3 días seguidos avistando.' });
    if (stats.best_streak >= 7)   achievements.push({ id: 'streak7',  icon: '🚀', title: 'Semana Perfecta',      desc: '7 días consecutivos.' });

    res.json({
      user: userResult.rows[0],
      stats,
      achievements
    });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Public Profile ───────────────────────────────────────────
app.get('/api/profile/:username', async (req, res) => {
  try {
    const { username } = req.params;
    
    const query = `
      SELECT 
        u.username, u.country, u.city, u.instagram_handle,
        s.total_count, s.current_streak, s.best_streak,
        (SELECT COUNT(*) + 1 FROM yellowcar.user_stats WHERE total_count > s.total_count) as rank
      FROM yellowcar.users u
      LEFT JOIN yellowcar.user_stats s ON u.id = s.user_id
      WHERE u.username = $1`;
    
    const result = await pool.query(query, [username]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    
    res.json(result.rows[0]);
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Update Profile (Location & Social) ───────────────────────
app.put('/api/profile/update', authenticateToken, async (req, res) => {
  try {
    const { country, city, continent, instagram_handle, latitude, longitude, address } = req.body;
    
    let finalCountry = country;
    let finalCity = city;
    let finalContinent = continent;

    // Option A: GPS Coordinates
    if (latitude && longitude && (!country || !city)) {
      const geoData = await reverseGeocode(latitude, longitude);
      finalCountry = geoData.country;
      finalCity = geoData.city;
      finalContinent = geoData.continent;
    }
    // Option B: Text Address Search
    else if (address) {
      const geoData = await geocodeAddress(address);
      if (geoData) {
        finalCountry = geoData.country;
        finalCity = geoData.city;
        finalContinent = geoData.continent;
      } else {
        return res.status(404).json({ error: 'No pudimos encontrar esa dirección. Intenta con una ciudad.' });
      }
    }

    await pool.query(
      `UPDATE yellowcar.users 
       SET country = $1, city = $2, continent = $3, instagram_handle = $4 
       WHERE id = $5`,
      [finalCountry || null, finalCity || null, finalContinent || null, instagram_handle || null, req.user.id]
    );
    res.json({ success: true, location: { country: finalCountry, city: finalCity, continent: finalContinent } });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Leaderboard ───────────────────────────────────────────────
app.get('/api/leaderboard', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const scope = req.query.scope || 'global'; // global | country | city | continent

    // Get current user's location for scoped queries
    const meResult = await pool.query(
      'SELECT country, city, continent FROM yellowcar.users WHERE id = $1', [userId]
    );
    const me = meResult.rows[0] || {};

    let whereClause = '';
    let params = [];

    if (scope === 'country' && me.country) {
      whereClause = 'AND u.country = $1';
      params = [me.country];
    } else if (scope === 'city' && me.city) {
      whereClause = 'AND u.city = $1';
      params = [me.city];
    } else if (scope === 'continent' && me.continent) {
      whereClause = 'AND u.continent = $1';
      params = [me.continent];
    }
    // else: global — no WHERE filter

    const query = `
      SELECT
        u.id,
        u.username,
        u.country,
        u.city,
        u.continent,
        COALESCE(s.total_count, 0) AS total_count,
        COALESCE(s.current_streak, 0) AS current_streak,
        COALESCE(s.best_streak, 0) AS best_streak
      FROM yellowcar.users u
      LEFT JOIN yellowcar.user_stats s ON u.id = s.user_id
      WHERE 1=1 ${whereClause}
      ORDER BY total_count DESC, s.best_streak DESC
      LIMIT 50`;

    const result = await pool.query(query, params);

    // Find current user's rank globally (not just in current view)
    const myRankResult = await pool.query(
      `SELECT rank FROM (
        SELECT id, RANK() OVER (ORDER BY total_count DESC, best_streak DESC) as rank
        FROM yellowcar.users u
        LEFT JOIN yellowcar.user_stats s ON u.id = s.user_id
      ) AS ranked WHERE id = $1`, [userId]
    );
    const myRank = myRankResult.rows[0]?.rank || 0;

    res.json({
      scope,
      userLocation: { country: me.country, city: me.city, continent: me.continent },
      myRank,
      leaders: result.rows.map((r, i) => ({
        rank: i + 1,
        username: r.username,
        country: r.country,
        city: r.city,
        continent: r.continent,
        total_count: r.total_count,
        current_streak: r.current_streak,
        best_streak: r.best_streak,
        isMe: r.id === userId
      }))
    });
  } catch (err) {
    sendError(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════
//  FRIENDS MANAGEMENT
// ═══════════════════════════════════════════════════════════════

// Get friends list (pending, accepted)
app.get('/api/friends', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const status = req.query.status || 'accepted'; // pending, accepted, all

    let query;
    let params;

    // Get friendships where user is either sender (user_id) or receiver (friend_id)
    if (status === 'all') {
      query = `
        SELECT 
          f.id, f.status, f.created_at, f.updated_at,
          CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END as friend_id,
          u.id as friend_user_id, u.username, u.email, u.country, u.city, u.instagram_handle
        FROM yellowcar.friends f
        JOIN yellowcar.users u ON u.id = CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
        WHERE (f.user_id = $1 OR f.friend_id = $1)
        ORDER BY f.updated_at DESC`;
      params = [userId];
    } else {
      query = `
        SELECT 
          f.id, f.status, f.created_at, f.updated_at,
          CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END as friend_id,
          u.id as friend_user_id, u.username, u.email, u.country, u.city, u.instagram_handle
        FROM yellowcar.friends f
        JOIN yellowcar.users u ON u.id = CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
        WHERE (f.user_id = $1 OR f.friend_id = $1) AND f.status = $2
        ORDER BY f.updated_at DESC`;
      params = [userId, status];
    }

    const result = await pool.query(query, params);

    // Also get pending requests WHERE I am the recipient
    const incomingQuery = `
      SELECT 
        f.id, f.status, f.created_at, f.updated_at,
        u.id as from_user_id, u.username, u.email, u.country, u.city, u.instagram_handle
      FROM yellowcar.friends f
      JOIN yellowcar.users u ON u.id = f.user_id
      WHERE f.friend_id = $1 AND f.status = 'pending'
      ORDER BY f.created_at DESC`;
    const incomingResult = await pool.query(incomingQuery, [userId]);

    res.json({
      friends: result.rows,
      pendingRequests: incomingResult.rows
    });
  } catch (err) {
    sendError(res, err);
  }
});

// Send friend request
app.post('/api/friends/request', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { friendUsername } = req.body;

    if (!friendUsername) {
      return res.status(400).json({ error: 'Nombre de usuario requerido' });
    }

    // Find friend by username
    const friendResult = await pool.query(
      'SELECT id FROM yellowcar.users WHERE username = $1',
      [friendUsername]
    );

    if (friendResult.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const friendId = friendResult.rows[0].id;

    if (friendId === userId) {
      return res.status(400).json({ error: 'No puedes agregarte a ti mismo' });
    }

    // Check if friendship already exists (either direction)
    const existingQuery = `
      SELECT id FROM yellowcar.friends 
      WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`;
    const existingResult = await pool.query(existingQuery, [userId, friendId]);

    if (existingResult.rows.length > 0) {
      return res.status(400).json({ error: 'Ya existe una solicitud de amistad o ya son amigos' });
    }

    // Create friend request
    const result = await pool.query(
      'INSERT INTO yellowcar.friends (user_id, friend_id, status) VALUES ($1, $2, $3) RETURNING *',
      [userId, friendId, 'pending']
    );

    // Create notification for the friend
    const senderResult = await pool.query('SELECT username FROM yellowcar.users WHERE id = $1', [userId]);
    const senderUsername = senderResult.rows[0].username;

    await pool.query(
      `INSERT INTO yellowcar.notifications (recipient_id, sender_id, type, related_id, message) 
       VALUES ($1, $2, $3, $4, $5)`,
      [friendId, userId, 'friend_request', result.rows[0].id, `${senderUsername} quiere ser tu amigo! 🤝`]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    sendError(res, err);
  }
});

// Accept friend request
app.post('/api/friends/accept/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const requestId = req.params.id;

    // Verify the request exists and is addressed to this user (as friend_id means the request was sent TO this user)
    const checkResult = await pool.query(
      'SELECT * FROM yellowcar.friends WHERE id = $1 AND friend_id = $2 AND status = $3',
      [requestId, userId, 'pending']
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Solicitud no encontrada' });
    }

    const friendRequest = checkResult.rows[0];
    const senderId = friendRequest.user_id;

    // Update status to accepted
    const updateResult = await pool.query(
      'UPDATE yellowcar.friends SET status = $1 WHERE id = $2 RETURNING *',
      ['accepted', requestId]
    );

    // Create notification for the sender
    const ownerResult = await pool.query('SELECT username FROM yellowcar.users WHERE id = $1', [userId]);
    const ownerUsername = ownerResult.rows[0].username;

    await pool.query(
      `INSERT INTO yellowcar.notifications (recipient_id, sender_id, type, related_id, message) 
       VALUES ($1, $2, $3, $4, $5)`,
      [senderId, userId, 'friend_accepted', requestId, `${ownerUsername} aceptó tu solicitud de amistad! 🎉`]
    );

    res.json(updateResult.rows[0]);
  } catch (err) {
    sendError(res, err);
  }
});

// Reject friend request
app.post('/api/friends/reject/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const requestId = req.params.id;

    // Verify the request exists and is addressed to this user
    const requestResult = await pool.query(
      'SELECT * FROM yellowcar.friends WHERE id = $1 AND friend_id = $2 AND status = $3',
      [requestId, userId, 'pending']
    );

    if (requestResult.rows.length === 0) {
      return res.status(404).json({ error: 'Solicitud no encontrada' });
    }

    // Update status to rejected
    const updateResult = await pool.query(
      'UPDATE yellowcar.friends SET status = $1 WHERE id = $2 AND friend_id = $3 RETURNING *',
      ['rejected', requestId, userId]
    );

    res.json(updateResult.rows[0]);
  } catch (err) {
    sendError(res, err);
  }
});

// Remove friend / Cancel request
app.delete('/api/friends/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const friendshipId = req.params.id;

    // Verify friendship exists and user is part of it
    const checkResult = await pool.query(
      'SELECT * FROM yellowcar.friends WHERE id = $1 AND (user_id = $2 OR friend_id = $2)',
      [friendshipId, userId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Amistad no encontrada' });
    }

    await pool.query('DELETE FROM yellowcar.friends WHERE id = $1', [friendshipId]);

    res.json({ success: true, message: 'Amistad eliminada' });
  } catch (err) {
    sendError(res, err);
  }
});

// Search users to add as friends
app.get('/api/friends/search', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const q = req.query.q || '';

    if (q.length < 2) {
      return res.status(400).json({ error: 'Ingresa al menos 2 caracteres para buscar' });
    }

    const result = await pool.query(
      `SELECT id, username, email, country, city, instagram_handle 
       FROM yellowcar.users 
       WHERE (username ILIKE $1 OR email ILIKE $1) AND id != $2
       LIMIT 20`,
      [`%${q}%`, userId]
    );

    res.json(result.rows);
  } catch (err) {
    sendError(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════
//  NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════

// Get user notifications
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    const unreadOnly = req.query.unread === 'true';

    let query = `
      SELECT 
        n.id, n.type, n.related_id, n.message, n.is_read, n.created_at,
        u.id as sender_id, u.username as sender_username
      FROM yellowcar.notifications n
      LEFT JOIN yellowcar.users u ON u.id = n.sender_id
      WHERE n.recipient_id = $1`;
    
    let countQuery = 'SELECT COUNT(*)::int as total FROM yellowcar.notifications WHERE recipient_id = $1';
    const params = [userId];

    if (unreadOnly) {
      query += ' AND n.is_read = FALSE';
      countQuery += ' AND is_read = FALSE';
    }

    query += ` ORDER BY n.created_at DESC LIMIT $2 OFFSET $3`;

    const result = await pool.query(query, [...params, limit, offset]);
    const countResult = await pool.query(countQuery, params);

    res.json({
      notifications: result.rows,
      total: countResult.rows[0].total,
      page,
      pages: Math.ceil(countResult.rows[0].total / limit)
    });
  } catch (err) {
    sendError(res, err);
  }
});

// Get unread notifications count
app.get('/api/notifications/unread-count', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      'SELECT COUNT(*)::int as count FROM yellowcar.notifications WHERE recipient_id = $1 AND is_read = FALSE',
      [userId]
    );

    res.json({ count: result.rows[0].count });
  } catch (err) {
    sendError(res, err);
  }
});

// Mark notification as read
app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const notificationId = req.params.id;

    const result = await pool.query(
      'UPDATE yellowcar.notifications SET is_read = TRUE WHERE id = $1 AND recipient_id = $2 RETURNING *',
      [notificationId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notificación no encontrada' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    sendError(res, err);
  }
});

// Mark all notifications as read
app.put('/api/notifications/read-all', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    await pool.query(
      'UPDATE yellowcar.notifications SET is_read = TRUE WHERE recipient_id = $1 AND is_read = FALSE',
      [userId]
    );

    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

// Delete notification
app.delete('/api/notifications/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const notificationId = req.params.id;

    const result = await pool.query(
      'DELETE FROM yellowcar.notifications WHERE id = $1 AND recipient_id = $2 RETURNING *',
      [notificationId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notificación no encontrada' });
    }

    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

const host = '0.0.0.0';

app.listen(port, host, () => {
  console.log(`🚗 YellowCar server running at http://${host}:${port}`);
});
