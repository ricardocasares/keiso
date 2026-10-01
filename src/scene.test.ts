import { Array, Option } from "effect";
import {
  Command,
  Mount,
  Subscription,
  click,
  expect,
  given,
  keydown,
  role,
  scene,
  text,
} from "foldkit/scene";
import { modifyFields } from "foldkit/struct";
import { describe, test } from "vitest";

import { Listbox } from "@foldkit/ui";

import { Snapshot } from "./domain/session";
import { type Diagnostic, parseControls } from "./domain/shader";
import { shaderExamples } from "./examples";
import { MountEditor, MountRenderer } from "./host";
import {
  BroadcastState,
  FocusDiagnostic,
  OpenProjection,
  RenderShader,
  ShowDiagnostics,
  UpdateEditor,
  init,
  update,
  view,
} from "./main";
import { Message } from "./message";

const initialModel = init({
  mode: "control",
  sessionId: "test-session",
  startedAt: 1000,
}).model;
const snapshot = Snapshot.make({
  source: initialModel.source,
  controls: parseControls(initialModel.source).controls,
  startedAt: initialModel.startedAt,
  revision: 1,
});

const chrome = Option.getOrThrow(
  Array.findFirst(shaderExamples, (example) => example.id === "chrome"),
);
const mountEditor = Mount.resolve(MountEditor, Message.SucceededMountEditor());
const updateEditor = Command.resolve(
  UpdateEditor,
  Message.CompletedUpdateEditor(),
);
const mountRenderer = Mount.resolve(
  MountRenderer,
  Message.SucceededMountRenderer(),
);
const renderInitialShader = Command.resolve(
  RenderShader,
  Message.CompletedRenderShader({ snapshot, diagnostics: [] }),
);
const acknowledgeRender = Command.resolveAll(
  [BroadcastState, Message.CompletedBroadcastState()],
  [ShowDiagnostics, Message.CompletedShowDiagnostics()],
);
const focusExampleItems = Command.resolve(
  Listbox.FocusItems,
  Listbox.Message.CompletedFocusItems(),
);
const mountExampleListbox = Mount.resolveAll(
  [Listbox.AnchorListbox, Listbox.Message.CompletedAnchorListbox()],
  [
    Listbox.PortalListboxBackdrop,
    Listbox.Message.CompletedPortalListboxBackdrop(),
  ],
);
const focusExampleButton = Command.resolve(
  Listbox.FocusButton,
  Listbox.Message.CompletedFocusButton(),
);

describe("control window", () => {
  test("starts with an editor, output, a render shortcut, and a keyboard-accessible example picker", () => {
    scene(
      { update, view },
      given(initialModel),
      expect(role("heading", { name: "keiso" })).toExist(),
      expect(role("region", { name: "Shader editor" })).toExist(),
      expect(role("region", { name: "Live output" })).toExist(),
      expect(text("⌘+Enter")).toExist(),
      expect(role("button", { name: "Render shader" })).toBeAbsent(),
      expect(role("button", { name: "Projection ↗" })).toBeDisabled(),
      expect(role("button", { name: "Shader examples" })).toExist(),
      expect(role("listbox")).toBeAbsent(),
      expect(role("region", { name: "Shader examples" })).toBeAbsent(),
      Mount.expectExact(MountEditor, MountRenderer),
      mountEditor,
      updateEditor,
      mountRenderer,
      Command.expectExact(RenderShader({ snapshot })),
      renderInitialShader,
      acknowledgeRender,
      expect(role("slider", { name: "speed" })).toExist(),
      expect(text("Draft is live")).toExist(),
      keydown(role("button", { name: "Shader examples" }), "ArrowDown"),
      focusExampleItems,
      mountExampleListbox,
      expect(role("option", { name: /^Aurora/ })).toHaveAttr(
        "aria-selected",
        "true",
      ),
      expect(role("option", { name: /^Liquid chrome/ })).toExist(),
      expect(role("option", { name: /^Neon tunnel/ })).toExist(),
      expect(role("option", { name: /^Acid plasma/ })).toExist(),
      keydown(role("listbox"), "ArrowDown"),
      Command.expectExact(
        Listbox.ScrollIntoView({ id: "shader-examples", index: 1 }),
      ),
      Command.resolve(
        Listbox.ScrollIntoView,
        Listbox.Message.CompletedScrollIntoView(),
      ),
      expect(role("option", { name: /^Liquid chrome/ })).toHaveAttr(
        "data-active",
        "",
      ),
      keydown(role("listbox"), "Escape"),
      focusExampleButton,
      Mount.expectEnded(Listbox.AnchorListbox, Listbox.PortalListboxBackdrop),
      expect(role("listbox")).toBeAbsent(),
      expect(text("Draft is live")).toExist(),
    );
  });

  test("a failed draft render displays a clickable diagnostic while the live output remains protected", () => {
    const source = "fn fragment(uv: vec2f) -> vec4f { return missing; }";
    const diagnostic: Diagnostic = {
      line: 1,
      column: 43,
      id: "validation-error",
      severity: "error",
      message: "Unresolved identifier: missing",
    };
    const rejectedSnapshot = modifyFields(snapshot, {
      source: () => source,
      controls: () => [],
      revision: () => 2,
    });
    scene(
      { update, view },
      given(initialModel),
      mountRenderer,
      renderInitialShader,
      acknowledgeRender,
      Mount.resolve(MountEditor, Message.UpdatedSource({ source })),
      expect(text("Live shader protected · unpublished edits")).toExist(),
      Subscription.emit(Message.PressedRender()),
      Command.expectExact(RenderShader({ snapshot: rejectedSnapshot })),
      expect(role("slider", { name: "speed" })).toBeDisabled(),
      Command.resolve(
        RenderShader,
        Message.CompletedRenderShader({
          snapshot: rejectedSnapshot,
          diagnostics: [diagnostic],
        }),
      ),
      Command.resolve(ShowDiagnostics, Message.CompletedShowDiagnostics()),
      expect(
        text("Render rejected. The last good shader is still live."),
      ).toExist(),
      expect(
        role("button", { name: "L1:43  Unresolved identifier: missing" }),
      ).toExist(),
      expect(role("slider", { name: "speed" })).toExist(),
      click(role("button", { name: "L1:43  Unresolved identifier: missing" })),
      Command.expectExact(FocusDiagnostic({ line: 1, column: 43 })),
      Command.resolve(FocusDiagnostic, Message.CompletedFocusDiagnostic()),
    );
  });

  test("projection button opens the session and examples only replace the draft", () => {
    scene(
      { update, view },
      given(initialModel),
      mountEditor,
      updateEditor,
      mountRenderer,
      renderInitialShader,
      acknowledgeRender,
      click(role("button", { name: "Projection ↗" })),
      Command.expectExact(
        OpenProjection({ sessionId: initialModel.sessionId }),
      ),
      Command.resolve(OpenProjection, Message.CompletedOpenProjection()),
      expect(text("Projection window opened")).toExist(),
      click(role("button", { name: "Shader examples" })),
      focusExampleItems,
      mountExampleListbox,
      click(role("option", { name: /^Liquid chrome/ })),
      Command.expectExact(
        Listbox.FocusButton({ id: "shader-examples" }),
        UpdateEditor({ source: chrome.source, diagnostics: [] }),
      ),
      focusExampleButton,
      Mount.expectEnded(Listbox.AnchorListbox, Listbox.PortalListboxBackdrop),
      updateEditor,
      expect(role("listbox")).toBeAbsent(),
      expect(text("Live shader protected · unpublished edits")).toExist(),
      Command.expectNone(),
    );
  });

  test("GPU failure is visible, ignores the render shortcut, and keeps projection disabled", () => {
    scene(
      { update, view },
      given(initialModel),
      mountEditor,
      updateEditor,
      Mount.resolve(
        MountRenderer,
        Message.FailedMountRenderer({
          reason: "No WebGPU adapter is available.",
        }),
      ),
      expect(role("alert")).toExist(),
      expect(text("WebGPU unavailable")).toExist(),
      expect(text("No WebGPU adapter is available.")).toExist(),
      Subscription.emit(Message.PressedRender()),
      Command.expectNone(),
      expect(role("button", { name: "Projection ↗" })).toBeDisabled(),
    );
  });
});

test("projection renders only the canvas without controls or editor", () => {
  scene(
    { update, view },
    given(modifyFields(initialModel, { mode: () => "projection" })),
    expect(role("button")).toBeAbsent(),
    expect(role("region", { name: "Shader editor" })).toBeAbsent(),
    expect(text("keiso")).toBeAbsent(),
    Mount.expectExact(MountRenderer),
    mountRenderer,
    Command.expectNone(),
  );
});
