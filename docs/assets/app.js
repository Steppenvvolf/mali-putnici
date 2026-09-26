/* Mali putnici / Little Travellers — app.js
   State, rendering, routing, filters, map, sheet, calculator, compare, haptics.
   Data: window.PP_DATA · Strings: window.PP_I18N · Cost model: window.PPCalc. */
(function () {
  'use strict';

  const DATA = window.PP_DATA;
  const I18N = window.PP_I18N;
  const CALC = window.PPCalc;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  /* ---------- State ---------- */
  const state = {
    lang: LS.get('pp.lang', 'sr'),
    theme: LS.get('pp.theme', null), // null = follow system
    favs: new Set(LS.get('pp.favs', [])),
    cmp: LS.get('pp.cmp', []), // ids, max 3
    category: 'all',
    region: 'all',
    q: '',
    filters: { stroller: false, rain: false, short: false, month: false },
    sort: 'fit',
    view: LS.get('pp.view', 'grid'),
    showFavs: false,
    trip: LS.get('pp.trip', { origin: 'BEG', adults: 2, kids: 2, nights: 5, month: 5, tier: 'mid', mode: 'fly' }),
  };
  // Migrate old array-of-ages trips to a plain child count (ages are no longer collected).
  if (Array.isArray(state.trip.kids)) state.trip.kids = state.trip.kids.length || 2;
  if (typeof state.trip.kids !== 'number') state.trip.kids = 2;
  state.trip.kids = Math.min(4, Math.max(1, Math.round(state.trip.kids)));
  let map = null, mapReady = false, firstRender = true;

  const T = () => I18N[state.lang];
  const txt = (o) => (o ? (o[state.lang] || o.sr || o.en || '') : '');
  const pick = (arr) => (arr || []).map((o) => txt(o));

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmtMoney(n) {
    n = Math.round(n);
    const sep = state.lang === 'sr' ? '.' : ',';
    const s = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    return state.lang === 'sr' ? s + ' €' : '€' + s;
  }
  function fmtMin(min) {
    min = Math.max(0, Math.round(min));
    const h = Math.floor(min / 60), m = min % 60;
    if (h === 0) return m + ' min';
    return m ? h + ' h ' + m + ' min' : h + ' h';
  }
  function bandOf(age) { if (age < 1) return 'baby'; if (age < 3) return 'toddler'; return 'preschool'; }
  function travelFor(d) { return CALC.travelInfo(d, state.trip.origin, DATA.airports); }
  function preferredMode(d) { const t = travelFor(d); return t && t.preferDrive ? 'drive' : 'fly'; }
  function costFor(d) {
    const mode = preferredMode(d);
    return CALC.estimate(d, { origin: state.trip.origin, adults: state.trip.adults, kids: state.trip.kids, nights: state.trip.nights, month: state.trip.month, tier: 'mid', mode }, DATA);
  }
  const KID_AGE = 4; // ages are no longer collected; use a representative preschool age
  function fitScore(d) {
    if (!state.trip.kids) return 0;
    return (d.ages[bandOf(KID_AGE)] || 0);
  }
  function ageWarning(d) { return state.trip.kids > 0 && (d.ages[bandOf(KID_AGE)] || 0) === 0; }
  function countryName(code) { return (T().countries[code] || code); }

  function haptic(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern || 8); } catch (e) {}
    const sw = $('#hapticInput'); if (sw) { try { sw.checked = !sw.checked; } catch (e) {} }
  }

  /* ---------- Derived list ---------- */
  function filtered() {
    const l = T();
    const q = state.q.trim().toLowerCase();
    const month = state.trip.month;
    let list = DATA.destinations.filter((d) => {
      if (state.category !== 'all' && d.category !== state.category) return false;
      if (state.region !== 'all' && d.region !== state.region) return false;
      if (state.showFavs && !state.favs.has(d.id)) return false;
      if (q) {
        const hay = [d.name.sr, d.name.en, d.place.sr, d.place.en, d.tagline.sr, d.tagline.en,
          d.description.sr, d.description.en, countryName(d.country), (d.tags || []).join(' ')].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (state.filters.stroller && d.stroller !== 3) return false;
      if (state.filters.rain && !(d.tags || []).some((t) => t === 'indoor' || t === 'rainy-day')) return false;
      if (state.filters.short) {
        const t = travelFor(d); if (!t) return false;
        if (!(t.driveMin <= 150 || t.flyMin <= 150)) return false;
      }
      if (state.filters.month && !(d.bestMonths || []).includes(month)) return false;
      return true;
    });
    const cmp = (a, b) => {
      switch (state.sort) {
        case 'near': { const ta = travelFor(a), tb = travelFor(b); const va = ta ? Math.min(ta.driveMin, ta.flyMin) : 1e9; const vb = tb ? Math.min(tb.driveMin, tb.flyMin) : 1e9; return va - vb; }
        case 'cheap': return (costFor(a).mid - costFor(b).mid);
        case 'stroller': return (b.stroller - a.stroller) || fitScore(b) - fitScore(a);
        default: return (fitScore(b) - fitScore(a)) || (b.stroller - a.stroller);
      }
    };
    list.sort(cmp);
    return list;
  }

  /* ---------- Hero sentence ---------- */
  function originNom(code) { const o = T().origins[code]; return o ? o[0] : code; }
  function originGen(code) { const o = T().origins[code]; if (!o) return code; return state.lang === 'sr' ? (o[1] || o[0]) : o[0]; }

  function menuOpt(field, val, label, on) {
    return `<button type="button" class="menu-item${on ? ' on' : ''}" role="option" data-pill="${field}" data-val="${val}"${on ? ' aria-selected="true"' : ''}>${esc(label)}</button>`;
  }
  function pill(field, value, menuHtml) {
    return `<span class="pill"><button type="button" class="pill-btn" data-pill="${field}" aria-haspopup="listbox" aria-expanded="false">${esc(value)}<svg class="i chev"><use href="#i-chev"/></svg></button><div class="menu" role="listbox" aria-label="${field}" hidden>${menuHtml}</div></span>`;
  }

  function renderSentence() {
    const l = T();
    const t = state.trip;
    const originMenu = DATA.origins.map(([group, codes]) =>
      `<div class="menu-head">${esc(l.originGroups[group] || group)}</div>` +
      codes.map((c) => menuOpt('origin', c, originNom(c), c === t.origin)).join('')).join('');
    const kidsMenu = [1, 2, 3, 4].map((n) => menuOpt('kids', n, l.kidsCount(n), n === t.kids)).join('');
    const nightsMenu = Array.from({ length: 13 }, (_, i) => i + 2).map((n) => menuOpt('nights', n, l.days(n), n === t.nights)).join('');
    const monthMenu = l.months.map((m, i) => menuOpt('month', i + 1, m, i + 1 === t.month)).join('');

    $('#sentence').innerHTML =
      `${l.s1} ${pill('origin', originGen(t.origin), originMenu)}` +
      ` ${l.s2} ${pill('kids', l.kidsN(t.kids), kidsMenu)}` +
      ` ${l.s3} ${pill('nights', l.days(t.nights), nightsMenu)}` +
      ` ${l.s4} ${pill('month', l.monthsIn[t.month - 1], monthMenu)}${l.s5}`;
    $('#lede').textContent = l.heroLede(DATA.destinations.length);
  }

  /* ---------- Categories ---------- */
  function renderCats() {
    const l = T();
    const cats = [['all', 'c-all'], ['theme', 'c-theme'], ['animals', 'c-animals'], ['nature', 'c-nature'], ['beach', 'c-beach'], ['city', 'c-city'], ['edutainment', 'c-edutainment']];
    $('#cats').innerHTML = cats.map(([c, icon]) =>
      `<button class="cat-pill" data-action="cat" data-id="${c}" aria-pressed="${state.category === c}"><svg class="i" aria-hidden="true"><use href="#${icon}"/></svg>${esc(l.cat[c])}</button>`).join('');
  }

  /* ---------- Toolbar ---------- */
  function renderToolbar() {
    const l = T();
    $('#q').placeholder = l.searchPh;
    const regions = [['all', 'all'], ['balkans', 'balkans'], ['greece', 'greece'], ['romania', 'romania'], ['central', 'central'], ['western', 'western'], ['mediterranean', 'mediterranean'], ['nordic', 'nordic'], ['british', 'british']];
    $('#region').innerHTML = regions.map(([r, key]) => `<option value="${r}"${state.region === r ? ' selected' : ''}>${esc(l.region[key])}</option>`).join('');
    $('#sort').innerHTML = [['fit', l.sort.fit], ['near', l.sort.near], ['cheap', l.sort.cheap], ['stroller', l.sort.stroller]].map(([s, label]) => `<option value="${s}"${state.sort === s ? ' selected' : ''}>${esc(label)}</option>`).join('');
    $('#toggles').innerHTML = [
      ['stroller', l.fStroller, state.filters.stroller],
      ['rain', l.fRain, state.filters.rain],
      ['short', l.fShort, state.filters.short],
      ['month', l.fMonth(l.months[state.trip.month - 1]), state.filters.month],
    ].map(([key, label, on]) => `<button class="toggle" data-action="filter" data-id="${key}" aria-pressed="${on}">${esc(label)}</button>`).join('');
    $$('#viewSeg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.view === state.view));
  }

  /* ---------- Results / cards ---------- */
  function cardEl(d, idx) {
    const l = T();
    const t = travelFor(d);
    const mode = preferredMode(d);
    const est = costFor(d);
    const warn = ageWarning(d);
    const im = (d.images && d.images[0]) || {};
    const lqip = im.lqip ? `background-image:url("${im.lqip}")` : '';
    const travelHtml = mode === 'drive'
      ? `<span class="travel-chip"><svg class="i"><use href="#i-car"/></svg>${esc(l.drive)} · ${fmtMin(t ? t.driveMin : 0)}</span>`
      : `<span class="travel-chip"><svg class="i"><use href="#i-plane"/></svg>${esc(l.flight)} · ${fmtMin(t ? t.flyMin : 0)}</span>`;
    const strollerCls = d.stroller === 1 ? ' neg' : '';
    const hints = [
      `<span class="hint${strollerCls}"><svg class="i"><use href="#i-stroller"/></svg>${esc(l.stroller[d.stroller])}</span>`,
      `<span class="hint">${esc(l.budget[d.budget])}</span>`,
    ];
    if (warn) hints.push(`<span class="hint neg">${esc(l.fit[0])}</span>`);
    return `<article class="card" data-action="open" data-id="${d.id}" style="animation-delay:${Math.min(idx, 11) * 28}ms">
      <div class="media" style="${lqip}">
        <img class="cover" src="${esc(im.sm || im.src)}" alt="${esc(d.name[state.lang])}" loading="lazy" decoding="async">
        <div class="media-tint"></div>
        ${warn ? `<span class="card-warn"><svg class="i"><use href="#i-bulb"/></svg>${esc(l.fit[0])}</span>` : ''}
        <div class="media-actions">
          <button class="media-btn" data-action="fav" data-id="${d.id}" aria-pressed="${state.favs.has(d.id)}" title="${esc(state.favs.has(d.id) ? l.removeFav : l.addFav)}"><svg class="i filled"><use href="#i-heart"/></svg></button>
          <button class="media-btn ${state.cmp.includes(d.id) ? 'cmp-on' : ''}" data-action="cmp" data-id="${d.id}" aria-pressed="${state.cmp.includes(d.id)}" title="${esc(l.addCmp)}"><svg class="i"><use href="#i-compare"/></svg></button>
        </div>
        ${travelHtml}
        <span class="cost-chip">${esc(l.approx)} ${fmtMoney(est.mid)}</span>
      </div>
      <div class="card-body">
        <div class="loc">${esc(d.place[state.lang])} · ${esc(countryName(d.country))}</div>
        <h2 class="name">${esc(d.name[state.lang])}</h2>
        <p class="tagline">${esc(d.tagline[state.lang])}</p>
        <div class="hints">${hints.join('')}</div>
      </div>
    </article>`;
  }

  function renderResults() {
    const l = T();
    const list = filtered();
    const count = $('#count');
    if (state.showFavs && !state.favs.size) {
      count.textContent = '';
      $('#grid').innerHTML = `<div class="empty"><h3>${esc(l.emptyTitle)}</h3><p>${esc(l.emptyFav)}</p></div>`;
    } else if (!list.length) {
      count.textContent = '';
      $('#grid').innerHTML = `<div class="empty"><h3>${esc(l.emptyTitle)}</h3><p>${esc(l.emptyBody)}</p></div>`;
    } else {
      count.textContent = l.results(list.length, DATA.destinations.length);
      $('#grid').innerHTML = list.map(cardEl).join('');
    }
    $('#clearBtn').hidden = !(state.q || state.region !== 'all' || state.category !== 'all' || Object.values(state.filters).some(Boolean) || state.showFavs);
    $('#clearBtn').textContent = l.clearFilters;
    $('#randomBtn').textContent = l.random;
    if (state.view === 'grid') {
      $('#grid').hidden = false; $('#map').hidden = true;
      observeCovers();
    } else {
      $('#grid').hidden = true; $('#map').hidden = false;
      renderMap(list);
    }
    updateTray();
    updateFavCount();
  }

  function observeCovers() {
    $$('#grid .cover').forEach((img) => {
      const done = () => { img.classList.add('loaded'); };
      if (img.complete && img.naturalWidth) done();
      else { img.addEventListener('load', done, { once: true }); img.addEventListener('error', done, { once: true }); }
    });
  }

  function updateFavCount() {
    const c = $('#favCount');
    c.hidden = !state.favs.size;
    c.textContent = state.favs.size;
    $('#favBtn').setAttribute('aria-pressed', state.showFavs);
  }

  /* ---------- Map ---------- */
  function renderMap(list) {
    $('#map').innerHTML = `<div class="empty" id="mapMsg">${esc(T().mapLoading)}</div>`;
    if (!mapReady) { loadLeaflet(); return; }
    drawMap(list);
  }
  function loadLeaflet() {
    const msg = $('#mapMsg');
    if (!window.L) {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      const js = document.createElement('script'); js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      document.head.appendChild(css); document.body.appendChild(js);
      js.onload = () => { mapReady = true; drawMap(filtered()); };
      js.onerror = () => { if (msg) msg.textContent = T().mapOffline; };
    }
  }
  function drawMap(list) {
    const el = $('#map');
    const LL = window.L;   // Leaflet global, explicit to avoid any local-shadowing
    if (!LL) return;
    if (!map) {
      const dark = state.theme === 'dark' || (state.theme === null && matchMedia('(prefers-color-scheme: dark)').matches);
      const tile = dark
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
      map = LL.map(el, { scrollWheelZoom: false });
      LL.tileLayer(tile, { maxZoom: 19, attribution: '&copy; OpenStreetMap &copy; CARTO' }).addTo(map);
    } else {
      map.invalidateSize();
    }
    const pts = list.map((d) => ({ d, latlng: [d.coords[0], d.coords[1]] }));
    map.eachLayer((layer) => { if (layer instanceof LL.Marker) map.removeLayer(layer); });
    pts.forEach(({ d, latlng }) => {
      const im = (d.images && d.images[0]) || {};
      LL.marker(latlng).addTo(map).bindPopup(
        `<b>${esc(d.name[state.lang])}</b><br><span style="font-size:11px">${esc(d.place[state.lang])}</span>` +
        (im.sm ? `<br><img src="${esc(im.sm)}" alt="" style="width:180px;height:120px;object-fit:cover;border-radius:8px;margin-top:6px"><br>` : '') +
        `<a href="#/d/${d.id}" data-action="open" data-id="${d.id}" style="color:var(--teal);font-weight:700">${esc(T().official)} →</a>`
      );
    });
    if (pts.length) map.fitBounds(LL.latLngBounds(pts.map((p) => p.latlng)), { padding: [30, 30], maxZoom: 11 });
  }

  /* ---------- Detail sheet ---------- */
  let sheetState = { id: null, gal: 0 };

  function renderSheet(id) {
    const l = T();
    const d = DATA.destinations.find((x) => x.id === id);
    if (!d) return;
    sheetState = { id, gal: 0 };
    const imgs = d.images || [];
    const g0 = imgs[0] || {};
    $('#sheetBody').innerHTML = `
      <div class="gallery" id="gal">
        ${imgs.map((im, i) => `<img src="${esc(im.src)}" alt="${esc(d.name[state.lang])}" class="${i === 0 ? 'on' : ''}" loading="${i < 2 ? 'eager' : 'lazy'}">`).join('')}
        <div class="gal-tint"></div>
        <button class="gal-nav prev" data-action="gal" data-dir="-1" aria-label="${esc(l.prev)}"><svg class="i"><use href="#i-left"/></svg></button>
        <button class="gal-nav next" data-action="gal" data-dir="1" aria-label="${esc(l.next)}"><svg class="i"><use href="#i-right"/></svg></button>
        <span class="gal-count">${l.photoOf(1, imgs.length)}</span>
        ${g0.author ? `<span class="gal-credit">© ${esc(g0.author)} · <a href="${esc(g0.page || '')}" target="_blank" rel="noopener">${esc(g0.license || '')}</a></span>` : ''}
      </div>
      <button class="sheet-close" data-action="close-sheet" aria-label="${esc(l.close)}"><svg class="i"><use href="#i-x"/></svg></button>
      <div class="sheet-scroll"><div class="sheet-inner">
        <div class="sheet-head">
          <div class="meta">
            <div class="sheet-kicker"><span class="sheet-country">${esc(countryName(d.country))} · ${esc(d.place[state.lang])}</span><span class="sheet-cat">${esc(l.cat[d.category])}</span></div>
            <h2 class="sheet-title" id="sheetTitle">${esc(d.name[state.lang])}</h2>
            <p class="sheet-tagline">${esc(d.tagline[state.lang])}</p>
          </div>
          <div class="sheet-actions">
            <button class="media-btn ${state.favs.has(d.id) ? '' : ''}" data-action="fav" data-id="${d.id}" aria-pressed="${state.favs.has(d.id)}" title="${esc(l.addFav)}"><svg class="i filled"><use href="#i-heart"/></svg></button>
            <button class="media-btn ${state.cmp.includes(d.id) ? 'cmp-on' : ''}" data-action="cmp" data-id="${d.id}" aria-pressed="${state.cmp.includes(d.id)}" title="${esc(l.addCmp)}"><svg class="i"><use href="#i-compare"/></svg></button>
            <button class="media-btn" data-action="share" data-id="${d.id}" title="${esc(l.share)}"><svg class="i"><use href="#i-share"/></svg></button>
          </div>
        </div>

        <div class="sheet-section"><p class="sheet-desc">${esc(d.description[state.lang])}</p></div>

        <div class="sheet-section">
          <h3><svg class="i"><use href="#i-check"/></svg>${esc(l.highlights)}</h3>
          <div class="chips">${pick(d.highlights).map((h) => `<span>${esc(h)}</span>`).join('')}</div>
        </div>

        <div class="sheet-section">
          <h3><svg class="i"><use href="#i-heart"/></svg>${esc(l.agesTitle)}</h3>
          <div class="age-meters">
            ${['baby', 'toddler', 'preschool'].map((band, bi) => `
              <div class="age-meter">
                <div class="label">${esc(l.ageBands[bi])}</div>
                <div class="dots">${[0, 1, 2].map((i) => `<span class="dot${i < d.ages[band] ? ' on' : ''}"></span>`).join('')}</div>
                <div class="fit">${esc(l.fit[d.ages[band]])}</div>
              </div>`).join('')}
          </div>
        </div>

        <div class="sheet-section">
          <div class="proscons">
            <div class="col pros"><h4><svg class="i"><use href="#i-check"/></svg>${esc(l.pros)}</h4><ul>${pick(d.pros).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
            <div class="col cons"><h4><svg class="i"><use href="#i-x"/></svg>${esc(l.cons)}</h4><ul>${pick(d.cons).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
          </div>
        </div>

        <div class="sheet-section">
          <h3><svg class="i"><use href="#i-sun"/></svg>${esc(l.whenTitle)}</h3>
          <div class="month-strip">${Array.from({ length: 12 }, (_, i) => {
            const m = i + 1, best = d.bestMonths.includes(m), good = d.bestMonths.some((b) => b === m || b === ((m % 12) + 1) || ((b - 1) || 12) === m);
            return `<div class="month-cell${best ? ' best' : good ? ' good' : ''}">${esc(l.monthsShort[i])}</div>`;
          }).join('')}</div>
          <p style="margin-top:10px;color:var(--ink-2);font-size:.9rem"><b>${esc(l.season)}:</b> ${esc(d.season[state.lang])}</p>
        </div>

        <div class="sheet-section"><div class="tip-card"><svg class="i"><use href="#i-bulb"/></svg><p><b>${esc(l.tip)}:</b> ${esc(d.tip[state.lang])}</p></div></div>

        <div class="sheet-section">
          <h3><svg class="i"><use href="#i-plane"/></svg>${esc(l.gettingThere)}</h3>
          <div class="getting">
            <div class="row"><svg class="i"><use href="#i-plane"/></svg><span>${esc(l.fromAirport(d.airport.iata, d.airport.km, d.airport.minutes))} · ${esc(d.airport.mode[state.lang])}</span></div>
          </div>
        </div>

        <div class="sheet-section">
          <h3><svg class="i"><use href="#i-plus"/></svg>${esc(l.calcTitle)}</h3>
          ${calcHtml(d)}
        </div>

        <div class="sheet-section">
          <div class="links">
            <a class="btn primary" href="${esc(d.officialUrl)}" target="_blank" rel="noopener">${esc(l.official)} <svg class="i"><use href="#i-ext"/></svg></a>
            <button class="btn" data-action="credits" data-id="${d.id}">${esc(l.photos)}</button>
          </div>
          ${d.priceConfidence === 'verified' ? `<div class="conf verified">✓ ${esc(l.priceVerified)}</div>` : `<div class="conf estimated">~ ${esc(l.priceEstimated)}</div>`}
        </div>
      </div></div>`;
    $('#sheetTitle').textContent = d.name[state.lang];
  }

  function openSheet(id, push) {
    if (push !== false) { try { history.replaceState(null, '', '#/d/' + id); } catch (e) {} }
    renderSheet(id);
    const sheet = $('#sheet');
    if (!sheet.open) sheet.showModal();
    haptic(6);
  }

  /* ---------- Calculator ---------- */
  function calcHtml(d) {
    const l = T();
    const t = state.trip;
    const tiers = [['budget', l.tiers.budget], ['mid', l.tiers.mid], ['comfort', l.tiers.comfort]];
    const modes = [['fly', l.modeFly], ['drive', l.modeDrive]];
    return `<div class="calc">
      <div class="calc-controls">
        <div class="field"><label>${esc(l.adults)}</label><select data-field="adults">${[1, 2, 3, 4].map((n) => `<option value="${n}"${n === t.adults ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="field"><label>${esc(l.kids)}</label><select data-field="kids">${[1, 2, 3, 4].map((n) => `<option value="${n}"${n === t.kids ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="field"><label>${esc(l.nights)}</label><select data-field="nights">${Array.from({ length: 13 }, (_, i) => i + 2).map((n) => `<option value="${n}"${n === t.nights ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="field"><label>${esc(l.month)}</label><select data-field="month">${l.months.map((m, i) => `<option value="${i + 1}"${i + 1 === t.month ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select></div>
        <div class="field"><label>${esc(l.tier)}</label><select data-field="tier">${tiers.map(([v, lb]) => `<option value="${v}"${v === t.tier ? ' selected' : ''}>${esc(lb)}</option>`).join('')}</select></div>
        <div class="field"><label>${esc(l.mode)}</label><select data-field="mode">${modes.map(([v, lb]) => `<option value="${v}"${v === t.mode ? ' selected' : ''}>${esc(lb)}</option>`).join('')}</select></div>
      </div>
      ${calcResultHtml(d)}
    </div>`;
  }

  function calcResultHtml(d) {
    const l = T();
    const t = state.trip;
    const e = CALC.estimate(d, t, DATA);
    const parts = [['travel', l.parts.travel], ['stay', l.parts.stay], ['tickets', l.parts.tickets], ['food', l.parts.food], ['local', l.parts.local]];
    const maxVal = Math.max(...parts.map(([k]) => e.parts[k].high), 1);
    const note = (k) => {
      const m = e.travelMeta || {};
      switch (k) {
        case 'travel': return e.mode === 'fly' ? l.partNote.fly(Math.floor(m.flyMin / 60), m.flyMin % 60) + (m.transfer ? ' · ' + l.partNote.transfer : '') : l.partNote.drive(Math.round(m.roadKm), Math.round(m.driveMin / 60));
        case 'stay': return l.partNote.stay(e.nights, l.tiers[t.tier]);
        case 'tickets': return (d.costs.tickets && d.costs.tickets.length) ? l.partNote.tickets : l.partNote.noTickets;
        case 'food': return l.partNote.food;
        case 'local': return l.partNote.local;
        default: return '';
      }
    };
    const flightsUrl = `https://www.skyscanner.net/transport/flights/${t.origin}/${d.airport.iata}/`;
    const staysUrl = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(d.place.en)}`;
    const driveHint = e.mode === 'drive' ? `<p class="calc-note" style="color:var(--teal)">${esc(l.driveHint)}</p>` : '';
    const infantNote = e.infants ? `<p class="calc-note">${esc(l.infantNote)}</p>` : '';
    return `
      <div class="calc-total">
        <span class="big">${esc(l.total)}: ${fmtMoney(e.low)}–${fmtMoney(e.high)}</span>
        <span class="sub">(${fmtMoney(e.perDay)} ${esc(l.perDay)})</span>
      </div>
      <div class="calc-parts">
        ${parts.map(([k, name]) => `<div class="calc-part">
          <span class="nm">${esc(name)}</span>
          <span class="bar"><i style="width:${Math.round((e.parts[k].high / maxVal) * 100)}%"></i></span>
          <span class="val">${fmtMoney(e.parts[k].low)}–${fmtMoney(e.parts[k].high)}</span>
          <span class="note">${esc(note(k))}</span>
        </div>`).join('')}
      </div>
      ${driveHint}${infantNote}
      <div class="calc-cta">
        <a class="btn primary" href="${flightsUrl}" target="_blank" rel="noopener">${esc(l.searchFlights)} <svg class="i"><use href="#i-ext"/></svg></a>
        <a class="btn" href="${staysUrl}" target="_blank" rel="noopener">${esc(l.searchStays)} <svg class="i"><use href="#i-ext"/></svg></a>
      </div>
      <p class="calc-note">${esc(l.disclaimer)}</p>`;
  }

  /* ---------- Compare ---------- */
  function updateTray() {
    const l = T();
    const items = state.cmp.map((id) => DATA.destinations.find((x) => x.id === id)).filter(Boolean);
    $('#tray').classList.toggle('show', items.length > 0);
    $('#trayItems').innerHTML = items.map((d) => {
      const im = (d.images && d.images[0]) || {};
      return `<span class="tray-item">${im.sm ? `<img src="${esc(im.sm)}" alt="">` : ''}${esc(d.name[state.lang])}<button class="x" data-action="cmp-rm" data-id="${d.id}" aria-label="Ukloni"><svg class="i"><use href="#i-x"/></svg></button></span>`;
    }).join('');
    $('#cmpBtn').textContent = `${l.compare} (${items.length})`;
    $('#cmpClear').setAttribute('aria-label', l.compareClear);
  }

  function openCompare() {
    const l = T();
    const items = state.cmp.map((id) => DATA.destinations.find((x) => x.id === id)).filter(Boolean);
    if (items.length < 2) { toast(l.cmpMin); return; }
    $('#cmpBody').innerHTML = `
      <div class="modal-head"><h3>${esc(l.compareTitle)}</h3><button class="media-btn" data-action="close-compare" aria-label="${esc(l.close)}"><svg class="i"><use href="#i-x"/></svg></button></div>
      <div class="modal-scroll"><div class="cmp-grid" style="--cols:${items.length}">
        ${items.map((d) => {
          const im = (d.images && d.images[0]) || {};
          const est = costFor(d);
          const best = d.bestMonths.map((m) => l.monthsShort[m - 1]).join(', ');
          return `<div class="cmp-col">
            <div class="cmp-cover">${im.sm ? `<img src="${esc(im.sm)}" alt="">` : ''}</div>
            <div class="cmp-name">${esc(d.name[state.lang])}</div>
            <div class="cmp-loc">${esc(d.place[state.lang])} · ${esc(countryName(d.country))}</div>
            <div class="cmp-row"><span class="k">${esc(l.cmpRows.travel)}</span>${esc(l.flight)} ~ ${fmtMin((travelFor(d) || {}).flyMin || 0)} · ${esc(l.drive)} ${fmtMin((travelFor(d) || {}).driveMin || 0)}</div>
            <div class="cmp-row"><span class="k">${esc(l.cmpRows.cost)}</span>${fmtMoney(est.low)}–${fmtMoney(est.high)}</div>
            <div class="cmp-row"><span class="k">${esc(l.cmpRows.ages)}</span>${esc(l.ageBands.map((b, i) => `${b}: ${l.fit[d.ages[['baby', 'toddler', 'preschool'][i]]]}`).join(' · '))}</div>
            <div class="cmp-row"><span class="k">${esc(l.cmpRows.stroller)}</span>${esc(l.stroller[d.stroller])}</div>
            <div class="cmp-row"><span class="k">${esc(l.cmpRows.months)}</span>${esc(best)}</div>
            <div class="cmp-row"><span class="k">${esc(l.cmpRows.pros)}</span>${esc(pick(d.pros).slice(0, 2).join(' · '))}</div>
            <div class="cmp-row"><span class="k">${esc(l.cmpRows.cons)}</span>${esc(pick(d.cons).slice(0, 2).join(' · '))}</div>
          </div>`;
        }).join('')}
      </div></div>`;
    $('#cmpModal').showModal();
    haptic(6);
  }

  /* ---------- Credits ---------- */
  function openCredits(id) {
    const l = T();
    const d = DATA.destinations.find((x) => x.id === id);
    if (!d) return;
    $('#creditsBody').innerHTML = `
      <div class="modal-head"><h3>${esc(l.credits)} · ${esc(d.name[state.lang])}</h3><button class="media-btn" data-action="close-credits" aria-label="${esc(l.close)}"><svg class="i"><use href="#i-x"/></svg></button></div>
      <div class="modal-scroll"><p style="color:var(--ink-2);font-size:.86rem;margin-bottom:14px">${esc(l.creditsLede)}</p>
      <div class="credits-list">${(d.images || []).map((im) => `
        <div class="credit">
          ${im.sm ? `<img src="${esc(im.sm)}" alt="">` : ''}
          <div class="c-body"><b>${esc(im.title || im.author || '')}</b>${esc(im.author)}</div>
          <span class="c-lic">${esc(im.license || '')}</span>
        </div>`).join('')}
      </div></div>`;
    $('#creditsModal').showModal();
  }

  /* ---------- Lightbox ---------- */
  let lbState = { id: null, i: 0 };
  function openLightbox(id, i) {
    const d = DATA.destinations.find((x) => x.id === id);
    if (!d || !d.images.length) return;
    lbState = { id, i: Math.min(i, d.images.length - 1) };
    renderLightbox();
    $('#lightbox').showModal();
    haptic(5);
  }
  function renderLightbox() {
    const l = T();
    const d = DATA.destinations.find((x) => x.id === lbState.id);
    if (!d) return;
    const im = d.images[lbState.i];
    $('#lbBody').innerHTML = `
      <img class="lb-img" src="${esc(im.src)}" alt="${esc(d.name[state.lang])}">
      <div class="lb-top"><span class="lb-caption">${esc(d.name[state.lang])} · ${l.photoOf(lbState.i + 1, d.images.length)}</span><button class="lb-close" data-action="lb-close" aria-label="${esc(l.close)}"><svg class="i"><use href="#i-x"/></svg></button></div>
      <button class="lb-nav prev" data-action="lb-nav" data-dir="-1" aria-label="${esc(l.prev)}"><svg class="i"><use href="#i-left"/></svg></button>
      <button class="lb-nav next" data-action="lb-nav" data-dir="1" aria-label="${esc(l.next)}"><svg class="i"><use href="#i-right"/></svg></button>
      ${im.author ? `<span class="lb-credit">© ${esc(im.author)} · <a href="${esc(im.page || '')}" target="_blank" rel="noopener">${esc(im.license || '')}</a></span>` : ''}
      <div class="lb-strip">${d.images.map((x, j) => `<img src="${esc(x.sm || x.src)}" alt="" class="${j === lbState.i ? 'on' : ''}" data-action="lb-thumb" data-idx="${j}">`).join('')}</div>`;
  }

  /* ---------- Toast ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  /* ---------- Actions ---------- */
  function setCategory(c) { state.category = c; renderCats(); renderResults(); haptic(4); }
  function toggleFilter(k) { state.filters[k] = !state.filters[k]; renderToolbar(); renderResults(); haptic(4); }
  function toggleFav(id) {
    const d = DATA.destinations.find((x) => x.id === id);
    if (state.favs.has(id)) { state.favs.delete(id); }
    else { state.favs.add(id); toast(d ? `${T().favAdded}: ${d.name[state.lang]}` : T().favAdded); haptic([8, 30, 10]); }
    LS.set('pp.favs', Array.from(state.favs));
    renderResults();
    if ($('#sheet').open && sheetState.id === id) renderSheet(id);
  }
  function toggleCmp(id) {
    const i = state.cmp.indexOf(id);
    if (i >= 0) state.cmp.splice(i, 1);
    else { if (state.cmp.length >= 3) { toast(T().cmpMax); return; } state.cmp.push(id); }
    LS.set('pp.cmp', state.cmp);
    renderResults(); updateTray();
    if ($('#sheet').open && sheetState.id === id) renderSheet(id);
    haptic(5);
  }
  function clearAll() {
    state.q = ''; state.region = 'all'; state.category = 'all'; state.showFavs = false;
    state.filters = { stroller: false, rain: false, short: false, month: false };
    $('#q').value = '';
    renderCats(); renderToolbar(); renderResults(); haptic(4);
  }
  function surprise() {
    const list = filtered();
    const pool = list.length ? list : DATA.destinations;
    const d = pool[Math.floor(Math.random() * pool.length)];
    toast(T().randomToast(d.name[state.lang]));
    setTimeout(() => openSheet(d.id), 250);
    haptic([12, 30, 12]);
  }

  /* ---------- Hero pill menus ---------- */
  let openMenu = null;
  function closeAllMenus() {
    $$('.pill .menu').forEach((m) => { m.hidden = true; });
    $$('.pill-btn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    openMenu = null;
  }
  function toggleMenu(field, btnEl) {
    const wasOpen = openMenu === field;
    closeAllMenus();
    if (wasOpen) return;
    const menu = btnEl.parentElement.querySelector('.menu');
    if (!menu) return;
    menu.hidden = false;
    btnEl.setAttribute('aria-expanded', 'true');
    openMenu = field;
  }
  function selectPill(field, val) {
    const t = state.trip;
    if (field === 'origin') t.origin = val;
    else if (field === 'kids') t.kids = Number(val);
    else if (field === 'nights') t.nights = Number(val);
    else if (field === 'month') t.month = Number(val);
    closeAllMenus();
    tripChanged();
    haptic(5);
  }

  /* ---------- Delegated events ---------- */
  document.addEventListener('click', (e) => {
    const pillBtn = e.target.closest('.pill-btn');
    if (pillBtn) { e.stopPropagation(); toggleMenu(pillBtn.dataset.pill, pillBtn); return; }
    const menuItem = e.target.closest('.menu-item');
    if (menuItem) { e.stopPropagation(); selectPill(menuItem.dataset.pill, menuItem.dataset.val); return; }
    if (!e.target.closest('.pill')) closeAllMenus();

    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const a = btn.dataset.action, id = btn.dataset.id;
    switch (a) {
      case 'cat': setCategory(id); break;
      case 'filter': toggleFilter(id); break;
      case 'open': if (btn.tagName === 'A') e.preventDefault(); openSheet(id); break;
      case 'fav': e.stopPropagation(); toggleFav(id); break;
      case 'cmp': e.stopPropagation(); toggleCmp(id); break;
      case 'share': share(id); break;
      case 'close-sheet': closeSheet(); break;
      case 'gal': { const d = DATA.destinations.find((x) => x.id === sheetState.id); if (d) setGal(sheetState.gal + (btn.dataset.dir === '1' ? 1 : -1), d.images.length); break; }
      case 'open-lightbox': openLightbox(id, Number(btn.dataset.idx || 0)); break;
      case 'lb-close': $('#lightbox').close(); break;
      case 'lb-nav': stepLb(btn.dataset.dir === '1' ? 1 : -1); break;
      case 'lb-thumb': lbState.i = Number(btn.dataset.idx); renderLightbox(); break;
      case 'credits': openCredits(id); break;
      case 'close-credits': $('#creditsModal').close(); break;
      case 'close-compare': $('#cmpModal').close(); break;
      case 'cmp-rm': { e.stopPropagation(); state.cmp = state.cmp.filter((x) => x !== id); LS.set('pp.cmp', state.cmp); renderResults(); break; }
      case 'clear': clearAll(); break;
      case 'random': surprise(); break;
      case 'credits-global': openCreditsModalGlobal(); break;
    }
  });

  document.addEventListener('change', (e) => {
    const f = e.target.dataset.field;
    if (!f) return;
    const v = e.target.value;
    switch (f) {
      case 'origin': state.trip.origin = v; saveTrip(); break;
      case 'kids': state.trip.kids = Number(v); saveTrip(); break;
      case 'nights': state.trip.nights = Number(v); saveTrip(); break;
      case 'month': state.trip.month = Number(v); saveTrip(); break;
      case 'adults': state.trip.adults = Number(v); saveTrip(); break;
      case 'tier': state.trip.tier = v; saveTrip(); break;
      case 'mode': state.trip.mode = v; saveTrip(); break;
      case 'region': state.region = v; renderResults(); return;
      case 'sort': state.sort = v; renderResults(); return;
      default: return;
    }
    tripChanged();
  });

  function saveTrip() { LS.set('pp.trip', state.trip); }
  function tripChanged() { saveTrip(); renderSentence(); renderToolbar(); renderResults(); if ($('#sheet').open) renderSheet(sheetState.id); }

  function share(id) {
    try { navigator.clipboard.writeText(location.href).then(() => toast(T().copied)); }
    catch (e) { toast(location.href); }
  }

  function setGal(i, n) { sheetState.gal = (i + n) % n; const imgs = $$('#gal img'); imgs.forEach((im, j) => im.classList.toggle('on', j === sheetState.gal)); const d = DATA.destinations.find((x) => x.id === sheetState.id); const im = d.images[sheetState.gal]; $('#gal .gal-count').textContent = T().photoOf(sheetState.gal + 1, n); $('#gal .gal-credit').innerHTML = im.author ? `© ${esc(im.author)} · <a href="${esc(im.page || '')}" target="_blank" rel="noopener">${esc(im.license || '')}</a>` : ''; }
  function stepLb(dir) { const d = DATA.destinations.find((x) => x.id === lbState.id); if (!d) return; lbState.i = (lbState.i + dir + d.images.length) % d.images.length; renderLightbox(); }
  function closeSheet() { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} $('#sheet').close(); }

  /* ---------- Top bar ---------- */
  function openCreditsModalGlobal() {
    const l = T();
    const all = DATA.destinations.flatMap((d) => (d.images || []).map((im) => ({ d, im })));
    const unique = [];
    const seen = new Set();
    all.forEach(({ d, im }) => { const k = im.title || im.src; if (seen.has(k)) return; seen.add(k); unique.push({ d, im }); });
    $('#creditsBody').innerHTML = `
      <div class="modal-head"><h3>${esc(l.credits)}</h3><button class="media-btn" data-action="close-credits" aria-label="${esc(l.close)}"><svg class="i"><use href="#i-x"/></svg></button></div>
      <div class="modal-scroll"><p style="color:var(--ink-2);font-size:.86rem;margin-bottom:14px">${esc(l.creditsLede)}</p>
      <div class="credits-list">${unique.map(({ d, im }) => `
        <div class="credit"><img src="${esc(im.sm || im.src)}" alt=""><div class="c-body"><b>${esc(d.name[state.lang])}</b>${esc(im.author)}</div><span class="c-lic">${esc(im.license || '')}</span></div>`).join('')}
      </div></div>`;
    $('#creditsModal').showModal();
  }

  /* ---------- Theme / language ---------- */
  function applyTheme() {
    const dark = state.theme === 'dark' || (state.theme === null && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    $('#themeBtn').innerHTML = dark ? '<svg class="i"><use href="#i-sun"/></svg>' : '<svg class="i"><use href="#i-moon"/></svg>';
    $('#themeBtn').setAttribute('aria-label', T().themeToggle);
    if (map) { map.remove(); map = null; mapReady = true; if (state.view === 'map') renderMap(filtered()); }
  }
  function cycleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : state.theme === 'light' ? null : 'dark';
    if (state.theme === null) LS.set('pp.theme', null); else LS.set('pp.theme', state.theme);
    applyTheme(); haptic(5);
  }
  function setLang(lang) {
    state.lang = lang; LS.set('pp.lang', lang);
    document.documentElement.lang = T().htmlLang;
    document.title = T().metaTitle;
    $('meta[name="description"]').setAttribute('content', T().metaDesc);
    $('#langBtn').textContent = T().langSwitch;
    $('#langBtn').setAttribute('aria-label', lang === 'sr' ? 'English' : 'Srpski');
    applyStatic();
    renderSentence(); renderCats(); renderToolbar(); renderResults();
    if ($('#sheet').open) renderSheet(sheetState.id);
    haptic(5);
  }

  function applyStatic() {
    const l = T();
    $('#footText').textContent = l.footer;
    $('#creditsBtn').textContent = l.credits;
    $$('[data-t]').forEach((el) => {
      const v = l[el.dataset.t];
      if (typeof v === 'string') el.textContent = v;
    });
    const grid = $('#viewSeg [data-view="grid"] span');
    const map = $('#viewSeg [data-view="map"] span');
    if (grid) grid.textContent = l.viewGrid;
    if (map) map.textContent = l.viewMap;
  }

  /* ---------- Routing ---------- */
  function route() {
    const h = location.hash;
    if (h.startsWith('#/d/')) {
      const id = h.slice(4);
      if (DATA.destinations.some((x) => x.id === id)) openSheet(id, false);
    }
  }

  /* ---------- Keyboard / dialog backdrop ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return;
    const lb = $('#lightbox');
    if (lb.open) {
      if (e.key === 'ArrowRight') { e.preventDefault(); stepLb(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); stepLb(-1); }
    }
  });
  ['#sheet', '#cmpModal', '#creditsModal', '#lightbox'].forEach((sel) => {
    const el = $(sel);
    el.addEventListener('click', (e) => { if (e.target === el) el.close(); });
  });
  $('#sheet').addEventListener('close', () => { if (location.hash.startsWith('#/d/')) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} } });

  /* ---------- Wire top bar ---------- */
  $('#favBtn').addEventListener('click', () => { state.showFavs = !state.showFavs; renderResults(); haptic(5); });
  $('#langBtn').addEventListener('click', () => setLang(state.lang === 'sr' ? 'en' : 'sr'));
  $('#themeBtn').addEventListener('click', cycleTheme);
  $('#q').addEventListener('input', (e) => { state.q = e.target.value; renderResults(); });
  $('#clearBtn').addEventListener('click', clearAll);
  $('#randomBtn').addEventListener('click', surprise);
  $('#creditsBtn').addEventListener('click', openCreditsModalGlobal);
  $('#cmpBtn').addEventListener('click', openCompare);
  $('#cmpClear').addEventListener('click', () => { state.cmp = []; LS.set('pp.cmp', []); renderResults(); });
  $('#viewSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]'); if (!b) return;
    state.view = b.dataset.view; LS.set('pp.view', state.view);
    $$('#viewSeg button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    renderResults(); haptic(4);
  });
  // gallery image click → lightbox
  $('#sheet').addEventListener('click', (e) => {
    const img = e.target.closest('#gal img'); if (img) { const idx = $$('#gal img').indexOf(img); openLightbox(sheetState.id, idx); }
  });
  window.addEventListener('hashchange', route);

  /* ---------- Init ---------- */
  function init() {
    applyTheme();
    document.documentElement.lang = T().htmlLang;
    $('#langBtn').textContent = T().langSwitch;
    document.title = T().metaTitle;
    applyStatic();
    renderSentence(); renderCats(); renderToolbar(); renderResults();
    route();
  }
  init();
})();
