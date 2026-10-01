# codegl

A browser-only WGSL VJ studio built with Foldkit, Effect, CodeMirror, and WebGPU.

```sh
bun install
bun run dev
```

Open the localhost URL in a browser with WebGPU enabled. Deployment is static: `bun run build` produces `dist/`; serve it over HTTPS. No backend, accounts, or external runtime services are needed.

## Perform

- Aurora starts automatically. Load Aurora, Chrome, Tunnel, or Plasma into the editor to explore the examples.
- Edit with WGSL highlighting, autocomplete, bracket matching, indentation, search, and undo. Cmd/Ctrl+Space opens completion.
- Diagnostics update after a short pause, including line/column locations. Click one to jump to the problem.
- **Cmd/Ctrl+Enter** or **Render shader** compiles and commits the draft. Draft edits and failed compilation never replace the last successful pipeline.
- Generated parameters operate on the **live shader**. Loading an example only changes the draft; render it when ready.
- **Projection** opens a separate output-only window. Move it to the projector and use the browser’s fullscreen shortcut. Multiple projection windows are supported.

Drafts and sessions are in memory in V1. Keep the control window open during a performance; save any code you want to keep before reloading. Projection continues its last successful shader if the control window closes.

## Shader contract

Write a fragment function that receives normalized UV coordinates (top-left is `0, 0`) and returns RGBA. The app supplies the vertex stage, fragment entry point, and uniform bindings.

```wgsl
// @slider speed 0 3 1 0.01
// @knob intensity 0 2 1 0.01

fn fragment(uv: vec2f) -> vec4f {
  let wave = 0.5 + 0.5 * sin(uv.x * 12.0 + globals.time * controls.speed);
  return vec4f(vec3f(wave, uv.y, 0.7) * controls.intensity, 1.0);
}
```

Each annotation is `// @slider|@knob name minimum maximum initial step`. Up to 16 scalar controls are supported. Names must be distinct WGSL identifiers, values finite, the initial value within range, and step positive. Access them as `controls.name`.

Available uniforms:

| Value                | Type    | Meaning                                                   |
| -------------------- | ------- | --------------------------------------------------------- |
| `globals.time`       | `f32`   | Seconds since this session started; shared across windows |
| `globals.resolution` | `vec2f` | Current output width and height in physical pixels        |
| `controls.name`      | `f32`   | Value of an annotated parameter                           |

Use `globals.resolution.x / globals.resolution.y` to correct aspect ratio. Custom functions and WGSL expressions work normally. The V1 host provides two uniform buffers; textures, additional bind groups, compute passes, audio, and MIDI are outside its shader contract.

Compilation checks syntax, annotations, entry points, and render-pipeline compatibility. A valid shader can still be expensive enough to stall or lose a GPU device; compiler validation cannot prove runtime performance. Test demanding shaders before a show. Device loss is reported in the control window.

## Architecture

- `src/main.ts`, `model.ts`, and `message.ts`: schema-backed application state, pure updates, and Effect commands. Draft, validation, and committed live state remain separate.
- `src/host.ts` and `subscription.ts`: scoped Foldkit mounts own the editor and GPU canvas; subscriptions own BroadcastChannel and debounced validation. Cleanup closes listeners, channels, editors, and GPU resources.
- `src/renderer.ts`: serializes GPU compilation and its error scopes, renders the old pipeline during compilation, and swaps only after success. Handles browser resize and a common session clock.
- `src/editor.ts`: the CodeMirror adapter. Stale diagnostics cannot overwrite current code.
- `src/domain/`: annotation parsing, WGSL wrapper generation, and the schema-validated projection protocol.
- `src/view.ts` and `styles.css`: the control workspace and a canvas-only projection view.

Each control session has a distinct BroadcastChannel. Only committed shader snapshots and parameter changes are broadcast, with increasing revisions. A projection requests the current snapshot on connection, queues the newest snapshot during compilation, and preserves its last good render on failure. Projection GPUs compile independently, so swaps are not frame-locked across displays.

## Verify

```sh
bun run format --check
bun run lint
bun run typecheck
bun run test
bun run build
```

Tests cover annotation validation and uniform layout, pure Foldkit state transitions, view interactions, editor synchronization, and renderer safety with a fake GPU. Actual WebGPU rendering also requires a capable browser and GPU; it is not simulated by the unit suite.
