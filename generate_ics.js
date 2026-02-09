import { chromium } from "playwright";
import { createEvents } from "ics";
import fs from "fs";
import { DateTime } from "luxon";

const URL = "https://fillum.in/film-screenings-in-delhi";
const OUTPUT = "feed.ics";

async function autoScroll(page) {
  console.log("[autoScroll] starting");
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 400;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 600);
    });
  });
  console.log("[autoScroll] finished");
}

async function scrapeFillum() {
  console.log("[scrape] launching browser");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(URL, { waitUntil: "networkidle" });
  console.log("[scrape] page loaded");
  console.log("[scrape] page title:", await page.title());

  console.log("[wait] hydration delay");
  await page.waitForTimeout(5000);

  console.log("[wait] waiting for visible content");
  await page.waitForFunction(() =>
    document.body.innerText.includes("FILM SCREENINGS")
  );

  await autoScroll(page);

  console.log("[wait] DOM stabilization");
  await page.waitForFunction(() => {
    const len = document.body.innerText.length;
    if (!window.__prevLen) {
      window.__prevLen = len;
      return false;
    }
    const stable = Math.abs(len - window.__prevLen) < 10;
    window.__prevLen = len;
    return stable;
  });

  const diagnostics = await page.evaluate(() => ({
    bodyLength: document.body.innerText.length,
    eventCardCount: document.querySelectorAll(".event-card").length,
    h3Count: document.querySelectorAll("h3").length,
    linkCount: document.querySelectorAll("a").length,
    hasInitialStories: !!document.querySelector("#InitialStories"),
    textSample: document.body.innerText.slice(0, 500)
  }));

  console.log("[scrape] DOM stats:", diagnostics);
  console.log("[scrape] page text sample:\n", diagnostics.textSample);

  const screenings = await page.evaluate(() => {
    return Array.from(document.querySelectorAll(".event-card")).map(card => {
      const title = card.querySelector("h3")?.innerText || "";
      const date = card.querySelector(".event-date")?.innerText || "";
      const venue = card.querySelector(".event-venue")?.innerText || "";
      const link = card.querySelector("a")?.href || "";
      return { title, date, venue, link };
    });
  });

  console.log("[scrape] extracted items:", screenings.length);

  await browser.close();
  return screenings;
}

function buildICS(eventsRaw) {
  console.log("[ics] raw events:", eventsRaw?.length || 0);

  if (!eventsRaw || eventsRaw.length === 0) {
    console.log("[ics] no events found — skipping write");
    return;
  }

  const events = [];

  for (const e of eventsRaw) {
    const dt = DateTime.fromFormat(
      e.date,
      "dd LLL yyyy, hh:mm a",
      { zone: "Asia/Kolkata" }
    );

    if (!dt.isValid) {
      console.log("[ics] invalid date:", e.date);
      continue;
    }

    events.push({
      title: e.title,
      start: [dt.year, dt.month, dt.day, dt.hour, dt.minute],
      duration: { hours: 2 },
      location: e.venue,
      url: e.link,
      description: `Delhi Film Screening\n\n${e.title}\nVenue: ${e.venue}\nSource: Fillum.in`,
      status: "CONFIRMED"
    });
  }

  console.log("[ics] valid parsed events:", events.length);

  if (events.length === 0) {
    console.log("[ics] no valid events after parsing — skipping write");
    return;
  }

  const { error, value } = createEvents(events);
  if (error || !value) {
    throw error || new Error("ICS generation failed");
  }

  fs.writeFileSync(OUTPUT, value);
  console.log("[ics] file written:", OUTPUT);
}

(async () => {
  console.log("[main] Scraping Fillum…");
  const data = await scrapeFillum();
  console.log(`[main] Found ${data.length} events`);
  buildICS(data);
  console.log("[main] Done");
})();
