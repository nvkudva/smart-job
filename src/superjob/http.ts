export async function text(portal: string, url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${portal} answered ${response.status}`);
  return response.text();
}
