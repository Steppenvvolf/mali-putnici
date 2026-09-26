# Destination record schema (v1)

Each research batch writes ONE file: `data/raw/batch-<N>.json` containing a JSON **array** of destination objects.
UTF-8, valid JSON (no comments, no trailing commas). Every `{sr,en}` field needs BOTH languages.

**Serbian (`sr`)**: Latin script, ekavian, proper diacritics (č ć š ž đ). Natural and warm, written by a parent for parents, not machine-translated.
**English (`en`)**: natural British/neutral English. It is not a word-for-word copy of the Serbian.

```jsonc
{
  "id": "efteling",                       // unique slug, lowercase a-z0-9 and hyphens
  "name":  { "sr": "Efteling", "en": "Efteling" },
  "place": { "sr": "Kaatshojvel, kod Tilburga", "en": "Kaatsheuvel, near Tilburg" },
  "country": "NL",                         // ISO 3166-1 alpha-2
  "region": "western",                     // balkans | greece | romania | central | western | nordic | mediterranean | british
  "coords": [51.6497, 5.0437],             // [lat, lng] of the main attraction, 4 decimals
  "airport": {                             // nearest SENSIBLE airport with real low-cost/regular traffic
    "iata": "EIN", "km": 38, "minutes": 35,
    "mode": { "sr": "autom ili taksijem", "en": "car or taxi" }
  },
  "category": "theme",                     // PRIMARY: theme | animals | nature | beach | city | edutainment
  "tags": ["theme-park", "fairytale", "forest", "train"],   // 2-7 from the TAG LIST below
  "ages": { "baby": 2, "toddler": 3, "preschool": 3 },      // fit 0-3 for 0-1 y / 1-3 y / 3-6 y
  "stroller": 3,                           // 1 = hard (stairs, cobbles, sand)  2 = OK  3 = excellent
  "budget": 3,                             // 1 = €  2 = €€  3 = €€€  (overall trip cost level)
  "bestMonths": [4, 5, 6, 9],              // 1-12
  "season": { "sr": "...", "en": "..." },  // opening season / when it is closed. One sentence.
  "tagline": { "sr": "...", "en": "..." }, // <= 90 characters, evocative, no emoji
  "description": { "sr": "...", "en": "..." },  // 3-4 sentences: what it is + why it is good for SMALL kids
  "highlights": [ { "sr": "...", "en": "..." } ],   // 3-5 concrete things to do with toddlers
  "pros": [ { "sr": "...", "en": "..." } ],         // 3-5 honest advantages for families with 0-6 y kids
  "cons": [ { "sr": "...", "en": "..." } ],         // 2-4 honest drawbacks (crowds, heat, price, stairs, closures, height limits...)
  "tip": { "sr": "...", "en": "..." },              // one insider parent tip
  "costs": {
    "tickets": [                                     // 1-3 main paid attractions, EUR, on-gate/online standard price
      { "name": { "sr": "Efteling dnevna karta", "en": "Efteling day ticket" },
        "adult": 55, "child": 55, "freeUnder": 4, "url": "https://www.efteling.com/..." }
    ],                                               // child price applies from freeUnder up to 11. Use [] if everything is free.
    "hotelNight": { "budget": 90, "mid": 150, "comfort": 260 },  // EUR / night, ONE family room or apartment for 2 adults + 2 small kids, typical spring/early-summer
    "foodPerAdultDay": 45,                           // EUR, mid-range eating (breakfast + lunch + dinner + snacks). Kids are computed at 50%.
    "localPerDay": 12                                // EUR per day for the whole family: local transport / parking / small extras
  },
  "officialUrl": "https://...",           // official site of the main attraction or tourist board
  "sources": ["https://...", "https://..."],   // 2-5 URLs you actually used for prices / facts
  "priceConfidence": "verified",          // verified (read off an official page in 2025-2026) | estimated
  "images": [                             // 4-6 exact Wikimedia Commons file titles, landscape, >= 1600 px wide, free licence
    "File:Efteling Droomvlucht 2.jpg"
  ]
}
```

## TAG LIST (use only these)
theme-park, zoo, aquarium, safari, farm-animals, water-park, beach, shallow-sea, lake, mountain, cave, forest, waterfall,
castle, old-town, museum, science, fairytale, dinosaurs, train, boat, cable-car, indoor, rainy-day, winter, free, playground, spa

## Rules
- **Safety first**: only places that are safe, calm and realistic for families with 0-6 year olds. If a place has a real concern
  (e.g. animal shows criticised for welfare, steep cliffs, heavy summer crowds, strong currents), say it honestly in `cons`.
- **No invented facts.** Every price, age limit, opening season and "direct flight" claim must come from a source you read.
  If you can't verify a price, give your best estimate and set `priceConfidence: "estimated"`.
- Do NOT claim specific direct flight routes (they change every season). Talk about airports and transfer times instead.
- Images: find them ONLY with `python tools/commons_search.py`. Pick photos that SHOW the place attractively: the attraction itself,
  families, landscape, iconic views. Avoid construction, blurry night shots, maps, logos, close-ups of signs and near-duplicates.
  Order them best-first; image #1 is the card cover, so make it the most beautiful and recognisable.
  Finish by running `python tools/commons_search.py --check "File:..." ...` on your final picks. Every one must print without a "NOT USABLE" flag.
