import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import {
  sendChatMessage,
  fetchChatConversations,
  fetchConversationHistory,
  deleteChatConversation,
  ChatMessage,
  ChatConversation,
} from "../services/api";

interface ChatContextType {
  // State
  isOpen: boolean;
  messages: ChatMessage[];
  conversationId: string | null;
  conversations: ChatConversation[];
  isLoading: boolean;
  error: string | null;

  // Actions
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
  sendMessage: (message: string) => Promise<void>;
  clearConversation: () => void;
  loadConversation: (id: string) => Promise<void>;
  loadConversations: () => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openChat = useCallback(() => setIsOpen(true), []);
  const closeChat = useCallback(() => setIsOpen(false), []);
  const toggleChat = useCallback(() => setIsOpen((prev) => !prev), []);

  const sendMessage = useCallback(async (message: string) => {
    if (!message.trim()) return;

    setIsLoading(true);
    setError(null);

    // Add user message immediately for better UX
    const userMessage: ChatMessage = { role: "user", content: message };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const response = await sendChatMessage(message, conversationId || undefined);

      // Update conversation ID if this is a new conversation
      if (!conversationId) {
        setConversationId(response.conversationId);
      }

      // Add assistant response
      const assistantMessage: ChatMessage = { role: "assistant", content: response.response };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to send message";
      setError(errorMessage);
      // Remove the user message on error
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
    }
  }, [conversationId]);

  const clearConversation = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setError(null);
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const history = await fetchConversationHistory(id);
      setMessages(history);
      setConversationId(id);
    } catch (err) {
      setError("Failed to load conversation");
      console.error("Error loading conversation:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const convos = await fetchChatConversations();
      setConversations(convos);
    } catch (err) {
      console.error("Error loading conversations:", err);
    }
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    try {
      await deleteChatConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (conversationId === id) {
        clearConversation();
      }
    } catch (err) {
      console.error("Error deleting conversation:", err);
    }
  }, [conversationId, clearConversation]);

  return (
    <ChatContext.Provider
      value={{
        isOpen,
        messages,
        conversationId,
        conversations,
        isLoading,
        error,
        openChat,
        closeChat,
        toggleChat,
        sendMessage,
        clearConversation,
        loadConversation,
        loadConversations,
        deleteConversation,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
}
