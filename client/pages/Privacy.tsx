import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Logo } from '../components/ui';
import { ThemeToggle } from '../themes/ThemeToggle';

const CONTACT = import.meta.env.VITE_CONTACT_EMAIL as string | undefined;

/** Public (no login needed): what the site stores, the one cookie it sets, and who can see what. */
export function PrivacyPage() {
  return (
    <div className="auth-page legal-page">
      <div className="auth-theme">
        <ThemeToggle />
      </div>
      <article className="legal-card">
        <Link to="/" className="legal-back">
          <ArrowLeft size={16} /> Back
        </Link>
        <div className="brand" style={{ padding: '8px 0 10px' }}>
          <Logo size={30} />
          <span>Georgie Flashcards</span>
        </div>
        <h1>Cookies &amp; privacy</h1>
        <p className="sub">The short, plain-language version of what happens with your information.</p>

        <h2>The cookie</h2>
        <p>
          Georgie sets <b>one cookie</b>, called <code>sid</code>. It keeps you signed in on this device for up to 30 days, or until you log out.
          It is essential: the site can't work without it, so there is nothing to accept or decline. It can't be read by scripts on the page, and
          it is only sent to this site.
        </p>
        <p>
          There are <b>no</b> analytics cookies, advertising cookies or tracking pixels, and nothing is sold or shared. The fonts are served from
          this site too, so your visit doesn't go to any third party.
        </p>

        <h2>Stored in your browser (not cookies)</h2>
        <p>
          A few settings are remembered on your device only: your light/dark choice, whether "Type my answer" is switched on, and that you've seen the
          cookie notice. These never leave your browser.
        </p>

        <h2>What we keep about you</h2>
        <ul>
          <li>Your email address and a scrambled (hashed) version of your password. Nobody, including the site owner, can read your password.</li>
          <li>Your time zone, so "today" and due times are right for you.</li>
          <li>Your folders, cards and pictures, and your study history (when you answered a card and how you rated it).</li>
        </ul>

        <h2>Who can see it</h2>
        <p>
          Your cards, folders and pictures are private to your account. The site owner has a dashboard that shows account-level facts only: your email,
          when you joined, when you last studied, and how many folders, cards and reviews you have. It doesn't show what is written on your cards.
        </p>

        <h2>Your choices</h2>
        <ul>
          <li>Log out any time: that ends your session and removes the cookie from your device.</li>
          <li>You can export all your cards as a CSV file from the dashboard whenever you like.</li>
          <li>
            To have your account and everything in it deleted, ask the site owner
            {CONTACT ? (
              <>
                : <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
              </>
            ) : (
              ' (the person who invited you to use Georgie).'
            )}
          </li>
        </ul>
        <p className="muted small">If anything here changes, this page will be updated.</p>
      </article>
    </div>
  );
}
