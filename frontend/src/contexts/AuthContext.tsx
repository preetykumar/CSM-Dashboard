import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { AuthUser, getAuthStatus, getAuthConfig, logout as logoutApi, getLoginUrl } from "../services/auth";

interface AuthContextType {
  user: AuthUser | null;
  authenticated: boolean;
  authEnabled: boolean;
  isAdmin: boolean;
  loading: boolean;
  login: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      try {
        const [config, status] = await Promise.all([getAuthConfig(), getAuthStatus()]);

        setAuthEnabled(config.authEnabled);
        setAuthenticated(status.authenticated);
        setUser(status.user);
        setIsAdmin(status.isAdmin);
      } catch (error) {
        console.error("Error checking auth:", error);
        setAuthEnabled(false);
        setAuthenticated(false);
        setUser(null);
        setIsAdmin(false);
      } finally {
        setLoading(false);
      }
    }

    checkAuth();
  }, []);

  const login = () => {
    window.location.href = getLoginUrl();
  };

  const logout = async () => {
    await logoutApi();
    setAuthenticated(false);
    setUser(null);
    setIsAdmin(false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        authenticated,
        authEnabled,
        isAdmin,
        loading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
