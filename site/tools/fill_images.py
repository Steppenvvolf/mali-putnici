"""Fill missing images for every destination in data/raw/batch-*.json.

For any record with fewer than 3 images, search Wikimedia Commons (rate-limited)
using the destination name and highlights, pick the best landscape free-licence
photos, and write the verified titles back into the batch files.

Run: python tools/fill_images.py [--all]   (--all also re-fills records that already have images)
"""
import glob
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
UA = "MaliPutnici/1.0 (static family-travel site; image credit collection)"
API = "https://commons.wikimedia.org/w/api.php"
FREE = re.compile(r"^(cc0|cc[- ]by|cc[- ]by[- ]sa|public domain|pd|attribution|fal)", re.I)
MIN_W = 1600
WANT = 5  # aim for this many per destination
BAD_DESC = re.compile(r"\b(map|logo|plan|sign|ticket|stamp|coat of arms|flag|symbol|icon)\b", re.I)


def api(params):
    params = {"action": "query", **params, "format": "json", "formatversion": "2"}
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    last = None
    for attempt in range(7):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            last = e
            time.sleep(3 + attempt * 5)
        except Exception as e:
            last = e
            time.sleep(2 + attempt * 3)
    raise RuntimeError(f"Commons unreachable: {last}")


def strip_html(s):
    s = re.sub(r"<[^>]+>", "", s or "")
    return re.sub(r"\s+", " ", s).strip()


def gather(gparams):
    data = api({
        **gparams,
        "prop": "imageinfo",
        "iiprop": "size|mime|extmetadata",
        "iiextmetadatafilter": "LicenseShortName|ImageDescription|Artist",
    })
    out = []
    for p in data.get("query", {}).get("pages", []):
        if p.get("missing"):
            continue
        ii = (p.get("imageinfo") or [{}])[0]
        meta = ii.get("extmetadata", {})
        lic = strip_html(meta.get("LicenseShortName", {}).get("value", ""))
        desc = strip_html(meta.get("ImageDescription", {}).get("value", ""))[:160]
        w, h = ii.get("width", 0), ii.get("height", 0)
        if w >= MIN_W and w >= h * 0.9 and (ii.get("mime") in ("image/jpeg", "image/png", "image/webp")) and FREE.search(lic):
            out.append({"title": p["title"], "w": w, "h": h, "license": lic, "desc": desc})
    return out


def search(q):
    time.sleep(1.2)
    return gather({"generator": "search", "gsrsearch": q, "gsrnamespace": "6", "gsrlimit": "40"})


def cat(name):
    time.sleep(1.2)
    return gather({"generator": "categorymembers", "gcmtitle": "Category:" + name, "gcmtype": "file", "gcmlimit": "60"})


def keywords(rec):
    """Build search queries from the record: name + highlights + local name."""
    name = rec["name"].get("en", "")
    sr = rec["name"].get("sr", "")
    hs = [h.get("en", "") for h in rec.get("highlights", [])]
    out = []
    if name:
        out.append(name)
    # first highlight, cleaned (drop anything after a colon/comma, keep first ~4 words)
    for h in hs[:3]:
        t = re.split(r"[,:]", h)[0].strip()
        t = " ".join(t.split()[:5])
        if t and t.lower() not in name.lower():
            out.append(name + " " + t)
    if sr and sr.lower() != name.lower() and len(sr) > 2:
        out.append(sr)
    return out[:5]


def pick(cands):
    """Order candidates best-first and de-dupe near-identical titles."""
    seen = set()
    def base_title(t):
        t = re.sub(r"^File:", "", t)
        t = re.sub(r"\.(jpe?g|png|webp|tif|tiff)$", "", t, flags=re.I)
        t = re.sub(r"\s*\(\d+\)\s*$", "", t)  # trailing (1) (2)
        return t.lower().strip()
    scored = []
    for c in cands:
        ratio = c["w"] / c["h"]
        # penalise extreme panoramas and near-squares
        ratio_pen = abs(ratio - 1.7)
        if ratio > 3.2 or ratio < 1.1:
            ratio_pen += 3
        # penalise boring descriptions
        desc_pen = 2 if BAD_DESC.search(c["desc"]) else 0
        # bonus for large images (cap at 4000)
        size = min(c["w"], 4000) / 4000
        score = size * 2.0 - ratio_pen * 0.5 - desc_pen
        scored.append((score, c))
    scored.sort(key=lambda x: -x[0])
    out = []
    for score, c in scored:
        bt = base_title(c["title"])
        if bt in seen:
            continue
        seen.add(bt)
        out.append(c["title"])
        if len(out) >= WANT:
            break
    return out


def fill_record(rec, force):
    cur = rec.get("images") or []
    if len(cur) >= 3 and not force:
        return 0
    cands = []
    for q in keywords(rec):
        try:
            cands.extend(search(q))
        except Exception as e:
            print(f"  ! search failed '{q}': {e}")
    # Category fallback for proper-noun attractions
    name = rec["name"].get("en", "")
    if name and len(cands) < 6 and re.search(r"[A-Z][a-z]{3,}", name):
        try:
            cands.extend(cat(name))
        except Exception:
            pass
    titles = pick(cands)
    rec["images"] = titles
    return len(titles)


def main():
    force = "--all" in sys.argv
    files = sorted(glob.glob(os.path.join(RAW, "batch-*.json")))
    total = filled = 0
    for f in files:
        data = json.load(open(f, encoding="utf-8"))
        changed = False
        for rec in data:
            n = fill_record(rec, force)
            total += 1
            if n:
                filled += 1
                changed = True
                print(f"  {rec['id']}: {n} images -> {rec['images']}")
        if changed:
            json.dump(data, open(f, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"{os.path.basename(f)}: {len(data)} records saved")
    print(f"\nDone. {filled}/{total} destinations got images (target {WANT}).")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
