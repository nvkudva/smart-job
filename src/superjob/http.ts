const signInStatuses = [401, 403, 429, 999];

/** A portal that shows jobs only to signed-in users; loginUrl is where to sign in. */
export class SignInRequired extends Error {
  constructor(
    readonly loginUrl: string,
  ) {
    super("Sign in needed");
  }
}

/** With loginUrl, the browser's cookies for the portal are sent and a refusal asks the user to sign in. */
export async function text(portal: string, url: string, loginUrl?: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), credentials: loginUrl ? "include" : "same-origin" });
  if (loginUrl && signInStatuses.includes(response.status)) throw new SignInRequired(loginUrl);
  if (!response.ok) throw new Error(`${portal} answered ${response.status}`);
  return response.text();
}
