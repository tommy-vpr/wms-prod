import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";

export type UserRole = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "STAFF";

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  active: boolean;
  createdAt: string;
}

interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

interface UpdateUserInput {
  name?: string;
  email?: string;
  password?: string;
  role?: UserRole;
  active?: boolean;
}

export function useUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ users: User[] }>("/admin/users");
      setUsers(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch users");
    } finally {
      setLoading(false);
    }
  }, []);

  const createUser = useCallback(async (input: CreateUserInput) => {
    const data = await api<{ user: User }>("/admin/users", {
      method: "POST",
      body: JSON.stringify(input),
    });
    setUsers((prev) => [data.user, ...prev]);
    return data.user;
  }, []);

  const updateUser = useCallback(async (id: string, input: UpdateUserInput) => {
    const data = await api<{ user: User }>(`/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    setUsers((prev) => prev.map((u) => (u.id === id ? data.user : u)));
    return data.user;
  }, []);

  const deactivateUser = useCallback(async (id: string) => {
    await api(`/admin/users/${id}`, { method: "DELETE" });
    setUsers((prev) =>
      prev.map((u) => (u.id === id ? { ...u, active: false } : u)),
    );
  }, []);

  const activateUser = useCallback(async (id: string) => {
    const data = await api<{ user: User }>(`/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: true }),
    });
    setUsers((prev) => prev.map((u) => (u.id === id ? data.user : u)));
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  return {
    users,
    loading,
    error,
    refetch: fetchUsers,
    createUser,
    updateUser,
    deactivateUser,
    activateUser,
  };
}
