const API_BASE = import.meta.env.VITE_API_URL || "/api";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
  domain: string;
}

export interface AuthStatus {
  authenticated: boolean;
  user: AuthUser | null;
  isAdmin: boolean;
}

export interface AuthConfig {
  authEnabled: boolean;
  authenticated: boolean;
  allowedDomain: string;
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    credentials: "include",
  });
  if (!res.ok) {
    return { authenticated: false, user: null, isAdmin: false };
  }
  return res.json();
}

export async function getAuthConfig(): Promise<AuthConfig> {
  const res = await fetch(`${API_BASE}/auth/status`, {
    credentials: "include",
  });
  if (!res.ok) {
    return { authEnabled: false, authenticated: false, allowedDomain: "deque.com" };
  }
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

export function getLoginUrl(): string {
  return `${API_BASE}/auth/google`;
}
