function factorial(n) {
    if (n === 0 || n === 1) return 1;
    let res = 1;
    for (let i = 2; i <= n; i++) res *= i;
    return res;
}

function poisson(k, lambda) {
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function dixonColesTau(h, a, lambdaH, lambdaA, rho = -0.13) {
    if (h === 0 && a === 0) return 1 - (lambdaH * lambdaA * rho);
    if (h === 1 && a === 0) return 1 + (lambdaA * rho);
    if (h === 0 && a === 1) return 1 + (lambdaH * rho);
    if (h === 1 && a === 1) return 1 - rho;
    return 1.0;
}

function dampeningXG(rawXG) {
    const cap = 2.50;
    if (rawXG <= cap) return rawXG;
    return cap + Math.log(1 + (rawXG - cap));
}

function calcularProbabilidades(stats) {
    const { 
        homePJ, homeGF, homeGC, 
        awayPJ, awayGF, awayGC, 
        leagueAvg = 1.10, 
        oddsHome, oddsDraw, oddsAway, 
        oddsOver, oddsBtts 
    } = stats;

    const avgLiga = Math.max(parseFloat(leagueAvg) || 1.10, 1.00);
    const hPJ = parseFloat(homePJ) || 5, hGF = parseFloat(homeGF) || 0, hGC = parseFloat(homeGC) || 0;
    const aPJ = parseFloat(awayPJ) || 5, aGF = parseFloat(awayGF) || 0, aGC = parseFloat(awayGC) || 0;

    let rawLambdaHome = (hGF / hPJ * aGC / aPJ) / avgLiga;
    let rawLambdaAway = (awayGF / aPJ * hGC / hPJ) / avgLiga;

    const lambdaHome = dampeningXG(rawLambdaHome);
    const lambdaAway = dampeningXG(rawLambdaAway);

    let p1 = 0, pX = 0, p2 = 0;
    let over25 = 0, under25 = 0;
    let bttsYes = 0, bttsNo = 0;
    let scoreMatrix = [];

    for (let h = 0; h <= 7; h++) {
        let rawH = poisson(h, lambdaHome);
        for (let a = 0; a <= 7; a++) {
            let rawA = poisson(a, lambdaAway);
            let tau = dixonColesTau(h, a, lambdaHome, lambdaAway);
            let prob = rawH * rawA * tau;

            scoreMatrix.push({ score: `${h}-${a}`, prob });

            if (h > a) p1 += prob;
            else if (h === a) pX += prob;
            else p2 += prob;

            if (h + a > 2.5) over25 += prob;
            else under25 += prob;

            if (h > 0 && a > 0) bttsYes += prob;
            else bttsNo += prob;
        }
    }

    const totalP = p1 + pX + p2;
    p1 /= totalP; pX /= totalP; p2 /= totalP;
    scoreMatrix.sort((a, b) => b.prob - a.prob);

    function getEV(prob, odds) {
        if (!odds || odds <= 1) return null;
        const ev = ((prob * odds) - 1) * 100;
        return ev.toFixed(1);
    }

    const mercados = [
        { label: 'Victoria Local (1)', prob: (p1 * 100).toFixed(1), odds: oddsHome, ev: getEV(p1, oddsHome) },
        { label: 'Empate (X)', prob: (pX * 100).toFixed(1), odds: oddsDraw, ev: getEV(pX, oddsDraw) },
        { label: 'Victoria Visitante (2)', prob: (p2 * 100).toFixed(1), odds: oddsAway, ev: getEV(p2, oddsAway) },
        { label: 'Over 2.5 Goles', prob: (over25 * 100).toFixed(1), odds: oddsOver, ev: getEV(over25, oddsOver) },
        { label: 'Under 2.5 Goles', prob: (under25 * 100).toFixed(1), odds: null, ev: null },
        { label: 'Ambos Anotan (SI)', prob: (bttsYes * 100).toFixed(1), odds: oddsBtts, ev: getEV(bttsYes, oddsBtts) },
        { label: 'Ambos Anotan (NO)', prob: (bttsNo * 100).toFixed(1), odds: null, ev: null },
        { label: 'Doble Op. Local (1X)', prob: ((p1 + pX) * 100).toFixed(1), odds: null, ev: null },
        { label: 'Doble Op. Visitante (X2)', prob: ((p2 + pX) * 100).toFixed(1), odds: null, ev: null },
        { label: 'Local AH 0.0 (DNB)', prob: ((p1 / (p1 + p2)) * 100).toFixed(1), odds: null, ev: null }
    ];

    return {
        xgHome: lambdaHome.toFixed(2),
        xgAway: lambdaAway.toFixed(2),
        xgTotal: (lambdaHome + lambdaAway).toFixed(2),
        topScores: scoreMatrix.slice(0, 5).map(s => ({
            score: s.score,
            prob: ((s.prob / totalP) * 100).toFixed(1) + "%"
        })),
        mercados
    };
}

module.exports = { calcularProbabilidades };
