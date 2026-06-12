export type RoomId = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

export type RoomRole = "initiator" | "receiver";

export type WebRtcSessionDescription = {
  readonly type: "offer" | "answer";
  readonly sdp: string;
};

export type WebRtcIceCandidate = {
  readonly candidate: string;
  readonly sdpMLineIndex?: number | null;
  readonly sdpMid?: string | null;
  readonly usernameFragment?: string | null;
};

export type WebRtcSignalPayload =
  | {
      readonly kind: "offer";
      readonly description: WebRtcSessionDescription;
    }
  | {
      readonly kind: "answer";
      readonly description: WebRtcSessionDescription;
    }
  | {
      readonly kind: "ice-candidate";
      readonly candidate: WebRtcIceCandidate;
    };

export type P2PFileMetadata = {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly mime: string;
  readonly lastModified: number;
  readonly sha256: string;
};

export type P2PTextMessage = {
  readonly type: "text";
  readonly text: string;
};

export type P2PFileMetaMessage = {
  readonly type: "file-meta";
  readonly file: P2PFileMetadata;
};

export type P2PFileAcceptMessage = {
  readonly type: "file-accept";
  readonly id: string;
};

export type P2PFileRejectMessage = {
  readonly type: "file-reject";
  readonly id: string;
};

export type P2PFileStartMessage = {
  readonly type: "file-start";
  readonly id: string;
  readonly chunkSize: number;
  readonly totalChunks: number;
};

export type P2PFileEndMessage = {
  readonly type: "file-end";
  readonly id: string;
};

export type P2PFileProgressMessage = {
  readonly type: "file-progress";
  readonly id: string;
  readonly loaded: number;
  readonly total: number;
};

export type P2PFileVerifiedMessage = {
  readonly type: "file-verified";
  readonly id: string;
  readonly sha256: string;
};

export type P2PFileCorruptedMessage = {
  readonly type: "file-corrupted";
  readonly id: string;
  readonly expectedSha256: string;
  readonly actualSha256: string;
};

export type P2PFileChunkHeader = {
  readonly type: "file-chunk";
  readonly id: string;
  readonly chunkIndex: number;
};

export type P2PDataChannelMessage =
  | P2PTextMessage
  | P2PFileMetaMessage
  | P2PFileAcceptMessage
  | P2PFileRejectMessage
  | P2PFileStartMessage
  | P2PFileEndMessage
  | P2PFileProgressMessage
  | P2PFileVerifiedMessage
  | P2PFileCorruptedMessage;

export type CreateRoomMessage = {
  readonly type: "create-room";
  readonly roomId: RoomId;
};

export type JoinRoomMessage = {
  readonly type: "join-room";
  readonly roomId: RoomId;
};

export type RoomCreatedMessage = {
  readonly type: "room-created";
  readonly roomId: RoomId;
  readonly role?: RoomRole;
};

export type PeerJoinedMessage = {
  readonly type: "peer-joined";
  readonly roomId: RoomId;
};

export type PeerLeftMessage = {
  readonly type: "peer-left";
  readonly roomId: RoomId;
};

export type SignalMessage = {
  readonly type: "signal";
  readonly roomId: RoomId;
  readonly payload: WebRtcSignalPayload | JsonValue;
};

export type ErrorMessage = {
  readonly type: "error";
  readonly message: string;
};

export type ClientToWorkerMessage =
  | CreateRoomMessage
  | JoinRoomMessage
  | SignalMessage;

export type WorkerToClientMessage =
  | RoomCreatedMessage
  | PeerJoinedMessage
  | PeerLeftMessage
  | SignalMessage
  | ErrorMessage;
