import { bandsInRange } from './audio'
import type { MicrophoneBinding } from './model'

export type ShaderExample = {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly accent: string
  readonly source: string
  readonly microphoneBindings?: ReadonlyArray<MicrophoneBinding>
}

export const shaderExamples: readonly [ShaderExample, ...Array<ShaderExample>] =
  [
    {
      id: 'aurora',
      name: 'Aurora',
      description: 'Fluid ribbons of electric color.',
      accent: '#ba96ff',
      source: `// A soft, living field of light.
// @knob speed 0 3 0.7 0.01
// @slider intensity 0.2 2 1.1 0.01
// @knob frequency 1 10 4.2 0.1

fn fragment(uv: vec2f) -> vec4f {
  let aspect = globals.resolution.x / globals.resolution.y;
  let p = (uv - 0.5) * vec2f(aspect, 1.0);
  let t = globals.time * controls.speed;
  let wave = sin(p.x * controls.frequency + t * 0.4)
    * 0.17 + sin(p.x * 8.0 - t * 0.3) * 0.06;
  let ribbon = exp(-abs(p.y + wave) * 10.0);
  let second = exp(-abs(p.y - wave * 0.8 - 0.17) * 18.0);
  let color = 0.5 + 0.5 * cos(6.28318 * (
    p.x * 0.15 + t * 0.035 + vec3f(0.12, 0.42, 0.66)
  ));
  let glow = color * ribbon + vec3f(0.5, 0.18, 0.9) * second;
  let vignette = max(0.0, 1.0 - length(p) * 0.5);
  return vec4f(glow * controls.intensity * vignette, 1.0);
}`,
    },
    {
      id: 'chrome',
      name: 'Liquid chrome',
      description: 'Sculpted metallic waves and reflections.',
      accent: '#a2d3ff',
      source: `// Distorted concentric rings with a chrome finish.
// @knob speed 0 3 0.6 0.01
// @slider rings 3 24 12 0.1
// @knob distortion 0 1 0.35 0.01

fn fragment(uv: vec2f) -> vec4f {
  let aspect = globals.resolution.x / globals.resolution.y;
  let p = (uv - 0.5) * vec2f(aspect, 1.0) * 2.0;
  let t = globals.time * controls.speed;
  let r = length(p);
  let bend = sin(p.x * 4.0 + t) * cos(p.y * 3.0 - t * 0.6);
  let surface = sin((r + bend * controls.distortion) * controls.rings - t);
  let highlight = pow(max(surface, 0.0), 12.0);
  let metal = 0.08 + 0.55 * smoothstep(-0.8, 0.8, surface);
  let tint = mix(vec3f(0.25, 0.42, 0.65), vec3f(0.9, 0.95, 1.0), metal);
  let color = tint * metal + highlight * vec3f(0.6, 0.85, 1.0);
  return vec4f(color * (1.0 - smoothstep(0.5, 1.6, r)), 1.0);
}`,
    },
    {
      id: 'tunnel',
      name: 'Neon tunnel',
      description: 'An endless dive through neon geometry.',
      accent: '#ff85b5',
      source: `// Polar coordinates turn a grid into an infinite tunnel.
// @knob speed 0 3 0.8 0.01
// @slider density 3 20 9 1
// @knob twist -2 2 0.4 0.01

fn fragment(uv: vec2f) -> vec4f {
  let aspect = globals.resolution.x / globals.resolution.y;
  let p = (uv - 0.5) * vec2f(aspect, 1.0);
  let radius = max(length(p), 0.02);
  let angle = atan2(p.y, p.x) / 6.28318;
  let depth = 0.3 / radius;
  let t = globals.time * controls.speed;
  let x = angle * controls.density + depth * controls.twist;
  let y = depth - t;
  let grid = abs(fract(vec2f(x, y)) - 0.5);
  let line = pow(max(grid.x, grid.y) * 2.0, 24.0);
  let palette = 0.5 + 0.5 * cos(vec3f(0.0, 2.0, 4.0) + depth + t * 0.3);
  let fade = smoothstep(0.02, 0.18, radius);
  return vec4f(palette * (line + 0.045) * fade, 1.0);
}`,
    },
    {
      id: 'plasma',
      name: 'Acid plasma',
      description: 'A saturated, slow-morphing color field.',
      accent: '#cff78b',
      source: `// Layer a few waves into an organic color field.
// @knob speed 0 3 0.65 0.01
// @slider scale 1 12 5 0.1
// @knob palette 0 6.28 0.4 0.01

fn fragment(uv: vec2f) -> vec4f {
  let aspect = globals.resolution.x / globals.resolution.y;
  let p = (uv - 0.5) * vec2f(aspect, 1.0) * controls.scale;
  let t = globals.time * controls.speed;
  let wave = sin(p.x + t)
    + sin(p.y + t * 0.7)
    + sin(p.x + p.y + t * 0.5)
    + sin(length(p + vec2f(sin(t), cos(t))) * 2.0);
  let color = 0.5 + 0.5 * cos(
    wave * 1.2 + controls.palette + vec3f(0.0, 2.1, 4.2)
  );
  return vec4f(pow(color, vec3f(1.4)), 1.0);
}`,
    },
    {
      id: 'afterhours',
      name: 'Afterhours',
      description: 'Mic-reactive techno: bass, motion, and sparks.',
      accent: '#66efd8',
      microphoneBindings: [
        { name: 'bass', bands: bandsInRange(20, 250), gain: 1.2 },
        { name: 'mids', bands: bandsInRange(250, 4000), gain: 1.4 },
        { name: 'highs', bands: bandsInRange(4000, 16000), gain: 1.8 },
      ],
      source: `// AFTERHOURS / an audiovisual light installation
// Render, then Start mic. Play techno through your speakers.
// Bass: kick pressure / Mids: twisting synths / Highs: hat sparks.
// Adjust each input's gain to suit your room and speaker volume.
// @slider bass 0 1 0.42 0.01
// @slider mids 0 1 0.35 0.01
// @slider highs 0 1 0.25 0.01

fn light(distance: f32, width: f32) -> f32 {
  let x = distance / width;
  return 0.7 / (1.0 + x * x) + 0.3 * exp(-abs(x) * 0.2);
}

fn fragment(uv: vec2f) -> vec4f {
  let tau = 6.2831853;
  let t = globals.time;
  let bass = smoothstep(0.06, 0.95, controls.bass);
  let mids = smoothstep(0.04, 0.95, controls.mids);
  let highs = smoothstep(0.05, 1.0, controls.highs);
  let aspect = globals.resolution.x / globals.resolution.y;
  let pixel = 2.0 / globals.resolution.y;
  let p = (uv - 0.5) * vec2f(aspect, 1.0) * 2.0;
  let radius = max(length(p), 0.0001);
  let angle = atan2(p.y, p.x);
  let cyan = vec3f(0.06, 0.95, 0.8);
  let violet = vec3f(0.45, 0.13, 1.0);
  let ember = vec3f(1.0, 0.25, 0.12);

  let mist = exp(-radius * 1.5);
  var color = vec3f(0.005, 0.009, 0.02) + violet * mist * 0.025;
  let twist = angle + 0.12 * sin(t * 0.17) + mids * 0.25;
  let ribs = pow(0.5 + 0.5 * cos(twist * 16.0 + radius * 5.0), 24.0);
  color += cyan * ribs * 0.035 * exp(-abs(radius - 0.8) * 2.0);

  for (var i = 0; i < 9; i += 1) {
    let layer = f32(i);
    let travel = fract(layer / 9.0 + t * 0.035);
    let depth = travel * travel;
    let size = 0.13 + depth * 1.55;
    let pressure = bass * 0.12 * sin(travel * 4.2 + 0.5);
    let spin = angle + t * 0.055 + layer * 0.065
      + mids * 0.32 * sin(layer * 0.65 + t * 0.2);
    let sector = (fract(spin / (tau / 8.0) + 0.5) - 0.5) * (tau / 8.0);
    let polygon = radius * mix(1.0, cos(sector), 0.85);
    let ripple = mids * 0.018 * sin(spin * 16.0 - t * 0.8 + layer);
    let distance = abs(polygon - size - pressure - ripple);
    let width = max(pixel * 0.7, 0.0012 + depth * 0.0015);
    let fade = smoothstep(0.0, 0.12, travel)
      * (1.0 - smoothstep(0.78, 1.0, travel));
    let hue = 0.5 + 0.5 * sin(layer * 0.6 + t * 0.13 + spin);
    let tint = mix(violet, cyan, hue);
    let gap = smoothstep(0.06, 0.15, abs(sin(spin * 4.0 + layer * 0.3)));
    color += tint * light(distance, width) * fade * gap * (0.9 + bass * 2.4);

    let ticks = pow(0.5 + 0.5 * cos(spin * 96.0 + layer * 1.7), 16.0);
    let rim = abs(polygon - size - pressure - 0.025);
    color += mix(cyan, ember, hue) * light(rim, width * 0.75)
      * ticks * fade * (0.1 + highs * 2.5);
  }

  let irisRadius = 0.22 + bass * 0.085;
  let irisWave = sin(angle * 12.0 + t * 0.6)
    * sin(angle * 5.0 - t * 0.4) * (0.006 + mids * 0.022);
  let iris = abs(radius - irisRadius - irisWave);
  let orbitColor = mix(cyan, violet, 0.5 + 0.5 * sin(angle * 2.0 - t * 0.25));
  color += orbitColor * light(iris, pixel * 1.1) * (1.3 + bass * 3.0);
  color += cyan * exp(-abs(radius - irisRadius) * 18.0) * (0.025 + bass * 0.12);

  let orbit = angle - t * 0.12;
  let cells = floor(fract(orbit / tau) * 80.0);
  let seed = fract(sin(cells * 127.1) * 43758.5453);
  let sparkleRadius = 0.38 + seed * 0.5 + bass * 0.06;
  let sparkleAngle = abs(fract(orbit / tau * 80.0) - 0.5);
  let sparkle = exp(-sparkleAngle * sparkleAngle * 900.0)
    * light(abs(radius - sparkleRadius), pixel * 0.8);
  color += mix(cyan, ember, seed) * sparkle * highs * highs * 3.0;

  let aperture = smoothstep(0.1, 0.18, radius);
  let vignette = 1.0 / (1.0 + dot(p, p) * 0.25);
  color *= aperture * vignette;
  color = vec3f(1.0) - exp(-color * 1.4);
  return vec4f(pow(color, vec3f(0.85)), 1.0);
}`,
    },
  ]
