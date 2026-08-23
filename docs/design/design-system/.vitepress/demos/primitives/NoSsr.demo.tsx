import { NoSsr } from "@/design-system";

export default function NoSsrDemo() {
  return (
    <div style={{ fontSize: 14, lineHeight: 1.8 }}>
      <div>Always rendered (server + client).</div>
      <NoSsr>
        <div>
          <strong>Client-only</strong> — skipped during server-side rendering.
        </div>
      </NoSsr>
    </div>
  );
}
