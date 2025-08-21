require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
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

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

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
    }
    next();
});

// Config helpers
async function ensureConfigTable(db){
    // Migration created: admin_config(config_key TEXT UNIQUE, config_value TEXT)
    await db.run(`CREATE TABLE IF NOT EXISTS admin_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        config_key TEXT UNIQUE NOT NULL,
        config_value TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
}

async function setConfig(db, entries){
    await ensureConfigTable(db);
    const stmt = `INSERT INTO admin_config (config_key, config_value) VALUES (?, ?) 
                  ON CONFLICT(config_key) DO UPDATE SET config_value=excluded.config_value, updated_at=datetime('now')`;
    for (const [k,v] of Object.entries(entries)){
        await db.run(stmt, [k, String(v)]);
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
            .filter(c => c.channel_link && c.channel_link.startsWith('https://t.me/'));
        const groups = (availableTasks.groups || [])
            .filter(g => g.is_active === 1 || g.is_active === true || g.is_active === undefined)
            .map(normalizeGroup)
            .filter(g => g.group_link && g.group_link.startsWith('https://t.me/'));
        
        // Social tasks (facebook/whatsapp)
        const socialRaw = await req.db.all(`SELECT * FROM social_tasks WHERE is_active = 1 ORDER BY created_at DESC`);
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

        res.json({
            channels,
            groups,
            facebook,
            whatsapp,
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
                pointToCurrencyRate: parseFloat(await getConfig(req.db, 'pointToCurrencyRate', process.env.POINT_TO_CURRENCY_RATE || 1))
            },
            claimsConfig: {
                dailyClaimsLimit: await getIntConfig(req.db, 'dailyClaimsLimit', parseInt(process.env.DAILY_CLAIMS_LIMIT) || 5),
                minClaimAmount: await getIntConfig(req.db, 'minClaimAmount', parseInt(process.env.MIN_CLAIM_AMOUNT) || 50),
                maxClaimAmount: await getIntConfig(req.db, 'maxClaimAmount', parseInt(process.env.MAX_CLAIM_AMOUNT) || 500),
                bonusClaimsPerFriends: await getIntConfig(req.db, 'bonusClaimsPerFriends', parseInt(process.env.BONUS_CLAIMS_PER_FRIENDS) || 2),
                friendsRequiredForBonus: await getIntConfig(req.db, 'friendsRequiredForBonus', parseInt(process.env.FRIENDS_REQUIRED_FOR_BONUS) || 10)
            },
            supportConfig: {
                supportUsername: await getConfig(req.db, 'adminUsername', process.env.ADMIN_USERNAME || 'TGTaskSupport')
            },
            appConfig: {
                appName: await getConfig(req.db, 'appName', process.env.APP_NAME || 'TGTask')
            }
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
        const { minWithdrawal, maxWithdrawal, withdrawalFee, bankEditFee, currencySymbol, pointToCurrencyRate } = req.body;
        await setConfig(req.db, { minWithdrawal, maxWithdrawal, withdrawalFee, bankEditFee, currencySymbol, pointToCurrencyRate });
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
        const { supportUsername } = req.body;
        await setConfig(req.db, { adminUsername: supportUsername });
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
        const users = await req.db.all(`
            SELECT telegram_id, first_name, username, points, friends_invited, created_at
            FROM users 
            ORDER BY points DESC 
            LIMIT 100
        `);
        
        res.json({ users });
    } catch (error) {
        console.error('Error loading users:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/admin/withdrawals', async (req, res) => {
    try {
        const withdrawals = await req.db.all(`
            SELECT w.*, u.first_name as user_name, b.account_name, b.bank_name
            FROM withdrawals w
            LEFT JOIN users u ON w.telegram_id = u.telegram_id
            LEFT JOIN bank_details b ON w.telegram_id = b.telegram_id
            ORDER BY w.created_at DESC
        `);
        
        // Format bank details
        const formattedWithdrawals = withdrawals.map(w => ({
            ...w,
            bank_details: w.account_name && w.bank_name ? `${w.account_name} - ${w.bank_name}` : null
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
        
        await req.db.run(`
            UPDATE withdrawals 
            SET status = 'completed', processed_at = datetime('now')
            WHERE id = ?
        `, [id]);
        
        // Notify user about approval
        const w = await req.db.get('SELECT * FROM withdrawals WHERE id = ?', [id]);
        if (w && w.telegram_id) {
            await sendTelegramMessage(w.telegram_id, `✅ Your withdrawal of ${w.amount} points has been approved.`);
        }
        res.json({ success: true });
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
            await req.db.run(`
                UPDATE users 
                SET points = points + ? 
                WHERE telegram_id = ?
            `, [withdrawal.amount, withdrawal.telegram_id]);
            
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
        res.json({ ok: channelOk && groupOk, channelOk, groupOk });
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

        // 15 minutes delay
        await req.db.run(`
            INSERT INTO user_social_claims (user_id, social_task_id, status, points_earned, requested_at, available_at)
            VALUES (?, ?, 'pending', ?, datetime('now'), datetime('now', '+15 minutes'))
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

        res.json({
            referralLink: `https://t.me/${process.env.BOT_USERNAME || 'your_bot_username'}?start=ref${telegramId}`,
            totalReferred: user.friends_invited,
            referralEarnings: user.friends_invited * 500,
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
                u.first_name,
                u.last_name,
                u.username,
                u.points,
                u.created_at,
                COUNT(uc.id) as tasks_completed
            FROM users u
            LEFT JOIN user_channel_joins uc ON u.id = uc.user_id
            WHERE u.referred_by = ?
            GROUP BY u.id
            ORDER BY u.created_at DESC
        `, [user.id]);

        res.json({ teamMembers });
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

        // Enforce one withdrawal per day
        const todayReq = await req.db.get(`
            SELECT COUNT(*) as count FROM withdrawals 
            WHERE telegram_id = ? AND DATE(created_at) = DATE('now')
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

        // Create withdrawal request
        await req.db.run(`
            INSERT INTO withdrawals (telegram_id, amount, status, created_at)
            VALUES (?, ?, 'pending', datetime('now'))
        `, [telegramId, amount]);

        // Deduct points from user
        await req.db.run(`
            UPDATE users SET points = points - ? WHERE id = ?
        `, [amount, user.id]);

        // Notify admin of new withdrawal request
        const adminId = parseInt(process.env.ADMIN_USER_ID || '');
        if (adminId) {
            await sendTelegramMessage(adminId, `💸 New withdrawal request: User ${telegramId} requested ${amount} points.`);
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error creating withdrawal:', error);
        res.status(500).json({ error: 'Internal server error' });
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

        // Check if user can claim today
        const todayClaims = await req.db.get(`
            SELECT COUNT(*) as count FROM claims_history 
            WHERE telegram_id = ? AND source = 'daily' AND DATE(claimed_at) = DATE('now')
        `, [telegramId]);

        const dailyLimit = await getIntConfig(req.db, 'dailyClaimsLimit', parseInt(process.env.DAILY_CLAIMS_LIMIT) || 5);
        const friendsPerBonus = await getIntConfig(req.db, 'friendsRequiredForBonus', parseInt(process.env.FRIENDS_REQUIRED_FOR_BONUS) || 10);
        const bonusPerBlock = await getIntConfig(req.db, 'bonusClaimsPerFriends', parseInt(process.env.BONUS_CLAIMS_PER_FRIENDS) || 2);
        const bonusClaims = Math.floor((user.friends_invited || 0) / friendsPerBonus) * bonusPerBlock;
        const totalClaims = dailyLimit + bonusClaims;

        if ((todayClaims.count || 0) >= totalClaims) {
            return res.status(400).json({ error: 'Daily claim limit reached' });
        }

        // Generate random points
        const minClaim = await getIntConfig(req.db, 'minClaimAmount', parseInt(process.env.MIN_CLAIM_AMOUNT) || 50);
        const maxClaim = await getIntConfig(req.db, 'maxClaimAmount', parseInt(process.env.MAX_CLAIM_AMOUNT) || 500);
        const pointsEarned = Math.floor(Math.random() * (maxClaim - minClaim + 1)) + minClaim;

        // Add points to user (balance and total earned)
        await req.db.run(`
            UPDATE users 
            SET points = points + ?, 
                total_points_earned = total_points_earned + ?,
                updated_at = datetime('now')
            WHERE id = ?
        `, [pointsEarned, pointsEarned, user.id]);

        // Record claim
        await req.db.run(`
            INSERT INTO claims_history (telegram_id, points_earned, claimed_at, source)
            VALUES (?, ?, datetime('now'), 'daily')
        `, [telegramId, pointsEarned]);

        res.json({ success: true, pointsEarned });
    } catch (error) {
        console.error('Error claiming reward:', error);
        res.status(500).json({ error: 'Internal server error' });
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
                SELECT * FROM withdrawals 
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
                    'Daily Reward' as task_name,
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
