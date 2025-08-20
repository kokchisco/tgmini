# 🚀 Deployment Guide

This guide will help you deploy your TGTask Bot to production with cost-effective hosting options.

## 📋 Prerequisites

1. **Telegram Bot Token** - Get from @BotFather
2. **Domain Name** (optional for development)
3. **GitHub Account** (for deployment)
4. **Node.js 16+** (for local testing)

## 🌐 Hosting Options

### 1. Railway (Recommended - $5-20/month)

**Why Railway?**
- Easy deployment
- Auto-scaling
- PostgreSQL included
- Great for high traffic
- Free tier available

**Steps:**
1. Install Railway CLI:
   ```bash
   npm install -g @railway/cli
   ```

2. Login to Railway:
   ```bash
   railway login
   ```

3. Initialize project:
   ```bash
   railway init
   ```

4. Set environment variables:
   ```bash
   railway variables set BOT_TOKEN=your_bot_token
   railway variables set WEBAPP_URL=https://your-app.railway.app
   railway variables set ADMIN_USER_ID=your_telegram_id
   railway variables set JWT_SECRET=your_jwt_secret
   railway variables set SESSION_SECRET=your_session_secret
   ```

5. Deploy:
   ```bash
   railway up
   ```

### 2. Render (Free tier available)

**Steps:**
1. Connect your GitHub repo to Render
2. Create a new Web Service
3. Set build command: `npm install && npm run db:migrate`
4. Set start command: `npm start`
5. Add environment variables in Render dashboard
6. Deploy

### 3. DigitalOcean App Platform ($5-12/month)

**Steps:**
1. Create app from GitHub repo
2. Set environment variables
3. Configure build and run commands
4. Deploy

### 4. VPS (Cheapest - $5-10/month)

**Steps:**
1. Get a VPS from DigitalOcean/Linode/Vultr
2. Install Node.js and PM2:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   npm install -g pm2
   ```

3. Clone and setup:
   ```bash
   git clone <your-repo>
   cd tgtask
   npm install
   npm run db:migrate
   ```

4. Create ecosystem file:
   ```bash
   # ecosystem.config.js
   module.exports = {
     apps: [
       {
         name: 'tgtask-bot',
         script: 'src/bot/index.js',
         env: {
           NODE_ENV: 'production',
           BOT_TOKEN: 'your_bot_token',
           WEBAPP_URL: 'https://your-domain.com',
           ADMIN_USER_ID: 'your_telegram_id'
         }
       },
       {
         name: 'tgtask-webapp',
         script: 'src/webapp/server.js',
         env: {
           NODE_ENV: 'production',
           WEBAPP_PORT: 3001
         }
       }
     ]
   };
   ```

5. Start with PM2:
   ```bash
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup
   ```

## 🔧 Environment Variables

Create a `.env` file with these variables:

```env
# Required
BOT_TOKEN=your_telegram_bot_token
WEBAPP_URL=https://your-domain.com
ADMIN_USER_ID=your_telegram_user_id

# Optional (with defaults)
PORT=3000
WEBAPP_PORT=3001
NODE_ENV=production
JWT_SECRET=your_jwt_secret_here
SESSION_SECRET=your_session_secret_here
POINTS_PER_CHANNEL_JOIN=10
POINTS_PER_GROUP_JOIN=15
POINTS_PER_FRIEND_INVITE=25
DAILY_TASK_LIMIT=5
```

## 🤖 Bot Setup

1. **Create Bot with @BotFather:**
   - Message @BotFather on Telegram
   - Use `/newbot` command
   - Choose bot name and username
   - Save the bot token

2. **Configure Web App:**
   - Use `/setmenubutton` command
   - Set your web app URL
   - Configure menu button text

3. **Set Commands:**
   ```
   /start - Start the bot
   /help - Show help
   /profile - View profile
   /tasks - View tasks
   /leaderboard - View leaderboard
   /admin - Admin panel
   ```

## 🔒 Security Checklist

- [ ] Use HTTPS in production
- [ ] Set strong JWT and session secrets
- [ ] Enable rate limiting
- [ ] Use environment variables for secrets
- [ ] Regular security updates
- [ ] Database backups

## 📊 Monitoring

### Railway/Render/DigitalOcean
- Built-in monitoring dashboards
- Automatic scaling
- Log viewing

### VPS
- PM2 monitoring: `pm2 monit`
- Log viewing: `pm2 logs`
- Process management: `pm2 status`

## 🔄 Updates

### Automated (Railway/Render/DigitalOcean)
- Connect GitHub repo
- Automatic deployments on push

### Manual (VPS)
```bash
git pull origin main
npm install
npm run db:migrate
pm2 restart all
```

## 🐛 Troubleshooting

### Bot Not Responding
1. Check bot token
2. Verify bot is not blocked
3. Check server logs
4. Ensure bot is running

### Web App Not Loading
1. Check WEBAPP_URL
2. Verify HTTPS certificate
3. Check CORS settings
4. Test API endpoints

### Database Issues
1. Run migration: `npm run db:migrate`
2. Check database permissions
3. Verify connection string
4. Check disk space

## 💰 Cost Comparison

| Platform | Cost/Month | Pros | Cons |
|----------|------------|------|------|
| Railway | $5-20 | Easy, auto-scaling | Limited free tier |
| Render | $7-25 | Good performance | Higher cost |
| DigitalOcean | $5-12 | Reliable | Manual setup |
| VPS | $5-10 | Cheapest, full control | Manual management |

## 🚀 Production Checklist

- [ ] Environment variables configured
- [ ] Database migrated
- [ ] Bot token set
- [ ] Web app URL configured
- [ ] HTTPS enabled
- [ ] Domain configured
- [ ] Monitoring set up
- [ ] Backups configured
- [ ] Security measures in place
- [ ] Bot commands configured

## 📞 Support

If you encounter issues:
1. Check the logs
2. Verify environment variables
3. Test locally first
4. Check platform documentation
5. Create an issue on GitHub

---

**Note**: Start with Railway for the easiest deployment experience. It's cost-effective and handles most of the complexity for you.
