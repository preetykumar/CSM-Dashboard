import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { UserMenu } from "./UserMenu";

// Mock the AuthContext
const mockLogout = vi.fn();
const mockUseAuth = vi.fn();

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

describe("UserMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Accessibility", () => {
    it("should have no accessibility violations when authenticated", async () => {
      mockUseAuth.mockReturnValue({
        user: { name: "Test User", email: "test@deque.com", picture: null },
        logout: mockLogout,
        authEnabled: true,
      });

      const { container } = render(<UserMenu />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("should have no accessibility violations when menu is open", async () => {
      mockUseAuth.mockReturnValue({
        user: { name: "Test User", email: "test@deque.com", picture: null },
        logout: mockLogout,
        authEnabled: true,
      });

      const user = userEvent.setup();
      const { container } = render(<UserMenu />);

      // Open the menu
      await user.click(screen.getByRole("button"));

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("should have no accessibility violations with user avatar", async () => {
      mockUseAuth.mockReturnValue({
        user: {
          name: "Test User",
          email: "test@deque.com",
          picture: "https://example.com/avatar.jpg",
        },
        logout: mockLogout,
        authEnabled: true,
      });

      const { container } = render(<UserMenu />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe("Functionality", () => {
    it("should render nothing when auth is disabled", () => {
      mockUseAuth.mockReturnValue({
        user: null,
        logout: mockLogout,
        authEnabled: false,
      });

      const { container } = render(<UserMenu />);
      expect(container.firstChild).toBeNull();
    });

    it("should render nothing when user is not authenticated", () => {
      mockUseAuth.mockReturnValue({
        user: null,
        logout: mockLogout,
        authEnabled: true,
      });

      const { container } = render(<UserMenu />);
      expect(container.firstChild).toBeNull();
    });

    it("should display user name when authenticated", () => {
      mockUseAuth.mockReturnValue({
        user: { name: "Test User", email: "test@deque.com", picture: null },
        logout: mockLogout,
        authEnabled: true,
      });

      render(<UserMenu />);
      expect(screen.getByText("Test User")).toBeInTheDocument();
    });

    it("should toggle dropdown menu on click", async () => {
      mockUseAuth.mockReturnValue({
        user: { name: "Test User", email: "test@deque.com", picture: null },
        logout: mockLogout,
        authEnabled: true,
      });

      const user = userEvent.setup();
      render(<UserMenu />);

      // Menu should not be visible initially
      expect(screen.queryByText("Sign out")).not.toBeInTheDocument();

      // Click to open menu
      await user.click(screen.getByRole("button"));
      expect(screen.getByText("Sign out")).toBeInTheDocument();

      // Click again to close menu
      await user.click(screen.getByRole("button", { name: /test user/i }));
      expect(screen.queryByText("Sign out")).not.toBeInTheDocument();
    });

    it("should call logout when sign out is clicked", async () => {
      mockUseAuth.mockReturnValue({
        user: { name: "Test User", email: "test@deque.com", picture: null },
        logout: mockLogout,
        authEnabled: true,
      });

      const user = userEvent.setup();
      render(<UserMenu />);

      // Open menu and click sign out
      await user.click(screen.getByRole("button"));
      await user.click(screen.getByText("Sign out"));

      expect(mockLogout).toHaveBeenCalled();
    });
  });
});
