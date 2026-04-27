/**
 * odds.js
 * Haalt odds op voor Eredivisie wedstrijden via The Odds API
 * Endpoint: /.netlify/functions/odds
 *
 * Query parameters:
 *   - matchId (optioneel): filter op een specifieke wedstrijd naam, bv. "Ajax vs PSV"
 */

const ODDS_API_KEY = process.env.ODDS_API_KEY;

// The Odds API sport-sleutel voor de Eredivisie
const SPORT_KEY = "soccer_netherlands_eredivisie";

// Goksites die we willen tonen (bookmakers)
// Voeg toe of verwijder naar wens
const BOOKMAKERS = ["unibet", "bet365", "betway", "pinnacle", "williamhill"];

exports.handler = async function (event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (!ODDS_API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "ODDS_API_KEY is niet ingesteld in Netlify environment variables.",
        hint: "Maak een gratis account aan op the-odds-api.com",
      }),
    };
  }

  try {
    // Odds ophalen voor alle aankomende Eredivisie wedstrijden
    // markets=h2h = 1X2 (thuiswinst, gelijkspel, uitwinst)
    const url = new URL(`https://api.the-odds-api.com/v4/sports/${SPORT_KEY}/odds/`);
    url.searchParams.set("apiKey", ODDS_API_KEY);
    url.searchParams.set("regions", "eu"); // Europese bookmakers
    url.searchParams.set("markets", "h2h"); // 1X2 market
    url.searchParams.set("oddsFormat", "decimal"); // Decimale odds (Europees formaat)
    url.searchParams.set("bookmakers", BOOKMAKERS.join(","));

    const response = await fetch(url.toString());

    if (!response.ok) {
      const errorText = await response.text();
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({
          error: `The Odds API fout: ${response.status}`,
          details: errorText,
        }),
      };
    }

    const data = await response.json();

    // Resterende API calls loggen (gratis tier = 500/maand)
    const remainingRequests = response.headers.get("x-requests-remaining");
    const usedRequests = response.headers.get("x-requests-used");

    // Data omzetten naar een overzichtelijk formaat
    const matches = data.map((match) => {
      // Beste odds per uitkomst berekenen over alle bookmakers
      const bestOdds = calculateBestOdds(match);

      return {
        id: match.id,
        homeTeam: match.home_team,
        awayTeam: match.away_team,
        commenceTime: match.commence_time,
        bestOdds, // Beste odds over alle bookmakers
        bookmakers: match.bookmakers.map((bm) => ({
          name: bm.title,
          key: bm.key,
          lastUpdate: bm.last_update,
          odds: extractH2HOdds(bm, match.home_team, match.away_team),
        })),
      };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        sport: "Eredivisie",
        totalMatches: matches.length,
        apiUsage: {
          remaining: remainingRequests,
          used: usedRequests,
        },
        matches,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Onverwachte fout", details: err.message }),
    };
  }
};

/**
 * Haalt 1X2 odds op uit een bookmaker object
 */
function extractH2HOdds(bookmaker, homeTeam, awayTeam) {
  const h2hMarket = bookmaker.markets.find((m) => m.key === "h2h");
  if (!h2hMarket) return null;

  const outcomes = {};
  h2hMarket.outcomes.forEach((outcome) => {
    if (outcome.name === homeTeam) outcomes.home = outcome.price;
    else if (outcome.name === awayTeam) outcomes.away = outcome.price;
    else outcomes.draw = outcome.price; // "Draw"
  });

  return outcomes;
}

/**
 * Berekent de beste beschikbare odds over alle bookmakers
 * Handig om te zien waar de beste waarde zit
 */
function calculateBestOdds(match) {
  let bestHome = 0;
  let bestDraw = 0;
  let bestAway = 0;
  let bestHomeBook = "";
  let bestDrawBook = "";
  let bestAwayBook = "";

  match.bookmakers.forEach((bm) => {
    const odds = extractH2HOdds(bm, match.home_team, match.away_team);
    if (!odds) return;

    if (odds.home > bestHome) {
      bestHome = odds.home;
      bestHomeBook = bm.title;
    }
    if (odds.draw > bestDraw) {
      bestDraw = odds.draw;
      bestDrawBook = bm.title;
    }
    if (odds.away > bestAway) {
      bestAway = odds.away;
      bestAwayBook = bm.title;
    }
  });

  return {
    home: { odds: bestHome, bookmaker: bestHomeBook },
    draw: { odds: bestDraw, bookmaker: bestDrawBook },
    away: { odds: bestAway, bookmaker: bestAwayBook },
  };
}
