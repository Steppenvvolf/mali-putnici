"""Build data/destinations.js from data/raw/*.json and download Wikimedia Commons images.

  python tools/build.py            # validate + download missing images + write data/destinations.js
  python tools/build.py --no-img   # validate + write data only (images must already exist)

Everything the site needs ends up in data/destinations.js (a plain script, so index.html works from file://).
"""
import base64
import glob
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
IMG = os.path.join(ROOT, "img")
UA = "PorodicnaPutovanja/1.0 (static family-travel site; image credit collection)"
API = "https://commons.wikimedia.org/w/api.php"

REGIONS = {"balkans", "greece", "romania", "central", "western", "nordic", "mediterranean", "british"}
CATEGORIES = {"theme", "animals", "nature", "beach", "city", "edutainment"}
TAGS = set("""theme-park zoo aquarium safari farm-animals water-park beach shallow-sea lake mountain cave forest waterfall
castle old-town museum science fairytale dinosaurs train boat cable-car indoor rainy-day winter free playground spa""".split())

# Origin airports offered in the calculator, grouped for the <select>.
ORIGINS = [
    ("serbia", ["BEG", "INI", "KVO"]),
    ("exyu", ["ZAG", "SPU", "LJU", "SJJ", "BNX", "TZL", "TGD", "TIV", "SKP", "OHD"]),
    ("balkans", ["TIA", "SOF", "VAR", "OTP", "CLJ", "TSR", "SKG", "ATH", "BUD"]),
    ("hubs", ["VIE", "MUC", "FRA", "DUS", "BER", "ZRH", "MXP", "BGY", "FCO", "CDG", "AMS", "LHR", "STN",
              "CPH", "ARN", "WAW", "PRG"]),
]

errors, warnings = [], []


def err(rid, msg):
    errors.append(f"[{rid}] {msg}")


def warn(rid, msg):
    warnings.append(f"[{rid}] {msg}")


def is_i18n(v):
    return isinstance(v, dict) and all(isinstance(v.get(k), str) and v.get(k).strip() for k in ("sr", "en"))


def validate(r):
    rid = r.get("id", "?")
    if not re.fullmatch(r"[a-z0-9-]+", str(rid)):
        err(rid, "bad id")
    for k in ("name", "place", "season", "tagline", "description", "tip"):
        if not is_i18n(r.get(k)):
            err(rid, f"{k} must be {{sr,en}}")
    for k, lo, hi in (("highlights", 3, 6), ("pros", 3, 6), ("cons", 2, 5)):
        v = r.get(k)
        if not isinstance(v, list) or not (lo <= len(v) <= hi) or not all(is_i18n(x) for x in v):
            err(rid, f"{k} must be {lo}-{hi} {{sr,en}} items")
    if r.get("region") not in REGIONS:
        err(rid, f"region {r.get('region')!r}")
    if r.get("category") not in CATEGORIES:
        err(rid, f"category {r.get('category')!r}")
    bad = [t for t in r.get("tags", []) if t not in TAGS]
    if bad:
        warn(rid, f"unknown tags dropped: {bad}")
        r["tags"] = [t for t in r.get("tags", []) if t in TAGS]
    c = r.get("coords")
    if not (isinstance(c, list) and len(c) == 2 and 27 <= c[0] <= 71 and -25 <= c[1] <= 45):
        err(rid, f"coords {c}")
    a = r.get("airport") or {}
    if not re.fullmatch(r"[A-Z]{3}", str(a.get("iata", ""))) or not is_i18n(a.get("mode")):
        err(rid, "airport iata/mode")
    for k in ("baby", "toddler", "preschool"):
        if (r.get("ages") or {}).get(k) not in (0, 1, 2, 3):
            err(rid, f"ages.{k}")
    if r.get("stroller") not in (1, 2, 3) or r.get("budget") not in (1, 2, 3):
        err(rid, "stroller/budget must be 1-3")
    if not r.get("bestMonths") or not all(isinstance(m, int) and 1 <= m <= 12 for m in r["bestMonths"]):
        err(rid, "bestMonths")
    co = r.get("costs") or {}
    hn = co.get("hotelNight") or {}
    if not all(isinstance(hn.get(k), (int, float)) and hn[k] > 0 for k in ("budget", "mid", "comfort")):
        err(rid, "costs.hotelNight")
    elif not hn["budget"] <= hn["mid"] <= hn["comfort"]:
        warn(rid, f"hotelNight not ascending {hn}")
    for k in ("foodPerAdultDay", "localPerDay"):
        if not isinstance(co.get(k), (int, float)):
            err(rid, f"costs.{k}")
    for t in co.get("tickets", []):
        if not is_i18n(t.get("name")) or not isinstance(t.get("adult"), (int, float)) \
                or not isinstance(t.get("child"), (int, float)) or not isinstance(t.get("freeUnder"), (int, float)):
            err(rid, f"ticket malformed: {t}")
    if r.get("priceConfidence") not in ("verified", "estimated"):
        err(rid, "priceConfidence")
    if not str(r.get("officialUrl", "")).startswith("http"):
        err(rid, "officialUrl")
    imgs = r.get("images") or []
    if not 3 <= len(imgs) <= 6:
        err(rid, f"{len(imgs)} images (need 4-6)")
    s = r.get("tagline", {}).get("sr", "")
    if len(s) > 110:
        warn(rid, f"sr tagline long ({len(s)})")


def api(params):
    params = {"action": "query", **params, "format": "json", "formatversion": "2"}
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params), headers={"User-Agent": UA})
    last = None
    for attempt in range(8):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            last = e
            time.sleep(5 + attempt * 5)
        except Exception as e:
            last = e
            time.sleep(3 + attempt * 3)
    raise RuntimeError(f"Commons API unreachable: {last}")


def strip_html(s):
    s = re.sub(r"<[^>]+>", "", s or "")
    return re.sub(r"\s+", " ", s).strip()


def commons_info(titles):
    info = {}
    for i in range(0, len(titles), 40):
        data = api({"titles": "|".join(titles[i:i + 40]), "prop": "imageinfo",
                    "iiprop": "url|size|extmetadata", "iiurlwidth": "1920",
                    "iiextmetadatafilter": "LicenseShortName|LicenseUrl|Artist|Credit"})
        norm = {n["to"]: n["from"] for n in data["query"].get("normalized", [])}
        for p in data["query"]["pages"]:
            if p.get("missing") or not p.get("imageinfo"):
                continue
            ii = p["imageinfo"][0]
            m = ii.get("extmetadata", {})
            rec = {
                "thumb": ii.get("thumburl") or ii["url"], "page": ii.get("descriptionurl"),
                "license": strip_html(m.get("LicenseShortName", {}).get("value", "")),
                "licenseUrl": strip_html(m.get("LicenseUrl", {}).get("value", "")),
                "author": strip_html(m.get("Artist", {}).get("value", ""))[:120] or "Wikimedia Commons",
            }
            info[p["title"]] = rec
            if p["title"] in norm:
                info[norm[p["title"]]] = rec
    return info


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if attempt == 5:
                raise
            time.sleep(4 + attempt * 6)
        except Exception as e:
            if attempt == 5:
                raise
            time.sleep(3 + attempt * 5)


def save_variants(raw, big, small):
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
    # Crop anything taller than 3:2 landscape-ish to 4:3 so covers stay consistent.
    w, h = im.size
    if h > w * 0.8:
        nh = int(w * 0.75)
        top = max(0, (h - nh) // 2)
        im = im.crop((0, top, w, top + nh))
    b = im.copy()
    b.thumbnail((1600, 1600), Image.LANCZOS)
    b.save(big, "JPEG", quality=80, optimize=True, progressive=True)
    s = im.copy()
    s.thumbnail((720, 720), Image.LANCZOS)
    s.save(small, "JPEG", quality=76, optimize=True, progressive=True)
    return b.size


def lqip(path):
    im = Image.open(path).convert("RGB")
    im.thumbnail((24, 24))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=60)
    avg = im.resize((1, 1), Image.BOX).getpixel((0, 0))
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(), "#%02x%02x%02x" % avg


def main():
    no_img = "--no-img" in sys.argv
    records, seen = [], set()
    for f in sorted(glob.glob(os.path.join(RAW, "batch-*.json"))):
        try:
            batch = json.load(open(f, encoding="utf-8"))
        except Exception as e:
            errors.append(f"{os.path.basename(f)}: invalid JSON: {e}")
            continue
        for r in batch:
            if r.get("id") in seen:
                err(r.get("id"), "duplicate id")
                continue
            seen.add(r.get("id"))
            validate(r)
            records.append(r)

    airports_all = json.load(open(os.path.join(RAW, "airports-all.json"), encoding="utf-8"))
    need = {r["airport"]["iata"] for r in records if r.get("airport")} | {c for _, g in ORIGINS for c in g}
    airports = {}
    for code in sorted(need):
        a = airports_all.get(code)
        if not a:
            errors.append(f"airport {code} not in OurAirports scheduled list")
            continue
        airports[code] = {"n": a["city"] or a["name"], "c": a["country"], "lat": a["lat"], "lng": a["lng"],
                          "big": a["type"] == "large_airport"}

    pricing_path = os.path.join(RAW, "pricing.json")
    pricing = json.load(open(pricing_path, encoding="utf-8")) if os.path.exists(pricing_path) else None
    if pricing is None:
        warnings.append("pricing.json missing - calculator will use built-in defaults")

    # Images
    all_titles = sorted({t for r in records for t in r.get("images", [])})
    info = {} if no_img else commons_info(all_titles)
    credits_path = os.path.join(RAW, "image-credits.json")
    credits = json.load(open(credits_path, encoding="utf-8")) if os.path.exists(credits_path) else {}
    for r in records:
        out, d = [], os.path.join(IMG, r["id"])
        os.makedirs(d, exist_ok=True)
        for n, title in enumerate(r.get("images", []), 1):
            big, small = os.path.join(d, f"{n}.jpg"), os.path.join(d, f"{n}-sm.jpg")
            meta = info.get(title) or credits.get(title)
            if not meta:
                err(r["id"], f"image not found on Commons: {title}")
                continue
            if not re.search(r"cc0|cc[- ]by|public domain|pd|attribution|fal", meta["license"], re.I):
                err(r["id"], f"non-free licence {meta['license']!r}: {title}")
                continue
            key = f"{r['id']}/{n}"
            if not (os.path.exists(big) and credits.get(title, {}).get("key") == key):
                try:
                    w, h = save_variants(fetch(meta["thumb"]), big, small)
                    time.sleep(0.4)
                except Exception as e:
                    err(r["id"], f"download failed {title}: {e}")
                    continue
            else:
                w, h = Image.open(big).size
            credits[title] = {**meta, "key": key}
            out.append({"src": f"img/{r['id']}/{n}.jpg", "sm": f"img/{r['id']}/{n}-sm.jpg", "w": w, "h": h,
                        "title": title.replace("File:", "").rsplit(".", 1)[0],
                        "author": meta["author"], "license": meta["license"],
                        "licenseUrl": meta.get("licenseUrl", ""), "page": meta.get("page", "")})
        if out:
            out[0]["lqip"], out[0]["color"] = lqip(os.path.join(ROOT, out[0]["src"]))
        r["images"] = out
        if len(out) < 3:
            err(r["id"], f"only {len(out)} usable images after download")
    json.dump(credits, open(credits_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    payload = {"builtAt": time.strftime("%Y-%m-%d"), "destinations": records, "airports": airports,
               "origins": ORIGINS, "pricing": pricing}
    js = "window.PP_DATA = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"
    open(os.path.join(ROOT, "data", "destinations.js"), "w", encoding="utf-8").write(js)

    sys.stdout.reconfigure(encoding="utf-8")
    print(f"{len(records)} destinations, {sum(len(r['images']) for r in records)} images, {len(airports)} airports")
    print(f"data/destinations.js {len(js) // 1024} KB")
    for w in warnings:
        print("WARN ", w)
    for e in errors:
        print("ERROR", e)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
