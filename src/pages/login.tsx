import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../supabase";

export function LoginPage() {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) alert(error.message);
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif", backgroundColor: "#f3f4f6" }}>
      <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "15px", width: "320px", padding: "30px", background: "white", borderRadius: "8px", boxShadow: "0 4px 6px rgba(0,0,0,0.1)" }}>
        <h2 style={{ textAlign: "center", margin: "0 0 10px 0" }}>United Coal Depot</h2>
        <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required style={{ padding: "10px", borderRadius: "4px", border: "1px solid #ccc" }} />
        <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required style={{ padding: "10px", borderRadius: "4px", border: "1px solid #ccc" }} />
        <button type="submit" disabled={loading} style={{ padding: "10px", background: "#000", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}>
          {loading ? "Verifying..." : "Login"}
        </button>
      </form>
    </div>
  );
}