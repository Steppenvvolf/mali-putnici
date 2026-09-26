"""Search Wikimedia Commons for freely licensed, high-resolution photos.

Usage:
  python commons_search.py "Efteling Droomvlucht"            # full-text search
  python commons_search.py --cat "Category:Efteling"          # files in a category
  python commons_search.py --check "File:A.jpg" "File:B.jpg"  # verify exact titles

Prints one line per usable file:  WIDTHxHEIGHT | LICENSE | TITLE | short description
Only files that are >= 1600 px wide, JPEG/PNG/WebP and under a free licence are shown.
"""
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://commons.wikimedia.org/w/api.php"
UA = "MaliPutnici/1.0 (static family-travel site; image credit collection)"
FREE = re.compile(r"^(cc0|cc[- ]by|cc[- ]by[- ]sa|public domain|pd|attribution|fal)", re.I)
MIN_W = 1600


def api(params):
    params = {"action": "query", **params, "format": "json", "formatversion": "2"}
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    last = None
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            # 429 = rate limited; back off and retry. Other 4xx/5xx: brief retry too.
            last = e
            if e.code == 429:
                time.sleep(2 + attempt * 4)
            else:
                time.sleep(1 + attempt)
        except Exception as e:
            last = e
            time.sleep(1 + attempt)
    raise RuntimeError(f"Commons API unreachable: {last}")


def strip_html(s):
    return re.sub(r"<[^>]+>", "", s or "").strip()


def info_for(generator_params):
    data = api({
        **generator_params,
        "prop": "imageinfo",
        "iiprop": "size|mime|extmetadata",
        "iiextmetadatafilter": "LicenseShortName|ImageDescription|Artist",
    })
    out = []
    for p in data.get("query", {}).get("pages", []):
        if p.get("missing"):
            out.append((None, p.get("title")))
            continue
        ii = (p.get("imageinfo") or [{}])[0]
        meta = ii.get("extmetadata", {})
        lic = strip_html(meta.get("LicenseShortName", {}).get("value", ""))
        desc = strip_html(meta.get("ImageDescription", {}).get("value", ""))[:90].replace("\n", " ")
        out.append(({
            "title": p["title"], "w": ii.get("width", 0), "h": ii.get("height", 0),
            "mime": ii.get("mime", ""), "license": lic, "desc": desc,
        }, p["title"]))
    return out


def usable(f):
    return (f["w"] >= MIN_W and f["mime"] in ("image/jpeg", "image/png", "image/webp")
            and FREE.search(f["license"] or "") and f["w"] >= f["h"] * 0.9)


def show(results, check=False):
    shown = 0
    for f, title in results:
        if f is None:
            print(f"MISSING | {title}")
            continue
        ok = usable(f)
        if check or ok:
            flag = "" if ok else "  <-- NOT USABLE (size/licence/portrait)"
            print(f"{f['w']}x{f['h']} | {f['license']} | {f['title']} | {f['desc']}{flag}")
            shown += 1
    if not shown:
        print("(no usable results - try a different query, a category, or the English/local name)")


def main(argv):
    if not argv:
        print(__doc__)
        return
    if argv[0] == "--check":
        titles = [t if t.startswith("File:") else "File:" + t for t in argv[1:]]
        for i in range(0, len(titles), 40):
            show(info_for({"titles": "|".join(titles[i:i + 40])}), check=True)
    elif argv[0] == "--cat":
        cat = argv[1] if argv[1].startswith("Category:") else "Category:" + argv[1]
        show(info_for({"generator": "categorymembers", "gcmtitle": cat,
                       "gcmtype": "file", "gcmlimit": "50"}))
    else:
        show(info_for({"generator": "search", "gsrsearch": " ".join(argv),
                       "gsrnamespace": "6", "gsrlimit": "40"}))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1:])
