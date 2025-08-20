# 🔧 TGTask Bot Admin Guide

## How to Access the Admin Panel

### Method 1: Using Bot Command
1. Send `/admin` to your bot in Telegram
2. Click "🎯 Open Admin Panel" button
3. The admin panel will open in a web interface

### Method 2: Direct URL Access
1. Open your browser
2. Go to: `https://your-domain.com/admin?user_id=YOUR_TELEGRAM_ID`
3. Replace `YOUR_TELEGRAM_ID` with your actual Telegram user ID

## Admin Panel Features

### 📊 Dashboard
- **Total Users**: Number of registered users
- **Active Today**: Users who completed tasks today
- **Total Points**: Sum of all points in the system
- **Pending Withdrawals**: Withdrawal requests awaiting approval
- **Recent Activity**: Latest user actions

### ⚙️ Configuration

#### Points Configuration
- **Channel Join Points**: Points awarded for joining channels (default: 10)
- **Group Join Points**: Points awarded for joining groups (default: 15)
- **Friend Invite Points**: Points awarded for inviting friends (default: 25)
- **Daily Task Limit**: Maximum tasks per day (default: 5)

#### Withdrawal Configuration
- **Minimum Withdrawal**: Minimum amount users can withdraw (default: ₦1,000)
- **Maximum Withdrawal**: Maximum amount users can withdraw (default: ₦50,000)
- **Withdrawal Fee**: Percentage fee on withdrawals (default: 5%)
- **Bank Edit Fee**: Points required to edit bank details (default: 3,000)

#### Daily Claims Configuration
- **Daily Claims Limit**: Number of daily reward claims (default: 5)
- **Minimum Claim Amount**: Minimum random reward (default: 50 points)
- **Maximum Claim Amount**: Maximum random reward (default: 500 points)
- **Bonus Claims per Friends**: Extra claims per friend milestone (default: 2)
- **Friends Required for Bonus**: Friends needed for bonus claims (default: 10)

#### Support Configuration
- **Support Username**: Username for user support (default: @support_username)

### 📋 Tasks Management
- **Add Channels**: Create new channel tasks
- **Add Groups**: Create new group tasks
- **View Current Tasks**: See all active tasks
- **Enable/Disable Tasks**: Toggle task availability
- **Delete Tasks**: Remove tasks from the system

### 👥 User Management
- **View All Users**: See registered users with their stats
- **User Details**: View individual user information
- **User Rankings**: See user leaderboard

### 💰 Withdrawal Management
- **View Pending Withdrawals**: See withdrawal requests
- **Approve Withdrawals**: Process approved withdrawals
- **Reject Withdrawals**: Reject and refund points
- **Withdrawal History**: View all withdrawal transactions

## Environment Variables Setup

Copy the `config.example.env` file to `.env` and configure:

```bash
# Required Settings
BOT_TOKEN=your_bot_token_from_botfather
ADMIN_USER_ID=your_telegram_user_id
WEBAPP_URL=https://your-domain.com/webapp

# Optional: Customize these values
POINTS_PER_CHANNEL_JOIN=10
POINTS_PER_GROUP_JOIN=15
MIN_WITHDRAWAL_AMOUNT=1000
DAILY_CLAIMS_LIMIT=5
```

## How to Find Your Telegram User ID

1. Send a message to @userinfobot on Telegram
2. It will reply with your user ID
3. Use this ID in the `ADMIN_USER_ID` environment variable

## Security Best Practices

1. **Keep Admin ID Secret**: Don't share your admin user ID
2. **Use Strong Secrets**: Generate random JWT and session secrets
3. **HTTPS Only**: Always use HTTPS in production
4. **Regular Backups**: Backup your database regularly
5. **Monitor Logs**: Check server logs for suspicious activity

## Common Admin Tasks

### Adding a New Channel Task
1. Go to Tasks tab in admin panel
2. Fill in channel details:
   - Channel Name: Display name
   - Channel Username/ID: @channel or -1001234567890
   - Points Reward: Points to award
3. Click "Add Channel"

### Adding a New Group Task
1. Go to Tasks tab in admin panel
2. Fill in group details:
   - Group Name: Display name
   - Group Username/ID: @group or -1001234567890
   - Points Reward: Points to award
3. Click "Add Group"

### Processing Withdrawals
1. Go to Withdrawals tab
2. Review withdrawal requests
3. Click "Approve" to process or "Reject" to refund points
4. Rejected withdrawals automatically refund points to users

### Updating Configuration
1. Go to Configuration tab
2. Modify the desired settings
3. Click "Save" for each section
4. Changes take effect immediately

## Troubleshooting

### Admin Panel Not Loading
- Check if your Telegram ID matches `ADMIN_USER_ID`
- Ensure the webapp server is running
- Check browser console for errors

### Configuration Not Saving
- Check server logs for errors
- Ensure database is accessible
- Verify environment variables are set

### Users Can't Access Features
- Check if tasks are enabled
- Verify point configurations
- Ensure withdrawal limits are reasonable

## Support

For technical support or questions:
- Check the server logs
- Review the configuration
- Contact the development team

---

**Note**: This admin panel gives you full control over the bot. Use it responsibly and always backup your data before making major changes.
