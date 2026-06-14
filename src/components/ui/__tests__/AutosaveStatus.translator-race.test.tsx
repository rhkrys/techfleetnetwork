/**
 * TRANSLATOR-VOLATILE-002
 *
 * Drives AutosaveStatus through idle → saving → saved → error transitions and
 * asserts:
 *  - The pill wrapper carries data-no-translate, translate="no",
 *    aria-live="polite", and role="status" (the four-key contract).
 *  - Re-renders never throw NotFoundError: removeChild (the production bug).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AutosaveStatus } from "@/components/ui/AutosaveStatus";

describe("AutosaveStatus / translator race", () => {
  it("renders the four-key skip contract on every non-idle state", () => {
    const { rerender } = render(<AutosaveStatus status="saving" lastSavedAt={null} />);
    for (const status of ["saving", "dirty", "saved", "error"] as const) {
      rerender(<AutosaveStatus status={status} lastSavedAt={new Date()} />);
      const pill = screen.getByRole("status");
      expect(pill.getAttribute("aria-live")).toBe("polite");
      expect(pill.getAttribute("translate")).toBe("no");
      expect(pill.hasAttribute("data-no-translate")).toBe(true);
    }
  });

  it("cycles idle → saving → saved → error without throwing", () => {
    const onError = vi.fn();
    const orig = window.onerror;
    window.onerror = onError;
    try {
      const { rerender } = render(<AutosaveStatus status="idle" lastSavedAt={null} />);
      rerender(<AutosaveStatus status="saving" lastSavedAt={null} />);
      rerender(<AutosaveStatus status="saved" lastSavedAt={new Date()} />);
      rerender(<AutosaveStatus status="error" lastSavedAt={new Date()} onRetry={() => {}} />);
      rerender(<AutosaveStatus status="idle" lastSavedAt={null} />);
    } finally {
      window.onerror = orig;
    }
    expect(onError).not.toHaveBeenCalled();
  });
});
