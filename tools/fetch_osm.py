#!/usr/bin/env python3
"""Fetch one OpenStreetMap extract at a time from Overpass, backing off when it is busy."""
import json, os, subprocess, sys, time

OUT = sys.argv[1]
UA = 'saigon-portfolio-map-build/1.0 (personal student website; one-off extract)'
URL = 'https://overpass-api.de/api/interpreter'
B = '10.70,106.64,10.86,106.80'      # the city
W = '10.60,106.54,10.96,106.90'      # the water reaches further, for the view from the top

Q = {
    'water': f'''[out:json][timeout:170];(
      way["natural"="water"]({W}); relation["natural"="water"]({W});
      way["waterway"="riverbank"]({W}); relation["waterway"="riverbank"]({W});
      way["waterway"~"^(river|canal|stream)$"]({W});
    );out geom;''',
    'roads': f'''[out:json][timeout:170];
      way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|living_street|pedestrian)$"]({B});
      out geom;''',
    'rail': f'''[out:json][timeout:120];way["railway"~"^(subway|rail|light_rail)$"]({B});out geom;''',
    'buildings': f'''[out:json][timeout:170];(way["building"]({B}); relation["building"]({B}););out geom;''',
}

for name in sys.argv[2:]:
    path = os.path.join(OUT, name + '.json')
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        print(name, 'already here', os.path.getsize(path)); continue
    for attempt in range(6):
        try:
            r = subprocess.run(['curl', '-s', '-m', '230', '-A', UA, '-H', 'Accept: application/json',
                                '--data-urlencode', 'data=' + Q[name], URL], capture_output=True)
            raw = r.stdout
            if r.returncode != 0:
                raise RuntimeError(f'curl exit {r.returncode}')
            doc = json.loads(raw)
            if doc.get('remark') and not doc.get('elements'):
                raise RuntimeError(doc['remark'])
            with open(path, 'wb') as f:
                f.write(raw)
            print(name, 'ok', round(len(raw) / 1e6, 1), 'MB', len(doc['elements']), 'elements', flush=True)
            break
        except Exception as e:
            wait = 20 * 2 ** attempt
            print(name, 'attempt', attempt, 'failed', str(e)[:90], 'waiting', wait, flush=True)
            time.sleep(wait)
    else:
        print(name, 'GAVE UP', flush=True)
    time.sleep(8)
