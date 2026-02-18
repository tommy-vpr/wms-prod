import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AuthProvider, useAuth } from "./lib/auth";
import { AppLayout, AuthLayout } from "./layouts";
import { Loader2 } from "lucide-react";

// Auth Pages
import { LoginPage } from "./pages/auth/Login";
import { SignupPage } from "./pages/auth/Signup";

// Dashboard
import { DashboardPage } from "./pages/dashboard";

// Fulfillment
import FulfillmentListPage from "./pages/fulfillment";
import FulfillmentDetailPage from "./pages/fulfillment/[id]";

// Tasks
import { TasksPage } from "./pages/tasks";

// Work Functions
import { PickPage } from "./pages/pick";
import { PackPage } from "./pages/pack";
import { ReceivePage } from "./pages/receive";

// Orders
import { OrdersPage } from "./pages/orders";
import { OrderDetailPage } from "./pages/orders/[id]";

// Products
import ProductsPage from "./pages/products";
import ProductDetailPage from "./pages/products/[id]";
import ProductImportPage from "./pages/products/import";

// Inventory
import { InventoryPage } from "./pages/inventory";
import { InventoryDetailPage } from "./pages/inventory/[id]";

// Reports
import { ReportsPage } from "./pages/reports";

// Users
import { UsersPage } from "./pages/users";

// User Passwords
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";

// Settings
import { SettingsPage } from "./pages/settings";
import LocationsPage from "./pages/locations";
import LocationDetailPage from "./pages/locations/[id]";
import { UserRole } from "@wms/types";

// ─────────────────────────────────────────────────────────────────────────────
// Receiving (lazy loaded)
// ─────────────────────────────────────────────────────────────────────────────
const ReceivingDashboard = lazy(() => import("./pages/receiving/index"));
const ReceivingPurchaseOrders = lazy(
  () => import("./pages/receiving/purchase-orders"),
);
const ReceivingStart = lazy(() => import("./pages/receiving/start"));
const ReceivingSession = lazy(() => import("./pages/receiving/session"));
const ReceivingApprove = lazy(() => import("./pages/receiving/approve"));

// ─────────────────────────────────────────────────────────────────────────────
// Cycle Count (lazy loaded)
// ─────────────────────────────────────────────────────────────────────────────
const CycleCountDashboard = lazy(() => import("./pages/cycle-count/index"));
const CycleCountStart = lazy(() => import("./pages/cycle-count/start"));
const CycleCountSession = lazy(() => import("./pages/cycle-count/session"));
const CycleCountReview = lazy(() => import("./pages/cycle-count/review"));

// ─────────────────────────────────────────────────────────────────────────────
// Scan (lazy loaded)
// ─────────────────────────────────────────────────────────────────────────────
const ScanPage = lazy(() => import("./pages/scan/index"));

// ─────────────────────────────────────────────────────────────────────────────
// Shipping (lazy loaded)
// ─────────────────────────────────────────────────────────────────────────────
const ShipPage = lazy(() => import("./pages/shipping/index"));

// ─────────────────────────────────────────────────────────────────────────────
// Super Admin
// ─────────────────────────────────────────────────────────────────────────────
const CreateUserDashboard = lazy(() => import("./pages/create-staff/index"));

// ─────────────────────────────────────────────────────────────────────────────
// Invoices (lazy loaded)
// ─────────────────────────────────────────────────────────────────────────────
const InvoicesPage = lazy(() => import("./pages/invoices"));
const InvoiceDetailPage = lazy(() => import("./pages/invoices/[id]"));

// ─────────────────────────────────────────────────────────────────────────────

const PageLoader = () => (
  <div className="min-h-screen bg-gray-50 flex items-center justify-center">
    <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
  </div>
);

const withSuspense = (Component: React.LazyExoticComponent<React.FC>) => (
  <Suspense fallback={<PageLoader />}>
    <Component />
  </Suspense>
);

// ─────────────────────────────────────────────────────────────────────────────

function AuthProviderLayout() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

function RequireRole({
  roles,
  children,
}: {
  roles: UserRole[];
  children: React.ReactNode;
}) {
  const { user, isLoading } = useAuth();

  if (isLoading) return <PageLoader />;

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!roles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

export const router = createBrowserRouter([
  {
    element: <AuthProviderLayout />,
    children: [
      {
        path: "/",
        element: <Navigate to="/dashboard" replace />,
      },

      // Auth Routes (no sidebar)
      {
        element: <AuthLayout />,
        children: [
          { path: "/login", element: <LoginPage /> },
          { path: "/forgot-password", element: <ForgotPasswordPage /> },
          { path: "/reset-password", element: <ResetPasswordPage /> },
        ],
      },

      // App Routes (with layout, role-based nav)
      {
        element: <AppLayout />,
        children: [
          { path: "/dashboard", element: <DashboardPage /> },
          { path: "/tasks", element: <TasksPage /> },
          { path: "/pick", element: <PickPage /> },
          { path: "/pack", element: <PackPage /> },
          { path: "/receive", element: <ReceivePage /> },

          // Orders
          { path: "/orders", element: <OrdersPage /> },
          { path: "/orders/:id", element: <OrderDetailPage /> },

          // Fulfillment
          { path: "/fulfillment", element: <FulfillmentListPage /> },
          { path: "/fulfillment/:orderId", element: <FulfillmentDetailPage /> },

          // Products
          { path: "/products", element: <ProductsPage /> },
          { path: "/products/import", element: <ProductImportPage /> },
          { path: "/products/:id", element: <ProductDetailPage /> },

          // Locations
          { path: "/locations", element: <LocationsPage /> },
          { path: "/locations/:id", element: <LocationDetailPage /> },

          // Inventory
          { path: "/inventory", element: <InventoryPage /> },
          { path: "/inventory/:id", element: <InventoryDetailPage /> },

          // Receiving
          { path: "/receiving", element: withSuspense(ReceivingDashboard) },
          {
            path: "/receiving/purchase-orders",
            element: withSuspense(ReceivingPurchaseOrders),
          },
          {
            path: "/receiving/start/:poId",
            element: withSuspense(ReceivingStart),
          },
          {
            path: "/receiving/session/:sessionId",
            element: withSuspense(ReceivingSession),
          },
          {
            path: "/receiving/approve/:sessionId",
            element: withSuspense(ReceivingApprove),
          },

          // Cycle Count
          {
            path: "/cycle-count",
            element: withSuspense(CycleCountDashboard),
          },
          {
            path: "/cycle-count/start",
            element: withSuspense(CycleCountStart),
          },
          {
            path: "/cycle-count/session/:sessionId",
            element: withSuspense(CycleCountSession),
          },
          {
            path: "/cycle-count/review/:sessionId",
            element: withSuspense(CycleCountReview),
          },

          // Invoices
          { path: "/invoices", element: <InvoicesPage /> },
          { path: "/invoices/:id", element: <InvoiceDetailPage /> },

          // Scan
          { path: "/scan", element: withSuspense(ScanPage) },

          { path: "/shipping", element: withSuspense(ShipPage) },

          {
            path: "/create-staff",
            element: (
              <RequireRole roles={["SUPER_ADMIN"]}>
                {withSuspense(CreateUserDashboard)}
              </RequireRole>
            ),
          },

          { path: "/reports", element: <ReportsPage /> },
          { path: "/users", element: <UsersPage /> },
          { path: "/settings", element: <SettingsPage /> },
        ],
      },
    ],
  },
]);
