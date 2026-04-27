/**
 * analyze.js
 * Combineert wedstrijd- en oddsdata en stuurt dit naar Groq voor een AI-analyse
 * Endpoint: /.netlify/functions/analyze
 *
 * Verwacht een POST request met JSON body:
 * {
 *   "homeTeam": "Ajax",
 *   "awayTeam": "PSV",
 *   "date": "2025-03-15T18:00:00Z",
 *   "odds": {
 *     "bestOdds": { "home": {...}, "draw": {...}, "away": {...} },
 *     "bookmakers": [...]
 *   }
 * }
 */

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile"; // Snel en gratis op Groq

exports.handler = async function (event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Alleen POST requests zijn toegestaan." }),
    };
  }

  if (!GROQ_API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "GROQ_API_KEY is niet ingesteld in Netlify environment variables." }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Ongeldige JSON in request body." }),
    };
  }

  const { homeTeam, awayTeam, date, odds, matchStats } = body;

  if (!homeTeam || !awayTeam) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "homeTeam en awayTeam zijn verplicht." }),
    };
  }

  // Bouw de prompt op die naar Grok gestuurd wordt
  const prompt = buildAnalysisPrompt({ homeTeam, awayTeam, date, odds, matchStats });

  try {
    const groqResponse = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: "system",
            content: `Je bent een professionele voetbalanalist gespecialiseerd in de Eredivisie. 
Je analyseert wedstrijden op basis van data en geeft gestructureerd advies aan mensen die willen gokken.
Je bent eerlijk, datagedreven en geeft altijd aan dat gokken risico's met zich meebrengt.
Antwoord altijd in het Nederlands. Wees bondig maar volledig.`,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3, // Laag voor consistente, feitelijke analyses
        max_tokens: 800,
      }),
    });

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      return {
        statusCode: groqResponse.status,
        headers,
        body: JSON.stringify({
          error: `Groq API fout: ${groqResponse.status}`,
          details: errorText,
        }),
      };
    }

    const groqData = await groqResponse.json();
    const analysis = groqData.choices?.[0]?.message?.content;

    if (!analysis) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Geen analyse ontvangen van Groq." }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        match: `${homeTeam} vs ${awayTeam}`,
        date,
        analysis,
        model: GROQ_MODEL,
        tokensUsed: groqData.usage?.total_tokens,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Onverwachte fout bij Grok aanroep", details: err.message }),
    };
  }
};

/**
 * Bouwt een gedetailleerde prompt op basis van beschikbare data
 */
function buildAnalysisPrompt({ homeTeam, awayTeam, date, odds, matchStats }) {
  const dateStr = date
    ? new Date(date).toLocaleDateString("nl-NL", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "onbekende datum";

  let prompt = `Analyseer de volgende Eredivisie wedstrijd:\n\n`;
  prompt += `**Wedstrijd:** ${homeTeam} vs ${awayTeam}\n`;
  prompt += `**Datum:** ${dateStr}\n\n`;

  // Odds toevoegen als beschikbaar
  if (odds?.bestOdds) {
    const { home, draw, away } = odds.bestOdds;
    prompt += `**Beste beschikbare odds:**\n`;
    prompt += `- ${homeTeam} wint: ${home.odds} (${home.bookmaker})\n`;
    prompt += `- Gelijkspel: ${draw.odds} (${draw.bookmaker})\n`;
    prompt += `- ${awayTeam} wint: ${away.odds} (${away.bookmaker})\n\n`;

    // Impliciete kansen berekenen vanuit odds
    if (home.odds > 0 && draw.odds > 0 && away.odds > 0) {
      const impliedHome = ((1 / home.odds) * 100).toFixed(1);
      const impliedDraw = ((1 / draw.odds) * 100).toFixed(1);
      const impliedAway = ((1 / away.odds) * 100).toFixed(1);
      prompt += `**Impliciete kansen (o.b.v. odds):**\n`;
      prompt += `- ${homeTeam} wint: ${impliedHome}%\n`;
      prompt += `- Gelijkspel: ${impliedDraw}%\n`;
      prompt += `- ${awayTeam} wint: ${impliedAway}%\n\n`;
    }
  }

  // Extra statistieken toevoegen als beschikbaar
  if (matchStats) {
    prompt += `**Aanvullende statistieken:**\n${JSON.stringify(matchStats, null, 2)}\n\n`;
  }

  prompt += `Geef een analyse met de volgende onderdelen:
1. **Korte wedstrijdanalyse** (sterktes/zwaktes beide teams, recente vorm)
2. **Odds beoordeling** (zijn de odds fair? Zit er waarde in?)
3. **Aanbeveling** (welke inzet heeft de beste risk/reward verhouding?)
4. **Risicowaarschuwing** (kort maar eerlijk)

Wees concreet en gebruik de oddsdata in je redenering.`;

  return prompt;
}
