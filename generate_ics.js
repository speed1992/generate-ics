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

  page.on("console", msg => {
    console.log("[browser]", msg.text());
  });

  await page.goto(URL, { waitUntil: "networkidle" });
  console.log("[scrape] page loaded");

  const title = await page.title();
  console.log("[scrape] page title:", title);

  await autoScroll(page);
  await page.waitForTimeout(2000);

  const stats = await page.evaluate(() => {
    return {
      bodyLength: document.body.innerText.length,
      eventCardCount: document.querySelectorAll(".event-card").length,
      h3Count: document.querySelectorAll("h3").length,
      linkCount: document.querySelectorAll("a").length,
      hasInitialStories: Boolean(document.querySelector("#InitialStories"))
    };
  });

  console.log("[scrape] DOM stats:", stats);

  const sampleText = await page.evaluate(() =>
    document.body.innerText.slice(0, 500)
  );

  console.log("[scrape] page text sample:\n", sampleText);

  const screenings = await page.evaluate(() => {
    console.log("event-card count:",
      document.querySelectorAll(".event-card").length
    );

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
    console.log("[ics] parsing date:", e.date);

    const dt = DateTime.fromFormat(e.date, "dd LLL yyyy, hh:mm a", {
      zone: "Asia/Kolkata"
    });

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

  console.log("[ics] valid events:", events.length);

  if (events.length === 0) {
    console.log("[ics] nothing to write");
    return;
  }

  const { error, value } = createEvents(events);

  if (error || !value) {
    console.error("[ics] generation error:", error);
    return;
  }

  fs.writeFileSync(OUTPUT, value);
  console.log("[ics] file written:", OUTPUT);
}

(async () => {
  console.log("[main] Scraping Fillum…");

  const data = await scrapeFillum();

  console.log("[main] Found", data.length, "events");

  buildICS(data);

  console.log("[main] Done");
})();
