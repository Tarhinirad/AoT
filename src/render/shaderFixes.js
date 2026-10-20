import * as THREE from 'three';

/**
 * Guards against NaN pixels. The scene renders into a half-float target that
 * bloom then blurs across the whole screen, so a single NaN pixel turns the
 * entire frame black. It flickers as the camera moves, because the bad pixel
 * depends on distance and angle.
 */

let installed = false;

/**
 * Flat shading builds the normal from screen-space derivatives. On distant or
 * sliver triangles (the forest beyond the wall, far giants) the cross product
 * can be zero, and normalize(0) is NaN. Fall back to a normal facing the
 * camera instead. Must run before any material compiles.
 */
export function installShaderFixes() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk;
  const flat = 'vec3 normal = normalize( cross( fdx, fdy ) );';
  const smooth = 'vec3 normal = normalize( vNormal );';
  if (!C.normal_fragment_begin.includes(flat) || !C.normal_fragment_begin.includes(smooth)) {
    console.warn('shaderFixes: normal_fragment_begin changed, flat-shading NaN guard not installed');
    return;
  }
  C.normal_fragment_begin = C.normal_fragment_begin
    .replace(flat, `vec3 flatN = cross( fdx, fdy );
	vec3 normal = dot( flatN, flatN ) > 1e-24 ? normalize( flatN ) : normalize( vViewPosition + vec3( 0.0, 0.0, 1e-6 ) );`)
    .replace(smooth, 'vec3 normal = dot( vNormal, vNormal ) > 1e-24 ? normalize( vNormal ) : vec3( 0.0, 0.0, 1.0 );');
}

/**
 * GLSL helper (valid in GLSL ES 1.00 and 3.00): replaces NaN or infinite
 * colours with black and clamps negatives. NaN fails every comparison and
 * infinity fails the upper bound, so no isnan() is needed.
 */
export const SCRUB_HDR_GLSL = `
vec3 scrubHdr( vec3 c ) {
  bool finite = all( greaterThan( c, vec3( -65000.0 ) ) ) && all( lessThan( c, vec3( 65000.0 ) ) );
  return finite ? max( c, vec3( 0.0 ) ) : vec3( 0.0 );
}`;
