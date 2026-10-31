import * as THREE from 'three';

/* The moon hangs north-west of the river, above District 1 from the water. */
export const MOON_DIR = new THREE.Vector3(-0.72, 0.295, -0.7).normalize();

/* One fog for every material on the page. The colour object is shared by
   reference, so the scene fog and the custom shaders never drift apart. */
export const FOG = { color: new THREE.Color('#0e171c'), density: 0.0042 };
export const fogUniforms = {
  uFogColor: { value: FOG.color },
  uFogDensity: { value: FOG.density },
};

const v3 = (v) => `vec3(${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)})`;

export const FOG_GLSL = /* glsl */ `
#ifndef QUYET_FOG
#define QUYET_FOG
/* Height fog: thick on the water, thinning with altitude, so the view from
   the top of the tower still reaches the far side of the city. The average
   density along the ray has a closed form for an exponential atmosphere. */
float heightFog(vec3 camPos, vec3 wp, float density) {
  vec3 d = wp - camPos;
  float dist = length(d);
  float y0 = max(camPos.y, -1.0), y1 = max(wp.y, -1.0);
  float k0 = exp(-y0 / 11.0), k1 = exp(-y1 / 11.0);
  float dy = y1 - y0;
  float avg = abs(dy) > 0.05 ? (k0 - k1) * 11.0 / dy : k0;
  return 1.0 - exp(-density * dist * (0.22 + 0.78 * avg));
}
/* the haze glows warm toward the moon, and low along the horizon where
   the city lights it from underneath */
const vec3 MOON_DIR = ${v3(MOON_DIR)};
vec3 fogTint(vec3 col, vec3 dir) {
  float m = max(dot(dir, MOON_DIR), 0.0);
  float low = 1.0 - smoothstep(-0.02, 0.3, dir.y);
  return col + vec3(0.011, 0.0055, 0.002) * pow(m, 12.0) + vec3(0.009, 0.0048, 0.0017) * low;
}
#endif
`;

/* Swap three's fog chunks for the height fog, so built-in materials
   (lines, basic meshes) sit in the same air as the custom shaders. */
export function installFog() {
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying vec3 vFogWorld;\n#endif';
  C.fog_vertex = '#ifdef USE_FOG\n\tvFogWorld = transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz );\n#endif';
  C.fog_pars_fragment = `#ifdef USE_FOG
	uniform vec3 fogColor;
	uniform float fogDensity;
	uniform float fogNear;
	uniform float fogFar;
	varying vec3 vFogWorld;
${FOG_GLSL}
#endif`;
  C.fog_fragment = `#ifdef USE_FOG
	float fogF = heightFog( cameraPosition, vFogWorld, fogDensity );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint( fogColor, normalize( vFogWorld - cameraPosition ) ), fogF );
#endif`;
}

/* Shared GLSL helpers for the custom materials. */
export const HASH_GLSL = /* glsl */ `
#ifndef QUYET_HASH
#define QUYET_HASH
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
#endif
`;
