const PATHS = {
  new: ["M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z", "M14 3v5h5M12 11v6M9 14h6"],
  open: ["M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"],
  save: ["M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z", "M8 4v5h7V4M8 20v-6h8v6"],
  saveAs: ["M5 4h9l3 3v4M5 4v15a1 1 0 0 0 1 1h5", "M8 4v4h6M14 20l1-3 5-5 2 2-5 5z"],
  bold: ["M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"],
  italic: ["M10 5h8M6 19h8M14 5l-4 14"],
  underline: ["M7 4v7a5 5 0 0 0 10 0V4M5 20h14"],
  bullets: ["M9 6h11M9 12h11M9 18h11", "M4.5 6h.01M4.5 12h.01M4.5 18h.01"],
  numbering: ["M10 6h10M10 12h10M10 18h10", "M4 5l1-1v4M4 14h2l-2 3h2M4 19.5h2"],
  styles: ["M5 6h14M5 12h9M5 18h6"],
  equation: ["M5 5h8l-5 7 5 7H5", "M15 11h5M17.5 8.5v5M15 17h5"],
  table: ["M4 5h16v14H4z", "M4 10h16M4 15h16M10 5v14M15 5v14"],
  pageBreak: ["M6 3v6h12V3M6 21v-6h12v6", "M3 12h3M9 12h2M13 12h2M18 12h3"],
  footnote: ["M5 7h10M5 12h10M5 17h6", "M18 4v5M16.5 5.5 18 4l1.5 1.5"],
  margins: ["M5 3h14v18H5z", "M9 3v18M15 3v18M5 8h14M5 16h14"],
  paper: ["M6 3h9l3 3v15H6z", "M15 3v3h3"],
  orientation: ["M4 7h11v14H4z", "M9 3h11v10"],
  preview: ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
  compile: ["M8 5v14l11-7z"],
  logs: ["M4 6h16M4 12h16M4 18h10"],
  chevron: ["M6 9l6 6 6-6"],
  home: ["M3 11l9-7 9 7", "M5 10v10h5v-6h4v6h5V10"],
  files: ["M3 5h6l2 2h10v12H3z", "M7 12h10M7 16h6"],
  newFolder: ["M3 5h6l2 2h10v12H3z", "M12 10v6M9 13h6"],
  recent: ["M12 7v5l3 2", "M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5"],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
