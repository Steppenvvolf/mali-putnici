# Research brief — "Porodična putovanja" destination database

You are researching destinations for a public, bilingual (Serbian + English) website that helps families with
**small children (0-6 years: babies, toddlers, preschoolers)** pick safe, calm, genuinely kid-friendly trips in Europe,
with extra focus on the Balkans, Greece and Romania. Many readers fly from Belgrade or elsewhere in the Balkans.

Working directory: `C:\Users\stefa\OneDrive\Documents\Sajt za porodice\site`

1. Read `data/SCHEMA.md` completely. Your output must match it exactly.
2. For destinations marked (EXISTING), the owner's original draft is in
   `C:\Users\stefa\OneDrive\Documents\Sajt za porodice\Porodicna Putovanja Sajt.html` (the `locationsData` array).
   Reuse its good ideas but **verify everything**. The draft contains known mistakes. For example, it places Efteling in Utrecht
   (it's in Kaatsheuvel near Tilburg), it mixes Tampere with Naantali (about 200 km apart), and it makes unverified "direct flight from Belgrade" claims.
   Fix these; don't copy them.
3. Research each destination on the web (official sites first, then tourist boards, then recent reputable travel sources).
   Get CURRENT ticket prices (2025/2026 season), free-entry age limits, opening season, and what is truly good for 0-6 year olds.
4. Find 4-6 photos per destination ONLY via `python tools/commons_search.py "<query>"` (also try `--cat "Category:<name>"`,
   local-language names and specific attraction names). Verify final picks with `--check`.
5. Write your array to the output path given below using the Write tool. Then run
   `python -c "import json;d=json.load(open(r'<output path>',encoding='utf-8'));print(len(d),'records OK')"`
   to prove it parses.

Quality bar: this goes to real parents. Honest cons matter as much as pros. Keep Serbian natural and grammatical,
because native speakers will read it. Your final reply should be SHORT: record count, which prices are "estimated", and any
destination you think should be dropped or replaced (with the reason). Don't paste the JSON back.
