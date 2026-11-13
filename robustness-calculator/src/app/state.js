// Small app store, in the same spirit as plate-model's: getState() returns a
// shallow copy; changes go through set()/patch(). Large values (model bytes,
// results) are held by reference and must be treated as read-only.

export function createAppState(initialState) {
  let current = { ...initialState };

  return {
    getState() {
      return { ...current };
    },
    /** Replace one top-level key. */
    set(key, value) {
      current = { ...current, [key]: value };
    },
    /** Merge into an object-valued top-level key. */
    patch(key, partial) {
      current = { ...current, [key]: { ...(current[key] ?? {}), ...partial } };
    },
    setAccordionOpen(key, isOpen) {
      this.patch("accordionState", { [key]: Boolean(isOpen) });
    },
  };
}
