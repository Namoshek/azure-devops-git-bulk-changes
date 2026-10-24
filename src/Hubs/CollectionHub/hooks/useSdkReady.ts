import { useEffect, useState } from "react";
import * as SDK from "azure-devops-extension-sdk";
import { getErrorMessage } from "../../../utils/errorUtils";

export interface SdkReadyState {
  ready: boolean;
  error: string | null;
}

/** Resolves once the host handshake finished; a failed handshake is reported but does not block the page. */
export function useSdkReady(): SdkReadyState {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void SDK.ready()
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setReady(true));
  }, []);

  return { ready, error };
}
