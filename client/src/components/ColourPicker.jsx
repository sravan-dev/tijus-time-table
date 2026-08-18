// Font + background colour picker shared by the "Add activity" and "Split
// cell" modals: ready-made pairs first (so nobody has to think about
// contrast), with the two native pickers underneath for anything else.

export const SWATCHES = [
  ['#5b21b6', '#ede9fe'], ['#075985', '#e0f2fe'], ['#991b1b', '#fee2e2'],
  ['#92400e', '#fef3c7'], ['#166534', '#dcfce7'], ['#9d174d', '#fce7f3'],
  ['#334155', '#e2e8f0'], ['#ffffff', '#303070'],
];

export default function ColourPicker({ text, bg, onChange }) {
  return (
    <>
      <div className="chip-row">
        {SWATCHES.map(([t, b]) => (
          <button key={t + b} type="button"
            className={'swatch' + (t === text && b === bg ? ' on' : '')}
            style={{ color: t, background: b }}
            title={`Font ${t} on ${b}`}
            onClick={() => onChange({ text: t, bg: b })}>Aa</button>
        ))}
      </div>
      <div className="row" style={{ gap: 14, marginTop: 8 }}>
        <label className="color-pick">
          <span>Font colour</span>
          <input type="color" value={text}
            onChange={(e) => onChange({ text: e.target.value, bg })} />
        </label>
        <label className="color-pick">
          <span>Background</span>
          <input type="color" value={bg}
            onChange={(e) => onChange({ text, bg: e.target.value })} />
        </label>
      </div>
    </>
  );
}
