import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { LoginPage } from "./LoginPage";

// Mock the AuthContext
vi.mock("../contexts/AuthContext", () => ({
  useAuth: vi.fn(() => ({
    login: vi.fn(),
    loading: false,
  })),
}));

describe("LoginPage", () => {
  describe("Accessibility", () => {
    it("should have no accessibility violations", async () => {
      const { container } = render(<LoginPage />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("should have no accessibility violations in loading state", async () => {
      // Override mock for loading state
      const { useAuth } = await import("../contexts/AuthContext");
      vi.mocked(useAuth).mockReturnValue({
        login: vi.fn(),
        loading: true,
        user: null,
        authenticated: false,
        authEnabled: true,
        isAdmin: false,
        logout: vi.fn(),
      });

      const { container } = render(<LoginPage />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe("Functionality", () => {
    it("should render the login page with heading", () => {
      render(<LoginPage />);
      expect(screen.getByRole("heading", { name: /zendesk dashboard/i })).toBeInTheDocument();
    });

    it("should render the Google sign-in button", () => {
      render(<LoginPage />);
      expect(screen.getByRole("button", { name: /sign in with google/i })).toBeInTheDocument();
    });

    it("should display domain restriction notice", () => {
      render(<LoginPage />);
      expect(screen.getByText(/only @deque.com accounts are allowed/i)).toBeInTheDocument();
    });
  });
});
