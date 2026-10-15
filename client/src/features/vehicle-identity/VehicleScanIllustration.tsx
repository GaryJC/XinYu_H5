type Props = { kind: "plate" | "vin" | "license" };

// Decorative examples only; the file input keeps the existing accessible label.
export function VehicleScanIllustration({ kind }: Props) {
  return (
    <svg viewBox="0 0 280 180" fill="none" aria-hidden="true" focusable="false">
      <rect width="280" height="180" fill="#E9ECEB" />
      <ellipse cx="140" cy="159" rx="112" ry="9" fill="#D9DEDB" />
      {kind === "plate" ? (
        <>
          <path d="M41 91 57 37Q61 24 80 24H200Q219 24 223 37L239 91V143H41Z" fill="#BCC5C0" />
          <path d="m72 39-14 48h164l-14-48Z" fill="#F7F9F8" />
          <path d="M32 98Q32 84 49 84H231Q248 84 248 98V143H32Z" fill="#A0ACA5" />
          <path d="m45 100 42 5 10 17H46Zm190 0-42 5-10 17h51Z" fill="#F5F7F5" />
          <path d="M99 105H181M104 114H176" stroke="#65756B" strokeWidth="4" strokeLinecap="round" />
          <rect x="95" y="125" width="90" height="24" rx="3" fill="#64776A" stroke="#F7F9F8" strokeWidth="2" />
          <text x="140" y="142" textAnchor="middle" fill="white" fontSize="14" fontFamily="sans-serif">京A·12345</text>
        </>
      ) : kind === "vin" ? (
        <>
          <path d="m34 130 21-89Q58 27 76 27h128q18 0 21 14l21 89Z" fill="#B8C3BC" />
          <path d="m66 43-18 75h184l-18-75Z" fill="#F6F8F6" />
          <path d="m77 55-11 45M89 55 78 100" stroke="#E0E6E1" strokeWidth="5" strokeLinecap="round" />
          <path d="M28 131q112-24 224 0v18H28Z" fill="#8E9E93" />
          <rect x="58" y="103" width="164" height="25" rx="4" fill="#53675A" />
          <text x="140" y="120" textAnchor="middle" fill="white" fontSize="11" fontFamily="monospace" letterSpacing="1">LSVAB1234A1234567</text>
          <path d="M51 98v-6h15m148 0h15v6M51 132v6h15m148 0h15v-6" stroke="#657D6D" strokeWidth="2" strokeLinecap="round" />
        </>
      ) : (
        <>
          <rect x="44" y="23" width="192" height="128" rx="9" fill="#C3CDC5" />
          <rect x="52" y="31" width="176" height="112" rx="5" fill="#F6F8F3" />
          <text x="140" y="54" textAnchor="middle" fill="#56685C" fontSize="13" fontWeight="600" fontFamily="sans-serif">机动车行驶证</text>
          <path d="M65 65h150" stroke="#C5D0C5" />
          <rect x="65" y="77" width="51" height="49" rx="4" fill="#D9E2D7" />
          <path d="m72 106 5-12h26l6 12v12H72Zm8-9-3 9h27l-4-9Z" fill="#99AB9C" />
          <path d="M128 81h72m-72 13h60m-60 13h72m-72 13h48" stroke="#B9C6B8" strokeWidth="4" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
