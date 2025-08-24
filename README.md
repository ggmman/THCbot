# War Thunder Squadron Battle Tracker Bot

A Discord bot that monitors War Thunder squadron battle results and sends real-time notifications when battles complete. The bot tracks squadron rating changes, win/loss records, and provides detailed battle result notifications with rich embeds.

## Features

- 🎯 **Real-time Monitoring**: Uses War Thunder API for frequent updates and accurate data
- 🎮 **Battle Detection**: Automatically detects single and multiple battles between checks
- 📊 **Rich Notifications**: Beautiful Discord embeds with color-coded results
- 🏆 **Rating Tracking**: Shows rating changes (+/- points) after each battle
- ⚔️ **Win/Loss Records**: Tracks and displays updated W-L statistics
- 🎮 **Gaming Sessions**: Automatic session tracking with detailed statistics
- 💬 **Slash Commands**: Interactive commands for real-time squadron information
- 🏅 **Leaderboard Integration**: Shows current rank and nearby competitors
- 🔄 **Multi-Battle Detection**: Captures multiple battles that happen between updates
- 🎤 **Voice Queue Tracking**: Monitor voice channel join times for game queues
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
- Enable "Use Slash Commands" permission

### 3. Invite Bot to Server

1. Go to "OAuth2" → "URL Generator"
2. Select "bot" and "applications.commands" scopes
3. Select permissions: "Send Messages", "Embed Links", "Read Message History", "Use Slash Commands"
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
| `voiceChannelId` | Discord voice channel ID for queue monitoring | Optional |
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

## Slash Commands

The bot provides several powerful commands for real-time squadron information:

### `/rank` - Squadron Leaderboard Position

Shows your squadron's current rank and nearby competitors:

```
🏆 Squadron Leaderboard Rank
Try Hard Coalition

📍 Current Rank: #22
⭐ Squadron Rating: 38,112

⬆️ Squadron Above
Black_Wolves_Germany (#21)
38,163 points (+51 needed)

⬇️ Squadron Below  
Valiant Crew of Misfits (#23)
37,980 points (132 ahead)
```

### `/top` - Top Squadron Players

Shows the top 20 players in your squadron with their ratings:

```
👥 Top Squadron Players
Try Hard Coalition - Top 20 Players

🏆 Player Rankings
🥇 PlayerOne - 15,432
🥈 TopAce - 14,876  
🥉 SkyDominator - 14,321
4. WingCommander - 13,987
5. AirSuperiority - 13,654
6. FighterPilot - 13,298
...
20. Mustang - 8,654
```

### `/queue` - Voice Channel Queue

Shows who's currently in the monitored voice channel with their points and wait time:

```
🎮 Voice Channel Queue

Queue Position | Player | Points | Wait Time

🥇 1. PlayerOne - 14,521 pts - 12m 34s
🥈 2. PlayerTwo - 13,234 pts - 8m 12s  
🥉 3. PlayerThree - 12,890 pts - 5m 45s
📍 4. PlayerFour - Unknown pts - 2m 10s

Total players in queue: 4 | Points found for: 3/4
```

### `/sqbbr` - Squadron Battle BR Schedule

Shows the current week's BR and the full season schedule:

```
🎯 Squadron Battle BR Schedule

🔥 Current BR: 12.0 (07.07 - 13.07)

Full Schedule:
   1st week BR 14.0 (01.07 - 06.07)
►  2nd week BR 12.0 (07.07 - 13.07)
   3rd week BR 10.7 (14.07 - 20.07)
   4th week BR 9.7 (21.07 - 27.07)
   5th week BR 8.7 (28.07 - 03.08)
   6th week BR 7.3 (04.08 - 10.08)
   7th week BR 6.3 (11.08 - 17.08)
   8th week BR 5.7 (18.08 - 24.08)
   Until the end of season BR 4.7 (25.08 - 31.08)

Dates in DD.MM format
```

### Command Usage

- Type `/rank` for leaderboard position information (uses fast API)
- Type `/top` for squadron player rankings (uses web scraping)
- Type `/queue` for voice channel queue status (requires voiceChannelId configuration)
- Type `/sqbbr` for squadron battle BR schedule and current week's BR
- Commands respond privately (only you can see the result)
- Work from any channel in your Discord server
- `/top` may take longer due to Cloudflare protection bypass

## Gaming Sessions

The bot automatically tracks gaming sessions:

### Session Detection
- **Starts**: When first battle is detected after inactivity
- **Continues**: As long as battles occur within 30 minutes
- **Ends**: After 30 minutes of no battle activity

### Session Features
- **Real-time tracking**: Win/loss count, rating changes, win rate
- **Battle history**: Individual battle results within the session
- **Multiple battle support**: Handles multiple battles between updates
- **Session summary**: Comprehensive end-of-session report

### Session Notifications

**Session Start:**
```
🎮 Gaming Session Started!
Try Hard Coalition is now in a gaming session

🏆 Starting Rating: 37,825
🕐 Session Started: Today at 3:30 PM
```

**Session End:**
```
🏁 Gaming Session Ended
Try Hard Coalition session summary

⏱️ Session Duration: 67 minutes
🎮 Battles Played: 5
📊 Session Record: 4W - 1L
📈 Rating Change: +287
🎯 Win Rate: 80%
🕐 Session Ended: Today at 4:37 PM

📋 Battle History
🎉 Battle 1: Victory (+95)
🎉 Battle 2: Victory (+112)  
💀 Battle 3: Defeat (-78)
🎉 Battles 4-5: 2W-0L (+158)
```

## Multi-Battle Detection

The bot intelligently handles multiple battles that occur between API checks:

### How It Works
- **Monitors all stats**: Rating, wins, losses independently
- **Detects multiple changes**: If wins increase by 2, reports 2 victories
- **Combined notifications**: Shows total battles and combined rating change
- **Accurate tracking**: Never misses battles regardless of update timing

### Example Scenarios

**Multiple Wins:**
```
🎉 Multiple Battles Completed
Try Hard Coalition - 2 Victories, 0 Defeats

⚔️ Battles: 2 battles
📊 Results: 2W - 0L
📈 Total Rating Change: +234
🏆 Current Rating: 38,346
```

**Mixed Results:**
```
⚖️ Multiple Battles Completed  
Try Hard Coalition - 1 Victory, 1 Defeat

⚔️ Battles: 2 battles
📊 Results: 1W - 1L
📈 Total Rating Change: +27
🏆 Current Rating: 38,139
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

### API Connection Issues
**Rare but possible** - War Thunder API might be temporarily unavailable:

- ✅ **Normal behavior**: Bot uses War Thunder's official leaderboard API
- 🔄 **Automatic retry**: Built-in retry logic with exponential backoff
- 💡 **High reliability**: API is much more stable than web scraping
- ⚠️ **Status notification**: Bot sends Discord message if API is persistently unavailable

**Solutions:**
1. **API issues are temporary** - The bot will automatically reconnect
2. **Check War Thunder status** - Verify the game servers are operational
3. **Restart if needed** - Restart the bot if issues persist for hours

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

### v2.1.0
- **👥 New `/top` Command**: Shows top 20 squadron players with ratings
- **🌐 Hybrid Data Sources**: API for leaderboards, web scraping for player data
- **🛡️ Advanced Cloudflare Bypass**: Multiple scraping strategies for player data
- **🎨 Enhanced Player Display**: Medal emojis and formatted ratings

### v2.0.0
- **🎯 API Integration**: Switched from web scraping to War Thunder's official leaderboard API
- **🔄 Multi-Battle Detection**: Detects and reports multiple battles between updates
- **💬 Slash Commands**: Added `/rank` interactive command
- **🎮 Gaming Sessions**: Automatic session tracking with detailed statistics
- **🏅 Leaderboard Integration**: Shows current rank and nearby competitors
- **⚡ Enhanced Reliability**: Much more stable and accurate than web scraping
- **📊 Improved Notifications**: Better battle result formatting and information

### v1.0.0
- Initial release
- War Thunder squadron monitoring
- Discord rich embed notifications
- Comprehensive error handling
- Production-ready deployment
