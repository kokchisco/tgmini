const userService = require('../../services/userService');
const taskService = require('../../services/taskService');

const callbackHandlers = {
    async handleOpenWebApp(bot, callbackQuery, database) {
        const chatId = callbackQuery.message.chat.id;
        const userId = callbackQuery.from.id;
        const data = callbackQuery.data;

        try {
            let webAppUrl = `${process.env.WEBAPP_URL}?user_id=${userId}`;
            
            // Add specific tab if specified
            if (data.includes('tasks')) {
                webAppUrl += '&tab=tasks';
            } else if (data.includes('leaderboard')) {
                webAppUrl += '&tab=leaderboard';
            } else if (data.includes('stats')) {
                webAppUrl += '&tab=stats';
            }

            const keyboard = {
                inline_keyboard: [
                    [{
                        text: '🎯 Open Mini App',
                        web_app: { url: webAppUrl }
                    }]
                ]
            };

            await bot.editMessageReplyMarkup(keyboard, {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id
            });

        } catch (error) {
            console.error('Error in handleOpenWebApp:', error);
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Error opening web app',
                show_alert: true
            });
        }
    },

    async handleJoinChannel(bot, callbackQuery, database) {
        const chatId = callbackQuery.message.chat.id;
        const userId = callbackQuery.from.id;
        const data = callbackQuery.data;

        try {
            const channelId = data.split('_')[2]; // join_channel_123
            const channel = await taskService.getChannelById(database, channelId);
            
            if (!channel) {
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: 'Channel not found',
                    show_alert: true
                });
                return;
            }

            const keyboard = {
                inline_keyboard: [
                    [{
                        text: `📺 Join ${channel.channel_name}`,
                        url: `https://t.me/${channel.channel_username || channel.channel_id}`
                    }],
                    [{
                        text: '✅ Verify Join',
                        callback_data: `verify_join_channel_${channelId}`
                    }],
                    [{
                        text: '🎯 Open Mini App',
                        web_app: { url: `${process.env.WEBAPP_URL}?user_id=${userId}&tab=channels` }
                    }]
                ]
            };

            await bot.editMessageReplyMarkup(keyboard, {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id
            });

        } catch (error) {
            console.error('Error in handleJoinChannel:', error);
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Error processing channel join',
                show_alert: true
            });
        }
    },

    async handleJoinGroup(bot, callbackQuery, database) {
        const chatId = callbackQuery.message.chat.id;
        const userId = callbackQuery.from.id;
        const data = callbackQuery.data;

        try {
            const groupId = data.split('_')[2]; // join_group_123
            const group = await taskService.getGroupById(database, groupId);
            
            if (!group) {
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: 'Group not found',
                    show_alert: true
                });
                return;
            }

            const keyboard = {
                inline_keyboard: [
                    [{
                        text: `👥 Join ${group.group_name}`,
                        url: `https://t.me/${group.group_username || group.group_id}`
                    }],
                    [{
                        text: '✅ Verify Join',
                        callback_data: `verify_join_group_${groupId}`
                    }],
                    [{
                        text: '🎯 Open Mini App',
                        web_app: { url: `${process.env.WEBAPP_URL}?user_id=${userId}&tab=groups` }
                    }]
                ]
            };

            await bot.editMessageReplyMarkup(keyboard, {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id
            });

        } catch (error) {
            console.error('Error in handleJoinGroup:', error);
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Error processing group join',
                show_alert: true
            });
        }
    },

    async handleInviteFriend(bot, callbackQuery, database) {
        const chatId = callbackQuery.message.chat.id;
        const userId = callbackQuery.from.id;

        try {
            const user = await userService.getUserByTelegramId(database, userId);
            if (!user) {
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: 'User not found',
                    show_alert: true
                });
                return;
            }

            const inviteLink = `https://t.me/${bot.options.username}?start=ref_${user.id}`;
            const pointsPerFriend = process.env.POINTS_PER_FRIEND_INVITE || 25;

            const message = `
👥 *Invite Friends & Earn Points*

*How it works:*
1. Share your invite link with friends
2. When they join using your link, you get ${pointsPerFriend} points
3. Track your invitations in the mini app

*Your Invite Link:*
\`${inviteLink}\`

*Current Invitations:* ${user.friends_invited} friends
*Points Earned from Invites:* ${user.friends_invited * pointsPerFriend} points
`;

            const keyboard = {
                inline_keyboard: [
                    [{
                        text: '📤 Share Invite Link',
                        switch_inline_query: `Join TGTask Bot and earn points! ${inviteLink}`
                    }],
                    [{
                        text: '🎯 Open Mini App',
                        web_app: { url: `${process.env.WEBAPP_URL}?user_id=${userId}&tab=invites` }
                    }],
                    [{
                        text: '📊 View Invitations',
                        callback_data: 'view_invitations'
                    }]
                ]
            };

            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });

        } catch (error) {
            console.error('Error in handleInviteFriend:', error);
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Error processing invite',
                show_alert: true
            });
        }
    },

    async handleVerifyJoin(bot, callbackQuery, database) {
        const chatId = callbackQuery.message.chat.id;
        const userId = callbackQuery.from.id;
        const data = callbackQuery.data;

        try {
            const user = await userService.getUserByTelegramId(database, userId);
            if (!user) {
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: 'User not found',
                    show_alert: true
                });
                return;
            }

            const parts = data.split('_');
            const joinType = parts[2]; // channel or group
            const itemId = parts[3];

            // Note: In a real implementation, you would verify membership using Telegram Bot API
            // For now, we'll simulate the verification
            let success = false;
            let pointsEarned = 0;
            let itemName = '';

            if (joinType === 'channel') {
                const channel = await taskService.getChannelById(database, itemId);
                if (channel) {
                    // Check if user already joined this channel
                    const existingJoin = await taskService.getUserChannelJoin(database, user.id, itemId);
                    if (!existingJoin) {
                        pointsEarned = channel.points_reward;
                        await taskService.completeChannelJoin(database, user.id, itemId, pointsEarned);
                        success = true;
                        itemName = channel.channel_name;
                    }
                }
            } else if (joinType === 'group') {
                const group = await taskService.getGroupById(database, itemId);
                if (group) {
                    // Check if user already joined this group
                    const existingJoin = await taskService.getUserGroupJoin(database, user.id, itemId);
                    if (!existingJoin) {
                        pointsEarned = group.points_reward;
                        await taskService.completeGroupJoin(database, user.id, itemId, pointsEarned);
                        success = true;
                        itemName = group.group_name;
                    }
                }
            }

            if (success) {
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: `✅ Successfully joined ${itemName}! Earned ${pointsEarned} points!`,
                    show_alert: true
                });

                // Update message
                const message = `
✅ *Task Completed!*

*${itemName}* joined successfully!
*Points Earned:* ${pointsEarned} 🪙

*Current Total Points:* ${user.points + pointsEarned} 🪙

Keep completing tasks to climb the leaderboard!
`;

                const keyboard = {
                    inline_keyboard: [
                        [{
                            text: '🎯 Open Mini App',
                            web_app: { url: `${process.env.WEBAPP_URL}?user_id=${userId}` }
                        }],
                        [{
                            text: '📋 More Tasks',
                            callback_data: 'open_webapp_tasks'
                        }]
                    ]
                };

                await bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: callbackQuery.message.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });
            } else {
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: '❌ Unable to verify join. Please make sure you joined the channel/group first.',
                    show_alert: true
                });
            }

        } catch (error) {
            console.error('Error in handleVerifyJoin:', error);
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Error verifying join',
                show_alert: true
            });
        }
    },

    async handleAdminCallback(bot, callbackQuery, database) {
        const chatId = callbackQuery.message.chat.id;
        const userId = callbackQuery.from.id;
        const adminUserId = process.env.ADMIN_USER_ID;
        const data = callbackQuery.data;

        if (userId.toString() !== adminUserId) {
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: '❌ Access denied. Admin only.',
                show_alert: true
            });
            return;
        }

        try {
            if (data === 'admin_view_users') {
                const users = await userService.getAllUsers(database, 10);
                let message = '👥 *Recent Users*\n\n';
                
                users.forEach((user, index) => {
                    const name = user.first_name || user.username || 'Anonymous';
                    message += `${index + 1}. ${name} - ${user.points} points\n`;
                });

                const keyboard = {
                    inline_keyboard: [
                        [{
                            text: '🎯 Open Admin Panel',
                            web_app: { url: `${process.env.WEBAPP_URL}/admin?user_id=${userId}` }
                        }]
                    ]
                };

                await bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: callbackQuery.message.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });

            } else if (data === 'admin_stats') {
                const stats = await userService.getBotStats(database);
                const message = `
📊 *Bot Statistics*

*Total Users:* ${stats.total_users}
*Active Today:* ${stats.active_today}
*Total Points Distributed:* ${stats.total_points}
*Tasks Completed Today:* ${stats.tasks_today}

*Top Performing Channels:*
${stats.top_channels.map(ch => `• ${ch.channel_name}: ${ch.joins} joins`).join('\n')}
`;

                const keyboard = {
                    inline_keyboard: [
                        [{
                            text: '🎯 Open Admin Panel',
                            web_app: { url: `${process.env.WEBAPP_URL}/admin?user_id=${userId}` }
                        }]
                    ]
                };

                await bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: callbackQuery.message.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });
            }

        } catch (error) {
            console.error('Error in handleAdminCallback:', error);
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Error processing admin action',
                show_alert: true
            });
        }
    }
};

module.exports = callbackHandlers;
