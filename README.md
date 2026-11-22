# 🎄 Kerstlijst 2026

Een verlanglijst-app met een **agent die elke ochtend om 07:00** (Brusselse tijd) de Benelux afzoekt en per item de **goedkoopste betrouwbare deal inclusief verzendkosten** toont, met de andere aanbiedingen eronder.

| Item | Soort | Waar de agent zoekt |
|---|---|---|
| WD_BLACK C50 512 GB (Xbox) | nieuw | Tweakers Pricewatch + webshops in BE/NL (bol, Coolblue, MediaMarkt, Amazon.com.be, …) |
| GameSir G7 HE (zwart) | nieuw | idem |
| Amazon-artikel (amzn.eu-link) | nieuw | link wordt bij de eerste run herkend, daarna idem |
| Ami Paris "Ami de Cœur" sweater, zwart | tweedehands, ≤ €23 | 2dehands.be, Marktplaats.nl, Vinted BE/NL |
| Stone Island crewneck, grijs met badge | tweedehands, ≤ €23 | idem |
| Fear of God Essentials hoodie, light heather grey | tweedehands, ≤ €23 | idem |

## Gratis modus (standaard)

Zonder API-sleutels werkt alles gratis:
- **Nieuw**: laagste prijs van Tweakers + de vaste shoppagina's uit `config/wishlist.json` (`shopUrls`), rechtstreeks uitgelezen.
- **Tweedehands**: 2dehands, Marktplaats en Vinted via hun eigen zoekfunctie; filter op merk, staat (zeer goed+), kindermaat en gebreken in de beschrijving.
- Geen automatische fotocontrole: kijk zelf de foto's na (ze staan in de app).
- Opslag in Supabase (gratis), ochtendronde gestart door Supabase pg_cron.

**Vinted** blokkeert servers rechtstreeks. Met een gratis `FIRECRAWL_API_KEY` (gratis plan, 1.000 credits/maand) leest de agent de Vinted-zoekpagina's (± 12 credits per dag). Andere zaken gebruiken Firecrawl alleen met `FIRECRAWL_FULL=true`.

Met `ANTHROPIC_API_KEY` en `FIRECRAWL_FULL=true` (optioneel, betaald) zoekt de agent breder en controleert Claude ook de foto's.

## Wat de agent per item doet (met sleutels)

**Nieuwe producten**
1. Leest de Tweakers-prijsvergelijking (prijs, verzendkosten, shopreviews) en zoekt daarnaast breed naar Benelux-webshops.
2. Leest elke productpagina: exact hetzelfde model? Op voorraad? Verzendkosten naar België? Verkoper of marketplace-partner?
3. Geeft elke shop een **betrouwbaarheidsscore (0-100)**: een lijst van bekende shops (`config/shops.json`), live shopreviews, en voor onbekende shops een zoektocht naar reviews en keurmerken die Claude beoordeelt. Marketplace-verkopers worden begrensd op 60.
4. **Beste deal** = laagste totaalprijs (prijs + verzending) bij een shop met voorraad en een score ≥ `MIN_TRUST_SCORE` (standaard 65).

**Tweedehands truien**
1. Haalt alle advertenties onder het budget op (2dehands/Marktplaats via hun zoek-API, Vinted via Firecrawl).
2. **Tekstfilter**: alleen merk-matches, staat "zo goed als nieuw"/"zeer goed" of beter, geen kindermaten, geen vermelding van vlekken/scheuren/gaatjes/pilling (NL/FR/EN/DE). "Geen vlekken" telt wel als positief.
3. **Fotocontrole met Claude**: de foto's van de advertentie worden naast jouw referentiefoto gelegd → zelfde model? Vlekken, scheuren, pilling, verkleuring? Namaakrisico? Kindermaat?
4. **Totaalprijs** = prijs + verzending (+ kopersbescherming bij Vinted). Geschatte bedragen krijgen ≈ in de app.

## Starten (lokaal)

```bash
npm install
cp .env.example .env        # vul FIRECRAWL_API_KEY, ANTHROPIC_API_KEY en ADMIN_TOKEN in
npm start                   # http://localhost:3000
npm run agent               # één ronde nu draaien (of: npm run agent -- stone-island)
npm test                    # tests (geen netwerk nodig)
```

In de app: **"Nu checken"** start meteen een ronde (vraagt om je `ADMIN_TOKEN`), en via **"Aanpassen"** wijzig je zoektermen, naam of budget.

## Hosting koppelen

De app is één Node-proces met een ingebouwde planning (`node-cron`). De resultaten staan in `data/db.json`, dus kies hosting met een **blijvende schijf**:

- **Render**: `render.yaml` staat klaar (Blueprint, met 1 GB schijf op `/var/data`).
- **Railway / Fly.io / VPS**: `Dockerfile` staat klaar; koppel een volume op `/data`.
- **Serverless / slapende gratis instanties**: zet `ENABLE_INTERNAL_CRON=false` en laat een externe cron dagelijks `npm run agent` draaien (of `POST /api/run` met header `x-admin-token`).

Wil je later een echte database (bv. Supabase)? Vervang dan alleen `load()` en `save()` in `src/db.js`.

## Kosten

- **Firecrawl**: ruwe schatting 300-500 credits per ochtendronde (zoekopdrachten + pagina's met data-extractie). Reken voor dagelijks gebruik op een betaald plan; check de actuele prijzen op firecrawl.dev.
- **Anthropic**: maximaal `MAX_VISION_CHECKS_PER_ITEM` (standaard 8) fotocontroles per trui per dag, ordegrootte enkele eurocent per controle.

## Goed om te weten

- **Echtheid onder €23**: echte Stone Island- en Essentials-stukken kosten tweedehands meestal meer. Verwacht vaak dagen zonder treffer, en veel namaak. De agent markeert het namaakrisico, maar een fotocheck vervangt geen echtheidscontrole: vraag de verkoper altijd om foto's van de labels (en bij Stone Island de knoopjes van de badge).
- **Verzendkosten van Tweakers** gelden voor Nederland; naar België kan het iets afwijken. Rechtstreeks gelezen shoppagina's krijgen voorrang.
- **Scraping**: 2dehands, Marktplaats en Vinted hebben geen officiële publieke API. De agent vraagt maar één keer per dag een handvol pagina's op, maar hun voorwaarden staan automatisch verzamelen niet expliciet toe. Gebruik het voor persoonlijk gebruik.
- Betaal tweedehands **altijd via het platform** (kopersbescherming), nooit via een link of een bankoverschrijving buiten het platform.

## Structuur

```
config/wishlist.json      ← items, referentiefoto's, budgetten, modelbeschrijvingen
config/shops.json         ← bekende shops + basisscores
src/agent/index.js        ← de dagelijkse ronde (orchestratie + keuze beste deal)
src/agent/sources/        ← tweakers, webshops, marketplace (2dehands/Marktplaats), vinted
src/agent/trust.js        ← betrouwbaarheidsscore
src/agent/condition.js    ← staat-, gebreken- en namaakcontrole (tekst + foto's)
src/agent/costs.js        ← verzending/kopersbescherming tweedehands
src/server.js             ← API + planning + beeldproxy
public/                   ← de app (HTML/CSS/JS, geen build nodig)
data/db.json              ← resultaten (startcheck van 22 nov 2026 meegeleverd)
```
