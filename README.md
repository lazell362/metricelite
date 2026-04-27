# MetricElite – Backend Setup

## Projectstructuur

```
metricelite/
├── netlify.toml                    ← Netlify configuratie
├── public/
│   └── index.html                  ← Tijdelijke placeholder
└── netlify/
    └── functions/
        ├── matches.js              ← Eredivisie wedstrijden ophalen
        ├── odds.js                 ← Odds per wedstrijd ophalen
        └── analyze.js             ← AI-analyse via Grok
```

## Stap 1: The Odds API key aanmaken

1. Ga naar https://the-odds-api.com
2. Maak een gratis account aan
3. Kopieer je API key

Gratis tier: 500 requests/maand. Genoeg om te testen.

## Stap 2: Netlify Environment Variables instellen

Ga in het Netlify dashboard naar:
**Site configuration → Environment variables → Add variable**

Voeg deze drie variabelen toe:

| Naam | Waarde |
|------|--------|
| `FOOTBALL_API_KEY` | `8f134f4befd04ec68cd9a5dbbd2f246a` |
| `ODDS_API_KEY` | [jouw The Odds API key] |
| `GROK_API_KEY` | `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` |

## Stap 3: Code op GitHub zetten

1. Maak een nieuw repository aan op github.com (naam: `metricelite`)
2. In deze map, voer uit:

```bash
git init
git add .
git commit -m "Initial backend setup"
git remote add origin https://github.com/JOUW_USERNAME/metricelite.git
git push -u origin main
```

## Stap 4: Netlify koppelen aan GitHub

1. Netlify dashboard → **Add new site → Import an existing project**
2. Kies GitHub → selecteer `metricelite`
3. Build settings worden automatisch gelezen via `netlify.toml`
4. Klik **Deploy site**

## Stap 5: Endpoints testen

Na deploy zijn je endpoints beschikbaar op:

```
GET  https://metricelite.com/.netlify/functions/matches
GET  https://metricelite.com/.netlify/functions/odds
POST https://metricelite.com/.netlify/functions/analyze
```

### matches testen (browser of curl):
```
https://metricelite.com/.netlify/functions/matches
```

### analyze testen (curl):
```bash
curl -X POST https://metricelite.com/.netlify/functions/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "homeTeam": "Ajax",
    "awayTeam": "PSV",
    "date": "2025-03-15T18:00:00Z",
    "odds": {
      "bestOdds": {
        "home": { "odds": 2.10, "bookmaker": "Unibet" },
        "draw": { "odds": 3.40, "bookmaker": "Bet365" },
        "away": { "odds": 3.20, "bookmaker": "Betway" }
      }
    }
  }'
```

## API Limieten

| API | Gratis tier |
|-----|------------|
| football-data.org | 10 requests/minuut |
| The Odds API | 500 requests/maand |
| Grok API | Betaald per token (goedkoop met grok-3-mini) |

## Volgende stap

Zodra de backend werkt, bouwen we de frontend:
- Wedstrijdoverzicht met odds per wedstrijd
- AI-analyse knop per wedstrijd
- Vergelijkingstabel beste odds per bookmaker
