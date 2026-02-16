import { Link } from "react-router-dom";
import { useLayout } from "../../layouts";
import { Package, PackageCheck, PackagePlus, ScanLine } from "lucide-react";
import { useAuth, useHasRole } from "@/lib/auth";

// pages/dashboard/index.tsx
export function DashboardPage() {
  const { user, logout } = useAuth();
  const { compactMode } = useLayout();
  const isAdmin = useHasRole(["ADMIN"]);

  return (
    <div className={compactMode ? "p-4" : "p-6"}>
      <h1 className="text-2xl font-bold mb-6 text-gray-500">
        Welcome back, {user?.name || "User"}
      </h1>

      <div
        className={`grid gap-4 ${compactMode ? "grid-cols-2" : "grid-cols-4"}`}
      >
        <StatCard title="Pending Tasks" value="12" color="blue" />
        <StatCard title="Orders Today" value="47" color="green" />
        <StatCard title="Items to Pick" value="156" color="orange" />
        <StatCard title="Ready to Ship" value="23" color="purple" />
      </div>

      {compactMode && (
        <div className="mt-6 grid grid-cols-2 gap-4">
          <QuickAction to="/pick" icon={PackageCheck} label="Start Picking" />
          <QuickAction to="/pack" icon={Package} label="Start Packing" />
          <QuickAction to="/receive" icon={PackagePlus} label="Receive" />
          <QuickAction to="/scan" icon={ScanLine} label="Scan Item" />
        </div>
      )}
    </div>
  );
}

function StatCard({
  title,
  value,
  color,
}: {
  title: string;
  value: string;
  color: string;
}) {
  //   const colors: Record<string, string> = {
  //     blue: "bg-blue-50 text-blue-600",
  //     green: "bg-green-50 text-green-600",
  //     orange: "bg-orange-50 text-orange-600",
  //     purple: "bg-purple-50 text-purple-600",
  //   };

  return (
    <div className="bg-white border border-border rounded-lg p-4">
      <div className="text-sm text-gray-500">{title}</div>
      <div className={`text-3xl mt-1`}>{value}</div>
    </div>
  );
}

function QuickAction({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: any;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="flex flex-col items-center justify-center bg-white border border-border rounded-lg p-6 hover:bg-gray-50 active:bg-gray-100"
    >
      <Icon className="w-8 h-8 text-blue-600 mb-2" />
      <span className="font-medium">{label}</span>
    </Link>
  );
}
