/* Boot: wire modules together, restore the autosaved scene or spawn the
   starter sphere, keep the autosave debounce fed. */
"use strict";

(function () {
  BT.Viewport.init(document.getElementById("view"));
  BT.Gizmo.init();
  BT.Sculpt.init();
  BT.Vertex.init();
  BT.Render.init(); // before UI, so entering render mode starts the tracer first
  BT.UI.init();

  const restored = BT.IO.restore();
  if (!restored) {
    BT.IO.starterScene();
    BT.UI.showHint("orbit", 'drag to orbit · <span class="kbd">shift+drag</span> pans · <span class="kbd">scroll</span> zooms');
  }
  BT.UI.syncProjectUI();
  BT.MCP.init();

  // a live deform preview only makes sense for the object it started on
  BT.on("selection", () => BT.Deform.cancel());
  BT.on("mode", () => BT.Deform.cancel());

  // anything that changes the scene feeds the autosave debounce
  BT.on("history", () => BT.IO.scheduleSave());
  BT.on("transform", () => BT.IO.scheduleSave());
  BT.on("material", () => BT.IO.scheduleSave());
  BT.on("mode", () => BT.IO.scheduleSave());

  window.addEventListener("beforeunload", () => BT.IO.save());
})();
