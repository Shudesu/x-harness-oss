export class XHarnessClient {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.apiUrl}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`X Harness API ${method} ${path}: ${res.status} ${text}`);
    }
    return res.json() as Promise<T>;
  }

  get<T>(path: string) { return this.request<T>('GET', path); }
  post<T>(path: string, body?: unknown) { return this.request<T>('POST', path, body); }
  put<T>(path: string, body?: unknown) { return this.request<T>('PUT', path, body); }
  del<T>(path: string) { return this.request<T>('DELETE', path); }
}
