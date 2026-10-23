// light/dark theme: follows the system until the toggle picks one, which is remembered in this browser
// (index.html applies the remembered theme before the page first paints)

const storageKey = 'theme';

const remembered = function(): string | null {
  try {
    return localStorage.getItem(storageKey);
  } catch (error) {
    return null;
  }
}

const remember = function(theme: string): void {
  try {
    localStorage.setItem(storageKey, theme);
  } catch (error) {
    // private mode or blocked storage: the theme just lasts until reload
  }
}

// a color token of the current theme, e.g. '--scene-bg', as a number for three.js
export const themeColor = function(token: string): number {
  return parseInt(getComputedStyle(document.documentElement).getPropertyValue(token).trim().slice(1), 16);
}

// onChange runs whenever the theme changes, from the toggle or the system setting
export const initTheme = function(toggle: HTMLButtonElement, onChange: () => void): void {
  const root = document.documentElement;
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  const stored = remembered();
  if (stored === 'light' || stored === 'dark') {
    root.dataset.theme = stored;
  }

  const current = (): string => root.dataset.theme ?? (systemDark.matches ? 'dark' : 'light');
  const label = (): void => {
    const next = current() === 'dark' ? 'light' : 'dark';
    toggle.textContent = next === 'dark' ? '☾' : '☀';
    toggle.title = `Switch to ${next} theme`;
    toggle.setAttribute('aria-label', toggle.title);
  };

  toggle.addEventListener('click', () => {
    root.dataset.theme = current() === 'dark' ? 'light' : 'dark';
    remember(root.dataset.theme);
    label();
    onChange();
  });
  systemDark.addEventListener('change', () => {
    label();
    onChange();
  });
  label();
  onChange();
}
