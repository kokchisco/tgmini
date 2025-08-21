class UserService {
    async getOrCreateUserWithReferral(database, userData, referrerTelegramId) {
        try {
            // Check if user exists
            let user = await database.get('SELECT * FROM users WHERE telegram_id = ?', [userData.telegram_id]);
            if (user) {
                // Update basic info then return
                await database.run(
                    `UPDATE users SET username = ?, first_name = ?, last_name = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?`,
                    [userData.username, userData.first_name, userData.last_name, userData.telegram_id]
                );
                return await database.get('SELECT * FROM users WHERE telegram_id = ?', [userData.telegram_id]);
            }

            // Resolve referrer internal id if provided
            let referrerIdRow = null;
            if (referrerTelegramId) {
                referrerIdRow = await database.get('SELECT id FROM users WHERE telegram_id = ?', [referrerTelegramId]);
            }

            const result = await database.run(
                `INSERT INTO users (telegram_id, username, first_name, last_name, points, total_points_earned, tasks_completed, friends_invited${referrerIdRow ? ', referred_by' : ''})
                 VALUES (?, ?, ?, ?, 0, 0, 0, 0${referrerIdRow ? ', ?' : ''})`,
                referrerIdRow
                    ? [userData.telegram_id, userData.username, userData.first_name, userData.last_name, referrerIdRow.id]
                    : [userData.telegram_id, userData.username, userData.first_name, userData.last_name]
            );

            if (referrerIdRow) {
                await this.incrementFriendsInvited(database, referrerIdRow.id);
            }

            return await database.get('SELECT * FROM users WHERE id = ?', [result.id]);
        } catch (err) {
            console.error('Error in getOrCreateUserWithReferral:', err);
            throw err;
        }
    }

    async applyReferralIfPossible(database, newUserTelegramId, referrerTelegramId) {
        try {
            if (!referrerTelegramId || !newUserTelegramId) return false;
            if (String(referrerTelegramId) === String(newUserTelegramId)) return false; // prevent self-referral

            const newUser = await database.get('SELECT id, referred_by FROM users WHERE telegram_id = ?', [newUserTelegramId]);
            if (!newUser) return false;
            if (newUser.referred_by) return false; // already referred

            const refRow = await database.get('SELECT id FROM users WHERE telegram_id = ?', [referrerTelegramId]);
            if (!refRow) return false;
            if (refRow.id === newUser.id) return false;

            await database.transaction(async (tx) => {
                await tx.run('UPDATE users SET referred_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND referred_by IS NULL', [refRow.id, newUser.id]);
                await this.incrementFriendsInvited(tx, refRow.id);
                // Credit referrer points from config
                const friendInvitePoints = await tx.get("SELECT config_value as v FROM admin_config WHERE config_key = 'friendInvitePoints'");
                const credit = parseInt(friendInvitePoints && friendInvitePoints.v ? friendInvitePoints.v : (process.env.POINTS_PER_FRIEND_INVITE || 25));
                if (Number.isFinite(credit) && credit > 0) {
                    await tx.run('UPDATE users SET points = points + ?, total_points_earned = total_points_earned + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [credit, credit, refRow.id]);
                    // Log to claims_history as referral credit
                    await tx.run('INSERT INTO claims_history (telegram_id, points_earned, claimed_at, source) VALUES (?, ?, datetime(\'now\'), \"referral\")', [referrerTelegramId, credit]);
                }
            });
            return true;
        } catch (err) {
            console.error('Error in applyReferralIfPossible:', err);
            return false;
        }
    }
    async getOrCreateUser(database, userData) {
        try {
            // Check if user exists
            let user = await database.get(
                'SELECT * FROM users WHERE telegram_id = ?',
                [userData.telegram_id]
            );

            if (!user) {
                // Create new user
                const result = await database.run(
                    `INSERT INTO users (telegram_id, username, first_name, last_name, points, total_points_earned, tasks_completed, friends_invited)
                     VALUES (?, ?, ?, ?, 0, 0, 0, 0)`,
                    [userData.telegram_id, userData.username, userData.first_name, userData.last_name]
                );

                user = await database.get(
                    'SELECT * FROM users WHERE id = ?',
                    [result.id]
                );
            } else {
                // Update existing user info
                await database.run(
                    `UPDATE users SET username = ?, first_name = ?, last_name = ?, updated_at = CURRENT_TIMESTAMP
                     WHERE telegram_id = ?`,
                    [userData.username, userData.first_name, userData.last_name, userData.telegram_id]
                );

                user = await database.get(
                    'SELECT * FROM users WHERE telegram_id = ?',
                    [userData.telegram_id]
                );
            }

            return user;
        } catch (error) {
            console.error('Error in getOrCreateUser:', error);
            throw error;
        }
    }

    async getUserByTelegramId(database, telegramId) {
        try {
            return await database.get(
                'SELECT * FROM users WHERE telegram_id = ?',
                [telegramId]
            );
        } catch (error) {
            console.error('Error in getUserByTelegramId:', error);
            throw error;
        }
    }

    async getUserById(database, userId) {
        try {
            return await database.get(
                'SELECT * FROM users WHERE id = ?',
                [userId]
            );
        } catch (error) {
            console.error('Error in getUserById:', error);
            throw error;
        }
    }

    async updateUserPoints(database, userId, pointsToAdd) {
        try {
            await database.run(
                `UPDATE users 
                 SET points = points + ?, 
                     total_points_earned = total_points_earned + ?,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [pointsToAdd, pointsToAdd, userId]
            );

            return await this.getUserById(database, userId);
        } catch (error) {
            console.error('Error in updateUserPoints:', error);
            throw error;
        }
    }

    async incrementTasksCompleted(database, userId) {
        try {
            await database.run(
                `UPDATE users 
                 SET tasks_completed = tasks_completed + 1,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [userId]
            );
        } catch (error) {
            console.error('Error in incrementTasksCompleted:', error);
            throw error;
        }
    }

    async incrementFriendsInvited(database, userId) {
        try {
            await database.run(
                `UPDATE users 
                 SET friends_invited = friends_invited + 1,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [userId]
            );
            // Credit referrer points and log earnings
            const friendInvitePointsRow = await database.get("SELECT config_value AS v FROM admin_config WHERE config_key = 'friendInvitePoints'");
            const credit = parseInt(friendInvitePointsRow && friendInvitePointsRow.v ? friendInvitePointsRow.v : (process.env.POINTS_PER_FRIEND_INVITE || 25));
            if (Number.isFinite(credit) && credit > 0) {
                await database.run(`UPDATE users SET points = points + ?, total_points_earned = total_points_earned + ? WHERE id = ?`, [credit, credit, userId]);
                // Also log in claims_history as referral
                const ref = await database.get('SELECT telegram_id FROM users WHERE id = ?', [userId]);
                if (ref && ref.telegram_id) {
                    await database.run(`INSERT INTO claims_history (telegram_id, points_earned, claimed_at, source) VALUES (?, ?, CURRENT_TIMESTAMP, 'referral')`, [ref.telegram_id, credit]);
                }
            }
        } catch (error) {
            console.error('Error in incrementFriendsInvited:', error);
            throw error;
        }
    }

    async getUserStats(database, userId) {
        try {
            const today = new Date().toISOString().split('T')[0];
            
            // Get today's stats
            const todayStats = await database.get(
                `SELECT tasks_completed, points_earned 
                 FROM daily_limits 
                 WHERE user_id = ? AND date = ?`,
                [userId, today]
            );

            // Get user's rank
            const rankResult = await database.get(
                `SELECT COUNT(*) + 1 as rank
                 FROM users 
                 WHERE points > (SELECT points FROM users WHERE id = ?)`,
                [userId]
            );

            return {
                today_tasks: todayStats ? todayStats.tasks_completed : 0,
                today_points: todayStats ? todayStats.points_earned : 0,
                rank: rankResult ? rankResult.rank : null
            };
        } catch (error) {
            console.error('Error in getUserStats:', error);
            throw error;
        }
    }

    async getLeaderboard(database, limit = 10) {
        try {
            // Compute total earned dynamically from tasks and claims_history, so legacy users are covered
            return await database.query(
                `SELECT 
                    u.id,
                    u.telegram_id,
                    u.username,
                    u.first_name,
                    u.last_name,
                    COALESCE(SUM(t.points_earned), 0) 
                      + COALESCE((SELECT SUM(ch.points_earned) FROM claims_history ch WHERE ch.telegram_id = u.telegram_id), 0) 
                      AS total_earned,
                    u.friends_invited
                 FROM users u
                 LEFT JOIN tasks t ON t.user_id = u.id
                 GROUP BY u.id
                 ORDER BY total_earned DESC, u.friends_invited DESC
                 LIMIT ?`,
                [limit]
            );
        } catch (error) {
            console.error('Error in getLeaderboard:', error);
            throw error;
        }
    }

    async getAllUsers(database, limit = 50) {
        try {
            return await database.query(
                `SELECT id, telegram_id, username, first_name, last_name, points, tasks_completed, friends_invited, created_at
                 FROM users 
                 ORDER BY created_at DESC
                 LIMIT ?`,
                [limit]
            );
        } catch (error) {
            console.error('Error in getAllUsers:', error);
            throw error;
        }
    }

    async getBotStats(database) {
        try {
            const today = new Date().toISOString().split('T')[0];
            
            // Total users
            const totalUsers = await database.get('SELECT COUNT(*) as count FROM users');
            
            // Active today
            const activeToday = await database.get(
                'SELECT COUNT(DISTINCT user_id) as count FROM daily_limits WHERE date = ?',
                [today]
            );
            
            // Total points distributed
            const totalPoints = await database.get('SELECT SUM(total_points_earned) as total FROM users');
            
            // Tasks completed today
            const tasksToday = await database.get(
                'SELECT SUM(tasks_completed) as total FROM daily_limits WHERE date = ?',
                [today]
            );
            
            // Top performing channels
            const topChannels = await database.query(
                `SELECT c.channel_name, COUNT(ucj.id) as joins
                 FROM channels c
                 LEFT JOIN user_channel_joins ucj ON c.id = ucj.channel_id
                 WHERE c.is_active = 1
                 GROUP BY c.id, c.channel_name
                 ORDER BY joins DESC
                 LIMIT 5`
            );

            return {
                total_users: totalUsers.count,
                active_today: activeToday.count,
                total_points: totalPoints.total || 0,
                tasks_today: tasksToday.total || 0,
                top_channels: topChannels
            };
        } catch (error) {
            console.error('Error in getBotStats:', error);
            throw error;
        }
    }

    async updateDailyLimit(database, userId, pointsEarned) {
        try {
            const today = new Date().toISOString().split('T')[0];
            
            // Check if daily limit record exists
            const existing = await database.get(
                'SELECT * FROM daily_limits WHERE user_id = ? AND date = ?',
                [userId, today]
            );

            if (existing) {
                // Update existing record
                await database.run(
                    `UPDATE daily_limits 
                     SET tasks_completed = tasks_completed + 1,
                         points_earned = points_earned + ?
                     WHERE user_id = ? AND date = ?`,
                    [pointsEarned, userId, today]
                );
            } else {
                // Create new record
                await database.run(
                    `INSERT INTO daily_limits (user_id, date, tasks_completed, points_earned)
                     VALUES (?, ?, 1, ?)`,
                    [userId, today, pointsEarned]
                );
            }
        } catch (error) {
            console.error('Error in updateDailyLimit:', error);
            throw error;
        }
    }

    async checkDailyLimit(database, userId) {
        try {
            const today = new Date().toISOString().split('T')[0];
            const dailyLimit = parseInt(process.env.DAILY_TASK_LIMIT) || 5;
            
            const todayStats = await database.get(
                'SELECT tasks_completed FROM daily_limits WHERE user_id = ? AND date = ?',
                [userId, today]
            );

            return {
                tasks_completed: todayStats ? todayStats.tasks_completed : 0,
                limit: dailyLimit,
                can_complete: !todayStats || todayStats.tasks_completed < dailyLimit
            };
        } catch (error) {
            console.error('Error in checkDailyLimit:', error);
            throw error;
        }
    }
}

module.exports = new UserService();
