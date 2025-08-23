require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const database = require('../database/connection');
const userService = require('../services/userService');
const taskService = require('../services/taskService');

const app = express();
// Prefer platform-provided PORT (Railway/Heroku). Fallback to WEBAPP_PORT or 3001.
const PORT = process.env.PORT || process.env.WEBAPP_PORT || 3001;

// Trust proxy for ngrok
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            styleSrcElem: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com", "data:"],
            scriptSrc: ["'self'", "https://telegram.org", "https://code.iconify.design"],
            scriptSrcElem: ["'self'", "https://telegram.org", "https://code.iconify.design"],
            connectSrc: ["'self'", "https://api.telegram.org", "https://api.iconify.design", "https://code.iconify.design"],
            imgSrc: ["'self'", "data:", "https:"],
            frameSrc: ["'self'", "https://telegram.org"]
        }
    }
}));

// Rate limiting (apply to API only; configurable and proxy-aware)
const rateLimitDisabled = String(process.env.RATE_LIMIT_DISABLED || '').toLowerCase() === 'true';
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute window
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 1000, // generous default for webapp traffic
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Respect first X-Forwarded-For IP behind proxies
        const xf = req.headers['x-forwarded-for'];
        if (typeof xf === 'string' && xf.length > 0) return xf.split(',')[0].trim();
        if (Array.isArray(xf) && xf.length > 0) return String(xf[0]).trim();
        return req.ip;
    }
});
if (!rateLimitDisabled) {
    app.use('/api', limiter);
}

// CORS
app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? false : true,
    credentials: true
}));

// Body parsing middleware (increase limits for base64 media uploads)
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Static files
app.use(express.static(path.join(__dirname, 'static')));

// Database connection
app.use(async (req, res, next) => {
    if (!database.isConnected) {
        await database.connect();
    }
    req.db = database;
    // one-time lightweight schema upgrade
    if (!global.__schemaUpgradedOnce) {
        global.__schemaUpgradedOnce = true;
        try {
            await req.db.run(`ALTER TABLE claims_history ADD COLUMN source TEXT DEFAULT 'daily'`);
        } catch (_) { /* ignore if exists */ }
        // Add enhanced withdrawal columns if missing
        try { await req.db.run(`ALTER TABLE withdrawals ADD COLUMN fee_points INTEGER DEFAULT 0`); } catch (_) {}
        try { await req.db.run(`ALTER TABLE withdrawals ADD COLUMN receivable_points INTEGER DEFAULT NULL`); } catch (_) {}
        try { await req.db.run(`ALTER TABLE withdrawals ADD COLUMN receivable_currency_amount REAL DEFAULT 0`); } catch (_) {}
        try { await req.db.run(`ALTER TABLE withdrawals ADD COLUMN provider TEXT`); } catch (_) {}
        try { await req.db.run(`ALTER TABLE withdrawals ADD COLUMN provider_order_id TEXT`); } catch (_) {}
        try { await req.db.run(`ALTER TABLE withdrawals ADD COLUMN provider_trade_no TEXT`); } catch (_) {}
        try { await req.db.run(`ALTER TABLE withdrawals ADD COLUMN provider_result TEXT`); } catch (_) {}
        try { await req.db.run(`ALTER TABLE withdrawals ADD COLUMN callback_received INTEGER DEFAULT 0`); } catch (_) {}
    }
    next();
});

// Config helpers
async function ensureConfigTable(db){
    // Create table compatible with both SQLite and Postgres
    const isPg = !!db.isPostgres;
    const sql = isPg
        ? `CREATE TABLE IF NOT EXISTS admin_config (
                id SERIAL PRIMARY KEY,
                config_key TEXT UNIQUE NOT NULL,
                config_value TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
           )`
        : `CREATE TABLE IF NOT EXISTS admin_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                config_key TEXT UNIQUE NOT NULL,
                config_value TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
           )`;
    await db.run(sql);
}

async function setConfig(db, entries){
    await ensureConfigTable(db);
    const isPg = !!db.isPostgres;
    if (isPg) {
        const stmt = `INSERT INTO admin_config (config_key, config_value) VALUES (?, ?) 
                      ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = CURRENT_TIMESTAMP`;
        for (const [k,v] of Object.entries(entries)){
            await db.run(stmt, [k, String(v)]);
        }
    } else {
        const stmt = `INSERT INTO admin_config (config_key, config_value) VALUES (?, ?) 
                      ON CONFLICT(config_key) DO UPDATE SET config_value=excluded.config_value, updated_at=datetime('now')`;
        for (const [k,v] of Object.entries(entries)){
            await db.run(stmt, [k, String(v)]);
        }
    }
}

async function getConfig(db, key, fallback){
    await ensureConfigTable(db);
    const row = await db.get(`SELECT config_value FROM admin_config WHERE config_key = ?`, [key]);
    return row && row.config_value != null ? row.config_value : fallback;
}

async function getIntConfig(db, key, fallback){
    const val = await getConfig(db, key, fallback);
    const n = parseInt(val, 10);
    return Number.isFinite(n) ? n : fallback;
}

// Monetag helpers and config
async function getMonetagConfig(db){
    return {
        enabled: (await getConfig(db, 'monetagEnabled', 'false')) === 'true',
        smartlink: await getConfig(db, 'monetagSmartlink', ''),
        token: await getConfig(db, 'monetagToken', ''),
        fixedRewardPoints: await getIntConfig(db, 'monetagFixedRewardPoints', 0),
        hourlyLimit: await getIntConfig(db, 'adsHourlyLimit', 20),
        dailyLimit: await getIntConfig(db, 'adsDailyLimit', 60),
        requiredSeconds: await getIntConfig(db, 'adsRequiredSeconds', 20)
    };
}

async function ensureAdsTables(db){
    try {
        await db.run(`CREATE TABLE IF NOT EXISTS ads_clicks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER NOT NULL,
            provider TEXT NOT NULL,
            click_id TEXT NOT NULL,
            created_at DATETIME DEFAULT (datetime('now'))
        )`);
    } catch (_) {}
    try {
        await db.run(`CREATE TABLE IF NOT EXISTS ads_earnings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER NOT NULL,
            provider TEXT NOT NULL,
            provider_txid TEXT,
            click_id TEXT,
            points_earned INTEGER NOT NULL,
            revenue_amount REAL,
            created_at DATETIME DEFAULT (datetime('now')),
            UNIQUE(provider, provider_txid)
        )`);
    } catch (_) {}
}

// Paystack helpers and config
function getPaystackBankCode(localBankName){
    const name = String(localBankName || '').toLowerCase();
    const map = {
        // Minimal mapping for common options; dynamic resolver will handle the rest
        'kuda': '50211', // Kuda Microfinance Bank
        'kuda microfinance bank': '50211',
        'moniepoint': '50515', // Moniepoint Microfinance Bank
        'moniepoint microfinance bank': '50515',
        'access bank': '044',
        'gtbank': '058',
        'gtb': '058',
        'guaranty trust': '058',
        'guaranty trust bank': '058',
        'first bank': '011',
        'first bank of nigeria': '011',
        'zenith bank': '057',
        'uba': '033',
        'united bank for africa': '033',
        'wema bank': '035',
        'fidelity bank': '070',
        'keystone bank': '082',
        'providus bank': '101',
        'stanbic ibtc bank': '221',
        'sterling bank': '232',
        'polaris bank': '076',
        'union bank of nigeria': '032',
    };
    return map[name] || null;
}

function normalizeBankName(s){
    const raw = String(s || '').toLowerCase().trim();
    // remove punctuation and common suffixes
    const cleaned = raw
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\b(bank|microfinance|mfb|limited|ltd|plc)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    // special cases
    if (cleaned.includes('guaranty') && cleaned.includes('trust')) return 'guaranty trust';
    if (cleaned === 'gt' || cleaned === 'gtb' || cleaned === 'gt bank') return 'guaranty trust';
    return cleaned;
}

async function fetchPaystackBanks(secret){
    try {
        const resp = await fetch('https://api.paystack.co/bank?currency=NGN', {
            headers: { Authorization: `Bearer ${secret}` }
        }).then(r => r.json());
        if (!resp || resp.status !== true || !Array.isArray(resp.data)) return [];
        return resp.data.map(b => ({ name: b.name, code: b.code }));
    } catch (_) { return []; }
}

async function getCachedPaystackBanks(db, secret){
    try {
        const json = await getConfig(db, 'paystackBanksJson', '');
        const tsStr = await getConfig(db, 'paystackBanksUpdatedAt', '0');
        const ts = parseInt(tsStr, 10) || 0;
        const maxAgeMs = 1000 * 60 * 60 * 24 * 3; // 3 days
        if (json && Date.now() - ts < maxAgeMs) {
            try { return JSON.parse(json); } catch (_) {}
        }
        const fresh = await fetchPaystackBanks(secret);
        if (fresh.length > 0) {
            await setConfig(db, { paystackBanksJson: JSON.stringify(fresh), paystackBanksUpdatedAt: String(Date.now()) });
            return fresh;
        }
        // fallback to old cache if fetch failed
        if (json) { try { return JSON.parse(json); } catch (_) { return []; } }
        return [];
    } catch (_) { return []; }
}

async function resolvePaystackBankCode(db, secret, localBankName){
    // 1) Try static map quickly
    const direct = getPaystackBankCode(localBankName);
    if (direct) return direct;

    // 2) Try dynamic list from Paystack
    const list = await getCachedPaystackBanks(db, secret);
    if (!list || list.length === 0) return null;

    const input = String(localBankName || '');
    const inputNorm = normalizeBankName(input);

    // a) exact (case-insensitive)
    const exact = list.find(b => String(b.name || '').toLowerCase().trim() === input.toLowerCase().trim());
    if (exact) return String(exact.code);

    // b) normalized strict equality
    const exactNorm = list.find(b => normalizeBankName(b.name) === inputNorm);
    if (exactNorm) return String(exactNorm.code);

    // c) includes either way (normalized)
    const incl = list.find(b => {
        const bn = normalizeBankName(b.name);
        return bn.includes(inputNorm) || inputNorm.includes(bn);
    });
    if (incl) return String(incl.code);

    // d) give up
    return null;
}

async function getPaystackConfig(db){
    return {
        enabled: (await getConfig(db, 'paystackAuto', 'false')) === 'true',
        secret: await getConfig(db, 'paystackSecret', '')
    };
}

// Admin auth helpers
function getAdminId(req) {
    try {
        const hdr = req.headers['x-admin-id'];
        const b = req.body || {};
        const q = req.query || {};
        const val = hdr || b.user_id || q.user_id || '';
        return String(val).trim();
    } catch (_) { return ''; }
}

function isAdmin(req) {
    return getAdminId(req) === String(process.env.ADMIN_USER_ID || '');
}

// Resolve required chats to identifiers acceptable by Telegram API (numeric id or @username)
async function getRequiredChats(db) {
    const requiredChannelId = await getConfig(db, 'requiredChannelId', null);
    const requiredChannel = await getConfig(db, 'requiredChannel', null);
    const requiredGroupId = await getConfig(db, 'requiredGroupId', null);
    const requiredGroup = await getConfig(db, 'requiredGroup', null);
    const channelIdentifier = requiredChannelId || requiredChannel || null;
    const groupIdentifier = requiredGroupId || requiredGroup || null;
    return { channelIdentifier, groupIdentifier };
}

// Finalize any due social claims for a user
async function finalizeDueSocialClaims(db, userId){
    const dueClaims = await db.all(`
        SELECT * FROM user_social_claims 
        WHERE user_id = ? AND status = 'pending' AND datetime('now') >= available_at
    `, [userId]);
    if (!dueClaims || dueClaims.length === 0) return;
    for (const claim of dueClaims) {
        await db.transaction(async (tx) => {
            await tx.run(`
                UPDATE users 
                SET points = points + ?, total_points_earned = total_points_earned + ?, updated_at = datetime('now')
                WHERE id = ?
            `, [claim.points_earned, claim.points_earned, userId]);
            await tx.run(`
                UPDATE user_social_claims SET status = 'completed', completed_at = datetime('now')
                WHERE id = ? AND status = 'pending'
            `, [claim.id]);
            // log to claims_history for earnings history UI
            const userRow = await tx.get('SELECT telegram_id FROM users WHERE id = ?', [userId]);
            if (userRow && userRow.telegram_id) {
                await tx.run(`INSERT INTO claims_history (telegram_id, points_earned, claimed_at) VALUES (?, ?, datetime('now'))`, [userRow.telegram_id, claim.points_earned]);
            }
            // increment daily limits
            try { await userService.updateDailyLimit(tx, userId, claim.points_earned); } catch(_) {}
        });
    }
}


// API Routes

// Get user data
app.get('/api/user/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        let user = await userService.getUserByTelegramId(req.db, parseInt(telegramId));
        // Fallback: if user doesn't exist yet, auto-create so webapp can load without /start
        if (!user) {
            try {
                await userService.getOrCreateUser(req.db, {
                    telegram_id: parseInt(telegramId),
                    username: null,
                    first_name: null,
                    last_name: null
                });
                user = await userService.getUserByTelegramId(req.db, parseInt(telegramId));
            } catch (e) { /* ignore and return 404 below */ }
        }
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const stats = await userService.getUserStats(req.db, user.id);
        const taskStats = await taskService.getTaskStatistics(req.db, user.id);
        
        res.json({
            id: user.id,
            telegram_id: user.telegram_id,
            username: user.username,
            first_name: user.first_name,
            last_name: user.last_name,
            points: user.points,
            total_points_earned: user.total_points_earned,
            tasks_completed: user.tasks_completed,
            friends_invited: user.friends_invited,
            created_at: user.created_at,
            stats,
            taskStats
        });
    } catch (error) {
        console.error('Error getting user data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Debug: show DB file path and table counts (protect behind admin)
app.get('/api/_debug/db', async (req, res) => {
    try {
        if (!isAdmin(req)) return res.status(403).json({ error: 'Access denied' });
        const info = {
            sqlitePath: (req.db && req.db.dbPath) || null
        };
        // counts
        const tables = ['users','channels','groups','user_channel_joins','user_group_joins','claims_history','withdrawals','bank_details','admin_config','broadcast_jobs','broadcast_results','social_tasks','user_social_claims'];
        const counts = {};
        for (const t of tables) {
            try {
                const row = await req.db.get(`SELECT COUNT(*) AS c FROM ${t}`);
                counts[t] = row ? row.c : 0;
            } catch (_) { counts[t] = null; }
        }
        res.json({ ok: true, ...info, counts });
    } catch (e) {
        res.status(500).json({ error: 'debug failed' });
    }
});

// Sync Telegram profile from Web App (ensures username/first_name/last_name are populated)
app.post('/api/user/sync', async (req, res) => {
    try {
        const b = req.body || {};
        const telegramId = parseInt(b.telegramId);
        if (!Number.isFinite(telegramId)) return res.status(400).json({ error: 'Invalid telegramId' });
        const username = b.username || null;
        const firstName = b.first_name || null;
        const lastName = b.last_name || null;

        let user = await userService.getUserByTelegramId(req.db, telegramId);
        if (!user) {
            await userService.getOrCreateUser(req.db, {
                telegram_id: telegramId,
                username,
                first_name: firstName,
                last_name: lastName
            });
        } else {
            await req.db.run(
                `UPDATE users SET username = ?, first_name = ?, last_name = ?, updated_at = datetime('now') WHERE telegram_id = ?`,
                [username, firstName, lastName, telegramId]
            );
        }
        user = await userService.getUserByTelegramId(req.db, telegramId);
        return res.json({ success: true, user });
    } catch (e) {
        console.error('Error syncing user profile:', e);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin: adjust user balance
app.post('/api/admin/users/adjust-balance', async (req, res) => {
    try {
        const { targetTelegramId, amount, reason } = req.body;
        if (!isAdmin(req)) return res.status(403).json({ error: 'Access denied' });
        const target = await userService.getUserByTelegramId(req.db, parseInt(targetTelegramId));
        if (!target) return res.status(404).json({ error: 'User not found' });
        const delta = parseInt(amount);
        if (!Number.isFinite(delta) || delta === 0) return res.status(400).json({ error: 'Invalid amount' });
        await req.db.transaction(async (db) => {
            if (delta > 0) {
                await db.run(`UPDATE users SET points = points + ?, total_points_earned = total_points_earned + ?, updated_at = datetime('now') WHERE id = ?`, [delta, delta, target.id]);
                // Log to claims_history as Admin Credit for history page
                await db.run(`INSERT INTO claims_history (telegram_id, points_earned, claimed_at) VALUES (?, ?, datetime('now'))`, [target.telegram_id, delta]);
            } else {
                await db.run(`UPDATE users SET points = CASE WHEN points + ? < 0 THEN 0 ELSE points + ? END, updated_at = datetime('now') WHERE id = ?`, [delta, delta, target.id]);
            }
            await db.run(`INSERT INTO admin_audit (admin_telegram_id, target_telegram_id, action, amount, reason) VALUES (?, ?, 'adjust_balance', ?, ?)`, [parseInt(getAdminId(req)), target.telegram_id, delta, reason || null]);
        });
        res.json({ success: true });
    } catch (err) {
        console.error('Error adjusting balance:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

async function sendTelegramMessage(chatId, text) {
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) return;
    try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text })
        });
    } catch (_) {}
}
// Legacy gateway callback removed; Paystack transfer status will be handled separately.

// Admin: ban/unban user
app.post('/api/admin/users/ban', async (req, res) => {
    try {
        const { targetTelegramId, ban } = req.body;
        if (!isAdmin(req)) return res.status(403).json({ error: 'Access denied' });
        const target = await userService.getUserByTelegramId(req.db, parseInt(targetTelegramId));
        if (!target) return res.status(404).json({ error: 'User not found' });
        const flag = ban ? 1 : 0;
        await req.db.run(`UPDATE users SET is_banned = ?, updated_at = datetime('now') WHERE id = ?`, [flag, target.id]);
        await req.db.run(`INSERT INTO admin_audit (admin_telegram_id, target_telegram_id, action) VALUES (?, ?, ?)`, [parseInt(getAdminId(req)), target.telegram_id, flag ? 'ban' : 'unban']);
        res.json({ success: true });
    } catch (err) {
        console.error('Error banning user:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get available tasks
app.get('/api/tasks/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        const user = await userService.getUserByTelegramId(req.db, parseInt(telegramId));
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const availableTasks = await taskService.getAvailableTasks(req.db, user.id);
        await finalizeDueSocialClaims(req.db, user.id);

        // Finalize any pending social claims that are now available
        const dueClaims = await req.db.all(`
            SELECT * FROM user_social_claims 
            WHERE user_id = ? AND status = 'pending' AND datetime('now') >= available_at
        `, [user.id]);
        if (dueClaims && dueClaims.length > 0) {
            for (const claim of dueClaims) {
                await req.db.transaction(async (db) => {
                    await db.run(`
                        UPDATE users SET points = points + ?, total_points_earned = total_points_earned + ?, updated_at = datetime('now')
                        WHERE id = ?
                    `, [claim.points_earned, claim.points_earned, user.id]);
                    await db.run(`
                        UPDATE user_social_claims SET status = 'completed', completed_at = datetime('now')
                        WHERE id = ? AND status = 'pending'
                    `, [claim.id]);
                });
            }
        }
        const dailyLimit = await userService.checkDailyLimit(req.db, user.id);

        // Normalize links and only include active items
        const normalizeChannel = (c) => ({
            ...c,
            channel_link: c.channel_username ? `https://t.me/${c.channel_username}` : c.channel_link
        });
        const normalizeGroup = (g) => ({
            ...g,
            group_link: g.group_username ? `https://t.me/${g.group_username}` : g.group_link
        });

        const channels = (availableTasks.channels || [])
            .filter(c => c.is_active === 1 || c.is_active === true || c.is_active === undefined)
            .map(normalizeChannel)
            .filter(c => c.channel_link && c.channel_link.startsWith('https://t.me/'))
            .sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
        const groups = (availableTasks.groups || [])
            .filter(g => g.is_active === 1 || g.is_active === true || g.is_active === undefined)
            .map(normalizeGroup)
            .filter(g => g.group_link && g.group_link.startsWith('https://t.me/'))
            .sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
        
        // Social tasks (facebook/whatsapp)
        const socialRaw = await req.db.all(`SELECT * FROM social_tasks WHERE is_active = 1 ORDER BY created_at ASC`);
        const claimedSocial = await req.db.all('SELECT * FROM user_social_claims WHERE user_id = ?', [user.id]);
        const taskIdToClaim = new Map((claimedSocial || []).map(r => [r.social_task_id, r]));
        const decorate = (t) => {
            const claim = taskIdToClaim.get(t.id);
            return {
                ...t,
                claim_status: claim ? claim.status : null,
                available_at: claim ? claim.available_at : null
            };
        };
        const facebook = socialRaw.filter(r => r.platform === 'facebook')
                                   .map(decorate)
                                   .filter(t => t.claim_status !== 'completed');
        const whatsapp = socialRaw.filter(r => r.platform === 'whatsapp')
                                   .map(decorate)
                                   .filter(t => t.claim_status !== 'completed');
        const tiktok = socialRaw.filter(r => r.platform === 'tiktok')
                                 .map(decorate)
                                 .filter(t => t.claim_status !== 'completed');
        const website = socialRaw.filter(r => r.platform === 'website')
                                  .map(decorate)
                                  .filter(t => t.claim_status !== 'completed');

        res.json({
            channels,
            groups,
            facebook,
            whatsapp,
            tiktok,
            website,
            dailyLimit,
            pointsPerFriend: parseInt(process.env.POINTS_PER_FRIEND_INVITE) || 25
        });
    } catch (error) {
        console.error('Error getting tasks:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get leaderboard
app.get('/api/leaderboard', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const leaderboard = await userService.getLeaderboard(req.db, limit);
        
        res.json({ leaderboard });
    } catch (error) {
        console.error('Error getting leaderboard:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Complete channel join
app.post('/api/complete-channel-join', async (req, res) => {
    try {
        const { telegramId, channelId } = req.body;
        const user = await userService.getUserByTelegramId(req.db, parseInt(telegramId));
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const channel = await taskService.getChannelById(req.db, channelId);
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }

        // Check if already joined
        const existingJoin = await taskService.getUserChannelJoin(req.db, user.id, channelId);
        if (existingJoin) {
            return res.status(400).json({ error: 'Already joined this channel' });
        }

        // Check daily limit
        const dailyLimit = await userService.checkDailyLimit(req.db, user.id);
        if (!dailyLimit.can_complete) {
            return res.status(400).json({ error: 'Daily task limit reached' });
        }

        await taskService.completeChannelJoin(req.db, user.id, channelId, channel.points_reward);
        
        const updatedUser = await userService.getUserById(req.db, user.id);
        
        res.json({
            success: true,
            pointsEarned: channel.points_reward,
            user: updatedUser
        });
    } catch (error) {
        console.error('Error completing channel join:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Complete group join
app.post('/api/complete-group-join', async (req, res) => {
    try {
        const { telegramId, groupId } = req.body;
        const user = await userService.getUserByTelegramId(req.db, parseInt(telegramId));
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const group = await taskService.getGroupById(req.db, groupId);
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
        }

        // Check if already joined
        const existingJoin = await taskService.getUserGroupJoin(req.db, user.id, groupId);
        if (existingJoin) {
            return res.status(400).json({ error: 'Already joined this group' });
        }

        // Check daily limit
        const dailyLimit = await userService.checkDailyLimit(req.db, user.id);
        if (!dailyLimit.can_complete) {
            return res.status(400).json({ error: 'Daily task limit reached' });
        }

        await taskService.completeGroupJoin(req.db, user.id, groupId, group.points_reward);
        
        const updatedUser = await userService.getUserById(req.db, user.id);
        
        res.json({
            success: true,
            pointsEarned: group.points_reward,
            user: updatedUser
        });
    } catch (error) {
        console.error('Error completing group join:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Complete daily login
app.post('/api/complete-daily-login', async (req, res) => {
    try {
        const { telegramId } = req.body;
        const user = await userService.getUserByTelegramId(req.db, parseInt(telegramId));
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const result = await taskService.completeDailyLogin(req.db, user.id);
        
        if (!result.success) {
            return res.status(400).json({ error: result.message });
        }

        const updatedUser = await userService.getUserById(req.db, user.id);
        
        res.json({
            success: true,
            pointsEarned: result.points,
            user: updatedUser
        });
    } catch (error) {
        console.error('Error completing daily login:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get user task history
app.get('/api/task-history/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        const limit = parseInt(req.query.limit) || 20;
        const user = await userService.getUserByTelegramId(req.db, parseInt(telegramId));
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const taskHistory = await taskService.getUserTaskHistory(req.db, user.id, limit);
        
        res.json({ taskHistory });
    } catch (error) {
        console.error('Error getting task history:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin routes
app.get('/api/admin/stats', async (req, res) => {
    try {
        if (!isAdmin(req)) return res.status(403).json({ error: 'Access denied' });

        const stats = await userService.getBotStats(req.db);
        const channels = await taskService.getAllChannels(req.db);
        const groups = await taskService.getAllGroups(req.db);
        
        res.json({ stats, channels, groups });
    } catch (error) {
        console.error('Error getting admin stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Helper to resolve chat_id from username or numeric id
async function resolveChatId(identifier) {
    try {
        if (!identifier) return null;
        // If numeric-like, return as number
        if (/^-?\d+$/.test(identifier)) {
            return parseInt(identifier, 10);
        }
        // Ensure starts with @ for username
        const chatIdParam = identifier.startsWith('@') ? identifier : `@${identifier}`;
        const botToken = process.env.BOT_TOKEN;
        const resp = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(chatIdParam)}`);
        const data = await resp.json();
        if (data.ok && data.result && data.result.id) {
            return data.result.id;
        }
        return null;
    } catch (e) {
        console.error('resolveChatId failed:', e);
        return null;
    }
}

// Add channel (admin)
app.post('/api/admin/channels', async (req, res) => {
    try {
        // Accept both legacy and new field names
        const body = req.body || {};
        const user_id = body.user_id;
        const channel_name = body.channel_name || body.channelName;
        const rawIdentifier = body.channel_username || body.channelUsername || body.channel_id;
        const points_reward = parseInt(body.points_reward || body.pointsReward, 10);
        const channel_description = body.description || null;

        if (!isAdmin(req)) return res.status(403).json({ error: 'Access denied' });

        if (!channel_name || !rawIdentifier || !Number.isFinite(points_reward)) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const chatId = await resolveChatId(rawIdentifier);
        if (!chatId) {
            return res.status(400).json({ error: 'Invalid channel username/ID' });
        }

        await req.db.run(`
            INSERT INTO channels (channel_id, channel_name, channel_username, points_reward, is_active, created_at, description)
            VALUES (?, ?, ?, ?, 1, datetime('now'), ?)
        `, [chatId, channel_name, String(rawIdentifier).replace(/^@/, ''), points_reward, channel_description]);
        // Alert users of new telegram task
        try {
            const rows = await req.db.all('SELECT telegram_id FROM users');
            const msg = `🆕 New channel task: ${channel_name} (+${points_reward} pts). Check Tasks now!`;
            for (const r of rows) await sendTelegramMessage(r.telegram_id, msg);
        } catch (_) {}
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error adding channel:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Add group (admin)
app.post('/api/admin/groups', async (req, res) => {
    try {
        const body = req.body || {};
        const user_id = body.user_id;
        const group_name = body.group_name || body.groupName;
        const rawIdentifier = body.group_username || body.groupUsername || body.group_id;
        const points_reward = parseInt(body.points_reward || body.pointsReward, 10);
        const group_description = body.description || null;

        if (!isAdmin(req)) return res.status(403).json({ error: 'Access denied' });

        if (!group_name || !rawIdentifier || !Number.isFinite(points_reward)) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const chatId = await resolveChatId(rawIdentifier);
        if (!chatId) {
            return res.status(400).json({ error: 'Invalid group username/ID' });
        }

        await req.db.run(`
            INSERT INTO groups (group_id, group_name, group_username, points_reward, is_active, created_at, description)
            VALUES (?, ?, ?, ?, 1, datetime('now'), ?)
        `, [chatId, group_name, String(rawIdentifier).replace(/^@/, ''), points_reward, group_description]);
        try {
            const rows = await req.db.all('SELECT telegram_id FROM users');
            const msg = `🆕 New group task: ${group_name} (+${points_reward} pts). Check Tasks now!`;
            for (const r of rows) await sendTelegramMessage(r.telegram_id, msg);
        } catch (_) {}
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error adding group:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Serve the main web app
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

// Serve the web app at /webapp route
app.get('/webapp', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'layout.html'));
});

// Add routes for all pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'layout.html'));
});

app.get('/home', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'layout.html'));
});

app.get('/tasks', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'layout.html'));
});

app.get('/earn', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'layout.html'));
});

app.get('/history', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'layout.html'));
});

app.get('/profile', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'layout.html'));
});

app.get('/withdraw', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'layout.html'));
});

app.get('/bank', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'layout.html'));
});

app.get('/advertise', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'layout.html'));
});

app.get('/about', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'layout.html'));
});

app.get('/faq', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'layout.html'));
});

app.get('/invite', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'layout.html'));
});

app.get('/team', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'layout.html'));
});
app.get('/privacy', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'layout.html'));
});
app.get('/community', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'layout.html'));
});

// Serve admin panel
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'admin.html'));
});

// Admin API endpoints
app.get('/api/admin/check/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        const adminUserId = process.env.ADMIN_USER_ID;
        
        res.json({
            isAdmin: telegramId === adminUserId
        });
    } catch (error) {
        console.error('Error checking admin status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/admin/dashboard', async (req, res) => {
    try {
        // Get total users
        const totalUsers = await req.db.get('SELECT COUNT(*) as count FROM users');
        
        // Active users = distinct telegram_id that did any action today across joins or claims
        const activeUsers = await req.db.get(`
            SELECT COUNT(*) as count FROM (
                SELECT DISTINCT u.telegram_id AS tid
                FROM user_channel_joins uc
                JOIN users u ON u.id = uc.user_id
                WHERE DATE(uc.joined_at) = DATE('now')
                UNION
                SELECT DISTINCT u.telegram_id AS tid
                FROM user_group_joins ug
                JOIN users u ON u.id = ug.user_id
                WHERE DATE(ug.joined_at) = DATE('now')
                UNION
                SELECT DISTINCT telegram_id AS tid
                FROM claims_history ch
                WHERE DATE(ch.claimed_at) = DATE('now')
            ) t
        `);
        
        // Get total points
        const totalPoints = await req.db.get('SELECT COALESCE(SUM(points),0) as total FROM users');
        
        // Get pending withdrawals
        const pendingWithdrawals = await req.db.get(`
            SELECT COUNT(*) as count 
            FROM withdrawals 
            WHERE status = 'pending'
        `);
        
        // Recent activity: last 10 across channels, groups, claims
        const recentActivity = await req.db.all(`
            SELECT action, timestamp FROM (
                SELECT 'Channel Join' as action, joined_at as timestamp FROM user_channel_joins
                UNION ALL
                SELECT 'Group Join' as action, joined_at as timestamp FROM user_group_joins
                UNION ALL
                SELECT 'Daily Claim' as action, claimed_at as timestamp FROM claims_history
            )
            ORDER BY timestamp DESC
            LIMIT 10
        `);
        
        res.json({
            totalUsers: totalUsers.count || 0,
            activeUsers: activeUsers.count || 0,
            totalPoints: totalPoints.total || 0,
            pendingWithdrawals: pendingWithdrawals.count || 0,
            recentActivity
        });
    } catch (error) {
        console.error('Error loading dashboard:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/admin/config', async (req, res) => {
    try {
        const response = {
            pointsConfig: {
                channelJoinPoints: await getIntConfig(req.db, 'channelJoinPoints', parseInt(process.env.POINTS_PER_CHANNEL_JOIN) || 10),
                groupJoinPoints: await getIntConfig(req.db, 'groupJoinPoints', parseInt(process.env.POINTS_PER_GROUP_JOIN) || 15),
                friendInvitePoints: await getIntConfig(req.db, 'friendInvitePoints', parseInt(process.env.POINTS_PER_FRIEND_INVITE) || 25),
                dailyTaskLimit: await getIntConfig(req.db, 'dailyTaskLimit', parseInt(process.env.DAILY_TASK_LIMIT) || 5)
            },
            withdrawalConfig: {
                minWithdrawal: await getIntConfig(req.db, 'minWithdrawal', parseInt(process.env.MIN_WITHDRAWAL_AMOUNT) || 1000),
                maxWithdrawal: await getIntConfig(req.db, 'maxWithdrawal', parseInt(process.env.MAX_WITHDRAWAL_AMOUNT) || 50000),
                withdrawalFee: parseFloat(await getConfig(req.db, 'withdrawalFee', process.env.WITHDRAWAL_FEE_PERCENTAGE || 5)),
                bankEditFee: await getIntConfig(req.db, 'bankEditFee', parseInt(process.env.BANK_EDIT_FEE) || 3000),
                currencySymbol: await getConfig(req.db, 'currencySymbol', process.env.CURRENCY_SYMBOL || '₦'),
                pointToCurrencyRate: parseFloat(await getConfig(req.db, 'pointToCurrencyRate', process.env.POINT_TO_CURRENCY_RATE || 1)),
                withdrawalsEnabled: (await getConfig(req.db, 'withdrawalsEnabled', 'true')) !== 'false',
                minReferralsForWithdraw: await getIntConfig(req.db, 'minReferralsForWithdraw', 10)
            },
            claimsConfig: {
                dailyClaimsLimit: await getIntConfig(req.db, 'dailyClaimsLimit', parseInt(process.env.DAILY_CLAIMS_LIMIT) || 5),
                minClaimAmount: await getIntConfig(req.db, 'minClaimAmount', parseInt(process.env.MIN_CLAIM_AMOUNT) || 50),
                maxClaimAmount: await getIntConfig(req.db, 'maxClaimAmount', parseInt(process.env.MAX_CLAIM_AMOUNT) || 500),
                bonusClaimsPerFriends: await getIntConfig(req.db, 'bonusClaimsPerFriends', parseInt(process.env.BONUS_CLAIMS_PER_FRIENDS) || 2),
                friendsRequiredForBonus: await getIntConfig(req.db, 'friendsRequiredForBonus', parseInt(process.env.FRIENDS_REQUIRED_FOR_BONUS) || 10)
            },
            supportConfig: {
                supportUsername: await getConfig(req.db, 'adminUsername', process.env.ADMIN_USERNAME || 'TGTaskSupport'),
                supportAdmins: [
                    {
                        label: 'Admin 1',
                        username: await getConfig(req.db, 'supportAdmin1', '') || '' ,
                        description: await getConfig(req.db, 'supportAdmin1Desc', '') || ''
                    },
                    {
                        label: 'Admin 2',
                        username: await getConfig(req.db, 'supportAdmin2', '') || '',
                        description: await getConfig(req.db, 'supportAdmin2Desc', '') || ''
                    },
                    {
                        label: 'Admin 3',
                        username: await getConfig(req.db, 'supportAdmin3', '') || '',
                        description: await getConfig(req.db, 'supportAdmin3Desc', '') || ''
                    },
                    {
                        label: 'Admin 4',
                        username: await getConfig(req.db, 'supportAdmin4', '') || '',
                        description: await getConfig(req.db, 'supportAdmin4Desc', '') || ''
                    },
                    {
                        label: 'Admin 5',
                        username: await getConfig(req.db, 'supportAdmin5', '') || '',
                        description: await getConfig(req.db, 'supportAdmin5Desc', '') || ''
                    }
                ]
            },
            appConfig: {
                appName: await getConfig(req.db, 'appName', process.env.APP_NAME || 'TGTask')
            },
            paystackConfig: {
                enabled: (await getConfig(req.db, 'paystackAuto', 'false')) === 'true',
                secret: await getConfig(req.db, 'paystackSecret', '')
            },
            monetagConfig: await getMonetagConfig(req.db)
        };
        res.json(response);
    } catch (error) {
        console.error('Error loading config:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin: onboarding mandatory join configuration
app.get('/api/admin/onboarding-config', async (req, res) => {
    try {
        if (!isAdmin(req)) return res.status(403).json({ error: 'Access denied' });
        const requiredChannel = await getConfig(req.db, 'requiredChannel', null);
        const requiredChannelId = await getConfig(req.db, 'requiredChannelId', null);
        const requiredGroup = await getConfig(req.db, 'requiredGroup', null);
        const requiredGroupId = await getConfig(req.db, 'requiredGroupId', null);
        const onboardingWelcome = await getConfig(req.db, 'onboardingWelcome', 'Join our official community and sponsor group to continue.');
        res.json({ requiredChannel, requiredChannelId, requiredGroup, requiredGroupId, onboardingWelcome });
    } catch (e) {
        console.error('Error loading onboarding config:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/onboarding-config', async (req, res) => {
    try {
        if (!isAdmin(req)) return res.status(403).json({ error: 'Access denied' });
        const { requiredChannel, requiredGroup, onboardingWelcome } = req.body || {};
        let channelId = null, groupId = null;
        if (requiredChannel) channelId = await resolveChatId(requiredChannel);
        if (requiredGroup) groupId = await resolveChatId(requiredGroup);
        await setConfig(req.db, {
            requiredChannel: requiredChannel || '',
            requiredChannelId: channelId != null ? String(channelId) : '',
            requiredGroup: requiredGroup || '',
            requiredGroupId: groupId != null ? String(groupId) : '',
            onboardingWelcome: onboardingWelcome || ''
        });
        res.json({ success: true, requiredChannelId: channelId, requiredGroupId: groupId });
    } catch (e) {
        console.error('Error saving onboarding config:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Public: read-only onboarding config for clients
app.get('/api/onboarding-config', async (req, res) => {
    try {
        const requiredChannel = await getConfig(req.db, 'requiredChannel', null);
        const requiredChannelId = await getConfig(req.db, 'requiredChannelId', null);
        const requiredGroup = await getConfig(req.db, 'requiredGroup', null);
        const requiredGroupId = await getConfig(req.db, 'requiredGroupId', null);
        const onboardingWelcome = await getConfig(req.db, 'onboardingWelcome', 'Join our official community and sponsor group to continue.');
        res.json({ requiredChannel, requiredChannelId, requiredGroup, requiredGroupId, onboardingWelcome });
    } catch (e) {
        console.error('Error loading onboarding config (public):', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/config/points', async (req, res) => {
    try {
        const { channelJoinPoints, groupJoinPoints, friendInvitePoints, dailyTaskLimit } = req.body;
        await setConfig(req.db, {
            channelJoinPoints,
            groupJoinPoints,
            friendInvitePoints,
            dailyTaskLimit
        });
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating points config:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/config/withdrawal', async (req, res) => {
    try {
        const { minWithdrawal, maxWithdrawal, withdrawalFee, bankEditFee, currencySymbol, pointToCurrencyRate, withdrawalsEnabled, minReferralsForWithdraw } = req.body;
        await setConfig(req.db, { minWithdrawal, maxWithdrawal, withdrawalFee, bankEditFee, currencySymbol, pointToCurrencyRate, withdrawalsEnabled: withdrawalsEnabled ? 'true' : 'false', minReferralsForWithdraw });
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating withdrawal config:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/config/claims', async (req, res) => {
    try {
        const { dailyClaimsLimit, minClaimAmount, maxClaimAmount, bonusClaimsPerFriends, friendsRequiredForBonus } = req.body;
        await setConfig(req.db, { dailyClaimsLimit, minClaimAmount, maxClaimAmount, bonusClaimsPerFriends, friendsRequiredForBonus });
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating claims config:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/config/support', async (req, res) => {
    try {
        const { supportUsername, admins } = req.body;
        const updates = { adminUsername: supportUsername };
        if (Array.isArray(admins)) {
            admins.slice(0,5).forEach((a, idx) => {
                const n = idx + 1;
                if (a && (a.username != null)) updates[`supportAdmin${n}`] = a.username;
                if (a && (a.description != null)) updates[`supportAdmin${n}Desc`] = a.description;
            });
        }
        await setConfig(req.db, updates);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating support config:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/config/app', async (req, res) => {
    try {
        const { appName } = req.body;
        await setConfig(req.db, { appName: appName || 'TGTask' });
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating app config:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin: payout gateway config
app.post('/api/admin/config/paystack', async (req, res) => {
    try {
        if (!isAdmin(req)) return res.status(403).json({ error: 'Access denied' });
        const { enabled, secret } = req.body || {};
        await setConfig(req.db, {
            paystackAuto: enabled ? 'true' : 'false',
            paystackSecret: secret || ''
        });
        res.json({ success: true });
    } catch (e) {
        console.error('Error saving paystack config:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin: Monetag config
app.post('/api/admin/config/monetag', async (req, res) => {
    try {
        if (!isAdmin(req)) return res.status(403).json({ error: 'Access denied' });
        const { enabled, smartlink, token, fixedRewardPoints, hourlyLimit, dailyLimit, requiredSeconds } = req.body || {};
        await setConfig(req.db, {
            monetagEnabled: enabled ? 'true' : 'false',
            monetagSmartlink: smartlink || '',
            monetagToken: token || '',
            monetagFixedRewardPoints: String(parseInt(fixedRewardPoints || 0)),
            adsHourlyLimit: String(parseInt(hourlyLimit || 20)),
            adsDailyLimit: String(parseInt(dailyLimit || 60)),
            adsRequiredSeconds: String(parseInt(requiredSeconds || 20))
        });
        res.json({ success: true });
    } catch (e) {
        console.error('Error saving monetag config:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/admin/tasks', async (req, res) => {
    try {
        const channels = await req.db.all('SELECT * FROM channels ORDER BY created_at DESC');
        const groups = await req.db.all('SELECT * FROM groups ORDER BY created_at DESC');
        
        res.json({ channels, groups });
    } catch (error) {
        console.error('Error loading tasks:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const q = (req.query && req.query.q) ? String(req.query.q).trim() : '';
        let users;
        if (q) {
            const like = `%${q}%`;
            // Search by username, first_name/last_name, or exact/partial telegram_id
            users = await req.db.all(`
                SELECT telegram_id, first_name, username, points, friends_invited, created_at
                FROM users
                WHERE (username LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR CAST(telegram_id AS TEXT) LIKE ?)
                ORDER BY points DESC
                LIMIT 200
            `, [like, like, like, like]);
        } else {
            users = await req.db.all(`
                SELECT telegram_id, first_name, username, points, friends_invited, created_at
                FROM users 
                ORDER BY points DESC 
                LIMIT 100
            `);
        }
        
        res.json({ users });
    } catch (error) {
        console.error('Error loading users:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin: user ledger (earnings history consolidated)
app.post('/api/admin/user-ledger', async (req, res) => {
    try {
        if (!isAdmin(req)) return res.status(403).json({ error: 'Access denied' });
        const targetTelegramId = parseInt((req.body && req.body.targetTelegramId) || (req.query && req.query.targetTelegramId));
        if (!targetTelegramId || !Number.isFinite(targetTelegramId)) {
            return res.status(400).json({ error: 'Provide numeric targetTelegramId' });
        }
        const user = await userService.getUserByTelegramId(req.db, targetTelegramId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const rows = await req.db.all(`
            SELECT * FROM (
                SELECT 'Channel Join' AS source, uc.points_earned AS points, uc.joined_at AS earned_at
                FROM user_channel_joins uc WHERE uc.user_id = ?
                UNION ALL
                SELECT 'Group Join' AS source, ug.points_earned AS points, ug.joined_at AS earned_at
                FROM user_group_joins ug WHERE ug.user_id = ?
                UNION ALL
                SELECT CASE WHEN ch.source = 'referral' THEN 'Invite Reward' ELSE 'Daily Reward' END AS source, ch.points_earned AS points, ch.claimed_at AS earned_at
                FROM claims_history ch WHERE ch.telegram_id = ?
                UNION ALL
                SELECT ('Social Task: ' || COALESCE(st.task_name, st.platform)) AS source, usc.points_earned AS points, usc.completed_at AS earned_at
                FROM user_social_claims usc JOIN social_tasks st ON st.id = usc.social_task_id
                WHERE usc.user_id = ? AND usc.status = 'completed'
                UNION ALL
                SELECT 'Admin Credit' AS source, aa.amount AS points, aa.created_at AS earned_at
                FROM admin_audit aa
                WHERE aa.target_telegram_id = ? AND aa.action = 'adjust_balance' AND aa.amount > 0
            ) t
            ORDER BY earned_at DESC
            LIMIT 500
        `, [user.id, user.id, targetTelegramId, user.id, targetTelegramId]);

        const total = (rows || []).reduce((sum, r) => sum + (parseInt(r.points, 10) || 0), 0);
        res.json({
            user: { id: user.id, telegram_id: user.telegram_id, username: user.username, first_name: user.first_name, last_name: user.last_name, points: user.points, total_points_earned: user.total_points_earned },
            total_points_listed: total,
            count: rows ? rows.length : 0,
            ledger: rows || []
        });
    } catch (err) {
        console.error('Error loading user ledger:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/admin/withdrawals', async (req, res) => {
    try {
        const status = (req.query && req.query.status) || 'all';
        let where = '';
        const params = [];
        if (status === 'pending' || status === 'completed' || status === 'rejected') {
            where = 'WHERE w.status = ?';
            params.push(status);
        }
        const withdrawals = await req.db.all(
            `SELECT w.*, u.first_name as user_name, b.account_name, b.account_number, b.bank_name
             FROM withdrawals w
             LEFT JOIN users u ON w.telegram_id = u.telegram_id
             LEFT JOIN bank_details b ON w.telegram_id = b.telegram_id
             ${where}
             ORDER BY w.created_at DESC`,
            params
        );
        
        // Format bank details
        const formattedWithdrawals = withdrawals.map(w => ({
            ...w,
            bank_details: (w.account_name || w.bank_name || w.account_number)
                ? `${w.account_name || ''} ${w.account_number ? `(${w.account_number})` : ''} - ${w.bank_name || ''}`.trim()
                : null
        }));
        
        res.json({ withdrawals: formattedWithdrawals });
    } catch (error) {
        console.error('Error loading withdrawals:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/admin/channels', async (req, res) => {
    try {
        const channels = await req.db.all('SELECT * FROM channels ORDER BY created_at DESC');
        
        res.json({ channels });
    } catch (error) {
        console.error('Error loading channels:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/admin/groups', async (req, res) => {
    try {
        const groups = await req.db.all('SELECT * FROM groups ORDER BY created_at DESC');
        
        res.json({ groups });
    } catch (error) {
        console.error('Error loading groups:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Social tasks admin endpoints
app.get('/api/admin/social-tasks', async (req, res) => {
    try {
        const tasks = await req.db.all('SELECT * FROM social_tasks ORDER BY created_at DESC');
        res.json({ tasks });
    } catch (err) {
        console.error('Error loading social tasks:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/social-tasks', async (req, res) => {
    try {
        const { platform, taskName, taskLink, pointsReward, description } = req.body;
        if (!platform || !taskName || !taskLink) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        await req.db.run(`
            INSERT INTO social_tasks (platform, task_name, task_link, points_reward, is_active, created_at, description)
            VALUES (?, ?, ?, ?, 1, datetime('now'), ?)
        `, [platform, taskName, taskLink, parseInt(pointsReward) || 10, description || null]);
        // Broadcast a new task alert to users (best-effort)
        try {
            const rows = await req.db.all('SELECT telegram_id FROM users');
            const msg = `🆕 New ${platform} task: ${taskName} (+${pointsReward || 10} pts). Check Tasks now!`;
            for (const r of rows) {
                await sendTelegramMessage(r.telegram_id, msg);
            }
        } catch (_) {}
        res.json({ success: true });
    } catch (err) {
        console.error('Error adding social task:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/social-tasks/:id/toggle', async (req, res) => {
    try {
        const { id } = req.params;
        const row = await req.db.get('SELECT is_active FROM social_tasks WHERE id = ?', [id]);
        if (!row) return res.status(404).json({ error: 'Not found' });
        await req.db.run('UPDATE social_tasks SET is_active = ? WHERE id = ?', [row.is_active ? 0 : 1, id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Error toggling social task:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/admin/social-tasks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // Soft-delete to avoid FK constraints
        await req.db.run('UPDATE social_tasks SET is_active = 0 WHERE id = ?', [id]);
        res.json({ success: true, softDeleted: true });
    } catch (err) {
        console.error('Error deleting social task:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// removed duplicate add routes (handled earlier with chat_id resolution)

app.post('/api/admin/channels/:id/toggle', async (req, res) => {
    try {
        if (!isAdmin(req)) return res.status(403).json({ error: 'Access denied' });
        const { id } = req.params;
        
        await req.db.run(`
            UPDATE channels 
            SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END
            WHERE id = ?
        `, [id]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error toggling channel status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/groups/:id/toggle', async (req, res) => {
    try {
        if (!isAdmin(req)) return res.status(403).json({ error: 'Access denied' });
        const { id } = req.params;
        
        await req.db.run(`
            UPDATE groups 
            SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END
            WHERE id = ?
        `, [id]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error toggling group status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/admin/channels/:id', async (req, res) => {
    try {
        if (!isAdmin(req)) return res.status(403).json({ error: 'Access denied' });
        const { id } = req.params;
        
        // Soft delete to avoid FK issues similar to social tasks
        await req.db.run('UPDATE channels SET is_active = 0 WHERE id = ?', [id]);
        
        res.json({ success: true, softDeleted: true });
    } catch (error) {
        console.error('Error deleting channel:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/admin/groups/:id', async (req, res) => {
    try {
        if (!isAdmin(req)) return res.status(403).json({ error: 'Access denied' });
        const { id } = req.params;
        
        await req.db.run('UPDATE groups SET is_active = 0 WHERE id = ?', [id]);
        
        res.json({ success: true, softDeleted: true });
    } catch (error) {
        console.error('Error deleting group:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/withdrawals/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        // Optional mode override: 'auto' | 'manual'
        const mode = String((req.query && req.query.mode) || (req.body && req.body.mode) || 'auto').toLowerCase();
        // Load withdrawal and bank details
        const w = await req.db.get('SELECT * FROM withdrawals WHERE id = ?', [id]);
        if (!w) return res.status(404).json({ error: 'Withdrawal not found' });
        const bank = await req.db.get('SELECT * FROM bank_details WHERE telegram_id = ?', [w.telegram_id]);
        if (!bank) return res.status(400).json({ error: 'No bank details' });

        // Check Paystack config
        const cfg = await getPaystackConfig(req.db);
        const autoEnabled = cfg.enabled && cfg.secret;

        if (!autoEnabled || mode === 'manual') {
            // Fallback: just mark as completed
            await req.db.run(`UPDATE withdrawals SET status='completed', processed_at = datetime('now') WHERE id = ?`, [id]);
            if (w.telegram_id) await sendTelegramMessage(w.telegram_id, `✅ Your withdrawal of ${w.receivable_points || w.amount} points has been approved.`);
            return res.json({ success: true, autoPayout: false, mode: 'manual' });
        }

        // Paystack: create transfer recipient (resolve bank code dynamically)
        const bankCode = await resolvePaystackBankCode(req.db, cfg.secret, bank.bank_name);
        if (!bankCode) return res.status(400).json({ error: 'Unsupported bank code' });
        const calcAmount = (w.receivable_currency_amount != null ? Number(w.receivable_currency_amount) : Number((w.amount || 0)));
        const amountKobo = Math.round(calcAmount * 100);
        if (!Number.isFinite(calcAmount) || calcAmount <= 0 || !Number.isFinite(amountKobo) || amountKobo <= 0) {
            const rate = parseFloat(await getConfig(req.db, 'pointToCurrencyRate', process.env.POINT_TO_CURRENCY_RATE || 1));
            return res.status(400).json({ error: 'Invalid payout amount', details: { receivable_currency_amount: w.receivable_currency_amount, points_amount: w.amount, pointToCurrencyRate: rate } });
        }
        const reference = `WD${w.id}-${Date.now()}`;

        const recip = await fetch('https://api.paystack.co/transferrecipient', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.secret}` },
            body: JSON.stringify({ type: 'nuban', name: bank.account_name, account_number: bank.account_number, bank_code: bankCode, currency: 'NGN' })
        , signal: AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined }).then(r=>r.json()).catch((e)=>{ console.error('Paystack recipient error:', e); return null; });
        if (!recip) {
            return res.status(502).json({ error: 'Failed to reach Paystack for recipient' });
        }
        let recipientCode = recip && recip.data && recip.data.recipient_code ? String(recip.data.recipient_code) : null;
        if (!recip.status && !recipientCode) {
            return res.status(400).json({ error: 'Paystack recipient error', details: recip });
        }

        const tr = await fetch('https://api.paystack.co/transfer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.secret}` },
            body: JSON.stringify({ source: 'balance', amount: amountKobo, recipient: recipientCode, reason: 'Withdrawal', reference })
        , signal: AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined }).then(r=>r.json()).catch((e)=>{ console.error('Paystack transfer error:', e); return null; });
        if (!tr) {
            return res.status(502).json({ error: 'Failed to reach Paystack for transfer' });
        }
        if (!tr.status) {
            return res.status(400).json({ error: 'Paystack transfer error', details: tr });
        }

        await req.db.run(`UPDATE withdrawals SET provider='paystack', provider_order_id = ?, provider_trade_no = ?, provider_result = ?, processed_at = datetime('now'), status = 'pending' WHERE id = ?`, [reference, tr.data && tr.data.transfer_code ? String(tr.data.transfer_code) : null, JSON.stringify(tr), id]);

        if (w.telegram_id) await sendTelegramMessage(w.telegram_id, `✅ Your withdrawal is being processed. Ref: ${reference}`);
        res.json({ success: true, autoPayout: true, provider: 'paystack', response: tr });
    } catch (error) {
        console.error('Error approving withdrawal:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/withdrawals/:id/reject', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Get withdrawal details to refund points
        const withdrawal = await req.db.get('SELECT * FROM withdrawals WHERE id = ?', [id]);
        
        if (withdrawal) {
            // Refund points to user
            const refund = withdrawal.amount || 0; // refund full points deducted at request-time
            await req.db.run(`UPDATE users SET points = points + ? WHERE telegram_id = ?`, [refund, withdrawal.telegram_id]);
            
            // Update withdrawal status
            await req.db.run(`
                UPDATE withdrawals 
                SET status = 'rejected', processed_at = datetime('now')
                WHERE id = ?
            `, [id]);
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error rejecting withdrawal:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Ads Task: overview for user
app.get('/api/ads/overview/:telegramId', async (req, res) => {
    try {
        const telegramId = parseInt(req.params.telegramId);
        if (!Number.isFinite(telegramId)) return res.status(400).json({ error: 'Invalid user' });
        await ensureAdsTables(req.db);
        const cfg = await getMonetagConfig(req.db);
        const sinceHour = await req.db.get(`SELECT COUNT(*) AS c FROM ads_earnings WHERE telegram_id = ? AND created_at >= datetime('now', '-1 hour')`, [telegramId]);
        const sinceDay = await req.db.get(`SELECT COUNT(*) AS c FROM ads_earnings WHERE telegram_id = ? AND created_at >= date('now')`, [telegramId]);
        const lifetime = await req.db.get(`SELECT COUNT(*) AS c, COALESCE(SUM(points_earned),0) AS sum FROM ads_earnings WHERE telegram_id = ?`, [telegramId]);
        res.json({
            enabled: cfg.enabled,
            hourlyCompleted: sinceHour ? sinceHour.c : 0,
            hourlyLimit: cfg.hourlyLimit,
            dailyCompleted: sinceDay ? sinceDay.c : 0,
            dailyLimit: cfg.dailyLimit,
            lifetimeCompleted: lifetime ? lifetime.c : 0,
            totalEarnings: lifetime ? lifetime.sum : 0
        });
    } catch (e) {
        console.error('ads overview error', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Ads Task: start - returns smartlink and click_id
app.post('/api/ads/start', async (req, res) => {
    try {
        const { telegramId } = req.body || {};
        const tgId = parseInt(telegramId);
        if (!Number.isFinite(tgId)) return res.status(400).json({ error: 'Invalid user' });
        await ensureAdsTables(req.db);
        const cfg = await getMonetagConfig(req.db);
        if (!cfg.enabled || !cfg.smartlink) return res.status(400).json({ error: 'Ads not available' });
        // enforce limits
        const hourCnt = await req.db.get(`SELECT COUNT(*) AS c FROM ads_earnings WHERE telegram_id = ? AND created_at >= datetime('now', '-1 hour')`, [tgId]);
        const dayCnt = await req.db.get(`SELECT COUNT(*) AS c FROM ads_earnings WHERE telegram_id = ? AND created_at >= date('now')`, [tgId]);
        if ((hourCnt?.c || 0) >= cfg.hourlyLimit) return res.status(429).json({ error: 'Hourly limit reached' });
        if ((dayCnt?.c || 0) >= cfg.dailyLimit) return res.status(429).json({ error: 'Daily limit reached' });
        const clickId = `ad_${tgId}_${Date.now()}`;
        await req.db.run(`INSERT INTO ads_clicks (telegram_id, provider, click_id) VALUES (?, 'monetag', ?)`, [tgId, clickId]);
        // Smartlink with subid for postback
        const url = new URL(cfg.smartlink);
        url.searchParams.set('sub1', String(tgId));
        url.searchParams.set('sub2', clickId);
        res.json({ success: true, smartlink: url.toString(), clickId, requiredSeconds: cfg.requiredSeconds });
    } catch (e) {
        console.error('ads start error', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Monetag S2S Postback endpoint (configure this on Monetag)
// Example: GET /api/monetag/postback?token=XXX&sub1={telegramId}&sub2={clickId}&revenue=0.05&txid=abc
app.all('/api/monetag/postback', async (req, res) => {
    try {
        await ensureAdsTables(req.db);
        const cfg = await getMonetagConfig(req.db);
        const q = req.method === 'POST' ? (req.body || {}) : (req.query || {});
        const token = String(q.token || '');
        if (!cfg.token || token !== cfg.token) return res.status(403).json({ error: 'Bad token' });
        const tgId = parseInt(q.sub1 || q.telegramId || q.uid);
        const clickId = String(q.sub2 || q.click_id || '');
        const txid = String(q.txid || q.transaction_id || q.conv || '');
        const revenue = parseFloat(q.revenue || q.payout || 0) || 0;
        if (!Number.isFinite(tgId) || !clickId) return res.status(400).json({ error: 'Missing params' });
        // Required dwell time since click
        if (cfg.requiredSeconds > 0) {
            const row = await req.db.get(`SELECT created_at FROM ads_clicks WHERE click_id = ?`, [clickId]);
            if (!row) return res.status(400).json({ error: 'Unknown clickId' });
            const clickedAt = new Date(row.created_at + 'Z').getTime();
            if (isFinite(clickedAt)) {
                const diffSec = Math.floor((Date.now() - clickedAt) / 1000);
                if (diffSec < cfg.requiredSeconds) return res.status(200).json({ ok: true, ignored: true, reason: 'dwell_time' });
            }
        }
        // Enforce per-user limits
        const hourCnt = await req.db.get(`SELECT COUNT(*) AS c FROM ads_earnings WHERE telegram_id = ? AND created_at >= datetime('now', '-1 hour')`, [tgId]);
        const dayCnt = await req.db.get(`SELECT COUNT(*) AS c FROM ads_earnings WHERE telegram_id = ? AND created_at >= date('now')`, [tgId]);
        if ((hourCnt?.c || 0) >= cfg.hourlyLimit) return res.status(200).json({ ok: true, ignored: true, reason: 'hourly_limit' });
        if ((dayCnt?.c || 0) >= cfg.dailyLimit) return res.status(200).json({ ok: true, ignored: true, reason: 'daily_limit' });
        // Determine reward points
        const points = cfg.fixedRewardPoints > 0 ? cfg.fixedRewardPoints : Math.max(1, Math.round(revenue * 100));
        await req.db.transaction(async (tx) => {
            // credit points
            const u = await tx.get('SELECT id FROM users WHERE telegram_id = ?', [tgId]);
            if (!u) throw new Error('User not found');
            await tx.run(`UPDATE users SET points = points + ?, total_points_earned = total_points_earned + ?, updated_at = datetime('now') WHERE id = ?`, [points, points, u.id]);
            await tx.run(`INSERT INTO ads_earnings (telegram_id, provider, provider_txid, click_id, points_earned, revenue_amount) VALUES (?, 'monetag', ?, ?, ?, ?)`, [tgId, txid || null, clickId || null, points, revenue || null]);
            // log for earnings history UI as generic earnings
            await tx.run(`INSERT INTO claims_history (telegram_id, points_earned, claimed_at) VALUES (?, ?, datetime('now'))`, [tgId, points]);
        });
        try { await sendTelegramMessage(tgId, `🎯 Ads task completed. You earned +${points} points.`); } catch(_) {}
        res.json({ ok: true, credited: points });
    } catch (e) {
        console.error('monetag postback error', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Bot verification endpoints
app.post('/api/verify-channel-membership', async (req, res) => {
    try {
        const { telegramId, channelId } = req.body;
        const user = await userService.getUserByTelegramId(req.db, parseInt(telegramId));
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const channel = await taskService.getChannelById(req.db, channelId);
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }

        // Use Telegram Bot API to check membership
        const botToken = process.env.BOT_TOKEN;
        const chatMember = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: channel.channel_id,
                user_id: parseInt(telegramId)
            })
        }).then(res => res.json());

        if (chatMember.ok && ['member', 'administrator', 'creator'].includes(chatMember.result.status)) {
            // User is a member, allow them to claim
            await taskService.completeChannelJoin(req.db, user.id, channelId, channel.points_reward);
            const updatedUser = await userService.getUserById(req.db, user.id);
            
            res.json({
                success: true,
                isMember: true,
                pointsEarned: channel.points_reward,
                user: updatedUser
            });
        } else {
            res.json({
                success: false,
                isMember: false,
                message: 'You must join the channel first before claiming the reward'
            });
        }
    } catch (error) {
        console.error('Error verifying channel membership:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Verify mandatory onboarding joins (channel + group)
app.post('/api/verify-onboarding-joins', async (req, res) => {
    try {
        const { telegramId } = req.body;
        const user = await userService.getUserByTelegramId(req.db, parseInt(telegramId));
        if (!user) return res.status(404).json({ error: 'User not found' });
        const channelId = await getConfig(req.db, 'requiredChannelId', null);
        const groupId = await getConfig(req.db, 'requiredGroupId', null);
        const botToken = process.env.BOT_TOKEN;
        let channelOk = true, groupOk = true;
        if (channelId) {
            const c = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: parseInt(channelId), user_id: parseInt(telegramId) })
            }).then(r => r.json()).catch(() => null);
            channelOk = c && c.ok && ['member', 'administrator', 'creator'].includes(c.result?.status);
        }
        if (groupId) {
            const g = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: parseInt(groupId), user_id: parseInt(telegramId) })
            }).then(r => r.json()).catch(() => null);
            groupOk = g && g.ok && ['member', 'administrator', 'creator'].includes(g.result?.status);
        }
        const ok = channelOk && groupOk;
        // If onboarding satisfied, try to finalize any pending referral reward
        if (ok) {
            try { await userService.finalizeReferralIfEligible(req.db, parseInt(telegramId)); } catch (_) {}
        }
        res.json({ ok, channelOk, groupOk });
    } catch (e) {
        console.error('Error verifying onboarding joins:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Social task claim endpoints (delayed completion)
app.post('/api/social/claim-request', async (req, res) => {
    try {
        const { telegramId, socialTaskId } = req.body;
        const user = await userService.getUserByTelegramId(req.db, parseInt(telegramId));
        if (!user) return res.status(404).json({ error: 'User not found' });
        const task = await req.db.get('SELECT * FROM social_tasks WHERE id = ? AND is_active = 1', [socialTaskId]);
        if (!task) return res.status(404).json({ error: 'Task not found' });

        // Prevent duplicate claims
        const existing = await req.db.get('SELECT * FROM user_social_claims WHERE user_id = ? AND social_task_id = ?', [user.id, socialTaskId]);
        if (existing) {
            return res.json({ success: true, status: existing.status, availableAt: existing.available_at });
        }

        // Enforce daily limit before accepting the request
        const dailyLimit = await userService.checkDailyLimit(req.db, user.id);
        if (!dailyLimit.can_complete) return res.status(400).json({ error: 'Daily task limit reached' });

        // Delay by platform: social = 15m, website = 20m
        const delayMinutes = task.platform === 'website' ? 20 : 15;
        await req.db.run(`
            INSERT INTO user_social_claims (user_id, social_task_id, status, points_earned, requested_at, available_at)
            VALUES (?, ?, 'pending', ?, datetime('now'), datetime('now', '+${delayMinutes} minutes'))
        `, [user.id, socialTaskId, task.points_reward]);

        res.json({ success: true, status: 'pending' });
    } catch (err) {
        console.error('Error creating social claim:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin broadcast (multipart upload supported)
app.post('/api/admin/broadcast', async (req, res) => {
    try {
        if (!isAdmin(req)) return res.status(403).json({ error: 'Access denied' });
        const scope = (req.body && req.body.scope) || (req.query && req.query.scope);
        const target = (req.body && req.body.target) || (req.query && req.query.target) || null;
        const message = (req.body && req.body.message) || (req.query && req.query.message);
        if (!scope || !message) return res.status(400).json({ error: 'Missing scope or message' });
        // Accept base64 media via JSON (mediaBase64, mediaMime)
        let mediaBuffer = null, mediaMime = null;
        if (req.body && req.body.mediaBase64) {
            try {
                mediaBuffer = Buffer.from(String(req.body.mediaBase64), 'base64');
                mediaMime = req.body.mediaMime || 'application/octet-stream';
            } catch(_) { mediaBuffer = null; mediaMime = null; }
        }

        // Create job record
        const job = await req.db.run(`INSERT INTO broadcast_jobs (created_by, scope, target, media_type, media_url, message) VALUES (?, ?, ?, ?, ?, ?)`, [parseInt(getAdminId(req)), scope, target || null, mediaBuffer ? (mediaMime && mediaMime.startsWith('video') ? 'video' : 'photo') : 'none', null, message]);
        const jobId = job.id;

        // Determine targets
        let targets = [];
        if (scope === 'all_users') {
            const users = await req.db.all('SELECT telegram_id FROM users');
            targets = users.map(u => u.telegram_id);
        } else if (scope === 'single_user') {
            if (!target) return res.status(400).json({ error: 'Target required for single_user' });
            const tgId = target.startsWith('@') ? null : parseInt(target);
            if (tgId) targets = [tgId]; else return res.status(400).json({ error: 'Provide numeric Telegram ID for single_user' });
        } else if (scope === 'channels') {
            const rows = await req.db.all('SELECT channel_id FROM channels WHERE is_active = 1');
            targets = rows.map(r => r.channel_id);
        } else if (scope === 'groups') {
            const rows = await req.db.all('SELECT group_id FROM groups WHERE is_active = 1');
            targets = rows.map(r => r.group_id);
        }

        // Send with chunking (best-effort within request for now)
        const botToken = process.env.BOT_TOKEN;
        let sent = 0, failed = 0;
        const chunkSize = 25;
        for (let i = 0; i < targets.length; i += chunkSize) {
            const chunk = targets.slice(i, i + chunkSize);
            await Promise.all(chunk.map(async (id) => {
                try {
                    let resp;
                    if (mediaBuffer) {
                        const boundary = '----WebKitFormBoundary' + Math.random().toString(16).slice(2);
                        const bodyParts = [];
                        function addField(name, value) {
                            bodyParts.push(Buffer.from(`--${boundary}\r\n`));
                            bodyParts.push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`));
                            bodyParts.push(Buffer.from(String(value) + '\r\n'));
                        }
                        function addFile(name, filename, mime, buffer) {
                            bodyParts.push(Buffer.from(`--${boundary}\r\n`));
                            bodyParts.push(Buffer.from(`Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\n`));
                            bodyParts.push(Buffer.from(`Content-Type: ${mime}\r\n\r\n`));
                            bodyParts.push(buffer);
                            bodyParts.push(Buffer.from('\r\n'));
                        }
                        addField('chat_id', id);
                        addField('caption', message);
                        addFile(mediaMime && mediaMime.startsWith('video') ? 'video' : 'photo', 'media', mediaMime || 'application/octet-stream', mediaBuffer);
                        bodyParts.push(Buffer.from(`--${boundary}--\r\n`));
                        const apiUrl = `https://api.telegram.org/bot${botToken}/${mediaMime && mediaMime.startsWith('video') ? 'sendVideo' : 'sendPhoto'}`;
                        resp = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body: Buffer.concat(bodyParts) }).then(r => r.json());
                    } else {
                        const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
                        resp = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: id, text: message }) }).then(r => r.json());
                    }
                    if (resp && resp.ok) {
                        sent += 1;
                        await req.db.run(`INSERT INTO broadcast_results (job_id, target_id, status) VALUES (?, ?, 'sent')`, [jobId, String(id)]);
                    } else {
                        failed += 1;
                        const status = resp && resp.error_code === 403 ? 'blocked' : 'failed';
                        await req.db.run(`INSERT INTO broadcast_results (job_id, target_id, status, error) VALUES (?, ?, ?, ?)`, [jobId, String(id), status, resp && resp.description ? resp.description : '']);
                    }
                } catch (e) {
                    failed += 1;
                    await req.db.run(`INSERT INTO broadcast_results (job_id, target_id, status, error) VALUES (?, ?, 'failed', ?)`, [jobId, String(id), e.message || 'send error']);
                }
            }));
            // rate-limit between chunks
            await new Promise(r => setTimeout(r, 1100));
        }

        await req.db.run(`UPDATE broadcast_jobs SET status = 'completed' WHERE id = ?`, [jobId]);
        res.json({ success: true, sent, failed, jobId });
    } catch (err) {
        console.error('Error broadcasting:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin: Audit referral community membership
app.post('/api/admin/referral-audit', async (req, res) => {
    try {
        if (!isAdmin(req)) return res.status(403).json({ error: 'Access denied' });
        const refTgId = parseInt((req.body && req.body.referrerTelegramId) || (req.query && req.query.referrerTelegramId));
        if (!refTgId || !Number.isFinite(refTgId)) return res.status(400).json({ error: 'Provide numeric referrerTelegramId' });

        const referrer = await userService.getUserByTelegramId(req.db, refTgId);
        if (!referrer) return res.status(404).json({ error: 'Referrer not found' });

        // Fetch invitees
        const invitees = await req.db.all(
            `SELECT id, telegram_id, username, first_name, last_name, created_at 
             FROM users WHERE referred_by = ? ORDER BY created_at DESC LIMIT 1000`,
            [referrer.id]
        );

        const { channelIdentifier, groupIdentifier } = await getRequiredChats(req.db);
        const botToken = process.env.BOT_TOKEN;
        const checkMember = async (telegramId, chatId) => {
            if (!chatId) return true; // if not configured, treat as ok
            try {
                // Try numeric first
                const j = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: parseInt(chatId), user_id: parseInt(telegramId) }) }).then(r=>r.json()).catch(()=>null);
                if (j && j.ok) return ['member','administrator','creator'].includes(j.result?.status);
            } catch(_) {}
            try {
                // Fallback username identifier
                const cid = typeof chatId === 'string' ? (chatId.startsWith('@') ? chatId : `@${chatId}`) : chatId;
                const k = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: cid, user_id: parseInt(telegramId) }) }).then(r=>r.json()).catch(()=>null);
                return k && k.ok && ['member','administrator','creator'].includes(k.result?.status);
            } catch(_) { return false; }
        };

        const members = [];
        const nonMembers = [];
        for (const u of invitees) {
            const chOk = await checkMember(u.telegram_id, channelIdentifier);
            const grOk = await checkMember(u.telegram_id, groupIdentifier);
            const ok = chOk && grOk;
            const item = { telegram_id: u.telegram_id, username: u.username, first_name: u.first_name, last_name: u.last_name, created_at: u.created_at, channelOk: chOk, groupOk: grOk };
            if (ok) members.push(item); else nonMembers.push(item);
            // brief delay to be kind to Telegram API in large lists
            await new Promise(r => setTimeout(r, 60));
        }

        res.json({ referrer: { id: referrer.id, telegram_id: referrer.telegram_id, username: referrer.username }, counts: { total: invitees.length, members: members.length, nonMembers: nonMembers.length }, members, nonMembers });
    } catch (err) {
        console.error('Error in referral-audit:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.post('/api/social/claim-complete', async (req, res) => {
    try {
        const { telegramId, socialTaskId } = req.body;
        const user = await userService.getUserByTelegramId(req.db, parseInt(telegramId));
        if (!user) return res.status(404).json({ error: 'User not found' });
        // Try to finalize any due claims first
        await finalizeDueSocialClaims(req.db, user.id);
        const claim = await req.db.get('SELECT * FROM user_social_claims WHERE user_id = ? AND social_task_id = ?', [user.id, socialTaskId]);
        if (!claim) return res.status(404).json({ error: 'No pending claim' });
        if (claim.status === 'completed') return res.json({ success: true, status: 'completed', pointsEarned: claim.points_earned });
        return res.json({ success: false, status: 'pending', availableAt: claim.available_at });
    } catch (err) {
        console.error('Error completing social claim:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.post('/api/verify-group-membership', async (req, res) => {
    try {
        const { telegramId, groupId } = req.body;
        const user = await userService.getUserByTelegramId(req.db, parseInt(telegramId));
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const group = await taskService.getGroupById(req.db, groupId);
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
        }

        // Use Telegram Bot API to check membership
        const botToken = process.env.BOT_TOKEN;
        const chatMember = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: group.group_id,
                user_id: parseInt(telegramId)
            })
        }).then(res => res.json());

        if (chatMember.ok && ['member', 'administrator', 'creator'].includes(chatMember.result.status)) {
            // User is a member, allow them to claim
            await taskService.completeGroupJoin(req.db, user.id, groupId, group.points_reward);
            const updatedUser = await userService.getUserById(req.db, user.id);
            
            res.json({
                success: true,
                isMember: true,
                pointsEarned: group.points_reward,
                user: updatedUser
            });
        } else {
            res.json({
                success: false,
                isMember: false,
                message: 'You must join the group first before claiming the reward'
            });
        }
    } catch (error) {
        console.error('Error verifying group membership:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get user referral data
app.get('/api/user/:telegramId/referral', async (req, res) => {
    try {
        const { telegramId } = req.params;
        const user = await userService.getUserByTelegramId(req.db, parseInt(telegramId));
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Get referred users
        const referredUsers = await req.db.all(`
            SELECT u.first_name, u.last_name, u.username, u.created_at
            FROM users u
            WHERE u.referred_by = ?
            ORDER BY u.created_at DESC
        `, [user.id]);

        const friendInvitePoints = await getIntConfig(req.db, 'friendInvitePoints', parseInt(process.env.POINTS_PER_FRIEND_INVITE) || 25);

        res.json({
            referralLink: `https://t.me/${process.env.BOT_USERNAME || 'your_bot_username'}?start=ref${telegramId}`,
            totalReferred: user.friends_invited,
            referralEarnings: (user.friends_invited || 0) * friendInvitePoints,
            referredUsers
        });
    } catch (error) {
        console.error('Error getting referral data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get user team members
// Admin contact info API
app.get('/api/admin/contact', async (req, res) => {
    try {
        const fromDb = await getConfig(req.db, 'adminUsername', null);
        res.json({ adminUsername: fromDb || (process.env.ADMIN_USERNAME || 'TGTaskSupport') });
    } catch (e) {
        res.json({ adminUsername: process.env.ADMIN_USERNAME || 'TGTaskSupport' });
    }
});

app.get('/api/user/:telegramId/team', async (req, res) => {
    try {
        const { telegramId } = req.params;
        const user = await userService.getUserByTelegramId(req.db, parseInt(telegramId));
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Get referred users with more details
        const teamMembers = await req.db.all(`
            SELECT 
                u.id,
                u.telegram_id,
                u.first_name,
                u.last_name,
                u.username,
                u.points,
                u.created_at,
                COALESCE(fi.status, 'pending') AS invite_status,
                COALESCE(fi.points_earned, 0) AS invite_points,
                COUNT(uc.id) as tasks_completed
            FROM users u
            LEFT JOIN user_channel_joins uc ON u.id = uc.user_id
            LEFT JOIN friend_invitations fi ON fi.invitee_telegram_id = u.telegram_id AND fi.inviter_id = ?
            WHERE u.referred_by = ?
            GROUP BY u.id, fi.status, fi.points_earned
            ORDER BY u.created_at DESC
        `, [user.id, user.id]);

        const normalized = (teamMembers || []).map(m => ({
            id: m.id,
            telegram_id: m.telegram_id,
            first_name: m.first_name,
            last_name: m.last_name,
            username: m.username,
            created_at: m.created_at,
            tasks_completed: m.tasks_completed,
            status: (m.invite_status === 'completed') ? 'success' : 'review'
        }));

        res.json({ teamMembers: normalized });
    } catch (error) {
        console.error('Error getting team data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Bank details endpoints
app.get('/api/bank-details/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        const user = await userService.getUserByTelegramId(req.db, parseInt(telegramId));
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const bankDetails = await req.db.get(`
            SELECT * FROM bank_details 
            WHERE telegram_id = ?
        `, [telegramId]);

        res.json({ bank_details: bankDetails });
    } catch (error) {
        console.error('Error getting bank details:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/bank-details', async (req, res) => {
    try {
        const { telegramId, accountName, accountNumber, bankCode } = req.body;
        const user = await userService.getUserByTelegramId(req.db, parseInt(telegramId));
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if bank details already exist
        const existingDetails = await req.db.get(`
            SELECT * FROM bank_details 
            WHERE telegram_id = ?
        `, [telegramId]);

        if (existingDetails) {
            // Check if user has enough points for modification fee
            const modificationFee = parseInt(process.env.BANK_EDIT_FEE) || 3000;
            if (user.points < modificationFee) {
                return res.status(400).json({ error: `Insufficient balance. Need ${modificationFee} points to modify bank details.` });
            }

            // Deduct modification fee
            await req.db.run(`
                UPDATE users SET points = points - ? WHERE id = ?
            `, [modificationFee, user.id]);
        }

        // Insert or update bank details
        if (existingDetails) {
            await req.db.run(`
                UPDATE bank_details 
                SET account_name = ?, account_number = ?, bank_name = ?, updated_at = datetime('now')
                WHERE telegram_id = ?
            `, [accountName, accountNumber, bankCode, telegramId]);
        } else {
            await req.db.run(`
                INSERT INTO bank_details (telegram_id, account_name, account_number, bank_name, created_at)
                VALUES (?, ?, ?, ?, datetime('now'))
            `, [telegramId, accountName, accountNumber, bankCode]);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error saving bank details:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Withdrawal endpoints
app.post('/api/withdraw', async (req, res) => {
    try {
        const { telegramId, amount } = req.body;
        const user = await userService.getUserByTelegramId(req.db, parseInt(telegramId));
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (user.is_banned) {
            return res.status(403).json({ error: 'Account banned' });
        }

        // Feature flag: allow admin to disable withdrawals
        const withdrawalsEnabledCfg = await getConfig(req.db, 'withdrawalsEnabled', 'true');
        if (String(withdrawalsEnabledCfg) === 'false') {
            return res.status(403).json({ error: 'Withdrawals are closed for now. Please try again later.' });
        }

        // Require minimum successful referrals to withdraw
        try {
            const minReferralsRequired = parseInt(await getConfig(req.db, 'minReferralsForWithdraw', '10'));
            if (Number.isFinite(minReferralsRequired) && minReferralsRequired > 0) {
                const okReferrals = await req.db.get(
                    `SELECT COUNT(*) as cnt
                     FROM friend_invitations fi
                     WHERE fi.inviter_id = ? AND fi.status = 'completed'`,
                    [user.id]
                );
                const numOk = (okReferrals && okReferrals.cnt) ? parseInt(okReferrals.cnt) : 0;
                if (numOk < minReferralsRequired) {
                    return res.status(400).json({ error: `You need at least ${minReferralsRequired} successful referrals to withdraw.` });
                }
            }
        } catch (_) {
            return res.status(400).json({ error: 'You need at least 10 successful referrals to withdraw.' });
        }

        // Treat amounts as points (no currency symbol)
        const minWithdrawal = await getIntConfig(req.db, 'minWithdrawal', parseInt(process.env.MIN_WITHDRAWAL_AMOUNT) || 1000);
        const maxWithdrawal = await getIntConfig(req.db, 'maxWithdrawal', parseInt(process.env.MAX_WITHDRAWAL_AMOUNT) || 50000);

        if (amount < minWithdrawal) {
            return res.status(400).json({ error: `Minimum withdrawal is ${minWithdrawal} points` });
        }

        if (amount > maxWithdrawal) {
            return res.status(400).json({ error: `Maximum withdrawal is ${maxWithdrawal} points` });
        }

        if (amount > user.points) {
            return res.status(400).json({ error: 'Insufficient points' });
        }

        // Check if user has bank details
        const bankDetails = await req.db.get(`
            SELECT * FROM bank_details 
            WHERE telegram_id = ?
        `, [telegramId]);

        if (!bankDetails) {
            return res.status(400).json({ error: 'Please add bank details first' });
        }

        // Prevent multiple submissions while one is pending
        const hasPending = await req.db.get(`SELECT id FROM withdrawals WHERE telegram_id = ? AND status = 'pending' LIMIT 1`, [telegramId]);
        if (hasPending) return res.status(400).json({ error: 'You already have a pending withdrawal' });

        // Enforce one withdrawal per day (works on both SQLite and Postgres)
        const todayReq = await req.db.get(`
            SELECT COUNT(*) as count FROM withdrawals 
            WHERE telegram_id = ? AND DATE(created_at) = DATE(CURRENT_TIMESTAMP)
        `, [telegramId]);
        if (todayReq && todayReq.count > 0) {
            return res.status(400).json({ error: 'You can only submit one withdrawal per day' });
        }

        // Enforce community membership before withdraw
        const { channelIdentifier, groupIdentifier } = await getRequiredChats(req.db);
        if (channelIdentifier || groupIdentifier) {
            const botToken = process.env.BOT_TOKEN;
            const checkMember = async (chatId) => {
                const j = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: parseInt(chatId), user_id: parseInt(telegramId) }) }).then(r=>r.json()).catch(()=>null);
                if (j && j.ok) return ['member','administrator','creator'].includes(j.result?.status);
                // Retry with username identifier if numeric failed
                if (typeof chatId === 'string') {
                    const k = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId.startsWith('@') ? chatId : `@${chatId}`, user_id: parseInt(telegramId) }) }).then(r=>r.json()).catch(()=>null);
                    return k && k.ok && ['member','administrator','creator'].includes(k.result?.status);
                }
                return false;
            };
            const chOk = channelIdentifier ? await checkMember(channelIdentifier) : true;
            const grOk = groupIdentifier ? await checkMember(groupIdentifier) : true;
            if (!chOk || !grOk) return res.status(403).json({ error: 'Join the community first' });
        }

        // Compute fees and receivables
        const withdrawalFeePct = parseFloat(await getConfig(req.db, 'withdrawalFee', process.env.WITHDRAWAL_FEE_PERCENTAGE || 5));
        const currencyRate = parseFloat(await getConfig(req.db, 'pointToCurrencyRate', process.env.POINT_TO_CURRENCY_RATE || 1));
        const feePoints = Math.floor((amount * (isNaN(withdrawalFeePct) ? 0 : withdrawalFeePct)) / 100);
        const receivablePoints = Math.max(0, amount - feePoints);
        const receivableCurrency = receivablePoints * (isNaN(currencyRate) ? 1 : currencyRate);

        // Create withdrawal atomically and deduct points under a transaction to avoid race conditions
        await req.db.transaction(async (tx) => {
            // Lock user row where supported (Postgres); SQLite will ignore FOR UPDATE gracefully
            try { await tx.get('SELECT id FROM users WHERE id = ? FOR UPDATE', [user.id]); } catch (_) {}

            // Re-check pending and today within tx
            const p = await tx.get(`SELECT id FROM withdrawals WHERE telegram_id = ? AND status = 'pending' LIMIT 1`, [telegramId]);
            if (p) throw new Error('You already have a pending withdrawal');
            const t = await tx.get(`SELECT COUNT(*) as count FROM withdrawals WHERE telegram_id = ? AND DATE(created_at) = DATE(CURRENT_TIMESTAMP)`, [telegramId]);
            if (t && t.count > 0) throw new Error('You can only submit one withdrawal per day');

            // Ensure sufficient balance at commit time
            const freshUser = await tx.get('SELECT points FROM users WHERE id = ?', [user.id]);
            if (!freshUser || (freshUser.points || 0) < amount) throw new Error('Insufficient points');

            await tx.run(`
                INSERT INTO withdrawals (telegram_id, amount, status, created_at, fee_points, receivable_points, receivable_currency_amount)
                VALUES (?, ?, 'pending', datetime('now'), ?, ?, ?)
            `, [telegramId, amount, feePoints, receivablePoints, receivableCurrency]);
            await tx.run(`UPDATE users SET points = points - ?, updated_at = datetime('now') WHERE id = ?`, [amount, user.id]);
        });

        // Notify admin of new withdrawal request
        const adminId = parseInt(process.env.ADMIN_USER_ID || '');
        if (adminId) {
            await sendTelegramMessage(adminId, `💸 New withdrawal request: User ${telegramId} requested ${amount} points.`);
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error creating withdrawal:', error);
        const msg = error && error.message ? error.message : 'Internal server error';
        const code = msg === 'Insufficient points' || msg.includes('pending withdrawal') || msg.includes('one withdrawal per day') ? 400 : 500;
        res.status(code).json({ error: msg });
    }
});

// Earn status endpoint
app.get('/api/earn-status/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        const user = await userService.getUserByTelegramId(req.db, parseInt(telegramId));
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Get today's claims
        const todayClaims = await req.db.get(`
            SELECT COUNT(*) as count FROM claims_history 
            WHERE telegram_id = ? AND source = 'daily' AND DATE(claimed_at) = DATE('now')
        `, [telegramId]);

        const dailyLimit = await getIntConfig(req.db, 'dailyClaimsLimit', parseInt(process.env.DAILY_CLAIMS_LIMIT) || 5);
        const friendsPerBonus = await getIntConfig(req.db, 'friendsRequiredForBonus', parseInt(process.env.FRIENDS_REQUIRED_FOR_BONUS) || 10);
        const bonusPerBlock = await getIntConfig(req.db, 'bonusClaimsPerFriends', parseInt(process.env.BONUS_CLAIMS_PER_FRIENDS) || 2);
        const bonusClaims = Math.floor((user.friends_invited || 0) / friendsPerBonus) * bonusPerBlock;
        const totalClaims = dailyLimit + bonusClaims;
        const claimsRemaining = totalClaims - (todayClaims.count || 0);

        // Get claim history
        const claimHistory = await req.db.all(`
            SELECT * FROM claims_history 
            WHERE telegram_id = ? AND source = 'daily'
            ORDER BY claimed_at DESC 
            LIMIT 10
        `, [telegramId]);

        res.json({
            claimsRemaining: Math.max(0, claimsRemaining),
            totalClaims,
            claimHistory
        });
    } catch (error) {
        console.error('Error getting earn status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Claim reward endpoint
app.post('/api/claim-reward', async (req, res) => {
    try {
        const { telegramId } = req.body;
        const user = await userService.getUserByTelegramId(req.db, parseInt(telegramId));
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (user.is_banned) {
            return res.status(403).json({ error: 'Account banned' });
        }

        // Enforce community membership before claim
        const { channelIdentifier, groupIdentifier } = await getRequiredChats(req.db);
        if (channelIdentifier || groupIdentifier) {
            const botToken = process.env.BOT_TOKEN;
            const checkMember = async (chatId) => {
                const j = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: parseInt(chatId), user_id: parseInt(telegramId) }) }).then(r=>r.json()).catch(()=>null);
                if (j && j.ok) return ['member','administrator','creator'].includes(j.result?.status);
                if (typeof chatId === 'string') {
                    const k = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId.startsWith('@') ? chatId : `@${chatId}`, user_id: parseInt(telegramId) }) }).then(r=>r.json()).catch(()=>null);
                    return k && k.ok && ['member','administrator','creator'].includes(k.result?.status);
                }
                return false;
            };
            const chOk = channelIdentifier ? await checkMember(channelIdentifier) : true;
            const grOk = groupIdentifier ? await checkMember(groupIdentifier) : true;
            if (!chOk || !grOk) return res.status(403).json({ error: 'Join the community first' });
        }

        // Perform the entire claim in a transaction to prevent race conditions
        let pointsEarned = 0;
        await req.db.transaction(async (tx) => {
            // Lock user row on Postgres; ignored on SQLite
            try { await tx.get('SELECT id FROM users WHERE id = ? FOR UPDATE', [user.id]); } catch (_) {}

            // Recompute today's claims and allowed total inside the transaction
            const todayClaims = await tx.get(`
                SELECT COUNT(*) as count FROM claims_history 
                WHERE telegram_id = ? AND source = 'daily' AND DATE(claimed_at) = DATE(CURRENT_TIMESTAMP)
            `, [telegramId]);

            const dailyLimit = await getIntConfig(req.db, 'dailyClaimsLimit', parseInt(process.env.DAILY_CLAIMS_LIMIT) || 5);
            const friendsPerBonus = await getIntConfig(req.db, 'friendsRequiredForBonus', parseInt(process.env.FRIENDS_REQUIRED_FOR_BONUS) || 10);
            const bonusPerBlock = await getIntConfig(req.db, 'bonusClaimsPerFriends', parseInt(process.env.BONUS_CLAIMS_PER_FRIENDS) || 2);
            const bonusClaims = Math.floor((user.friends_invited || 0) / friendsPerBonus) * bonusPerBlock;
            const totalClaims = dailyLimit + bonusClaims;

            if ((todayClaims?.count || 0) >= totalClaims) {
                throw new Error('Daily claim limit reached');
            }

            // Generate biased random points based on account age
            const minClaim = await getIntConfig(req.db, 'minClaimAmount', parseInt(process.env.MIN_CLAIM_AMOUNT) || 50);
            const maxClaim = await getIntConfig(req.db, 'maxClaimAmount', parseInt(process.env.MAX_CLAIM_AMOUNT) || 500);
            const range = Math.max(0, maxClaim - minClaim);
            const createdAt = user.created_at ? new Date(user.created_at) : new Date();
            const ageHours = Math.max(0, (Date.now() - createdAt.getTime()) / 3600000);
            const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

            if (ageHours < 24) {
                // New users: higher probability for upper half of the range
                const useUpper = Math.random() < 0.7; // 70% chance upper band
                if (useUpper && range > 0) {
                    const lower = minClaim + Math.floor(range * 0.6);
                    pointsEarned = randInt(lower, maxClaim);
                } else {
                    pointsEarned = randInt(minClaim, maxClaim);
                }
            } else {
                // Older users: cap rewards near minimum (up to 50% of the range above min)
                const cap = minClaim + Math.floor(range * 0.5);
                pointsEarned = randInt(minClaim, Math.max(minClaim, cap));
            }

            // Update user and record claim atomically
            await tx.run(`
                UPDATE users 
                SET points = points + ?, 
                    total_points_earned = total_points_earned + ?,
                    updated_at = datetime('now')
                WHERE id = ?
            `, [pointsEarned, pointsEarned, user.id]);

            await tx.run(`
                INSERT INTO claims_history (telegram_id, points_earned, claimed_at, source)
                VALUES (?, ?, datetime('now'), 'daily')
            `, [telegramId, pointsEarned]);
        });

        // If user has a pending referral and has at least engaged (claimed), finalize referral too
        try { await userService.finalizeReferralIfEligible(req.db, parseInt(telegramId)); } catch (_) {}
        res.json({ success: true, pointsEarned });
    } catch (error) {
        console.error('Error claiming reward:', error);
        const msg = error && error.message ? error.message : 'Internal server error';
        const code = msg.includes('limit') ? 400 : 500;
        res.status(code).json({ error: msg });
    }
});

// History endpoint
app.get('/api/history/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        const { type } = req.query;
        const user = await userService.getUserByTelegramId(req.db, parseInt(telegramId));
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (type === 'withdrawals') {
            const withdrawals = await req.db.all(`
                SELECT id, telegram_id, amount, status, created_at, processed_at, fee_points, receivable_points, receivable_currency_amount 
                FROM withdrawals
                WHERE telegram_id = ? 
                ORDER BY created_at DESC 
                LIMIT 20
            `, [telegramId]);

            res.json({ withdrawals });
        } else if (type === 'earnings') {
            const earnings = await req.db.all(`
                SELECT 
                    'Channel Join' as task_name,
                    points_earned,
                    joined_at as earned_at
                FROM user_channel_joins 
                WHERE user_id = ?
                UNION ALL
                SELECT 
                    'Group Join' as task_name,
                    points_earned,
                    joined_at as earned_at
                FROM user_group_joins 
                WHERE user_id = ?
                UNION ALL
                SELECT 
                    CASE WHEN source = 'referral' THEN 'Invite Reward' ELSE 'Daily Reward' END as task_name,
                    points_earned,
                    claimed_at as earned_at
                FROM claims_history 
                WHERE telegram_id = ?
                UNION ALL
                SELECT 
                    ('Social Task: ' || COALESCE(st.task_name, st.platform)) as task_name,
                    usc.points_earned,
                    usc.completed_at as earned_at
                FROM user_social_claims usc
                JOIN social_tasks st ON st.id = usc.social_task_id
                WHERE usc.user_id = ? AND usc.status = 'completed'
                UNION ALL
                SELECT 
                    'Admin Credit' as task_name,
                    amount as points_earned,
                    created_at as earned_at
                FROM admin_audit
                WHERE target_telegram_id = ? AND action = 'adjust_balance' AND amount > 0
                ORDER BY earned_at DESC 
                LIMIT 50
            `, [user.id, user.id, telegramId, user.id, user.telegram_id]);

            res.json({ earnings });
        } else {
            res.status(400).json({ error: 'Invalid history type' });
        }
    } catch (error) {
        console.error('Error getting history:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, () => {
    console.log(`Web app server running on port ${PORT}`);
    console.log(`Web app URL: ${process.env.WEBAPP_URL || `http://localhost:${PORT}`}`);
});

module.exports = app;
