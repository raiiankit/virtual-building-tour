"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Boxes, Sparkles, ScanLine, Route, Share2, ArrowRight, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FloatingField } from "@/components/ui/input";
import { useLogin } from "@/hooks";
import { useAuthStore } from "@/store";
import { api } from "@/services/api";

const FEATURES = [
  { icon: Sparkles, text: "AI plan reading + OCR" },
  { icon: ScanLine, text: "Automatic room & wall detection" },
  { icon: Boxes, text: "One-click 3D building generation" },
  { icon: Route, text: "Walkable guided virtual tours" },
  { icon: Share2, text: "Shareable links & cinematic video" },
];

export default function LoginPage() {
  const login = useLogin();
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const [mode, setMode] = useState<"signin" | "forgot" | "reset">("signin");
  const [email, setEmail] = useState("demo@vbt.local");
  const [password, setPassword] = useState("demo1234");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (token) router.replace("/"); }, [token, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await login.mutateAsync({ email, password }); toast.success("Welcome back"); router.push("/"); }
    catch (err) { toast.error("Sign-in failed", { description: (err as Error).message }); }
  };

  const forgot = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      const r = await api.post<{ detail: string; data?: { reset_token?: string } }>("/api/auth/forgot-password", { email });
      if (r.data?.reset_token) { setResetToken(r.data.reset_token); setNewPassword(""); setMode("reset"); toast.success("Reset link created — set a new password."); }
      else toast.message(r.detail);   // email not found — same message, no leak
    } catch (err) { toast.error("Request failed", { description: (err as Error).message }); }
    finally { setBusy(false); }
  };

  const reset = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      await api.post("/api/auth/reset-password", { token: resetToken, password: newPassword });
      toast.success("Password updated — sign in with your new password.");
      setPassword(""); setMode("signin");
    } catch (err) { toast.error("Reset failed", { description: (err as Error).message }); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* brand panel */}
      <div className="relative hidden overflow-hidden bg-slate-950 lg:block">
        <div className="absolute inset-0 grid-dots opacity-[0.15]" />
        <div className="absolute -left-24 top-1/3 size-[420px] rounded-full bg-primary/30 blur-[120px]" />
        <div className="absolute right-0 top-0 size-[380px] rounded-full bg-blue-500/20 blur-[120px]" />
        <div className="relative flex h-full flex-col justify-between p-14 text-white">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-primary to-blue-400 shadow-glow"><Boxes className="size-6" /></div>
            <span className="text-lg font-bold">Virtual Building Tour</span>
          </div>
          <div>
            <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
              className="max-w-md text-balance text-4xl font-bold leading-tight tracking-tight">
              The AI platform that turns floor plans into 3D building tours.
            </motion.h1>
            <div className="mt-8 space-y-3">
              {FEATURES.map((f, i) => (
                <motion.div key={f.text} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + i * 0.08 }}
                  className="flex items-center gap-3 text-white/80">
                  <span className="grid size-8 place-items-center rounded-lg bg-white/10"><f.icon className="size-4" /></span>
                  <span className="text-sm">{f.text}</span>
                </motion.div>
              ))}
            </div>
          </div>
          <p className="text-xs text-white/40">Built for architects, builders &amp; real-estate teams.</p>
        </div>
      </div>

      {/* form */}
      <div className="flex items-center justify-center p-6">
        {mode === "signin" && (
          <motion.form initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} onSubmit={submit} className="w-full max-w-sm space-y-5">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Sign in</h2>
              <p className="mt-1 text-sm text-muted-foreground">Welcome back — enter your details to continue.</p>
            </div>
            <FloatingField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <FloatingField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="-mt-2 flex justify-end">
              <button type="button" onClick={() => setMode("forgot")} className="text-xs font-medium text-primary hover:underline">Forgot password?</button>
            </div>
            <Button type="submit" size="lg" className="w-full" loading={login.isPending}>Sign in <ArrowRight /></Button>
            <p className="text-center text-xs text-muted-foreground">Demo access is pre-filled for you.</p>
          </motion.form>
        )}

        {mode === "forgot" && (
          <motion.form initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} onSubmit={forgot} className="w-full max-w-sm space-y-5">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Reset password</h2>
              <p className="mt-1 text-sm text-muted-foreground">Enter your account email and we&apos;ll create a reset link.</p>
            </div>
            <FloatingField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button type="submit" size="lg" className="w-full" loading={busy}>Create reset link <ArrowRight /></Button>
            <button type="button" onClick={() => setMode("signin")} className="mx-auto flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> Back to sign in</button>
          </motion.form>
        )}

        {mode === "reset" && (
          <motion.form initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} onSubmit={reset} className="w-full max-w-sm space-y-5">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Set a new password</h2>
              <p className="mt-1 text-sm text-muted-foreground">Choose a new password for <span className="font-medium text-foreground">{email}</span>.</p>
            </div>
            <FloatingField label="New password (min 8 chars)" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <Button type="submit" size="lg" className="w-full" loading={busy}>Update password <ArrowRight /></Button>
            <button type="button" onClick={() => setMode("signin")} className="mx-auto flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> Back to sign in</button>
          </motion.form>
        )}
      </div>
    </div>
  );
}
