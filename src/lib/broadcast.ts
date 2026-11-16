import 'server-only';

/** Broadcast to a session's private realtime topic. The service role key is authorized for private channels. */
export async function broadcastToSession(sessionId: string, event: string, payload: unknown): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [{ topic: `pl:session:${sessionId}`, event, payload, private: true }],
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Best-effort: clients treat broadcasts as hints and re-read the database.
  }
}
