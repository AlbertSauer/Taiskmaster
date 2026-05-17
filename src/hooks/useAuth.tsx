import React, { createContext, useContext, useState, useEffect } from "react";

interface User {
  id: string;
  email: string;
  username: string;
  full_name?: string;
  is_active: boolean;
  created_at: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string, fullName?: string) => Promise<void>;
  updateProfile: (updates: { email?: string; username?: string; full_name?: string; password?: string; current_password?: string }) => Promise<void>;
  deleteAccount: () => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => {
    // Try to restore token from localStorage on mount
    return localStorage.getItem("authToken");
  });
  const [isLoading, setIsLoading] = useState(!!localStorage.getItem("authToken"));

  // Verify token and fetch user info on mount or when token changes
  useEffect(() => {
    const initializeAuth = async () => {
      const storedToken = localStorage.getItem("authToken");
      if (storedToken) {
        try {
          await fetchCurrentUser(storedToken);
        } catch (error) {
          console.error("Failed to restore authentication:", error);
          setToken(null);
          localStorage.removeItem("authToken");
        } finally {
          setIsLoading(false);
        }
      } else {
        setIsLoading(false);
      }
    };

    initializeAuth();
  }, []);

  const fetchCurrentUser = async (authToken: string) => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
        setToken(authToken);
      } else {
        // Token is invalid, clear it
        setToken(null);
        localStorage.removeItem("authToken");
      }
    } catch (error) {
      console.error("Failed to fetch current user:", error);
      setToken(null);
      localStorage.removeItem("authToken");
    }
  };

  const login = async (username: string, password: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Login failed");
      }

      const data = await response.json();
      setToken(data.access_token);
      localStorage.setItem("authToken", data.access_token);
      await fetchCurrentUser(data.access_token);
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (email: string, username: string, password: string, fullName?: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, username, password, full_name: fullName }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Registration failed");
      }

      const data = await response.json();
      setToken(data.access_token);
      localStorage.setItem("authToken", data.access_token);
      await fetchCurrentUser(data.access_token);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem("authToken");
  };

  const updateProfile = async (updates: { email?: string; username?: string; full_name?: string; password?: string; current_password?: string }) => {
    const authToken = token || localStorage.getItem("authToken");
    if (!authToken) throw new Error("Not authenticated");

    const response = await fetch(`${import.meta.env.VITE_API_URL}/api/auth/me`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(updates),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.detail || "Could not update profile");
    }

    if (data.access_token) {
      setToken(data.access_token);
      localStorage.setItem("authToken", data.access_token);
    }

    if (data.user) {
      setUser(data.user);
    } else {
      await fetchCurrentUser(data.access_token || authToken);
    }
  };

  const deleteAccount = async () => {
    const authToken = token || localStorage.getItem("authToken");
    if (!authToken) throw new Error("Not authenticated");

    const response = await fetch(`${import.meta.env.VITE_API_URL}/api/auth/me`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data?.detail || "Could not delete account");
    }

    // Clear auth state
    setUser(null);
    setToken(null);
    localStorage.removeItem("authToken");
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        login,
        register,
        updateProfile,
        deleteAccount,
        logout,
        isAuthenticated: !!token && !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
