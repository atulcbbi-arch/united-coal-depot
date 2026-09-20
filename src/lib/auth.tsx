import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../supabase";

const AuthCtx = createContext({ user: null as any, pending: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [pending, setPending] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setPending(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  return <AuthCtx.Provider value={{ user, pending }}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  return useContext(AuthCtx);
}

export const signOutUser = async () => {
  await supabase.auth.signOut();
};