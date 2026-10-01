export type AvatarState = 'idle' | 'processing' | 'responding' | 'error' | 'disabled';

/**
 * Lightweight vector astronaut helmet. States are expressed through the visor animation and are
 * never the only cue (the panel always shows a text status). Honors prefers-reduced-motion via CSS.
 */
export function Avatar({ state, size = 40 }: { state: AvatarState; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={`avatar avatar-${state}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="visor" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6cc6e6" />
          <stop offset="1" stopColor="#1b3a4b" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill="#1c232c" stroke="#3a4556" strokeWidth="2" />
      <path
        d="M14 34c0-11 8-19 18-19s18 8 18 19v3a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4v-3Z"
        fill="#e7e2da"
      />
      <path
        d="M19 33c0-8 6-13 13-13s13 5 13 13v1a3 3 0 0 1-3 3H22a3 3 0 0 1-3-3v-1Z"
        fill="url(#visor)"
        className="avatar-visor"
      />
      <path
        d="M24 27c2-2 5-3 8-3"
        stroke="#ffffff"
        strokeOpacity=".7"
        strokeWidth="2"
        strokeLinecap="round"
        className="avatar-glint"
      />
      <rect x="20" y="44" width="24" height="8" rx="3" fill="#c8653a" />
      <circle cx="26" cy="48" r="1.6" fill="#1c232c" />
      <circle cx="32" cy="48" r="1.6" fill="#1c232c" className="avatar-led" />
      <circle cx="38" cy="48" r="1.6" fill="#1c232c" />
    </svg>
  );
}
