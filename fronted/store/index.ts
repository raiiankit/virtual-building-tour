import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Me } from "@/types";

interface UIState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebar: (v: boolean) => void;
}
export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebar: (v) => set({ sidebarCollapsed: v }),
    }),
    { name: "vbt-ui" }
  )
);

export interface Crumb { label: string; href?: string }
interface HeaderState { crumbs: Crumb[]; setCrumbs: (c: Crumb[]) => void }
export const useHeader = create<HeaderState>((set) => ({ crumbs: [], setCrumbs: (crumbs) => set({ crumbs }) }));

interface AuthState {
  token: string | null;
  me: Me | null;
  setAuth: (token: string, me: Me | null) => void;
  setMe: (me: Me | null) => void;
  logout: () => void;
}
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      me: null,
      setAuth: (token, me) => set({ token, me }),
      setMe: (me) => set({ me }),
      logout: () => set({ token: null, me: null }),
    }),
    { name: "vbt-auth" }
  )
);
