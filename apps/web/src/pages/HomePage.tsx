import { useState } from "preact/hooks";
import styles from "./HomePage.module.css";

type HomePageProps = {
  onNavigate: (path: string) => void;
};

const ROOM_ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_ID_LENGTH = 8;
const ROOM_ID_PATTERN = /^[A-Z0-9]{8}$/;

const createRoomId = (): string => {
  const bytes = new Uint8Array(ROOM_ID_LENGTH);
  crypto.getRandomValues(bytes);

  return Array.from(bytes, (byte) => {
    const charIndex = byte % ROOM_ID_CHARS.length;
    return ROOM_ID_CHARS[charIndex] ?? "A";
  }).join("");
};

export const HomePage = ({ onNavigate }: HomePageProps) => {
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");

  const handleCreateRoom = () => {
    onNavigate(`/room/${createRoomId()}`);
  };

  const handleJoinSubmit = (event: Event) => {
    event.preventDefault();
    const normalizedRoomCode = roomCode.trim().toUpperCase();

    if (!ROOM_ID_PATTERN.test(normalizedRoomCode)) {
      setError("请输入 8 位房间码");
      return;
    }

    onNavigate(`/room/${normalizedRoomCode}`);
  };

  const handleRoomCodeInput = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const normalizedValue = input.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, ROOM_ID_LENGTH);

    setRoomCode(normalizedValue);
    setError("");
  };

  return (
    <main class={styles.page}>
      <section class={styles.panel} aria-labelledby="home-title">
        <div class={styles.heading}>
          <h1 id="home-title">transmiss</h1>
          <p>Fast P2P File Transfer</p>
        </div>

        <button class={styles.primaryButton} type="button" onClick={handleCreateRoom}>
          创建房间
        </button>

        <form class={styles.joinForm} onSubmit={handleJoinSubmit}>
          <input
            class={styles.roomInput}
            type="text"
            inputMode="text"
            autoComplete="off"
            maxLength={ROOM_ID_LENGTH}
            value={roomCode}
            placeholder="输入房间码"
            aria-label="输入房间码"
            aria-invalid={error ? "true" : "false"}
            onInput={handleRoomCodeInput}
          />
          <button class={styles.secondaryButton} type="submit">
            加入房间
          </button>
          {error ? <p class={styles.error}>{error}</p> : null}
        </form>
      </section>
    </main>
  );
};
