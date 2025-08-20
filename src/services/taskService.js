const userService = require('./userService');

class TaskService {
    async getAvailableTasks(database, userId) {
        try {
            // Get channels user hasn't joined
            const availableChannels = await database.query(
                `SELECT c.* 
                 FROM channels c
                 WHERE c.is_active = 1 
                 AND c.id NOT IN (
                     SELECT channel_id FROM user_channel_joins WHERE user_id = ?
                 )
                 ORDER BY c.points_reward DESC`,
                [userId]
            );

            // Get groups user hasn't joined
            const availableGroups = await database.query(
                `SELECT g.* 
                 FROM groups g
                 WHERE g.is_active = 1 
                 AND g.id NOT IN (
                     SELECT group_id FROM user_group_joins WHERE user_id = ?
                 )
                 ORDER BY g.points_reward DESC`,
                [userId]
            );

            return {
                channels: availableChannels,
                groups: availableGroups
            };
        } catch (error) {
            console.error('Error in getAvailableTasks:', error);
            throw error;
        }
    }

    async getChannelById(database, channelId) {
        try {
            return await database.get(
                'SELECT * FROM channels WHERE id = ? AND is_active = 1',
                [channelId]
            );
        } catch (error) {
            console.error('Error in getChannelById:', error);
            throw error;
        }
    }

    async getGroupById(database, groupId) {
        try {
            return await database.get(
                'SELECT * FROM groups WHERE id = ? AND is_active = 1',
                [groupId]
            );
        } catch (error) {
            console.error('Error in getGroupById:', error);
            throw error;
        }
    }

    async getUserChannelJoin(database, userId, channelId) {
        try {
            return await database.get(
                'SELECT * FROM user_channel_joins WHERE user_id = ? AND channel_id = ?',
                [userId, channelId]
            );
        } catch (error) {
            console.error('Error in getUserChannelJoin:', error);
            throw error;
        }
    }

    async getUserGroupJoin(database, userId, groupId) {
        try {
            return await database.get(
                'SELECT * FROM user_group_joins WHERE user_id = ? AND group_id = ?',
                [userId, groupId]
            );
        } catch (error) {
            console.error('Error in getUserGroupJoin:', error);
            throw error;
        }
    }

    async completeChannelJoin(database, userId, channelId, pointsEarned) {
        try {
            await database.transaction(async (db) => {
                // Record the channel join
                await db.run(
                    `INSERT INTO user_channel_joins (user_id, channel_id, points_earned)
                     VALUES (?, ?, ?)`,
                    [userId, channelId, pointsEarned]
                );

                // Record the task completion
                await db.run(
                    `INSERT INTO tasks (user_id, task_type, task_data, points_earned)
                     VALUES (?, 'channel_join', ?, ?)`,
                    [userId, JSON.stringify({ channel_id: channelId }), pointsEarned]
                );

                // Update user points and stats
                await userService.updateUserPoints(db, userId, pointsEarned);
                await userService.incrementTasksCompleted(db, userId);
                await userService.updateDailyLimit(db, userId, pointsEarned);
            });

            return true;
        } catch (error) {
            console.error('Error in completeChannelJoin:', error);
            throw error;
        }
    }

    async completeGroupJoin(database, userId, groupId, pointsEarned) {
        try {
            await database.transaction(async (db) => {
                // Record the group join
                await db.run(
                    `INSERT INTO user_group_joins (user_id, group_id, points_earned)
                     VALUES (?, ?, ?)`,
                    [userId, groupId, pointsEarned]
                );

                // Record the task completion
                await db.run(
                    `INSERT INTO tasks (user_id, task_type, task_data, points_earned)
                     VALUES (?, 'group_join', ?, ?)`,
                    [userId, JSON.stringify({ group_id: groupId }), pointsEarned]
                );

                // Update user points and stats
                await userService.updateUserPoints(db, userId, pointsEarned);
                await userService.incrementTasksCompleted(db, userId);
                await userService.updateDailyLimit(db, userId, pointsEarned);
            });

            return true;
        } catch (error) {
            console.error('Error in completeGroupJoin:', error);
            throw error;
        }
    }

    async completeFriendInvite(database, inviterId, inviteeTelegramId, inviteeUsername) {
        try {
            const pointsPerFriend = parseInt(process.env.POINTS_PER_FRIEND_INVITE) || 25;

            await database.transaction(async (db) => {
                // Record the invitation
                await db.run(
                    `INSERT INTO friend_invitations (inviter_id, invitee_telegram_id, invitee_username, status, points_earned, completed_at)
                     VALUES (?, ?, ?, 'completed', ?, CURRENT_TIMESTAMP)`,
                    [inviterId, inviteeTelegramId, inviteeUsername, pointsPerFriend]
                );

                // Record the task completion
                await db.run(
                    `INSERT INTO tasks (user_id, task_type, task_data, points_earned)
                     VALUES (?, 'friend_invite', ?, ?)`,
                    [inviterId, JSON.stringify({ invitee_telegram_id: inviteeTelegramId, invitee_username }), pointsPerFriend]
                );

                // Update user points and stats
                await userService.updateUserPoints(db, inviterId, pointsPerFriend);
                await userService.incrementTasksCompleted(db, inviterId);
                await userService.incrementFriendsInvited(db, inviterId);
                await userService.updateDailyLimit(db, inviterId, pointsPerFriend);
            });

            return true;
        } catch (error) {
            console.error('Error in completeFriendInvite:', error);
            throw error;
        }
    }

    async completeDailyLogin(database, userId) {
        try {
            const dailyLoginPoints = 5;
            const today = new Date().toISOString().split('T')[0];

            // Check if already claimed today
            const existingClaim = await database.get(
                `SELECT * FROM tasks 
                 WHERE user_id = ? AND task_type = 'daily_login' 
                 AND DATE(completed_at) = ?`,
                [userId, today]
            );

            if (existingClaim) {
                return { success: false, message: 'Daily login already claimed today' };
            }

            await database.transaction(async (db) => {
                // Record the task completion
                await db.run(
                    `INSERT INTO tasks (user_id, task_type, task_data, points_earned)
                     VALUES (?, 'daily_login', ?, ?)`,
                    [userId, JSON.stringify({ date: today }), dailyLoginPoints]
                );

                // Update user points and stats
                await userService.updateUserPoints(db, userId, dailyLoginPoints);
                await userService.incrementTasksCompleted(db, userId);
                await userService.updateDailyLimit(db, userId, dailyLoginPoints);
            });

            return { success: true, points: dailyLoginPoints };
        } catch (error) {
            console.error('Error in completeDailyLogin:', error);
            throw error;
        }
    }

    async getUserTaskHistory(database, userId, limit = 20) {
        try {
            return await database.query(
                `SELECT t.*, 
                        CASE 
                            WHEN t.task_type = 'channel_join' THEN c.channel_name
                            WHEN t.task_type = 'group_join' THEN g.group_name
                            WHEN t.task_type = 'friend_invite' THEN 'Friend Invitation'
                            WHEN t.task_type = 'daily_login' THEN 'Daily Login'
                            ELSE 'Unknown Task'
                        END as task_name
                 FROM tasks t
                 LEFT JOIN channels c ON JSON_EXTRACT(t.task_data, '$.channel_id') = c.id
                 LEFT JOIN groups g ON JSON_EXTRACT(t.task_data, '$.group_id') = g.id
                 WHERE t.user_id = ?
                 ORDER BY t.completed_at DESC
                 LIMIT ?`,
                [userId, limit]
            );
        } catch (error) {
            console.error('Error in getUserTaskHistory:', error);
            throw error;
        }
    }

    async getTaskStatistics(database, userId) {
        try {
            const stats = await database.get(
                `SELECT 
                    COUNT(*) as total_tasks,
                    SUM(points_earned) as total_points,
                    COUNT(CASE WHEN task_type = 'channel_join' THEN 1 END) as channel_joins,
                    COUNT(CASE WHEN task_type = 'group_join' THEN 1 END) as group_joins,
                    COUNT(CASE WHEN task_type = 'friend_invite' THEN 1 END) as friend_invites,
                    COUNT(CASE WHEN task_type = 'daily_login' THEN 1 END) as daily_logins
                 FROM tasks 
                 WHERE user_id = ?`,
                [userId]
            );

            return stats;
        } catch (error) {
            console.error('Error in getTaskStatistics:', error);
            throw error;
        }
    }

    async addChannel(database, channelData) {
        try {
            const result = await database.run(
                `INSERT INTO channels (channel_id, channel_name, channel_username, points_reward)
                 VALUES (?, ?, ?, ?)`,
                [channelData.channel_id, channelData.channel_name, channelData.channel_username, channelData.points_reward]
            );

            return await this.getChannelById(database, result.id);
        } catch (error) {
            console.error('Error in addChannel:', error);
            throw error;
        }
    }

    async addGroup(database, groupData) {
        try {
            const result = await database.run(
                `INSERT INTO groups (group_id, group_name, group_username, points_reward)
                 VALUES (?, ?, ?, ?)`,
                [groupData.group_id, groupData.group_name, groupData.group_username, groupData.points_reward]
            );

            return await this.getGroupById(database, result.id);
        } catch (error) {
            console.error('Error in addGroup:', error);
            throw error;
        }
    }

    async getAllChannels(database) {
        try {
            return await database.query(
                `SELECT c.*, COUNT(ucj.id) as total_joins
                 FROM channels c
                 LEFT JOIN user_channel_joins ucj ON c.id = ucj.channel_id
                 WHERE c.is_active = 1
                 GROUP BY c.id
                 ORDER BY total_joins DESC`
            );
        } catch (error) {
            console.error('Error in getAllChannels:', error);
            throw error;
        }
    }

    async getAllGroups(database) {
        try {
            return await database.query(
                `SELECT g.*, COUNT(ugj.id) as total_joins
                 FROM groups g
                 LEFT JOIN user_group_joins ugj ON g.id = ugj.group_id
                 WHERE g.is_active = 1
                 GROUP BY g.id
                 ORDER BY total_joins DESC`
            );
        } catch (error) {
            console.error('Error in getAllGroups:', error);
            throw error;
        }
    }

    async toggleChannelStatus(database, channelId, isActive) {
        try {
            await database.run(
                'UPDATE channels SET is_active = ? WHERE id = ?',
                [isActive ? 1 : 0, channelId]
            );

            return await this.getChannelById(database, channelId);
        } catch (error) {
            console.error('Error in toggleChannelStatus:', error);
            throw error;
        }
    }

    async toggleGroupStatus(database, groupId, isActive) {
        try {
            await database.run(
                'UPDATE groups SET is_active = ? WHERE id = ?',
                [isActive ? 1 : 0, groupId]
            );

            return await this.getGroupById(database, groupId);
        } catch (error) {
            console.error('Error in toggleGroupStatus:', error);
            throw error;
        }
    }
}

module.exports = new TaskService();
