import { useEffect, useState } from "preact/hooks";
import * as officeData from "../../ai/office.ts";
import type { Coords } from "../../ai/office.ts";
import * as storage from "../../storage.ts";
import type { CompanyOffice, OfficeAddress } from "../../types.ts";
import * as aiContext from "../shared/aiContext.ts";
import { Button, Card, ErrorNote, Spinner } from "../shared/controls.tsx";
import { Icon } from "../shared/icons.tsx";
import { useStored } from "../shared/useStored.ts";

export function mapsDirectionsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

/** Route preview without an API key; Google frames this embed and routes from the given origin (your current location when omitted). */
export function mapEmbedUrl(address: string, user: Coords | null): string {
  const origin = user ? `saddr=${user.lat},${user.lon}&` : "";
  return `https://www.google.com/maps?${origin}daddr=${encodeURIComponent(address)}&output=embed`;
}

function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function distanceOf(entry: OfficeAddress, user: Coords | null): number | null {
  if (!user || entry.lat === undefined || entry.lon === undefined) return null;
  return officeData.haversineKm(user, { lat: entry.lat, lon: entry.lon });
}

function distanceText(km: number): string {
  return km >= 10 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`;
}

interface OfficeSectionProps {
  office: CompanyOffice | null;
  company: string;
  isLoading: boolean;
  error: string;
  onFind: () => void;
}

export function OfficeSection({ office, company, isLoading, error: rawError, onFind }: OfficeSectionProps) {
  const error = aiContext.useCardError(rawError);
  const storedHome = useStored("homeLocation");
  const [located, setLocated] = useState<Coords | null>(null);
  const [selected, setSelected] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [addressText, setAddressText] = useState("");
  const [suggestions, setSuggestions] = useState<officeData.PlaceSuggestion[]>([]);
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [hasTriedLocate, setHasTriedLocate] = useState(false);

  const userCoords: Coords | null = storedHome ? { lat: storedHome.lat, lon: storedHome.lon } : located;

  const saveHome = async (label: string, coords: Coords) => {
    setLocated(coords);
    await storage.set("homeLocation", { label, ...coords });
    setShowForm(false);
    setFormError("");
  };

  const locateNow = () => {
    if (!navigator.geolocation) {
      setFormError("This browser can't share a location — type your address instead.");
      setShowForm(true);
      return;
    }
    setHasTriedLocate(true);
    navigator.geolocation.getCurrentPosition(
      (position) => void saveHome("Current location", { lat: position.coords.latitude, lon: position.coords.longitude }),
      () => {
        setFormError("Location permission not given — type your address instead, or allow location and retry.");
        setShowForm(true);
      },
      { timeout: 8000, maximumAge: 600000 },
    );
  };

  // no saved starting point yet: ask the browser once (its own permission prompt); if that fails, the form below takes over
  useEffect(() => {
    if (storedHome === undefined || storedHome || hasTriedLocate || !office?.addresses.length) return;
    locateNow();
  }, [storedHome, office]);

  const saveTypedAddress = async () => {
    const text = addressText.trim();
    if (!text) return;
    setIsSaving(true);
    setFormError("");
    const [first] = await officeData.searchPlaces(text).catch(() => []);
    setIsSaving(false);
    if (!first) {
      setFormError("Couldn't find that place — try adding the city and state.");
      return;
    }
    await saveHome(first.label, first);
  };

  const onAddressInput = (text: string) => {
    setAddressText(text);
    setFormError("");
  };

  // live suggestions while typing; the user picks the right place instead of hoping one geocode guess lands
  useEffect(() => {
    if (!showForm && userCoords) return;
    const text = addressText.trim();
    if (text.length < 3) {
      setSuggestions([]);
      return;
    }
    let isAlive = true;
    const timer = setTimeout(() => {
      void officeData.searchPlaces(text).then((found) => isAlive && setSuggestions(found));
    }, 450);
    return () => {
      isAlive = false;
      clearTimeout(timer);
    };
  }, [addressText, showForm]);

  // nearest office first once we know where the user is; the dropdown follows the same order
  const ordered = office?.addresses
    .map((entry, index) => ({ entry, index, km: distanceOf(entry, userCoords) }))
    .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
  const current = ordered?.[Math.min(selected, Math.max(0, ordered.length - 1))];
  const km = current?.km ?? null;

  return (
    <Card title="Office" actions={office && !isLoading ? <Button onClick={onFind}>Refresh</Button> : undefined}>
      {isLoading && (
        <p class="muted">
          <Spinner /> Looking up the {company} office…
        </p>
      )}
      <ErrorNote message={error} onRetry={onFind} />
      {office && !isLoading && office.addresses.length === 0 && (
        <p class="muted">No office address found{office.city ? ` for ${office.city}` : ""}. Check that “Search the web for salary and perks data” is on in Settings.</p>
      )}
      {office && !isLoading && current && (
        <div class="stack tight">
          {office.match === "likely" && <p class="muted small">No {company} office found{office.city ? ` in ${office.city}` : ""} — most probable office:</p>}
          {ordered!.length > 1 ? (
            <label class="stack tight">
              <span class="muted small">Office address</span>
              <select value={current.index} onChange={(event) => setSelected(ordered!.findIndex((item) => item.index === Number((event.target as HTMLSelectElement).value)))}>
                {ordered!.map((item) => (
                  <option value={item.index}>{item.entry.address}</option>
                ))}
              </select>
            </label>
          ) : (
            <p>{current.entry.address}</p>
          )}
          <p class="muted small">
            {km !== null ? (
              <>
                {distanceText(km)} from {storedHome && storedHome.label !== "Current location" ? storedHome.label : "your current location"} · {officeData.peakTimeText(km)} ·{" "}
              </>
            ) : (
              <>Distance needs your location · </>
            )}
            <a href={mapsDirectionsUrl(current.entry.address)} target="_blank" rel="noreferrer">
              Directions in Google Maps
            </a>
            {userCoords && !showForm && (
              <>
                {" · "}
                <button type="button" class="link" onClick={() => setShowForm(true)}>
                  Change location
                </button>
              </>
            )}
          </p>
          {(showForm || !userCoords) && storedHome !== undefined && (
            <div class="stack tight">
              <p class="muted small">Your location is not set. Allow location access, or type your address — it is saved for next time.</p>
              <div class="actions">
                <Button onClick={locateNow}>
                  <Icon name="Locate" /> Use my current location
                </Button>
              </div>
              <div class="row">
                <input
                  type="text"
                  placeholder="Search your address or area, e.g. Indiranagar"
                  value={addressText}
                  onInput={(event) => onAddressInput((event.target as HTMLInputElement).value)}
                  onKeyDown={(event) => event.key === "Enter" && void saveTypedAddress()}
                />
                <Button kind="primary" isBusy={isSaving} disabled={!addressText.trim()} onClick={() => void saveTypedAddress()}>
                  Save
                </Button>
              </div>
              {!!suggestions.length && (
                <div class="stack tight">
                  {suggestions.map((place) => (
                    <button type="button" class="link suggestion" onClick={() => void saveHome(place.label, place)}>
                      {place.label}
                    </button>
                  ))}
                </div>
              )}
              {formError && <p class="error small">{formError}</p>}
            </div>
          )}
          <iframe class="office-map" src={mapEmbedUrl(current.entry.address, userCoords)} title={`Map to ${company} office`} loading="lazy" />
          {!!office.sources.length && (
            <div class="chips">
              {office.sources.map((source) => (
                <a class="chip site" href={source.url} target="_blank" rel="noreferrer" title={source.title}>
                  {siteName(source.url)}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
      {!office && !isLoading && !error && <Button onClick={onFind}>Find office</Button>}
    </Card>
  );
}
