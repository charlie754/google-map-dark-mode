import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readDoc = (relPath) =>
  fs.readFileSync(path.join(ROOT, relPath), "utf8").replace(/\r\n/g, "\n");

const DISCLOSURE =
  "To update the promo card in its own panel, the extension may download a signed public file and image from goatcam.dagoat.io over HTTPS, at most every 6 hours and only while the panel is open. That request carries what every web request carries — your IP address and your browser's user agent and language — plus the extension's public ID; nothing else is sent. In Firefox this happens only if you turn on the optional technical and interaction data permission.";

const OLD_PRIVACY_PHRASES = [
  "This extension collects nothing, sends nothing, and has no analytics.",
  "There is no server belonging to this extension.",
  "Nothing you do in Google Maps is recorded, and nothing about you\nleaves your computer because of this extension.",
  "One thing, in your browser's local extension storage\n(`chrome.storage.local`), which never leaves the device:",
  "Three requests, and only these three.",
  "It does not read\nyour searches, your location, your saved places, the page text, or anything you\ntype, and it sends nothing anywhere.",
  "The banner's\nphoto and its QR code are part of the extension itself, so showing the banner\nrequests nothing from anywhere.",
];

const OLD_STORE_LISTING_PHRASES = [
  "The photo and the QR code are\nembedded in the extension, so showing the banner makes no network request, and\nno permission changed.",
  'Neither store requires one when nothing is collected, but pointing at a real document makes review faster. Chrome\'s data-usage tab wants an explicit "no data collected" declaration either way.',
  "• Nothing collected, nothing transmitted, no analytics, no accounts, no servers",
  "It is part of the extension (no ad network, nothing requested to show it);",
  "Nothing user-identifying is stored and nothing is\n> transmitted.",
  "It does not read page text, search\n> queries, location, saved places, form input or cookies, and it transmits\n> nothing.",
  "Discloses **no** data collection of any category. The extension has no server,\n> no analytics, no telemetry, no identifiers and no remote logging.",
  "The banner's photo is a `data:` image and its QR\n> code is inline SVG, both inside the package, so showing it requests nothing —\n> the extension never contacts goatcam.dagoat.io or the App Store.",
];

test("PRIVACY.md removes outdated no-network/no-server claims and includes the goatcam banner disclosure", () => {
  const privacy = readDoc("PRIVACY.md");
  for (const phrase of OLD_PRIVACY_PHRASES) {
    assert.equal(
      privacy.includes(phrase),
      false,
      `Expected PRIVACY.md not to contain old phrase: ${JSON.stringify(phrase)}`
    );
  }
  assert.equal(
    privacy.includes(DISCLOSURE),
    true,
    "Expected PRIVACY.md to contain the exact goatcam.dagoat.io disclosure sentence"
  );
  for (const key of [
    "`goatcamBanner.record`",
    "`goatcamBanner.set.<hash>`",
    "`goatcamBanner.display`",
  ]) {
    assert.equal(
      privacy.includes(key),
      true,
      `Expected PRIVACY.md storage table to document ${key}`
    );
  }
});

test("docs/store-listing.md removes outdated no-network/no-server claims and includes the goatcam banner disclosure", () => {
  const listing = readDoc("docs/store-listing.md");
  for (const phrase of OLD_STORE_LISTING_PHRASES) {
    assert.equal(
      listing.includes(phrase),
      false,
      `Expected docs/store-listing.md not to contain old phrase: ${JSON.stringify(phrase)}`
    );
  }
  assert.equal(
    listing.includes(DISCLOSURE),
    true,
    "Expected docs/store-listing.md to contain the exact goatcam.dagoat.io disclosure sentence"
  );
});
