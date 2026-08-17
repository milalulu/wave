import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured, onAuthStateChange } from "../app/supabase";
import { signInOAuthDesktop, oauthSupported } from "../app/oauth";
import { startSyncEngine, stopSyncEngine, pullRemoteData } from "../app/syncEngine";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  configured: boolean;
  signUp: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInOAuth: (provider: "google" | "github") => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    let mounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (mounted) {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
        if (session?.user) startSyncEngine();
      }
    });
    const { data: { subscription } } = onAuthStateChange(async (_event, sess: Session | null) => {
      if (mounted) {
        setSession(sess);
        setUser(sess?.user ?? null);
        setLoading(false);
        if (sess?.user) {
          await pullRemoteData(sess.user.id);
          startSyncEngine();
        } else {
          stopSyncEngine();
        }
      }
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleError = (err: unknown, action: string): never => {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${action}: ${msg}`);
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      loading,
      configured: isSupabaseConfigured,
      signUp: async (email, password) => {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) handleError(error, "Sign up");
      },
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) handleError(error, "Sign in");
      },
      signInOAuth: async (provider) => {
        switch (oauthSupported()) {
          case "desktop":
            await signInOAuthDesktop(provider);
            return;
          case "android":
            throw new Error("OAuth: недоступен на Android — используйте email и пароль");
          default:
            
            {
              const { error } = await supabase.auth.signInWithOAuth({
                provider,
                options: { redirectTo: window.location.origin },
              });
              if (error) handleError(error, `OAuth ${provider}`);
            }
        }
      },
      signOut: async () => {
        const { error } = await supabase.auth.signOut();
        if (error) handleError(error, "Sign out");
      },
      resetPassword: async (email) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (error) handleError(error, "Reset password");
      },
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
