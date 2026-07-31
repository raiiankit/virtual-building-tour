import { useAuthStore } from "@/store";

/** Typed fetch client for the FastAPI backend (proxied via next.config rewrites). */
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function request<T>(path: string, opts: RequestInit & { form?: FormData } = {}): Promise<T> {
  const { token } = useAuthStore.getState();
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body = opts.body;
  if (opts.form) { body = opts.form; }
  else if (body && typeof body === "object") { headers["Content-Type"] = "application/json"; body = JSON.stringify(body); }

  const res = await fetch(path, { ...opts, headers, body: body as BodyInit });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data as { detail?: unknown }).detail;
    throw new ApiError(typeof detail === "string" ? detail : JSON.stringify(detail ?? data), res.status);
  }
  return data as T;
}

/** Fetch a binary/file response with auth and save it to disk (DXF/SVG/JSON export). */
async function download(path: string, filename: string): Promise<void> {
  const { token } = useAuthStore.getState();
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const detail = await res.json().then((d) => (d as { detail?: string }).detail).catch(() => null);
    throw new ApiError(detail || `Download failed (${res.status})`, res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body?: unknown) => request<T>(p, { method: "POST", body: body as BodyInit }),
  put: <T>(p: string, body?: unknown) => request<T>(p, { method: "PUT", body: body as BodyInit }),
  del: <T>(p: string) => request<T>(p, { method: "DELETE" }),
  upload: <T>(p: string, form: FormData) => request<T>(p, { method: "POST", form }),
  download,
};
