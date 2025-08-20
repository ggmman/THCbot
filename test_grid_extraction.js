const puppeteer = require('puppeteer');
const fs = require('fs');
require('dotenv').config();

class GridExtractionTester {
    constructor() {
        this.config = this.loadConfig();
        this.browser = null;
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

    async initializeBrowser() {
        try {
            console.log('🌐 Initializing browser...');
            
            this.browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                ],
                defaultViewport: {
                    width: 1366,
                    height: 768
                }
            });

            console.log('✅ Browser initialized');
            
        } catch (error) {
            console.error('❌ Failed to initialize browser:', error.message);
            throw error;
        }
    }

    async testGridExtraction() {
        try {
            console.log(`\n🔍 Testing grid-based player extraction for: ${this.config.squadronName}\n`);
            
            if (!this.browser) {
                await this.initializeBrowser();
            }

            const url = `https://warthunder.com/en/community/claninfo/${encodeURIComponent(this.config.squadronName)}`;
            console.log(`🌐 Navigating to: ${url}`);
            
            const page = await this.browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            await page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            // Wait for dynamic content
            console.log('⏳ Waiting for player data to load...');
            await new Promise(resolve => setTimeout(resolve, 15000));

            // Extract player data from grid layout
            const extractionResults = await page.evaluate(() => {
                const results = {
                    players: [],
                    debugInfo: [],
                    squadronInfo: {},
                    gridAnalysis: []
                };

                // First, get squadron info
                const squadronRatingEl = document.querySelector('.squadrons-counter__value');
                if (squadronRatingEl) {
                    results.squadronInfo.rating = parseInt(squadronRatingEl.textContent.trim());
                }

                const squadronNameEl = document.querySelector('.squadrons-counter__title, .squadron-title, h1');
                if (squadronNameEl) {
                    results.squadronInfo.name = squadronNameEl.textContent.trim();
                }

                // Look for squadron member grid items
                const gridItems = document.querySelectorAll('.squadrons-members__grid-item');
                results.debugInfo.push(`Found ${gridItems.length} squadron grid items`);

                // Analyze grid structure
                if (gridItems.length > 0) {
                    results.debugInfo.push('\n📊 Grid Item Analysis:');
                    
                    // Sample first few grid items to understand structure
                    for (let i = 0; i < Math.min(10, gridItems.length); i++) {
                        const item = gridItems[i];
                        const itemAnalysis = {
                            index: i,
                            textContent: item.textContent.trim(),
                            innerHTML: item.innerHTML.substring(0, 300),
                            classes: item.className,
                            children: []
                        };

                        // Analyze children
                        const children = item.querySelectorAll('*');
                        children.forEach(child => {
                            if (child.textContent.trim().length > 0) {
                                itemAnalysis.children.push({
                                    tagName: child.tagName,
                                    className: child.className,
                                    textContent: child.textContent.trim()
                                });
                            }
                        });

                        results.gridAnalysis.push(itemAnalysis);
                        results.debugInfo.push(`  Item ${i + 1}: "${item.textContent.trim().substring(0, 100)}"`);
                    }
                }

                // Try different extraction strategies
                console.log('Testing extraction strategies...');

                // Strategy 1: Look for player name and rating patterns in grid items
                gridItems.forEach((item, index) => {
                    const text = item.textContent.trim();
                    
                    // Look for player name - rating patterns
                    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
                    
                    if (lines.length >= 2) {
                        // Try to find name and rating
                        let playerName = null;
                        let playerRating = null;
                        
                        lines.forEach(line => {
                            // Check if line looks like a player name
                            if (!playerName && line.length >= 2 && line.length <= 30 && 
                                /[A-Za-z]/.test(line) && 
                                !line.match(/^\d+$/) &&
                                !line.toLowerCase().includes('player') &&
                                !line.toLowerCase().includes('rating') &&
                                !line.toLowerCase().includes('num.')) {
                                playerName = line;
                            }
                            
                            // Check if line looks like a rating
                            const ratingMatch = line.match(/^\d{2,6}$/);
                            if (ratingMatch) {
                                const rating = parseInt(ratingMatch[0]);
                                if (rating >= 100 && rating <= 50000) {
                                    playerRating = rating;
                                }
                            }
                        });
                        
                        if (playerName && playerRating) {
                            results.players.push({
                                name: playerName,
                                rating: playerRating,
                                source: `grid-item-${index}`,
                                rawText: text
                            });
                        }
                    }
                });

                // Strategy 2: Look for specific squadron member selectors
                const memberSelectors = [
                    '.squadron-member',
                    '.clan-member', 
                    '.player-item',
                    '.member-item',
                    '[data-player-name]',
                    '[data-member-name]'
                ];

                memberSelectors.forEach(selector => {
                    const elements = document.querySelectorAll(selector);
                    if (elements.length > 0) {
                        results.debugInfo.push(`Found ${elements.length} elements with selector: ${selector}`);
                    }
                });

                // Strategy 3: Look for name-rating pairs in all divs
                const allDivs = document.querySelectorAll('div');
                let divPlayerCount = 0;
                
                allDivs.forEach(div => {
                    const text = div.textContent.trim();
                    
                    // Look for pattern: Name followed by number (on separate lines or same line)
                    const nameRatingPattern = text.match(/^([A-Za-z][A-Za-z0-9_\-\[\]\.@#$%&*+=<>?!\s]{1,25})\s*\n?\s*(\d{3,6})$/);
                    if (nameRatingPattern) {
                        const name = nameRatingPattern[1].trim();
                        const rating = parseInt(nameRatingPattern[2]);
                        
                        // Validate
                        if (name.length >= 2 && rating >= 100 && rating <= 50000 &&
                            !name.toLowerCase().includes('player') &&
                            !name.toLowerCase().includes('rating') &&
                            !name.toLowerCase().includes('num.')) {
                            
                            // Check if not already found
                            const exists = results.players.some(p => p.name.toLowerCase() === name.toLowerCase());
                            if (!exists) {
                                results.players.push({
                                    name: name,
                                    rating: rating,
                                    source: 'div-pattern',
                                    rawText: text
                                });
                                divPlayerCount++;
                            }
                        }
                    }
                });

                results.debugInfo.push(`Strategy 3 found ${divPlayerCount} additional players from div patterns`);

                // Remove duplicates and sort
                const uniquePlayers = [];
                const seenNames = new Set();
                
                results.players.forEach(player => {
                    const lowerName = player.name.toLowerCase();
                    if (!seenNames.has(lowerName)) {
                        seenNames.add(lowerName);
                        uniquePlayers.push(player);
                    }
                });

                results.players = uniquePlayers.sort((a, b) => b.rating - a.rating);

                return results;
            });

            await page.close();

            // Display results
            console.log('\n📊 SQUADRON INFO:');
            console.log(`   Name: ${extractionResults.squadronInfo.name || 'Not found'}`);
            console.log(`   Rating: ${extractionResults.squadronInfo.rating || 'Not found'}`);

            console.log('\n📋 EXTRACTION DEBUG:');
            extractionResults.debugInfo.forEach(info => console.log(info));

            if (extractionResults.gridAnalysis.length > 0) {
                console.log('\n🔍 DETAILED GRID ANALYSIS (first 3 items):');
                extractionResults.gridAnalysis.slice(0, 3).forEach(item => {
                    console.log(`\n   Grid Item ${item.index + 1}:`);
                    console.log(`     Classes: ${item.classes}`);
                    console.log(`     Text: "${item.textContent}"`);
                    console.log(`     Children: ${item.children.length} elements`);
                    if (item.children.length > 0) {
                        item.children.slice(0, 5).forEach(child => {
                            console.log(`       <${child.tagName}${child.className ? '.' + child.className : ''}> "${child.textContent}"`);
                        });
                    }
                });
            }

            if (extractionResults.players.length > 0) {
                console.log(`\n✅ EXTRACTED PLAYERS (${extractionResults.players.length} found):`);
                extractionResults.players.slice(0, 20).forEach((player, index) => {
                    console.log(`   ${index + 1}. "${player.name}" - ${player.rating.toLocaleString()} (${player.source})`);
                });

                if (extractionResults.players.length > 20) {
                    console.log(`   ... and ${extractionResults.players.length - 20} more players`);
                }
            } else {
                console.log('\n❌ NO PLAYERS EXTRACTED');
                console.log('   This indicates the extraction logic needs adjustment for the current page structure.');
            }

            return extractionResults.players;
            
        } catch (error) {
            console.error('❌ Test failed:', error.message);
            throw error;
        }
    }

    async cleanup() {
        if (this.browser) {
            await this.browser.close();
            console.log('\n🧹 Browser closed');
        }
    }
}

// Run the test
async function runTest() {
    const tester = new GridExtractionTester();
    
    try {
        const players = await tester.testGridExtraction();
        
        console.log(`\n🎯 GRID EXTRACTION TEST COMPLETED`);
        console.log(`   Successfully extracted ${players.length} players`);
        
        if (players.length > 0) {
            console.log(`\n📈 VALIDATION SUMMARY:`);
            console.log(`   Top player: "${players[0].name}" with ${players[0].rating.toLocaleString()} rating`);
            console.log(`   Lowest player: "${players[players.length - 1].name}" with ${players[players.length - 1].rating.toLocaleString()} rating`);
            
            // Show sample of names to check quality
            console.log(`\n🧪 SAMPLE NAMES FOR VALIDATION:`);
            players.slice(0, 10).forEach((player, i) => {
                console.log(`   ${i + 1}. "${player.name}"`);
            });
        }
        
    } catch (error) {
        console.error('❌ Test execution failed:', error.message);
    } finally {
        await tester.cleanup();
    }
}

// Execute the test
runTest().catch(console.error);
