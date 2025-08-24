const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require('discord.js');
const fs = require('fs');
const https = require('https');
const puppeteer = require('puppeteer');
require('dotenv').config();

class WarThunderSquadronBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.GuildVoiceStates
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
        this.sessionTimeoutMinutes = 60;
        this.sessionTimeoutInterval = null;
        
        // API request configuration
        this.apiBaseUrl = 'https://warthunder.com/en/community/getclansleaderboard/dif/_hist';
        this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Monitoring interval
        this.monitoringInterval = null;
        
        // Command definitions
        this.commands = this.setupCommands();
        
        // Browser instance for web scraping (used for periodic player data collection)
        this.browser = null;
        
        // Cached player data
        this.cachedPlayers = [];
        this.lastPlayerDataUpdate = null;
        this.playerDataInterval = null;
        
        // Voice channel queue tracking
        this.voiceQueue = new Map(); // Map<userId, { username: string, joinTime: Date }>
        this.voiceQueueHistory = new Map(); // Track join/leave history for better UX
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

    setupCommands() {
        const commands = [
            new SlashCommandBuilder()
                .setName('rank')
                .setDescription('Show current squadron leaderboard position and nearby competitors'),
            new SlashCommandBuilder()
                .setName('top')
                .setDescription('Show top 20 players in the squadron'),
            // new SlashCommandBuilder()
            //     .setName('players')
            //     .setDescription('Show all players in the squadron'),
            new SlashCommandBuilder()
                .setName('low')
                .setDescription('Show all players under 1300 points'),
            new SlashCommandBuilder()
                .setName('queue')
                .setDescription('Show the voice channel queue ordered by join time'),
            new SlashCommandBuilder()
                .setName('sqbbr')
                .setDescription('Show the current squadron battle BR schedule')
        ];

        return commands.map(command => command.toJSON());
    }

    setupEventHandlers() {
        this.client.once('ready', async () => {
            console.log(`✅ Bot is ready! Logged in as ${this.client.user.tag}`);
            console.log(`🎯 Monitoring squadron: ${this.config.squadronName}`);
            console.log(`⏱️  Check interval: ${this.config.checkIntervalMinutes} minutes`);
            
            // Register slash commands
            await this.registerCommands();
            
            // Start monitoring
            this.startMonitoring();
            
            // Start periodic player data collection
            this.startPlayerDataCollection();
        });

        this.client.on('error', (error) => {
            console.error('Discord client error:', error);
        });

        // Handle slash commands
        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand()) return;

            try {
                await this.handleCommand(interaction);
            } catch (error) {
                console.error('Error handling command:', error);
                const errorMessage = 'There was an error while executing this command!';
                
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: errorMessage, ephemeral: true });
                } else {
                    await interaction.reply({ content: errorMessage, ephemeral: true });
                }
            }
        });

        // Handle voice state updates for queue tracking
        this.client.on('voiceStateUpdate', (oldState, newState) => {
            this.handleVoiceStateUpdate(oldState, newState);
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

    async startPlayerDataCollection() {
        console.log('👥 Starting periodic player data collection...');
        
        // Initial collection after 30 seconds
        setTimeout(async () => {
            await this.collectPlayerData();
        }, 30000);
        
        // Then at configured interval (default 10 minutes)
        const intervalMinutes = this.config.playerDataIntervalMinutes || 10;
        this.playerDataInterval = setInterval(async () => {
            await this.collectPlayerData();
        }, intervalMinutes * 60 * 1000);
    }

    async collectPlayerData() {
        try {
            console.log(`👥 Collecting player data for ${this.config.squadronName}...`);
            
            const players = await this.scrapeSquadronPlayers();
            
            if (players && players.length > 0) {
                this.cachedPlayers = players;
                this.lastPlayerDataUpdate = new Date();
                console.log(`✅ Successfully cached ${players.length} players`);
            } else {
                console.log('⚠️ No player data collected, keeping previous cache');
            }
            
        } catch (error) {
            console.error('❌ Error collecting player data:', error.message);
            console.log('⚠️ Will retry in 10 minutes');
        }
    }

    async registerCommands() {
        try {
            console.log('🔧 Registering slash commands...');
            
            const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
            
            await rest.put(
                Routes.applicationCommands(this.client.user.id),
                { body: this.commands }
            );
            
            console.log('✅ Successfully registered slash commands!');
        } catch (error) {
            console.error('❌ Failed to register slash commands:', error);
        }
    }

    async handleCommand(interaction) {
        const { commandName } = interaction;

        switch (commandName) {
            case 'rank':
                await this.handleRankCommand(interaction);
                break;
            case 'top':
                await this.handleTopCommand(interaction);
                break;
            // case 'players':
            //     await this.handlePlayersCommand(interaction);
            //     break;
            case 'low':
                await this.handleLowCommand(interaction);
                break;
            case 'queue':
                await this.handleQueueCommand(interaction);
                break;
            case 'sqbbr':
                await this.handleSqbbrCommand(interaction);
                break;
            default:
                await interaction.reply({ content: 'Unknown command!', ephemeral: true });
        }
    }

    async handleRankCommand(interaction) {
        await interaction.deferReply();

        try {
            console.log(`📊 Fetching rank data for ${this.config.squadronName}...`);
            
            // Get current squadron data with neighboring squadrons
            const rankData = await this.fetchSquadronRankData();
            
            if (!rankData) {
                await interaction.editReply({
                    content: '❌ Unable to fetch squadron rank data. Please try again later.',
                });
                return;
            }

            // Create rank embed
            const embed = await this.createRankEmbed(rankData);
            
            await interaction.editReply({ embeds: [embed] });
            
        } catch (error) {
            console.error('Error in rank command:', error);
            await interaction.editReply({
                content: '❌ An error occurred while fetching rank data.',
            });
        }
    }

    async handleTopCommand(interaction) {
        await interaction.deferReply();

        try {
            console.log(`👥 Getting top players for ${this.config.squadronName} from cache...`);
            
            // Check if we have recent cached data
            const cacheAge = this.lastPlayerDataUpdate ? (Date.now() - this.lastPlayerDataUpdate.getTime()) / 1000 / 60 : Infinity;
            
            if (this.cachedPlayers.length === 0) {
                await interaction.editReply({
                    content: '❌ No player data available yet. Player data is collected every 10 minutes in the background. Please try again in a few minutes.',
                });
                return;
            }

            // Show only top 20 for /top command
            const topPlayers = this.cachedPlayers.slice(0, 20);
            const embed = await this.createTopPlayersEmbed(topPlayers, cacheAge, 'Top 20');
            
            await interaction.editReply({ embeds: [embed] });
            
        } catch (error) {
            console.error('Error in top command:', error);
            await interaction.editReply({
                content: '❌ An error occurred while getting player data.',
            });
        }
    }

    async handlePlayersCommand(interaction) {
        await interaction.deferReply();

        try {
            console.log(`👥 Getting all players for ${this.config.squadronName} from cache...`);
            
            const cacheAge = this.lastPlayerDataUpdate ? (Date.now() - this.lastPlayerDataUpdate.getTime()) / 1000 / 60 : Infinity;
            
            if (this.cachedPlayers.length === 0) {
                await interaction.editReply({
                    content: '❌ No player data available yet. Player data is collected every 10 minutes in the background. Please try again in a few minutes.',
                });
                return;
            }

            const embeds = await this.createAllPlayersEmbed(this.cachedPlayers, cacheAge);
            
            // Send first embed as reply
            await interaction.editReply({ embeds: [embeds[0]] });
            
            // Send remaining embeds as follow-up messages
            for (let i = 1; i < embeds.length; i++) {
                await interaction.followUp({ embeds: [embeds[i]] });
            }

        } catch (error) {
            console.error('Error in players command:', error);
            await interaction.editReply({
                content: '❌ An error occurred while getting player data.',
            });
        }
    }

    async handleLowCommand(interaction) {
        await interaction.deferReply();

        try {
            console.log(`📉 Getting low-rating players for ${this.config.squadronName} from cache...`);
            
            const cacheAge = this.lastPlayerDataUpdate ? (Date.now() - this.lastPlayerDataUpdate.getTime()) / 1000 / 60 : Infinity;
            
            if (this.cachedPlayers.length === 0) {
                await interaction.editReply({
                    content: '❌ No player data available yet. Player data is collected every 10 minutes in the background. Please try again in a few minutes.',
                });
                return;
            }

            // Filter players under 1300 points
            const lowPlayers = this.cachedPlayers.filter(player => player.rating < 1300);
            
            if (lowPlayers.length === 0) {
                await interaction.editReply({
                    content: '🎉 Great news! No players have ratings under 1300 points. Everyone is performing well!',
                });
                return;
            }

            const embed = await this.createLowPlayersEmbed(lowPlayers, cacheAge);
            
            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error in low command:', error);
            await interaction.editReply({
                content: '❌ An error occurred while getting low-rating player data.',
            });
        }
    }

    async handleQueueCommand(interaction) {
        await interaction.deferReply();

        try {
            if (!this.config.voiceChannelId || this.config.voiceChannelId === "YOUR_VOICE_CHANNEL_ID_HERE") {
                await interaction.editReply({
                    content: '❌ Voice channel monitoring is not configured. Please set a valid voiceChannelId in config.json.',
                });
                return;
            }

            const queueList = Array.from(this.voiceQueue.entries())
                .sort((a, b) => a[1].joinTime - b[1].joinTime); // Sort by join time (earliest first)

            if (queueList.length === 0) {
                await interaction.editReply({
                    content: '📭 The voice channel queue is currently empty.',
                });
                return;
            }

            const embed = this.createQueueEmbed(queueList, this.cachedPlayers);
            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error in queue command:', error);
            await interaction.editReply({
                content: '❌ An error occurred while getting the voice channel queue.',
            });
        }
    }

    async handleSqbbrCommand(interaction) {
        await interaction.deferReply();

        try {
            const currentBR = this.getCurrentSquadronBR();
            const schedule = this.getSquadronBRSchedule();
            
            const embed = new EmbedBuilder()
                .setTitle('🎯 Squadron Battle BR Schedule')
                .setColor(0x00AE86)
                .setTimestamp();

            let description = '';
            
            if (currentBR) {
                description += `**🔥 Current BR: ${currentBR.br}** (${currentBR.period})\n\n`;
            } else {
                description += `**📅 Season not currently active**\n\n`;
            }
            
            description += '**Full Schedule:**\n';
            description += schedule.map(week => {
                const prefix = currentBR && week.week === currentBR.week ? '► ' : '   ';
                return `${prefix}${week.week} BR ${week.br} (${week.period})`;
            }).join('\n');

            embed.setDescription(description);
            embed.setFooter({ text: 'Dates in DD.MM format' });
            
            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error in sqbbr command:', error);
            await interaction.editReply({
                content: '❌ An error occurred while getting the BR schedule.',
            });
        }
    }

    getCurrentSquadronBR() {
        const now = new Date();
        const currentYear = now.getFullYear();
        
        const schedule = [
            { week: '1st week', br: '14.0', start: new Date(currentYear, 6, 1), end: new Date(currentYear, 6, 6) }, // July 1-6
            { week: '2nd week', br: '12.0', start: new Date(currentYear, 6, 7), end: new Date(currentYear, 6, 13) }, // July 7-13
            { week: '3rd week', br: '10.7', start: new Date(currentYear, 6, 14), end: new Date(currentYear, 6, 20) }, // July 14-20
            { week: '4th week', br: '9.7', start: new Date(currentYear, 6, 21), end: new Date(currentYear, 6, 27) }, // July 21-27
            { week: '5th week', br: '8.7', start: new Date(currentYear, 6, 28), end: new Date(currentYear, 7, 3) }, // July 28 - Aug 3
            { week: '6th week', br: '7.3', start: new Date(currentYear, 7, 4), end: new Date(currentYear, 7, 10) }, // Aug 4-10
            { week: '7th week', br: '6.3', start: new Date(currentYear, 7, 11), end: new Date(currentYear, 7, 17) }, // Aug 11-17
            { week: '8th week', br: '5.7', start: new Date(currentYear, 7, 18), end: new Date(currentYear, 7, 24) }, // Aug 18-24
            { week: 'Until the end of season', br: '4.7', start: new Date(currentYear, 7, 25), end: new Date(currentYear, 7, 31) } // Aug 25-31
        ];

        for (const period of schedule) {
            if (now >= period.start && now <= period.end) {
                return {
                    week: period.week,
                    br: period.br,
                    period: this.formatDateRange(period.start, period.end)
                };
            }
        }

        return null; // Not in season
    }

    getSquadronBRSchedule() {
        return [
            { week: '1st week', br: '14.0', period: '01.07 - 06.07' },
            { week: '2nd week', br: '12.0', period: '07.07 - 13.07' },
            { week: '3rd week', br: '10.7', period: '14.07 - 20.07' },
            { week: '4th week', br: '9.7', period: '21.07 - 27.07' },
            { week: '5th week', br: '8.7', period: '28.07 - 03.08' },
            { week: '6th week', br: '7.3', period: '04.08 - 10.08' },
            { week: '7th week', br: '6.3', period: '11.08 - 17.08' },
            { week: '8th week', br: '5.7', period: '18.08 - 24.08' },
            { week: 'Until the end of season', br: '4.7', period: '25.08 - 31.08' }
        ];
    }

    formatDateRange(startDate, endDate) {
        const formatDate = (date) => {
            const day = date.getDate().toString().padStart(2, '0');
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            return `${day}.${month}`;
        };
        return `${formatDate(startDate)} - ${formatDate(endDate)}`;
    }

    handleVoiceStateUpdate(oldState, newState) {
        const targetChannelId = this.config.voiceChannelId;
        
        if (!targetChannelId || targetChannelId === "YOUR_VOICE_CHANNEL_ID_HERE") {
            return; // Voice channel monitoring not configured
        }

        const userId = newState.id;
        const username = newState.member?.displayName || newState.member?.user.username || 'Unknown User';

        // User joined the target voice channel
        if (newState.channelId === targetChannelId && oldState.channelId !== targetChannelId) {
            this.voiceQueue.set(userId, {
                username: username,
                joinTime: new Date()
            });
            console.log(`🎤 ${username} joined the voice queue`);
        }
        
        // User left the target voice channel
        if (oldState.channelId === targetChannelId && newState.channelId !== targetChannelId) {
            this.voiceQueue.delete(userId);
            console.log(`🚪 ${username} left the voice queue`);
        }
    }

    createQueueEmbed(queueList, cachedPlayers = []) {
        const embed = new EmbedBuilder()
            .setTitle('🎮 Voice Channel Queue')
            .setColor(0x00AE86)
            .setTimestamp();

        if (queueList.length === 0) {
            embed.setDescription('The queue is currently empty.');
            return embed;
        }

        let description = `**Queue Position | Player | Points | Wait Time**\n\n`;
        
        queueList.forEach(([userId, data], index) => {
            const waitTime = this.formatWaitTime(Date.now() - data.joinTime.getTime());
            const position = index + 1;
            const medal = position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : '📍';
            
            // Try to find player rating from cached data
            const playerData = this.findPlayerByUsername(data.username, cachedPlayers);
            const pointsText = playerData ? `${playerData.rating.toLocaleString()}` : 'Unknown';
            
            description += `${medal} **${position}.** ${data.username} - ${pointsText} pts - *${waitTime}*\n`;
        });

        embed.setDescription(description);
        
        const foundPlayers = queueList.filter(([userId, data]) => 
            this.findPlayerByUsername(data.username, cachedPlayers) !== null
        ).length;
        
        embed.setFooter({ 
            text: `Total players in queue: ${queueList.length} | Points found for: ${foundPlayers}/${queueList.length}` 
        });

        return embed;
    }

    findPlayerByUsername(discordUsername, cachedPlayers) {
        if (!cachedPlayers || cachedPlayers.length === 0) {
            return null;
        }

        // Clean and normalize the Discord username for matching
        const cleanDiscordName = discordUsername.toLowerCase()
            .replace(/[^a-z0-9_\-]/g, '') // Remove special chars except underscore and dash
            .trim();

        // Try exact match first
        let match = cachedPlayers.find(player => 
            player.name.toLowerCase().replace(/[^a-z0-9_\-]/g, '') === cleanDiscordName
        );

        if (match) return match;

        // Try partial matches - Discord name contains in-game name or vice versa
        match = cachedPlayers.find(player => {
            const cleanGameName = player.name.toLowerCase().replace(/[^a-z0-9_\-]/g, '');
            return cleanDiscordName.includes(cleanGameName) || cleanGameName.includes(cleanDiscordName);
        });

        if (match) return match;

        // Try fuzzy match - allow for small differences
        match = cachedPlayers.find(player => {
            const cleanGameName = player.name.toLowerCase().replace(/[^a-z0-9_\-]/g, '');
            return this.calculateSimilarity(cleanDiscordName, cleanGameName) > 0.8;
        });

        return match || null;
    }

    calculateSimilarity(str1, str2) {
        if (str1.length === 0 || str2.length === 0) return 0;
        if (str1 === str2) return 1;

        // Simple similarity calculation based on common characters
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        
        if (longer.length === 0) return 1;
        
        const matches = shorter.split('').filter(char => longer.includes(char)).length;
        return matches / longer.length;
    }

    formatWaitTime(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    async fetchSquadronRankData() {
        try {
            const maxPages = 20; // Search more pages to find squadrons
            let targetSquadron = null;
            let targetPage = null;
            let currentEraSort = 'dr_era5'; // Default fallback
            
            // First, detect current era from a sample page
            try {
                const sampleUrl = `${this.apiBaseUrl}/page/1/sort/dr_era5`;
                const sampleResponse = await this.fetchApiData(sampleUrl);
                if (sampleResponse && sampleResponse.data && sampleResponse.data.length > 0) {
                    const sampleSquadron = sampleResponse.data[0];
                    const detectedEra = this.detectCurrentEra(sampleSquadron.astat);
                    if (detectedEra.era > 0) {
                        currentEraSort = `dr_era${detectedEra.era}`;
                    }
                }
            } catch (eraDetectionError) {
                console.log('⚠️ Could not detect current era, using default');
            }
            
            // Find the squadron across multiple pages
            for (let page = 1; page <= maxPages; page++) {
                const url = `${this.apiBaseUrl}/page/${page}/sort/${currentEraSort}`;
                const apiResponse = await this.fetchApiData(url);
                
                if (!apiResponse || !apiResponse.data || !Array.isArray(apiResponse.data)) {
                    continue;
                }
                
                const foundSquadron = apiResponse.data.find(squadron => 
                    squadron.name && squadron.name.toLowerCase() === this.config.squadronName.toLowerCase()
                );
                
                if (foundSquadron) {
                    targetSquadron = foundSquadron;
                    targetPage = page;
                    break;
                }
            }
            
            if (!targetSquadron) {
                throw new Error(`Squadron "${this.config.squadronName}" not found in leaderboard`);
            }
            
            // Get the full page data to find neighboring squadrons
            const url = `${this.apiBaseUrl}/page/${targetPage}/sort/${currentEraSort}`;
            const pageData = await this.fetchApiData(url);
            
            // Find squadron index in the page
            const squadronIndex = pageData.data.findIndex(squadron => 
                squadron.name && squadron.name.toLowerCase() === this.config.squadronName.toLowerCase()
            );
            
            // Calculate actual position (page-based position + index)
            const basePosition = (targetPage - 1) * 20; // 20 squadrons per page
            const actualPosition = basePosition + squadronIndex + 1;
            
            // Get neighboring squadrons
            let squadronAbove = null;
            let squadronBelow = null;
            
            // Squadron above (better rank, lower position number)
            if (squadronIndex > 0) {
                squadronAbove = pageData.data[squadronIndex - 1];
            } else if (targetPage > 1) {
                // Get from previous page
                const prevPageUrl = `${this.apiBaseUrl}/page/${targetPage - 1}/sort/${currentEraSort}`;
                const prevPageData = await this.fetchApiData(prevPageUrl);
                if (prevPageData && prevPageData.data && prevPageData.data.length > 0) {
                    squadronAbove = prevPageData.data[prevPageData.data.length - 1];
                }
            }
            
            // Squadron below (worse rank, higher position number)
            if (squadronIndex < pageData.data.length - 1) {
                squadronBelow = pageData.data[squadronIndex + 1];
            } else {
                // Get from next page
                const nextPageUrl = `${this.apiBaseUrl}/page/${targetPage + 1}/sort/${currentEraSort}`;
                try {
                    const nextPageData = await this.fetchApiData(nextPageUrl);
                    if (nextPageData && nextPageData.data && nextPageData.data.length > 0) {
                        squadronBelow = nextPageData.data[0];
                    }
                } catch (error) {
                    // Next page might not exist (we're at the end)
                    console.log('No next page available (squadron might be near the end of leaderboard)');
                }
            }
            
            // Get current era info
            const currentEraInfo = this.detectCurrentEra(targetSquadron.astat);
            
            return {
                squadron: targetSquadron,
                position: actualPosition,
                rating: currentEraInfo.value,
                era: currentEraInfo.era,
                squadronAbove,
                squadronBelow,
                pageNumber: targetPage
            };
            
        } catch (error) {
            console.error('Error fetching squadron rank data:', error);
            return null;
        }
    }

    async fetchApiData(url) {
        return new Promise((resolve, reject) => {
            const zlib = require('zlib');
            
            const request = https.get(url, {
                headers: {
                    'User-Agent': this.userAgent,
                    'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                },
                timeout: this.config.requestTimeoutMs || 10000
            }, (response) => {
                let data = Buffer.alloc(0);
                
                response.on('data', (chunk) => {
                    data = Buffer.concat([data, chunk]);
                });
                
                response.on('end', () => {
                    try {
                        if (response.statusCode === 200) {
                            // Handle compressed responses
                            let decompressedData = data;
                            const encoding = response.headers['content-encoding'];
                            
                            if (encoding === 'gzip') {
                                decompressedData = zlib.gunzipSync(data);
                            } else if (encoding === 'deflate') {
                                decompressedData = zlib.inflateSync(data);
                            } else if (encoding === 'br') {
                                decompressedData = zlib.brotliDecompressSync(data);
                            }
                            
                            const jsonString = decompressedData.toString('utf8');
                            const jsonData = JSON.parse(jsonString);
                            resolve(jsonData);
                        } else {
                            reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                        }
                    } catch (parseError) {
                        reject(new Error(`Failed to parse JSON: ${parseError.message}`));
                    }
                });
            });
            
            request.on('error', (error) => {
                reject(new Error(`Request failed: ${error.message}`));
            });
            
            request.on('timeout', () => {
                request.destroy();
                reject(new Error('Request timeout'));
            });
        });
    }

    detectCurrentEra(squadronData) {
        // Find the highest era number with non-zero value
        let currentEra = 0;
        let currentValue = 0;
        
        // Check all dr_eraX_hist fields
        for (let era = 0; era <= 10; era++) {
            const fieldName = `dr_era${era}_hist`;
            if (squadronData[fieldName] && squadronData[fieldName] > 0) {
                if (era > currentEra) {
                    currentEra = era;
                    currentValue = squadronData[fieldName];
                }
            }
        }
        
        return {
            era: currentEra,
            value: currentValue,
            fieldName: `dr_era${currentEra}_hist`
        };
    }

    async checkSquadronStats() {
        try {
            console.log(`🔍 Checking squadron stats for ${this.config.squadronName}...`);
            
            const stats = await this.fetchSquadronDataFromApi();
            
            if (!stats) {
                console.log('❌ Failed to fetch squadron data from API');
                console.log('💡 The bot will continue monitoring and retry on next check.');
                
                // If this is the first run, send a status message
                if (this.isFirstCheck) {
                    await this.sendStatusMessage('⚠️ Bot started but unable to access War Thunder API data. The bot will keep trying.');
                    this.isFirstCheck = false;
                }
                return;
            }

            console.log(`📊 Current stats: Rating ${stats.rating}, W:${stats.wins} L:${stats.losses}`);

            // Send success message on first successful API fetch
            if (this.isFirstCheck) {
                await this.sendStatusMessage(`✅ Successfully connected to War Thunder API! Monitoring ${this.config.squadronName} - Rating: ${stats.rating}, Record: ${stats.wins}W-${stats.losses}L (Era ${stats.era}, Position #${stats.position})`);
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

    async fetchSquadronDataFromApi() {
        const maxRetries = this.config.retryAttempts || 3;
        let retryCount = 0;

        while (retryCount < maxRetries) {
            try {
                console.log(`🌐 Fetching data from War Thunder API...`);
                
                // We'll search through multiple pages to find the squadron
                const maxPages = 10; // Adjust based on expected squadron ranking
                let squadronFound = null;
                let foundPage = null;
                let foundIndex = null;
                
                for (let page = 1; page <= maxPages; page++) {
                    // First, try to detect current era by checking a sample page
                    const sampleUrl = `${this.apiBaseUrl}/page/1/sort/dr_era5`;
                    let currentEraSort = 'dr_era5'; // Default fallback
                    
                    if (page === 1) {
                        try {
                            const sampleResponse = await this.fetchApiData(sampleUrl);
                            if (sampleResponse && sampleResponse.data && sampleResponse.data.length > 0) {
                                const sampleSquadron = sampleResponse.data[0];
                                const detectedEra = this.detectCurrentEra(sampleSquadron.astat);
                                if (detectedEra.era > 0) {
                                    currentEraSort = `dr_era${detectedEra.era}`;
                                    console.log(`🎯 Detected current era: ${detectedEra.era}`);
                                }
                            }
                        } catch (eraDetectionError) {
                            console.log('⚠️ Could not detect current era, using default dr_era5');
                        }
                    }
                    
                    const url = `${this.apiBaseUrl}/page/${page}/sort/${currentEraSort}`;
                    console.log(`📄 Checking page ${page}: ${url}`);
                    
                    const apiResponse = await this.fetchApiData(url);
                    
                    if (!apiResponse || !apiResponse.data || !Array.isArray(apiResponse.data)) {
                        console.log(`⚠️ Invalid response structure from page ${page}`);
                        continue;
                    }
                    
                    // Search for our squadron in this page
                    const foundSquadronIndex = apiResponse.data.findIndex(squadron => 
                        squadron.name && squadron.name.toLowerCase() === this.config.squadronName.toLowerCase()
                    );
                    
                    if (foundSquadronIndex !== -1) {
                        squadronFound = apiResponse.data[foundSquadronIndex];
                        foundPage = page;
                        foundIndex = foundSquadronIndex;
                        console.log(`✅ Found squadron ${this.config.squadronName} on page ${page}, index ${foundSquadronIndex}`);
                        break;
                    }
                        }
                        
                if (!squadronFound) {
                    throw new Error(`Squadron "${this.config.squadronName}" not found in top ${maxPages} pages`);
                }
                
                // Detect current era and extract rating
                const currentEraInfo = this.detectCurrentEra(squadronFound.astat);
                
                if (currentEraInfo.era === 0 || currentEraInfo.value === 0) {
                    console.log('⚠️ No active era detected, squadron may not be participating in current season');
                }
                
                console.log(`📊 Current era: ${currentEraInfo.era}, Squadron points: ${currentEraInfo.value}`);
                
                // Extract additional statistics from astat
                const astat = squadronFound.astat;
                const wins = astat.wins_hist || 0;
                const battles = astat.battles_hist || 0;
                const losses = battles - wins;
                
                // Calculate accurate position (same method as rank command)
                const basePosition = (foundPage - 1) * 20; // 20 squadrons per page
                const actualPosition = basePosition + foundIndex + 1;
                console.log(`📊 Position calculation: Page ${foundPage}, Index ${foundIndex} → Position ${actualPosition}`);
                
                    return {
                    rating: currentEraInfo.value,
                    wins: wins,
                    losses: losses,
                    totalBattles: battles,
                    timestamp: new Date(),
                    era: currentEraInfo.era,
                    position: actualPosition,
                    squadronId: squadronFound._id
                };

            } catch (error) {
                retryCount++;
                console.error(`API request attempt ${retryCount} failed:`, error.message);
                
                if (retryCount < maxRetries) {
                    const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
                    console.log(`⏳ Retrying in ${delay/1000} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    console.error('❌ All API retry attempts failed');
                    return null;
                }
            }
        }
    }

    async compareAndNotify(previousStats, currentStats) {
        // Check for any changes (rating, wins, or losses)
        const ratingChanged = currentStats.rating !== previousStats.rating;
        const winsChanged = currentStats.wins !== previousStats.wins;
        const lossesChanged = currentStats.losses !== previousStats.losses;
        
        if (!ratingChanged && !winsChanged && !lossesChanged) {
            return; // No changes detected
        }

        console.log('🎮 Battle activity detected!');
        console.log(`📊 Stats change: Rating ${previousStats.rating} → ${currentStats.rating}, W: ${previousStats.wins} → ${currentStats.wins}, L: ${previousStats.losses} → ${currentStats.losses}`);

        // Calculate battle changes
        const ratingChange = currentStats.rating - previousStats.rating;
        const winsIncrease = currentStats.wins - previousStats.wins;
        const lossesIncrease = currentStats.losses - previousStats.losses;
        const totalBattles = winsIncrease + lossesIncrease;

        // Start session if not active (before tracking battles)
        // Use previousStats for starting rating since currentStats already includes the changes
        if (!this.isSessionActive) {
            await this.startSession(previousStats);
        }

        // Update session activity timestamp
        this.updateSessionActivity();

        // Handle multiple battles case
        if (totalBattles > 1) {
            console.log(`🔥 Multiple battles detected: ${winsIncrease} wins, ${lossesIncrease} losses (${totalBattles} total)`);
            await this.handleMultipleBattles(previousStats, currentStats, winsIncrease, lossesIncrease, ratingChange);
        } else if (totalBattles === 1) {
            // Single battle - use existing logic with enhancements
            await this.handleSingleBattle(previousStats, currentStats, winsIncrease > 0, ratingChange);
        } else if (ratingChanged && totalBattles === 0) {
            // Rating changed but no W/L change (rare edge case)
            console.log('⚠️ Rating changed without W/L change - possible data inconsistency');
            await this.handleSingleBattle(previousStats, currentStats, null, ratingChange);
        }
    }

    async handleSingleBattle(previousStats, currentStats, isWin, ratingChange) {
        // Determine battle result
        let battleResult = 'Unknown';
        let color = 0xffff00; // Yellow for unknown
        let emoji = '❓';

        if (isWin === true) {
            battleResult = 'Victory';
            color = 0x00ff00; // Green
            emoji = '🎉';
            this.sessionStats.wins++;
        } else if (isWin === false) {
            battleResult = 'Defeat';
            color = 0xff0000; // Red
            emoji = '💀';
            this.sessionStats.losses++;
        } else {
            // Fallback to rating change if W/L data is inconsistent
            if (ratingChange > 0) {
                battleResult = 'Victory';
                color = 0x00ff00;
                emoji = '🎉';
            this.sessionStats.wins++;
            } else if (ratingChange < 0) {
                battleResult = 'Defeat';
                color = 0xff0000;
                emoji = '💀';
            this.sessionStats.losses++;
            } else {
                return; // No clear result
            }
        }

        // Update session battle count
        this.sessionStats.totalBattles++;

        // Rating change text
        const ratingChangeText = ratingChange > 0 ? `+${ratingChange}` : `${ratingChange}`;

        // Store battle details in session
        this.sessionStats.battles.push({
            result: battleResult,
            ratingChange: ratingChange,
            newRating: currentStats.rating,
            timestamp: new Date()
        });

        // Create and send battle notification
        await this.sendBattleNotification(battleResult, emoji, color, ratingChangeText, currentStats);
    }

    async handleMultipleBattles(previousStats, currentStats, winsIncrease, lossesIncrease, totalRatingChange) {
        // Update session stats
        this.sessionStats.wins += winsIncrease;
        this.sessionStats.losses += lossesIncrease;
        this.sessionStats.totalBattles += (winsIncrease + lossesIncrease);

        // Store combined battle details
        this.sessionStats.battles.push({
            result: `${winsIncrease}W-${lossesIncrease}L`,
            ratingChange: totalRatingChange,
            newRating: currentStats.rating,
            timestamp: new Date(),
            isMultiple: true,
            wins: winsIncrease,
            losses: lossesIncrease
        });

        // Determine overall result and color
        let emoji = '⚔️';
        let color = 0xffa500; // Orange for multiple battles
        let resultText = '';

        if (winsIncrease > lossesIncrease) {
            emoji = '🎉';
            color = 0x00ff00;
            resultText = `${winsIncrease} Victories, ${lossesIncrease} Defeats`;
        } else if (lossesIncrease > winsIncrease) {
            emoji = '💀';
            color = 0xff0000;
            resultText = `${winsIncrease} Victories, ${lossesIncrease} Defeats`;
        } else {
            emoji = '⚖️';
            color = 0xffff00;
            resultText = `${winsIncrease} Victories, ${lossesIncrease} Defeats`;
        }

        const ratingChangeText = totalRatingChange > 0 ? `+${totalRatingChange}` : `${totalRatingChange}`;

        // Create multiple battles notification
        const sessionWinRate = this.sessionStats.totalBattles > 0 ? 
            Math.round((this.sessionStats.wins / this.sessionStats.totalBattles) * 100) : 0;
        const sessionRatingChange = currentStats.rating - this.sessionStats.startingRating;
        const sessionRatingChangeText = sessionRatingChange > 0 ? `+${sessionRatingChange}` : `${sessionRatingChange}`;

        const embed = new EmbedBuilder()
            .setTitle(`${emoji} Multiple Battles Completed`)
            .setDescription(`**${this.config.squadronName}** - ${resultText}`)
            .addFields(
                {
                    name: '⚔️ Battles',
                    value: `${winsIncrease + lossesIncrease} battles`,
                    inline: true
                },
                {
                    name: '📊 Results',
                    value: `${winsIncrease}W - ${lossesIncrease}L`,
                    inline: true
                },
                {
                    name: '📈 Total Rating Change',
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
                text: `War Thunder Squadron Tracker • ${this.sessionStats.totalBattles} battles in session`,
                iconURL: 'https://warthunder.com/favicon.ico'
            })
            .setTimestamp();

        // Send notification
        await this.sendNotification(embed);
    }

    async sendBattleNotification(battleResult, emoji, color, ratingChangeText, currentStats) {
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

    async createRankEmbed(rankData) {
        const { squadron, position, rating, squadronAbove, squadronBelow } = rankData;
        
        // Get neighboring squadron ratings
        let aboveRating = null;
        let belowRating = null;
        
        if (squadronAbove) {
            const aboveEra = this.detectCurrentEra(squadronAbove.astat);
            aboveRating = aboveEra.value;
        }
        
        if (squadronBelow) {
            const belowEra = this.detectCurrentEra(squadronBelow.astat);
            belowRating = belowEra.value;
        }
        
        // Calculate point differences
        const pointsToRankUp = aboveRating ? (aboveRating - rating) : null;
        const pointsToRankDown = belowRating ? (rating - belowRating) : null;
        
        const embed = new EmbedBuilder()
            .setTitle('🏆 Squadron Leaderboard Rank')
            .setDescription(`**${this.config.squadronName}**`)
            .addFields(
                {
                    name: '📍 Current Rank',
                    value: `#${position}`,
                    inline: true
                },
                {
                    name: '⭐ Squadron Rating',
                    value: rating.toLocaleString(),
                    inline: true
                },
                {
                    name: '\u200B',
                    value: '\u200B',
                    inline: true
                }
            )
            .setColor(0x00aaff)
            .setTimestamp();

        // Add rank up information
        if (squadronAbove && pointsToRankUp !== null) {
            embed.addFields({
                name: '⬆️ Squadron Above',
                value: `**${squadronAbove.name}** (#${position - 1})\n${aboveRating.toLocaleString()} points (+${pointsToRankUp.toLocaleString()} needed)`,
                inline: false
            });
        } else {
            embed.addFields({
                name: '⬆️ Squadron Above',
                value: '🥇 Already at #1!',
                inline: false
            });
        }

        // Add rank down information
        if (squadronBelow && pointsToRankDown !== null) {
            embed.addFields({
                name: '⬇️ Squadron Below',
                value: `**${squadronBelow.name}** (#${position + 1})\n${belowRating.toLocaleString()} points (${pointsToRankDown.toLocaleString()} ahead)`,
                inline: false
            });
        } else {
            embed.addFields({
                name: '⬇️ Squadron Below',
                value: '🏆 No squadron below',
                inline: false
            });
        }

        return embed;
    }

    async scrapeSquadronPlayers() {
        const maxRetries = 3;
        let retryCount = 0;

        while (retryCount < maxRetries) {
            try {
                // Ensure browser is available
                if (!this.browser) {
                    await this.initializeBrowser();
                }

                const url = `https://warthunder.com/en/community/claninfo/${encodeURIComponent(this.config.squadronName)}`;
                console.log(`🌐 Navigating to: ${url}`);
                
                const page = await this.browser.newPage();
                
                // Navigate to the page with extended timeout
                await page.goto(url, {
                    waitUntil: 'networkidle2',
                    timeout: 30000
                });

                // Add random delay to appear more human-like
                await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));

                // Wait for potential Cloudflare challenge
                console.log('⏳ Waiting for page to fully load (handling Cloudflare if present)...');
                try {
                    // Wait for either the main content or a Cloudflare challenge
                    await page.waitForFunction(
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
                const isCloudflareChallenge = await page.evaluate(() => {
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
                        await page.waitForFunction(
                            () => !document.title.includes('Just a moment') && 
                                  !document.body.textContent.includes('Checking your browser'),
                            { timeout: 30000 }
                        );
                        console.log('✅ Cloudflare challenge passed');
                    } catch (challengeError) {
                        await page.close();
                        throw new Error('Cloudflare challenge timeout');
                    }
                }

                // Extract squadron data using War Thunder's grid layout
                const squadronData = await page.evaluate(() => {
                    let players = [];
                    let debugInfo = [];
                    
                    debugInfo.push('Extracting from War Thunder grid layout...');
                    
                    // Strategy 1: Extract from squadron member grid items
                    const gridItems = document.querySelectorAll('.squadrons-members__grid-item');
                    debugInfo.push(`Found ${gridItems.length} squadron grid items`);
                    
                    if (gridItems.length > 0) {
                        // War Thunder uses a simple 6-column grid layout
                        // Headers: [num. | Player | Personal clan rating | Activity | Role | Date of entry]
                        // Skip first 6 items (headers) and group every 6 items as one row
                        const rowData = [];
                        
                        for (let i = 6; i < gridItems.length; i += 6) {
                            const row = [];
                            for (let j = 0; j < 6 && (i + j) < gridItems.length; j++) {
                                row.push(gridItems[i + j].textContent.trim());
                            }
                            if (row.length === 6) {
                                rowData.push(row);
                            }
                        }
                        
                        debugInfo.push(`Reconstructed ${rowData.length} rows from ${gridItems.length} grid items`);
                        
                        // Extract players from reconstructed rows
                        // War Thunder grid structure: [Position | Player Name | Personal Rating | Activity | Role | Date]
                        rowData.forEach((row, rowIndex) => {
                            if (row.length >= 6) {
                                // Fixed column positions based on War Thunder's grid structure
                                const nameText = row[1];    // Column 1: Player Name
                                const ratingText = row[2];  // Column 2: Personal clan rating
                                
                                // Player name validation
                                const isValidPlayerName = 
                                    nameText && nameText.length >= 2 && nameText.length <= 30 &&
                                    /^[A-Za-z0-9_\-\[\]\.@#$%&*+=<>?!\s\u00C0-\u017F\u0400-\u04FF\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\u0100-\u017F]+$/.test(nameText) &&
                                    !nameText.match(/^(rating|position|name|player|rank|recommended|minimum|commander|officer|sergeant|private|deputy|admin|mod|header|footer|table|row|cell|div|span|button|link|menu|nav|activity|squadron|intel|core|ryzen|flight|time|graphics|card|processor|cpu|gpu|memory|ram|nvidia|amd|pro|iris|radeon|geforce|gtx|rtx|youtube|facebook|twitter|age|tier|level|lvl|directx|ubuntu|linux|windows|mac|os|big|sur|dual|entry|date|nickname|must|be|older|than|not|more|geforce|dual-core|requirements|system|spec|specification|num\.|personal|clan)$/i) &&
                                    !nameText.match(/^(squadron rating|flight time|intel iris|intel core|core i[35579]|ryzen [357]|graphics card|nvidia geforce|radeon rx|geforce gtx|must be|not older than|more than|date of entry|the nickname|dual-core|mac os|big sur|epic games|steam|origin|battle net|war thunder)$/i) &&
                                    !nameText.match(/^[a-z]{1,2}$/i) &&
                                    !nameText.match(/^\d+$/) &&
                                    !nameText.toLowerCase().includes('must') &&
                                    !nameText.toLowerCase().includes('activity') &&
                                    !nameText.toLowerCase().includes('role') &&
                                    nameText.trim().length > 0;
                                
                                const rating = parseInt(ratingText.replace(/[^\d]/g, '')) || 0;
                                const isValidRating = rating >= 0 && rating <= 3000;
                                
                                const hasProperPair = nameText !== ratingText && 
                                                     nameText && nameText.length > 1 && 
                                                     ratingText && ratingText.length > 0 &&
                                                     !nameText.includes(ratingText) &&
                                                     !ratingText.includes(nameText);
                                
                                if (isValidPlayerName && isValidRating && hasProperPair) {
                                    players.push({ 
                                        name: nameText, 
                                        rating,
                                        source: `grid-row-${rowIndex}-fixed-columns`
                                    });
                                }
                            }
                        });
                    }
                    
                    // Strategy 2: Direct grid item pattern matching (fallback)
                    if (players.length < 5) {
                        debugInfo.push('Using fallback: direct grid pattern matching...');
                        
                        const allDivs = document.querySelectorAll('div');
                        allDivs.forEach(div => {
                            const text = div.textContent.trim();
                            
                            // Look for name-rating patterns in div content
                            const nameRatingPattern = text.match(/^([A-Za-z0-9_\-\[\]\.@#$%&*+=<>?!\s\u00C0-\u017F\u0400-\u04FF\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\u0100-\u017F][A-Za-z0-9_\-\[\]\.@#$%&*+=<>?!\s\u00C0-\u017F\u0400-\u04FF\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\u0100-\u017F]{1,25})\s*\n?\s*(\d{2,6})$/);
                            if (nameRatingPattern) {
                                const name = nameRatingPattern[1].trim();
                                const rating = parseInt(nameRatingPattern[2]);
                                
                                const isValidPlayerName = 
                                    name.length >= 2 && rating >= 0 && rating <= 3000 &&
                                    !name.toLowerCase().includes('player') &&
                                    !name.toLowerCase().includes('rating') &&
                                    !name.toLowerCase().includes('num.') &&
                                    !name.toLowerCase().includes('activity') &&
                                    !name.toLowerCase().includes('role');
                                
                                if (isValidPlayerName) {
                                    const exists = players.some(p => p.name.toLowerCase() === name.toLowerCase());
                                    if (!exists) {
                                        players.push({
                                            name: name,
                                            rating: rating,
                                            source: 'div-pattern'
                                        });
                                    }
                                }
                            }
                        });
                    }
                    
                    // Log what we found for debugging
                    console.log('Debug info:', debugInfo);
                    console.log('Extracted players:', players.length);
                    
                    // Remove duplicates and sort
                    const uniquePlayers = [];
                    const seenNames = new Set();
                    
                    players.forEach(player => {
                        const lowerName = player.name.toLowerCase();
                        if (!seenNames.has(lowerName)) {
                            seenNames.add(lowerName);
                            uniquePlayers.push({
                                name: player.name,
                                rating: player.rating
                            });
                        }
                    });
                    
                    // Sort by rating and limit to War Thunder's maximum squadron size
                    const sortedPlayers = uniquePlayers.sort((a, b) => b.rating - a.rating);
                    const maxSquadronSize = 128; // War Thunder's squadron member limit
                    
                    if (sortedPlayers.length > maxSquadronSize) {
                        console.log(`⚠️ Found ${sortedPlayers.length} players, limiting to top ${maxSquadronSize} (War Thunder squadron limit)`);
                        return sortedPlayers.slice(0, maxSquadronSize);
                    }
                    
                    return sortedPlayers;
                });

                await page.close();
                
                console.log(`📊 Extracted data: Found ${squadronData.length} players`);
                
                // Validate extracted data
                if (squadronData.length > 0) {
                    return squadronData;
                } else {
                    throw new Error('Could not extract valid player data from page');
                }

            } catch (error) {
                retryCount++;
                console.error(`Attempt ${retryCount} failed:`, error.message);
                
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

    async initializeBrowser() {
        try {
            console.log('🌐 Initializing browser for player data...');
            
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

            console.log('✅ Browser initialized successfully');
            
        } catch (error) {
            console.error('❌ Failed to initialize browser:', error.message);
            throw error;
        }
    }

    async createTopPlayersEmbed(players, cacheAge, title = 'Top Players') {
        const embed = new EmbedBuilder()
            .setTitle(`👥 ${title} Squadron Players`)
            .setDescription(`**${this.config.squadronName}** - ${title} (${players.length} Players)`)
            .setColor(0x00ff00)
            .setTimestamp();

        // Create player list
        let playerList = '';
        players.forEach((player, index) => {
            const rank = index + 1;
            const emoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
            playerList += `${emoji} **${player.name}** - ${player.rating.toLocaleString()}\n`;
        });

        // Discord embed field has a 1024 character limit
        if (playerList.length > 1024) {
            playerList = playerList.substring(0, 1000) + '...';
        }

        embed.addFields({
            name: '🏆 Player Rankings',
            value: playerList || 'No player data available',
            inline: false
        });

        // Add cache info
        if (cacheAge !== undefined) {
            const ageText = cacheAge < 1 ? 'less than 1 minute ago' : 
                          cacheAge < 60 ? `${Math.round(cacheAge)} minutes ago` :
                          `${Math.round(cacheAge / 60)} hours ago`;
            
            embed.addFields({
                name: '📡 Data Freshness',
                value: `Last updated: ${ageText}`,
                inline: false
            });
        }

        return embed;
    }

    async createAllPlayersEmbed(players, cacheAge) {
        const embeds = [];
        const playersPerMessage = 62; // More players per message
        
        for (let i = 0; i < players.length; i += playersPerMessage) {
            const chunk = players.slice(i, i + playersPerMessage);
            const startRank = i + 1;
            const endRank = Math.min(i + playersPerMessage, players.length);
            
            // Create a clean, aligned list
            let playerList = '';
            chunk.forEach((player, index) => {
                const rank = i + index + 1;
                const emoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
                
                // Calculate padding to align ratings
                const rankText = emoji.includes('🥇') || emoji.includes('🥈') || emoji.includes('🥉') ? emoji : `${rank}.`;
                const nameWithRank = `${rankText} **${player.name}**`;
                
                // Use consistent spacing for alignment
                const spacing = rank <= 9 ? '   ' : rank <= 99 ? '  ' : ' ';
                playerList += `${nameWithRank}${spacing}- ${player.rating.toLocaleString()}\n`;
            });
            
            const embed = new EmbedBuilder()
                .setTitle(i === 0 ? '👥 All Squadron Players' : `👥 Squadron Players (continued)`)
                .setDescription(i === 0 ? 
                    `**${this.config.squadronName}** - All ${players.length} Members\n\n${playerList}` : 
                    playerList)
                .setColor(0x0099ff)
                .setTimestamp();
            
            // Add footer showing which players this message contains
            if (players.length > playersPerMessage) {
                embed.setFooter({ text: `Players ${startRank}-${endRank} of ${players.length}` });
            }
            
            embeds.push(embed);
        }
        
        // Add cache info to the first embed only
        if (embeds.length > 0 && cacheAge !== undefined) {
            const ageText = cacheAge < 1 ? 'less than 1 minute ago' : 
                          cacheAge < 60 ? `${Math.round(cacheAge)} minutes ago` :
                          `${Math.round(cacheAge / 60)} hours ago`;
            
            embeds[0].addFields({
                name: '📡 Data Freshness',
                value: `Last updated: ${ageText}`,
                inline: false
            });
        }
        
        return embeds;
    }

    async createLowPlayersEmbed(lowPlayers, cacheAge) {
        // Sort players by rating (lowest first for this command)
        const sortedLowPlayers = lowPlayers.sort((a, b) => a.rating - b.rating);
        
        // Create player list
        let playerList = '';
        sortedLowPlayers.forEach((player, index) => {
            const rank = index + 1;
            const emoji = '📉'; // Low rating emoji
            
            // Use consistent spacing for alignment
            const spacing = rank <= 9 ? '   ' : rank <= 99 ? '  ' : ' ';
            playerList += `${rank}. **${player.name}**${spacing}- ${player.rating.toLocaleString()} points\n`;
        });

        // Discord embed field has a 1024 character limit
        if (playerList.length > 1024) {
            playerList = playerList.substring(0, 1000) + '...';
        }

        const embed = new EmbedBuilder()
            .setTitle('📉 Low Rating Players')
            .setDescription(`**${this.config.squadronName}** - Players Under 1300 Points (${sortedLowPlayers.length} Players)`)
            .setColor(0xff6b6b) // Red-ish color for low ratings
            .setTimestamp();

        embed.addFields({
            name: '⚠️ Players Needing Support',
            value: playerList || 'No players under 1300 points found',
            inline: false
        });

        // Add cache info
        if (cacheAge !== undefined) {
            const ageText = cacheAge < 1 ? 'less than 1 minute ago' : 
                          cacheAge < 60 ? `${Math.round(cacheAge)} minutes ago` :
                          `${Math.round(cacheAge / 60)} hours ago`;
            
            embed.addFields({
                name: '📡 Data Freshness',
                value: `Last updated: ${ageText}`,
                inline: false
            });
        }

        // Add helpful footer
        embed.setFooter({
            text: `Consider offering help or guidance to these squadron members`,
            iconURL: 'https://warthunder.com/favicon.ico'
        });

        return embed;
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

    async startSession(startingStats) {
        this.isSessionActive = true;
        this.sessionStartTime = new Date();
        this.lastActivityTime = new Date();
        this.sessionStats = {
            wins: 0,
            losses: 0,
            totalBattles: 0,
            startingRating: startingStats.rating,
            battles: []
        };
        
        console.log(`🎮 Starting new gaming session! Starting rating: ${startingStats.rating}`);
        
        // Send session start message
        const embed = new EmbedBuilder()
            .setTitle('🎮 Gaming Session Started!')
            .setDescription(`**${this.config.squadronName}** is now in a gaming session`)
            .addFields(
                {
                    name: '🏆 Starting Rating',
                    value: startingStats.rating.toString(),
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
            let battleCount = 0;
            
            this.sessionStats.battles.forEach((battle, index) => {
                if (battle.isMultiple) {
                    // Multiple battles in one update
                    const resultEmoji = battle.wins > battle.losses ? '🎉' : 
                                       battle.losses > battle.wins ? '💀' : '⚖️';
                    const ratingChangeText = battle.ratingChange > 0 ? `+${battle.ratingChange}` : `${battle.ratingChange}`;
                    battleCount += (battle.wins + battle.losses);
                    battleDetails += `${resultEmoji} Battles ${battleCount - (battle.wins + battle.losses) + 1}-${battleCount}: ${battle.wins}W-${battle.losses}L (${ratingChangeText})\n`;
                } else {
                    // Single battle
                const resultEmoji = battle.result === 'Victory' ? '🎉' : '💀';
                const ratingChangeText = battle.ratingChange > 0 ? `+${battle.ratingChange}` : `${battle.ratingChange}`;
                    battleCount++;
                    battleDetails += `${resultEmoji} Battle ${battleCount}: ${battle.result} (${ratingChangeText})\n`;
                }
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
        
        if (this.playerDataInterval) {
            clearInterval(this.playerDataInterval);
        }
        
        // Close browser if it was initialized for /top command
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
