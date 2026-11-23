#!/usr/bin/env python3
"""Build src/data/metro.json from the BMRCL GTFS feed, KML station dump and fare tables.
Run: python3 -I scripts/extract.py <gtfs_dir> <stations.kml> <codes.csv> <out.json>"""
import csv, json, sys, re, statistics, collections, math
import xml.etree.ElementTree as ET
gtfs, kml, codes_csv, out = sys.argv[1:5]
def rd(n): return list(csv.DictReader(open(f"{gtfs}/{n}.txt", encoding="utf-8-sig")))
stops = rd("stops"); routes = rd("routes"); trips = rd("trips")
trans = rd("translations")
kn = {t["record_id"]: t["translation"] for t in trans if t["table_name"]=="stops" and t["language"]=="kn"}
parents = {s["stop_id"]: s for s in stops if s["location_type"]=="1"}
plat2par = {s["stop_id"]: s["parent_station"] for s in stops if s["parent_station"] and s["location_type"] in ("0","")}
def tsec(t): h,m,s=map(int,t.split(":")); return h*3600+m*60+s
# stop_times -> per trip sequence
st = collections.defaultdict(list)
for r in csv.DictReader(open(f"{gtfs}/stop_times.txt", encoding="utf-8")):
    st[r["trip_id"]].append((int(r["stop_sequence"]), plat2par.get(r["stop_id"], r["stop_id"]), tsec(r["arrival_time"]), tsec(r["departure_time"]), float(r["shape_dist_traveled"] or 0)))
for k in st: st[k].sort()
tripinfo = {t["trip_id"]: t for t in trips}
# line order: longest trip per route/direction
lines = {}
for r in routes:
    rid = r["route_id"]
    best = None
    for tid, t in tripinfo.items():
        if t["route_id"]==rid and t["service_id"]=="weekday":
            if best is None or len(st[tid])>len(st[best]): best = tid
    seq = [x[1] for x in st[best]]
    # dedupe consecutive
    order=[]; 
    for s in seq:
        if not order or order[-1]!=s: order.append(s)
    # segment stats from all weekday trips in same direction as best
    d = tripinfo[best]["direction_id"]
    seg = collections.defaultdict(lambda: {"sec":[],"km":[]})
    for tid,t in tripinfo.items():
        if t["route_id"]!=rid: continue
        s = st[tid]
        for a,b in zip(s,s[1:]):
            if a[1]==b[1]: continue
            key = tuple(sorted((a[1],b[1])))
            if t["direction_id"]==d or True:
                seg[key]["sec"].append(b[2]-a[3] + 0)  # run time between departure and arrival
                seg[key]["km"].append(b[4]-a[4])
    segments=[]
    for a,b in zip(order,order[1:]):
        key=tuple(sorted((a,b))); v=seg[key]
        segments.append({"from":a,"to":b,"km":round(statistics.median(v["km"]),3),"sec":int(round(statistics.median(v["sec"])))})
    dwell = []
    for tid,t in tripinfo.items():
        if t["route_id"]==rid:
            for x in st[tid][1:-1]: dwell.append(x[3]-x[2])
    # headways at first station of line on weekday per hour bucket
    first = order[0]
    deps = sorted(x[3] for tid,t in tripinfo.items() if t["route_id"]==rid and t["service_id"]=="weekday" and t["direction_id"]==d for x in st[tid][:1])
    def hw(lo,hi):
        ds=[x for x in deps if lo*3600<=x<hi*3600]; gaps=[b-a for a,b in zip(ds,ds[1:]) if b-a>0]
        return int(round(statistics.median(gaps))) if gaps else None
    # shape geometry
    lines[rid] = {"id":rid,"name":r["route_short_name"],"longName":r["route_long_name"],"color":"#"+r["route_color"],
      "textColor":"#"+(r["route_text_color"] or "000000"),"stations":order,"segments":segments,
      "dwellSec":int(round(statistics.median(dwell))) if dwell else 25,
      "headwaySec":{"peak":hw(8,12) or hw(16,21),"offpeak":hw(12,16)},"_shape":tripinfo[best]["shape_id"]}
shapes = collections.defaultdict(list)
for r in csv.DictReader(open(f"{gtfs}/shapes.txt")): shapes[r["shape_id"]].append((int(r["shape_pt_sequence"]), round(float(r["shape_pt_lat"]),5), round(float(r["shape_pt_lon"]),5)))
for l in lines.values():
    l["geometry"] = [[a,b] for _,a,b in sorted(shapes[l.pop("_shape")])]
# station membership
mem = collections.defaultdict(list)
for l in lines.values():
    for s in l["stations"]: mem[s].append(l["id"])
# KML (Kannada / alias / wheelchair) keyed by code
ns={"k":"http://www.opengis.net/kml/2.2"}
kml_by_code={}
for pm in ET.parse(kml).getroot().iter("{http://www.opengis.net/kml/2.2}Placemark"):
    d={x.get("name"):(x.find("k:value",ns).text if x.find("k:value",ns) is not None else "") for x in pm.iter("{http://www.opengis.net/kml/2.2}Data")}
    if d.get("code"): kml_by_code[d["code"]]=d
code_alias = collections.defaultdict(set)
for r in csv.DictReader(open(codes_csv)): code_alias[r["name"].split(",")[0].strip().lower()].add(r["code"])
stations={}
for sid,p in parents.items():
    if sid not in mem: continue
    k = kml_by_code.get(sid,{})
    al=set()
    for key in ("alt_name","old_name","short_name"):
        if k.get(key): al.add(k[key])
    al |= {c for c in code_alias.get(p["stop_name"].split(",")[0].strip().lower(),[]) if c!=sid}
    stations[sid]={"id":sid,"code":sid,"name":p["stop_name"],"kn":kn.get(sid) or k.get("name:kn") or "","lat":float(p["stop_lat"]),"lon":float(p["stop_lon"]),
      "lines":mem[sid],"interchange":len(mem[sid])>1,"wheelchair":p["wheelchair_boarding"]=="1","aliases":sorted(al)}
# transfers
tr={}
for r in rd("transfers"):
    s=plat2par.get(r["from_stop_id"]); tr[s]=int(r["min_transfer_time"])
# fares (token table; pairs)
fares={}
fa={r["fare_id"]:int(float(r["price"])) for r in rd("fare_attributes")}
for r in rd("fare_rules"):
    o,d=r["origin_id"],r["destination_id"]
    fares.setdefault(o,{})[d]=fa[r["fare_id"]]
fare_out={o:{d:v for d,v in m.items()} for o,m in fares.items()}
json.dump({"generatedFrom":"BMRCL GTFS (Vonter, feed 2026-08-17) + OSM KML + BMRCL fare chart 14.02.2025","lines":lines,"stations":stations,"transferSeconds":tr,"fares":fare_out,
  "holidays":[l.strip() for l in open(f"{gtfs}/../bmrcl-gtfs-main/data/holidays.txt") if l.strip()]},open(out,"w"),ensure_ascii=False,separators=(",",":"))
print(len(stations),"stations;",{k:len(v["stations"]) for k,v in lines.items()},"transfers",tr)
print({k:(v["headwaySec"],v["dwellSec"]) for k,v in lines.items()})
