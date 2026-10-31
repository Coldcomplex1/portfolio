#!/usr/bin/env python3
"""Turns raw OpenStreetMap extracts of Saigon into the small files the site loads.

    python3 tools/build_map.py <folder with water.json, roads.json, rail.json, buildings.json>

Writes data/map.json (river course, landmarks, section table) and data/map.bin
(land, roads, buildings). One world unit is ten metres, north is -z, east is +x.
Map data (c) OpenStreetMap contributors, ODbL.
"""
import heapq, json, math, os, struct, sys

import contourpy
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

RAW = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
DEBUG = os.environ.get('MAP_DEBUG')

LAT0, LON0 = 10.78, 106.71
KX = math.cos(math.radians(LAT0)) * 111320 / 10
KZ = 110574 / 10
QUANT = 4                      # stored coordinates are quarter units, 2.5 m


def project(lat, lon):
    return (lon - LON0) * KX, -(lat - LAT0) * KZ


def geom(way):
    return [project(p['lat'], p['lon']) for p in way['geometry'] if p]


def area(ring):
    a = 0.0
    for (x0, z0), (x1, z1) in zip(ring, ring[1:] + ring[:1]):
        a += x0 * z1 - x1 * z0
    return a / 2


def join_rings(parts):
    """Stitches the member ways of a relation into closed rings."""
    parts = [list(p) for p in parts if len(p) > 1]
    rings = []
    while parts:
        ring = parts.pop()
        grew = True
        while grew and ring[0] != ring[-1]:
            grew = False
            for i, p in enumerate(parts):
                if p[0] == ring[-1]:
                    ring += p[1:]
                elif p[-1] == ring[-1]:
                    ring += p[-2::-1]
                elif p[-1] == ring[0]:
                    ring = p[:-1] + ring
                elif p[0] == ring[0]:
                    ring = p[:0:-1] + ring
                else:
                    continue
                parts.pop(i)
                grew = True
                break
        rings.append(ring)
    return rings


def simplify(pts, tol):
    """Douglas-Peucker on an open polyline, iterative so long rivers cannot overflow the stack."""
    pts = np.asarray(pts, dtype=np.float64)
    keep = np.zeros(len(pts), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        seg = pts[b] - pts[a]
        n = math.hypot(*seg) or 1e-9
        rel = pts[a + 1:b] - pts[a]
        d = np.abs(rel[:, 0] * seg[1] - rel[:, 1] * seg[0]) / n
        i = int(np.argmax(d))
        if d[i] > tol:
            m = a + 1 + i
            keep[m] = True
            stack += [(a, m), (m, b)]
    return pts[keep]


def simplify_ring(r, tol):
    r = np.asarray(r)
    if len(r) > 1 and np.allclose(r[0], r[-1]):
        r = r[:-1]
    if len(r) < 4:
        return r
    far = int(np.argmax(((r - r[0]) ** 2).sum(1)))
    a = simplify(r[:far + 1], tol)
    b = simplify(np.vstack([r[far:], r[:1]]), tol)
    return np.vstack([a[:-1], b[:-1]])


# ---------------------------------------------------------------- water
RES = 0.8                      # 8 m a pixel
X0, X1, Z0, Z1 = -1870.0, 2090.0, -2000.0, 2000.0
W, H = int((X1 - X0) / RES), int((Z1 - Z0) / RES)
to_px = lambda p: ((p[0] - X0) / RES, (p[1] - Z0) / RES)


def rasterise_water():
    doc = json.load(open(os.path.join(RAW, 'water.json')))
    img = Image.new('L', (W, H), 0)
    draw = ImageDraw.Draw(img)
    holes = []
    minor = {'pond', 'fishpond', 'reservoir', 'basin', 'lagoon', 'wastewater'}
    for e in doc['elements']:
        t = e.get('tags', {})
        if e['type'] == 'way' and t.get('waterway') in ('canal', 'river') and 'geometry' in e:
            draw.line([to_px(p) for p in geom(e)], fill=1, width=5 if t['waterway'] == 'river' else 3)
            continue
        if e['type'] == 'way' and 'geometry' in e and t.get('waterway') != 'stream':
            ring = geom(e)
            if len(ring) >= 4 and ring[0] == ring[-1]:
                if t.get('water') in minor and abs(area(ring)) < 20:      # 2 hectares
                    continue
                draw.polygon([to_px(p) for p in ring], fill=1)
        elif e['type'] == 'relation':
            outers = [geom(m) for m in e['members'] if m.get('role') == 'outer' and 'geometry' in m]
            inners = [geom(m) for m in e['members'] if m.get('role') == 'inner' and 'geometry' in m]
            for ring in join_rings(outers):
                if len(ring) >= 4 and ring[0] == ring[-1]:
                    draw.polygon([to_px(p) for p in ring], fill=1)
            holes += [r for r in join_rings(inners) if len(r) >= 4 and r[0] == r[-1]]
    for ring in holes:
        draw.polygon([to_px(p) for p in ring], fill=0)
    mask = np.asarray(img, dtype=bool)
    labels, n = ndimage.label(mask)
    sizes = ndimage.sum(mask, labels, range(1, n + 1))
    mask = np.isin(labels, 1 + np.flatnonzero(sizes >= 300))
    return mask


def land_polygons(mask):
    land = ndimage.gaussian_filter((~mask).astype(np.float32), 1.1)
    land[0, :] = land[-1, :] = land[:, 0] = land[:, -1] = 1
    gen = contourpy.contour_generator(z=land, fill_type=contourpy.FillType.OuterOffset)
    pts, offs = gen.filled(0.5, 2.0)
    out = []
    for p, o in zip(pts, offs):
        rings = []
        for a, b in zip(o[:-1], o[1:]):
            r = p[a:b] * RES + (X0, Z0)
            r = simplify_ring(r, 0.45)
            if len(r) >= 3 and (not rings or abs(area([tuple(q) for q in r])) > 30):
                rings.append(r)
        if rings and abs(area([tuple(q) for q in rings[0]])) > 120:
            out.append(rings)
    return out


def river_course(mask, start, end):
    """The deepest line through the water from one point to another."""
    S = 3
    m = mask[::S, ::S]
    dist = ndimage.distance_transform_edt(m)
    step = RES * S
    snap = lambda p: (int((p[1] - Z0) / step), int((p[0] - X0) / step))
    def nearest(rc):
        r, c = rc
        win = dist[r - 24:r + 24, c - 24:c + 24]
        i = np.unravel_index(np.argmax(win), win.shape)
        return r - 24 + i[0], c - 24 + i[1]
    a, b = nearest(snap(start)), nearest(snap(end))
    best = {a: 0.0}
    came = {}
    q = [(0.0, a)]
    N8 = [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]
    while q:
        c, u = heapq.heappop(q)
        if u == b:
            break
        if c > best.get(u, 1e18):
            continue
        for dr, dc in N8:
            v = (u[0] + dr, u[1] + dc)
            if not (0 <= v[0] < m.shape[0] and 0 <= v[1] < m.shape[1]) or not m[v]:
                continue
            w = c + math.hypot(dr, dc) * (1 + 60.0 / (dist[v] ** 2 + 0.5))
            if w < best.get(v, 1e18):
                best[v] = w
                came[v] = u
                heapq.heappush(q, (w, v))
    path = [b]
    while path[-1] != a:
        path.append(came[path[-1]])
    path.reverse()
    xy = np.array([(c * step + X0, r * step + Z0) for r, c in path])
    hw = np.array([dist[r, c] * step for r, c in path])
    xy = ndimage.gaussian_filter1d(xy, 14, axis=0, mode='nearest')
    hw = ndimage.gaussian_filter1d(hw, 22, mode='nearest')
    seg = np.hypot(*np.diff(xy, axis=0).T)
    s = np.concatenate([[0], np.cumsum(seg)])
    u = np.arange(0, s[-1], 4.0)
    return np.stack([np.interp(u, s, xy[:, 0]), np.interp(u, s, xy[:, 1]), np.interp(u, s, hw)], 1)


# ---------------------------------------------------------------- roads
CLASS = {
    'motorway': 0, 'trunk': 0, 'motorway_link': 0, 'trunk_link': 0,
    'primary': 1, 'primary_link': 1,
    'secondary': 2, 'secondary_link': 2,
    'tertiary': 3, 'tertiary_link': 3,
    'unclassified': 4, 'residential': 4, 'living_street': 4, 'pedestrian': 4,
}
BRIDGE = 8                     # flag on a road class: this way is carried over water
HAND_BUILT = ('Cầu Phú Mỹ', 'Cầu Ba Son')


def over_water(mask, pts):
    px = ((np.asarray(pts) - (X0, Z0)) / RES).astype(int)
    return mask[np.clip(px[:, 1], 0, H - 1), np.clip(px[:, 0], 0, W - 1)]


def roads(mask):
    doc = json.load(open(os.path.join(RAW, 'roads.json')))
    out = []
    for e in doc['elements']:
        t = e['tags']
        cls = CLASS.get(t.get('highway'))
        if cls is None or t.get('tunnel') in ('yes', 'building_passage'):
            continue
        name = t.get('name', '')
        if any(n in name for n in HAND_BUILT):
            continue
        pts = simplify(geom(e), 0.35 if cls < 3 else 0.6)
        if 'bridge' in t:
            dense = np.vstack([np.linspace(a, b, 6) for a, b in zip(pts[:-1], pts[1:])]) if len(pts) > 1 else pts
            if over_water(mask, dense).any():
                cls |= BRIDGE
        out.append((cls, pts))
    return out


def crossing(mask, names, river):
    """Where a named road crosses the river: its centre, its bearing, and its width."""
    doc = json.load(open(os.path.join(RAW, 'roads.json')))
    hits = []
    for e in doc['elements']:
        if not any(n == e['tags'].get('name') for n in names):
            continue
        pts = np.array(geom(e))
        if len(pts) < 2:
            continue
        dense = np.vstack([np.linspace(a, b, 24) for a, b in zip(pts[:-1], pts[1:])])
        hits.append(dense[over_water(mask, dense)])
    all_pts = np.vstack(hits)
    d = np.sqrt(((all_pts[:, None, :] - river[:, None, :2].transpose(1, 0, 2)) ** 2).sum(2))
    near = d.min(1) < river[d.argmin(1), 2] * 1.4
    all_pts = all_pts[near]
    c = all_pts.mean(0)
    u, sv, vt = np.linalg.svd(all_pts - c)
    along = (all_pts - c) @ vt[0]
    return {'x': round(float(c[0]), 2), 'z': round(float(c[1]), 2),
            'ax': round(float(vt[0][0]), 4), 'az': round(float(vt[0][1]), 4),
            'span': round(float(along.max() - along.min()), 1)}


def rail():
    doc = json.load(open(os.path.join(RAW, 'rail.json')))
    out = []
    for e in doc['elements']:
        t = e['tags']
        if t.get('railway') == 'subway' or 'Metro' in t.get('name', '') or 'metro' in t.get('name', '').lower():
            if t.get('tunnel') == 'yes':
                continue
            out.append(simplify(geom(e), 0.3))
    return out


# ---------------------------------------------------------------- buildings
def levels(t):
    for key, k in (('height', 1.0), ('building:height', 1.0), ('building:levels', 3.6)):
        v = t.get(key)
        if v:
            try:
                return max(3.0, float(str(v).split()[0].replace(',', '.')) * k)
            except ValueError:
                pass
    return None


def buildings(mask, rng):
    doc = json.load(open(os.path.join(RAW, 'buildings.json')))
    out = []
    named = {}
    skipped = 0
    for e in doc['elements']:
        t = e.get('tags', {})
        n = t.get('name') or t.get('name:en')
        rings = []
        if e['type'] == 'way' and 'geometry' in e:
            rings = [geom(e)]
        elif e['type'] == 'relation' and 'members' in e:
            rings = join_rings([geom(m) for m in e['members'] if m.get('role') == 'outer' and 'geometry' in m])
        else:
            skipped += 1
        for ring in rings:
            if len(ring) < 4 or ring[0] != ring[-1]:
                continue
            a = abs(area(ring)) * 100                                  # square metres
            if a < 18:
                continue
            c = np.mean(ring[:-1], axis=0)
            if over_water(mask, [c])[0]:
                continue
            r = simplify_ring(ring, 0.16)
            tol = 0.3
            while len(r) > 12:
                r = simplify_ring(r, tol)
                tol *= 1.6
            if len(r) < 3:
                continue
            if area([tuple(q) for q in r]) < 0:                        # always the same winding
                r = r[::-1]
            h = levels(t)
            known = h is not None
            if h is None:
                big = min(1.0, a / 900)
                h = 7.5 + rng.random() * 10.5 + big * (rng.random() * 18)
            out.append((r, h / 10, known))
            if n:
                e0 = max(zip(r, np.roll(r, -1, axis=0)), key=lambda q: np.hypot(*(q[1] - q[0])))
                bearing = math.atan2(*(e0[1] - e0[0])[::-1])
                named.setdefault(n, []).append((round(float(c[0]), 1), round(float(c[1]), 1), round(h), round(a), round(bearing, 3)))
    print('buildings', len(out), 'skipped relations', skipped, 'with real heights', sum(b[2] for b in out),
          'over 60 m', sum(b[1] > 6 for b in out))
    return out, named


def fill_houses(mask, blds, road_list, rng, cap=85000):
    """The map records only some of the city's narrow houses. Wherever a street
    front is still empty near the journey, stand a row of tube houses on it."""
    S = 0.25                                                     # units a pixel
    cx0, cx1, cz0, cz1 = -780.0, 1000.0, -900.0, 900.0
    w, h = int((cx1 - cx0) / S), int((cz1 - cz0) / S)
    px = lambda p: ((p[0] - cx0) / S, (p[1] - cz0) / S)
    img = Image.new('1', (w, h), 0)
    draw = ImageDraw.Draw(img)
    half = [1.8, 1.4, 1.0, 0.7, 0.42]
    for r, _, _ in blds:
        draw.polygon([px(q) for q in r], fill=1)
    for c, pts in road_list:
        draw.line([px(q) for q in pts], fill=1, width=max(1, int(2 * half[c & 7] / S)))
    occ = np.asarray(img, dtype=np.uint8).copy()
    wm = mask[((np.arange(h) * S + cz0 - Z0) / RES).astype(int)][:, ((np.arange(w) * S + cx0 - X0) / RES).astype(int)]
    occ[wm] = 1
    focus = [(-340.0, 230.0, 560.0), (40.0, 40.0, 300.0)]
    out = []
    for c, pts in road_list:
        cls = c & 7
        if c >= BRIDGE or cls == 0:
            continue
        for side in (-1, 1):
            carry = rng.random()
            for a, b in zip(pts[:-1], pts[1:]):
                seg = b - a
                l = float(np.hypot(*seg))
                if l < 0.6:
                    continue
                t = seg / l
                n = np.array([-t[1], t[0]]) * side
                while carry < l:
                    wide = 0.46 + rng.random() * 0.3
                    deep = 1.2 + rng.random() * 1.1
                    mid = a + t * carry
                    carry += wide + 0.02
                    if carry >= l:
                        break
                    if not any((mid[0] - fx) ** 2 + (mid[1] - fz) ** 2 < fr * fr for fx, fz, fr in focus):
                        continue
                    centre = mid + n * (half[cls] + 0.14 + deep / 2) + t * (wide / 2)
                    i0, j0 = px(centre)
                    samples = [(centre + t * dt * wide / 2 + n * dn * deep / 2) for dt in (-0.95, 0, 0.95) for dn in (-0.95, 0, 0.95)]
                    ok = True
                    for q in samples:
                        ii, jj = px(q)
                        ii, jj = int(ii), int(jj)
                        if not (0 <= ii < w and 0 <= jj < h) or occ[jj, ii]:
                            ok = False
                            break
                    if not ok:
                        continue
                    corners = [centre + t * dt * wide / 2 + n * dn * deep / 2 for dt, dn in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
                    jj0, jj1 = int(min(px(q)[1] for q in corners)), int(max(px(q)[1] for q in corners)) + 1
                    ii0, ii1 = int(min(px(q)[0] for q in corners)), int(max(px(q)[0] for q in corners)) + 1
                    occ[max(0, jj0):jj1, max(0, ii0):ii1] = 1
                    floors = 2 + int(rng.random() ** 1.6 * 5)
                    out.append((centre[0], centre[1], wide, deep, math.atan2(t[1], t[0]), floors * 0.34 + 0.25))
                    if len(out) >= cap:
                        return out
                carry -= l
    return out


def junction_graph(centre, radius):
    """The real streets around a junction, as vertices and weighted edges."""
    doc = json.load(open(os.path.join(RAW, 'roads.json')))
    ways, uses = [], {}
    for e in doc['elements']:
        t = e['tags']
        if t.get('highway') not in CLASS or t.get('tunnel') == 'yes':
            continue
        pts = [(p['lat'], p['lon']) for p in e['geometry']]
        ways.append(pts)
        for i, p in enumerate(pts):
            uses[p] = uses.get(p, 0) + (2 if i in (0, len(pts) - 1) else 1)
    verts, edges = {}, []

    def vid(p):
        return verts.setdefault(p, len(verts))

    cx, cz = centre
    inside = lambda p: math.hypot(project(*p)[0] - cx, project(*p)[1] - cz) < radius
    for pts in ways:
        run = [pts[0]]
        for p in pts[1:]:
            run.append(p)
            if uses[p] >= 2:
                if inside(run[0]) and inside(run[-1]) and run[0] != run[-1]:
                    line = [project(*q) for q in run]
                    length = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(line, line[1:])) * 10
                    edges.append((vid(run[0]), vid(run[-1]), round(length), simplify(line, 0.12)))
                run = [p]
    # the largest connected piece only, with dead ends trimmed
    adj = {}
    for k, (a, b, _, _) in enumerate(edges):
        adj.setdefault(a, []).append(k)
        adj.setdefault(b, []).append(k)
    seen, best = set(), []
    for v in adj:
        if v in seen:
            continue
        stack, comp = [v], []
        seen.add(v)
        while stack:
            u = stack.pop()
            comp.append(u)
            for k in adj[u]:
                a, b = edges[k][0], edges[k][1]
                w = b if a == u else a
                if w not in seen:
                    seen.add(w)
                    stack.append(w)
        if len(comp) > len(best):
            best = comp
    keep = set(best)
    edges = [e for e in edges if e[0] in keep and e[1] in keep]
    pts = {v: project(*p) for p, v in verts.items() if v in keep}
    renum = {v: i for i, v in enumerate(sorted(keep))}
    vs = [0.0] * (2 * len(renum))
    for v, i in renum.items():
        vs[2 * i], vs[2 * i + 1] = round(pts[v][0], 2), round(pts[v][1], 2)
    def corner(dx, dz):
        return max(renum.values(), key=lambda i: (vs[2 * i] - cx) * dx + (vs[2 * i + 1] - cz) * dz)
    return {
        'c': [round(cx, 2), round(cz, 2)], 'r': radius, 'v': vs,
        'e': [[renum[a], renum[b], l, [round(float(x), 2) for x in line.ravel()]] for a, b, l, line in edges],
        'start': corner(-0.8, 0.6), 'end': corner(0.8, -0.6),
    }


def named_streets(names):
    doc = json.load(open(os.path.join(RAW, 'roads.json')))
    out = []
    for e in doc['elements']:
        if e['tags'].get('name') in names:
            out.append([round(float(v), 1) for v in simplify(geom(e), 0.3).ravel()])
    return out


def place(named, name):
    x, z, h, a, bearing = max(named[name], key=lambda v: v[3])
    return {'x': x, 'z': z, 'bearing': bearing}


def write(polys, road_list, rail_list, blds, houses, river, sites, streets):
    os.makedirs(OUT, exist_ok=True)
    blob = bytearray()
    table = {}

    def put(name, arr):
        while len(blob) % 4:
            blob.append(0)
        table[name] = [len(blob), int(arr.size)]
        blob.extend(arr.tobytes())

    q = lambda a: np.round(np.asarray(a) * QUANT).astype(np.int16).ravel()
    rings = [r for p in polys for r in p]
    put('landXZ', np.concatenate([q(r) for r in rings]))
    put('landRingN', np.array([len(r) for r in rings], np.uint32))
    put('landPolyN', np.array([len(p) for p in polys], np.uint16))
    put('roadXZ', np.concatenate([q(p) for _, p in road_list]))
    put('roadN', np.array([len(p) for _, p in road_list], np.uint16))
    put('roadC', np.array([c for c, _ in road_list], np.uint8))
    if rail_list:
        put('railXZ', np.concatenate([q(p) for p in rail_list]))
        put('railN', np.array([len(p) for p in rail_list], np.uint16))
    put('bldXZ', np.concatenate([q(r) for r, _, _ in blds]))
    put('bldN', np.array([len(r) for r, _, _ in blds], np.uint8))
    put('bldH', np.round(np.array([h for _, h, _ in blds]) * 10).astype(np.uint16))
    H = np.array(houses)
    put('hsXZ', np.round(H[:, :2] * QUANT).astype(np.int16).ravel())
    put('hsWDYH', np.stack([np.round(H[:, 2] * 200), np.round(H[:, 3] * 100),
                            np.round((H[:, 4] % math.tau) / math.tau * 255), np.round(H[:, 5] * 50)], 1).clip(0, 255).astype(np.uint8).ravel())
    with open(os.path.join(OUT, 'map.bin'), 'wb') as f:
        f.write(blob)
    meta = {
        'origin': [LAT0, LON0], 'quant': QUANT,
        'city': {'x0': round(project(0, 106.64)[0], 1), 'x1': round(project(0, 106.80)[0], 1),
                 'z0': round(project(10.86, 0)[1], 1), 'z1': round(project(10.70, 0)[1], 1)},
        'extent': [X0, X1, Z0, Z1],
        'river': [round(float(v), 1) for row in river for v in row],
        'sites': sites, 'streets': streets, 'table': table,
    }
    js = '/* Generated by tools/build_map.py from OpenStreetMap, (c) OpenStreetMap contributors, ODbL. */\n'
    js += 'export const SAIGON = ' + json.dumps(meta, ensure_ascii=False, separators=(',', ':')) + ';\n'
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'js', 'data', 'saigon.js')
    with open(root, 'w') as f:
        f.write(js)
    print('map.bin', round(len(blob) / 1e6, 2), 'MB; saigon.js', round(len(js) / 1e3, 1), 'KB')


if __name__ == '__main__':
    rng = np.random.default_rng(1975)
    mask = rasterise_water()
    polys = land_polygons(mask)
    print('land polygons', len(polys), 'rings', sum(len(p) for p in polys), 'points', sum(len(r) for p in polys for r in p))
    river = river_course(mask, project(10.712, 106.745), project(10.8205, 106.7155))
    print('river km', len(river) * 0.04)
    road_list = roads(mask)
    print('roads', len(road_list), 'points', sum(len(p) for _, p in road_list), 'bridges', sum(c >= BRIDGE for c, _ in road_list))
    rail_list = rail()
    print('metro ways', len(rail_list))
    blds, named = buildings(mask, rng)
    if DEBUG:
        json.dump(named, open(os.path.join(DEBUG, 'named.json'), 'w'), ensure_ascii=False, indent=0)
    sites = {
        'phuMy': crossing(mask, ['Cầu Phú Mỹ'], river),
        'baSon': crossing(mask, ['Cầu Ba Son'], river),
        'nhaRong': {'x': -37.0, 'z': 131.5},            # no footprint in the extract, placed by hand
        'bitexco': place(named, 'Bitexco Financial Tower'),
        'l81': place(named, 'Vincom Center'),
        'cathedral': place(named, 'Nhà thờ Đức Bà Sài Gòn'),
        'postOffice': place(named, 'Bưu điện Trung tâm Sài Gòn'),
        'benThanh': place(named, 'Chợ Bến Thành'),
    }
    print(sites)
    houses = fill_houses(mask, blds, road_list, rng)
    print('tube houses', len(houses))
    streets = named_streets(['Hải Thượng Lãn Ông', 'Lương Nhữ Học'])
    write(polys, road_list, rail_list, blds, houses, river, sites, streets)
    centre = project(10.7505, 106.6592)
    graph = junction_graph(centre, 44.0)
    print('junction graph', len(graph['v']) // 2, 'vertices', len(graph['e']), 'edges', 'start', graph['start'], 'end', graph['end'])
    js = '/* The real streets around the Chợ Lớn roundabout, from OpenStreetMap. Generated by tools/build_map.py. */\n'
    js += 'export const JUNCTION = ' + json.dumps(graph, ensure_ascii=False, separators=(',', ':')) + ';\n'
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'js', 'data', 'junction.js'), 'w') as f:
        f.write(js)
