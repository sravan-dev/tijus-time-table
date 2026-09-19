import { createContext, useContext, useEffect, useRef, useState } from 'react';

// The top bar's "Actions" menu lists commands the current page offers (the
// Timetable's "Merge cells", for one). A page publishes them with
// usePageActions; the menu reads them with usePageActionList.
//
// Two contexts on purpose: pages only need the (stable) setter, so publishing
// a new list re-renders the menu without re-rendering the page that sent it.
const SetActions = createContext(() => {});
const ActionList = createContext([]);

export function ActionsProvider({ children }) {
  const [actions, setActions] = useState([]);
  return (
    <SetActions.Provider value={setActions}>
      <ActionList.Provider value={actions}>{children}</ActionList.Provider>
    </SetActions.Provider>
  );
}

export const usePageActionList = () => useContext(ActionList);

// Publish this page's actions: [{ key, label, hint?, disabled?, danger?, run }].
// Re-published on every render so labels and enabled states stay current; the
// list is withdrawn when the page unmounts.
export function usePageActions(actions) {
  const set = useContext(SetActions);
  useEffect(() => { set(actions); });
  useEffect(() => () => set([]), [set]);
}

// "Actions ▾" drop-down for the top bar.
export function ActionsMenu() {
  const actions = usePageActionList();
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const rect = open && btn.current ? btn.current.getBoundingClientRect() : null;
  return (
    <>
      <button ref={btn} type="button"
        className={'nav-menu-btn' + (open ? ' active' : '')}
        aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        Actions ▾
      </button>
      {open && (
        <div className="ctx-backdrop" onClick={() => setOpen(false)}
          onContextMenu={(e) => { e.preventDefault(); setOpen(false); }}>
          <div className="ctx-menu" role="menu"
            style={{ top: rect.bottom + 6, left: rect.left }}
            onClick={(e) => e.stopPropagation()}>
            {actions.length ? actions.map((a) => (
              <button key={a.key} type="button" role="menuitem"
                className={'ctx-item' + (a.danger ? ' danger' : '')}
                disabled={a.disabled}
                title={a.hint}
                onClick={() => { setOpen(false); a.run(); }}>
                {a.label}
                {a.hint && a.disabled && <div className="ctx-hint">{a.hint}</div>}
              </button>
            )) : (
              <div className="ctx-item" style={{ cursor: 'default', color: 'var(--muted)' }}>
                No actions on this page
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
