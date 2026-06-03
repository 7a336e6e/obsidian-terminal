import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { WsServer, WsClient } from "./WsServer";
import { ContextProvider, EditorSnapshot } from "./ContextProvider";

// IdeServer hosts the Claude Code "IDE integration": a localhost WebSocket
// server speaking a WebSocket-transport variant of MCP (JSON-RPC 2.0). It
// writes the discovery lock file Claude looks for, answers tool calls, and
// pushes selection_changed notifications so `claude` running in a terminal
// stays aware of the active note and selection. Protocol reference:
// https://github.com/coder/claudecode.nvim/blob/main/PROTOCOL.md

const MCP_PROTOCOL_VERSION = "2025-03-26";

const TOOL_DEFINITIONS = [
  {
    name: "openFile",
    description:
      "Open a file in the Obsidian editor and optionally select a range of text.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Path to the file to open" },
        startText: {
          type: "string",
          description: "Text at the start of the desired selection",
        },
        endText: {
          type: "string",
          description: "Text at the end of the desired selection",
        },
      },
      required: ["filePath"],
    },
  },
  {
    name: "getCurrentSelection",
    description: "Get the current text selection in the active editor.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "getLatestSelection",
    description:
      "Get the most recent text selection, even if the editor is not currently focused.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "getOpenEditors",
    description: "Get information about the currently open editor tabs.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "getWorkspaceFolders",
    description: "Get all workspace folders (the Obsidian vault root).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "getDiagnostics",
    description:
      "Get language diagnostics. Obsidian has no language server, so this always returns an empty list.",
    inputSchema: {
      type: "object",
      properties: {
        uri: { type: "string", description: "Optional file URI to filter by" },
      },
    },
  },
];

// Loose typing is deliberate here: this is the untrusted JSON-RPC boundary.
interface JsonRpcMessage {
  id?: string | number | null;
  method?: string;
  params?: { [key: string]: unknown } & { name?: string; arguments?: { [key: string]: unknown } };
}

interface ClientState {
  initialized: boolean;
}

export class IdeServer {
  private server: WsServer | null = null;
  private authToken = "";
  private lockFilePath: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private clientStates: Map<WsClient, ClientState> = new Map();
  private _running = false;

  constructor(
    private contextProvider: ContextProvider,
    private vaultBasePath: string,
    private version: string
  ) {}

  get running(): boolean {
    return this._running;
  }

  get port(): number {
    return this.server?.port ?? 0;
  }

  async start(): Promise<void> {
    if (this._running) return;
    this.authToken = crypto.randomBytes(16).toString("hex");

    const server = new WsServer(this.authToken);
    server.onMessage = (client, msg) => this.handleMessage(client, msg);
    server.onClose = (client) => this.clientStates.delete(client);
    const port = await server.start();
    this.server = server;

    this.writeLockFile(port);
    this.unsubscribe = this.contextProvider.onChange((snap) =>
      this.broadcastSelection(snap)
    );
    this._running = true;
  }

  async stop(): Promise<void> {
    if (!this._running) return;
    this._running = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.clientStates.clear();
    this.server?.stop();
    this.server = null;
    this.removeLockFile();
  }

  // ------ lock file ------

  private writeLockFile(port: number): void {
    const dir = path.join(this.configDir(), "ide");
    fs.mkdirSync(dir, { recursive: true });
    const lockPath = path.join(dir, `${port}.lock`);
    const contents = {
      pid: process.pid,
      workspaceFolders: [this.vaultBasePath],
      ideName: "Obsidian",
      transport: "ws",
      authToken: this.authToken,
    };
    fs.writeFileSync(lockPath, JSON.stringify(contents), { mode: 0o600 });
    this.lockFilePath = lockPath;
  }

  private removeLockFile(): void {
    if (!this.lockFilePath) return;
    try {
      fs.unlinkSync(this.lockFilePath);
    } catch {
      // already removed
    }
    this.lockFilePath = null;
  }

  private configDir(): string {
    return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  }

  // ------ MCP / JSON-RPC dispatch ------

  private handleMessage(client: WsClient, raw: string): void {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    const { id, method, params } = msg;

    if (method === "notifications/initialized") {
      const state = this.clientStates.get(client);
      if (state) state.initialized = true;
      // Push current context immediately so Claude has it on connect.
      this.sendSelection(client, this.contextProvider.getLatest());
      return;
    }

    // Other notifications (no id) need no reply.
    if (id === undefined || id === null) return;

    switch (method) {
      case "initialize": {
        this.clientStates.set(client, { initialized: false });
        const requested = params?.protocolVersion;
        this.reply(client, id, {
          protocolVersion:
            typeof requested === "string" ? requested : MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "obsidian-term", version: this.version },
        });
        break;
      }
      case "tools/list":
        this.reply(client, id, { tools: TOOL_DEFINITIONS });
        break;
      case "tools/call":
        void this.handleToolCall(client, id, params);
        break;
      default:
        this.replyError(client, id, -32601, `Method not found: ${method}`);
    }
  }

  private async handleToolCall(
    client: WsClient,
    id: string | number,
    params: JsonRpcMessage["params"]
  ): Promise<void> {
    const name = typeof params?.name === "string" ? params.name : "";
    const args = (params?.arguments ?? {}) as { [key: string]: unknown };
    try {
      const result = await this.runTool(name, args);
      this.reply(client, id, {
        content: [{ type: "text", text: JSON.stringify(result) }],
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.reply(client, id, {
        content: [{ type: "text", text: JSON.stringify({ success: false, message }) }],
        isError: true,
      });
    }
  }

  private async runTool(
    name: string,
    args: { [key: string]: unknown }
  ): Promise<unknown> {
    switch (name) {
      case "getCurrentSelection":
        return this.selectionResult(this.contextProvider.getCurrent());
      case "getLatestSelection":
        return this.selectionResult(this.contextProvider.getLatest());
      case "getOpenEditors":
        return this.contextProvider.getOpenEditors();
      case "getWorkspaceFolders":
        return this.contextProvider.getWorkspaceFolders();
      case "getDiagnostics":
        return [];
      case "openFile":
        return this.contextProvider.openFile({
          filePath: String(args.filePath ?? ""),
          startText: typeof args.startText === "string" ? args.startText : undefined,
          endText: typeof args.endText === "string" ? args.endText : undefined,
        });
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private selectionResult(snap: EditorSnapshot | null) {
    if (!snap) {
      return { success: false, text: "", message: "No active selection" };
    }
    return {
      success: true,
      text: snap.text,
      filePath: snap.filePathAbs,
      fileUrl: snap.fileUrl,
      selection: snap.selection,
    };
  }

  // ------ notifications ------

  private broadcastSelection(snap: EditorSnapshot | null): void {
    if (!snap || !this.server) return;
    this.server.broadcastText(JSON.stringify(selectionNotification(snap)));
  }

  private sendSelection(client: WsClient, snap: EditorSnapshot | null): void {
    if (!snap || !this.server) return;
    this.server.sendText(client, JSON.stringify(selectionNotification(snap)));
  }

  private reply(client: WsClient, id: string | number, result: unknown): void {
    this.server?.sendText(client, JSON.stringify({ jsonrpc: "2.0", id, result }));
  }

  private replyError(
    client: WsClient,
    id: string | number,
    code: number,
    message: string
  ): void {
    this.server?.sendText(
      client,
      JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })
    );
  }
}

function selectionNotification(snap: EditorSnapshot) {
  return {
    jsonrpc: "2.0",
    method: "selection_changed",
    params: {
      text: snap.text,
      filePath: snap.filePathAbs,
      fileUrl: snap.fileUrl,
      selection: snap.selection,
    },
  };
}
