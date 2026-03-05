import { describe, it, expect } from "vitest";
import { parseListings } from "../src/collector-node/parseListings";

describe("parseListings", () => {
  it("detects Cloudflare blocks", () => {
    const html = `<html><body><div id="cf-browser-verification">Please wait...</div></body></html>`;
    const res = parseListings(html);
    expect(res.status).toBe("BLOCKED");
    expect(res.merchants.length).toBe(0);
  });

  it("detects JS requirements", () => {
    const html = `<html><body><noscript>You need to enable JavaScript to run this app.</noscript></body></html>`;
    const res = parseListings(html);
    expect(res.status).toBe("JS_REQUIRED");
    expect(res.merchants.length).toBe(0);
  });

  it("parses valid JSON __NEXT_DATA__ payload", () => {
    const fakeStore = {
      id: "123",
      name: "Chipotle",
      isSponsored: true,
      offers: [{ title: "$0 Delivery Fee on first order" }]
    };

    const html = `<html><body>
      <script id="__NEXT_DATA__" type="application/json">
        ${JSON.stringify({ props: { pageProps: { items: [fakeStore] } } })}
      </script>
    </body></html>` + " ".repeat(5000);

    const res = parseListings(html);
    expect(res.status).toBe("SUCCESS");
    expect(res.merchants.length).toBe(1);
    expect(res.merchants[0].merchant_name).toBe("Chipotle");
    expect(res.merchants[0].is_sponsored).toBe(true);
    expect(res.merchants[0].has_discount).toBe(true);
    expect(res.merchants[0].offer_title).toBe("$0 Delivery Fee on first order");
  });

  it("parses valid fallback HTML DOM", () => {
    const html = `
      <html><body>
        <div data-anchor-id="StoreCard">
           <a href="/store/chipotle">
             <span title="Chipotle Mexican Grill">Chipotle Mexican Grill</span>
             <div data-testid="sponsored-badge">Sponsored</div>
             <div><span color="discount">0$ Delivery Fee Promo</span></div>
           </a></div>
      </body></html>
    `;

    // Make sure it passes length check so it isn't flagged as empty
    const padding = " ".repeat(5000);
    const paddedHtml = html + padding;

    const res = parseListings(paddedHtml);
    expect(res.status).toBe("SUCCESS");
    expect(res.merchants.length).toBe(1);
    expect(res.merchants[0].merchant_name).toBe("Chipotle Mexican Grill");
    expect(res.merchants[0].is_sponsored).toBe(true);
    expect(res.merchants[0].has_discount).toBe(true);
  });

  it("returns PARSE_SCHEMA_CHANGED on empty payloads that aren't blocked", () => {
    const padding = " ".repeat(5000);
    const html = `<html><body><div>Just some valid looking random text but no real stores</div></body></html>` + padding;

    const res = parseListings(html);
    expect(res.status).toBe("PARSE_SCHEMA_CHANGED");
  });
});
