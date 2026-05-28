export default function VmiLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 260 90"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="VMI Security"
    >
      <defs>
        {/* Vertical stripe pattern used to fill the VMI letters */}
        <pattern id="vmi-stripes" x="0" y="0" width="8" height="90" patternUnits="userSpaceOnUse">
          <rect width="5.5" height="90" fill="#f5a700" />
        </pattern>
        <clipPath id="vmi-clip">
          <text
            x="76" y="63"
            fontFamily="Impact, 'Arial Black', Arial, sans-serif"
            fontSize="46"
          >VMI</text>
        </clipPath>
      </defs>

      {/* Background */}
      <rect width="260" height="90" rx="12" fill="#3a3a3a" />

      {/* Upward-pointing triangle */}
      <polygon points="37,14 10,73 64,73" fill="#f5a700" />

      {/* VMI text filled with vertical stripes */}
      <rect width="260" height="90" fill="url(#vmi-stripes)" clipPath="url(#vmi-clip)" />

      {/* SECURITY label */}
      <text
        x="168" y="82"
        textAnchor="middle"
        fill="white"
        fontSize="10"
        letterSpacing="5"
        fontFamily="Arial, Helvetica, sans-serif"
      >SECURITY</text>
    </svg>
  )
}
