import { renderAuthorizations } from './pages/authorizations.js';
import { renderLogin, renderSignup } from './pages/auth.js';
import { renderHome } from './pages/home.js';
import { renderRequests } from './pages/requests.js';
import { renderSplit } from './pages/split.js';

const SCREENS: Record<string, () => void> = {
  '/': renderHome,
  '/requests': renderRequests,
  '/split': renderSplit,
  '/signup': renderSignup,
  '/login': renderLogin,
  '/authorizations': renderAuthorizations,
};

const path = location.pathname.length > 1 ? location.pathname.replace(/\/+$/, '') : location.pathname;
(SCREENS[path] ?? renderHome)();
