const puppeteer = require('puppeteer');
const fs = require('fs');
require('dotenv').config();

// Debug the row reconstruction logic
class RowReconstructionDebugger {
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

    async debugRowReconstruction() {
        try {
            console.log('🔍 Debugging row reconstruction logic...\n');
            
            const browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });

            const url = `https://warthunder.com/en/community/claninfo/${encodeURIComponent(this.config.squadronName)}`;
            const page = await browser.newPage();
            
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 10000));

            const rowDebug = await page.evaluate(() => {
                const gridItems = document.querySelectorAll('.squadrons-members__grid-item');
                const results = {
                    totalItems: gridItems.length,
                    first50Items: [],
                    headers: [],
                    dataStart: -1,
                    reconstructionAttempt: []
                };

                // Get first 50 grid items to analyze
                for (let i = 0; i < Math.min(50, gridItems.length); i++) {
                    const text = gridItems[i].textContent.trim();
                    results.first50Items.push({
                        index: i,
                        text: text,
                        isNumber: /^\d+$/.test(text),
                        isSmallNumber: /^\d+$/.test(text) && parseInt(text) <= 200,
                        isHeaderLike: text.toLowerCase().includes('num') || 
                                     text.toLowerCase().includes('player') || 
                                     text.toLowerCase().includes('rating') ||
                                     text.toLowerCase().includes('activity') ||
                                     text.toLowerCase().includes('role') ||
                                     text.toLowerCase().includes('date')
                    });
                }

                // Find where headers end and data starts
                let foundDataStart = false;
                results.first50Items.forEach((item, i) => {
                    if (item.isHeaderLike) {
                        results.headers.push(item.text);
                    } else if (!foundDataStart && item.isSmallNumber) {
                        results.dataStart = i;
                        foundDataStart = true;
                    }
                });

                // Try simple approach: assume 6-column layout starting from data start
                if (results.dataStart >= 0) {
                    const dataItems = results.first50Items.slice(results.dataStart);
                    
                    // Group every 6 items as a row
                    for (let i = 0; i < Math.min(30, dataItems.length); i += 6) {
                        const row = dataItems.slice(i, i + 6).map(item => item.text);
                        if (row.length === 6) {
                            results.reconstructionAttempt.push(row);
                        }
                    }
                }

                return results;
            });

            await page.close();
            await browser.close();

            console.log('📊 ROW RECONSTRUCTION DEBUG:');
            console.log(`   Total grid items: ${rowDebug.totalItems}`);
            console.log(`   Headers found: [${rowDebug.headers.join(', ')}]`);
            console.log(`   Data starts at index: ${rowDebug.dataStart}`);

            console.log('\n📋 FIRST 50 GRID ITEMS:');
            rowDebug.first50Items.forEach(item => {
                const flags = [];
                if (item.isHeaderLike) flags.push('HEADER');
                if (item.isSmallNumber) flags.push('SMALL_NUM');
                if (item.isNumber) flags.push('NUMBER');
                
                console.log(`   ${item.index}: "${item.text}" ${flags.length > 0 ? `(${flags.join(', ')})` : ''}`);
            });

            if (rowDebug.reconstructionAttempt.length > 0) {
                console.log('\n🔧 SIMPLE RECONSTRUCTION ATTEMPT (6-column layout):');
                rowDebug.reconstructionAttempt.forEach((row, i) => {
                    console.log(`   Row ${i + 1}: [${row.join(' | ')}]`);
                });

                // Test extraction on first few rows
                console.log('\n🧪 TESTING EXTRACTION ON RECONSTRUCTED ROWS:');
                rowDebug.reconstructionAttempt.slice(0, 5).forEach((row, i) => {
                    if (row.length >= 6) {
                        const name = row[1];
                        const rating = parseInt(row[2]) || 0;
                        console.log(`   Row ${i + 1}: "${name}" -> ${rating} points`);
                    }
                });
            } else {
                console.log('\n❌ Failed to reconstruct any rows');
            }

        } catch (error) {
            console.error('❌ Debug failed:', error.message);
        }
    }
}

new RowReconstructionDebugger().debugRowReconstruction().catch(console.error);
