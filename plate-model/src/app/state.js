// The simulation result can hold hundreds of thousands of numbers, so it is
// stored and returned by reference rather than deep-copied on every read.
// Treat getState().quiescentResult as read-only.
export function createAppState(initialState) {
  let currentState = { ...initialState, config: structuredClone(initialState.config) };

  return {
    getState() {
      return { ...currentState, config: structuredClone(currentState.config) };
    },
    setConfig(config) {
      currentState = { ...currentState, config: structuredClone(config) };
    },
    setQuiescentResult(result) {
      currentState = { ...currentState, quiescentResult: result ?? null };
    },
    setUseSansSerif(useSansSerif) {
      currentState = { ...currentState, useSansSerif: Boolean(useSansSerif) };
    },
    setUseDarkMode(useDarkMode) {
      currentState = { ...currentState, useDarkMode: Boolean(useDarkMode) };
    },
    setAccordionOpen(key, isOpen) {
      currentState = {
        ...currentState,
        accordionState: {
          ...(currentState.accordionState ?? {}),
          [key]: Boolean(isOpen),
        },
      };
    },
  };
}
