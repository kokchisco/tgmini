const userService = require('../../services/userService');
const taskService = require('../../services/taskService');

const commandHandlers = {
    async handleStart(bot, msg, database) {
        const chatId = msg.chat.id;
        const user = msg.from;

        try {
            // Parse referral if present: /start ref<telegramId>
            const text = msg.text || '';
            const m = text.match(/\/start\s+ref(\d+)/);
            const refTelegramId = m ? parseInt(m[1]) : null;
            const userRecord = await userService.getOrCreateUserWithReferral(database, {
                telegram_id: user.id,
                username: user.username,
                first_name: user.first_name,
                last_name: user.last_name
            }, refTelegramId);
            // If referral flag wasn’t set at creation (user pre-existed), try to apply it now
            if (refTelegramId) {
                const applied = await userService.applyReferralIfPossible(database, user.id, refTelegramId);
                if (applied) { try { await bot.sendMessage(refTelegramId, `👥 New referral joined using your link: @${user.username || 'user'}`); } catch (_) {} }
            }

            const welcomeMessage = `
🎉 *Welcome to TGTask!*

Earn points by completing simple tasks, inviting friends, and daily rewards. Open the mini app to get started.
`;

            const keyboard = {
                inline_keyboard: [
                    [{
                        text: '🎯 Open Mini App',
                        web_app: { url: `${process.env.WEBAPP_URL}?user_id=${(userRecord && userRecord.telegram_id) || user.id}` }
                    }]
                ]
            };

            const welcomeImageUrl = process.env.WELCOME_IMAGE_URL;
            if (welcomeImageUrl) {
                try {
                    await bot.sendPhoto(chatId, welcomeImageUrl, {
                        caption: welcomeMessage,
                        parse_mode: 'Markdown',
                        reply_markup: keyboard
                    });
                } catch (_) {
                    await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown', reply_markup: keyboard });
                }
            } else {
                await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown', reply_markup: keyboard });
            }

        } catch (error) {
            console.error('Error in handleStart:', error);
            await bot.sendMessage(chatId, 'Sorry, something went wrong. Please try again.');
        }
    },

    async handleHelp(bot, msg, database) {
        const chatId = msg.chat.id;

        const helpMessage = `
🤖 *TGTask Bot Help*

*How it works:*
1. Join our channels and groups to earn points
2. Invite friends to get bonus points
3. Complete daily tasks to stay on top
4. Check the leaderboard to see your ranking

*Available Tasks:*
• Join Channels: 10-20 points each
• Join Groups: 15-25 points each  
• Invite Friends: 25 points per friend
• Daily Login: 5 points

*Commands:*
• /start - Welcome message
• /tasks - View available tasks
• /profile - Your profile & points
• /leaderboard - Top players
• /help - This help message

*Need support?* Contact @admin_username
`;

        await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
    },

    async handleProfile(bot, msg, database) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        try {
            const user = await userService.getUserByTelegramId(database, userId);
            
            if (!user) {
                await bot.sendMessage(chatId, 'User not found. Please use /start to register.');
                return;
            }

            // Get user statistics
            const stats = await userService.getUserStats(database, user.id);
            
            const profileMessage = `
👤 *Your Profile*

*Name:* ${user.first_name} ${user.last_name || ''}
*Username:* @${user.username || 'N/A'}
*Current Points:* ${user.points} 🪙
*Total Points Earned:* ${user.total_points_earned} 🪙
*Tasks Completed:* ${user.tasks_completed} ✅
*Friends Invited:* ${user.friends_invited} 👥

*Today's Progress:*
• Tasks Completed: ${stats.today_tasks || 0}
• Points Earned: ${stats.today_points || 0}

*Ranking:* #${stats.rank || 'N/A'} on leaderboard
`;

            const keyboard = {
                inline_keyboard: [
                    [{
                        text: '🎯 Open Mini App',
                        web_app: { url: `${process.env.WEBAPP_URL}?user_id=${userId}` }
                    }],
                    [{
                        text: '📊 View Statistics',
                        callback_data: 'open_webapp_stats'
                    }],
                    [{
                        text: '🏆 Leaderboard',
                        callback_data: 'open_webapp_leaderboard'
                    }]
                ]
            };

            await bot.sendMessage(chatId, profileMessage, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });

        } catch (error) {
            console.error('Error in handleProfile:', error);
            await bot.sendMessage(chatId, 'Sorry, something went wrong. Please try again.');
        }
    },

    async handleTasks(bot, msg, database) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        try {
            const user = await userService.getUserByTelegramId(database, userId);
            
            if (!user) {
                await bot.sendMessage(chatId, 'User not found. Please use /start to register.');
                return;
            }

            // Get available tasks
            const availableTasks = await taskService.getAvailableTasks(database, user.id);
            
            let tasksMessage = `
📋 *Available Tasks*

*Complete these tasks to earn points:*
`;

            if (availableTasks.channels.length > 0) {
                tasksMessage += `\n*📺 Join Channels:*\n`;
                availableTasks.channels.forEach(channel => {
                    tasksMessage += `• ${channel.channel_name} - ${channel.points_reward} points\n`;
                });
            }

            if (availableTasks.groups.length > 0) {
                tasksMessage += `\n*👥 Join Groups:*\n`;
                availableTasks.groups.forEach(group => {
                    tasksMessage += `• ${group.group_name} - ${group.points_reward} points\n`;
                });
            }

            tasksMessage += `
*🎁 Invite Friends:*
• Invite friends to earn 25 points each

*📅 Daily Tasks:*
• Daily login bonus - 5 points
• Complete 5 tasks - 50 bonus points
`;

            const keyboard = {
                inline_keyboard: [
                    [{
                        text: '🎯 Open Mini App',
                        web_app: { url: `${process.env.WEBAPP_URL}?user_id=${userId}&tab=tasks` }
                    }],
                    [{
                        text: '📺 Join Channels',
                        callback_data: 'open_webapp_channels'
                    }],
                    [{
                        text: '👥 Join Groups',
                        callback_data: 'open_webapp_groups'
                    }],
                    [{
                        text: '👥 Invite Friends',
                        callback_data: 'invite_friend'
                    }]
                ]
            };

            await bot.sendMessage(chatId, tasksMessage, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });

        } catch (error) {
            console.error('Error in handleTasks:', error);
            await bot.sendMessage(chatId, 'Sorry, something went wrong. Please try again.');
        }
    },

    async handleLeaderboard(bot, msg, database) {
        const chatId = msg.chat.id;

        try {
            const leaderboard = await userService.getLeaderboard(database, 10);
            
            let leaderboardMessage = `
🏆 *Top 10 Players*

`;

            leaderboard.forEach((user, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                const name = user.first_name || user.username || 'Anonymous';
                const total = (user.total_earned != null ? user.total_earned : user.total_points_earned) || user.points || 0;
                leaderboardMessage += `${medal} ${name} - ${total} points\n`;
            });

            const keyboard = {
                inline_keyboard: [
                    [{
                        text: '🎯 Open Mini App',
                        web_app: { url: `${process.env.WEBAPP_URL}?user_id=${msg.from.id}&tab=leaderboard` }
                    }],
                    [{
                        text: '🔄 Refresh',
                        callback_data: 'refresh_leaderboard'
                    }]
                ]
            };

            await bot.sendMessage(chatId, leaderboardMessage, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });

        } catch (error) {
            console.error('Error in handleLeaderboard:', error);
            await bot.sendMessage(chatId, 'Sorry, something went wrong. Please try again.');
        }
    },

    async handleAdmin(bot, msg, database) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const adminUserId = process.env.ADMIN_USER_ID;

        if (userId.toString() !== adminUserId) {
            await bot.sendMessage(chatId, '❌ Access denied. Admin only.');
            return;
        }

        const adminMessage = `
🔧 *Admin Panel*

*Available Admin Commands:*
• Add Channel: Add new channel for tasks
• Add Group: Add new group for tasks
• View Users: See all registered users
• View Statistics: Bot usage statistics
• Manage Tasks: Enable/disable tasks

*Quick Actions:*
`;

        const keyboard = {
            inline_keyboard: [
                [{
                    text: '📺 Add Channel',
                    callback_data: 'admin_add_channel'
                }],
                [{
                    text: '👥 Add Group',
                    callback_data: 'admin_add_group'
                }],
                [{
                    text: '👥 View Users',
                    callback_data: 'admin_view_users'
                }],
                [{
                    text: '📊 Statistics',
                    callback_data: 'admin_stats'
                }],
                [{
                    text: '🎯 Open Admin Panel',
                    web_app: { url: `${(process.env.WEBAPP_URL || '').replace(/\/webapp$/, '')}/admin?user_id=${userId}` }
                }]
            ]
        };

        await bot.sendMessage(chatId, adminMessage, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    }
};

module.exports = commandHandlers;
