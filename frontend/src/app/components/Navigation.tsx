import React from "react";
import { apiFetch, ensureCsrf, setAuthToken } from "../../lib/api";
import { Button } from "./ui/button";

interface NavigationProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  isAuthenticated: boolean;
  isStaff?: boolean;
  onLoggedOut: () => void;
}

export function Navigation({
  currentPage,
  onNavigate,
  isAuthenticated,
  isStaff = false,
  onLoggedOut,
}: NavigationProps) {
  const navItems = [
    { id: "dashboard",  label: "Dashboard" },
    { id: "planner",    label: "Planner" },
    { id: "tracker",    label: "Tracker" },
    { id: "logs",       label: "Logs" },
    { id: "coaching",   label: "Coaching" },
    { id: "profile",    label: "Profile" },
    ...(isStaff ? [{ id: "food-admin", label: "Food DB" }, { id: "coaching-admin", label: "Coach Inbox" }] : []),
  ];

  const handleLogout = async () => {
    try {
      await ensureCsrf();
      await apiFetch("/api/auth/logout/", { method: "POST" });
      setAuthToken(null);
      onLoggedOut();
      onNavigate("landing");
    } catch (err: any) {
      alert(err?.detail || err?.error || "Logout failed");
    }
  };

  return (
    <nav className="bg-white border-b border-border shadow-sm">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center justify-between h-16">
          {/* Left side */}
          <div className="flex items-center gap-8">
            <h1
              className="font-semibold text-lg text-foreground cursor-pointer"
              title="Adaptive Nutrition Management System"
              onClick={() => onNavigate(isAuthenticated ? "dashboard" : "landing")}
            >
              ANMS
            </h1>

            {isAuthenticated && (
              <div className="flex gap-1">
                {navItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    className={`px-4 py-2 rounded-md transition-colors ${
                      currentPage === item.id
                        ? "bg-secondary text-secondary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-4">
            {isAuthenticated ? (
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                Logout
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => onNavigate("login")}>
                  Login
                </Button>
                <Button size="sm" onClick={() => onNavigate("register")}>
                  Register
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}