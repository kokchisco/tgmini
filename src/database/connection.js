const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
    constructor() {
        this.db = null;
        this.isConnected = false;
        this.dbPath = null;
    }

    async connect() {
        return new Promise((resolve, reject) => {
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

    async query(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (!this.isConnected) {
                reject(new Error('Database not connected'));
                return;
            }

            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async run(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (!this.isConnected) {
                reject(new Error('Database not connected'));
                return;
            }

            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        id: this.lastID,
                        changes: this.changes
                    });
                }
            });
        });
    }

    async get(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (!this.isConnected) {
                reject(new Error('Database not connected'));
                return;
            }

            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    async all(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (!this.isConnected) {
                reject(new Error('Database not connected'));
                return;
            }

            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
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
        return new Promise((resolve, reject) => {
            if (!this.isConnected) {
                reject(new Error('Database not connected'));
                return;
            }

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
