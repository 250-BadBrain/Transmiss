import type {
  P2PDataChannelMessage,
  P2PFileChunkHeader,
  P2PFileMetadata,
  RoomRole,
  WorkerToClientMessage,
} from "@transmiss/shared";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import type {
  DataChannelState,
  WebRtcConnectionState,
  WebRtcSessionRole,
} from "../lib/webrtc";
import { sha256Hex, shortHash } from "../lib/hash";
import { WebRtcSession } from "../lib/webrtc";
import type { WebRtcDiagnostics } from "../lib/webrtcStats";
import { collectWebRtcStats } from "../lib/webrtcStats";
import styles from "./RoomPage.module.css";

type RoomPageProps = {
  roomId: string;
};

type SocketStatus = "connecting" | "open" | "closed" | "error";
type OutgoingFileStatus =
  | "hashing"
  | "metadata-sent"
  | "waiting-to-send"
  | "sending"
  | "sent"
  | "verified"
  | "corrupted"
  | "rejected"
  | "error";
type IncomingFileStatus =
  | "pending"
  | "accepted"
  | "receiving"
  | "verifying"
  | "received"
  | "verified"
  | "corrupted"
  | "rejected"
  | "error";

type LogEntry = {
  readonly id: number;
  readonly text: string;
};

type TransferView = {
  readonly progress: number;
  readonly speed: string;
  readonly eta: string;
};

type OutgoingFile = P2PFileMetadata &
  TransferView & {
    readonly status: OutgoingFileStatus;
    readonly error?: string;
  };

type IncomingFile = P2PFileMetadata &
  TransferView & {
    readonly status: IncomingFileStatus;
    readonly downloadUrl?: string;
    readonly error?: string;
  };

type SendTransfer = {
  aborted: boolean;
  id: string;
  lastUiAt: number;
  startedAt: number;
};

type ReceiveTransfer = {
  chunks: Array<ArrayBuffer | undefined>;
  chunkSize: number;
  id: string;
  lastUiAt: number;
  metadata: P2PFileMetadata;
  receivedBytes: number;
  receivedChunks: number;
  startedAt: number;
  totalChunks: number;
};

const CHUNK_SIZE = 32 * 1024;
const BUFFERED_AMOUNT_HIGH = 2 * 1024 * 1024;
const BUFFERED_AMOUNT_LOW = 1 * 1024 * 1024;
const UI_UPDATE_INTERVAL_MS = 100;
const DIAGNOSTICS_INTERVAL_MS = 1_000;
const TRANSFER_PARAMETERS = {
  chunkSize: CHUNK_SIZE,
  bufferedAmountHigh: BUFFERED_AMOUNT_HIGH,
  bufferedAmountLow: BUFFERED_AMOUNT_LOW,
  uiUpdateIntervalMs: UI_UPDATE_INTERVAL_MS,
};

const getSignalingUrl = (roomId: string): string => {
  const configuredUrl = import.meta.env.VITE_SIGNAL_URL as string | undefined;
  const baseUrl =
    configuredUrl ??
    (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
      ? "ws://127.0.0.1:8787/ws"
      : "wss://relay-transmiss.lab.h2seo4.win/ws");
  const url = new URL(baseUrl);

  url.searchParams.set("roomId", roomId);
  return url.toString();
};

const parseServerMessage = (data: string): WorkerToClientMessage | null => {
  const parsed: unknown = JSON.parse(data);

  if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
    return null;
  }

  return parsed as WorkerToClientMessage;
};

const toWebRtcRole = (role: RoomRole): WebRtcSessionRole => role;

const createFileId = (): string => {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const formatFileSize = (size: number): string => {
  if (size < 1024) {
    return `${size} B`;
  }

  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = size / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
};

const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "--:--";
  }

  const rounded = Math.ceil(seconds);
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;

  return `${minutes}:${rest.toString().padStart(2, "0")}`;
};

const createTransferView = (
  loaded: number,
  total: number,
  startedAt: number,
): TransferView => {
  const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.001);
  const bytesPerSecond = loaded / elapsedSeconds;
  const remainingSeconds =
    bytesPerSecond > 0 ? (total - loaded) / bytesPerSecond : Number.NaN;

  return {
    progress: total === 0 ? 100 : Math.min(100, (loaded / total) * 100),
    speed: `${formatFileSize(bytesPerSecond)}/s`,
    eta: loaded >= total ? "0:00" : formatDuration(remainingSeconds),
  };
};

const fileMetaFromFile = (file: File, id: string, sha256: string): P2PFileMetadata => ({
  id,
  name: file.name,
  size: file.size,
  mime: file.type || "application/octet-stream",
  lastModified: file.lastModified,
  sha256,
});

const emptyTransferView: TransferView = {
  progress: 0,
  speed: "0 B/s",
  eta: "--:--",
};

const getStatusClass = (status: OutgoingFileStatus | IncomingFileStatus): string => {
  const baseClass = styles.fileStatus ?? "";

  if (status === "corrupted" || status === "error") {
    return `${baseClass} ${styles.fileStatusDanger ?? ""}`;
  }

  if (status === "verified") {
    return `${baseClass} ${styles.fileStatusOk ?? ""}`;
  }

  return baseClass;
};

export const RoomPage = ({ roomId }: RoomPageProps) => {
  const socketRef = useRef<WebSocket | null>(null);
  const rtcRef = useRef<WebRtcSession | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectedFileRef = useRef<{ file: File; id: string } | null>(null);
  const incomingMetadataRef = useRef<P2PFileMetadata | null>(null);
  const sendTransferRef = useRef<SendTransfer | null>(null);
  const receiveTransferRef = useRef<ReceiveTransfer | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const roleRef = useRef<WebRtcSessionRole | null>(null);
  const logIdRef = useRef(0);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>("connecting");
  const [peerJoined, setPeerJoined] = useState(false);
  const [roomRole, setRoomRole] = useState<RoomRole | null>(null);
  const [webRtcState, setWebRtcState] =
    useState<WebRtcConnectionState>("new");
  const [dataChannelState, setDataChannelState] =
    useState<DataChannelState>("idle");
  const [text, setText] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [outgoingFile, setOutgoingFile] = useState<OutgoingFile | null>(null);
  const [incomingFile, setIncomingFile] = useState<IncomingFile | null>(null);
  const [diagnostics, setDiagnostics] = useState<WebRtcDiagnostics | null>(null);
  const signalingUrl = useMemo(() => getSignalingUrl(roomId), [roomId]);

  const addLog = (textValue: string) => {
    logIdRef.current += 1;
    setLogs((current) => [
      { id: logIdRef.current, text: textValue },
      ...current.slice(0, 49),
    ]);
  };

  const revokeDownloadUrl = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  const sendP2PMessage = (message: P2PDataChannelMessage): boolean => {
    const sent = rtcRef.current?.sendDataMessage(message) ?? false;

    if (!sent) {
      addLog("send failed: DataChannel is not open");
    }

    return sent;
  };

  const updateOutgoingProgress = (
    transfer: SendTransfer,
    loaded: number,
    total: number,
    force = false,
  ) => {
    const now = performance.now();

    if (!force && now - transfer.lastUiAt < UI_UPDATE_INTERVAL_MS) {
      return;
    }

    transfer.lastUiAt = now;
    setOutgoingFile((current) =>
      current?.id === transfer.id
        ? { ...current, ...createTransferView(loaded, total, transfer.startedAt) }
        : current,
    );
  };

  const updateIncomingProgress = (
    transfer: ReceiveTransfer,
    force = false,
  ) => {
    const now = performance.now();

    if (!force && now - transfer.lastUiAt < UI_UPDATE_INTERVAL_MS) {
      return;
    }

    transfer.lastUiAt = now;
    setIncomingFile((current) =>
      current?.id === transfer.id
        ? {
            ...current,
            ...createTransferView(
              transfer.receivedBytes,
              transfer.metadata.size,
              transfer.startedAt,
            ),
          }
        : current,
    );
  };

  const markOutgoingError = (id: string, error: string) => {
    setOutgoingFile((current) =>
      current?.id === id ? { ...current, status: "error", error } : current,
    );
    addLog(`send error: ${error}`);
  };

  const markIncomingError = (id: string, error: string) => {
    setIncomingFile((current) =>
      current?.id === id ? { ...current, status: "error", error } : current,
    );
    addLog(`receive error: ${error}`);
  };

  const sendSelectedFile = async (fileId: string) => {
    const selected = selectedFileRef.current;
    const session = rtcRef.current;

    if (!selected || selected.id !== fileId || !session) {
      return;
    }

    const { file } = selected;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const transfer: SendTransfer = {
      aborted: false,
      id: fileId,
      lastUiAt: 0,
      startedAt: performance.now(),
    };

    sendTransferRef.current = transfer;
    setOutgoingFile((current) =>
      current?.id === fileId
        ? { ...current, status: "sending", ...emptyTransferView }
        : current,
    );

    try {
      if (
        !sendP2PMessage({
          type: "file-start",
          id: fileId,
          chunkSize: CHUNK_SIZE,
          totalChunks,
        })
      ) {
        throw new Error("Unable to send file-start");
      }

      let loaded = 0;

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        if (transfer.aborted) {
          throw new Error("Transfer rejected");
        }

        if (session.getBufferedAmount() > BUFFERED_AMOUNT_HIGH) {
          await session.waitForBufferedAmountBelow(BUFFERED_AMOUNT_LOW);
        }

        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = await file.slice(start, end).arrayBuffer();
        const sent = session.sendBinaryMessage(
          { type: "file-chunk", id: fileId, chunkIndex },
          chunk,
        );

        if (!sent) {
          throw new Error("Unable to send file chunk");
        }

        loaded += chunk.byteLength;
        updateOutgoingProgress(transfer, loaded, file.size);
      }

      updateOutgoingProgress(transfer, file.size, file.size, true);
      await session.waitForBufferedAmountBelow(0);

      if (!sendP2PMessage({ type: "file-end", id: fileId })) {
        throw new Error("Unable to send file-end");
      }

      setOutgoingFile((current) =>
        current?.id === fileId ? { ...current, status: "sent", progress: 100, eta: "0:00" } : current,
      );
      addLog("file sent");
    } catch (error) {
      if (transfer.aborted) {
        setOutgoingFile((current) =>
          current?.id === fileId ? { ...current, status: "rejected" } : current,
        );
        return;
      }

      markOutgoingError(
        fileId,
        error instanceof Error ? error.message : "Unknown transfer error",
      );
    } finally {
      if (sendTransferRef.current === transfer) {
        sendTransferRef.current = null;
      }
    }
  };

  const handleP2PMessage = (message: P2PDataChannelMessage) => {
    if (message.type === "text") {
      addLog(`received: ${message.text}`);
      return;
    }

    if (message.type === "file-meta") {
      revokeDownloadUrl();
      receiveTransferRef.current = null;
      incomingMetadataRef.current = message.file;
      setIncomingFile({
        ...message.file,
        ...emptyTransferView,
        status: "pending",
      });
      addLog(`file metadata received: ${message.file.name}`);
      return;
    }

    if (message.type === "file-accept") {
      setOutgoingFile((current) =>
        current?.id === message.id
          ? { ...current, status: "waiting-to-send" }
          : current,
      );
      addLog("file accepted; starting transfer");
      void sendSelectedFile(message.id);
      return;
    }

    if (message.type === "file-reject") {
      const transfer = sendTransferRef.current;

      if (transfer?.id === message.id) {
        transfer.aborted = true;
      }

      setOutgoingFile((current) =>
        current?.id === message.id ? { ...current, status: "rejected" } : current,
      );
      addLog("file rejected");
      return;
    }

    if (message.type === "file-start") {
      const metadata = incomingMetadataRef.current;

      if (!metadata || metadata.id !== message.id) {
        return;
      }

      receiveTransferRef.current = {
        chunks: new Array<ArrayBuffer | undefined>(message.totalChunks),
        chunkSize: message.chunkSize,
        id: message.id,
        lastUiAt: 0,
        metadata,
        receivedBytes: 0,
        receivedChunks: 0,
        startedAt: performance.now(),
        totalChunks: message.totalChunks,
      };

      setIncomingFile((current) =>
        current?.id === message.id
          ? {
          ...current,
          ...emptyTransferView,
          status: "receiving",
            }
          : current,
      );
      return;
    }

    if (message.type === "file-progress") {
      return;
    }

    if (message.type === "file-verified") {
      setOutgoingFile((current) =>
        current?.id === message.id
          ? { ...current, status: "verified", progress: 100, eta: "0:00" }
          : current,
      );
      addLog(`file verified: ${shortHash(message.sha256)}`);
      return;
    }

    if (message.type === "file-corrupted") {
      setOutgoingFile((current) =>
        current?.id === message.id
          ? {
              ...current,
              status: "corrupted",
              error: `Hash mismatch ${shortHash(message.actualSha256)}`,
            }
          : current,
      );
      addLog("file corrupted on receiver");
      return;
    }

    const transfer = receiveTransferRef.current;

    if (!transfer || transfer.id !== message.id) {
      return;
    }

    if (transfer.receivedChunks !== transfer.totalChunks) {
      markIncomingError(message.id, "Missing file chunks");
      return;
    }

    const chunks = transfer.chunks.filter(
      (chunk): chunk is ArrayBuffer => chunk !== undefined,
    );
    const blob = new Blob(chunks, { type: transfer.metadata.mime });

    updateIncomingProgress(transfer, true);
    setIncomingFile((current) =>
      current?.id === message.id
        ? {
            ...current,
            eta: "0:00",
            progress: 100,
            speed: createTransferView(
              transfer.metadata.size,
              transfer.metadata.size,
              transfer.startedAt,
            ).speed,
            status: "verifying",
          }
        : current,
    );
    addLog("file received; verifying hash");

    const metadata = transfer.metadata;

    void (async () => {
      try {
        const actualSha256 = await sha256Hex(blob);

        if (actualSha256 !== metadata.sha256) {
          sendP2PMessage({
            type: "file-corrupted",
            id: metadata.id,
            expectedSha256: metadata.sha256,
            actualSha256,
          });
          setIncomingFile((current) =>
            current?.id === metadata.id
              ? {
                  ...current,
                  status: "corrupted",
                  error: `Hash mismatch ${shortHash(actualSha256)}`,
                }
              : current,
          );
          addLog("file corrupted");
          return;
        }

        const downloadUrl = URL.createObjectURL(blob);

        revokeDownloadUrl();
        objectUrlRef.current = downloadUrl;
        sendP2PMessage({
          type: "file-verified",
          id: metadata.id,
          sha256: actualSha256,
        });
        setIncomingFile((current) =>
          current?.id === metadata.id
            ? {
                ...current,
                downloadUrl,
                status: "verified",
              }
            : current,
        );
        addLog(`file verified: ${shortHash(actualSha256)}`);
      } catch (error) {
        markIncomingError(
          metadata.id,
          error instanceof Error ? error.message : "Hash verification failed",
        );
      } finally {
        receiveTransferRef.current = null;
      }
    })();
  };

  const handleBinaryMessage = (
    header: P2PFileChunkHeader,
    payload: ArrayBuffer,
  ) => {
    const transfer = receiveTransferRef.current;

    if (!transfer || transfer.id !== header.id) {
      return;
    }

    if (
      header.chunkIndex < 0 ||
      header.chunkIndex >= transfer.totalChunks ||
      transfer.chunks[header.chunkIndex]
    ) {
      return;
    }

    transfer.chunks[header.chunkIndex] = payload;
    transfer.receivedBytes += payload.byteLength;
    transfer.receivedChunks += 1;
    updateIncomingProgress(transfer);
  };

  const createRtcSession = (role: WebRtcSessionRole): WebRtcSession => {
    rtcRef.current?.close();
    roleRef.current = role;

    const session = new WebRtcSession({
      role,
      sendSignal: (payload) => {
        const socket = socketRef.current;

        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "signal", roomId, payload }));
        }
      },
      onConnectionStateChange: setWebRtcState,
      onDataChannelStateChange: setDataChannelState,
      onMessage: handleP2PMessage,
      onBinaryMessage: handleBinaryMessage,
      onLog: addLog,
    });

    rtcRef.current = session;
    setWebRtcState("new");
    setDataChannelState("idle");
    setDiagnostics(null);
    addLog(`WebRTC role: ${role}`);
    return session;
  };

  useEffect(() => {
    const socket = new WebSocket(signalingUrl);

    socketRef.current = socket;
    rtcRef.current?.close();
    rtcRef.current = null;
    roleRef.current = null;
    sendTransferRef.current = null;
    receiveTransferRef.current = null;
    selectedFileRef.current = null;
    incomingMetadataRef.current = null;
    revokeDownloadUrl();
    setSocketStatus("connecting");
    setPeerJoined(false);
    setRoomRole(null);
    setWebRtcState("new");
    setDataChannelState("idle");
    setLogs([]);
    setOutgoingFile(null);
    setIncomingFile(null);
    setDiagnostics(null);

    socket.addEventListener("open", () => {
      setSocketStatus("open");
      socket.send(JSON.stringify({ type: "join-room", roomId }));
    });

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        return;
      }

      try {
        const message = parseServerMessage(event.data);

        if (!message) {
          return;
        }

        if (message.type === "room-created" && message.role) {
          setRoomRole(message.role);
          createRtcSession(toWebRtcRole(message.role));
          return;
        }

        if (message.type === "peer-joined") {
          setPeerJoined(true);

          const role = roleRef.current;
          const session = rtcRef.current ?? (role ? createRtcSession(role) : null);

          if (role === "initiator") {
            void session?.start().catch((error: unknown) => {
              addLog(
                error instanceof Error
                  ? `WebRTC offer error: ${error.message}`
                  : "WebRTC offer error",
              );
            });
          }

          return;
        }

        if (message.type === "peer-left") {
          setPeerJoined(false);
          rtcRef.current?.close();
          rtcRef.current = null;
          setWebRtcState("closed");
          setDataChannelState("idle");
          setDiagnostics(null);
          addLog("peer left");
          return;
        }

        if (message.type === "signal") {
          void rtcRef.current?.handleSignal(message.payload).catch((error: unknown) => {
            addLog(
              error instanceof Error
                ? `WebRTC signal error: ${error.message}`
                : "WebRTC signal error",
            );
          });
          return;
        }

        if (message.type === "error") {
          addLog(`signaling error: ${message.message}`);
        }
      } catch {
        addLog("signaling error: malformed message");
      }
    });

    socket.addEventListener("close", () => {
      setSocketStatus("closed");
      setPeerJoined(false);
    });

    socket.addEventListener("error", () => {
      setSocketStatus("error");
    });

    return () => {
      socketRef.current = null;
      socket.close();
      rtcRef.current?.close();
      rtcRef.current = null;
      incomingMetadataRef.current = null;
      revokeDownloadUrl();
      setDiagnostics(null);
    };
  }, [roomId, signalingUrl]);

  useEffect(() => {
    let active = true;

    const collect = () => {
      const session = rtcRef.current;

      void collectWebRtcStats(
        session?.getPeerConnection() ?? null,
        session?.getDataChannel() ?? null,
      ).then((nextDiagnostics) => {
        if (active) {
          setDiagnostics(nextDiagnostics);
        }
      });
    };

    collect();
    const intervalId = window.setInterval(collect, DIAGNOSTICS_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [roomId]);

  const handleSendText = (event: Event) => {
    event.preventDefault();

    const trimmedText = text.trim();

    if (!trimmedText) {
      return;
    }

    if (!sendP2PMessage({ type: "text", text: trimmedText })) {
      return;
    }

    addLog(`sent: ${trimmedText}`);
    setText("");
  };

  const handleFileChange = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    const fileId = createFileId();

    selectedFileRef.current = { file, id: fileId };
    sendTransferRef.current = null;
    setOutgoingFile({
      id: fileId,
      name: file.name,
      size: file.size,
      mime: file.type || "application/octet-stream",
      lastModified: file.lastModified,
      sha256: "",
      ...emptyTransferView,
      status: "hashing",
    });
    addLog("hashing file");

    void (async () => {
      try {
        const sha256 = await sha256Hex(file);
        const metadata = fileMetaFromFile(file, fileId, sha256);

        setOutgoingFile({
          ...metadata,
          ...emptyTransferView,
          status: "metadata-sent",
        });

        if (sendP2PMessage({ type: "file-meta", file: metadata })) {
          addLog(`file metadata sent: ${metadata.name}`);
          addLog(`sha256: ${shortHash(sha256)}`);
          return;
        }

        setOutgoingFile((current) =>
          current?.id === metadata.id
            ? { ...current, status: "error", error: "DataChannel is not open" }
            : current,
        );
      } catch (error) {
        setOutgoingFile((current) =>
          current?.id === fileId
            ? {
                ...current,
                status: "error",
                error: error instanceof Error ? error.message : "Hashing failed",
              }
            : current,
        );
      }
    })();

    input.value = "";
  };

  const handleAcceptFile = (fileId: string) => {
    if (sendP2PMessage({ type: "file-accept", id: fileId })) {
      setIncomingFile((current) =>
        current?.id === fileId ? { ...current, status: "accepted" } : current,
      );
    }
  };

  const handleRejectFile = (fileId: string) => {
    if (sendP2PMessage({ type: "file-reject", id: fileId })) {
      receiveTransferRef.current = null;
      setIncomingFile((current) =>
        current?.id === fileId ? { ...current, status: "rejected" } : current,
      );
    }
  };

  return (
    <main class={styles.page}>
      <section class={styles.shell} aria-labelledby="room-title">
        <header class={styles.header}>
          <div>
            <span class={styles.label}>房间号</span>
            <h1 id="room-title">{roomId}</h1>
          </div>
          <p class={styles.status}>
            {peerJoined ? "对方已加入" : "等待对方加入……"}
          </p>
        </header>

        <section class={styles.signaling} aria-labelledby="rtc-title">
          <div class={styles.statusGrid}>
            <h2 id="rtc-title">P2P 测试</h2>
            <p>WebSocket：{socketStatus}</p>
            <p>Peer：{peerJoined ? "已加入" : "未加入"}</p>
            <p>Role：{roomRole ?? "--"}</p>
            <p>WebRTC：{webRtcState}</p>
            <p>DataChannel：{dataChannelState}</p>
          </div>

          <form class={styles.p2pForm} onSubmit={handleSendText}>
            <input
              class={styles.textInput}
              type="text"
              value={text}
              onInput={(event) => {
                setText(event.currentTarget.value);
              }}
              placeholder="发送 P2P 文本"
              aria-label="发送 P2P 文本"
            />
            <button
              class={styles.signalButton}
              type="submit"
              disabled={dataChannelState !== "open"}
            >
              发送
            </button>
          </form>

          <div class={styles.messageLog} aria-live="polite">
            {logs.length > 0 ? (
              logs.map((entry) => <p key={entry.id}>{entry.text}</p>)
            ) : (
              <p>No P2P messages</p>
            )}
          </div>
        </section>

        <DiagnosticsPanel
          diagnostics={diagnostics}
          transferParameters={TRANSFER_PARAMETERS}
        />

        <section class={styles.dropZone} aria-label="文件上传区域">
          <p>Drag files here</p>
          <input
            ref={fileInputRef}
            class={styles.fileInput}
            type="file"
            onChange={handleFileChange}
          />
          <button
            class={styles.fileButton}
            type="button"
            disabled={dataChannelState !== "open"}
            onClick={() => fileInputRef.current?.click()}
          >
            选择文件
          </button>
        </section>

        <section class={styles.files} aria-labelledby="files-title">
          <h2 id="files-title">文件列表</h2>

          {!outgoingFile && !incomingFile ? (
            <div class={styles.empty}>No files</div>
          ) : (
            <div class={styles.fileList}>
              {outgoingFile ? (
                <article class={styles.fileItem}>
                  <div>
                    <strong>{outgoingFile.name}</strong>
                    <p>
                      发送 · {formatFileSize(outgoingFile.size)} · {outgoingFile.mime}
                    </p>
                    {outgoingFile.sha256 ? (
                      <p>sha256 {shortHash(outgoingFile.sha256)}</p>
                    ) : null}
                    {outgoingFile.error ? <p>{outgoingFile.error}</p> : null}
                  </div>
                  <div class={styles.fileActions}>
                    <span class={getStatusClass(outgoingFile.status)}>
                      {outgoingFile.status}
                    </span>
                    <span class={styles.fileMetric}>
                      {outgoingFile.progress.toFixed(1)}%
                    </span>
                    <span class={styles.fileMetric}>{outgoingFile.speed}</span>
                    <span class={styles.fileMetric}>ETA {outgoingFile.eta}</span>
                  </div>
                  <div class={styles.miniProgress}>
                    <span style={{ width: `${outgoingFile.progress}%` }} />
                  </div>
                </article>
              ) : null}

              {incomingFile ? (
                <article class={styles.fileItem}>
                  <div>
                    <strong>{incomingFile.name}</strong>
                    <p>
                      接收 · {formatFileSize(incomingFile.size)} · {incomingFile.mime}
                    </p>
                    <p>sha256 {shortHash(incomingFile.sha256)}</p>
                    {incomingFile.error ? <p>{incomingFile.error}</p> : null}
                  </div>
                  <div class={styles.fileActions}>
                    <span class={getStatusClass(incomingFile.status)}>
                      {incomingFile.status}
                    </span>
                    <span class={styles.fileMetric}>
                      {incomingFile.progress.toFixed(1)}%
                    </span>
                    <span class={styles.fileMetric}>{incomingFile.speed}</span>
                    <span class={styles.fileMetric}>ETA {incomingFile.eta}</span>
                    {incomingFile.status === "pending" ? (
                      <>
                        <button
                          class={styles.smallButton}
                          type="button"
                          onClick={() => handleAcceptFile(incomingFile.id)}
                        >
                          接受
                        </button>
                        <button
                          class={styles.smallButton}
                          type="button"
                          onClick={() => handleRejectFile(incomingFile.id)}
                        >
                          拒绝
                        </button>
                      </>
                    ) : null}
                    {incomingFile.downloadUrl && incomingFile.status === "verified" ? (
                      <a
                        class={styles.downloadButton}
                        href={incomingFile.downloadUrl}
                        download={incomingFile.name}
                      >
                        下载
                      </a>
                    ) : null}
                  </div>
                  <div class={styles.miniProgress}>
                    <span style={{ width: `${incomingFile.progress}%` }} />
                  </div>
                </article>
              ) : null}
            </div>
          )}
        </section>

        <footer class={styles.transfer}>
          <div class={styles.progressTrack} aria-label="传输进度">
            <div
              class={styles.progressBar}
              style={{
                width: `${Math.max(
                  outgoingFile?.progress ?? 0,
                  incomingFile?.progress ?? 0,
                )}%`,
              }}
            />
          </div>
          <div class={styles.stats}>
            <span>速度：{outgoingFile?.speed ?? incomingFile?.speed ?? "0 B/s"}</span>
            <span>剩余时间：{outgoingFile?.eta ?? incomingFile?.eta ?? "--:--"}</span>
          </div>
        </footer>
      </section>
    </main>
  );
};
