/**
 * combined.js
 * Haalt Eredivisie wedstrijden én odds op in één aanroep en combineert ze
 * Endpoint: /.netlify/functions/combined
 */

const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY;
const ODDS_API_KEY = process.env.ODDS_API_KEY;

const EREDIVISIE_ID = "DED";
const SPORT_KEY = "soccer_netherlands_eredivisie";
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

  if (!FOOTBALL_API_KEY || !ODDS_API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Een of meerdere API keys ontbreken in de Netlify environment variables.",
      }),
    };
  }

  try {
    // Beide API calls tegelijk uitvoeren voor snelheid
    const [matchesResponse, oddsResponse] = await Promise.all([
      fetch(
        `https://api.football-data.org/v4/competitions/${EREDIVISIE_ID}/matches?status=SCHEDULED`,
        {
          headers: { "X-Auth-Token": FOOTBALL_API_KEY },
        }
      ),
      fetch(
        buildOddsUrl(ODDS_API_KEY, SPORT_KEY, BOOKMAKERS),
      ),
    ]);

    // Foutafhandeling voor matches
    if (!matchesResponse.ok) {
      const errorText = await matchesResponse.text();
      return {
        statusCode: matchesResponse.status,
        headers,
        body: JSON.stringify({
          error: `football-data.org fout: ${matchesResponse.status}`,
          details: errorText,
        }),
      };
    }

    // Foutafhandeling voor odds
    if (!oddsResponse.ok) {
      const errorText = await oddsResponse.text();
      return {
        statusCode: oddsResponse.status,
        headers,
        body: JSON.stringify({
          error: `The Odds API fout: ${oddsResponse.status}`,
          details: errorText,
        }),
      };
    }

    const matchesData = await matchesResponse.json();
    const oddsData = await oddsResponse.json();

    // Resterende Odds API calls bijhouden
    const oddsRemaining = oddsResponse.headers.get("x-requests-remaining");

    // Wedstrijden samenvoegen met odds
    const combined = mergeMatchesWithOdds(matchesData.matches, oddsData);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        competition: "Eredivisie",
        season: matchesData.filters?.season,
        totalMatches: combined.length,
        oddsApiRemaining: oddsRemaining,
        lastUpdated: new Date().toISOString(),
        matches: combined,
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
 * Bouwt de Odds API URL
 */
function buildOddsUrl(apiKey, sportKey, bookmakers) {
  const url = new URL(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds/`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("regions", "eu");
  url.searchParams.set("markets", "h2h");
  url.searchParams.set("oddsFormat", "decimal");
  url.searchParams.set("bookmakers", bookmakers.join(","));
  return url.toString();
}

/**
 * Koppelt wedstrijden van football-data.org aan odds van The Odds API
 * Matching gebeurt op teamnaam via fuzzy vergelijking
 */
function mergeMatchesWithOdds(matches, oddsData) {
  return matches.slice(0, 10).map((match) => {
    const homeTeamName = match.homeTeam.shortName || match.homeTeam.name;
    const awayTeamName = match.awayTeam.shortName || match.awayTeam.name;

    // Zoek de bijpassende odds op basis van teamnaam
    const oddsMatch = findOddsMatch(oddsData, homeTeamName, awayTeamName);

    return {
      // Basisinfo van football-data.org
      id: match.id,
      date: match.utcDate,
      matchday: match.matchday,
      status: match.status,
      homeTeam: {
        id: match.homeTeam.id,
        name: match.homeTeam.name,
        shortName: match.homeTeam.shortName,
        crest: match.homeTeam.crest,
      },
      awayTeam: {
        id: match.awayTeam.id,
        name: match.awayTeam.name,
        shortName: match.awayTeam.shortName,
        crest: match.awayTeam.crest,
      },
      // Odds van The Odds API (null als niet gevonden)
      odds: oddsMatch
        ? {
            oddsMatchId: oddsMatch.id,
            bestOdds: calculateBestOdds(oddsMatch),
            bookmakers: oddsMatch.bookmakers.map((bm) => ({
              name: bm.title,
              key: bm.key,
              lastUpdate: bm.last_update,
              odds: extractH2HOdds(bm, oddsMatch.home_team, oddsMatch.away_team),
            })),
          }
        : null,
    };
  });
}

/**
 * Zoekt de bijpassende odds voor een wedstrijd
 * Gebruikt gedeeltelijke naam matching omdat de teamnamen
 * tussen football-data.org en The Odds API soms verschillen
 * (bijv. "AFC Ajax" vs "Ajax", "PSV" vs "PSV Eindhoven")
 */
function findOddsMatch(oddsData, homeShortName, awayShortName) {
  return oddsData.find((oddsMatch) => {
    const oddsHome = oddsMatch.home_team.toLowerCase();
    const oddsAway = oddsMatch.away_team.toLowerCase();
    const home = homeShortName.toLowerCase();
    const away = awayShortName.toLowerCase();

    const homeMatch =
      oddsHome.includes(home) ||
      home.includes(oddsHome) ||
      fuzzyMatch(oddsHome, home);

    const awayMatch =
      oddsAway.includes(away) ||
      away.includes(oddsAway) ||
      fuzzyMatch(oddsAway, away);

    return homeMatch && awayMatch;
  });
}

/**
 * Simpele fuzzy match: controleert of de eerste 4 tekens overeenkomen
 * Vangt gevallen op zoals "Groningen" vs "FC Groningen"
 */
function fuzzyMatch(a, b) {
  const minLength = Math.min(a.length, b.length, 4);
  return a.substring(0, minLength) === b.substring(0, minLength);
}

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
    else outcomes.draw = outcome.price;
  });

  return outcomes;
}

/**
 * Berekent de beste beschikbare odds over alle bookmakers
 */
function calculateBestOdds(oddsMatch) {
  let bestHome = 0, bestDraw = 0, bestAway = 0;
  let bestHomeBook = "", bestDrawBook = "", bestAwayBook = "";

  oddsMatch.bookmakers.forEach((bm) => {
    const odds = extractH2HOdds(bm, oddsMatch.home_team, oddsMatch.away_team);
    if (!odds) return;

    if (odds.home > bestHome) { bestHome = odds.home; bestHomeBook = bm.title; }
    if (odds.draw > bestDraw) { bestDraw = odds.draw; bestDrawBook = bm.title; }
    if (odds.away > bestAway) { bestAway = odds.away; bestAwayBook = bm.title; }
  });

  return {
    home: { odds: bestHome, bookmaker: bestHomeBook },
    draw: { odds: bestDraw, bookmaker: bestDrawBook },
    away: { odds: bestAway, bookmaker: bestAwayBook },
  };
}
