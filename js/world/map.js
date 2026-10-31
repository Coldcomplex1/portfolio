import { SAIGON } from '../data/saigon.js';

/* The land, roads and buildings of the real city, packed by tools/build_map.py.
   Map data © OpenStreetMap contributors, ODbL. */

const [LAT0, LON0] = SAIGON.origin;
const KX = Math.cos((LAT0 * Math.PI) / 180) * 11132, KZ = 11057.4;

/* latitude and longitude to world units: ten metres each, north is −z */
export const project = (lat, lon) => ({ x: (lon - LON0) * KX, z: -(lat - LAT0) * KZ });

export async function loadMap() {
  const res = await fetch('data/map.bin');
  if (!res.ok) throw new Error(`map.bin: ${res.status}`);
  const buf = await res.arrayBuffer();
  const view = (name, Type) => {
    const [offset, length] = SAIGON.table[name];
    return new Type(buf, offset, length);
  };
  return {
    quant: SAIGON.quant,
    landXZ: view('landXZ', Int16Array), landRingN: view('landRingN', Uint32Array), landPolyN: view('landPolyN', Uint16Array),
    roadXZ: view('roadXZ', Int16Array), roadN: view('roadN', Uint16Array), roadC: view('roadC', Uint8Array),
    railXZ: view('railXZ', Int16Array), railN: view('railN', Uint16Array),
    bldXZ: view('bldXZ', Int16Array), bldN: view('bldN', Uint8Array), bldH: view('bldH', Uint16Array),
    hsXZ: view('hsXZ', Int16Array), hsWDYH: view('hsWDYH', Uint8Array),
  };
}

/* walks every polyline: fn(class, flat coordinate array, start index, point count) */
export function eachRoad(map, fn) {
  let at = 0;
  for (let i = 0; i < map.roadN.length; i++) {
    const n = map.roadN[i];
    fn(map.roadC[i], map.roadXZ, at, n);
    at += n * 2;
  }
}
