/* Unit tests for the cost estimator (calc.js). Run: node tools/test-calc.js */
const CALC = require('../assets/calc.js');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pricing = JSON.parse(fs.readFileSync(path.join(root, 'data/raw/pricing.json'), 'utf-8'));
const airportsAll = JSON.parse(fs.readFileSync(path.join(root, 'data/raw/airports-all.json'), 'utf-8'));

function airportsFor(codes) {
  const out = {};
  for (const c of codes) {
    const a = airportsAll[c];
    out[c] = { n: a.city, c: a.country, lat: a.lat, lng: a.lng, big: a.type === 'large_airport' };
  }
  return out;
}
const airports = airportsFor(['BEG', 'EIN', 'LJU', 'HER', 'SPU']);

const base = {
  adults: 2, kids: [1, 4], nights: 5, month: 5, tier: 'mid',
};
const efteling = {
  id: 'efteling', name: 'Efteling', country: 'NL', category: 'theme', tags: [],
  coords: [51.6497, 5.0437], airport: { iata: 'EIN', km: 38 },
  costs: { hotelNight: { budget: 90, mid: 150, comfort: 260 }, foodPerAdultDay: 45, localPerDay: 12,
    tickets: [{ adult: 55, child: 55, freeUnder: 4 }] },
};
const bled = {
  id: 'bled', country: 'SI', category: 'nature', tags: [],
  coords: [46.365, 14.095], airport: { iata: 'LJU', km: 35 },
  costs: { hotelNight: { budget: 90, mid: 150, comfort: 250 }, foodPerAdultDay: 40, localPerDay: 10,
    tickets: [{ adult: 18, child: 9, freeUnder: 4 }] },
};
const crete = {
  id: 'crete-heraklion', country: 'GR', category: 'beach', tags: ['beach'],
  coords: [35.34, 25.14], airport: { iata: 'HER', km: 4 },
  costs: { hotelNight: { budget: 70, mid: 130, comfort: 230 }, foodPerAdultDay: 40, localPerDay: 12, tickets: [] },
};

const data = { pricing, airports };
let fails = 0;
function check(name, cond, extra) {
  const ok = !!cond;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  → ' + extra : ''));
  if (!ok) fails++;
}

// 1. Efteling, fly, May — expect a sane €1.5–3.5k band
const e1 = CALC.estimate(efteling, { ...base, origin: 'BEG', mode: 'fly' }, data);
console.log('Efteling fly:', e1.low, '–', e1.high, 'mid', e1.mid, 'mode', e1.mode);
check('Efteling fly mid in €1.5–3.5k', e1.mid >= 1500 && e1.mid <= 3500, 'mid=' + e1.mid);
check('Efteling fly mode is fly', e1.mode === 'fly');

// 2. Efteling, drive — must not be allowed (too far: road > 1600? no; BEG→EIN ~1370km straight → road 1750km > 1600 → canDrive false)
const e2 = CALC.estimate(efteling, { ...base, origin: 'BEG', mode: 'drive' }, data);
console.log('Efteling drive:', e2.low, '–', e2.high, 'mode', e2.mode);
check('Efteling drive falls back to fly (too far)', e2.mode === 'fly');

// 3. Bled, drive — close enough, should drive
const b1 = CALC.estimate(bled, { ...base, origin: 'BEG', mode: 'drive' }, data);
console.log('Bled drive:', b1.low, '–', b1.high, 'mode', b1.mode, 'roadKm', b1.travel && b1.travel.roadKm);
check('Bled drive mode is drive', b1.mode === 'drive');
check('Bled drive roadKm > 0', b1.travel && b1.travel.roadKm > 0);

// 4. Crete fly-only (NO_DRIVE) — drive must fall back to fly
const c1 = CALC.estimate(crete, { ...base, origin: 'BEG', mode: 'drive' }, data);
console.log('Crete (drive requested):', c1.low, '–', c1.high, 'mode', c1.mode);
check('Crete is fly-only (mode fly)', c1.mode === 'fly');

// 5. Infant handling: 2 adults + kids [0, 4] — infant <2 flies lap
const e3 = CALC.estimate(efteling, { ...base, kids: [0, 4], origin: 'BEG', mode: 'fly' }, data);
check('Infant detected', e3.infants === 1, 'infants=' + e3.infants);

// 6. Same-airport origin (Belgrade → Belgrade) → drive (local)
const bel = { ...bled, id: 'belgrade-kids', country: 'RS', coords: [44.81, 20.46], airport: { iata: 'BEG', km: 12 } };
const e4 = CALC.estimate(bel, { ...base, origin: 'BEG', mode: 'fly' }, data);
check('Same-origin → drive', e4.mode === 'drive', 'mode=' + e4.mode);

// 7. Month seasonality: July hotel should cost more than January for a beach dest
const jul = CALC.estimate(crete, { ...base, origin: 'BEG', mode: 'fly', month: 7 }, data);
const jan = CALC.estimate(crete, { ...base, origin: 'BEG', mode: 'fly', month: 1 }, data);
check('Beach July stay > January stay', jul.parts.stay.high > jan.parts.stay.high, jan.parts.stay.high + ' → ' + jul.parts.stay.high);

console.log('\n' + (fails ? fails + ' FAILURES' : 'ALL PASS'));
process.exit(fails ? 1 : 0);
