import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AppShell } from "@/components/shell";
import { AuthProvider, RequireAuth, useAuth, signOutUser } from "@/lib/auth";
import { LoginPage } from "@/pages/login";
import { BillPage, Reports, Settings, Today, PurchasePage, MoneyPage } from "@/pages/owner";
import { getSecurityPin, saveSecurityPin } from "@/lib/store";
import { Button, TextInput } from "@/components/ui";
import { useState, useEffect } from "react";

function SecurityLock({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(true);
  const [savedPin, setSavedPin] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) {
      const unlocked = sessionStorage.getItem("app_unlocked");
      if (unlocked === "true") {
        setIsLocked(false);
        setLoading(false);
      } else {
        getSecurityPin(user.uid).then((pin) => {
          setSavedPin(pin || null);
          setLoading(false);
        });
      }
    }
  }, [user]);

  if (!user) return <>{children}</>;
  if (loading) return <div className="p-8 text-center text-muted font-medium">Loading secure workspace...</div>;
  if (!isLocked) return <>{children}</>;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!savedPin) {
      if (pinInput.length < 4) return setError("M-PIN must be at least 4 digits");
      await saveSecurityPin(user.uid, pinInput);
      setSavedPin(pinInput);
      sessionStorage.setItem("app_unlocked", "true");
      setIsLocked(false);
    } else {
      if (pinInput === savedPin) {
        sessionStorage.setItem("app_unlocked", "true");
        setIsLocked(false);
      } else {
        setError("Incorrect M-PIN");
        setPinInput("");
      }
    }
  };

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm bg-surface p-6 rounded-xl border border-border shadow-sm text-center">
        <h1 className="font-display text-2xl mb-2">{savedPin ? "Enter M-PIN" : "Set M-PIN"}</h1>
        <p className="text-muted text-sm mb-6">
          {savedPin 
            ? "Enter your security PIN to unlock the ledger." 
            : "Create a 4-digit PIN to secure your app on this device."}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <TextInput 
            type="password" 
            inputMode="numeric" 
            pattern="[0-9]*"
            placeholder="****" 
            value={pinInput} 
            onChange={e => { setPinInput(e.target.value); setError(""); }}
            className="text-center text-2xl tracking-[0.5em] font-mono h-14"
            autoFocus
          />
          {error && <p className="text-danger text-sm">{error}</p>}
          <Button className="w-full h-12 text-base font-medium" size="lg" type="submit">
            {savedPin ? "Unlock App" : "Save & Unlock"}
          </Button>
        </form>
        <button 
          onClick={() => void signOutUser()} 
          className="mt-8 text-sm text-muted underline-offset-2 hover:underline"
        >
          Sign out & use Google Password
        </button>
      </div>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster richColors position="top-center" />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <RequireAuth>
                <SecurityLock>
                  <AppShell />
                </SecurityLock>
              </RequireAuth>
            }
          >
            <Route path="/" element={<Today />} />
            <Route path="/bill" element={<BillPage />} />
            <Route path="/purchase" element={<PurchasePage />} />
            <Route path="/money" element={<MoneyPage />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}