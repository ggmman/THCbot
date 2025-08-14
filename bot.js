const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const puppeteer = require('puppeteer');
const fs = require('fs');
require('dotenv').config();

class WarThunderSquadronBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages
            ]
        });

        // Load configuration
        this.config = this.loadConfig();
        
        // Track previous squadron stats
        this.previousStats = null;
        
        // Track if this is the first check (to avoid false positives on startup)
        this.isFirstCheck = true;
        
        // Session tracking system
        this.isSessionActive = false;
        this.sessionStartTime = null;
        this.sessionStats = {
            wins: 0,
            losses: 0,
            totalBattles: 0,
            startingRating: 0,
            battles: [] // Array to store individual battle details
        };
        this.lastActivityTime = null;
        this.sessionTimeoutMinutes = 30;
        this.sessionTimeoutInterval = null;
        
        // Browser instance management
        this.browser = null;
        this.page = null;
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Monitoring interval
        this.monitoringInterval = null;
    }

    loadConfig() {
        try {
            const configData = fs.readFileSync('./config.json', 'utf8');
            return JSON.parse(configData);
        } catch (error) {
            console.error('Failed to load config.json:', error.message);
            process.exit(1);
        }
    }

    setupEventHandlers() {
        this.client.once('ready', () => {
            console.log(`✅ Bot is ready! Logged in as ${this.client.user.tag}`);
            console.log(`🎯 Monitoring squadron: ${this.config.squadronName}`);
            console.log(`⏱️  Check interval: ${this.config.checkIntervalMinutes} minutes`);
            
            // Start monitoring
            this.startMonitoring();
        });

        this.client.on('error', (error) => {
            console.error('Discord client error:', error);
        });

        // Graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n🛑 Received SIGINT, shutting down gracefully...');
            this.shutdown();
        });

        process.on('SIGTERM', () => {
            console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
            this.shutdown();
        });
    }

    async startMonitoring() {
        // Initialize browser
        await this.initializeBrowser();
        
        // Wait a bit before first check to avoid immediate requests
        console.log('⏳ Waiting 5 seconds before first check...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Initial check to establish baseline
        await this.checkSquadronStats();
        
        // Set up recurring checks
        this.monitoringInterval = setInterval(async () => {
            await this.checkSquadronStats();
        }, this.config.checkIntervalMinutes * 60 * 1000);
    }

    async initializeBrowser() {
        try {
            console.log('🌐 Initializing browser...');
            
            this.browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-features=TranslateUI',
                    '--disable-ipc-flooding-protection'
                ],
                defaultViewport: {
                    width: 1366,
                    height: 768
                }
            });

            this.page = await this.browser.newPage();
            
            // Set realistic user agent
            await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            // Block unnecessary resources to speed up loading
            await this.page.setRequestInterception(true);
            this.page.on('request', (req) => {
                const resourceType = req.resourceType();
                if (resourceType === 'image' || resourceType === 'stylesheet' || resourceType === 'font') {
                    req.abort();
                } else {
                    req.continue();
                }
            });
            
            // Set extra headers
            await this.page.setExtraHTTPHeaders({
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8'
            });

            console.log('✅ Browser initialized successfully');
            
        } catch (error) {
            console.error('❌ Failed to initialize browser:', error.message);
            throw error;
        }
    }

    async checkSquadronStats() {
        try {
            console.log(`🔍 Checking squadron stats for ${this.config.squadronName}...`);
            
            const stats = await this.scrapeSquadronData();
            
            if (!stats) {
                console.log('❌ Failed to scrape squadron data - this is normal due to Cloudflare protection');
                console.log('💡 The bot will continue monitoring. Web scraping may work intermittently.');
                
                // If this is the first run, send a status message
                if (this.isFirstCheck) {
                    await this.sendStatusMessage('⚠️ Bot started but unable to access War Thunder data due to Cloudflare protection. This is normal - the bot will keep trying.');
                    this.isFirstCheck = false;
                }
                return;
            }

            console.log(`📊 Current stats: Rating ${stats.rating}, W:${stats.wins} L:${stats.losses}`);

            // Send success message on first successful scrape
            if (this.isFirstCheck) {
                await this.sendStatusMessage(`✅ Successfully connected to War Thunder! Monitoring ${this.config.squadronName} - Rating: ${stats.rating}, Record: ${stats.wins}W-${stats.losses}L`);
            }

            // Compare with previous stats if available
            if (this.previousStats && !this.isFirstCheck) {
                await this.compareAndNotify(this.previousStats, stats);
            }

            // Update previous stats
            this.previousStats = stats;
            this.isFirstCheck = false;

        } catch (error) {
            console.error('Error checking squadron stats:', error.message);
        }
    }

    async scrapeSquadronData() {
        const maxRetries = 3;
        let retryCount = 0;

        while (retryCount < maxRetries) {
            try {
                // Ensure browser is available
                if (!this.browser || !this.page) {
                    await this.initializeBrowser();
                }

                const url = `https://warthunder.com/en/community/claninfo/${encodeURIComponent(this.config.squadronName)}`;
                console.log(`🌐 Navigating to: ${url}`);
                
                // Navigate to the page with extended timeout
                await this.page.goto(url, {
                    waitUntil: 'networkidle2',
                    timeout: 30000
                });

                // Add random delay to appear more human-like
                await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));

                // Wait for potential Cloudflare challenge
                console.log('⏳ Waiting for page to fully load (handling Cloudflare if present)...');
                try {
                    // Wait for either the main content or a Cloudflare challenge
                    await this.page.waitForFunction(
                        () => {
                            // Check if we have squadron content OR if Cloudflare challenge is present
                            const hasSquadronContent = document.querySelector('.squadron-info') || 
                                                     document.querySelector('[class*="squadron"]') ||
                                                     document.querySelector('[class*="rating"]');
                            const hasCloudflareChallenge = document.querySelector('[data-ray]') || 
                                                          document.querySelector('.cf-') ||
                                                          document.title.includes('Just a moment');
                            
                            return hasSquadronContent || hasCloudflareChallenge || document.readyState === 'complete';
                        },
                        { timeout: 20000 }
                    );
                } catch (waitError) {
                    console.log('⚠️ Page load timeout, proceeding anyway...');
                }

                // Additional wait for dynamic content
                await new Promise(resolve => setTimeout(resolve, 3000));

                // Check if we're on a Cloudflare challenge page
                const isCloudflareChallenge = await this.page.evaluate(() => {
                    return document.title.includes('Just a moment') || 
                           document.querySelector('[data-ray]') !== null ||
                           document.querySelector('.cf-') !== null ||
                           document.body.textContent.includes('Checking your browser');
                });

                if (isCloudflareChallenge) {
                    console.log('🛡️ Cloudflare challenge detected, waiting...');
                    // Wait longer for Cloudflare to resolve
                    await new Promise(resolve => setTimeout(resolve, 10000));
                    
                    // Wait for navigation away from challenge page
                    try {
                        await this.page.waitForFunction(
                            () => !document.title.includes('Just a moment') && 
                                  !document.body.textContent.includes('Checking your browser'),
                            { timeout: 30000 }
                        );
                        console.log('✅ Cloudflare challenge passed');
                    } catch (challengeError) {
                        throw new Error('Cloudflare challenge timeout');
                    }
                }

                // Extract squadron data using multiple strategies
                const squadronData = await this.page.evaluate(() => {
                    let rating = 0;
                    let wins = 0;
                    let losses = 0;
                    let totalBattles = 0;

                    // Strategy 1: Look for specific squadron elements
                    const ratingElement = document.querySelector('.squadron-info__rating .squadron-info__rating-value') ||
                                        document.querySelector('[class*="rating"] [class*="value"]') ||
                                        document.querySelector('.rating-value');
                    
                    if (ratingElement) {
                        const ratingText = ratingElement.textContent.trim();
                        rating = parseInt(ratingText.replace(/[^\d]/g, '')) || 0;
                    }

                    // Strategy 2: Look for battle statistics
                    const battleElements = document.querySelectorAll('.squadron-battles-info .squadron-battles-info__item, [class*="battle"] [class*="item"], .battle-stats .stat-item');
                    
                    battleElements.forEach(element => {
                        const text = element.textContent.toLowerCase();
                        const valueElement = element.querySelector('.squadron-battles-info__value, [class*="value"], .stat-value') || element;
                        const number = parseInt(valueElement.textContent.replace(/[^\d]/g, '')) || 0;
                        
                        if ((text.includes('win') || text.includes('victor')) && !text.includes('loss')) {
                            wins = number;
                        } else if (text.includes('loss') || text.includes('defeat')) {
                            losses = number;
                        } else if (text.includes('battle') && text.includes('total')) {
                            totalBattles = number;
                        }
                    });

                    // Strategy 3: Alternative selectors and text patterns
                    if (rating === 0) {
                        // Look for rating in various formats
                        const allText = document.body.textContent;
                        const ratingMatches = [
                            allText.match(/rating[:\s]*(\d{4,})/i),
                            allText.match(/очки[:\s]*(\d{4,})/i), // Russian
                            allText.match(/points[:\s]*(\d{4,})/i),
                            allText.match(/(\d{4,})\s*очк/i),
                            allText.match(/(\d{4,})\s*pts/i)
                        ];
                        
                        for (const match of ratingMatches) {
                            if (match && match[1]) {
                                rating = parseInt(match[1]);
                                break;
                            }
                        }
                        
                        // Look for rating in data attributes or JSON
                        const scriptTags = document.querySelectorAll('script');
                        for (const script of scriptTags) {
                            const content = script.textContent;
                            const jsonMatch = content.match(/"rating"[:\s]*(\d+)/i) || 
                                            content.match(/"score"[:\s]*(\d+)/i) ||
                                            content.match(/"points"[:\s]*(\d+)/i);
                            if (jsonMatch) {
                                rating = parseInt(jsonMatch[1]);
                                break;
                            }
                        }
                    }

                    // Strategy 4: Look for wins/losses in text patterns
                    if (wins === 0 || losses === 0) {
                        const allText = document.body.textContent;
                        const winsMatch = allText.match(/(?:wins?|victories|побед)[:\s]*(\d+)/i);
                        const lossesMatch = allText.match(/(?:losses?|defeats?|поражений)[:\s]*(\d+)/i);
                        
                        if (winsMatch) wins = parseInt(winsMatch[1]);
                        if (lossesMatch) losses = parseInt(lossesMatch[1]);
                    }

                    // Calculate total battles if not found
                    if (totalBattles === 0) {
                        totalBattles = wins + losses;
                    }

                    return {
                        rating,
                        wins,
                        losses,
                        totalBattles,
                        pageTitle: document.title,
                        hasContent: document.querySelector('.squadron-info') !== null || 
                                   document.querySelector('[class*="squadron"]') !== null
                    };
                });

                console.log(`📊 Extracted data: Rating ${squadronData.rating}, W:${squadronData.wins} L:${squadronData.losses}, Total:${squadronData.totalBattles}`);
                console.log(`📄 Page title: ${squadronData.pageTitle}`);

                // Validate extracted data
                if (squadronData.rating > 0 || squadronData.totalBattles > 0 || squadronData.hasContent) {
                    return {
                        rating: squadronData.rating,
                        wins: squadronData.wins,
                        losses: squadronData.losses,
                        totalBattles: squadronData.totalBattles,
                        timestamp: new Date()
                    };
                } else {
                    throw new Error('Could not extract valid squadron data from page');
                }

            } catch (error) {
                retryCount++;
                console.error(`Attempt ${retryCount} failed:`, error.message);
                
                // Close and recreate browser on error
                if (this.browser) {
                    try {
                        await this.browser.close();
                    } catch (closeError) {
                        console.error('Error closing browser:', closeError.message);
                    }
                    this.browser = null;
                    this.page = null;
                }
                
                if (retryCount < maxRetries) {
                    const delay = Math.pow(2, retryCount) * 3000; // Longer exponential backoff
                    console.log(`⏳ Retrying in ${delay/1000} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    console.error('❌ All retry attempts failed');
                    return null;
                }
            }
        }
    }

    async compareAndNotify(previousStats, currentStats) {
        // Check if rating changed (indicating a new battle completed)
        const ratingChanged = currentStats.rating !== previousStats.rating;
        
        if (!ratingChanged) {
            return; // No rating change
        }

        console.log('🎮 Rating change detected!');

        // Determine battle result based on rating change
        const ratingChange = currentStats.rating - previousStats.rating;
        
        let battleResult = 'Unknown';
        let color = 0xffff00; // Yellow for unknown
        let emoji = '❓';

        if (ratingChange > 0) {
            battleResult = 'Victory';
            color = 0x00ff00; // Green
            emoji = '🎉';
        } else if (ratingChange < 0) {
            battleResult = 'Defeat';
            color = 0xff0000; // Red
            emoji = '💀';
        } else {
            // This shouldn't happen since we already checked ratingChanged
            return;
        }

        // Start session if not active (before tracking the battle)
        if (!this.isSessionActive) {
            await this.startSession(currentStats);
        }

        // Update session activity timestamp
        this.updateSessionActivity();

        // Track battle result in session
        if (battleResult === 'Victory') {
            this.sessionStats.wins++;
        } else if (battleResult === 'Defeat') {
            this.sessionStats.losses++;
        }

        // Update session battle count
        this.sessionStats.totalBattles++;

        // Rating change was already calculated above
        const ratingChangeText = ratingChange > 0 ? `+${ratingChange}` : `${ratingChange}`;

        // Store battle details in session
        this.sessionStats.battles.push({
            result: battleResult,
            ratingChange: ratingChange,
            newRating: currentStats.rating,
            timestamp: new Date()
        });

        // Create Discord embed with session information
        const sessionWinRate = this.sessionStats.totalBattles > 0 ? 
            Math.round((this.sessionStats.wins / this.sessionStats.totalBattles) * 100) : 0;
        const sessionRatingChange = currentStats.rating - this.sessionStats.startingRating;
        const sessionRatingChangeText = sessionRatingChange > 0 ? `+${sessionRatingChange}` : `${sessionRatingChange}`;

        const embed = new EmbedBuilder()
            .setTitle(`${emoji} Squadron Battle Complete`)
            .setDescription(`**${this.config.squadronName}** - ${battleResult}`)
            .addFields(
                {
                    name: '📊 Result',
                    value: battleResult,
                    inline: true
                },
                {
                    name: '📈 Rating Change',
                    value: ratingChangeText,
                    inline: true
                },
                {
                    name: '🏆 Current Rating',
                    value: currentStats.rating.toString(),
                    inline: true
                },
                {
                    name: '🎮 Session Record',
                    value: `${this.sessionStats.wins}W - ${this.sessionStats.losses}L`,
                    inline: true
                },
                {
                    name: '🎯 Session Win Rate',
                    value: `${sessionWinRate}%`,
                    inline: true
                },
                {
                    name: '📈 Session Rating',
                    value: sessionRatingChangeText,
                    inline: true
                },
                {
                    name: '🕐 Timestamp',
                    value: `<t:${Math.floor(currentStats.timestamp.getTime() / 1000)}:F>`,
                    inline: true
                }
            )
            .setColor(color)
            .setFooter({
                text: `War Thunder Squadron Tracker • Battle ${this.sessionStats.totalBattles} of session`,
                iconURL: 'https://warthunder.com/favicon.ico'
            })
            .setTimestamp();

        // Send notification
        await this.sendNotification(embed);
    }

    async sendNotification(embed) {
        try {
            const channel = await this.client.channels.fetch(this.config.channelId);
            
            if (!channel) {
                console.error('❌ Could not find Discord channel');
                return;
            }

            await channel.send({ embeds: [embed] });
            console.log('✅ Notification sent to Discord');

        } catch (error) {
            console.error('❌ Failed to send Discord notification:', error.message);
        }
    }

    async sendStatusMessage(message) {
        try {
            const channel = await this.client.channels.fetch(this.config.channelId);
            
            if (!channel) {
                console.error('❌ Could not find Discord channel');
                return;
            }

            await channel.send(message);
            console.log('✅ Status message sent to Discord');

        } catch (error) {
            console.error('❌ Failed to send Discord status message:', error.message);
        }
    }

    async startSession(currentStats) {
        this.isSessionActive = true;
        this.sessionStartTime = new Date();
        this.lastActivityTime = new Date();
        this.sessionStats = {
            wins: 0,
            losses: 0,
            totalBattles: 0,
            startingRating: currentStats.rating,
            battles: []
        };
        
        console.log('🎮 Starting new gaming session!');
        
        // Send session start message
        const embed = new EmbedBuilder()
            .setTitle('🎮 Gaming Session Started!')
            .setDescription(`**${this.config.squadronName}** is now in a gaming session`)
            .addFields(
                {
                    name: '🏆 Starting Rating',
                    value: currentStats.rating.toString(),
                    inline: true
                },
                {
                    name: '🕐 Session Started',
                    value: `<t:${Math.floor(this.sessionStartTime.getTime() / 1000)}:F>`,
                    inline: true
                }
            )
            .setColor(0x00ff00)
            .setFooter({
                text: 'War Thunder Squadron Tracker',
                iconURL: 'https://warthunder.com/favicon.ico'
            })
            .setTimestamp();
        
        await this.sendNotification(embed);
        
        // Start session timeout monitoring
        this.startSessionTimeoutMonitoring();
    }

    async endSession() {
        if (!this.isSessionActive) return;
        
        console.log('🏁 Ending gaming session');
        
        // Calculate session statistics
        const sessionDuration = Math.floor((new Date() - this.sessionStartTime) / 1000 / 60); // minutes
        const ratingChange = this.sessionStats.battles.length > 0 ? 
            this.sessionStats.battles[this.sessionStats.battles.length - 1].newRating - this.sessionStats.startingRating : 0;
        const winRate = this.sessionStats.totalBattles > 0 ? 
            Math.round((this.sessionStats.wins / this.sessionStats.totalBattles) * 100) : 0;
        
        // Create session summary embed
        const embed = new EmbedBuilder()
            .setTitle('🏁 Gaming Session Ended')
            .setDescription(`**${this.config.squadronName}** session summary`)
            .addFields(
                {
                    name: '⏱️ Session Duration',
                    value: `${sessionDuration} minutes`,
                    inline: true
                },
                {
                    name: '🎮 Battles Played',
                    value: this.sessionStats.totalBattles.toString(),
                    inline: true
                },
                {
                    name: '📊 Session Record',
                    value: `${this.sessionStats.wins}W - ${this.sessionStats.losses}L`,
                    inline: true
                },
                {
                    name: '📈 Rating Change',
                    value: ratingChange > 0 ? `+${ratingChange}` : ratingChange.toString(),
                    inline: true
                },
                {
                    name: '🎯 Win Rate',
                    value: `${winRate}%`,
                    inline: true
                },
                {
                    name: '🕐 Session Ended',
                    value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
                    inline: true
                }
            )
            .setColor(ratingChange >= 0 ? 0x00ff00 : 0xff0000)
            .setFooter({
                text: 'War Thunder Squadron Tracker',
                iconURL: 'https://warthunder.com/favicon.ico'
            })
            .setTimestamp();
        
        // Add battle details if any
        if (this.sessionStats.battles.length > 0) {
            let battleDetails = '';
            this.sessionStats.battles.forEach((battle, index) => {
                const resultEmoji = battle.result === 'Victory' ? '🎉' : '💀';
                const ratingChangeText = battle.ratingChange > 0 ? `+${battle.ratingChange}` : `${battle.ratingChange}`;
                battleDetails += `${resultEmoji} Battle ${index + 1}: ${battle.result} (${ratingChangeText})\n`;
            });
            
            if (battleDetails.length > 1024) {
                battleDetails = battleDetails.substring(0, 1020) + '...';
            }
            
            embed.addFields({
                name: '📋 Battle History',
                value: battleDetails,
                inline: false
            });
        }
        
        await this.sendNotification(embed);
        
        // Reset session state
        this.resetSession();
    }

    resetSession() {
        this.isSessionActive = false;
        this.sessionStartTime = null;
        this.lastActivityTime = null;
        this.sessionStats = {
            wins: 0,
            losses: 0,
            totalBattles: 0,
            startingRating: 0,
            battles: []
        };
        
        if (this.sessionTimeoutInterval) {
            clearInterval(this.sessionTimeoutInterval);
            this.sessionTimeoutInterval = null;
        }
    }

    startSessionTimeoutMonitoring() {
        // Clear existing timeout if any
        if (this.sessionTimeoutInterval) {
            clearInterval(this.sessionTimeoutInterval);
        }
        
        // Check every minute for session timeout
        this.sessionTimeoutInterval = setInterval(() => {
            if (this.isSessionActive && this.lastActivityTime) {
                const timeSinceLastActivity = (new Date() - this.lastActivityTime) / 1000 / 60; // minutes
                
                if (timeSinceLastActivity >= this.sessionTimeoutMinutes) {
                    console.log(`⏰ Session timeout after ${this.sessionTimeoutMinutes} minutes of inactivity`);
                    this.endSession();
                }
            }
        }, 60000); // Check every minute
    }

    updateSessionActivity() {
        this.lastActivityTime = new Date();
    }

    async shutdown() {
        console.log('🔄 Shutting down bot...');
        
        // End active session if any
        if (this.isSessionActive) {
            console.log('🎮 Ending active session due to shutdown...');
            await this.endSession();
        }
        
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }
        
        if (this.sessionTimeoutInterval) {
            clearInterval(this.sessionTimeoutInterval);
        }
        
        // Close browser
        if (this.browser) {
            try {
                await this.browser.close();
                console.log('🌐 Browser closed');
            } catch (error) {
                console.error('Error closing browser:', error.message);
            }
        }
        
        if (this.client) {
            await this.client.destroy();
        }
        
        console.log('✅ Bot shutdown complete');
        process.exit(0);
    }

    async start() {
        try {
            console.log('🚀 Starting War Thunder Squadron Bot...');
            await this.client.login(process.env.DISCORD_BOT_TOKEN);
        } catch (error) {
            console.error('❌ Failed to start bot:', error.message);
            process.exit(1);
        }
    }
}

// Create and start the bot
const bot = new WarThunderSquadronBot();
bot.start().catch(console.error);
