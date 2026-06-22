import { createTheme, type MantineColorsTuple } from "@mantine/core";

// Google "blue 600" family used for primary actions/links in the Firebase console.
const googleBlue: MantineColorsTuple = [
  "#e8f0fe", "#d2e3fc", "#aecbfa", "#8ab4f8", "#669df6",
  "#4285f4", "#1a73e8", "#1967d2", "#185abc", "#174ea6",
];

// Firebase amber — used for branding accents (logo, highlights).
const amber: MantineColorsTuple = [
  "#fff8e1", "#ffecb3", "#ffe082", "#ffd54f", "#ffca28",
  "#ffc107", "#ffb300", "#ffa000", "#ff8f00", "#ff6f00",
];

export const firebaseTheme = createTheme({
  primaryColor: "googleBlue",
  primaryShade: 6,
  colors: { googleBlue, amber },
  fontFamily: 'Roboto, "Helvetica Neue", -apple-system, "Segoe UI", Arial, sans-serif',
  headings: { fontFamily: 'Roboto, "Helvetica Neue", -apple-system, "Segoe UI", Arial, sans-serif' },
  defaultRadius: "md",
});
