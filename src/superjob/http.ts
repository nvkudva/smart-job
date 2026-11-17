export async function text(portal: string, url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${portal} answered ${response.status}`);
  return response.text();
}
