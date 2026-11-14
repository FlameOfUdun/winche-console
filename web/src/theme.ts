import { createTheme, type MantineColorsTuple } from "@mantine/core";

// The console's one accent (shade 6 = #2F4FD8), a cool blue with 5.9:1 contrast on white.
const winche: MantineColorsTuple = [
  "#EEF2FF", "#E0E7FF", "#C7D2FE", "#A5B4FC", "#7C8FF5",
  "#5470E6", "#2F4FD8", "#2741BB", "#1E36A8", "#182C86",
];

// Neutral greys (text #101828, muted #475467 / #667085, borders #E4E7EC, page #F6F7F9).
const gray: MantineColorsTuple = [
  "#F9FAFB", "#F2F4F7", "#E4E7EC", "#D0D5DD", "#98A2B3",
  "#667085", "#475467", "#344054", "#1D2939", "#101828",
];

const font = '"Inter Variable", Inter, -apple-system, "Segoe UI", system-ui, sans-serif';

/** Shared surface colours for hand-styled pieces (cards, the page, borders). */
export const surface = { page: "#F6F7F9", card: "#FFFFFF", border: "#E4E7EC", subtle: "#F2F4F7", text: "#101828", muted: "#475467", faint: "#667085" };

export const wincheTheme = createTheme({
  primaryColor: "winche",
  primaryShade: 6,
  // googleBlue: the old name some components still pass as `color`.
  colors: { winche, googleBlue: winche, gray },
  fontFamily: font,
  fontFamilyMonospace: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  headings: { fontFamily: font, fontWeight: "700" },
  defaultRadius: "md",
  radius: { sm: "6px", md: "8px", lg: "12px", xl: "16px" },
  components: {
    Paper: { defaultProps: { radius: "lg" } },
    Card: { defaultProps: { radius: "lg" } },
    Button: { defaultProps: { radius: "md" } },
    Badge: { defaultProps: { radius: "xl" } },
  },
});

/** @deprecated The old name. */
export const firebaseTheme = wincheTheme;
