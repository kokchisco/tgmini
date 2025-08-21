const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
let PgPool = null;
try { PgPool = require('pg').Pool; } catch (_) {}

// Resolve database file path (supports Railway Volume via SQLITE_DB_PATH)
const isPostgres = !!process.env.DATABASE_URL;
const resolvedDbPath = process.env.SQLITE_DB_PATH
    ? process.env.SQLITE_DB_PATH
    : path.join(__dirname, '../../database/tgtask.db');

// Ensure directory exists
const resolvedDir = path.dirname(resolvedDbPath);
if (!fs.existsSync(resolvedDir)) {
    fs.mkdirSync(resolvedDir, { recursive: true });
}

const db = isPostgres ? null : new sqlite3.Database(resolvedDbPath);

const shouldSeedSamples = (() => {
    const envFlag = String(process.env.SEED_SAMPLES || '').trim().toLowerCase();
    if (envFlag === 'true' || envFlag === '1' || envFlag === 'yes') return true;
    if (envFlag === 'false' || envFlag === '0' || envFlag === 'no') return false;
    // default: seed only in non-production
    return (process.env.NODE_ENV || 'development') !== 'production';
})();

// Create tables
const createTablesSqlite = () => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Users table
            db.run(`
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    telegram_id INTEGER UNIQUE NOT NULL,
                    username TEXT,
                    first_name TEXT,
                    last_name TEXT,
                    points INTEGER DEFAULT 0,
                    total_points_earned INTEGER DEFAULT 0,
                    tasks_completed INTEGER DEFAULT 0,
                    friends_invited INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Tasks table
            db.run(`
                CREATE TABLE IF NOT EXISTS tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    task_type TEXT NOT NULL,
                    task_data TEXT,
                    points_earned INTEGER DEFAULT 0,
                    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users (id)
                )
            `);

            // Channels table
            db.run(`
                CREATE TABLE IF NOT EXISTS channels (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    channel_id TEXT UNIQUE NOT NULL,
                    channel_name TEXT NOT NULL,
                    channel_username TEXT,
                    channel_type TEXT DEFAULT 'channel',
                    points_reward INTEGER DEFAULT 10,
                    is_active BOOLEAN DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Groups table
            db.run(`
                CREATE TABLE IF NOT EXISTS groups (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    group_id TEXT UNIQUE NOT NULL,
                    group_name TEXT NOT NULL,
                    group_username TEXT,
                    points_reward INTEGER DEFAULT 15,
                    is_active BOOLEAN DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Social tasks (Facebook/WhatsApp)
            db.run(`
                CREATE TABLE IF NOT EXISTS social_tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    platform TEXT NOT NULL, -- 'facebook' | 'whatsapp'
                    task_name TEXT NOT NULL,
                    task_link TEXT NOT NULL,
                    points_reward INTEGER DEFAULT 10,
                    is_active BOOLEAN DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // User social task claims (with delayed completion)
            db.run(`
                CREATE TABLE IF NOT EXISTS user_social_claims (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    social_task_id INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'completed'
                    points_earned INTEGER DEFAULT 0,
                    requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    available_at DATETIME NOT NULL,
                    completed_at DATETIME,
                    UNIQUE(user_id, social_task_id),
                    FOREIGN KEY (user_id) REFERENCES users (id),
                    FOREIGN KEY (social_task_id) REFERENCES social_tasks (id)
                )
            `);

            // Add description to social_tasks if missing
            db.run(`
                ALTER TABLE social_tasks ADD COLUMN description TEXT DEFAULT NULL
            `, (err) => {
                // ignore if already exists
            });

            // User channel joins
            db.run(`
                CREATE TABLE IF NOT EXISTS user_channel_joins (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    channel_id INTEGER NOT NULL,
                    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    points_earned INTEGER DEFAULT 0,
                    FOREIGN KEY (user_id) REFERENCES users (id),
                    FOREIGN KEY (channel_id) REFERENCES channels (id),
                    UNIQUE(user_id, channel_id)
                )
            `);

            // User group joins
            db.run(`
                CREATE TABLE IF NOT EXISTS user_group_joins (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    group_id INTEGER NOT NULL,
                    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    points_earned INTEGER DEFAULT 0,
                    FOREIGN KEY (user_id) REFERENCES users (id),
                    FOREIGN KEY (group_id) REFERENCES groups (id),
                    UNIQUE(user_id, group_id)
                )
            `);

            // Friend invitations
            db.run(`
                CREATE TABLE IF NOT EXISTS friend_invitations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    inviter_id INTEGER NOT NULL,
                    invitee_telegram_id INTEGER,
                    invitee_username TEXT,
                    status TEXT DEFAULT 'pending',
                    points_earned INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    completed_at DATETIME,
                    FOREIGN KEY (inviter_id) REFERENCES users (id)
                )
            `);

            // Daily limits tracking
            db.run(`
                CREATE TABLE IF NOT EXISTS daily_limits (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    date DATE NOT NULL,
                    tasks_completed INTEGER DEFAULT 0,
                    points_earned INTEGER DEFAULT 0,
                    FOREIGN KEY (user_id) REFERENCES users (id),
                    UNIQUE(user_id, date)
                )
            `);

            // Withdrawals table
            db.run(`
                CREATE TABLE IF NOT EXISTS withdrawals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    telegram_id INTEGER NOT NULL,
                    amount INTEGER NOT NULL,
                    status TEXT DEFAULT 'pending',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    processed_at DATETIME,
                    FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
                )
            `);

            // Bank details table
            db.run(`
                CREATE TABLE IF NOT EXISTS bank_details (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    telegram_id INTEGER UNIQUE NOT NULL,
                    account_name TEXT NOT NULL,
                    account_number TEXT NOT NULL,
                    bank_name TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
                )
            `);

            // Claims history table
            db.run(`
                CREATE TABLE IF NOT EXISTS claims_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    telegram_id INTEGER NOT NULL,
                    points_earned INTEGER NOT NULL,
                    claimed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
                )
            `);

            // Admin config table
            db.run(`
                CREATE TABLE IF NOT EXISTS admin_config (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    config_key TEXT UNIQUE NOT NULL,
                    config_value TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Add referred_by column to users table if it doesn't exist
            db.run(`
                ALTER TABLE users ADD COLUMN referred_by INTEGER DEFAULT NULL
            `, (err) => {
                // Ignore error if column already exists
            });

            // Add is_banned flag to users
            db.run(`
                ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0
            `, (err) => {});

            // Admin audit table
            db.run(`
                CREATE TABLE IF NOT EXISTS admin_audit (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    admin_telegram_id INTEGER,
                    target_telegram_id INTEGER,
                    action TEXT NOT NULL,
                    amount INTEGER,
                    reason TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Broadcast job tables
            db.run(`
                CREATE TABLE IF NOT EXISTS broadcast_jobs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_by INTEGER,
                    scope TEXT NOT NULL, -- all_users | single_user | channels | groups
                    target TEXT,        -- username/telegram_id for single_user
                    media_type TEXT,    -- photo | video | none
                    media_url TEXT,
                    message TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    status TEXT DEFAULT 'queued'
                )
            `);
            db.run(`
                CREATE TABLE IF NOT EXISTS broadcast_results (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id INTEGER NOT NULL,
                    target_id TEXT NOT NULL,
                    status TEXT NOT NULL, -- sent | failed | blocked
                    error TEXT,
                    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(job_id) REFERENCES broadcast_jobs(id) ON DELETE CASCADE
                )
            `);

            // Add channel_link and group_link columns if they don't exist
            db.run(`
                ALTER TABLE channels ADD COLUMN channel_link TEXT DEFAULT NULL
            `, (err) => {
                // Ignore error if column already exists
            });

            db.run(`
                ALTER TABLE groups ADD COLUMN group_link TEXT DEFAULT NULL
            `, (err) => {
                // Ignore error if column already exists
            });

            // Add description columns for telegram tasks
            db.run(`
                ALTER TABLE channels ADD COLUMN description TEXT DEFAULT NULL
            `, (err) => {});
            db.run(`
                ALTER TABLE groups ADD COLUMN description TEXT DEFAULT NULL
            `, (err) => {});

            db.run('PRAGMA foreign_keys = ON', (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
};

async function createTablesPostgres() {
    if (!PgPool) throw new Error('pg module not available');
    const pool = new PgPool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined });
    const q = async (sql) => pool.query(sql);
    // Create tables (id SERIAL PK, timestamps default now())
    await q(`CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        points INTEGER DEFAULT 0,
        total_points_earned INTEGER DEFAULT 0,
        tasks_completed INTEGER DEFAULT 0,
        friends_invited INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        referred_by INTEGER,
        is_banned INTEGER DEFAULT 0
    )`);
    await q(`CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        task_type TEXT NOT NULL,
        task_data TEXT,
        points_earned INTEGER DEFAULT 0,
        completed_at TIMESTAMP DEFAULT NOW()
    )`);
    await q(`CREATE TABLE IF NOT EXISTS channels (
        id SERIAL PRIMARY KEY,
        channel_id TEXT UNIQUE NOT NULL,
        channel_name TEXT NOT NULL,
        channel_username TEXT,
        channel_type TEXT DEFAULT 'channel',
        points_reward INTEGER DEFAULT 10,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW(),
        channel_link TEXT,
        description TEXT
    )`);
    await q(`CREATE TABLE IF NOT EXISTS groups (
        id SERIAL PRIMARY KEY,
        group_id TEXT UNIQUE NOT NULL,
        group_name TEXT NOT NULL,
        group_username TEXT,
        points_reward INTEGER DEFAULT 15,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW(),
        group_link TEXT,
        description TEXT
    )`);
    await q(`CREATE TABLE IF NOT EXISTS social_tasks (
        id SERIAL PRIMARY KEY,
        platform TEXT NOT NULL,
        task_name TEXT NOT NULL,
        task_link TEXT NOT NULL,
        points_reward INTEGER DEFAULT 10,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW(),
        description TEXT
    )`);
    await q(`CREATE TABLE IF NOT EXISTS user_social_claims (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        social_task_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        points_earned INTEGER DEFAULT 0,
        requested_at TIMESTAMP DEFAULT NOW(),
        available_at TIMESTAMP NOT NULL,
        completed_at TIMESTAMP,
        UNIQUE(user_id, social_task_id)
    )`);
    await q(`CREATE TABLE IF NOT EXISTS user_channel_joins (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        channel_id INTEGER NOT NULL,
        joined_at TIMESTAMP DEFAULT NOW(),
        points_earned INTEGER DEFAULT 0,
        UNIQUE(user_id, channel_id)
    )`);
    await q(`CREATE TABLE IF NOT EXISTS user_group_joins (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        group_id INTEGER NOT NULL,
        joined_at TIMESTAMP DEFAULT NOW(),
        points_earned INTEGER DEFAULT 0,
        UNIQUE(user_id, group_id)
    )`);
    await q(`CREATE TABLE IF NOT EXISTS friend_invitations (
        id SERIAL PRIMARY KEY,
        inviter_id INTEGER NOT NULL,
        invitee_telegram_id BIGINT,
        invitee_username TEXT,
        status TEXT DEFAULT 'pending',
        points_earned INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
    )`);
    await q(`CREATE TABLE IF NOT EXISTS daily_limits (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        date DATE NOT NULL,
        tasks_completed INTEGER DEFAULT 0,
        points_earned INTEGER DEFAULT 0,
        UNIQUE(user_id, date)
    )`);
    await q(`CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT NOT NULL,
        amount INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        processed_at TIMESTAMP
    )`);
    await q(`CREATE TABLE IF NOT EXISTS bank_details (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        account_name TEXT NOT NULL,
        account_number TEXT NOT NULL,
        bank_name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await q(`CREATE TABLE IF NOT EXISTS claims_history (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT NOT NULL,
        points_earned INTEGER NOT NULL,
        claimed_at TIMESTAMP DEFAULT NOW(),
        source TEXT
    )`);
    await q(`CREATE TABLE IF NOT EXISTS admin_config (
        id SERIAL PRIMARY KEY,
        config_key TEXT UNIQUE NOT NULL,
        config_value TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await q(`CREATE TABLE IF NOT EXISTS admin_audit (
        id SERIAL PRIMARY KEY,
        admin_telegram_id BIGINT,
        target_telegram_id BIGINT,
        action TEXT NOT NULL,
        amount INTEGER,
        reason TEXT,
        created_at TIMESTAMP DEFAULT NOW()
    )`);
    await q(`CREATE TABLE IF NOT EXISTS broadcast_jobs (
        id SERIAL PRIMARY KEY,
        created_by BIGINT,
        scope TEXT NOT NULL,
        target TEXT,
        media_type TEXT,
        media_url TEXT,
        message TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        status TEXT DEFAULT 'queued'
    )`);
    await q(`CREATE TABLE IF NOT EXISTS broadcast_results (
        id SERIAL PRIMARY KEY,
        job_id INTEGER NOT NULL,
        target_id TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        sent_at TIMESTAMP DEFAULT NOW()
    )`);
    console.log('Postgres tables ensured.');
    await pool.end();
}

// Seed initial data (only when enabled and tables are empty)
const seedData = async () => {
    // Check if tables already have data
    let hasAny = false;
    if (isPostgres) {
        const pool = new PgPool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined });
        const ch = await pool.query('SELECT COUNT(*)::int AS c FROM channels');
        const gr = await pool.query('SELECT COUNT(*)::int AS c FROM groups');
        hasAny = (ch.rows[0].c > 0) || (gr.rows[0].c > 0);
        await pool.end();
    } else {
        hasAny = await new Promise((resolve) => {
            db.serialize(() => {
                let channelsCount = 0, groupsCount = 0;
                db.get('SELECT COUNT(*) AS c FROM channels', (e, r) => { channelsCount = (r && r.c) || 0; doneOne(); });
                db.get('SELECT COUNT(*) AS c FROM groups', (e, r) => { groupsCount = (r && r.c) || 0; doneOne(); });
                let pending = 2;
                function doneOne(){ if(--pending===0) resolve((channelsCount>0) || (groupsCount>0)); }
            });
        });
    }
    if (hasAny) return; // do not seed if data exists
    if (!shouldSeedSamples) return; // only seed when enabled
    if (isPostgres) {
        const pool = new PgPool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined });
        const run = (text, params) => pool.query(text, params);
        const sampleChannels = [
            { channel_id: '@sample_channel_1', channel_name: 'Sample Channel 1', channel_link: 'https://t.me/sample_channel_1', points_reward: 10 },
            { channel_id: '@sample_channel_2', channel_name: 'Sample Channel 2', channel_link: 'https://t.me/sample_channel_2', points_reward: 15 },
            { channel_id: '@sample_channel_3', channel_name: 'Sample Channel 3', channel_link: 'https://t.me/sample_channel_3', points_reward: 20 }
        ];
        for (const c of sampleChannels) {
            await run(`INSERT INTO channels (channel_id, channel_name, channel_link, points_reward) VALUES ($1,$2,$3,$4) ON CONFLICT (channel_id) DO NOTHING`, [c.channel_id, c.channel_name, c.channel_link, c.points_reward]);
        }
        const sampleGroups = [
            { group_id: '@sample_group_1', group_name: 'Sample Group 1', group_link: 'https://t.me/sample_group_1', points_reward: 15 },
            { group_id: '@sample_group_2', group_name: 'Sample Group 2', group_link: 'https://t.me/sample_group_2', points_reward: 20 },
            { group_id: '@sample_group_3', group_name: 'Sample Group 3', group_link: 'https://t.me/sample_group_3', points_reward: 25 }
        ];
        for (const g of sampleGroups) {
            await run(`INSERT INTO groups (group_id, group_name, group_link, points_reward) VALUES ($1,$2,$3,$4) ON CONFLICT (group_id) DO NOTHING`, [g.group_id, g.group_name, g.group_link, g.points_reward]);
        }
        await pool.end();
        return;
    }
    return new Promise((resolve, reject) => {
        // Insert sample channels
        const sampleChannels = [
            { 
                channel_id: '@sample_channel_1', 
                channel_name: 'Sample Channel 1', 
                channel_link: 'https://t.me/sample_channel_1',
                points_reward: 10 
            },
            { 
                channel_id: '@sample_channel_2', 
                channel_name: 'Sample Channel 2', 
                channel_link: 'https://t.me/sample_channel_2',
                points_reward: 15 
            },
            { 
                channel_id: '@sample_channel_3', 
                channel_name: 'Sample Channel 3', 
                channel_link: 'https://t.me/sample_channel_3',
                points_reward: 20 
            }
        ];

        const insertChannel = db.prepare(`
            INSERT OR IGNORE INTO channels (channel_id, channel_name, channel_link, points_reward)
            VALUES (?, ?, ?, ?)
        `);

        sampleChannels.forEach(channel => {
            insertChannel.run(channel.channel_id, channel.channel_name, channel.channel_link, channel.points_reward);
        });

        // Insert sample groups
        const sampleGroups = [
            { 
                group_id: '@sample_group_1', 
                group_name: 'Sample Group 1', 
                group_link: 'https://t.me/sample_group_1',
                points_reward: 15 
            },
            { 
                group_id: '@sample_group_2', 
                group_name: 'Sample Group 2', 
                group_link: 'https://t.me/sample_group_2',
                points_reward: 20 
            },
            { 
                group_id: '@sample_group_3', 
                group_name: 'Sample Group 3', 
                group_link: 'https://t.me/sample_group_3',
                points_reward: 25 
            }
        ];

        const insertGroup = db.prepare(`
            INSERT OR IGNORE INTO groups (group_id, group_name, group_link, points_reward)
            VALUES (?, ?, ?, ?)
        `);

        sampleGroups.forEach(group => {
            insertGroup.run(group.group_id, group.group_name, group.group_link, group.points_reward);
        });

        insertChannel.finalize();
        insertGroup.finalize();

        resolve();
    });
};

// Run migration
const runMigration = async () => {
    try {
        if (isPostgres) {
            console.log('Creating Postgres database tables...');
            await createTablesPostgres();
            console.log('Tables created successfully (Postgres)!');
        } else {
            console.log('Creating database tables at', resolvedDbPath, '...');
            await createTablesSqlite();
            console.log('Tables created successfully!');
        }
        
        // Seed only when enabled and tables empty
        if (shouldSeedSamples) {
            console.log('Seeding initial data (enabled)...');
            await seedData();
            console.log('Initial data seeding completed (or skipped if not empty).');
        } else {
            console.log('Sample data seeding disabled.');
        }
        
        console.log('Database migration completed!');
        if (db) db.close();
    } catch (error) {
        console.error('Migration failed:', error);
        if (db) db.close();
        process.exit(1);
    }
};

runMigration();
