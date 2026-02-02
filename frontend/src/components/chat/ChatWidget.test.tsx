import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { ChatWidget } from "./ChatWidget";

// Mock the ChatContext
const mockToggleChat = vi.fn();
const mockUseChat = vi.fn();

vi.mock("../../contexts/ChatContext", () => ({
  useChat: () => mockUseChat(),
}));

describe("ChatWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseChat.mockReturnValue({
      isOpen: false,
      toggleChat: mockToggleChat,
      messages: [],
      isLoading: false,
      error: null,
      sendMessage: vi.fn(),
      clearConversation: vi.fn(),
    });
  });

  describe("Accessibility", () => {
    it("should have no accessibility violations when closed", async () => {
      const { container } = render(<ChatWidget />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("should have no accessibility violations when open", async () => {
      mockUseChat.mockReturnValue({
        isOpen: true,
        toggleChat: mockToggleChat,
        messages: [],
        isLoading: false,
        error: null,
        sendMessage: vi.fn(),
        clearConversation: vi.fn(),
        closeChat: vi.fn(),
      });

      const { container } = render(<ChatWidget />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("should have no accessibility violations with messages", async () => {
      mockUseChat.mockReturnValue({
        isOpen: true,
        toggleChat: mockToggleChat,
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there! How can I help you?" },
        ],
        isLoading: false,
        error: null,
        sendMessage: vi.fn(),
        clearConversation: vi.fn(),
        closeChat: vi.fn(),
      });

      const { container } = render(<ChatWidget />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("should have no accessibility violations in loading state", async () => {
      mockUseChat.mockReturnValue({
        isOpen: true,
        toggleChat: mockToggleChat,
        messages: [{ role: "user", content: "Hello" }],
        isLoading: true,
        error: null,
        sendMessage: vi.fn(),
        clearConversation: vi.fn(),
        closeChat: vi.fn(),
      });

      const { container } = render(<ChatWidget />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("should have no accessibility violations with error", async () => {
      mockUseChat.mockReturnValue({
        isOpen: true,
        toggleChat: mockToggleChat,
        messages: [],
        isLoading: false,
        error: "Failed to send message",
        sendMessage: vi.fn(),
        clearConversation: vi.fn(),
        closeChat: vi.fn(),
      });

      const { container } = render(<ChatWidget />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe("Functionality", () => {
    it("should render the chat toggle button", () => {
      render(<ChatWidget />);
      expect(screen.getByRole("button")).toBeInTheDocument();
    });

    it("should call toggleChat when button is clicked", async () => {
      const user = userEvent.setup();
      render(<ChatWidget />);

      await user.click(screen.getByRole("button"));
      expect(mockToggleChat).toHaveBeenCalled();
    });
  });
});
