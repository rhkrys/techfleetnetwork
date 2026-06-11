/**
 * AUTH-RESET-LOGIN-COPY-001 — regression for the "Sign-in didn't
 * complete cleanly" wording. After the 2026-06-11 re-code, the
 * client_session_write_failed branch must use member-safe copy that
 * (a) reassures the account is safe, (b) tells the member to retry
 * verification, and (c) points at Google / magic-link as fallback.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthErrorMessage } from "../AuthErrorMessage";

describe("AuthErrorMessage — client_session_write_failed copy", () => {
  it("uses 'We need to retry sign-in' title and never the legacy 'didn't complete cleanly' wording", () => {
    render(
      <AuthErrorMessage
        error={{ code: "client_session_write_failed", correlationId: "test" }}
      />,
    );
    expect(screen.getByText(/We need to retry sign-in/i)).toBeInTheDocument();
    expect(screen.getByText(/Your account is safe/i)).toBeInTheDocument();
    expect(screen.getByText(/Google sign-in or request a sign-in link/i)).toBeInTheDocument();
    expect(screen.queryByText(/didn't complete cleanly/i)).not.toBeInTheDocument();
  });
});
