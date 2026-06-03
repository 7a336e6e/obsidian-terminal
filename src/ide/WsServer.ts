import * as http from "http";
import * as crypto from "crypto";
import type { Socket, AddressInfo } from "net";

// Minimal RFC 6455 WebSocket server — no third-party dependency, in the spirit
// of the hand-rolled Python PTY helper in PtyBackend.ts. It speaks just enough
// of the protocol for Claude Code's IDE integration: a single text channel of
// small JSON-RPC messages, plus ping/pong and close. Binds to 127.0.0.1 only
// and rejects any handshake without the matching authorization header.

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const OP_CONT = 0x0;
const OP_TEXT = 0x1;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

export interface WsClient {
  id: number;
  socket: Socket;
  buf: Buffer;
  frags: Buffer[];
  fragOp: number;
}

interface ParsedFrame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
  rest: Buffer;
}

export class WsServer {
  private server: http.Server | null = null;
  private clients: Set<WsClient> = new Set();
  private clientIdCounter = 0;
  private _port = 0;

  // Wired up by the owner (IdeServer).
  onMessage: ((client: WsClient, message: string) => void) | null = null;
  onClose: ((client: WsClient) => void) | null = null;

  constructor(private authToken: string) {}

  get port(): number {
    return this._port;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((_req, res) => {
        res.writeHead(426, { "Content-Type": "text/plain" });
        res.end("Upgrade Required");
      });
      server.on("upgrade", (req, socket) =>
        this.handleUpgrade(req, socket as Socket)
      );
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        this._port = (server.address() as AddressInfo).port;
        resolve(this._port);
      });
      this.server = server;
    });
  }

  stop(): void {
    for (const client of this.clients) {
      try {
        client.socket.destroy();
      } catch {
        // already gone
      }
    }
    this.clients.clear();
    this.server?.close();
    this.server = null;
    this._port = 0;
  }

  sendText(client: WsClient, text: string): void {
    if (client.socket.destroyed) return;
    try {
      client.socket.write(encodeFrame(OP_TEXT, Buffer.from(text, "utf8")));
    } catch {
      // client went away mid-write
    }
  }

  broadcastText(text: string): void {
    const frame = encodeFrame(OP_TEXT, Buffer.from(text, "utf8"));
    for (const client of this.clients) {
      if (client.socket.destroyed) continue;
      try {
        client.socket.write(frame);
      } catch {
        // ignore — close handler will clean up
      }
    }
  }

  private handleUpgrade(req: http.IncomingMessage, socket: Socket): void {
    if (!this.validAuth(req.headers["x-claude-code-ide-authorization"])) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }

    const accept = crypto
      .createHash("sha1")
      .update(key + WS_GUID)
      .digest("base64");

    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    const client: WsClient = {
      id: ++this.clientIdCounter,
      socket,
      buf: Buffer.alloc(0),
      frags: [],
      fragOp: 0,
    };
    this.clients.add(client);

    socket.on("data", (chunk: Buffer) => this.handleData(client, chunk));
    socket.on("close", () => {
      this.clients.delete(client);
      this.onClose?.(client);
    });
    socket.on("error", () => {
      this.clients.delete(client);
      try {
        socket.destroy();
      } catch {
        // already destroyed
      }
    });
  }

  private validAuth(header: string | string[] | undefined): boolean {
    if (typeof header !== "string") return false;
    const provided = Buffer.from(header);
    const expected = Buffer.from(this.authToken);
    if (provided.length !== expected.length) return false;
    try {
      return crypto.timingSafeEqual(provided, expected);
    } catch {
      return false;
    }
  }

  private handleData(client: WsClient, chunk: Buffer): void {
    client.buf = Buffer.concat([client.buf, chunk]);
    let frame = parseFrame(client.buf);
    while (frame) {
      client.buf = frame.rest;
      this.processFrame(client, frame);
      frame = parseFrame(client.buf);
    }
  }

  private processFrame(client: WsClient, frame: ParsedFrame): void {
    switch (frame.opcode) {
      case OP_PING:
        client.socket.write(encodeFrame(OP_PONG, frame.payload));
        break;
      case OP_PONG:
        break;
      case OP_CLOSE:
        try {
          client.socket.write(encodeFrame(OP_CLOSE, Buffer.alloc(0)));
        } catch {
          // ignore
        }
        client.socket.end();
        break;
      case OP_TEXT:
      case OP_CONT:
        if (frame.opcode !== OP_CONT) {
          client.fragOp = frame.opcode;
          client.frags = [];
        }
        client.frags.push(frame.payload);
        if (frame.fin) {
          const full = Buffer.concat(client.frags);
          client.frags = [];
          if (client.fragOp === OP_TEXT) {
            this.onMessage?.(client, full.toString("utf8"));
          }
          client.fragOp = 0;
        }
        break;
      default:
        // Unsupported opcode (e.g. binary) — ignore.
        break;
    }
  }
}

// Returns the next complete frame plus the unconsumed remainder, or null if the
// buffer does not yet hold a full frame. Client→server frames are always masked.
function parseFrame(buf: Buffer): ParsedFrame | null {
  if (buf.length < 2) return null;

  const b0 = buf[0];
  const b1 = buf[1];
  const fin = (b0 & 0x80) !== 0;
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f;
  let offset = 2;

  if (len === 126) {
    if (buf.length < offset + 2) return null;
    len = buf.readUInt16BE(offset);
    offset += 2;
  } else if (len === 127) {
    if (buf.length < offset + 8) return null;
    const hi = buf.readUInt32BE(offset);
    const lo = buf.readUInt32BE(offset + 4);
    len = hi * 2 ** 32 + lo;
    offset += 8;
  }

  let maskKey: Buffer | null = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    maskKey = buf.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buf.length < offset + len) return null;

  let payload = buf.subarray(offset, offset + len);
  if (maskKey) {
    const out = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) {
      out[i] = payload[i] ^ maskKey[i & 3];
    }
    payload = out;
  }

  return { fin, opcode, payload, rest: buf.subarray(offset + len) };
}

// Server→client frames must not be masked.
function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  let header: Buffer;

  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(Math.floor(len / 2 ** 32), 2);
    header.writeUInt32BE(len >>> 0, 6);
  }

  return Buffer.concat([header, payload]);
}
