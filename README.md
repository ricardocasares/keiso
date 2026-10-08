# keiso

A WGSL VJ studio built with Foldkit, Effect, CodeMirror, and WebGPU.

```sh
bun install
bun run dev
```

Open the localhost URL in a browser with WebGPU enabled. `bun run dev` starts both Vite and the API server; Vite proxies `/api` to that server, so AI generation and model loading work through the same origin. Check `/api/health` on the frontend URL for a `204` response (bare `/api` has no handler). Use `bun run dev:web` only when running the API separately. The frontend build is static: `bun run build` produces `dist/`; serve it over HTTPS and route `/api` to the API server when using AI.

## API

To run only the Effect HTTP server with Bun (already included in `bun run dev`):

```sh
bun run api
curl -i http://localhost:3000/api/health
```

`GET /api/health` returns `204 No Content`. The contract lives in `src/api/contract.ts`, handlers in `src/api/handlers.ts`, and server composition in `src/api/server.ts`. `api/index.ts` only runs the final Effect program.

The server listens on `127.0.0.1:3000`. It is intended for trusted local callers: the AI routes can use the server's credentials and contact caller-selected providers.

### Vercel

Import this repository into Vercel. `vercel.json` selects Vite for the static frontend and Bun 1.4 for the API. Vercel runs `api/index.ts` as a [native Bun server function](https://vercel.com/docs/functions/runtimes/bun#deploy-a-bun-server-from-api); the rewrite sends `/api/*` requests to that function while preserving their original paths for the Effect router.

Set `OPENAI_API_KEY` and optionally `OPENAI_BASE_URL` in the project's Vercel environment variables, then deploy. Check `/api/health` for a `204` response. Keep the deployment restricted to trusted callers: the API has no authentication and callers can use the configured server key. Localhost provider URLs refer to the Vercel server, not the visitor's computer.

### AI endpoints

Generation uses Effect's `LanguageModel` service with `@effect/ai-openai-compat`. Configure the server in `.env` (loaded by Bun):

```dotenv
OPENAI_API_KEY=your-ollama-api-key
OPENAI_BASE_URL=https://ollama.com/v1
```

`OPENAI_BASE_URL` is optional and defaults to Ollama Cloud at `https://ollama.com/v1`. `OPENAI_API_KEY` is optional for providers that do not require authentication; Ollama Cloud generation requires a key. Neither setting is exposed to the frontend.

`POST /api/ai/generate` accepts JSON with a required, nonblank `prompt`, optional `model` (default `gemma4:31b-cloud`), and optional `baseUrl`. It returns the complete response as `{ "text": "..." }`. The server adds a system message describing the WGSL host, slider/color annotations, and source-only output rules from `src/api/shader-prompt.ts`; the user's request and optional editor source remain in a separate user message.

```sh
curl http://localhost:3000/api/ai/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Create a cyan and magenta gradient."}'
```

`GET /api/ai/models` returns `{ "models": ["gemma4:31b", "..."] }` from the provider's OpenAI-compatible `/models` endpoint. Set `baseUrl` in the query string to use another provider.

Both endpoints accept an optional `x-api-key` header, which overrides the server key. For example:

```sh
curl http://localhost:3000/api/ai/generate \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: your-provider-key' \
  -d '{"prompt":"Create slowly moving waves.","model":"your-model","baseUrl":"https://provider.example/v1"}'

curl --get http://localhost:3000/api/ai/models \
  -H 'x-api-key: your-provider-key' \
  --data-urlencode 'baseUrl=https://provider.example/v1'
```

Base URLs must include the provider's API prefix (usually `/v1`) and cannot contain embedded credentials, query parameters, or fragments. A different base URL receives only the request's key; the server key is used only for the configured base URL. Local Ollama works with `baseUrl: "http://localhost:11434/v1"`, an installed model name, and no key.

Ollama's [direct cloud API](https://docs.ollama.com/api/openai-compatibility) uses `gemma4:31b`. The requested default alias `gemma4:31b-cloud` is translated to that ID only when calling `https://ollama.com/v1`; listed model IDs are returned unchanged.

Invalid inputs return `400`; provider or malformed upstream responses return a sanitized `502`; requests exceeding two minutes return `504`. Upstream redirects are rejected. The studio calls these endpoints through the same origin; provider credentials stay on the server unless explicitly supplied in AI settings.

## Perform

- Prismatica starts automatically: a psychedelic kaleidoscope with rotating polygon hoops, orbiting shapes, and a breathing flower. Its 16 controls include two colors, bass/mids/highs microphone inputs, and all four oscillator waveforms. Tempo sets the built-in pulse in BPM; **Start mic** adds audio response. Open an input to tune its bands/gain or period/depth/phase, or select Manual to use its control directly.
- Load Aurora, Liquid chrome, Neon tunnel, Acid plasma, or Afterhours from the example picker to explore other looks.
- Edit with WGSL highlighting, autocomplete, bracket matching, indentation, search, and undo. Cmd/Ctrl+Space opens completion.
- Use **Ask AI** below the editor footer and send a prompt. Toggle the **code icon** to include the current editor draft (off by default). Open **AI settings** beside Apply to choose a model and optionally enter an API key or provider endpoint (the base URL, including `/v1`). Blank fields use the server defaults; a custom endpoint needs its own key when required by that provider. Models load when settings first open; use **Refresh models** after changing the connection. Keys are masked and kept in memory, excluded from serialized state, and cleared on reload. Hover or focus **Apply** to preview the generated shader, then click to compile it into the editor and live output. Failed requests retain the prompt for retry; generated code changes the draft and live output only after Apply.
- Diagnostics update after a short pause, including line/column locations. Click one to jump to the problem.
- **Cmd/Ctrl+Enter** compiles and commits the draft. Draft edits and failed compilation never replace the last successful pipeline.
- Generated parameters operate on the **live shader**. Loading an example only changes the draft; its controls start at their defaults when successfully rendered.
- **Projection** opens a separate output-only window. Move it to the projector and use the browser’s fullscreen shortcut. Multiple projection windows are supported.

Drafts and sessions are in memory in V1. Keep the control window open during a performance; save any code you want to keep before reloading. Projection continues its last successful shader if the control window closes.

## Shader contract

Write a fragment function that receives normalized UV coordinates (top-left is `0, 0`) and returns RGBA. The app supplies the vertex stage, fragment entry point, and uniform bindings.

```wgsl
// @slider speed 0 3 1 0.01
// @slider intensity 0 2 1 0.01
// @color sky #AABBCC

fn fragment(uv: vec2f) -> vec4f {
  let wave = 0.5 + 0.5 * sin(uv.x * 12.0 + globals.time * controls.speed);
  return vec4f(controls.sky * wave * controls.intensity, 1.0);
}
```

Slider annotations use `// @slider name minimum maximum default step`. Color annotations use `// @color name #RRGGBB` and expose normalized RGB channels (0–1) as a `vec3f`. Up to 16 controls are supported. Names must be distinct WGSL identifiers, values finite, the default value within range, and step positive. Access them as `controls.name`.

Rendering an edited or pasted shader preserves live values by control name. WGSL edits and annotation order keep your tuning. Changing a control’s type resets it to its declared default. Changing one declared default applies that value to only that control; changing its minimum, maximum, or step clamps and snaps its current value to the new valid range. New or renamed controls start at their defaults, and removed controls disappear. Failed renders keep the previous live shader and controls.

Color controls can use microphone input to vary brightness from black to the selected color, preserving its hue. Frequency bands and gain work the same way as sliders. Stop the microphone to pick a new base color.

Select **+ Input → Oscillator** to animate a control automatically. Choose sine, triangle, sawtooth, or square, then set period (0.1–120 seconds), depth (0–100%), and phase (0–360°). Defaults are sine, 4 seconds, 100% depth, and 0° phase.

At full depth, sliders sweep their declared range and colors pulse from black to their chosen color. Lower depth narrows sliders around their range midpoint and reduces how far colors dim. All oscillators use the session clock: equal periods and phases stay together even when attached at different times; a 180° phase offset puts sine waves opposite each other. Select Manual to stop an oscillator and edit the control again. Keep the controller visible for smooth modulation: browsers can throttle its timer when the tab is hidden, reducing projection updates.

Click the **MIDI plug button** beside any control's input button, allow MIDI access when your browser asks, then move a knob/fader or press a key/pad on your device. The plug pulses amber while learning, then the button turns green and shows only the learned CC or note number. Hover it to see the device and channel. Click a mapped button to learn a new input; click it again while learning to disable MIDI and remove its assignment. Learning another control transfers the listening state to that control. You can still adjust controls directly while MIDI is connected; changing a color sets its base hue for MIDI brightness.

The input panel also offers **MIDI** as a source, shows connected devices, and provides **Learn MIDI**, **Relearn MIDI**, and **Retry MIDI** actions. Its **Cancel learn** action keeps a previous assignment; selecting **Manual** removes it.

MIDI values map across a slider's declared range and step. Keys and pads use note velocity, then return to the minimum on release; color inputs vary brightness from black to the chosen color. Connected and disconnected devices are shown in the input panel, and plugging a device back in resumes its assignment. Mappings live in the current session and are lost on reload.

MIDI requires a browser with Web MIDI support over HTTPS or localhost. Access is requested only when you click a MIDI plug button, select MIDI, or click Learn/Retry, without SysEx permission. Standard absolute 7-bit control changes and notes are supported; relative encoders, 14-bit controls, and pitch bend need additional support.

**Reset** in the Controls header restores defaults from the last successfully rendered code without rendering or changing the draft. Microphone, oscillator, and MIDI bindings remain active and can update those values again.

Available uniforms:

| Value                | Type            | Meaning                                                   |
| -------------------- | --------------- | --------------------------------------------------------- |
| `globals.time`       | `f32`           | Seconds since this session started; shared across windows |
| `globals.resolution` | `vec2f`         | Current output width and height in physical pixels        |
| `controls.name`      | `f32` / `vec3f` | Slider value / normalized RGB color                       |

Use `globals.resolution.x / globals.resolution.y` to correct aspect ratio. Custom functions and WGSL expressions work normally. The V1 host provides two uniform buffers; textures, additional bind groups, compute passes, and raw audio or MIDI data are outside its shader contract. Microphone and MIDI inputs drive the existing `controls.name` uniforms.

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
