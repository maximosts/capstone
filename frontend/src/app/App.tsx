import { useEffect, useMemo, useState } from "react";
import { Landing } from "./components/Landing";
import { Login } from "./components/Login";
import { Register } from "./components/Register";
import { Navigation } from "./components/Navigation";
import { Dashboard } from "./components/Dashboard";
import { MealPlanner } from "./components/MealPlanner";
import { Logs } from "./components/Logs";
import { Profile } from "./components/Profile";
import { CalorieTracker } from "./components/Calorietracker";
import { ChatWidget } from "./components/ChatWidget";
import { FoodAdmin } from "./components/FoodAdmin";
import { Coaching } from "./components/Coaching";
import { CoachingAdmin } from "./components/CoachingAdmin";
import { apiFetch, ensureCsrf } from "../lib/api";

type Me = { id: number; username: string; email: string; is_staff: boolean };

const PROTECTED_PAGES = new Set(["dashboard", "planner", "tracker", "logs", "chat", "profile", "food-admin", "coaching", "coaching-admin"]);

export default function App() {
  const [currentPage, setCurrentPage] = useState("landing");

  const [me, setMe] = useState<Me | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const isAuthenticated = useMemo(() => !!me, [me]);

  useEffect(() => {
    (async () => {
      try {
        await ensureCsrf();
        const data = await apiFetch("/api/auth/me/");
        setMe(data as Me);
      } catch {
        setMe(null);
      } finally {
        setAuthChecked(true);
      }
    })();
  }, []);

  const handleNavigate = (page: string) => {
    if (!isAuthenticated && PROTECTED_PAGES.has(page)) {
      setCurrentPage("login");
      return;
    }
    setCurrentPage(page);
  };

  useEffect(() => {
    const handler = (e: Event) => handleNavigate((e as CustomEvent).detail);
    window.addEventListener("navigate", handler);
    return () => window.removeEventListener("navigate", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (!isAuthenticated && PROTECTED_PAGES.has(currentPage)) {
    return <Login onNavigate={handleNavigate} />;
  }

  if (currentPage === "landing") {
    if (isAuthenticated) {
      return (
        <div className="min-h-screen bg-slate-50">
          <Navigation
            currentPage={"dashboard"}
            onNavigate={handleNavigate}
            isAuthenticated={true}
            isStaff={me?.is_staff ?? false}
            onLoggedOut={() => { setMe(null); setCurrentPage("landing"); }}
          />
          <main className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-8">
            <Dashboard onNavigate={handleNavigate} />
          </main>
          <ChatWidget />
        </div>
      );
    }
    return <Landing onNavigate={handleNavigate} />;
  }

  if (currentPage === "login") {
    return (
      <Login
        onNavigate={(page) => {
          if (page === "dashboard") {
            (async () => {
              try { const data = await apiFetch("/api/auth/me/"); setMe(data as Me); }
              catch { setMe(null); }
              setCurrentPage("dashboard");
            })();
          } else { handleNavigate(page); }
        }}
      />
    );
  }

  if (currentPage === "register") {
    return (
      <Register
        onNavigate={(page) => {
          if (page === "dashboard") {
            (async () => {
              try { const data = await apiFetch("/api/auth/me/"); setMe(data as Me); }
              catch { setMe(null); }
              setCurrentPage("dashboard");
            })();
          } else { handleNavigate(page); }
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation
        currentPage={currentPage}
        onNavigate={handleNavigate}
        isAuthenticated={isAuthenticated}
        isStaff={me?.is_staff ?? false}
        onLoggedOut={() => { setMe(null); setCurrentPage("landing"); }}
      />
      <main className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-8">
        {currentPage === "dashboard"  && <Dashboard onNavigate={handleNavigate} />}
        {currentPage === "planner"    && <MealPlanner />}
        {currentPage === "tracker"    && <CalorieTracker />}
        {currentPage === "logs"       && <Logs />}
        {currentPage === "profile"    && <Profile />}
        {currentPage === "coaching"   && <Coaching onNavigate={handleNavigate} />}
        {currentPage === "food-admin" && (me?.is_staff ? <FoodAdmin /> : <p className="text-sm text-muted-foreground">Access denied.</p>)}
        {currentPage === "coaching-admin" && (me?.is_staff ? <CoachingAdmin /> : <p className="text-sm text-muted-foreground">Access denied.</p>)}
      </main>
      <ChatWidget />
    </div>
  );
}