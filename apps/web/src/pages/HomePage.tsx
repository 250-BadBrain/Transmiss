import styles from "./HomePage.module.css";

type HomePageProps = {
  onNavigate: (path: string) => void;
};

const ROOM_ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_ID_LENGTH = 8;

const createRoomId = (): string => {
  const bytes = new Uint8Array(ROOM_ID_LENGTH);
  crypto.getRandomValues(bytes);

  return Array.from(bytes, (byte) => {
    const charIndex = byte % ROOM_ID_CHARS.length;
    return ROOM_ID_CHARS[charIndex] ?? "A";
  }).join("");
};

export const HomePage = ({ onNavigate }: HomePageProps) => {
  const handleCreateRoom = () => {
    onNavigate(`/room/${createRoomId()}`);
  };

  const handleJoinSubmit = (event: Event) => {
    event.preventDefault();
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
            maxLength={8}
            placeholder="输入房间码"
            aria-label="输入房间码"
          />
          <button class={styles.secondaryButton} type="button">
            加入房间
          </button>
        </form>
      </section>
    </main>
  );
};
