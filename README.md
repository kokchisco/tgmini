# TGTask Bot - Telegram Mini-App

A Telegram bot with mini-app functionality that allows users to complete tasks (join channels, groups, invite friends) to earn points, similar to Hamster Combat.

## 🚀 Features

- **Task System**: Join channels and groups to earn points
- **Friend Invitations**: Invite friends and earn bonus points
- **Daily Login**: Claim daily login bonuses
- **Leaderboard**: Compete with other users
- **Mini-App Interface**: Beautiful web interface accessible via Telegram
- **Admin Panel**: Manage channels, groups, and view statistics
- **Points System**: Earn points for completing various tasks
- **Daily Limits**: Prevent abuse with daily task limits

## 🛠️ Tech Stack

- **Backend**: Node.js with Express.js
- **Database**: SQLite (development) / PostgreSQL (production)
- **Telegram Bot API**: node-telegram-bot-api
- **Frontend**: HTML/CSS/JavaScript with Telegram Web App API
- **Security**: Helmet, CORS, Rate limiting

## 📋 Prerequisites

- Node.js 16+ installed
- Telegram Bot Token (get from @BotFather)
- Domain name for production (optional for development)

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd tgtask
npm install
```

### 2. Environment Setup

Copy the environment template and configure it:

```bash
cp env.example .env
```

Edit `.env` file with your configuration:

```env
# Telegram Bot Configuration
BOT_TOKEN=your_telegram_bot_token_here
WEBAPP_URL=https://your-domain.com/webapp

# Database Configuration
DATABASE_URL=sqlite:./database/tgtask.db

# Server Configuration
PORT=3000
WEBAPP_PORT=3001
NODE_ENV=development

# Security
JWT_SECRET=your_jwt_secret_here
SESSION_SECRET=your_session_secret_here

# Admin Configuration
ADMIN_USER_ID=your_telegram_user_id_here

# Task Configuration
POINTS_PER_CHANNEL_JOIN=10
POINTS_PER_GROUP_JOIN=15
POINTS_PER_FRIEND_INVITE=25
DAILY_TASK_LIMIT=5
```

### 3. Database Setup

Run the database migration to create tables and seed initial data:

```bash
npm run db:migrate
```

### 4. Start the Bot

```bash
# Start the Telegram bot
npm start

# In another terminal, start the web app server
npm run webapp
```

### 5. Configure Bot with BotFather

1. Message @BotFather on Telegram
2. Create a new bot: `/newbot`
3. Set bot name and username
4. Get the bot token and add it to `.env`
5. Set up the web app: `/setmenubutton`
6. Configure the menu button with your web app URL

## 🏗️ Project Structure

```
tgtask/
├── src/
│   ├── bot/                 # Telegram bot logic
│   │   ├── handlers/        # Command and callback handlers
│   │   └── index.js         # Main bot entry point
│   ├── webapp/              # Mini-app web interface
│   │   ├── static/          # HTML/CSS/JS files
│   │   └── server.js        # Web app server
│   ├── services/            # Business logic services
│   │   ├── userService.js   # User management
│   │   └── taskService.js   # Task management
│   └── database/            # Database utilities
│       ├── connection.js    # Database connection
│       └── migrate.js       # Database migration
├── database/                # SQLite database files
├── package.json
├── env.example
└── README.md
```

## 🎯 Available Commands

- `/start` - Welcome message and mini-app access
- `/help` - Show help information
- `/profile` - View user profile and statistics
- `/tasks` - View available tasks
- `/leaderboard` - View top players
- `/admin` - Admin panel (admin only)

## 🔧 Configuration

### Bot Token
Get your bot token from @BotFather on Telegram.

### Admin User ID
Set your Telegram user ID as admin to access admin features.

### Points Configuration
- `POINTS_PER_CHANNEL_JOIN`: Points for joining channels (default: 10)
- `POINTS_PER_GROUP_JOIN`: Points for joining groups (default: 15)
- `POINTS_PER_FRIEND_INVITE`: Points for inviting friends (default: 25)
- `DAILY_TASK_LIMIT`: Maximum tasks per day (default: 5)

## 🌐 Deployment Options

### 1. Railway (Recommended - Cheap & Easy)

**Cost**: $5-20/month
**Pros**: Easy deployment, auto-scaling, PostgreSQL included

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

### 2. Render

**Cost**: $7-25/month (free tier available)
**Pros**: Good performance, PostgreSQL support

1. Connect your GitHub repo
2. Set environment variables
3. Deploy automatically

### 3. DigitalOcean App Platform

**Cost**: $5-12/month
**Pros**: Reliable, scalable, managed databases

1. Create app from GitHub
2. Configure environment variables
3. Deploy

### 4. VPS (DigitalOcean, Linode, etc.)

**Cost**: $5-10/month
**Pros**: Full control, cheapest option

```bash
# Install Node.js and PM2
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install -g pm2

# Clone and setup
git clone <your-repo>
cd tgtask
npm install
npm run db:migrate

# Start with PM2
pm2 start src/bot/index.js --name "tgtask-bot"
pm2 start src/webapp/server.js --name "tgtask-webapp"
pm2 save
pm2 startup
```

## 🔒 Security Features

- **Rate Limiting**: Prevents API abuse
- **CORS Protection**: Secure cross-origin requests
- **Helmet**: Security headers
- **Input Validation**: Sanitized user inputs
- **SQL Injection Protection**: Parameterized queries

## 📊 Database Schema

### Users Table
- User information and points
- Task completion tracking
- Friend invitation counts

### Tasks Table
- Task completion history
- Points earned per task
- Task types (channel_join, group_join, friend_invite, daily_login)

### Channels/Groups Tables
- Available channels and groups
- Points rewards
- Active/inactive status

### User Joins Tables
- Track user channel/group memberships
- Prevent duplicate joins

## 🎨 Customization

### Styling
Edit `src/webapp/static/index.html` to customize the mini-app appearance.

### Task Types
Add new task types in `src/services/taskService.js`.

### Points System
Modify point values in `.env` file.

## 🐛 Troubleshooting

### Bot Not Responding
1. Check bot token in `.env`
2. Ensure bot is not blocked by users
3. Check server logs for errors

### Database Issues
1. Run `npm run db:migrate` to recreate tables
2. Check database file permissions
3. Verify SQLite installation

### Web App Not Loading
1. Check `WEBAPP_URL` in `.env`
2. Ensure web app server is running
3. Verify domain SSL certificate

## 📈 Monitoring

### Logs
- Bot logs: Check console output
- Web app logs: Check server console
- Database logs: Check SQLite file

### Performance
- Monitor response times
- Check database query performance
- Monitor memory usage

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

For support and questions:
- Create an issue on GitHub
- Contact: your-email@example.com

## 🔄 Updates

To update the bot:

```bash
git pull origin main
npm install
npm run db:migrate
pm2 restart all
```

---

**Note**: This bot is designed for educational purposes. Ensure compliance with Telegram's Terms of Service and local regulations when deploying.
