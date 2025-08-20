const puppeteer = require('puppeteer');
const fs = require('fs');
require('dotenv').config();

class RatingRangeTester {
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

    async testRatingRange() {
        try {
            console.log('🔍 Testing actual rating ranges on War Thunder squadron page...\n');
            
            this.browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });

            const url = `https://warthunder.com/en/community/claninfo/${encodeURIComponent(this.config.squadronName)}`;
            const page = await this.browser.newPage();
            
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 15000)); // Wait for content to load

            const ratingAnalysis = await page.evaluate(() => {
                const ratings = [];
                const allText = document.body.textContent;
                
                // Find all numbers that could be ratings
                const numberMatches = allText.match(/\b\d{1,6}\b/g);
                
                if (numberMatches) {
                    numberMatches.forEach(match => {
                        const num = parseInt(match);
                        // Only consider reasonable rating ranges (not years, percentages, etc.)
                        if (num >= 0 && num <= 100000) {
                            ratings.push(num);
                        }
                    });
                }

                // Remove duplicates and sort
                const uniqueRatings = [...new Set(ratings)].sort((a, b) => a - b);
                
                // Get squadron rating specifically
                const squadronRatingEl = document.querySelector('.squadrons-counter__value');
                const squadronRating = squadronRatingEl ? parseInt(squadronRatingEl.textContent.trim()) : null;

                // Look for grid items with ratings
                const gridItems = document.querySelectorAll('.squadrons-members__grid-item');
                const gridRatings = [];
                
                gridItems.forEach(item => {
                    const text = item.textContent.trim();
                    const rating = parseInt(text);
                    if (!isNaN(rating) && rating > 0 && rating < 10000) {
                        gridRatings.push(rating);
                    }
                });

                return {
                    allRatings: uniqueRatings,
                    squadronRating,
                    gridRatings: [...new Set(gridRatings)].sort((a, b) => a - b),
                    sampleNumbers: uniqueRatings.slice(0, 50) // First 50 for analysis
                };
            });

            await page.close();
            await this.browser.close();

            console.log('📊 RATING ANALYSIS RESULTS:');
            console.log(`   Squadron rating: ${ratingAnalysis.squadronRating || 'Not found'}`);
            console.log(`   Total unique numbers found: ${ratingAnalysis.allRatings.length}`);
            console.log(`   Grid item ratings found: ${ratingAnalysis.gridRatings.length}`);

            if (ratingAnalysis.gridRatings.length > 0) {
                console.log(`\n🎯 PLAYER RATING RANGE (from grid items):`);
                console.log(`   Minimum: ${Math.min(...ratingAnalysis.gridRatings)}`);
                console.log(`   Maximum: ${Math.max(...ratingAnalysis.gridRatings)}`);
                console.log(`   Sample ratings: ${ratingAnalysis.gridRatings.slice(0, 20).join(', ')}`);
            }

            console.log(`\n📈 ALL NUMBERS ANALYSIS (first 30):`);
            console.log(`   Range: ${ratingAnalysis.allRatings[0]} - ${ratingAnalysis.allRatings[ratingAnalysis.allRatings.length - 1]}`);
            console.log(`   Sample: ${ratingAnalysis.sampleNumbers.slice(0, 30).join(', ')}`);

            // Determine likely rating ranges
            const playerRatings = ratingAnalysis.gridRatings.filter(r => r >= 0 && r <= 5000);
            
            if (playerRatings.length > 0) {
                console.log(`\n💡 RECOMMENDED VALIDATION RANGE:`);
                console.log(`   Player ratings: 0 - ${Math.max(Math.max(...playerRatings) * 2, 5000)} (allowing for growth)`);
                console.log(`   Current max player rating found: ${Math.max(...playerRatings)}`);
            }

        } catch (error) {
            console.error('❌ Test failed:', error.message);
        }
    }
}

new RatingRangeTester().testRatingRange().catch(console.error);
