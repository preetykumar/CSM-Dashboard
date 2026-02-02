import { Router, Request, Response } from "express";
import { AgentService, ConversationContext } from "../services/agent.js";

// Express user type from passport
interface AuthUser {
  id: string;
  email: string;
  name?: string;
}

export function createAgentRoutes(agentService: AgentService): Router {
  const router = Router();

  // Helper to get user from request
  const getUser = (req: Request): AuthUser => {
    const user = req.user as AuthUser | undefined;
    return user || { id: "anonymous", email: "anonymous@example.com" };
  };

  // POST /api/agent/chat - Send a message to the agent
  router.post("/chat", async (req: Request, res: Response) => {
    try {
      const { message, conversationId } = req.body;

      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message is required" });
      }

      // Get user info from session or use defaults for development
      const user = getUser(req);
      const userEmail = user.email;
      const userId = user.id;

      // Create conversation context
      const context: ConversationContext = {
        conversationId: conversationId || agentService.createConversationId(),
        userId,
        userEmail,
        channel: "web",
      };

      // Call the agent
      const response = await agentService.chat(message, context);

      res.json(response);
    } catch (error) {
      console.error("Agent chat error:", error);
      res.status(500).json({
        error: "Failed to process message",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/agent/conversations - List user's conversations
  router.get("/conversations", (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const conversations = agentService.getUserConversations(user.email);
      res.json({ conversations });
    } catch (error) {
      console.error("Get conversations error:", error);
      res.status(500).json({ error: "Failed to get conversations" });
    }
  });

  // GET /api/agent/conversations/:id - Get conversation history
  router.get("/conversations/:id", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const messages = agentService.getConversationHistory(id);
      res.json({ messages });
    } catch (error) {
      console.error("Get conversation history error:", error);
      res.status(500).json({ error: "Failed to get conversation history" });
    }
  });

  // DELETE /api/agent/conversations/:id - Delete a conversation
  router.delete("/conversations/:id", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      agentService.deleteConversation(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete conversation error:", error);
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  });

  return router;
}
