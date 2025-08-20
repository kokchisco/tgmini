require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const database = require('../database/connection');
const commandHandlers = require('./handlers/commands');
const callbackHandlers = require('./handlers/callbacks');

class TGTaskBot {
    constructor() {
        this.bot = null;
        this.isRunning = false;
    }

    async initialize() {
        try {
            // Connect to database
            await database.connect();

            // Initialize bot
            const token = process.env.BOT_TOKEN;
            if (!token) {
                throw new Error('BOT_TOKEN is required in environment variables');
            }

            this.bot = new TelegramBot(token, { polling: true });
            console.log('Bot initialized successfully');

            // Set up command handlers
            this.setupCommandHandlers();
            
            // Set up callback handlers
            this.setupCallbackHandlers();

            // Set up error handling
            this.setupErrorHandling();

            this.isRunning = true;
            console.log('Bot is now running...');

        } catch (error) {
            console.error('Failed to initialize bot:', error);
            process.exit(1);
        }
    }

    setupCommandHandlers() {
        // Start command
        this.bot.onText(/\/start/, async (msg) => {
            try {
                await commandHandlers.handleStart(this.bot, msg, database);
            } catch (error) {
                console.error('Error handling start command:', error);
                await this.bot.sendMessage(msg.chat.id, 'Sorry, something went wrong. Please try again.');
            }
        });

        // Help command
        this.bot.onText(/\/help/, async (msg) => {
            try {
                await commandHandlers.handleHelp(this.bot, msg, database);
            } catch (error) {
                console.error('Error handling help command:', error);
                await this.bot.sendMessage(msg.chat.id, 'Sorry, something went wrong. Please try again.');
            }
        });

        // Profile command
        this.bot.onText(/\/profile/, async (msg) => {
            try {
                await commandHandlers.handleProfile(this.bot, msg, database);
            } catch (error) {
                console.error('Error handling profile command:', error);
                await this.bot.sendMessage(msg.chat.id, 'Sorry, something went wrong. Please try again.');
            }
        });

        // Tasks command
        this.bot.onText(/\/tasks/, async (msg) => {
            try {
                await commandHandlers.handleTasks(this.bot, msg, database);
            } catch (error) {
                console.error('Error handling tasks command:', error);
                await this.bot.sendMessage(msg.chat.id, 'Sorry, something went wrong. Please try again.');
            }
        });

        // Leaderboard command
        this.bot.onText(/\/leaderboard/, async (msg) => {
            try {
                await commandHandlers.handleLeaderboard(this.bot, msg, database);
            } catch (error) {
                console.error('Error handling leaderboard command:', error);
                await this.bot.sendMessage(msg.chat.id, 'Sorry, something went wrong. Please try again.');
            }
        });

        // Admin commands
        this.bot.onText(/\/admin/, async (msg) => {
            try {
                await commandHandlers.handleAdmin(this.bot, msg, database);
            } catch (error) {
                console.error('Error handling admin command:', error);
                await this.bot.sendMessage(msg.chat.id, 'Sorry, something went wrong. Please try again.');
            }
        });
    }

    setupCallbackHandlers() {
        this.bot.on('callback_query', async (callbackQuery) => {
            try {
                const data = callbackQuery.data;
                const msg = callbackQuery.message;

                if (data.startsWith('open_webapp')) {
                    await callbackHandlers.handleOpenWebApp(this.bot, callbackQuery, database);
                } else if (data.startsWith('join_channel')) {
                    await callbackHandlers.handleJoinChannel(this.bot, callbackQuery, database);
                } else if (data.startsWith('join_group')) {
                    await callbackHandlers.handleJoinGroup(this.bot, callbackQuery, database);
                } else if (data.startsWith('invite_friend')) {
                    await callbackHandlers.handleInviteFriend(this.bot, callbackQuery, database);
                } else if (data.startsWith('verify_join')) {
                    await callbackHandlers.handleVerifyJoin(this.bot, callbackQuery, database);
                } else if (data.startsWith('admin_')) {
                    await callbackHandlers.handleAdminCallback(this.bot, callbackQuery, database);
                }

                // Answer callback query to remove loading state
                await this.bot.answerCallbackQuery(callbackQuery.id);

            } catch (error) {
                console.error('Error handling callback query:', error);
                await this.bot.answerCallbackQuery(callbackQuery.id, {
                    text: 'Sorry, something went wrong. Please try again.',
                    show_alert: true
                });
            }
        });
    }

    setupErrorHandling() {
        this.bot.on('error', (error) => {
            console.error('Bot error:', error);
        });

        this.bot.on('polling_error', (error) => {
            console.error('Polling error:', error);
        });

        // Graceful shutdown
        process.on('SIGINT', async () => {
            console.log('Shutting down bot...');
            if (this.bot) {
                this.bot.stopPolling();
            }
            if (database) {
                await database.close();
            }
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            console.log('Shutting down bot...');
            if (this.bot) {
                this.bot.stopPolling();
            }
            if (database) {
                await database.close();
            }
            process.exit(0);
        });
    }

    async stop() {
        if (this.bot) {
            this.bot.stopPolling();
        }
        if (database) {
            await database.close();
        }
        this.isRunning = false;
        console.log('Bot stopped');
    }
}

// Start the bot
const bot = new TGTaskBot();
bot.initialize().catch(console.error);

module.exports = TGTaskBot;
