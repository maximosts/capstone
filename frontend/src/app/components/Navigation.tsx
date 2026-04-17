import { useState } from "react";
import { Menu, X } from "lucide-react";
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
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = [
    { id: "dashboard", label: "Dashboard" },
    { id: "planner",   label: "Planner" },
    { id: "tracker",   label: "Tracker" },
    { id: "logs",      label: "Logs" },
    { id: "coaching",  label: "Coaching" },
    { id: "profile",   label: "Profile" },
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

  const navigate = (page: string) => {
    onNavigate(page);
    setMobileOpen(false);
  };

  return (
    <nav className="bg-white border-b border-border shadow-sm relative z-50">
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <div className="flex items-center justify-between h-14 md:h-16">

          {/* Logo */}
          <h1
            className="font-semibold text-base md:text-lg text-foreground cursor-pointer flex-shrink-0"
            title="Adaptive Nutrition Management System"
            onClick={() => navigate(isAuthenticated ? "dashboard" : "landing")}
          >
            ANMS
          </h1>

          {/* Desktop nav links */}
          {isAuthenticated && (
            <div className="hidden md:flex gap-1 flex-1 px-6">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => navigate(item.id)}
                  className={`px-3 py-2 rounded-md text-sm transition-colors whitespace-nowrap ${
                    currentPage === item.id
                      ? "bg-secondary text-secondary-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}

          {/* Right side */}
          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <>
                {/* Logout — desktop only; mobile gets it in the drawer */}
                <Button variant="ghost" size="sm" className="hidden md:inline-flex" onClick={handleLogout}>
                  Logout
                </Button>
                {/* Hamburger — mobile only */}
                <button
                  className="md:hidden p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
                  onClick={() => setMobileOpen((o) => !o)}
                  aria-label="Toggle menu"
                >
                  {mobileOpen ? <X size={22} /> : <Menu size={22} />}
                </button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => navigate("login")}>
                  Login
                </Button>
                <Button size="sm" onClick={() => navigate("register")}>
                  Register
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && isAuthenticated && (
        <div className="md:hidden border-t border-border bg-white">
          <div className="px-4 py-3 flex flex-col gap-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => navigate(item.id)}
                className={`w-full text-left px-4 py-3 rounded-lg text-sm transition-colors ${
                  currentPage === item.id
                    ? "bg-secondary text-secondary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                {item.label}
              </button>
            ))}
            <div className="border-t border-border mt-2 pt-2">
              <button
                onClick={handleLogout}
                className="w-full text-left px-4 py-3 rounded-lg text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
