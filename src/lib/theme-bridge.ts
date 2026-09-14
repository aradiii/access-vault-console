// Bridge between the console settings store and next-themes.

type SetThemeFn = (theme: "dark" | "light") => void;

let directSetter: SetThemeFn | null = null;
let pendingTheme: "dark" | "light" | null = null;

export function setThemeBridge(setTheme: SetThemeFn | null) {
  directSetter = setTheme;
  if (directSetter && pendingTheme) {
    directSetter(pendingTheme);
    pendingTheme = null;
  }
}

export function applyTheme(theme: "dark" | "light") {
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
  }
  if (directSetter) {
    directSetter(theme);
    pendingTheme = null;
  } else {
    pendingTheme = theme;
  }
}
