import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "./test-utils";

const { mockGetEmailPipelineHealth, mockGetEmailReconcilerStatus } = vi.hoisted(() => ({
  mockGetEmailPipelineHealth: vi.fn(),
  mockGetEmailReconcilerStatus: vi.fn(),
}));

vi.mock("@/services/system-health.service", () => ({
  SystemHealthService: {
    getEmailPipelineHealth: mockGetEmailPipelineHealth,
    getEmailReconcilerStatus: mockGetEmailReconcilerStatus,
  },
}));

vi.mock("@/hooks/use-system-health-realtime", () => ({
  useSystemHealthRealtime: vi.fn(),
}));

import SystemHealthPage from "@/pages/SystemHealthPage";

describe("SystemHealthPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEmailPipelineHealth.mockResolvedValue({
      generated_at: new Date().toISOString(),
      window_hours: 24,
      health: { status: "degraded", reason: "Recent email failures need admin review." },
      send_state: {
        retry_after_until: null,
        batch_size: 10,
        send_delay_ms: 200,
        auth_email_ttl_minutes: 15,
        transactional_email_ttl_minutes: 60,
        updated_at: new Date().toISOString(),
      },
      queue_stats: [
        { queue_name: "auth_emails", queued: 2, ready: 1, delayed_or_inflight: 1, max_attempts: 3, oldest_enqueued_at: new Date().toISOString(), archived_last_24h: 8 },
        { queue_name: "transactional_emails", queued: 0, ready: 0, delayed_or_inflight: 0, max_attempts: 0, oldest_enqueued_at: null, archived_last_24h: 4 },
      ],
      delivery_totals: { total: 12, sent: 9, failed: 2, pending: 1, suppressed: 0, bounced: 0, complained: 0 },
      recent_errors: [
        { error_message: "Provider rejected the sender domain", status: "failed", occurrences: 2, last_seen: new Date().toISOString() },
      ],
      recent_logs: [
        { message_id: "msg-1", template_name: "recovery", recipient_email: "member@example.com", status: "failed", error_message: "Provider rejected the sender domain", created_at: new Date().toISOString() },
      ],
    });
    mockGetEmailReconcilerStatus.mockResolvedValue({
      stuck_pending: 0,
      last_run_at: new Date().toISOString(),
      last_run: { reconciled_terminal: 0, requeued: 0, dlq_lost: 0, left_in_queue: 0, checked: 0 },
      last_severity: "info",
    });
  });

  it("SYS-HEALTH-EMAIL-PIPELINE-001: shows admin email pipeline status, queues, delivery, and errors", async () => {
    const user = userEvent.setup();
    renderWithRouter(<SystemHealthPage />);

    expect(await screen.findByRole("heading", { name: "System Health" })).toBeInTheDocument();
    expect(screen.getByText("Recent email failures need admin review.")).toBeInTheDocument();
    expect(screen.getByText("Unique Emails")).toBeInTheDocument();
    expect(screen.getByText("Stuck pending (>10 min)")).toBeInTheDocument();
    expect(screen.getByText("Failure Rate")).toBeInTheDocument();
    expect(screen.getByText("auth emails")).toBeInTheDocument();
    expect(screen.getByText("transactional emails")).toBeInTheDocument();

    const deliveryTab = screen.getByRole("tab", { name: "Delivery" });
    await user.click(deliveryTab);
    expect(await screen.findByText("member@example.com")).toBeInTheDocument();

    const errorsTab = screen.getByRole("tab", { name: "Errors" });
    await user.click(errorsTab);
    const errorsPanel = await screen.findByRole("tabpanel");
    expect(within(errorsPanel).getByText("Provider rejected the sender domain")).toBeInTheDocument();
  });
});