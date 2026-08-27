export const FORMAL_DATA_CHANGED_EVENT = "formal-data-changed";
export const FORMAL_DATA_CHANGED_STORAGE_KEY = "wh_formal_data_changed_v1";

type EventSource = Pick<EventTarget, "addEventListener" | "removeEventListener">;

export type FormalDataChangeBrowser = EventSource & Pick<EventTarget, "dispatchEvent"> & {
  document: EventSource & { visibilityState: DocumentVisibilityState };
  localStorage: Pick<Storage, "setItem">;
};

type FormalDataChangeListener = () => void;

let notificationSequence = 0;

function currentBrowser(): FormalDataChangeBrowser | null {
  if (typeof window === "undefined") return null;
  return window;
}

function signalValue() {
  notificationSequence += 1;
  return `${Date.now()}:${notificationSequence}`;
}

/**
 * Publishes only an invalidation signal. Formal business facts remain in the backend.
 */
export function notifyFormalDataChanged(browser = currentBrowser()): void {
  if (!browser) return;
  browser.dispatchEvent(new Event(FORMAL_DATA_CHANGED_EVENT));
  try {
    browser.localStorage.setItem(FORMAL_DATA_CHANGED_STORAGE_KEY, signalValue());
  } catch {
    // The current page has already refreshed; cross-tab delivery is best effort.
  }
}

/**
 * Keeps a formal dashboard current after writes, tab changes, and history navigation.
 */
export function subscribeFormalDashboardRefresh(
  listener: FormalDataChangeListener,
  browser = currentBrowser(),
): () => void {
  if (!browser) return () => undefined;

  const refresh = () => listener();
  const refreshWhenVisible = () => {
    if (browser.document.visibilityState === "visible") refresh();
  };
  const refreshFromStorage = (event: Event) => {
    if ((event as StorageEvent).key === FORMAL_DATA_CHANGED_STORAGE_KEY) refresh();
  };

  browser.addEventListener(FORMAL_DATA_CHANGED_EVENT, refresh);
  browser.addEventListener("storage", refreshFromStorage);
  browser.addEventListener("focus", refresh);
  browser.addEventListener("pageshow", refresh);
  browser.addEventListener("popstate", refresh);
  browser.document.addEventListener("visibilitychange", refreshWhenVisible);

  return () => {
    browser.removeEventListener(FORMAL_DATA_CHANGED_EVENT, refresh);
    browser.removeEventListener("storage", refreshFromStorage);
    browser.removeEventListener("focus", refresh);
    browser.removeEventListener("pageshow", refresh);
    browser.removeEventListener("popstate", refresh);
    browser.document.removeEventListener("visibilitychange", refreshWhenVisible);
  };
}
