import { Link } from "react-router-dom";

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner wrap">
        <span>
          Text from Wikipedia,{" "}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="license noreferrer" target="_blank">
            CC BY-SA 4.0
          </a>
          . Finnish history as of 1 October 2026; Swedish and English text as of August 2025.
        </span>
        <Link to="/help" className="footer-help">
          How to read this
        </Link>
      </div>
    </footer>
  );
}
