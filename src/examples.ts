export type ShaderExample = {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly accent: string
  readonly source: string
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
  ]
