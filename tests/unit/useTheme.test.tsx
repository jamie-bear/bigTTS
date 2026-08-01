import { act, fireEvent, render, screen } from "@testing-library/react";
import { ThemeToggle } from "../../src/client/components/ThemeToggle";
import { THEME_STORAGE_KEY, useTheme } from "../../src/client/hooks/useTheme";
import { mediaQueryStub } from "./setup";

const DARK_QUERY = "(prefers-color-scheme: dark)";
const themeColor = () => document.querySelector('meta[name="theme-color"]')?.getAttribute("content");

function Probe() {
  const { theme, cycleTheme } = useTheme();
  return <ThemeToggle theme={theme} onCycle={cycleTheme} />;
}

describe("theme mode", () => {
  beforeEach(() => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", "#ffffff");
    document.head.appendChild(meta);
  });

  afterEach(() => {
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
  });

  it("defaults to system and leaves data-theme unset so the CSS media fallback applies", () => {
    render(<Probe />);
    expect(screen.getByRole("button", { name: "Theme: System" })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("cycles light, dark, system and persists every choice", () => {
    render(<Probe />);
    fireEvent.click(screen.getByRole("button", { name: "Theme: System" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    fireEvent.click(screen.getByRole("button", { name: "Theme: Light" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(themeColor()).toBe("#0b0e13");

    fireEvent.click(screen.getByRole("button", { name: "Theme: Dark" }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });

  it("restores a stored choice on mount", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<Probe />);
    expect(screen.getByRole("button", { name: "Theme: Dark" })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("follows the OS preference while in system mode", () => {
    const query = mediaQueryStub(DARK_QUERY);
    render(<Probe />);
    expect(themeColor()).toBe("#f6f7f9");

    act(() => query.emit(true));
    expect(themeColor()).toBe("#0b0e13");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("stops following the OS once a theme is pinned", () => {
    const query = mediaQueryStub(DARK_QUERY);
    render(<Probe />);
    fireEvent.click(screen.getByRole("button", { name: "Theme: System" }));
    expect(themeColor()).toBe("#f6f7f9");

    act(() => query.emit(true));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(themeColor()).toBe("#f6f7f9");
  });
});
