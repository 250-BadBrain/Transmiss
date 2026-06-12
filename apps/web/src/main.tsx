import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { HomePage } from "./pages/HomePage";
import { RoomPage } from "./pages/RoomPage";
import "./styles/global.css";

type Route =
  | { name: "home" }
  | { name: "room"; roomId: string };

const parseRoute = (path: string): Route => {
  const roomMatch = /^\/room\/([A-Za-z0-9]{8})$/.exec(path);

  if (roomMatch?.[1]) {
    return { name: "room", roomId: roomMatch[1].toUpperCase() };
  }

  return { name: "home" };
};

const navigate = (path: string): void => {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
};

const App = () => {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const handlePopState = () => {
      setPath(window.location.pathname);
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  const route = useMemo(() => parseRoute(path), [path]);

  if (route.name === "room") {
    return <RoomPage roomId={route.roomId} />;
  }

  return <HomePage onNavigate={navigate} />;
};

render(<App />, document.querySelector("#app") as HTMLElement);
