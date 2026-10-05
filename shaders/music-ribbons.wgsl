// Prismatic ribbons: bass opens the braid, mids fold it, highs light the sparks.
// Route bass / mids / highs to the matching microphone frequency presets.
// Keep speed unbound: audio changes shape without jumping the animation clock.
// @slider speed 0 2 0.55 0.01
// @slider intensity 0.2 3 1.25 0.01
// @slider zoom 0.5 2 1 0.01
// @slider tilt -90 90 -12 1
// @slider spread 0.02 0.3 0.11 0.01
// @slider frequency 1 12 4.2 0.1
// @slider thickness 0.001 0.025 0.005 0.001
// @slider bloom 0 2 0.8 0.01
// @slider weave 0 1 0.55 0.01
// @slider sparkle 0 2 0.8 0.01
// @slider bass 0 1 0 0.01
// @slider mids 0 1 0 0.01
// @slider highs 0 1 0 0.01
// @color cool #39DDEB
// @color warm #F268AE
// @color background #070B19

fn fragment(uv: vec2f) -> vec4f {
  let aspect = globals.resolution.x / globals.resolution.y;
  let screen = (uv - 0.5) * vec2f(aspect, 1.0);
  let angle = controls.tilt * 0.01745329;
  let p = vec2f(
    cos(angle) * screen.x - sin(angle) * screen.y,
    sin(angle) * screen.x + cos(angle) * screen.y
  ) / controls.zoom;
  let t = globals.time * controls.speed;
  let bass = smoothstep(0.03, 0.95, controls.bass);
  let mids = smoothstep(0.03, 0.95, controls.mids);
  let highs = smoothstep(0.04, 0.95, controls.highs);
  let spread = controls.spread * (1.0 + bass * 0.75);
  let width = controls.thickness * (1.0 + bass * 0.6);
  let pixel = 1.0 / (globals.resolution.y * controls.zoom);

  var light = vec3f(0.0);
  for (var i = 0; i < 6; i += 1) {
    let layer = f32(i);
    let phase = layer * 1.04719755;
    let travel = p.x * controls.frequency - t * 0.7;
    let braid = sin(travel + phase);
    let fold = sin(p.x * controls.frequency * 1.9 + t * 0.45 + phase);
    let center = sin(p.x * 1.7 + t * 0.22) * 0.11
      + braid * spread
      + fold * controls.weave * (0.018 + mids * 0.065)
      + (layer - 2.5) * spread * 0.13;

    let distance = abs(p.y - center);
    let aa = max(fwidth(p.y - center), pixel);
    let core = 1.0 - smoothstep(width, width + aa * 1.5, distance);
    let haloWidth = width * 4.0 + 0.012;
    let halo = exp(-distance / haloWidth);
    let mist = exp(-distance / (haloWidth * 4.0));
    let facing = 0.55 + 0.45 * cos(travel + phase);
    let palette = 0.5 + 0.5 * sin(p.x * 0.8 + phase + t * 0.12);
    let tint = mix(controls.cool, controls.warm, palette);

    // Antialiased beads travel along each ribbon; highs reveal their bright cores.
    let beadPhase = p.x * 38.0 - t * (2.0 + layer * 0.15) + phase * 3.0;
    let bead = 0.5 + 0.5 * sin(beadPhase);
    let beadAA = max(fwidth(bead), 0.005);
    let beads = smoothstep(0.96 - beadAA, 0.96 + beadAA, bead);
    let spark = beads * exp(-distance / (width * 1.8 + pixel))
      * controls.sparkle * highs;

    light += tint * (
      core * facing * (0.5 + bass * 0.5)
      + halo * controls.bloom * 0.2
      + mist * controls.bloom * 0.035
    );
    light += mix(tint, vec3f(1.0), 0.7) * spark * 1.6;
  }

  let vignette = 1.0 - smoothstep(0.2, 0.85, length(uv - 0.5));
  let color = controls.background
    + light * controls.intensity * vignette;
  return vec4f(vec3f(1.0) - exp(-color), 1.0);
}
