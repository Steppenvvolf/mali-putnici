/* Trip cost estimator. Pure functions, no DOM. Calibrated by data/raw/pricing.json (see tools/build.py). */
(function (root) {
  const DEFAULTS = {
    flight: {
      model: { baseEur: 30, perKmEur: 0.055 },
      spread: { low: 0.6, high: 1.6 },
      seasonFactor: { 1: 0.8, 2: 0.8, 3: 0.9, 4: 1.0, 5: 1.0, 6: 1.2, 7: 1.45, 8: 1.45, 9: 1.1, 10: 0.95, 11: 0.8, 12: 1.15 },
      infantUnder2PerLegEur: { lowcost: 35, legacy: 25 },
      childSeatFactor: 1.0,
      checkedBag20kgPerLegEur: { lowcost: 40, legacy: 0 },
      noDirectPenalty: 1.35,
    },
    car: { fuelEurPerKm: 0.12, tollEurPerKmAvg: 0.04 },
    hotelSeasonFactor: { 1: 0.7, 2: 0.7, 3: 0.8, 4: 0.9, 5: 1.0, 6: 1.25, 7: 1.5, 8: 1.55, 9: 1.1, 10: 0.85, 11: 0.7, 12: 0.85 },
    hotelSeasonFactorCity: { 1: 0.85, 2: 0.85, 3: 0.95, 4: 1.0, 5: 1.05, 6: 1.1, 7: 1.1, 8: 1.05, 9: 1.1, 10: 1.0, 11: 0.9, 12: 1.05 },
  };

  const NO_DRIVE = new Set(['crete-heraklion', 'rhodes', 'naxos', 'kos', 'mallorca-alcudia', 'tenerife-loro-parque']);
  // Return car + family ferry / tunnel costs (EUR) for places a car reaches only by sea.
  const FERRY = { corfu: 140, thassos: 70, brijuni: 0, 'paultons-peppa': 260, 'london-museums': 260 };

  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  /** Merge pricing.json over defaults, tolerating missing or oddly shaped fields. */
  function params(pricing) {
    const p = pricing || {};
    const f = p.flight || {}, c = p.car || {};
    const pick = (obj, dflt) => {
      const o = {};
      for (let m = 1; m <= 12; m++) o[m] = num(obj && obj[m], dflt[m]);
      return o;
    };
    // Tolls: pricing.json lists per-country numbers or "vignette". Average the numeric ones.
    const tolls = Object.values(c.tollEurPerKm || {}).filter(v => typeof v === 'number');
    return {
      base: num(f.model && f.model.baseEur, DEFAULTS.flight.model.baseEur),
      perKm: num(f.model && f.model.perKmEur, DEFAULTS.flight.model.perKmEur),
      low: num(f.spread && f.spread.low, DEFAULTS.flight.spread.low),
      high: num(f.spread && f.spread.high, DEFAULTS.flight.spread.high),
      season: pick(f.seasonFactor, DEFAULTS.flight.seasonFactor),
      infant: num(f.infantUnder2PerLegEur && f.infantUnder2PerLegEur.lowcost, DEFAULTS.flight.infantUnder2PerLegEur.lowcost),
      childSeat: num(f.childSeatFactor, DEFAULTS.flight.childSeatFactor),
      bag: num(f.checkedBag20kgPerLegEur && f.checkedBag20kgPerLegEur.lowcost, DEFAULTS.flight.checkedBag20kgPerLegEur.lowcost),
      noDirect: num(f.noDirectPenalty, DEFAULTS.flight.noDirectPenalty),
      fuel: num(c.fuelEurPerKm, DEFAULTS.car.fuelEurPerKm),
      toll: tolls.length ? tolls.reduce((a, b) => a + b, 0) / tolls.length : DEFAULTS.car.tollEurPerKmAvg,
      vignettes: c.vignettes || {},
      hotelSea: pick(p.hotelSeasonFactor, DEFAULTS.hotelSeasonFactor),
      hotelCity: pick(p.hotelSeasonFactorCity, DEFAULTS.hotelSeasonFactorCity),
    };
  }

  function haversineKm(a, b) {
    const R = 6371, rad = x => (x * Math.PI) / 180;
    const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  const round = (x, step = 10) => Math.round(x / step) * step;

  /** Great-circle flight km, flight minutes, and a road estimate from the origin airport to the destination. */
  function travelInfo(dest, originCode, airports) {
    const o = airports[originCode], a = airports[dest.airport.iata];
    if (!o || !a) return null;
    const flyKm = haversineKm([o.lat, o.lng], [a.lat, a.lng]);
    const directKm = haversineKm([o.lat, o.lng], dest.coords);
    // Islands without a practical car route are fly-only.
    const island = NO_DRIVE.has(dest.id) || ['CY', 'MT'].includes(dest.country);
    const roadKm = directKm * 1.28;
    return {
      flyKm,
      flyMin: Math.round((flyKm / 780) * 60 + 30),
      roadKm,
      driveMin: Math.round((roadKm / 78) * 60 + (roadKm > 350 ? 45 : 0) + Math.floor(roadKm / 250) * 20),
      canDrive: !island && roadKm <= 1600,
      preferDrive: !island && roadKm <= 520 && originCode !== dest.airport.iata,
      sameAirport: originCode === dest.airport.iata,
    };
  }

  /**
   * trip = { origin, adults, kids:[ages], nights, month (1-12), tier: budget|mid|comfort, mode: fly|drive }
   * returns { low, high, mid, parts: {travel,stay,tickets,food,local} each {low,high}, meta }
   */
  function estimate(dest, trip, data) {
    const P = params(data.pricing);
    const t = travelInfo(dest, trip.origin, data.airports);
    const adults = Math.max(1, trip.adults | 0);
    // Ages are not collected; assume each child is a preschooler (age 4) for pricing.
    const kidCount = Math.max(0, Number(trip.kids) || 0);
    const kids = Array(kidCount).fill(4);
    const infants = kids.filter(a => a < 2).length;
    const seatKids = kids.length - infants;
    const nights = Math.max(1, trip.nights | 0);
    const days = nights + 1;
    const m = trip.month || 5;
    const costs = dest.costs;
    let mode = trip.mode === 'drive' && t && t.canDrive ? 'drive' : 'fly';
    if (t && t.sameAirport) mode = 'drive';

    // Travel
    let travel = { low: 0, high: 0 }, travelMeta = {};
    if (!t) {
      travel = { low: 0, high: 0 };
    } else if (mode === 'fly') {
      const typical = (P.base + P.perKm * t.flyKm) * P.season[m];
      const seats = adults + seatKids * P.childSeat;
      const legs = 2;
      const bags = Math.ceil((adults + kids.length) / 2);
      const fixed = legs * (bags * P.bag + infants * P.infant);
      const bigPair = data.airports[trip.origin]?.big && data.airports[dest.airport.iata]?.big;
      const highFactor = P.high * (bigPair ? 1 : P.noDirect);
      // Airport transfer: taxi-ish up to ~60 km, otherwise a rental car for the stay.
      const tk = dest.airport.km || 0;
      const transfer = tk <= 60 ? 2 * (15 + tk * 1.3) : Math.min(2 * (15 + tk * 1.3), 40 * days + 30);
      travel.low = seats * typical * legs * P.low + fixed + transfer * 0.8;
      travel.high = seats * typical * legs * highFactor + fixed + transfer * 1.2;
      travelMeta = { flyMin: t.flyMin, transfer: tk > 5 };
    } else {
      const km = t.roadKm * 2;
      const base = km * (P.fuel + P.toll) + (FERRY[dest.id] || 0);
      travel.low = base * 0.85;
      travel.high = base * 1.2 + 30; // vignettes, ferries, parking at stops
      travelMeta = { roadKm: t.roadKm, driveMin: t.driveMin };
    }

    // Stay: hotelNight is spring/early-summer for 2+2. Bigger families need more space.
    const seaLike = ['beach'].includes(dest.category) || (dest.tags || []).includes('beach');
    const sf = (seaLike ? P.hotelSea : P.hotelCity)[m];
    const sizeF = 1 + Math.max(0, adults + kids.length - 4) * 0.18 - (adults + kids.length <= 2 ? 0.15 : 0);
    const night = (costs.hotelNight[trip.tier] || costs.hotelNight.mid) * sf * sizeF;
    const stay = { low: night * nights * 0.88, high: night * nights * 1.15 };

    // Tickets: each main attraction once.
    let tk = 0;
    for (const x of costs.tickets || []) {
      tk += adults * x.adult;
      for (const a of kids) if (a >= (x.freeUnder || 0)) tk += x.child;
    }
    const tickets = { low: tk, high: tk * 1.1 };

    // Food: kids 2+ count as half an adult, babies as a fifth.
    const eaters = adults + kids.filter(a => a >= 2).length * 0.5 + infants * 0.2;
    const food = { low: costs.foodPerAdultDay * eaters * days * 0.8, high: costs.foodPerAdultDay * eaters * days * 1.2 };
    const lp = mode === 'drive' ? costs.localPerDay * 0.7 : costs.localPerDay;
    const local = { low: lp * days * 0.8, high: lp * days * 1.3 };

    const parts = { travel, stay, tickets, food, local };
    for (const k in parts) parts[k] = { low: round(parts[k].low), high: round(parts[k].high) };
    const low = Object.values(parts).reduce((s, p) => s + p.low, 0);
    const high = Object.values(parts).reduce((s, p) => s + p.high, 0);
    const mid = round((low + high) / 2, 50);
    return {
      low: round(low, 50), high: round(high, 50), mid, parts, mode, days, nights,
      perDay: round(mid / days, 5), travel: t, travelMeta, infants,
    };
  }

  root.PPCalc = { estimate, travelInfo, haversineKm, params };
  if (typeof module !== 'undefined') module.exports = root.PPCalc;
})(typeof window !== 'undefined' ? window : globalThis);
