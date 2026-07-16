export function EyeIcon({ crossed = false }) {
  return crossed ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.2A10.8 10.8 0 0 1 12 4c5.3 0 8.8 4.8 9.5 6a1.8 1.8 0 0 1 0 2 15.6 15.6 0 0 1-3.1 3.7M6.1 6.1A15.4 15.4 0 0 0 2.5 10a1.8 1.8 0 0 0 0 2c.7 1.2 4.2 6 9.5 6 1.2 0 2.3-.2 3.3-.6" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 10a1.8 1.8 0 0 0 0 2c.7 1.2 4.2 6 9.5 6s8.8-4.8 9.5-6a1.8 1.8 0 0 0 0-2C20.8 8.8 17.3 4 12 4S3.2 8.8 2.5 10Z" />
      <circle cx="12" cy="11" r="3" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="8" y="8" width="11" height="12" rx="1.5" />
      <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-10A1.5 1.5 0 0 0 3 5.5v11A1.5 1.5 0 0 0 4.5 18H8" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.7 2.7L16.5 9" />
    </svg>
  );
}

export function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10.8V17M12 7.2h.01" />
    </svg>
  );
}
