import { useNavigate } from "react-router-dom";

/**
 * Classic ⇄ Future toggle. Shown on Fleety's Classic surfaces (the chat page and the floating
 * widget); "Future" launches the TAL 9000 CRT terminal at /tal-9000?mode=future. The terminal
 * has its own "Classic" control on its panel, so together they form the round-trip switch the
 * owner asked for ("Classic/Future switches everywhere Fleety appears").
 *
 * Styled with the app design tokens (this is the Classic side); the retro styling lives only
 * inside the terminal.
 */
export function FleetyModeSwitch({ className }: { className?: string }) {
  const navigate = useNavigate();
  return (
    <div
      className={
        "inline-flex items-center overflow-hidden rounded-md border border-border text-xs " +
        (className ?? "")
      }
      role="group"
      aria-label="Fleety mode"
    >
      <span
        className="bg-primary px-2.5 py-1 font-medium text-primary-foreground"
        aria-current="true"
      >
        Classic
      </span>
      <button
        type="button"
        className="px-2.5 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={() => navigate("/tal-9000?mode=future")}
      >
        Future
      </button>
    </div>
  );
}

export default FleetyModeSwitch;
