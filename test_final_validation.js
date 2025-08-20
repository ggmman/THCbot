const puppeteer = require('puppeteer');
const fs = require('fs');
require('dotenv').config();

// Quick test of the updated rating validation
class FinalValidationTester {
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

    async quickTest() {
        try {
            console.log('🧪 Quick test of updated rating validation (0-10,000 range)...\n');
            
            const browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });

            const url = `https://warthunder.com/en/community/claninfo/${encodeURIComponent(this.config.squadronName)}`;
            const page = await browser.newPage();
            
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 10000));

            // Test the updated validation logic
            const results = await page.evaluate(() => {
                const players = [];
                const rejected = [];
                
                // Test on some sample div patterns
                const allDivs = document.querySelectorAll('div');
                allDivs.forEach(div => {
                    const text = div.textContent.trim();
                    
                    const nameRatingPattern = text.match(/^([A-Za-z][A-Za-z0-9_\-\[\]\.@#$%&*+=<>?!\s]{1,25})\s*\n?\s*(\d{2,6})$/);
                    if (nameRatingPattern) {
                        const name = nameRatingPattern[1].trim();
                        const rating = parseInt(nameRatingPattern[2]);
                        
                        // Updated validation (0-10,000 range)
                        const isValidPlayerName = 
                            name.length >= 2 && rating >= 0 && rating <= 10000 &&
                            !name.toLowerCase().includes('player') &&
                            !name.toLowerCase().includes('rating') &&
                            !name.toLowerCase().includes('num.') &&
                            !name.toLowerCase().includes('activity') &&
                            !name.toLowerCase().includes('role') &&
                            /[A-Za-z]/.test(name);
                        
                        if (isValidPlayerName) {
                            players.push({ name, rating });
                        } else {
                            rejected.push({ name, rating, reason: 'validation failed' });
                        }
                    }
                });

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

                return {
                    players: uniquePlayers.sort((a, b) => b.rating - a.rating),
                    rejected: rejected.slice(0, 10) // Sample of rejected
                };
            });

            await page.close();
            await browser.close();

            console.log(`✅ VALIDATION TEST RESULTS:`);
            console.log(`   Players found: ${results.players.length}`);
            
            if (results.players.length > 0) {
                console.log(`   Rating range: ${results.players[results.players.length - 1].rating} - ${results.players[0].rating}`);
                
                console.log(`\n🏆 TOP PLAYERS WITH UPDATED VALIDATION:`);
                results.players.slice(0, 15).forEach((player, index) => {
                    console.log(`   ${index + 1}. "${player.name}" - ${player.rating.toLocaleString()}`);
                });

                // Check if we're getting higher ratings now
                const highRatingPlayers = results.players.filter(p => p.rating > 2000);
                if (highRatingPlayers.length > 0) {
                    console.log(`\n🎯 PLAYERS WITH RATINGS > 2000 (now included):`);
                    highRatingPlayers.forEach(player => {
                        console.log(`   "${player.name}" - ${player.rating.toLocaleString()}`);
                    });
                } else {
                    console.log(`\n📝 No players found with ratings > 2000 in this test`);
                }

                console.log(`\n✅ SUCCESS: Rating validation updated to 0-10,000 range! 🎉`);
            } else {
                console.log(`\n❌ No players found - may need further adjustment`);
            }

        } catch (error) {
            console.error('❌ Test failed:', error.message);
        }
    }
}

new FinalValidationTester().quickTest().catch(console.error);
