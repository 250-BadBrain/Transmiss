import { DurableObject } from "cloudflare:workers";
import type {
  ClientToWorkerMessage,
  RoomId,
  SignalMessage,
  WorkerToClientMessage,
} from "@transmiss/shared";

const ROOM_ID_PATTERN = /^[A-Z0-9]{8}$/;
const WEB_SOCKET_UPGRADE = "websocket";
const ALLOWED_ORIGINS = new Set([
  "https://transmiss.lab.h2seo4.win",
  "https://p2p.lab.h2seo4.win",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

export interface Env {
  readonly ROOMS: DurableObjectNamespace<RoomDurableObject>;
}

const json = (data: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init?.headers,
    },
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseClientMessage = (value: string): ClientToWorkerMessage | null => {
  const parsed: unknown = JSON.parse(value);

  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    return null;
  }

  if (
    (parsed.type === "create-room" || parsed.type === "join-room") &&
    typeof parsed.roomId === "string"
  ) {
    return { type: parsed.type, roomId: parsed.roomId };
  }

  if (
    parsed.type === "signal" &&
    typeof parsed.roomId === "string" &&
    "payload" in parsed
  ) {
    return {
      type: "signal",
      roomId: parsed.roomId,
      payload: parsed.payload as SignalMessage["payload"],
    };
  }

  return null;
};

const send = (socket: WebSocket, message: WorkerToClientMessage): void => {
  socket.send(JSON.stringify(message));
};

const isAllowedOrigin = (request: Request): boolean => {
  const origin = request.headers.get("origin");

  if (!origin) {
    return false;
  }

  return ALLOWED_ORIGINS.has(origin);
};

export class RoomDurableObject extends DurableObject<Env> {
  private readonly sockets = new Set<WebSocket>();

  override fetch(request: Request): Response {
    if (request.headers.get("upgrade")?.toLowerCase() !== WEB_SOCKET_UPGRADE) {
      return json({ error: "Expected WebSocket upgrade" }, { status: 426 });
    }

    const roomId = this.getRoomId(request);

    if (!roomId) {
      return json({ error: "Invalid room id" }, { status: 400 });
    }

    if (this.sockets.size >= 2) {
      return json({ error: "Room is full" }, { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    server.accept();
    this.addSocket(server, roomId);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private getRoomId(request: Request): RoomId | null {
    const url = new URL(request.url);
    const roomId = url.searchParams.get("roomId")?.toUpperCase() ?? "";

    if (!ROOM_ID_PATTERN.test(roomId)) {
      return null;
    }

    return roomId;
  }

  private addSocket(socket: WebSocket, roomId: RoomId): void {
    const role = this.sockets.size === 0 ? "initiator" : "receiver";

    this.sockets.add(socket);
    send(socket, { type: "room-created", roomId, role });

    if (this.sockets.size === 2) {
      this.broadcast({ type: "peer-joined", roomId });
    }

    socket.addEventListener("message", (event) => {
      this.handleMessage(socket, roomId, event.data);
    });

    socket.addEventListener("close", () => {
      this.removeSocket(socket, roomId);
    });

    socket.addEventListener("error", () => {
      this.removeSocket(socket, roomId);
    });
  }

  private handleMessage(
    socket: WebSocket,
    roomId: RoomId,
    data: string | ArrayBuffer,
  ): void {
    if (typeof data !== "string") {
      send(socket, { type: "error", message: "Only text messages are supported" });
      return;
    }

    try {
      const message = parseClientMessage(data);

      if (!message || message.roomId.toUpperCase() !== roomId) {
        send(socket, { type: "error", message: "Invalid signaling message" });
        return;
      }

      if (message.type === "signal") {
        this.forwardSignal(socket, {
          type: "signal",
          roomId,
          payload: message.payload,
        });
        return;
      }

      if (message.type === "create-room") {
        send(socket, { type: "room-created", roomId });
        return;
      }

      if (message.type === "join-room") {
        return;
      }
    } catch {
      send(socket, { type: "error", message: "Malformed JSON" });
    }
  }

  private forwardSignal(sender: WebSocket, message: SignalMessage): void {
    for (const socket of this.sockets) {
      if (socket !== sender) {
        send(socket, message);
      }
    }
  }

  private broadcast(message: WorkerToClientMessage): void {
    for (const socket of this.sockets) {
      send(socket, message);
    }
  }

  private removeSocket(socket: WebSocket, roomId: RoomId): void {
    const deleted = this.sockets.delete(socket);

    if (deleted && this.sockets.size > 0) {
      this.broadcast({ type: "peer-left", roomId });
    }
  }
}

export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true });
    }

    if (url.pathname !== "/ws") {
      return json({ error: "Not found" }, { status: 404 });
    }

    if (request.headers.get("upgrade")?.toLowerCase() !== WEB_SOCKET_UPGRADE) {
      return json({ error: "Expected WebSocket upgrade" }, { status: 426 });
    }

    if (!isAllowedOrigin(request)) {
      return json({ error: "Forbidden origin" }, { status: 403 });
    }

    const roomId = url.searchParams.get("roomId")?.toUpperCase() ?? "";

    if (!ROOM_ID_PATTERN.test(roomId)) {
      return json({ error: "Invalid room id" }, { status: 400 });
    }

    const id = env.ROOMS.idFromName(roomId);
    const room = env.ROOMS.get(id);

    return room.fetch(request);
  },
};
