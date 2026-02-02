import { useChat } from "../../contexts/ChatContext";
import { ChatWindow } from "./ChatWindow";
import "./chat.css";

export function ChatWidget() {
  const { isOpen, toggleChat } = useChat();

  return (
    <>
      {/* Floating chat button */}
      <button
        className={`chat-widget-button ${isOpen ? "open" : ""}`}
        onClick={toggleChat}
        aria-label={isOpen ? "Close chat" : "Open AI assistant"}
        title={isOpen ? "Close chat" : "Ask the AI assistant"}
      >
        {isOpen ? (
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
            <circle cx="12" cy="10" r="1.5" />
            <circle cx="8" cy="10" r="1.5" />
            <circle cx="16" cy="10" r="1.5" />
          </svg>
        )}
      </button>

      {/* Chat window */}
      {isOpen && <ChatWindow />}
    </>
  );
}
