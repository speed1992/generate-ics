import { chromium } from "playwright";
import { createEvents } from "ics";
import fs from "fs";
import { DateTime } from "luxon";

const URL = "https://fillum.in/film-screenings-in-delhi";
const OUTPUT = "feed.ics";

async function autoScroll(page) {
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
}

async function scrapeFillum() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });

  await autoScroll(page);
  await page.waitForTimeout(2000);

  const screenings = await page.evaluate(() => {
    return Array.from(document.querySelectorAll(".event-card")).map(card => {
      const title = card.querySelector("h3")?.innerText || "";
      const date = card.querySelector(".event-date")?.innerText || "";
      const venue = card.querySelector(".event-venue")?.innerText || "";
      const link = card.querySelector("a")?.href || "";
      return { title, date, venue, link };
    });
  });

  await browser.close();
  return screenings;
}

function buildICS(eventsRaw) {
  const events = [];

  for (const e of eventsRaw) {
    const dt = DateTime.fromFormat(e.date, "dd LLL yyyy, hh:mm a", {
      zone: "Asia/Kolkata"
    });

    if (!dt.isValid) continue;

    events.push({
      title: e.title,
      start: [
        dt.year,
        dt.month,
        dt.day,
        dt.hour,
        dt.minute
      ],
      duration: { hours: 2 },
      location: e.venue,
      url: e.link,
      description:
        `Delhi Film Screening\n\n${e.title}\n\nVenue: ${e.venue}\nSource: Fillum.in\n\nCurated for lifelong cinema tracking.`,
      status: "CONFIRMED",
      busyStatus: "BUSY",
      categories: ["Cinema", "Film", "Delhi"]
    });
  }

  const { error, value } = createEvents(events);
  if (error) throw error;
  fs.writeFileSync(OUTPUT, value);
}

(async () => {
  console.log("Scraping Fillum…");
  const data = await scrapeFillum();
  console.log(`Found ${data.length} events`);
  buildICS(data);
  console.log("ICS generated:", OUTPUT);
})();
