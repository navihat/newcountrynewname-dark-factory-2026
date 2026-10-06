// Entry point: imports all suites into ONE process so they run serially
// (every test resets shared service state).
import './runtime.test.mjs';
import './auth.test.mjs';
import './payments.test.mjs';
import './requests.test.mjs';
import './splits_activity.test.mjs';
import './idempotency.test.mjs';
import './settlements.test.mjs';
import './concurrency.test.mjs';
