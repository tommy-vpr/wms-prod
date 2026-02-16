/**
 * Auth Context & Hooks
 * Manages user session, tokens, login/logout
 *
 * Save to: apps/web/src/lib/auth.tsx
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import type { UserRole } from "@wms/types";

// ============================================================================
// Types
// ============================================================================

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<boolean>;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

// ============================================================================
// Constants
// ============================================================================

const API_BASE = import.meta.env.VITE_API_URL || "/api";
const TOKEN_KEY = "wms_tokens";
const USER_KEY = "wms_user";

// ============================================================================
// Token Storage
// ============================================================================

function getStoredTokens(): AuthTokens | null {
  try {
    const stored = localStorage.getItem(TOKEN_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function setStoredTokens(tokens: AuthTokens): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

function clearStoredTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
}

function getStoredUser(): User | null {
  try {
    const stored = localStorage.getItem(USER_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function setStoredUser(user: User): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearStoredUser(): void {
  localStorage.removeItem(USER_KEY);
}

// ============================================================================
// JWT Helpers
// ============================================================================

function parseJwt(
  token: string,
): { exp: number; [key: string]: unknown } | null {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join(""),
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

function isTokenExpired(token: string, bufferSeconds = 60): boolean {
  const payload = parseJwt(token);
  if (!payload?.exp) return true;
  return Date.now() >= (payload.exp - bufferSeconds) * 1000;
}

// ============================================================================
// Context
// ============================================================================

const AuthContext = createContext<AuthContextType | null>(null);

// ============================================================================
// Provider
// ============================================================================

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(getStoredUser);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  // Initialize auth state
  useEffect(() => {
    const initAuth = async () => {
      const tokens = getStoredTokens();
      const storedUser = getStoredUser();

      if (!tokens || !storedUser) {
        setIsLoading(false);
        return;
      }

      // Check if access token is expired
      if (isTokenExpired(tokens.accessToken)) {
        // Try to refresh
        const refreshed = await refreshSession();
        if (!refreshed) {
          // Refresh failed, clear everything
          clearStoredTokens();
          clearStoredUser();
          setUser(null);
        }
      } else {
        setUser(storedUser);
      }

      setIsLoading(false);
    };

    initAuth();
  }, []);

  // Refresh session
  const refreshSession = useCallback(async (): Promise<boolean> => {
    const tokens = getStoredTokens();
    if (!tokens?.refreshToken) return false;

    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });

      if (!response.ok) return false;

      const data = await response.json();
      setStoredTokens({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      });

      return true;
    } catch {
      return false;
    }
  }, []);

  // Login
  const login = useCallback(async (email: string, password: string) => {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || "Login failed");
    }

    setStoredTokens({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });
    setStoredUser(data.user);
    setUser(data.user);
  }, []);

  // Signup
  const signup = useCallback(
    async (name: string, email: string, password: string) => {
      const response = await fetch(`${API_BASE}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || "Signup failed");
      }

      // Auto-login after signup
      await login(email, password);
    },
    [login],
  );

  // Logout
  const logout = useCallback(async () => {
    const tokens = getStoredTokens();

    if (tokens?.refreshToken) {
      try {
        await fetch(`${API_BASE}/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: tokens.refreshToken }),
        });
      } catch {
        // Ignore errors, clear local state anyway
      }
    }

    clearStoredTokens();
    clearStoredUser();
    setUser(null);
    navigate("/login");
  }, [navigate]);

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    signup,
    logout,
    refreshSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Get auth context
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

/**
 * Get current user (throws if not authenticated)
 */
export function useUser(): User {
  const { user } = useAuth();
  if (!user) {
    throw new Error("useUser must be used when authenticated");
  }
  return user;
}

/**
 * Check if user has required role
 */
export function useHasRole(allowedRoles: UserRole[]): boolean {
  const { user } = useAuth();
  if (!user) return false;
  return allowedRoles.includes(user.role);
}

/**
 * Get access token (auto-refreshes if expired)
 */
export function useAccessToken(): () => Promise<string | null> {
  const { refreshSession } = useAuth();

  return useCallback(async () => {
    const tokens = getStoredTokens();
    if (!tokens?.accessToken) return null;

    // Refresh if expired
    if (isTokenExpired(tokens.accessToken)) {
      const refreshed = await refreshSession();
      if (!refreshed) return null;

      const newTokens = getStoredTokens();
      return newTokens?.accessToken || null;
    }

    return tokens.accessToken;
  }, [refreshSession]);
}

// ============================================================================
// API Fetch Helper
// ============================================================================

/**
 * Authenticated fetch wrapper
 */
export async function authFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const tokens = getStoredTokens();

  const headers = new Headers(options.headers);

  if (tokens?.accessToken) {
    headers.set("Authorization", `Bearer ${tokens.accessToken}`);
  }

  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }

  let response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers,
  });

  // If 401 and we have a refresh token, try to refresh and retry
  if (response.status === 401 && tokens?.refreshToken) {
    const refreshResponse = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });

    if (refreshResponse.ok) {
      const data = await refreshResponse.json();
      setStoredTokens({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      });

      // Retry original request
      headers.set("Authorization", `Bearer ${data.accessToken}`);
      response = await fetch(`${API_BASE}${url}`, {
        ...options,
        headers,
      });
    } else {
      // Refresh failed, clear tokens
      clearStoredTokens();
      clearStoredUser();
      window.location.href = "/login";
    }
  }

  return response;
}

/**
 * Hook version of authFetch
 */
export function useAuthFetch() {
  return useCallback(
    (url: string, options?: RequestInit) => authFetch(url, options),
    [],
  );
}
