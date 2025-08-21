const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
let PgPool = null;
try { PgPool = require('pg').Pool; } catch (_) {}

class Database {
    constructor() {
        this.db = null;
        this.isConnected = false;
        this.dbPath = null;
        this.isPostgres = !!process.env.DATABASE_URL;
        this.pgPool = null;
    }

    async connect() {
        return new Promise((resolve, reject) => {
            if (this.isPostgres) {
                if (!PgPool) {
                    const msg = 'pg module not available but DATABASE_URL is set.';
                    console.error(msg);
                    return reject(new Error(msg));
                }
                try {
                    this.pgPool = new PgPool({
                        connectionString: process.env.DATABASE_URL,
                        ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined
                    });
                } catch (e) {
                    console.error('Failed to init Postgres pool:', e);
                    return reject(e);
                }
                this.isConnected = true;
                this.dbPath = process.env.DATABASE_URL;
                console.log('Connected to Postgres via DATABASE_URL');
                return resolve();
            }

            let dbPath = process.env.SQLITE_DB_PATH
                ? process.env.SQLITE_DB_PATH
                : path.join(__dirname, '../../database/tgtask.db');

            // In production, require SQLITE_DB_PATH to avoid accidental ephemeral DBs
            if ((process.env.NODE_ENV || 'production') === 'production' && !process.env.SQLITE_DB_PATH) {
                const msg = 'SQLITE_DB_PATH must be set in production. Refusing to start with ephemeral DB.';
                console.error(msg);
                return reject(new Error(msg));
            }

            try {
                const dir = path.dirname(dbPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
            } catch (_) {}
            
            this.db = new sqlite3.Database(dbPath, (err) => {
                if (err) {
                    console.error('Error connecting to database:', err);
                    reject(err);
                } else {
                    this.isConnected = true;
                    this.dbPath = dbPath;
                    console.log('Connected to SQLite database at', dbPath);
                    resolve();
                }
            });

            // Enable foreign keys
            this.db.run('PRAGMA foreign_keys = ON');
        });
    }

    _transformSqlForPostgres(sql) {
        let s = String(sql);
        // Replace SQLite datetime('now') with Postgres function
        s = s.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
        // Boolean: leave to Postgres defaults
        return s;
    }

    async query(sql, params = []) {
        if (!this.isConnected) throw new Error('Database not connected');
        if (this.isPostgres) {
            const text = this._transformSqlForPostgres(sql);
            const res = await this.pgPool.query(text, params);
            return res.rows;
        }
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err); else resolve(rows);
            });
        });
    }

    async run(sql, params = []) {
        if (!this.isConnected) throw new Error('Database not connected');
        if (this.isPostgres) {
            let text = this._transformSqlForPostgres(sql).replace(/;\s*$/, '');
            // Try to append RETURNING id for INSERTs if not present
            if (/^\s*insert\s+/i.test(text) && !/returning\s+id/i.test(text)) {
                text = `${text} RETURNING id`;
            }
            const res = await this.pgPool.query(text, params);
            const first = res.rows && res.rows[0];
            return { id: first && first.id != null ? first.id : undefined, changes: res.rowCount };
        }
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) reject(err); else resolve({ id: this.lastID, changes: this.changes });
            });
        });
    }

    async get(sql, params = []) {
        if (!this.isConnected) throw new Error('Database not connected');
        if (this.isPostgres) {
            const text = this._transformSqlForPostgres(sql);
            const res = await this.pgPool.query(text, params);
            return res.rows[0] || null;
        }
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
        });
    }

    async all(sql, params = []) {
        return this.query(sql, params);
    }

    async close() {
        return new Promise((resolve, reject) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) {
                        reject(err);
                    } else {
                        this.isConnected = false;
                        console.log('Database connection closed');
                        resolve();
                    }
                });
            } else {
                resolve();
            }
        });
    }

    // Transaction support
    async transaction(callback) {
        if (!this.isConnected) throw new Error('Database not connected');
        if (this.isPostgres) {
            const client = await this.pgPool.connect();
            try {
                await client.query('BEGIN');
                const tx = {
                    run: (sql, params=[]) => client.query(this._transformSqlForPostgres(sql), params).then(r=>({ id: r.rows?.[0]?.id, changes: r.rowCount })),
                    get: (sql, params=[]) => client.query(this._transformSqlForPostgres(sql), params).then(r=>r.rows[0]||null),
                    all: (sql, params=[]) => client.query(this._transformSqlForPostgres(sql), params).then(r=>r.rows),
                    query: (sql, params=[]) => client.query(this._transformSqlForPostgres(sql), params).then(r=>r.rows),
                };
                await callback(tx);
                await client.query('COMMIT');
            } catch (e) {
                try { await client.query('ROLLBACK'); } catch(_) {}
                throw e;
            } finally {
                client.release();
            }
            return;
        }
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run('BEGIN TRANSACTION');
                
                callback(this)
                    .then(() => {
                        this.db.run('COMMIT', (err) => {
                            if (err) {
                                this.db.run('ROLLBACK');
                                reject(err);
                            } else {
                                resolve();
                            }
                        });
                    })
                    .catch((err) => {
                        this.db.run('ROLLBACK');
                        reject(err);
                    });
            });
        });
    }
}

// Create singleton instance
const database = new Database();

module.exports = database;
