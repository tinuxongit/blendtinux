/* WebSocket bridge to the BlendTinux page. The page connects to us on
   127.0.0.1 and answers {id, cmd, args} frames with {id, ok, result|error}.
   NEVER log to stdout in this directory: stdout is the MCP stdio transport,
   one stray console.log corrupts the protocol. Use console.error. */
import { WebSocketServer } from "ws";

export const NOT_CONNECTED =
  "BlendTinux isn't connected: open the app in your browser and turn on the MCP plug in the top bar";

export class PageBridge {
  constructor(port) {
    this._sock = null;
    this._pending = new Map(); // id -> {resolve, reject, timer}
    this._nextId = 1;

    this._wss = new WebSocketServer({ host: "127.0.0.1", port });
    this._wss.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error("[blendtinux-mcp] port " + port + " is busy; set BLENDTINUX_MCP_PORT to another port (and the PORT constant in js/mcp.js)");
      } else {
        console.error("[blendtinux-mcp] ws error: " + err.message);
      }
    });
    this._wss.on("connection", (sock) => {
      if (this._sock) {
        // newest wins, so a zombie tab never blocks a fresh one
        try { this._sock.close(4000, "replaced"); } catch (_) {}
      }
      this._sock = sock;
      console.error("[blendtinux-mcp] page connected");
      sock.on("message", (raw) => this._onMessage(sock, raw));
      sock.on("close", () => {
        if (this._sock !== sock) return;
        this._sock = null;
        console.error("[blendtinux-mcp] page disconnected");
        for (const [, p] of this._pending) {
          clearTimeout(p.timer);
          p.reject(new Error("BlendTinux disconnected mid-request"));
        }
        this._pending.clear();
      });
      sock.on("error", (err) => console.error("[blendtinux-mcp] socket error: " + err.message));
    });
  }

  get connected() {
    return !!this._sock && this._sock.readyState === 1;
  }

  call(cmd, args, timeoutMs = 20000) {
    if (!this.connected) return Promise.reject(new Error(NOT_CONNECTED));
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error("BlendTinux did not answer in time (" + cmd + ")"));
      }, timeoutMs);
      this._pending.set(id, { resolve, reject, timer });
      this._sock.send(JSON.stringify({ id, cmd, args: args || {} }));
    });
  }

  _onMessage(sock, raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
    if (msg && msg.hello) {
      console.error("[blendtinux-mcp] hello from " + msg.hello.app + " v" + msg.hello.v);
      return;
    }
    if (!msg || !this._pending.has(msg.id)) return;
    const p = this._pending.get(msg.id);
    this._pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error || "unknown error from the page"));
  }
}
