/**
 * Minimal HTTP client that keeps its own cookie jar, so each instance behaves
 * like a separate device. Access control is cookie-based, so tests must be able
 * to hold several independent identities at once.
 */
export const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3100";

export class Client {
  private cookies = new Map<string, string>();

  async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ status: number; data: any }> {
    // GET/HEAD cannot carry a body; callers may pass one generically.
    const sendBody = body !== undefined && method !== "GET" && method !== "HEAD";
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        ...(sendBody ? { "content-type": "application/json" } : {}),
        ...(this.cookies.size > 0 ? { cookie: this.cookieHeader() } : {}),
      },
      body: sendBody ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    this.storeCookies(res);
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data };
  }

  /**
   * Raw bytes, for assertions that `text()` would hide — it decodes UTF-8 and
   * strips a leading byte-order mark, which is exactly the thing the CSV export
   * needs to emit for Excel.
   */
  async getBytes(path: string): Promise<{ status: number; bytes: Uint8Array }> {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: this.cookies.size > 0 ? { cookie: this.cookieHeader() } : {},
      redirect: "manual",
    });
    this.storeCookies(res);
    return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) };
  }

  get = (p: string) => this.request("GET", p);
  post = (p: string, b?: unknown) => this.request("POST", p, b ?? {});
  patch = (p: string, b?: unknown) => this.request("PATCH", p, b ?? {});
  delete = (p: string) => this.request("DELETE", p);

  private cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private storeCookies(res: Response) {
    const raw =
      typeof (res.headers as any).getSetCookie === "function"
        ? (res.headers as any).getSetCookie()
        : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie") as string]
        : [];
    for (const line of raw) {
      const [pair] = line.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }
}

/** A client that has already redeemed the admin key. */
export async function adminClient(): Promise<Client> {
  const c = new Client();
  const key = process.env.ADMIN_KEY;
  if (!key) throw new Error("ADMIN_KEY is not set for the test run");
  const res = await c.post("/api/admin", { key });
  if (res.status !== 200) throw new Error(`admin claim failed: ${res.status}`);
  return c;
}

/** Create a group and return its id plus the invite token, as the owner sees it. */
export async function createGroup(c: Client, name: string) {
  const created = await c.post("/api/groups", { name });
  const id = created.data.group.id as string;
  const state = await c.get(`/api/groups/${id}`);
  return { id, inviteToken: state.data.group.inviteToken as string };
}

export async function addMember(c: Client, groupId: string, name: string) {
  const res = await c.post(`/api/groups/${groupId}/members`, { name });
  return res.data.member.id as string;
}
