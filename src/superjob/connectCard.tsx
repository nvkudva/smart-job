import { useEffect, useState } from "preact/hooks";
import * as storage from "../storage.ts";
import { Button } from "../panel/shared/controls.tsx";
import { useStored } from "../panel/shared/useStored.ts";
import { useTask } from "../panel/shared/useTask.ts";
import * as loginSites from "./loginSites.ts";

/** Shown after the first results: sites that list jobs only for signed-in users, each with a guided Connect. */
export function ConnectCard() {
  const isDismissed = useStored("connectCardDismissed");
  const settings = useStored("settings");
  const [signedIn, setSignedIn] = useState<Record<string, boolean>>({});
  const [isChecked, setIsChecked] = useState(false);
  useEffect(() => {
    void Promise.all(loginSites.sites.map(async (site) => [site.name, await loginSites.isSignedIn(site)] as const)).then((entries) => {
      setSignedIn(Object.fromEntries(entries));
      setIsChecked(true);
    });
  }, []);
  const connect = useTask(async (site: loginSites.LoginSite) => {
    const isConnected = await loginSites.connect(site, !!settings?.account.email);
    setSignedIn((previous) => ({ ...previous, [site.name]: isConnected }));
  });
  const pending = loginSites.sites.filter((site) => !signedIn[site.name]);
  if (isDismissed !== false || !isChecked || pending.length === 0) return null;
  return (
    <section class="card sj-connect">
      <div class="row between">
        <strong>Connect job sites</strong>
        <button type="button" class="link" onClick={() => void storage.set("connectCardDismissed", true)}>
          Not now
        </button>
      </div>
      <p class="muted small">
        Some sites show jobs only when you are signed in. Press Connect: SmartJob opens the login page{settings?.account.email ? " and fills your saved email" : ""}, you sign in, and it brings you back here.
      </p>
      {pending.map((site) => (
        <div class="row between">
          <span>{site.name}</span>
          <Button kind="primary" isBusy={connect.isBusy} onClick={() => void connect.run(site)}>
            Connect
          </Button>
        </div>
      ))}
      {connect.error && <p class="error small">{connect.error}</p>}
    </section>
  );
}
