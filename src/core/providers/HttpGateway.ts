/** CORS-безопасный HTTP-вызов (в webview fetch заблокирован для многих API). */
export interface HttpJsonGateway {
  json(
    method: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<{ status: number; body: unknown }>;
  text(
    method: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<{ status: number; text: string }>;
}