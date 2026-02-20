import puppeteer from 'puppeteer';
import fs from 'fs-extra';
import { createEvents } from 'ics';

const URL = "https://in.bookmyshow.com/explore/plays-national-capital-region-ncr";
const MAX_RETRIES = 5;
const SCROLL_DELAY = 2500;
const MAX_STALLS = 5;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function retry(fn, retries = MAX_RETRIES) {
    let attempt = 0;
    while (attempt < retries) {
        try {
            return await fn();
        } catch (err) {
            attempt++;
            console.log(`Retry ${attempt}/${retries}`);
            await sleep(2000 * attempt);
        }
    }
    throw new Error("Max retries reached.");
}

async function autoScroll(page) {
    let previousHeight = 0;
    let stallCount = 0;

    while (stallCount < MAX_STALLS) {
        const currentHeight = await page.evaluate(() => document.body.scrollHeight);

        if (currentHeight === previousHeight) {
            stallCount++;
        } else {
            stallCount = 0;
        }

        previousHeight = currentHeight;

        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await sleep(SCROLL_DELAY);
    }
}

function safeParseDate(dateText) {
    try {
        const date = new Date(dateText);
        if (isNaN(date)) return null;

        return [
            date.getFullYear(),
            date.getMonth() + 1,
            date.getDate(),
            date.getHours(),
            date.getMinutes()
        ];
    } catch {
        return null;
    }
}

async function main() {
    console.log("Launching browser...");

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(90000);

    const apiData = [];

    // Capture network API responses (fallback extraction)
    page.on('response', async response => {
        try {
            const url = response.url();
            if (url.includes("/api/")) {
                const json = await response.json();
                apiData.push(json);
            }
        } catch {}
    });

    await retry(() =>
        page.goto(URL, { waitUntil: 'networkidle2' })
    );

    console.log("Scrolling...");
    await autoScroll(page);

    console.log("Extracting DOM data...");

    let plays = await page.evaluate(() => {
        const anchors = document.querySelectorAll("a[href*='/events/']");
        const results = [];

        anchors.forEach(a => {
            const title =
                a.querySelector("h3")?.innerText?.trim() ||
                a.querySelector("div")?.innerText?.split("\n")[0]?.trim() ||
                "Unknown Title";

            const fullText = a.innerText;

            const dateMatch =
                fullText.match(/\d{1,2}\s\w+.*?\d{1,2}:\d{2}\s?(AM|PM)/i) ||
                fullText.match(/\d{1,2}:\d{2}\s?(AM|PM)/i);

            const priceMatch = fullText.match(/₹\s?\d+/);

            const venueMatch =
                fullText.match(/(Auditorium|Theatre|Hall|Center|Centre)[^,\n]*/i);

            results.push({
                title,
                venue: venueMatch ? venueMatch[0] : "Venue TBA",
                dateTime: dateMatch ? dateMatch[0] : null,
                price: priceMatch ? priceMatch[0] : "Price TBA",
                link: "https://in.bookmyshow.com" + a.getAttribute("href")
            });
        });

        return results;
    });

    // Deduplicate by link
    const seen = new Set();
    plays = plays.filter(p => {
        if (!p.link || seen.has(p.link)) return false;
        seen.add(p.link);
        return true;
    });

    console.log(`DOM extracted: ${plays.length}`);

    // Fallback: If DOM extraction too small, try API fallback
    if (plays.length < 50 && apiData.length > 0) {
        console.log("Using API fallback...");
        apiData.forEach(apiChunk => {
            try {
                const events = apiChunk?.data?.events || [];
                events.forEach(ev => {
                    plays.push({
                        title: ev.name,
                        venue: ev.venue?.name || "Venue TBA",
                        dateTime: ev.showDate || null,
                        price: ev.priceRange || "Price TBA",
                        link: "https://in.bookmyshow.com" + ev.url
                    });
                });
            } catch {}
        });
    }

    console.log(`Final plays count: ${plays.length}`);

    const icsEvents = [];

    for (const play of plays) {
        const start = safeParseDate(play.dateTime);
        if (!start) continue;

        icsEvents.push({
            title: play.title,
            description:
                `Venue: ${play.venue}\n` +
                `Time: ${play.dateTime}\n` +
                `Price: ${play.price}\n` +
                `Tickets: ${play.link}`,
            location: play.venue,
            start,
            duration: { hours: 2 }
        });
    }

    console.log("Generating ICS...");

    const { error, value } = createEvents(icsEvents);

    if (error) {
        console.log("ICS error:", error);
    } else {
        fs.writeFileSync("ncr_plays.ics", value);
        console.log("ICS created successfully.");
    }

    await browser.close();
    console.log("DONE.");
}

main();
