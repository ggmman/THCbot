const puppeteer = require('puppeteer');
const fs = require('fs');
require('dotenv').config();

class PlayerDataTester {
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
            console.log('🌐 Initializing browser for testing...');
            
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

    async testPlayerDataScraping() {
        try {
            console.log(`\n🧪 Testing player data scraping for: ${this.config.squadronName}\n`);
            
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

            // Add random delay
            await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));

            // Wait for page to fully load
            console.log('⏳ Waiting for page to fully load...');
            try {
                await page.waitForFunction(
                    () => {
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

            // Check for Cloudflare challenge
            const isCloudflareChallenge = await page.evaluate(() => {
                return document.title.includes('Just a moment') || 
                       document.querySelector('[data-ray]') !== null ||
                       document.querySelector('.cf-') !== null ||
                       document.body.textContent.includes('Checking your browser');
            });

            if (isCloudflareChallenge) {
                console.log('🛡️ Cloudflare challenge detected, waiting...');
                await new Promise(resolve => setTimeout(resolve, 10000));
                
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

            // Extract and analyze data with detailed logging
            const testResults = await page.evaluate(() => {
                let players = [];
                let debugInfo = [];
                let rejectedPlayers = [];
                
                console.log('🔍 Starting data extraction...');
                
                // Strategy 1: Look for tables with actual player data
                const tables = document.querySelectorAll('table');
                debugInfo.push(`Found ${tables.length} tables on page`);
                
                tables.forEach((table, tableIndex) => {
                    const rows = table.querySelectorAll('tr');
                    debugInfo.push(`\n📊 Table ${tableIndex + 1}: ${rows.length} rows`);
                    
                    // Log first few rows for debugging
                    if (rows.length > 0) {
                        debugInfo.push('  Sample rows:');
                        for (let i = 0; i < Math.min(5, rows.length); i++) {
                            const cells = rows[i].querySelectorAll('td, th');
                            const cellTexts = Array.from(cells).map(cell => cell.textContent.trim()).slice(0, 4);
                            debugInfo.push(`    Row ${i + 1}: [${cellTexts.join(' | ')}]`);
                        }
                    }
                    
                    rows.forEach((row, rowIndex) => {
                        if (rowIndex === 0) return; // Skip potential header row
                        
                        const cells = row.querySelectorAll('td');
                        if (cells.length >= 2) {
                            // Try different column combinations
                            for (let nameCol = 0; nameCol < cells.length - 1; nameCol++) {
                                for (let ratingCol = nameCol + 1; ratingCol < cells.length; ratingCol++) {
                                    const nameText = cells[nameCol].textContent.trim();
                                    const ratingText = cells[ratingCol].textContent.trim();
                                    
                                    // DETAILED VALIDATION WITH LOGGING
                                    const validationResults = {
                                        name: nameText,
                                        rating: ratingText,
                                        checks: {}
                                    };
                                    
                                    // Length check
                                    validationResults.checks.lengthOk = nameText.length >= 1 && nameText.length <= 30;
                                    
                                    // Has letter check
                                    validationResults.checks.hasLetter = /[A-Za-z]/.test(nameText);
                                    
                                    // Character validation
                                    validationResults.checks.validChars = /^[A-Za-z0-9_\-\[\]\.@#$%&*+=<>?!\s\u00C0-\u017F\u0400-\u04FF\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\u0100-\u017F]+$/.test(nameText);
                                    
                                    // Block known non-player terms
                                    validationResults.checks.notBlockedTerm = !nameText.match(/^(rating|position|name|player|rank|recommended|minimum|commander|officer|sergeant|private|deputy|admin|mod|header|footer|table|row|cell|div|span|button|link|menu|nav|activity|squadron|intel|core|ryzen|flight|time|graphics|card|processor|cpu|gpu|memory|ram|nvidia|amd|pro|iris|radeon|geforce|gtx|rtx|youtube|facebook|twitter|age|tier|level|lvl|directx|ubuntu|linux|windows|mac|os|big|sur|dual|entry|date|nickname|must|be|older|than|not|more|geforce|dual-core|requirements|system|spec|specification)$/i);
                                    
                                    // Block requirement phrases
                                    validationResults.checks.notRequirementPhrase = !nameText.match(/^(squadron rating|flight time|intel iris|intel core|core i[35579]|ryzen [357]|graphics card|nvidia geforce|radeon rx|geforce gtx|must be|not older than|more than|date of entry|the nickname|dual-core|mac os|big sur|epic games|steam|origin|battle net|war thunder)$/i);
                                    
                                    // Not single letters
                                    validationResults.checks.notSingleLetters = !nameText.match(/^[a-z]{1,2}$/i);
                                    
                                    // Not pure numbers
                                    validationResults.checks.notPureNumbers = !nameText.match(/^\d+$/);
                                    
                                    // Not whitespace
                                    validationResults.checks.notWhitespace = nameText.trim().length > 0;
                                    
                                    const rating = parseInt(ratingText.replace(/[^\d]/g, '')) || 0;
                                    validationResults.checks.validRating = (rating > 0 && rating <= 100000) || 
                                                         (rating === 0 && ratingText !== '' && ratingText !== nameText);
                                    
                                    // Proper pair validation
                                    validationResults.checks.properPair = nameText !== ratingText && 
                                                         nameText.length > 1 && 
                                                         ratingText.length > 0 &&
                                                         !nameText.includes(ratingText) &&
                                                         !ratingText.includes(nameText);
                                    
                                    // Username-like validation
                                    validationResults.checks.looksLikeUsername = 
                                        /[A-Za-z0-9]/.test(nameText) &&
                                        (nameText !== nameText.toUpperCase() || nameText.length <= 12) &&
                                        !nameText.toLowerCase().includes('must') &&
                                        !nameText.toLowerCase().includes('requirement') &&
                                        !nameText.toLowerCase().includes('older') &&
                                        !nameText.toLowerCase().includes('entry') &&
                                        !nameText.toLowerCase().includes('nickname') &&
                                        !nameText.toLowerCase().includes('**') &&
                                        !nameText.includes('\n');
                                    
                                    const allChecksPass = Object.values(validationResults.checks).every(check => check === true);
                                    
                                    if (allChecksPass) {
                                        players.push({ 
                                            name: nameText, 
                                            rating,
                                            source: `table-${tableIndex + 1}-col${nameCol + 1}-col${ratingCol + 1}`,
                                            validation: 'PASSED'
                                        });
                                    } else {
                                        rejectedPlayers.push({
                                            ...validationResults,
                                            rating: rating,
                                            source: `table-${tableIndex + 1}-col${nameCol + 1}-col${ratingCol + 1}`,
                                            validation: 'FAILED'
                                        });
                                    }
                                }
                            }
                        }
                    });
                });
                
                // Strategy 2: Text pattern matching (if no table data found)
                if (players.length === 0) {
                    debugInfo.push('\n🔍 No table data found, trying text pattern matching...');
                    
                    const pageText = document.body.textContent;
                    const playerMatches = pageText.match(/\b([A-Za-z][A-Za-z0-9_\-\[\]\.@#$%&*+=<>?!\s\u00C0-\u017F\u0400-\u04FF\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\u0100-\u017F]{0,29})\s+(\d{1,6})\b/g);
                    
                    if (playerMatches) {
                        debugInfo.push(`Found ${playerMatches.length} potential text patterns`);
                        
                        playerMatches.slice(0, 10).forEach((match, index) => {
                            const parts = match.match(/\b([A-Za-z][A-Za-z0-9_\-\[\]\.@#$%&*+=<>?!\s\u00C0-\u017F\u0400-\u04FF\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\u0100-\u017F]{0,29})\s+(\d{1,6})\b/);
                            if (parts) {
                                debugInfo.push(`  Pattern ${index + 1}: "${parts[1]}" -> ${parts[2]}`);
                            }
                        });
                    }
                }
                
                // Remove duplicates
                const uniquePlayers = [];
                const seenNames = new Set();
                
                players.forEach(player => {
                    const lowerName = player.name.toLowerCase();
                    if (!seenNames.has(lowerName)) {
                        seenNames.add(lowerName);
                        uniquePlayers.push(player);
                    }
                });
                
                // Sort by rating
                const sortedPlayers = uniquePlayers.sort((a, b) => b.rating - a.rating);
                
                return {
                    players: sortedPlayers,
                    debugInfo,
                    rejectedPlayers: rejectedPlayers.slice(0, 20), // Limit rejected players for readability
                    totalFound: players.length,
                    totalUnique: uniquePlayers.length
                };
            });

            await page.close();
            
            // Display results
            console.log('\n📋 EXTRACTION DEBUG INFO:');
            testResults.debugInfo.forEach(info => console.log(info));
            
            console.log(`\n📊 EXTRACTION SUMMARY:`);
            console.log(`   Total candidates found: ${testResults.totalFound}`);
            console.log(`   Unique players after dedup: ${testResults.totalUnique}`);
            console.log(`   Players that passed validation: ${testResults.players.length}`);
            console.log(`   Sample rejected entries: ${testResults.rejectedPlayers.length}`);
            
            if (testResults.players.length > 0) {
                console.log(`\n✅ TOP 20 PLAYERS THAT PASSED VALIDATION:`);
                testResults.players.slice(0, 20).forEach((player, index) => {
                    console.log(`   ${index + 1}. "${player.name}" - ${player.rating.toLocaleString()} (${player.source})`);
                });
            }
            
            if (testResults.rejectedPlayers.length > 0) {
                console.log(`\n❌ SAMPLE REJECTED ENTRIES (first 10):`);
                testResults.rejectedPlayers.slice(0, 10).forEach((rejected, index) => {
                    const failedChecks = Object.entries(rejected.checks)
                        .filter(([key, value]) => value === false)
                        .map(([key]) => key);
                    
                    console.log(`   ${index + 1}. "${rejected.name}" -> ${rejected.rating} (FAILED: ${failedChecks.join(', ')})`);
                });
            }
            
            return testResults.players;
            
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
    const tester = new PlayerDataTester();
    
    try {
        const players = await tester.testPlayerDataScraping();
        
        console.log(`\n🎯 TEST COMPLETED`);
        console.log(`   Found ${players.length} validated players`);
        
        if (players.length === 0) {
            console.log(`\n⚠️  NO PLAYERS FOUND - This could indicate:`);
            console.log(`   - Squadron page structure has changed`);
            console.log(`   - Squadron name is incorrect`);
            console.log(`   - Website is blocked or protected`);
            console.log(`   - Validation rules are too strict`);
        }
        
    } catch (error) {
        console.error('❌ Test execution failed:', error.message);
    } finally {
        await tester.cleanup();
    }
}

// Execute the test
runTest().catch(console.error);
