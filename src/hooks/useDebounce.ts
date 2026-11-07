import { useState, useEffect, useCallback, useDeferredValue } from 'react';

/**
 * Reusable hook for instant input responsiveness with 300ms delayed background processing.
 * - `input`: Bound directly to the <input> element. Updates synchronously with 0ms latency.
 * - `debounced`: Updates 300ms after user pauses typing.
 * - `deferred`: Wrapped with React 19's useDeferredValue to ensure heavy rendering runs as a low-priority transition.
 * - `setImmediate`: Allows instant update without 300ms delay (e.g. clicking a filter pill, suggestion, or clearing).
 * - `clear`: Immediately resets input and debounced query to empty string.
 */
export function useDebouncedSearch(initialValue = '', delayMs = 300) {
  const [input, setInput] = useState(initialValue);
  const [debounced, setDebounced] = useState(initialValue);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(input);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [input, delayMs]);

  const setImmediate = useCallback((val: string) => {
    setInput(val);
    setDebounced(val);
  }, []);

  const clear = useCallback(() => {
    setInput('');
    setDebounced('');
  }, []);

  const deferred = useDeferredValue(debounced);

  return {
    input,
    setInput,
    debounced,
    deferred,
    setImmediate,
    clear,
    isPending: input !== debounced
  };
}

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
