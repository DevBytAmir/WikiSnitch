import { Link, useLocation } from "react-router-dom";
import { useTheme } from "../lib/theme";
import { Icon } from "./Icon";

export function TopBar() {
  const { pathname } = useLocation();
  const items = [
    { label: "Articles", to: "/", active: pathname === "/" || pathname.startsWith("/a/") },
    { label: "Ask", to: "/ask", active: pathname.startsWith("/ask") },
    { label: "How it works", to: "/help", active: pathname === "/help" || pathname === "/how" },
  ];
  return (
    <header className="topbar">
      <div className="topbar-inner wrap">
        <Link to="/" className="brand" aria-label="WikiSnitch home">
          <span className="brand-mark">
            <span className="brand-seal" aria-hidden="true" />
          </span>
          <span className="brand-text">
            <span className="brand-name">WikiSnitch</span>
            <span className="brand-tag">Wikipedia, with a memory</span>
          </span>
        </Link>
        <nav className="mainnav" aria-label="Main">
          {items.map((i) => (
            <Link key={i.to} to={i.to} aria-current={i.active ? "page" : undefined} className={i.active ? "active" : undefined}>
              {i.label}
            </Link>
          ))}
        </nav>
        <div className="topbar-end">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  const label = dark ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button type="button" className="btn btn-sm theme-toggle" onClick={toggle} aria-label={label} title={label}>
      <Icon name={dark ? "sun" : "moon"} size={15} />
      <span className="theme-toggle-text" aria-hidden="true">
        {dark ? "Light" : "Dark"}
      </span>
    </button>
  );
}
