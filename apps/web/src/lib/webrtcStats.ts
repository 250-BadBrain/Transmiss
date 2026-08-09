export type CandidateType = "host" | "srflx" | "prflx" | "relay" | "unknown";
export type RelayState = "direct" | "relay" | "unknown";

export type WebRtcCandidateDiagnostics = {
  readonly localType: CandidateType;
  readonly remoteType: CandidateType;
  readonly localProtocol: string | null;
  readonly remoteProtocol: string | null;
  readonly localAddress: string | null;
  readonly remoteAddress: string | null;
  readonly localPort: number | null;
  readonly remotePort: number | null;
  readonly relayProtocol: string | null;
  readonly relayState: RelayState;
};

export type WebRtcPerformanceDiagnostics = {
  readonly currentRoundTripTime: number | null;
  readonly availableOutgoingBitrate: number | null;
  readonly bytesSent: number | null;
  readonly bytesReceived: number | null;
  readonly uploadThroughput: number | null;
  readonly downloadThroughput: number | null;
  readonly packetsSent: number | null;
  readonly packetsReceived: number | null;
};

export type WebRtcDataChannelDiagnostics = {
  readonly readyState: RTCDataChannelState | "unavailable";
  readonly bufferedAmount: number | null;
  readonly bufferedAmountLowThreshold: number | null;
  readonly maxPacketLifeTime: number | null;
  readonly maxRetransmits: number | null;
  readonly ordered: boolean | null;
};

export type WebRtcDiagnostics = {
  readonly available: boolean;
  readonly error: string | null;
  readonly connectionState: RTCPeerConnectionState | "unavailable";
  readonly iceConnectionState: RTCIceConnectionState | "unavailable";
  readonly iceGatheringState: RTCIceGatheringState | "unavailable";
  readonly candidate: WebRtcCandidateDiagnostics;
  readonly performance: WebRtcPerformanceDiagnostics;
  readonly dataChannel: WebRtcDataChannelDiagnostics;
};

type StatsRecord = {
  readonly id?: unknown;
  readonly type?: unknown;
  readonly [key: string]: unknown;
};

type PreviousSample = {
  readonly bytesReceived: number;
  readonly bytesSent: number;
  readonly sampledAt: number;
};

const previousSamples = new WeakMap<RTCPeerConnection, PreviousSample>();

const emptyCandidate: WebRtcCandidateDiagnostics = {
  localType: "unknown",
  remoteType: "unknown",
  localProtocol: null,
  remoteProtocol: null,
  localAddress: null,
  remoteAddress: null,
  localPort: null,
  remotePort: null,
  relayProtocol: null,
  relayState: "unknown",
};

const emptyPerformance: WebRtcPerformanceDiagnostics = {
  currentRoundTripTime: null,
  availableOutgoingBitrate: null,
  bytesSent: null,
  bytesReceived: null,
  uploadThroughput: null,
  downloadThroughput: null,
  packetsSent: null,
  packetsReceived: null,
};

export const unavailableWebRtcDiagnostics = (
  dataChannel?: RTCDataChannel | null,
): WebRtcDiagnostics => ({
  available: false,
  error: null,
  connectionState: "unavailable",
  iceConnectionState: "unavailable",
  iceGatheringState: "unavailable",
  candidate: emptyCandidate,
  performance: emptyPerformance,
  dataChannel: getDataChannelDiagnostics(dataChannel ?? null),
});

const isRecord = (value: unknown): value is StatsRecord =>
  typeof value === "object" && value !== null;

const readString = (record: StatsRecord, key: string): string | null => {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

const readNumber = (record: StatsRecord, key: string): number | null => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const readBoolean = (record: StatsRecord, key: string): boolean | null => {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
};

const toCandidateType = (value: string | null): CandidateType => {
  if (value === "host" || value === "srflx" || value === "prflx" || value === "relay") {
    return value;
  }

  return "unknown";
};

const getAddress = (candidate: StatsRecord | null): string | null => {
  if (!candidate) {
    return null;
  }

  return (
    readString(candidate, "address") ??
    readString(candidate, "ip") ??
    readString(candidate, "url")
  );
};

const findSelectedCandidatePair = (
  stats: ReadonlyMap<string, StatsRecord>,
): StatsRecord | null => {
  for (const value of stats.values()) {
    if (value.type !== "transport") {
      continue;
    }

    const selectedCandidatePairId = readString(value, "selectedCandidatePairId");

    if (selectedCandidatePairId) {
      return stats.get(selectedCandidatePairId) ?? null;
    }
  }

  for (const value of stats.values()) {
    if (
      value.type === "candidate-pair" &&
      readString(value, "state") === "succeeded" &&
      readBoolean(value, "nominated") !== false
    ) {
      return value;
    }
  }

  return null;
};

const getDataChannelDiagnostics = (
  dataChannel: RTCDataChannel | null,
): WebRtcDataChannelDiagnostics => {
  if (!dataChannel) {
    return {
      readyState: "unavailable",
      bufferedAmount: null,
      bufferedAmountLowThreshold: null,
      maxPacketLifeTime: null,
      maxRetransmits: null,
      ordered: null,
    };
  }

  return {
    readyState: dataChannel.readyState,
    bufferedAmount: dataChannel.bufferedAmount,
    bufferedAmountLowThreshold: dataChannel.bufferedAmountLowThreshold,
    maxPacketLifeTime: dataChannel.maxPacketLifeTime,
    maxRetransmits: dataChannel.maxRetransmits,
    ordered: dataChannel.ordered,
  };
};

const calculateThroughput = (
  peerConnection: RTCPeerConnection,
  bytesSent: number | null,
  bytesReceived: number | null,
): Pick<WebRtcPerformanceDiagnostics, "uploadThroughput" | "downloadThroughput"> => {
  if (bytesSent === null || bytesReceived === null) {
    return { uploadThroughput: null, downloadThroughput: null };
  }

  const sampledAt = performance.now();
  const previous = previousSamples.get(peerConnection);

  previousSamples.set(peerConnection, {
    bytesReceived,
    bytesSent,
    sampledAt,
  });

  if (!previous) {
    return { uploadThroughput: 0, downloadThroughput: 0 };
  }

  const elapsedSeconds = Math.max((sampledAt - previous.sampledAt) / 1000, 0.001);

  return {
    uploadThroughput: Math.max(0, bytesSent - previous.bytesSent) / elapsedSeconds,
    downloadThroughput:
      Math.max(0, bytesReceived - previous.bytesReceived) / elapsedSeconds,
  };
};

export const collectWebRtcStats = async (
  peerConnection: RTCPeerConnection | null,
  dataChannel: RTCDataChannel | null,
): Promise<WebRtcDiagnostics> => {
  if (!peerConnection) {
    return unavailableWebRtcDiagnostics(dataChannel);
  }

  try {
    const rawStats = await peerConnection.getStats();
    const stats = new Map<string, StatsRecord>();

    rawStats.forEach((value: unknown, key: string) => {
      if (isRecord(value)) {
        stats.set(key, value);
      }
    });

    const selectedPair = findSelectedCandidatePair(stats);
    const localCandidateId = selectedPair
      ? readString(selectedPair, "localCandidateId")
      : null;
    const remoteCandidateId = selectedPair
      ? readString(selectedPair, "remoteCandidateId")
      : null;
    const localCandidate = localCandidateId
      ? stats.get(localCandidateId) ?? null
      : null;
    const remoteCandidate = remoteCandidateId
      ? stats.get(remoteCandidateId) ?? null
      : null;
    const localType = toCandidateType(
      localCandidate ? readString(localCandidate, "candidateType") : null,
    );
    const remoteType = toCandidateType(
      remoteCandidate ? readString(remoteCandidate, "candidateType") : null,
    );
    const bytesSent = selectedPair ? readNumber(selectedPair, "bytesSent") : null;
    const bytesReceived = selectedPair
      ? readNumber(selectedPair, "bytesReceived")
      : null;
    const throughput = calculateThroughput(
      peerConnection,
      bytesSent,
      bytesReceived,
    );

    return {
      available: true,
      error: null,
      connectionState: peerConnection.connectionState,
      iceConnectionState: peerConnection.iceConnectionState,
      iceGatheringState: peerConnection.iceGatheringState,
      candidate: {
        localType,
        remoteType,
        localProtocol: localCandidate ? readString(localCandidate, "protocol") : null,
        remoteProtocol: remoteCandidate
          ? readString(remoteCandidate, "protocol")
          : null,
        localAddress: getAddress(localCandidate),
        remoteAddress: getAddress(remoteCandidate),
        localPort: localCandidate ? readNumber(localCandidate, "port") : null,
        remotePort: remoteCandidate ? readNumber(remoteCandidate, "port") : null,
        relayProtocol:
          (localCandidate ? readString(localCandidate, "relayProtocol") : null) ??
          (remoteCandidate ? readString(remoteCandidate, "relayProtocol") : null),
        relayState:
          localType === "relay" || remoteType === "relay"
            ? "relay"
            : localType === "unknown" && remoteType === "unknown"
              ? "unknown"
              : "direct",
      },
      performance: {
        currentRoundTripTime: selectedPair
          ? readNumber(selectedPair, "currentRoundTripTime")
          : null,
        availableOutgoingBitrate: selectedPair
          ? readNumber(selectedPair, "availableOutgoingBitrate")
          : null,
        bytesSent,
        bytesReceived,
        uploadThroughput: throughput.uploadThroughput,
        downloadThroughput: throughput.downloadThroughput,
        packetsSent: selectedPair ? readNumber(selectedPair, "packetsSent") : null,
        packetsReceived: selectedPair
          ? readNumber(selectedPair, "packetsReceived")
          : null,
      },
      dataChannel: getDataChannelDiagnostics(dataChannel),
    };
  } catch (error) {
    return {
      ...unavailableWebRtcDiagnostics(dataChannel),
      error: error instanceof Error ? error.message : "getStats failed",
    };
  }
};
