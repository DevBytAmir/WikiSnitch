import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiFailure } from "../api/client";
import { Icon } from "./Icon";

export interface ApiState<T> {
  state: "loading" | "error" | "ready";
  data?: T;
  error?: ApiFailure;
  retry(): void;
}

export function useApi<T>(fn: () => Promise<T>, deps: unknown[]): ApiState<T> {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Omit<ApiState<T>, "retry">>({ state: "loading" });

  useEffect(() => {
    let live = true;
    setResult({ state: "loading" });
    fn().then(
      (data) => live && setResult({ state: "ready", data }),
      (e: unknown) =>
        live &&
        setResult({
          state: "error",
          error: e instanceof ApiFailure ? e : new ApiFailure(0, "client", "Something went wrong in the page."),
        }),
    );
    return () => {
      live = false;
    };
  }, [...deps, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...result, retry };
}

/** The loading line used everywhere data is on its way. */
export function Loading({ text = "Loading…" }: { text?: string }) {
  return (
    <p className="async-loading" role="status">
      <span className="shimmer-text">{text}</span>
    </p>
  );
}

/** A failed call: what went wrong, and a way to try again. Never a blank area. */
export function ErrorBox({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="async-error" role="alert">
      <Icon name="triangle-alert" size={16} className="async-error-icon" />
      <p>{message}</p>
      <button type="button" className="btn btn-sm" onClick={retry}>
        Retry
      </button>
    </div>
  );
}

export function Async<T>({
  state,
  retry,
  children,
}: {
  state: ApiState<T>;
  retry?: () => void;
  children: (data: T) => ReactNode;
}) {
  if (state.state === "loading") return <Loading />;
  if (state.state === "error" || state.data === undefined) {
    return <ErrorBox message={state.error?.message ?? "Something went wrong."} retry={retry ?? state.retry} />;
  }
  return <>{children(state.data)}</>;
}
