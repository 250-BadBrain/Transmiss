import type {
  P2PDataChannelMessage,
  P2PFileChunkHeader,
  WebRtcSignalPayload,
} from "@transmiss/shared";

export type WebRtcSessionRole = "initiator" | "receiver";
export type WebRtcConnectionState = RTCPeerConnectionState;
export type DataChannelState = RTCDataChannelState | "idle";

type WebRtcSessionOptions = {
  readonly role: WebRtcSessionRole;
  readonly sendSignal: (payload: WebRtcSignalPayload) => void;
  readonly onConnectionStateChange: (state: WebRtcConnectionState) => void;
  readonly onDataChannelStateChange: (state: DataChannelState) => void;
  readonly onMessage: (message: P2PDataChannelMessage) => void;
  readonly onBinaryMessage: (
    header: P2PFileChunkHeader,
    payload: ArrayBuffer,
  ) => void;
  readonly onLog: (message: string) => void;
};

const DATA_CHANNEL_LABEL = "transmiss-text";
const BINARY_HEADER_BYTES = 4;
const decoder = new TextDecoder();

const isWebRtcSignalPayload = (
  value: unknown,
): value is WebRtcSignalPayload => {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }

  const payload = value as { readonly kind?: unknown };
  return (
    payload.kind === "offer" ||
    payload.kind === "answer" ||
    payload.kind === "ice-candidate"
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isP2PDataChannelMessage = (
  value: unknown,
): value is P2PDataChannelMessage => {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  if (value.type === "text") {
    return typeof value.text === "string";
  }

  if (value.type === "file-meta") {
    const file = value.file;

    return (
      isRecord(file) &&
      typeof file.id === "string" &&
      typeof file.name === "string" &&
      typeof file.size === "number" &&
      typeof file.mime === "string" &&
      typeof file.lastModified === "number" &&
      typeof file.sha256 === "string"
    );
  }

  if (
    value.type === "file-accept" ||
    value.type === "file-reject" ||
    value.type === "file-end"
  ) {
    return typeof value.id === "string";
  }

  if (value.type === "file-verified") {
    return typeof value.id === "string" && typeof value.sha256 === "string";
  }

  if (value.type === "file-corrupted") {
    return (
      typeof value.id === "string" &&
      typeof value.expectedSha256 === "string" &&
      typeof value.actualSha256 === "string"
    );
  }

  if (value.type === "file-start") {
    return (
      typeof value.id === "string" &&
      typeof value.chunkSize === "number" &&
      typeof value.totalChunks === "number"
    );
  }

  if (value.type === "file-progress") {
    return (
      typeof value.id === "string" &&
      typeof value.loaded === "number" &&
      typeof value.total === "number"
    );
  }

  return false;
};

const isP2PFileChunkHeader = (value: unknown): value is P2PFileChunkHeader =>
  isRecord(value) &&
  value.type === "file-chunk" &&
  typeof value.id === "string" &&
  typeof value.chunkIndex === "number";

const parseBinaryFrame = (
  frame: ArrayBuffer,
): { readonly header: P2PFileChunkHeader; readonly payload: ArrayBuffer } | null => {
  if (frame.byteLength < BINARY_HEADER_BYTES) {
    return null;
  }

  const view = new DataView(frame);
  const headerLength = view.getUint32(0, false);
  const payloadOffset = BINARY_HEADER_BYTES + headerLength;

  if (headerLength === 0 || payloadOffset > frame.byteLength) {
    return null;
  }

  const headerBytes = frame.slice(BINARY_HEADER_BYTES, payloadOffset);
  const parsedHeader: unknown = JSON.parse(decoder.decode(headerBytes));

  if (!isP2PFileChunkHeader(parsedHeader)) {
    return null;
  }

  return {
    header: parsedHeader,
    payload: frame.slice(payloadOffset),
  };
};

export const createPeerConnectionConfig = (): RTCConfiguration => {
  const turnUsername = import.meta.env.VITE_TURN_USERNAME as string | undefined;
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL as
    | string
    | undefined;
  const iceServers: RTCIceServer[] = [
    {
      urls: "stun:turn.h2seo4.win:3478",
    },
  ];

  if (turnUsername && turnCredential) {
    iceServers.push({
      urls: [
        "turn:turn.h2seo4.win:3478?transport=udp",
        "turn:turn.h2seo4.win:3478?transport=tcp",
      ],
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return { iceServers };
};

export class WebRtcSession {
  private readonly peerConnection: RTCPeerConnection;
  private readonly pendingCandidates: RTCIceCandidateInit[] = [];
  private dataChannel: RTCDataChannel | null = null;
  private pendingBinaryHeader: P2PFileChunkHeader | null = null;
  private started = false;
  private closed = false;

  constructor(private readonly options: WebRtcSessionOptions) {
    this.peerConnection = new RTCPeerConnection(createPeerConnectionConfig());
    this.peerConnection.addEventListener("connectionstatechange", () => {
      this.options.onConnectionStateChange(this.peerConnection.connectionState);
    });
    this.peerConnection.addEventListener("icecandidate", (event) => {
      if (!event.candidate) {
        return;
      }

      this.options.sendSignal({
        kind: "ice-candidate",
        candidate: {
          candidate: event.candidate.candidate,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          sdpMid: event.candidate.sdpMid,
          usernameFragment: event.candidate.usernameFragment,
        },
      });
    });

    if (this.options.role === "receiver") {
      this.peerConnection.addEventListener("datachannel", (event) => {
        this.attachDataChannel(event.channel);
      });
    }
  }

  async start(): Promise<void> {
    if (this.started || this.closed || this.options.role !== "initiator") {
      return;
    }

    this.started = true;
    this.attachDataChannel(
      this.peerConnection.createDataChannel(DATA_CHANNEL_LABEL, {
        ordered: true,
      }),
    );

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    if (!this.peerConnection.localDescription) {
      throw new Error("Missing local offer");
    }

    this.options.sendSignal({
      kind: "offer",
      description: {
        type: "offer",
        sdp: this.peerConnection.localDescription.sdp,
      },
    });
    this.options.onLog("sent WebRTC offer");
  }

  async handleSignal(payload: unknown): Promise<void> {
    if (this.closed || !isWebRtcSignalPayload(payload)) {
      return;
    }

    if (payload.kind === "offer") {
      await this.handleOffer(payload.description);
      return;
    }

    if (payload.kind === "answer") {
      await this.handleAnswer(payload.description);
      return;
    }

    await this.handleIceCandidate(payload.candidate);
  }

  sendText(message: string): boolean {
    return this.sendDataMessage({ type: "text", text: message });
  }

  sendDataMessage(message: P2PDataChannelMessage): boolean {
    if (!this.dataChannel || this.dataChannel.readyState !== "open") {
      return false;
    }

    this.dataChannel.send(JSON.stringify(message));
    return true;
  }

  sendBinaryMessage(header: P2PFileChunkHeader, payload: ArrayBuffer): boolean {
    if (!this.dataChannel || this.dataChannel.readyState !== "open") {
      return false;
    }

    this.dataChannel.send(JSON.stringify(header));
    this.dataChannel.send(payload);
    return true;
  }

  getBufferedAmount(): number {
    return this.dataChannel?.bufferedAmount ?? 0;
  }

  getPeerConnection(): RTCPeerConnection {
    return this.peerConnection;
  }

  getDataChannel(): RTCDataChannel | null {
    return this.dataChannel;
  }

  async waitForBufferedAmountBelow(bytes: number): Promise<void> {
    const channel = this.dataChannel;

    if (!channel || channel.readyState !== "open") {
      throw new Error("DataChannel is not open");
    }

    if (channel.bufferedAmount <= bytes) {
      return;
    }

    channel.bufferedAmountLowThreshold = bytes;

    await new Promise<void>((resolve, reject) => {
      const handleLow = () => {
        cleanup();
        resolve();
      };
      const handleClose = () => {
        cleanup();
        reject(new Error("DataChannel closed"));
      };
      const cleanup = () => {
        channel.removeEventListener("bufferedamountlow", handleLow);
        channel.removeEventListener("close", handleClose);
        channel.removeEventListener("error", handleClose);
      };

      channel.addEventListener("bufferedamountlow", handleLow);
      channel.addEventListener("close", handleClose);
      channel.addEventListener("error", handleClose);
    });
  }

  close(): void {
    this.closed = true;
    this.dataChannel?.close();
    this.peerConnection.close();
    this.options.onDataChannelStateChange("closed");
    this.options.onConnectionStateChange("closed");
  }

  private async handleOffer(
    description: RTCSessionDescriptionInit,
  ): Promise<void> {
    if (this.options.role !== "receiver") {
      return;
    }

    await this.peerConnection.setRemoteDescription(description);
    await this.flushPendingCandidates();

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    if (!this.peerConnection.localDescription) {
      throw new Error("Missing local answer");
    }

    this.options.sendSignal({
      kind: "answer",
      description: {
        type: "answer",
        sdp: this.peerConnection.localDescription.sdp,
      },
    });
    this.options.onLog("sent WebRTC answer");
  }

  private async handleAnswer(
    description: RTCSessionDescriptionInit,
  ): Promise<void> {
    if (this.options.role !== "initiator") {
      return;
    }

    await this.peerConnection.setRemoteDescription(description);
    await this.flushPendingCandidates();
    this.options.onLog("received WebRTC answer");
  }

  private async handleIceCandidate(
    candidate: RTCIceCandidateInit,
  ): Promise<void> {
    if (!this.peerConnection.remoteDescription) {
      this.pendingCandidates.push(candidate);
      return;
    }

    await this.peerConnection.addIceCandidate(candidate);
  }

  private async flushPendingCandidates(): Promise<void> {
    const candidates = this.pendingCandidates.splice(0);

    for (const candidate of candidates) {
      await this.peerConnection.addIceCandidate(candidate);
    }
  }

  private attachDataChannel(channel: RTCDataChannel): void {
    this.dataChannel = channel;
    channel.binaryType = "arraybuffer";
    this.options.onDataChannelStateChange(channel.readyState);

    channel.addEventListener("open", () => {
      this.options.onDataChannelStateChange(channel.readyState);
      this.options.onLog("DataChannel opened");
    });

    channel.addEventListener("close", () => {
      this.options.onDataChannelStateChange(channel.readyState);
      this.options.onLog("DataChannel closed");
    });

    channel.addEventListener("error", () => {
      this.options.onDataChannelStateChange(channel.readyState);
      this.options.onLog("DataChannel error");
    });

    channel.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        try {
          const message: unknown = JSON.parse(event.data);

          if (isP2PFileChunkHeader(message)) {
            this.pendingBinaryHeader = message;
            return;
          }

          if (isP2PDataChannelMessage(message)) {
            this.options.onMessage(message);
            return;
          }
        } catch {
          this.options.onLog("DataChannel message parse error");
          return;
        }

        this.options.onLog("DataChannel message ignored");
        return;
      }

      void this.handleBinaryData(event.data);
    });
  }

  private async handleBinaryData(data: unknown): Promise<void> {
    let frame: ArrayBuffer;

    if (data instanceof ArrayBuffer) {
      frame = data;
    } else if (data instanceof Blob) {
      frame = await data.arrayBuffer();
    } else {
      this.options.onLog("DataChannel binary message ignored");
      return;
    }

    try {
      const header = this.pendingBinaryHeader;

      if (header) {
        this.pendingBinaryHeader = null;
        this.options.onBinaryMessage(header, frame);
        return;
      }

      const parsed = parseBinaryFrame(frame);

      if (!parsed) {
        this.options.onLog("DataChannel binary frame ignored");
        return;
      }

      this.options.onBinaryMessage(parsed.header, parsed.payload);
    } catch {
      this.options.onLog("DataChannel binary frame parse error");
    }
  }
}
