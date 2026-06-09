import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthErrorMessage } from "../../ui/AuthErrorMessage";
import { AUTH_ERROR_CODES } from "../../domain/auth-codes";

describe("AuthErrorMessage", () => {
  it("renders copy for every AuthErrorCode", () => {
    for (const code of AUTH_ERROR_CODES) {
      const { unmount } = render(
        <AuthErrorMessage error={{ code, correlationId: "c1" }} />,
      );
      const el = screen.getByTestId("auth-error-message");
      expect(el.getAttribute("data-auth-code")).toBe(code);
      expect(el.textContent ?? "").not.toBe("");
      unmount();
    }
  });
});
