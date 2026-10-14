import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Cookie } from 'lucide-react';

const KEY = 'georgie.cookieNotice';

const seen = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * A short, plain notice that the site sets one essential cookie (the login). There is nothing optional to accept or
 * decline: no analytics, advertising or third-party cookies. "Got it" just remembers that it has been read.
 */
export function CookieNotice() {
  const [hidden, setHidden] = useState(seen);
  if (hidden) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* private mode: it will show again next visit, which is fine */
    }
    setHidden(true);
  };
  return (
    <div className="cookie-notice" role="region" aria-label="Cookie notice">
      <Cookie size={20} className="cookie-icon" aria-hidden="true" />
      <p>
        We use <b>one essential cookie</b> to keep you signed in. No tracking, no ads, no third-party cookies.{' '}
        <Link to="/privacy">Cookies &amp; privacy</Link>
      </p>
      <button className="btn small" onClick={dismiss}>
        Got it
      </button>
    </div>
  );
}
