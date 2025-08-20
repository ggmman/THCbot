const puppeteer = require('puppeteer');
const fs = require('fs');
require('dotenv').config();

class PageStructureDebugger {
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
                headless: false, // Show browser to see what's happening
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

    async debugPageStructure() {
        try {
            console.log(`\n🔍 Debugging page structure for: ${this.config.squadronName}\n`);
            
            if (!this.browser) {
                await this.initializeBrowser();
            }

            const url = `https://warthunder.com/en/community/claninfo/${encodeURIComponent(this.config.squadronName)}`;
            console.log(`🌐 Navigating to: ${url}`);
            
            const page = await this.browser.newPage();
            
            // Navigate to the page
            await page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            // Wait for page to load
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Take a screenshot
            await page.screenshot({ path: 'squadron_page.png', fullPage: true });
            console.log('📸 Screenshot saved as squadron_page.png');

            // Get page title and URL
            const pageTitle = await page.title();
            const currentUrl = page.url();
            console.log(`📄 Page title: "${pageTitle}"`);
            console.log(`🔗 Current URL: ${currentUrl}`);

            // Check if we're on the right page
            const pageAnalysis = await page.evaluate(() => {
                const results = {
                    hasSquadronInfo: false,
                    hasPlayerData: false,
                    squadronName: null,
                    playerCount: 0,
                    tableCount: 0,
                    tableStructures: [],
                    textContent: document.body.textContent.substring(0, 2000), // First 2000 chars
                    allLinks: [],
                    errorMessages: []
                };

                // Check for squadron-related content
                const squadronElements = document.querySelectorAll('[class*="squadron"], [class*="clan"], [id*="squadron"], [id*="clan"]');
                results.hasSquadronInfo = squadronElements.length > 0;

                // Look for squadron name
                const headings = document.querySelectorAll('h1, h2, h3, .title, .name');
                headings.forEach(heading => {
                    const text = heading.textContent.trim();
                    if (text.toLowerCase().includes('try hard coalition') || text.toLowerCase().includes('coalition')) {
                        results.squadronName = text;
                    }
                });

                // Analyze all tables
                const tables = document.querySelectorAll('table');
                results.tableCount = tables.length;

                tables.forEach((table, index) => {
                    const rows = table.querySelectorAll('tr');
                    const structure = {
                        index: index,
                        rowCount: rows.length,
                        columns: [],
                        sampleData: []
                    };

                    if (rows.length > 0) {
                        // Get column info from first row
                        const firstRowCells = rows[0].querySelectorAll('td, th');
                        structure.columns = Array.from(firstRowCells).map(cell => ({
                            text: cell.textContent.trim(),
                            tagName: cell.tagName
                        }));

                        // Get sample data from first few rows
                        for (let i = 0; i < Math.min(5, rows.length); i++) {
                            const cells = rows[i].querySelectorAll('td, th');
                            const rowData = Array.from(cells).map(cell => cell.textContent.trim());
                            structure.sampleData.push(rowData);
                        }
                    }

                    results.tableStructures.push(structure);
                });

                // Look for player-like data patterns
                const possiblePlayerPatterns = document.body.textContent.match(/\b[A-Za-z][A-Za-z0-9_\-\[\]\.]{2,20}\s+\d{1,6}\b/g);
                if (possiblePlayerPatterns) {
                    results.playerCount = possiblePlayerPatterns.length;
                }

                // Check for error messages
                const errorKeywords = ['not found', 'error', 'invalid', 'does not exist', 'access denied'];
                errorKeywords.forEach(keyword => {
                    if (document.body.textContent.toLowerCase().includes(keyword)) {
                        results.errorMessages.push(`Found "${keyword}" in page content`);
                    }
                });

                // Get all links
                const links = document.querySelectorAll('a[href]');
                results.allLinks = Array.from(links).slice(0, 10).map(link => ({
                    text: link.textContent.trim(),
                    href: link.href
                }));

                return results;
            });

            console.log('\n📊 PAGE ANALYSIS RESULTS:');
            console.log(`   Has squadron info: ${pageAnalysis.hasSquadronInfo}`);
            console.log(`   Squadron name found: ${pageAnalysis.squadronName || 'None'}`);
            console.log(`   Table count: ${pageAnalysis.tableCount}`);
            console.log(`   Possible player patterns: ${pageAnalysis.playerCount}`);
            console.log(`   Error messages: ${pageAnalysis.errorMessages.length > 0 ? pageAnalysis.errorMessages.join(', ') : 'None'}`);

            if (pageAnalysis.tableStructures.length > 0) {
                console.log('\n📋 TABLE STRUCTURES:');
                pageAnalysis.tableStructures.forEach(table => {
                    console.log(`\n   Table ${table.index + 1}: ${table.rowCount} rows`);
                    if (table.columns.length > 0) {
                        console.log(`     Columns: ${table.columns.map(col => `"${col.text}"`).join(' | ')}`);
                    }
                    if (table.sampleData.length > 0) {
                        console.log(`     Sample data:`);
                        table.sampleData.forEach((row, i) => {
                            console.log(`       Row ${i + 1}: [${row.join(' | ')}]`);
                        });
                    }
                });
            }

            if (pageAnalysis.allLinks.length > 0) {
                console.log('\n🔗 SAMPLE LINKS:');
                pageAnalysis.allLinks.forEach((link, i) => {
                    console.log(`   ${i + 1}. "${link.text}" -> ${link.href}`);
                });
            }

            console.log('\n📝 PAGE TEXT PREVIEW (first 2000 chars):');
            console.log(pageAnalysis.textContent);

            await page.close();
            
        } catch (error) {
            console.error('❌ Debug failed:', error.message);
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

// Run the debug
async function runDebug() {
    const pageDebugger = new PageStructureDebugger();
    
    try {
        await pageDebugger.debugPageStructure();
        console.log(`\n🎯 DEBUG COMPLETED`);
        
    } catch (error) {
        console.error('❌ Debug execution failed:', error.message);
    } finally {
        await pageDebugger.cleanup();
    }
}

// Execute the debug
runDebug().catch(console.error);
