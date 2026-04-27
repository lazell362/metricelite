/**
 * matches.js
 * Haalt aankomende Eredivisie wedstrijden op via football-data.org
 * Endpoint: /.netlify/functions/matches
 */

const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY;
const EREDIVISIE_ID = "DED"; // football-data.org code voor Eredivisie

exports.handler = async function (event, context) {
  // CORS headers zodat de frontend de function mag aanroepen
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  // Preflight request afhandelen
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (!FOOTBALL_API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "FOOTBALL_API_KEY is niet ingesteld in Netlify environment variables." }),
    };
  }

  try {
    // Aankomende wedstrijden ophalen (status=SCHEDULED)
    const response = await fetch(
      `https://api.football-data.org/v4/competitions/${EREDIVISIE_ID}/matches?status=SCHEDULED`,
      {
        headers: {
          "X-Auth-Token": FOOTBALL_API_KEY,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({
          error: `football-data.org API fout: ${response.status}`,
          details: errorText,
        }),
      };
    }

    const data = await response.json();

    // Alleen de relevante velden teruggeven (minder data = sneller)
    const matches = data.matches.slice(0, 10).map((match) => ({
      id: match.id,
      date: match.utcDate,
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
      matchday: match.matchday,
      status: match.status,
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        competition: "Eredivisie",
        season: data.filters?.season,
        totalMatches: matches.length,
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
