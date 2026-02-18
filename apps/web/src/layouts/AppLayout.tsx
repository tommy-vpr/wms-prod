/**
 * App Layout with Auth Integration
 *
 * - Uses auth context for user/logout
 * - Role-based navigation
 * - Compact mode toggle
 *
 * Save to: apps/web/src/layouts/AppLayout.tsx
 */

import { Outlet, NavLink, useLocation, Navigate } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Warehouse,
  Users,
  Settings,
  LogOut,
  Menu,
  X,
  ClipboardList,
  Truck,
  BarChart3,
  PackageCheck,
  PackagePlus,
  ScanLine,
  Bell,
  User,
  ChevronDown,
  Minimize2,
  Maximize2,
  type LucideIcon,
  ScanBarcode,
  Import,
  Shield,
  ShieldCheck,
  MapPin,
  Combine,
  RefreshCw,
} from "lucide-react";
import { useState, createContext, useContext, useEffect } from "react";
import { useAuth, type User as AuthUser } from "../lib/auth";
import { useWorkflowCounts } from "../hooks/useWorkflowCounts";
import type { UserRole } from "@wms/types";

import logo from "@/assets/headquarter-logo.png";

// ============================================================================
// Types
// ============================================================================

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles?: UserRole[];
  fullOnly?: boolean;
}

interface LayoutContextType {
  compactMode: boolean;
  setCompactMode: (value: boolean) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (value: boolean) => void;
}

// ============================================================================
// Layout Context (for compact mode, sidebar state)
// ============================================================================

const LayoutContext = createContext<LayoutContextType | null>(null);

export function useLayout() {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error("useLayout must be used within AppLayout");
  }
  return context;
}

// Combined hook for layout + auth
export function useAppContext() {
  const layout = useLayout();
  const auth = useAuth();
  return { ...layout, ...auth };
}

// ============================================================================
// Navigation Configuration
// ============================================================================

const allNavItems: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/fulfillment", label: "Fulfilment", icon: Combine },
  { to: "/tasks", label: "My Tasks", icon: ClipboardList },
  { to: "/pick", label: "Pick", icon: PackageCheck },
  { to: "/pack", label: "Pack", icon: Package },
  { to: "/receiving", label: "Receive", icon: PackagePlus },
  { to: "/cycle-count", label: "Cycle Count", icon: RefreshCw },
  { to: "/scan", label: "Scan", icon: ScanBarcode },
  {
    to: "/create-staff",
    label: "Create Staff",
    icon: User,
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"],
  },
  {
    to: "/orders",
    label: "Orders",
    icon: ShoppingCart,
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"],
  },
  {
    to: "/products",
    label: "Products",
    icon: Package,
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"],
  },
  {
    to: "/inventory",
    label: "Inventory",
    icon: Warehouse,
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"],
  },
  {
    to: "/locations",
    label: "Locations",
    icon: MapPin,
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"],
  },
  {
    to: "/shipping",
    label: "Shipping",
    icon: Truck,
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"],
  },
  {
    to: "/reports",
    label: "Reports",
    icon: BarChart3,
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"],
    fullOnly: true,
  },
  {
    to: "/users",
    label: "Users",
    icon: Users,
    roles: ["SUPER_ADMIN", "ADMIN"],
    fullOnly: true,
  },
  {
    to: "/settings",
    label: "Settings",
    icon: Settings,
    roles: ["SUPER_ADMIN", "ADMIN"],
    fullOnly: true,
  },
];

const compactNavItems: NavItem[] = [
  { to: "/dashboard", label: "Home", icon: LayoutDashboard },
  { to: "/fulfillment", label: "Fulfilment", icon: Combine },
  { to: "/tasks", label: "Tasks", icon: ClipboardList },
  { to: "/pick", label: "Pick", icon: PackageCheck },
  { to: "/pack", label: "Pack", icon: Package },
  { to: "/receiving", label: "Receive", icon: PackagePlus },
  { to: "/cycle-count", label: "Cycle Count", icon: RefreshCw },
  { to: "/scan", label: "Scan", icon: ScanBarcode },
];

function getNavItemsForRole(role: UserRole, compactMode: boolean): NavItem[] {
  return allNavItems.filter((item) => {
    if (item.roles && !item.roles.includes(role)) return false;
    if (compactMode && item.fullOnly) return false;
    return true;
  });
}

// ============================================================================
// Count Badge Component
// ============================================================================

function CountBadge({
  count,
  compact = false,
}: {
  count: number;
  compact?: boolean;
}) {
  if (count <= 0) return null;
  const display = count > 99 ? "99+" : String(count);

  if (compact) {
    // Small dot-style badge for compact bottom nav
    return (
      <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center bg-violet-500 text-white text-[10px] font-bold rounded-full px-1 leading-none">
        {display}
      </span>
    );
  }

  // Sidebar pill badge
  return (
    <span className="ml-auto min-w-[20px] h-5 flex items-center justify-center bg-violet-500 text-white text-[10px] font-bold rounded-full px-1.5 leading-none">
      {display}
    </span>
  );
}

// ============================================================================
// AppLayout Component
// ============================================================================

export function AppLayout() {
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const location = useLocation();

  const [compactMode, setCompactMode] = useState(() => {
    return localStorage.getItem("compactMode") === "true";
  });
  const [sidebarOpen, setSidebarOpen] = useState(!compactMode);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const counts = useWorkflowCounts(30_000); // Poll every 30s

  // Persist compact mode
  useEffect(() => {
    localStorage.setItem("compactMode", String(compactMode));
    if (compactMode) setSidebarOpen(false);
  }, [compactMode]);

  // Close user menu on route change
  useEffect(() => {
    setUserMenuOpen(false);
  }, [location.pathname]);

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const navItems = getNavItemsForRole(user.role, compactMode);

  /** Map nav route → count value. 0 = no badge. */
  function getBadgeCount(to: string): number {
    switch (to) {
      case "/fulfillment":
        return counts.pick + counts.pack + counts.ship; // Active pipeline only
      case "/pick":
        return counts.pick;
      case "/pack":
        return counts.pack;
      case "/shipping":
        return counts.ship;
      case "/orders":
        return counts.orders;
      default:
        return 0;
    }
  }

  const contextValue: LayoutContextType = {
    compactMode,
    setCompactMode,
    sidebarOpen,
    setSidebarOpen,
  };

  // ============================================================================
  // Compact Mode
  // ============================================================================

  if (compactMode) {
    return (
      <LayoutContext.Provider value={contextValue}>
        <div className="min-h-screen bg-gray-100 flex flex-col">
          {/* Header */}
          <header className="bg-blue-600 text-white px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* <Warehouse className="w-6 h-6" /> */}
              {/* <span className="font-bold text-lg">WMS</span> */}
              <img src={logo} alt="HQ wms" className="h-8 invert" />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setCompactMode(false)}
                className="p-2 hover:bg-blue-700 rounded-lg"
                title="Full Mode"
              >
                <Maximize2 className="w-5 h-5" />
              </button>

              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="p-2 hover:bg-blue-700 rounded-lg"
                >
                  <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center font-medium">
                    {user.name.charAt(0)}
                  </div>
                </button>

                {userMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setUserMenuOpen(false)}
                    />
                    <div className="absolute right-0 mt-2 w-56 bg-white text-gray-800 border border-border rounded-lg shadow-lg py-2 z-50">
                      <div className="px-4 py-2 border-b">
                        <div className="font-medium">{user.name}</div>
                        <div className="text-sm text-gray-500">{user.role}</div>
                      </div>
                      <NavLink
                        to="/profile"
                        className="block px-4 py-2 hover:bg-gray-100"
                        onClick={() => setUserMenuOpen(false)}
                      >
                        Profile
                      </NavLink>
                      <button
                        onClick={logout}
                        className="cursor-pointer block w-full text-left px-4 py-2 text-red-600 hover:bg-gray-100"
                      >
                        Logout
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </header>

          {/* Status Bar */}
          {/* <div className="bg-blue-500 text-white px-4 py-2 text-sm flex justify-between">
            <span>
              {user.name} • {user.role}
            </span>
            <span className="flex items-center gap-1">
              <ClipboardList className="w-4 h-4" /> Active Tasks: 3
            </span>
          </div> */}

          {/* Content */}
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>

          {/* Bottom Nav */}
          <nav className="bg-white border-t border-border grid grid-cols-5">
            {compactNavItems.map((item) => {
              const isActive =
                location.pathname === item.to ||
                location.pathname.startsWith(item.to + "/");
              const badge = getBadgeCount(item.to);
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={`flex flex-col items-center py-3 ${
                    isActive ? "text-blue-600 bg-blue-50" : "text-gray-500"
                  }`}
                >
                  <div className="relative">
                    <item.icon className="w-6 h-6" />
                    <CountBadge count={badge} compact />
                  </div>
                  <span className="text-xs mt-1">{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>
      </LayoutContext.Provider>
    );
  }

  // ============================================================================
  // Full Mode
  // ============================================================================

  return (
    <LayoutContext.Provider value={contextValue}>
      <div className="min-h-screen bg-gray-50 flex">
        {/* Sidebar */}
        <aside
          className={`${
            sidebarOpen ? "w-64" : "w-16"
          } bg-white border-r border-border flex flex-col fixed h-full z-20 transition-all`}
        >
          {/* Logo */}
          <div className="h-16 flex items-center justify-between px-4 border-b border-border">
            {sidebarOpen && (
              <img src={logo} alt="HQ wms" className="w-12 h-auto" />
            )}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              {sidebarOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </button>
          </div>

          {/* Nav */}
          <nav className="flex-1 py-4 overflow-y-auto">
            {sidebarOpen && (
              <div className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase">
                Work
              </div>
            )}
            {navItems
              .filter((i) =>
                [
                  "/dashboard",
                  "/fulfillment",
                  "/tasks",
                  "/pick",
                  "/pack",
                  "/cycle-count",
                  "/receiving",
                  "/scan",
                ].includes(i.to),
              )
              .map((item) => {
                const badge = getBadgeCount(item.to);
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg ${
                        isActive
                          ? "bg-blue-50 text-blue-600 font-medium"
                          : "text-gray-600 hover:bg-gray-100"
                      }`
                    }
                    title={!sidebarOpen ? item.label : undefined}
                  >
                    <div className="relative flex-shrink-0">
                      <item.icon className="w-5 h-5" />
                      {!sidebarOpen && <CountBadge count={badge} compact />}
                    </div>
                    {sidebarOpen && (
                      <>
                        <span>{item.label}</span>
                        <CountBadge count={badge} />
                      </>
                    )}
                  </NavLink>
                );
              })}

            {navItems.some((i) =>
              [
                "/create-staff",
                "/orders",
                "/products",
                "/inventory",
                "/locations",
                "/shipping",
                "/reports",
              ].includes(i.to),
            ) && (
              <>
                {sidebarOpen && (
                  <div className="px-4 py-2 mt-4 text-xs font-semibold text-gray-400 uppercase">
                    Management
                  </div>
                )}
                {navItems
                  .filter((i) =>
                    [
                      "/create-staff",
                      "/orders",
                      "/products",
                      "/inventory",
                      "/locations",
                      "/shipping",
                      "/reports",
                    ].includes(i.to),
                  )
                  .map((item) => {
                    const badge = getBadgeCount(item.to);
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) =>
                          `flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg ${
                            isActive
                              ? "bg-blue-50 text-blue-600 font-medium"
                              : "text-gray-600 hover:bg-gray-100"
                          }`
                        }
                        title={!sidebarOpen ? item.label : undefined}
                      >
                        <div className="relative flex-shrink-0">
                          <item.icon className="w-5 h-5" />
                          {!sidebarOpen && <CountBadge count={badge} compact />}
                        </div>
                        {sidebarOpen && (
                          <>
                            <span>{item.label}</span>
                            <CountBadge count={badge} />
                          </>
                        )}
                      </NavLink>
                    );
                  })}
              </>
            )}

            {navItems.some((i) => ["/users", "/settings"].includes(i.to)) && (
              <>
                {sidebarOpen && (
                  <div className="px-4 py-2 mt-4 text-xs font-semibold text-gray-400 uppercase">
                    Admin
                  </div>
                )}
                {navItems
                  .filter((i) => ["/users", "/settings"].includes(i.to))
                  .map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg ${
                          isActive
                            ? "bg-blue-50 text-blue-600 font-medium"
                            : "text-gray-600 hover:bg-gray-100"
                        }`
                      }
                      title={!sidebarOpen ? item.label : undefined}
                    >
                      <item.icon className="w-5 h-5 flex-shrink-0" />
                      {sidebarOpen && <span>{item.label}</span>}
                    </NavLink>
                  ))}
              </>
            )}
          </nav>

          {/* Bottom */}
          <div className="p-4 border-t border-border">
            <button
              onClick={() => setCompactMode(true)}
              className="cursor-pointer flex items-center gap-3 px-4 py-2 w-full text-gray-600 hover:bg-gray-100 rounded-lg"
              title={!sidebarOpen ? "Compact Mode" : undefined}
            >
              <Minimize2 className="w-5 h-5" />
              {sidebarOpen && <span>Compact Mode</span>}
            </button>
            <button
              onClick={logout}
              className="cursor-pointer flex items-center gap-3 px-4 py-2 w-full text-gray-600 hover:bg-gray-100 rounded-lg mt-1"
              title={!sidebarOpen ? "Logout" : undefined}
            >
              <LogOut className="w-5 h-5" />
              {sidebarOpen && <span>Logout</span>}
            </button>
          </div>
        </aside>

        {/* Main */}
        <div
          className={`flex-1 flex flex-col ${sidebarOpen ? "ml-64" : "ml-16"} transition-all`}
        >
          {/* Top Bar */}
          <header className="h-16 bg-white border-b border-border flex items-center justify-between px-6 sticky top-0 z-10">
            <div />
            <div className="flex items-center gap-4">
              <button className="cursor-pointer p-2 text-gray-500 hover:bg-gray-100 rounded-lg relative">
                <Bell className="w-5 h-5" />
                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
              </button>

              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="cursor-pointer flex items-center gap-3 p-2 hover:bg-gray-100 rounded-lg"
                >
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                    <User className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="text-left hidden sm:block">
                    <div className="text-sm font-medium capitalize">
                      {user.name}
                    </div>
                    {/* <div className="text-xs text-gray-500">{user.role}</div> */}
                  </div>
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                </button>

                {userMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setUserMenuOpen(false)}
                    />
                    <div className="absolute right-0 mt-2 w-56 bg-white border border-border rounded-lg shadow-lg py-2 z-50">
                      {/* <div className="px-4 py-2 border-b border-border">
                        <div className="font-medium">{user.name}</div>
                        <div className="text-sm text-gray-500">
                          {user.email}
                        </div>
                      </div> */}
                      <div className="px-4 py-2">
                        <span className="flex items-center w-fit gap-1 text-[10px] text-blue-600 bg-blue-100 rounded-2xl px-2 py-1">
                          {user.role === "STAFF" ? (
                            <Shield className="h-3 w-3" />
                          ) : (
                            <ShieldCheck className="h-3 w-3" />
                          )}{" "}
                          {user.role}
                        </span>
                      </div>
                      <hr className="my-2 border-border" />
                      <NavLink
                        to="/profile"
                        className="block px-4 py-2 hover:bg-gray-100"
                        onClick={() => setUserMenuOpen(false)}
                      >
                        Profile
                      </NavLink>
                      <NavLink
                        to="/settings"
                        className="block px-4 py-2 hover:bg-gray-100"
                        onClick={() => setUserMenuOpen(false)}
                      >
                        Settings
                      </NavLink>
                      <hr className="my-2 border-border" />
                      <button
                        onClick={() => {
                          setCompactMode(true);
                          setUserMenuOpen(false);
                        }}
                        className="cursor-pointer flex items-center gap-2 w-full px-4 py-2 hover:bg-gray-100"
                      >
                        <Minimize2 className="w-4 h-4" /> Compact Mode
                      </button>
                      <hr className="my-2 border-border" />
                      <button
                        onClick={logout}
                        className="cursor-pointer block w-full text-left px-4 py-2 text-red-600 hover:bg-gray-100"
                      >
                        Logout
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </LayoutContext.Provider>
  );
}

// ============================================================================
// Auth Layout
// ============================================================================

export function AuthLayout() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  // Redirect to dashboard if already logged in
  if (isAuthenticated) {
    const from = (location.state as any)?.from?.pathname || "/dashboard";
    return <Navigate to={from} replace />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <img src={logo} alt="HQ wms" className="w-18 h-auto" />
        </div>
        <div className="bg-white rounded-xl shadow-lg p-8">
          <Outlet />
        </div>
        <p className="text-center text-gray-400 text-sm mt-8">© 2026 HQ WMS</p>
      </div>
    </div>
  );
}
