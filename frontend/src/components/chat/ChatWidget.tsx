import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useChat } from "../../contexts/ChatContext";
import { ChatWindow } from "./ChatWindow";
import "./chat.css";

export function ChatWidget() {
  const { isOpen, toggleChat } = useChat();
  const [poppedOut, setPoppedOut] = useState(false);

  // Closing the chat also docks it back in (so reopening starts docked).
  useEffect(() => {
    if (!isOpen) setPoppedOut(false);
  }, [isOpen]);

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

      {/* Chat window — docked inline, or portaled into a separate window */}
      {isOpen && !poppedOut && (
        <ChatWindow onTogglePopout={() => setPoppedOut(true)} />
      )}
      {isOpen && poppedOut && (
        <ChatPortal onClose={() => setPoppedOut(false)}>
          <ChatWindow popout onTogglePopout={() => setPoppedOut(false)} />
        </ChatPortal>
      )}
    </>
  );
}

/**
 * Renders children into a separate browser window via a React portal. Because
 * the component stays in the React tree, all state and context (chat history,
 * loading, etc.) stay in sync between the docked and popped-out views. Closing
 * the popup — or unmounting — docks back in.
 */
function ChatPortal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const win = window.open(
      "",
      "csm-chat-popout",
      "width=440,height=680,menubar=no,toolbar=no,location=no,status=no,resizable=yes",
    );
    if (!win) {
      // Popup blocked by the browser — fall back to the docked view.
      onCloseRef.current();
      return;
    }

    win.document.title = "CSM Assistant";
    win.document.body.style.margin = "0";
    // Clone the parent document's styles so the chat renders identically.
    document
      .querySelectorAll('style, link[rel="stylesheet"]')
      .forEach((node) => win.document.head.appendChild(node.cloneNode(true)));

    const el = win.document.createElement("div");
    el.className = "chat-popout-root";
    win.document.body.appendChild(el);
    setContainer(el);

    // Detect the user closing the popup, and take it down if the parent unloads.
    const poll = win.setInterval(() => {
      if (win.closed) onCloseRef.current();
    }, 400);
    const closePopup = () => win.close();
    window.addEventListener("beforeunload", closePopup);

    return () => {
      win.clearInterval(poll);
      window.removeEventListener("beforeunload", closePopup);
      win.close();
    };
  }, []);

  return container ? createPortal(children, container) : null;
}
