export function CashflowLogo({
  className = "w-8 h-8",
  primaryColor = "#2563eb",
  customLogoPath = null,
}: {
  className?: string;
  primaryColor?: string;
  customLogoPath?: string | null;
}) {
  if (customLogoPath) {
    return (
      <img
        src={`/api/branding/icon?size=128&v=${encodeURIComponent(customLogoPath)}`}
        alt="App Logo"
        className={`${className} object-cover rounded-xl`}
      />
    );
  }

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="cfBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0f172a" />
          <stop offset="100%" stopColor={primaryColor} />
        </linearGradient>
        <linearGradient id="cfCard" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor={primaryColor} />
        </linearGradient>
        <linearGradient id="cfGlass" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.12" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="100" height="100" rx="24" fill="url(#cfBg)" />
      <g transform="translate(13, 14)">
        <rect
          x="10"
          y="4"
          width="54"
          height="34"
          rx="8"
          transform="rotate(-8 37 21)"
          fill="url(#cfCard)"
          opacity="0.95"
        />
        <rect
          x="4"
          y="16"
          width="66"
          height="48"
          rx="12"
          fill="url(#cfGlass)"
          stroke="#ffffff"
          strokeOpacity="0.5"
          strokeWidth="2.5"
        />
        <rect
          x="52"
          y="32"
          width="22"
          height="16"
          rx="8"
          fill={primaryColor}
          stroke="#ffffff"
          strokeOpacity="0.6"
          strokeWidth="2.2"
        />
        <circle cx="60" cy="40" r="3.2" fill="#34d399" />
        <path
          d="M 14 48 C 22 48, 24 34, 32 37 C 40 40, 42 25, 50 24"
          fill="none"
          stroke="#34d399"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path
          d="M 44 21 L 51 23 L 48 30"
          fill="none"
          stroke="#2dd4bf"
          strokeWidth="3.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
