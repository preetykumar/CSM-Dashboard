import { useState, useRef, useEffect } from "react";
import { useChat } from "../../contexts/ChatContext";

export function ChatWindow() {
  const {
    messages,
    isLoading,
    error,
    sendMessage,
    clearConversation,
    closeChat,
  } = useChat();

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when chat opens
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const message = input.trim();
    setInput("");
    await sendMessage(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Suggested prompts for empty state
  const suggestions = [
    "Show my portfolio summary",
    "List escalated tickets",
    "Customer summary for Adobe",
    "Search tickets about accessibility",
  ];

  return (
    <div className="chat-window">
      {/* Header */}
      <div className="chat-header">
        <div className="chat-header-title">
          <span className="chat-header-icon">AI</span>
          <span>CSM Assistant</span>
        </div>
        <div className="chat-header-actions">
          <button
            className="chat-header-button"
            onClick={clearConversation}
            title="New conversation"
            disabled={messages.length === 0}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
            </svg>
          </button>
          <button
            className="chat-header-button"
            onClick={closeChat}
            title="Close"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-icon">AI</div>
            <h3>How can I help you today?</h3>
            <p>Ask me about tickets, customers, or your portfolio.</p>
            <div className="chat-suggestions">
              {suggestions.map((suggestion, i) => (
                <button
                  key={i}
                  className="chat-suggestion"
                  onClick={() => {
                    setInput(suggestion);
                    inputRef.current?.focus();
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <div key={i} className={`chat-message ${msg.role}`}>
                <div className="chat-message-avatar">
                  {msg.role === "user" ? "You" : "AI"}
                </div>
                <div className="chat-message-content">
                  <MessageContent content={msg.content} />
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="chat-message assistant">
                <div className="chat-message-avatar">AI</div>
                <div className="chat-message-content">
                  <div className="chat-typing">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="chat-error">
          {error}
        </div>
      )}

      {/* Input area */}
      <form className="chat-input-form" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about tickets, customers, or your portfolio..."
          rows={1}
          disabled={isLoading}
        />
        <button
          type="submit"
          className="chat-send-button"
          disabled={!input.trim() || isLoading}
          title="Send message"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </form>
    </div>
  );
}

// Component to render message content with basic markdown-like formatting
function MessageContent({ content }: { content: string }) {
  // Split by code blocks and render appropriately
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("```") && part.endsWith("```")) {
          // Code block
          const code = part.slice(3, -3);
          const lines = code.split("\n");
          const language = lines[0].trim();
          const codeContent = language ? lines.slice(1).join("\n") : code;

          return (
            <pre key={i} className="chat-code-block">
              <code>{codeContent.trim()}</code>
            </pre>
          );
        } else {
          // Regular text - handle bullet points and basic formatting
          return (
            <div key={i} className="chat-text">
              {part.split("\n").map((line, j) => {
                // Handle bullet points
                if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
                  return (
                    <div key={j} className="chat-bullet">
                      {line.trim().slice(2)}
                    </div>
                  );
                }
                // Handle numbered lists
                if (/^\d+\.\s/.test(line.trim())) {
                  return (
                    <div key={j} className="chat-numbered">
                      {line.trim()}
                    </div>
                  );
                }
                // Handle bold text
                const formattedLine = line.replace(
                  /\*\*(.*?)\*\*/g,
                  "<strong>$1</strong>"
                );
                if (formattedLine !== line) {
                  return (
                    <p
                      key={j}
                      dangerouslySetInnerHTML={{ __html: formattedLine }}
                    />
                  );
                }
                // Regular paragraph
                return line.trim() ? <p key={j}>{line}</p> : <br key={j} />;
              })}
            </div>
          );
        }
      })}
    </>
  );
}
