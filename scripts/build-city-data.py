"""유럽 도시 데이터 합치기: 손으로 고른 관광 도시(data/cities.json) + 인구 10만 이상 도시(data/source/europe-cities-100k.tsv)
실행: python3 scripts/build-city-data.py
- 같은 나라에서 12km 안에 이미 있는 도시는 손으로 고른 쪽을 남김
- 선택 목록(data/city-menu.json)은 나라마다 '관광 도시(기존 순서)' → '나머지(인구 순)'
"""
import json, math, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
cities_p = root / "data/cities.json"
menu_p = root / "data/city-menu.json"
tsv_p = root / "data/source/europe-cities-100k.tsv"

cities = json.loads(cities_p.read_text())
menu = json.loads(menu_p.read_text())
curated_menu = menu.get("curated", menu["menu"])  # 처음 실행 때 기존 목록을 '관광 도시'로 보관


def km(a, b):
    r = 6371
    dla = math.radians(b[0] - a[0]); dlo = math.radians(b[1] - a[1])
    h = math.sin(dla / 2) ** 2 + math.cos(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.sin(dlo / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))

rows = []
for line in tsv_p.read_text().splitlines():
    if not line or line.startswith("#"):
        continue
    ko, en, cc, lat, lng, aps, region = line.split("|")
    rows.append(dict(ko=ko, en=en, cc=cc, lat=float(lat), lng=float(lng), airports=[a for a in aps.split(",") if a], region=region or en))

base = [c for c in cities["cities"] if not c.get("generated")]
added = []
for r in rows:
    dup = next((c for c in base + added if c["country"] == r["cc"] and (c["name"] == r["ko"] or km((c["lat"], c["lng"]), (r["lat"], r["lng"])) < 12)), None)
    if dup:
        if not dup["airports"] and r["airports"]:
            dup["airports"] = r["airports"]
        continue
    added.append({
        "name": r["ko"], "aliases": sorted({r["en"].lower(), r["ko"]}), "nameEn": r["en"], "country": r["cc"],
        "region": r["region"], "lat": r["lat"], "lng": r["lng"], "airports": r["airports"], "generated": True,
    })

cities["cities"] = base + added
cities["_note"] = ("유럽 도시 좌표·공항 정보. generated: true 는 scripts/build-city-data.py 가 인구 10만 이상 도시 목록에서 만든 항목입니다. "
                   "목록에 없는 도시는 화면에서 직접 입력하면 OpenStreetMap에서 찾습니다. region은 여행경보 지역 판정에 쓰는 주(州)·지역 이름입니다.")
cities_p.write_text(json.dumps(cities, ensure_ascii=False, indent=2))

by_cc = {}
for r in rows:
    by_cc.setdefault(r["cc"], [])
names_by_cc = {}
for c in base + added:
    names_by_cc.setdefault(c["country"], set()).add(c["name"])
order = {}
for cc, names in curated_menu.items():
    order[cc] = list(names)
for r in rows:
    lst = order.setdefault(r["cc"], [])
    # 중복 제거된 경우 손으로 고른 이름이 이미 목록에 있음
    match = next((c["name"] for c in base + added if c["country"] == r["cc"] and (c["name"] == r["ko"] or km((c["lat"], c["lng"]), (r["lat"], r["lng"])) < 12)), r["ko"])
    if match not in lst:
        lst.append(match)
menu["curated"] = curated_menu
menu["menu"] = order
menu_p.write_text(json.dumps(menu, ensure_ascii=False, indent=2))
print("도시", len(cities["cities"]), "(추가", len(added), ")", "선택 목록", sum(len(v) for v in order.values()), "나라", len(order))
