const puppeteer = require('puppeteer');
const fs = require('fs');
require('dotenv').config();

// Test the simplified extraction logic
class SimplifiedExtractionTester {
    constructor() {
        this.config = this.loadConfig();
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

    async testSimplifiedExtraction() {
        try {
            console.log('🧪 Testing SIMPLIFIED extraction logic (6-column grid)...\n');
            
            const browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });

            const url = `https://warthunder.com/en/community/claninfo/${encodeURIComponent(this.config.squadronName)}`;
            const page = await browser.newPage();
            
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 10000));

            // Use the EXACT simplified logic from the updated bot
            const results = await page.evaluate(() => {
                let players = [];
                let debugInfo = [];
                
                debugInfo.push('Using SIMPLIFIED War Thunder grid extraction...');
                
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
                    
                    // Extract players using fixed column positions
                    rowData.forEach((row, rowIndex) => {
                        if (row.length >= 6) {
                            // Fixed column positions: [Position | Player Name | Personal Rating | Activity | Role | Date]
                            const nameText = row[1];    // Column 1: Player Name
                            const ratingText = row[2];  // Column 2: Personal clan rating
                            
                            // Player name validation
                            const isValidPlayerName = 
                                nameText && nameText.length >= 2 && nameText.length <= 30 &&
                                /[A-Za-z]/.test(nameText) &&
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
                                    source: `grid-row-${rowIndex}-simplified`,
                                    rawRow: row
                                });
                            }
                        }
                    });
                }
                
                // Remove duplicates and sort
                const uniquePlayers = [];
                const seenNames = new Set();
                
                players.forEach(player => {
                    const lowerName = player.name.toLowerCase();
                    if (!seenNames.has(lowerName)) {
                        seenNames.add(lowerName);
                        uniquePlayers.push(player);
                    }
                });
                
                return {
                    players: uniquePlayers.sort((a, b) => b.rating - a.rating),
                    debugInfo
                };
            });

            await page.close();
            await browser.close();

            console.log('📊 SIMPLIFIED EXTRACTION RESULTS:');
            results.debugInfo.forEach(info => console.log(`   ${info}`));

            if (results.players.length > 0) {
                console.log(`\n✅ SUCCESS: Found ${results.players.length} players with CORRECT ratings!`);
                console.log(`   Rating range: ${results.players[results.players.length - 1].rating} - ${results.players[0].rating}`);
                
                console.log(`\n🏆 TOP 20 PLAYERS (with REAL ratings):`);
                results.players.slice(0, 20).forEach((player, index) => {
                    console.log(`   ${index + 1}. "${player.name}" - ${player.rating.toLocaleString()} points`);
                });

                // Check if we're getting the expected 1600-1800 range
                const highRatingPlayers = results.players.filter(p => p.rating >= 1500);
                if (highRatingPlayers.length > 0) {
                    console.log(`\n🎯 HIGH-RATING PLAYERS (≥1500 points): ${highRatingPlayers.length} found!`);
                    highRatingPlayers.slice(0, 5).forEach(player => {
                        console.log(`   "${player.name}" - ${player.rating.toLocaleString()}`);
                    });
                    console.log(`\n🎉 SUCCESS: Now getting REAL ratings in the 1600-1800 range! 🎉`);
                } else {
                    console.log(`\n📊 Highest rating found: ${results.players[0].rating} (may still be correct)`);
                }
                
            } else {
                console.log('\n❌ EXTRACTION FAILED - No players found');
            }

        } catch (error) {
            console.error('❌ Test failed:', error.message);
        }
    }
}

new SimplifiedExtractionTester().testSimplifiedExtraction().catch(console.error);
