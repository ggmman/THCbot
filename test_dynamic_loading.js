const puppeteer = require('puppeteer');
const fs = require('fs');
require('dotenv').config();

class DynamicContentTester {
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
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu'
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

    async testDynamicLoading() {
        try {
            console.log(`\n🔍 Testing dynamic content loading for: ${this.config.squadronName}\n`);
            
            if (!this.browser) {
                await this.initializeBrowser();
            }

            const url = `https://warthunder.com/en/community/claninfo/${encodeURIComponent(this.config.squadronName)}`;
            console.log(`🌐 Navigating to: ${url}`);
            
            const page = await this.browser.newPage();
            
            // Set user agent to look more like a real browser
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            // Navigate to the page
            await page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            console.log('⏳ Initial page load complete, waiting for dynamic content...');

            // Wait for potential authentication/dynamic loading
            await new Promise(resolve => setTimeout(resolve, 10000));

            // Take screenshot after initial load
            await page.screenshot({ path: 'after_initial_load.png', fullPage: true });
            console.log('📸 Screenshot after initial load saved');

            // Try to find squadron data containers
            console.log('🔍 Looking for squadron data containers...');
            
            const foundContainers = await page.evaluate(() => {
                const results = {
                    playerTables: [],
                    squadronInfo: [],
                    memberLists: [],
                    ratingElements: [],
                    allTextContent: document.body.textContent.substring(0, 5000)
                };

                // Look for various squadron/player related elements
                const playerSelectors = [
                    'table[class*="player"]',
                    'table[class*="member"]',
                    'div[class*="player"]', 
                    'div[class*="member"]',
                    '.squadron-players',
                    '.clan-players',
                    '.member-list',
                    '.rating-table',
                    '[data-player]',
                    '[data-member]'
                ];

                playerSelectors.forEach(selector => {
                    const elements = document.querySelectorAll(selector);
                    if (elements.length > 0) {
                        results.playerTables.push({
                            selector: selector,
                            count: elements.length,
                            sampleContent: Array.from(elements).slice(0, 2).map(el => el.textContent.trim().substring(0, 200))
                        });
                    }
                });

                // Look for any elements containing numbers that could be ratings
                const elementsWithNumbers = document.querySelectorAll('*');
                let ratingCandidates = [];
                
                elementsWithNumbers.forEach(el => {
                    const text = el.textContent.trim();
                    // Look for 3-6 digit numbers that could be ratings
                    const ratingMatch = text.match(/\b(\d{3,6})\b/);
                    if (ratingMatch && el.children.length === 0) { // Only leaf elements
                        const number = parseInt(ratingMatch[1]);
                        if (number >= 100 && number <= 50000) { // Reasonable rating range
                            ratingCandidates.push({
                                text: text,
                                number: number,
                                tagName: el.tagName,
                                className: el.className,
                                parentText: el.parentElement ? el.parentElement.textContent.trim().substring(0, 100) : ''
                            });
                        }
                    }
                });

                // Sort by number and take top candidates
                results.ratingElements = ratingCandidates
                    .sort((a, b) => b.number - a.number)
                    .slice(0, 20);

                return results;
            });

            console.log('\n📊 DYNAMIC CONTENT ANALYSIS:');
            
            if (foundContainers.playerTables.length > 0) {
                console.log(`✅ Found ${foundContainers.playerTables.length} potential player containers:`);
                foundContainers.playerTables.forEach((container, i) => {
                    console.log(`   ${i + 1}. ${container.selector} (${container.count} elements)`);
                    if (container.sampleContent.length > 0) {
                        container.sampleContent.forEach((content, j) => {
                            console.log(`      Sample ${j + 1}: "${content}"`);
                        });
                    }
                });
            } else {
                console.log('❌ No player containers found');
            }

            if (foundContainers.ratingElements.length > 0) {
                console.log(`\n🏆 Potential rating numbers found:`);
                foundContainers.ratingElements.slice(0, 10).forEach((rating, i) => {
                    console.log(`   ${i + 1}. ${rating.number} in <${rating.tagName}${rating.className ? '.' + rating.className : ''}>`);
                    console.log(`      Context: "${rating.parentText}"`);
                });
            } else {
                console.log('\n❌ No potential rating numbers found');
            }

            // Wait longer and check again
            console.log('\n⏳ Waiting additional 15 seconds for more content to load...');
            await new Promise(resolve => setTimeout(resolve, 15000));

            // Check if anything changed
            const afterWait = await page.evaluate(() => {
                return {
                    tableCount: document.querySelectorAll('table').length,
                    hasNewContent: document.body.textContent.length,
                    newTables: Array.from(document.querySelectorAll('table')).map((table, i) => ({
                        index: i,
                        rowCount: table.querySelectorAll('tr').length,
                        cellCount: table.querySelectorAll('td, th').length,
                        sampleText: table.textContent.trim().substring(0, 200)
                    }))
                };
            });

            console.log('\n📈 AFTER ADDITIONAL WAIT:');
            console.log(`   Tables found: ${afterWait.tableCount}`);
            console.log(`   Content length: ${afterWait.hasNewContent} chars`);

            if (afterWait.newTables.length > 0) {
                console.log('\n📋 ALL TABLES AFTER WAIT:');
                afterWait.newTables.forEach(table => {
                    console.log(`   Table ${table.index + 1}: ${table.rowCount} rows, ${table.cellCount} cells`);
                    if (table.sampleText) {
                        console.log(`     Sample: "${table.sampleText}"`);
                    }
                });
            }

            // Final screenshot
            await page.screenshot({ path: 'after_full_wait.png', fullPage: true });
            console.log('📸 Final screenshot saved as after_full_wait.png');

            // Try the original scraping logic on the fully loaded page
            console.log('\n🔬 Testing original scraping logic on fully loaded page...');
            
            const scrapingResults = await page.evaluate(() => {
                let players = [];
                let debugInfo = [];
                
                // Test the exact same logic from the main bot
                const tables = document.querySelectorAll('table');
                debugInfo.push(`Found ${tables.length} tables after full load`);
                
                tables.forEach((table, tableIndex) => {
                    const rows = table.querySelectorAll('tr');
                    debugInfo.push(`Table ${tableIndex + 1}: ${rows.length} rows`);
                    
                    // Show more detail about table content
                    if (rows.length > 0) {
                        debugInfo.push(`  Table ${tableIndex + 1} content preview:`);
                        for (let i = 0; i < Math.min(10, rows.length); i++) {
                            const cells = rows[i].querySelectorAll('td, th');
                            const cellTexts = Array.from(cells).map(cell => cell.textContent.trim());
                            if (cellTexts.some(text => text.length > 0)) {
                                debugInfo.push(`    Row ${i + 1}: [${cellTexts.join(' | ')}]`);
                            }
                        }
                    }
                });

                return { players, debugInfo };
            });

            console.log('\n🔬 SCRAPING RESULTS:');
            scrapingResults.debugInfo.forEach(info => console.log(info));

            await page.close();
            
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
    const tester = new DynamicContentTester();
    
    try {
        await tester.testDynamicLoading();
        console.log(`\n🎯 DYNAMIC LOADING TEST COMPLETED`);
        
    } catch (error) {
        console.error('❌ Test execution failed:', error.message);
    } finally {
        await tester.cleanup();
    }
}

// Execute the test
runTest().catch(console.error);
