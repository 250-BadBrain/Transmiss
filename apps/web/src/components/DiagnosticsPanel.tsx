import type { WebRtcDiagnostics } from "../lib/webrtcStats";
import styles from "./DiagnosticsPanel.module.css";

export type TransferParameters = {
  readonly chunkSize: number;
  readonly bufferedAmountHigh: number;
  readonly bufferedAmountLow: number;
  readonly uiUpdateIntervalMs: number;
};

type DiagnosticsPanelProps = {
  readonly diagnostics: WebRtcDiagnostics | null;
  readonly transferParameters: TransferParameters;
};

const formatNumber = (value: number | null): string =>
  value === null ? "--" : Math.round(value).toLocaleString("en-US");

const formatBytes = (value: number | null): string => {
  if (value === null) {
    return "--";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB"] as const;
  let unitIndex = 0;
  let size = value / 1024;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
};

const formatThroughput = (value: number | null): string =>
  value === null ? "--" : `${(value / 1024 / 1024).toFixed(3)} MB/s`;

const formatSeconds = (value: number | null): string =>
  value === null ? "--" : `${(value * 1000).toFixed(0)} ms`;

const formatBitrate = (value: number | null): string =>
  value === null ? "--" : `${(value / 1000 / 1000).toFixed(2)} Mbps`;

const formatNullable = (value: string | number | boolean | null): string =>
  value === null ? "--" : String(value);

const relayLabel = (diagnostics: WebRtcDiagnostics | null): string => {
  if (!diagnostics?.available) {
    return "Unknown";
  }

  if (diagnostics.candidate.relayState === "relay") {
    return "TURN relay";
  }

  if (diagnostics.candidate.relayState === "direct") {
    return "Direct";
  }

  return "Unknown";
};

export const DiagnosticsPanel = ({
  diagnostics,
  transferParameters,
}: DiagnosticsPanelProps) => {
  const defaultOpen = import.meta.env.DEV;
  const relayState = relayLabel(diagnostics);
  const relayClass =
    relayState === "TURN relay"
      ? styles.relay
      : relayState === "Direct"
        ? styles.direct
        : styles.unknown;

  return (
    <details class={styles.panel} open={defaultOpen}>
      <summary class={styles.summary}>
        <span>Diagnostics</span>
        <strong class={`${styles.badge} ${relayClass}`}>{relayState}</strong>
      </summary>

      {diagnostics?.error ? (
        <p class={styles.error}>getStats error: {diagnostics.error}</p>
      ) : null}

      <div class={styles.grid}>
        <section class={styles.group}>
          <h3>Connection</h3>
          <dl>
            <dt>connectionState</dt>
            <dd>{diagnostics?.connectionState ?? "unavailable"}</dd>
            <dt>iceConnectionState</dt>
            <dd>{diagnostics?.iceConnectionState ?? "unavailable"}</dd>
            <dt>iceGatheringState</dt>
            <dd>{diagnostics?.iceGatheringState ?? "unavailable"}</dd>
            <dt>dataChannel</dt>
            <dd>{diagnostics?.dataChannel.readyState ?? "unavailable"}</dd>
          </dl>
        </section>

        <section class={styles.group}>
          <h3>Candidate Path</h3>
          <dl>
            <dt>local type</dt>
            <dd>{diagnostics?.candidate.localType ?? "unknown"}</dd>
            <dt>remote type</dt>
            <dd>{diagnostics?.candidate.remoteType ?? "unknown"}</dd>
            <dt>local protocol</dt>
            <dd>{formatNullable(diagnostics?.candidate.localProtocol ?? null)}</dd>
            <dt>remote protocol</dt>
            <dd>{formatNullable(diagnostics?.candidate.remoteProtocol ?? null)}</dd>
            <dt>local address</dt>
            <dd>{formatNullable(diagnostics?.candidate.localAddress ?? null)}</dd>
            <dt>remote address</dt>
            <dd>{formatNullable(diagnostics?.candidate.remoteAddress ?? null)}</dd>
            <dt>local port</dt>
            <dd>{formatNullable(diagnostics?.candidate.localPort ?? null)}</dd>
            <dt>remote port</dt>
            <dd>{formatNullable(diagnostics?.candidate.remotePort ?? null)}</dd>
          </dl>
        </section>

        <section class={styles.group}>
          <h3>Performance</h3>
          <dl>
            <dt>RTT</dt>
            <dd>{formatSeconds(diagnostics?.performance.currentRoundTripTime ?? null)}</dd>
            <dt>outgoing bitrate</dt>
            <dd>{formatBitrate(diagnostics?.performance.availableOutgoingBitrate ?? null)}</dd>
            <dt>bytes sent</dt>
            <dd>{formatBytes(diagnostics?.performance.bytesSent ?? null)}</dd>
            <dt>bytes received</dt>
            <dd>{formatBytes(diagnostics?.performance.bytesReceived ?? null)}</dd>
            <dt>upload</dt>
            <dd>{formatThroughput(diagnostics?.performance.uploadThroughput ?? null)}</dd>
            <dt>download</dt>
            <dd>{formatThroughput(diagnostics?.performance.downloadThroughput ?? null)}</dd>
            <dt>packets sent</dt>
            <dd>{formatNumber(diagnostics?.performance.packetsSent ?? null)}</dd>
            <dt>packets received</dt>
            <dd>{formatNumber(diagnostics?.performance.packetsReceived ?? null)}</dd>
          </dl>
        </section>

        <section class={styles.group}>
          <h3>DataChannel</h3>
          <dl>
            <dt>bufferedAmount</dt>
            <dd>{formatBytes(diagnostics?.dataChannel.bufferedAmount ?? null)}</dd>
            <dt>lowThreshold</dt>
            <dd>{formatBytes(diagnostics?.dataChannel.bufferedAmountLowThreshold ?? null)}</dd>
            <dt>maxPacketLifeTime</dt>
            <dd>{formatNullable(diagnostics?.dataChannel.maxPacketLifeTime ?? null)}</dd>
            <dt>maxRetransmits</dt>
            <dd>{formatNullable(diagnostics?.dataChannel.maxRetransmits ?? null)}</dd>
            <dt>ordered</dt>
            <dd>{formatNullable(diagnostics?.dataChannel.ordered ?? null)}</dd>
          </dl>
        </section>

        <section class={styles.group}>
          <h3>Transfer Params</h3>
          <dl>
            <dt>chunkSize</dt>
            <dd>{formatBytes(transferParameters.chunkSize)}</dd>
            <dt>buffer high</dt>
            <dd>{formatBytes(transferParameters.bufferedAmountHigh)}</dd>
            <dt>buffer low</dt>
            <dd>{formatBytes(transferParameters.bufferedAmountLow)}</dd>
            <dt>UI interval</dt>
            <dd>{transferParameters.uiUpdateIntervalMs} ms</dd>
          </dl>
        </section>
      </div>
    </details>
  );
};
