import { useSearchParams } from "react-router-dom";
import ChatPage from "@/pages/ChatPage";
import TalTerminal from "@/features/tal-9000/TalTerminal";

/**
 * TAL 9000 — Fleety's dedicated home.
 *
 * Opens in **Classic** mode (the normal Fleety chat) by default; `?mode=future`
 * switches to the full-screen retro **CRT terminal**. AppLayout drops all app
 * chrome when the URL is `/tal-9000?mode=future` (see its `isTalFullscreen`
 * branch), so the terminal renders edge-to-edge while Classic keeps normal chrome.
 */
export default function TAL9000Page() {
  const [params] = useSearchParams();
  const isFuture = params.get("mode") === "future";
  return isFuture ? <TalTerminal /> : <ChatPage />;
}
