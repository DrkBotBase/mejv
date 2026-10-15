const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

async function parsearFlashscoreMobi(url) {
    try {
        console.log(`📡 Scraping URL: ${url}`);
        const response = await axios.get(url, { headers: HEADERS });
        const $ = cheerio.load(response.data);

        // 1. Extraer Nombres
        const headerText = $('#main > h3').text().trim();
        let homeTeam = "Local";
        let awayTeam = "Visitante";

        if (headerText.includes('-')) {
            const parts = headerText.split('-');
            homeTeam = parts[0].replace(/\(.*?\)/g, '').trim();
            awayTeam = parts[1].replace(/\(.*?\)/g, '').trim();
        }

        let homeGF = 0, homeGC = 0, homePJ = 0;
        let awayGF = 0, awayGC = 0, awayPJ = 0;

        const tables = $('#commentary-mobi table.h2h');

        function procesarTabla(tableElement, targetTeamName) {
            let gfAcc = 0, gcAcc = 0, pjCount = 0;

            tableElement.find('tr td.data').each((i, el) => {
                const cellText = $(el).text();
                const scoreText = $(el).find('b').text().trim();
                const match = scoreText.match(/(\d+)-(\d+)/);

                if (match) {
                    const score1 = parseInt(match[1]);
                    const score2 = parseInt(match[2]);
                    const parts = cellText.split('-');
                    
                    if (parts.length >= 2) {
                        const localText = parts[0];
                        if (localText.toLowerCase().includes(targetTeamName.toLowerCase())) {
                            gfAcc += score1;
                            gcAcc += score2;
                        } else {
                            gfAcc += score2;
                            gcAcc += score1;
                        }
                        pjCount++;
                    }
                }
            });

            return { gf: gfAcc, gc: gcAcc, pj: pjCount };
        }

        if (tables.eq(0).length) {
            const resHome = procesarTabla(tables.eq(0), homeTeam);
            homeGF = resHome.gf; homeGC = resHome.gc; homePJ = resHome.pj;
        }

        if (tables.eq(1).length) {
            const resAway = procesarTabla(tables.eq(1), awayTeam);
            awayGF = resAway.gf; awayGC = resAway.gc; awayPJ = resAway.pj;
        }

        // 2. Extraer Cuotas 1X2 (Local, Empate, Visitante)
        let oddsHome = null, oddsDraw = null, oddsAway = null;
        const oddsLinks = $('.odds-detail a');

        if (oddsLinks.length >= 3) {
            oddsHome = parseFloat(oddsLinks.eq(0).text().trim()) || null; // 1 (ej: 2.10)
            oddsDraw = parseFloat(oddsLinks.eq(1).text().trim()) || null; // X (ej: 3.34)
            oddsAway = parseFloat(oddsLinks.eq(2).text().trim()) || null; // 2 (ej: 3.76)
        }

        return {
            homeTeam,
            awayTeam,
            homePJ: homePJ || 5,
            homeGF,
            homeGC,
            awayPJ: awayPJ || 5,
            awayGF,
            awayGC,
            oddsHome,
            oddsDraw,
            oddsAway
        };

    } catch (error) {
        console.error('❌ Error en Scraper:', error.message);
        return null;
    }
}

module.exports = { parsearFlashscoreMobi };
