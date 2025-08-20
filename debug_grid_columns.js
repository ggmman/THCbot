const puppeteer = require('puppeteer');
const fs = require('fs');
require('dotenv').config();

class GridColumnDebugger {
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

    async debugGridColumns() {
        try {
            console.log('🔍 Debugging grid columns to find actual rating points...\n');
            
            const browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });

            const url = `https://warthunder.com/en/community/claninfo/${encodeURIComponent(this.config.squadronName)}`;
            const page = await browser.newPage();
            
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 15000));

            const gridAnalysis = await page.evaluate(() => {
                const results = {
                    gridItems: [],
                    reconstructedRows: [],
                    columnAnalysis: {},
                    allNumbers: []
                };

                // Get all grid items in order
                const gridItems = document.querySelectorAll('.squadrons-members__grid-item');
                console.log(`Found ${gridItems.length} grid items`);

                // Collect all grid item texts
                gridItems.forEach((item, index) => {
                    const text = item.textContent.trim();
                    results.gridItems.push({
                        index: index,
                        text: text,
                        isNumber: /^\d+$/.test(text),
                        number: /^\d+$/.test(text) ? parseInt(text) : null
                    });
                });

                // Try to reconstruct the grid structure
                // Look for patterns - headers vs data
                const headers = [];
                const dataRows = [];
                let currentRow = [];
                
                let inDataSection = false;
                
                gridItems.forEach((item, index) => {
                    const text = item.textContent.trim();
                    
                    // Detect headers (before data starts)
                    if (!inDataSection) {
                        if (text.toLowerCase().includes('num') || 
                            text.toLowerCase().includes('player') || 
                            text.toLowerCase().includes('rating') ||
                            text.toLowerCase().includes('activity') ||
                            text.toLowerCase().includes('role') ||
                            text.toLowerCase().includes('date')) {
                            headers.push(text);
                        } else if (text.match(/^\d+$/) && parseInt(text) <= 50) {
                            // Likely start of data (player position numbers)
                            inDataSection = true;
                            currentRow = [text];
                        }
                    } else {
                        // In data section
                        currentRow.push(text);
                        
                        // Detect end of row (next position number)
                        if (text.match(/^\d+$/) && parseInt(text) <= 50 && currentRow.length > 1) {
                            // Complete previous row
                            if (currentRow.length > 5) {
                                dataRows.push([...currentRow.slice(0, -1)]); // Remove the last item (next row's first item)
                            }
                            currentRow = [text]; // Start new row
                        } else if (currentRow.length >= 6) {
                            // Row seems complete
                            dataRows.push([...currentRow]);
                            currentRow = [];
                        }
                    }
                });
                
                // Add final row
                if (currentRow.length >= 4) {
                    dataRows.push(currentRow);
                }

                results.headers = headers;
                results.reconstructedRows = dataRows;

                // Analyze each column to find patterns
                if (dataRows.length > 0) {
                    const maxCols = Math.max(...dataRows.map(row => row.length));
                    
                    for (let col = 0; col < maxCols; col++) {
                        const columnData = dataRows.map(row => row[col]).filter(Boolean);
                        const numbers = columnData.filter(val => /^\d+$/.test(val)).map(val => parseInt(val));
                        
                        results.columnAnalysis[col] = {
                            sampleData: columnData.slice(0, 10),
                            allNumbers: numbers.sort((a, b) => a - b),
                            range: numbers.length > 0 ? `${Math.min(...numbers)} - ${Math.max(...numbers)}` : 'No numbers',
                            avgNumber: numbers.length > 0 ? Math.round(numbers.reduce((a, b) => a + b, 0) / numbers.length) : 0,
                            containsNames: columnData.some(val => /[A-Za-z]/.test(val) && val.length > 2),
                            isLikelyRating: numbers.length > 0 && Math.max(...numbers) > 500 && Math.max(...numbers) < 5000
                        };
                    }
                }

                // Find all high numbers (potential ratings)
                const allText = document.body.textContent;
                const highNumbers = allText.match(/\b\d{3,4}\b/g);
                if (highNumbers) {
                    const uniqueHighNumbers = [...new Set(highNumbers.map(n => parseInt(n)))]
                        .filter(n => n >= 500 && n <= 3000)
                        .sort((a, b) => b - a);
                    results.allNumbers = uniqueHighNumbers.slice(0, 30);
                }

                return results;
            });

            await page.close();
            await browser.close();

            console.log('📊 GRID STRUCTURE ANALYSIS:');
            console.log(`   Headers found: ${gridAnalysis.headers.join(' | ')}`);
            console.log(`   Data rows reconstructed: ${gridAnalysis.reconstructedRows.length}`);
            console.log(`   Grid items total: ${gridAnalysis.gridItems.length}`);

            if (gridAnalysis.reconstructedRows.length > 0) {
                console.log('\n📋 SAMPLE DATA ROWS:');
                gridAnalysis.reconstructedRows.slice(0, 5).forEach((row, i) => {
                    console.log(`   Row ${i + 1}: [${row.join(' | ')}]`);
                });

                console.log('\n📈 COLUMN ANALYSIS:');
                Object.entries(gridAnalysis.columnAnalysis).forEach(([col, data]) => {
                    console.log(`   Column ${col}: ${data.range} (avg: ${data.avgNumber})`);
                    console.log(`     Sample: [${data.sampleData.slice(0, 5).join(', ')}]`);
                    console.log(`     Contains names: ${data.containsNames}, Likely rating: ${data.isLikelyRating}`);
                });

                // Find the rating column
                const ratingColumns = Object.entries(gridAnalysis.columnAnalysis)
                    .filter(([col, data]) => data.isLikelyRating)
                    .map(([col]) => parseInt(col));

                if (ratingColumns.length > 0) {
                    console.log(`\n🎯 LIKELY RATING COLUMNS: ${ratingColumns.join(', ')}`);
                    
                    ratingColumns.forEach(col => {
                        const data = gridAnalysis.columnAnalysis[col];
                        console.log(`   Column ${col} ratings: ${data.allNumbers.slice(0, 10).join(', ')}`);
                    });
                } else {
                    console.log('\n❌ No obvious rating column found');
                }
            }

            if (gridAnalysis.allNumbers.length > 0) {
                console.log(`\n🔢 HIGH NUMBERS FOUND ON PAGE (500-3000 range):`);
                console.log(`   ${gridAnalysis.allNumbers.slice(0, 20).join(', ')}`);
                console.log(`   These might be the actual player ratings!`);
            }

        } catch (error) {
            console.error('❌ Debug failed:', error.message);
        }
    }
}

new GridColumnDebugger().debugGridColumns().catch(console.error);
