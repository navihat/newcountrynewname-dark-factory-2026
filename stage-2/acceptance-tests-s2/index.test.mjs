// Single entry point: all suites in ONE process so tests run serially (every test resets shared service state).
import './holds.test.mjs';
import './capture.test.mjs';
import './export.test.mjs';
import './concurrency.test.mjs';
import './ui.test.mjs';
