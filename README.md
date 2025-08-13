# War Thunder Squadron Battle Tracker Bot

A Discord bot that monitors War Thunder squadron battle results and sends real-time notifications when battles complete. The bot tracks squadron rating changes, win/loss records, and provides detailed battle result notifications with rich embeds.

## Features

- 🎯 **Real-time Monitoring**: Checks squadron stats every 2-3 minutes
- 🎮 **Battle Detection**: Automatically detects when new battles complete
- 📊 **Rich Notifications**: Beautiful Discord embeds with color-coded results
- 🏆 **Rating Tracking**: Shows rating changes (+/- points) after each battle
- ⚔️ **Win/Loss Records**: Tracks and displays updated W-L statistics
- 🔄 **Error Handling**: Robust retry logic and graceful error recovery
- ⚙️ **Configurable**: Easy to customize for different squadrons and settings

## Prerequisites

- Node.js 16.0.0 or higher
- Discord Bot Token (from Discord Developer Portal)
- Discord Channel ID where notifications will be sent

## Installation

1. **Clone or download this repository**
   ```bash
   git clone <repository-url>
   cd THCbot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and add your Discord bot token:
   ```
   DISCORD_BOT_TOKEN=your_actual_bot_token_here
   ```

4. **Configure squadron settings**
   Edit `config.json` with your squadron details:
   ```json
   {
     "squadronName": "Your Squadron Name",
     "channelId": "your_discord_channel_id",
     "checkIntervalMinutes": 3,
     "retryAttempts": 3,
     "requestTimeoutMs": 10000
   }
   ```

## Discord Bot Setup

### 1. Create Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name
3. Go to the "Bot" section and click "Add Bot"
4. Copy the bot token (keep this secret!)

### 2. Configure Bot Permissions

In the Discord Developer Portal, under "Bot":
- Enable "Send Messages" permission
- Enable "Embed Links" permission
- Enable "Read Message History" permission

### 3. Invite Bot to Server

1. Go to "OAuth2" → "URL Generator"
2. Select "bot" scope
3. Select permissions: "Send Messages", "Embed Links", "Read Message History"
4. Copy the generated URL and open it in your browser
5. Select your Discord server and authorize the bot

### 4. Get Channel ID

1. Enable Developer Mode in Discord (User Settings → Advanced → Developer Mode)
2. Right-click on the channel where you want notifications
3. Click "Copy ID"
4. Paste this ID into your `config.json`

## Configuration

### config.json Options

| Option | Description | Default |
|--------|-------------|---------|
| `squadronName` | War Thunder squadron name (as it appears in the URL) | "Try Hard Coalition" |
| `channelId` | Discord channel ID for notifications | Required |
| `checkIntervalMinutes` | How often to check for updates (minutes) | 3 |
| `retryAttempts` | Number of retry attempts for failed requests | 3 |
| `requestTimeoutMs` | HTTP request timeout in milliseconds | 10000 |

### Squadron Name Format

The squadron name should match exactly how it appears in the War Thunder URL:
- For "Try Hard Coalition" → `"Try Hard Coalition"`
- For "ELITE SQUADRON" → `"ELITE SQUADRON"`
- Spaces and special characters are automatically URL-encoded

## Running the Bot

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

### Using PM2 (Recommended for Production)
```bash
# Install PM2 globally
npm install -g pm2

# Start the bot with PM2
pm2 start bot.js --name "warthunder-bot"

# View logs
pm2 logs warthunder-bot

# Stop the bot
pm2 stop warthunder-bot

# Restart the bot
pm2 restart warthunder-bot
```

## Bot Behavior

### Initial Startup
- Bot establishes baseline squadron stats
- First check doesn't trigger notifications (prevents false positives)
- Starts monitoring cycle after initial check

### Battle Detection
- Compares current stats with previous stats
- Detects new battles when total battle count increases
- Determines win/loss by checking which counter increased

### Notification Format

**Victory Example:**
```
🎉 Squadron Battle Complete
Try Hard Coalition - Victory

📊 Result: Victory
📈 Rating Change: +25
🏆 Current Rating: 1250
⚔️ Record: 15W - 3L
📊 Total Battles: 18
🕐 Timestamp: Today at 3:45 PM
```

**Defeat Example:**
```
💀 Squadron Battle Complete
Try Hard Coalition - Defeat

📊 Result: Defeat
📈 Rating Change: -18
🏆 Current Rating: 1207
⚔️ Record: 15W - 4L
📊 Total Battles: 19
🕐 Timestamp: Today at 4:12 PM
```

## Error Handling

The bot includes comprehensive error handling:

- **Network Issues**: Automatic retry with exponential backoff
- **Rate Limiting**: Respects Discord API rate limits
- **Parsing Errors**: Multiple fallback methods for data extraction
- **Discord Errors**: Continues monitoring even if notification fails
- **Graceful Shutdown**: Proper cleanup on SIGINT/SIGTERM

## Troubleshooting

### Bot Won't Start
- Check that `DISCORD_BOT_TOKEN` is set correctly in `.env`
- Verify `config.json` syntax is valid
- Ensure Node.js version is 16.0.0 or higher

### Cloudflare Protection (403 Errors)
**This is the most common issue** - War Thunder uses Cloudflare protection that blocks automated requests:

- ✅ **Expected behavior**: The bot will show `Request failed with status code 403`
- 🔄 **Bot continues running**: It will keep trying every 5 minutes
- 💡 **Intermittent success**: Sometimes requests will work through Cloudflare
- ⚠️ **Status notification**: Bot sends a Discord message explaining the situation

**Solutions:**
1. **Wait and let it run** - Cloudflare protection may allow some requests through
2. **Increase check interval** - Change `checkIntervalMinutes` to 10+ in `config.json`
3. **Use manual updates** - Implement the manual data input feature (see below)

### No Notifications
- Verify channel ID is correct in `config.json`
- Check bot has proper permissions in Discord channel
- Ensure squadron name matches exactly (case-sensitive)
- Check console logs for error messages
- Look for the bot's status message in Discord channel

### Incorrect Data
- Squadron page structure may have changed
- Check War Thunder website is accessible
- Verify squadron name is correct and public
- Try accessing the URL manually: `https://warthunder.com/en/community/claninfo/Your%20Squadron%20Name`

### Bot Crashes
- Check logs for error messages
- Ensure adequate memory and CPU resources
- Consider using PM2 for automatic restarts

## Manual Data Input (Cloudflare Workaround)

If Cloudflare protection prevents automatic scraping, you can manually trigger battle result notifications:

1. **Create a manual trigger** by sending a message in the monitored channel
2. **The bot monitors for specific commands** (this feature can be added)
3. **Input format**: `!battle win 1250 15 3` (result, new rating, wins, losses)

*Note: This manual feature would require additional development to implement Discord slash commands.*

## Development

### Adding New Features
The bot is built with modularity in mind:

- `scrapeSquadronData()`: Modify to extract additional stats
- `compareAndNotify()`: Add new comparison logic
- `sendNotification()`: Customize embed appearance
- `config.json`: Add new configuration options

### Testing Changes
```bash
# Test with development environment
NODE_ENV=development npm run dev
```

### Logs and Debugging
The bot provides detailed console logging:
- ✅ Success operations (green checkmark)
- ❌ Error operations (red X)
- 🔍 Information gathering (magnifying glass)
- 🎮 Battle detection (game controller)

## Security Notes

- Never commit your `.env` file or bot tokens
- Keep bot tokens secure and regenerate if compromised
- Use environment variables for all sensitive data
- Regularly update dependencies for security patches

## License

MIT License - See LICENSE file for details

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review console logs for error messages
3. Ensure all configuration is correct
4. Verify Discord bot permissions

## Changelog

### v1.0.0
- Initial release
- War Thunder squadron monitoring
- Discord rich embed notifications
- Comprehensive error handling
- Production-ready deployment
