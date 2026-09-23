export function createAppState(initialState) {
  let currentState = structuredClone(initialState);

  return {
    getState() {
      return structuredClone(currentState);
    },
    setConfig(config) {
      currentState = { ...currentState, config: structuredClone(config) };
    },
    setQuiescentResult(result) {
      currentState = { ...currentState, quiescentResult: result ? structuredClone(result) : null };
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
