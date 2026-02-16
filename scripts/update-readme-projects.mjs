#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PROJECTS_START = "<!-- PROJECTS:START -->";
const PROJECTS_END = "<!-- PROJECTS:END -->";
const YOUTUBE_START = "<!-- YOUTUBE:START -->";
const YOUTUBE_END = "<!-- YOUTUBE:END -->";
const BLOG_START = "<!-- BLOG:START -->";
const BLOG_END = "<!-- BLOG:END -->";

const DEFAULT_OWNER = "ParkerRex";
const DEFAULT_DAYS = 30;
const DEFAULT_EXCLUDES = new Set(["parkerrex", "jobbi", "truemed"]);
const DEFAULT_YOUTUBE_CHANNEL_ID = "UCcuaQecz84wTuxKzr1Yxi4Q";
const DEFAULT_YOUTUBE_COUNT = 3;
const DEFAULT_BLOG_URL = "https://www.parkerrex.com/writing";
const DEFAULT_BLOG_COUNT = 3;
const DEFAULT_REQUIRE_PRIVATE_ACCESS = false;

function parseArgs(argv) {
  const args = {
    owner: DEFAULT_OWNER,
    days: DEFAULT_DAYS,
    readmePath: "README.md",
    excludes: new Set(DEFAULT_EXCLUDES),
    youtubeChannelId:
      process.env.YOUTUBE_CHANNEL_ID ||
      process.env.YT_CHANNEL_ID ||
      DEFAULT_YOUTUBE_CHANNEL_ID,
    youtubeCount: DEFAULT_YOUTUBE_COUNT,
    blogUrl: DEFAULT_BLOG_URL,
    blogCount: DEFAULT_BLOG_COUNT,
    youtubeApiKey: process.env.YOUTUBE_API_KEY || process.env.YT_API_KEY || "",
    requirePrivateAccess: DEFAULT_REQUIRE_PRIVATE_ACCESS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--owner" && argv[i + 1]) {
      args.owner = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--days" && argv[i + 1]) {
      const parsedDays = Number.parseInt(argv[i + 1], 10);
      if (!Number.isFinite(parsedDays) || parsedDays <= 0) {
        throw new Error(`Invalid --days value: ${argv[i + 1]}`);
      }
      args.days = parsedDays;
      i += 1;
      continue;
    }
    if (token === "--readme" && argv[i + 1]) {
      args.readmePath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--exclude" && argv[i + 1]) {
      args.excludes.add(argv[i + 1].toLowerCase());
      i += 1;
      continue;
    }
    if (token === "--youtube-channel-id" && argv[i + 1]) {
      args.youtubeChannelId = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--youtube-count" && argv[i + 1]) {
      const parsedCount = Number.parseInt(argv[i + 1], 10);
      if (!Number.isFinite(parsedCount) || parsedCount <= 0) {
        throw new Error(`Invalid --youtube-count value: ${argv[i + 1]}`);
      }
      args.youtubeCount = parsedCount;
      i += 1;
      continue;
    }
    if (token === "--blog-url" && argv[i + 1]) {
      args.blogUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--blog-count" && argv[i + 1]) {
      const parsedCount = Number.parseInt(argv[i + 1], 10);
      if (!Number.isFinite(parsedCount) || parsedCount <= 0) {
        throw new Error(`Invalid --blog-count value: ${argv[i + 1]}`);
      }
      args.blogCount = parsedCount;
      i += 1;
      continue;
    }
    if (token === "--youtube-api-key" && argv[i + 1]) {
      args.youtubeApiKey = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--require-private-access") {
      args.requirePrivateAccess = true;
      continue;
    }
  }

  return args;
}

function runGh(args, options = {}) {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    }).trim();
  } catch (error) {
    const stderr = error.stderr?.toString().trim() ?? "Unknown gh error";
    throw new Error(`gh ${args.join(" ")} failed: ${stderr}`);
  }
}

function escapeRegex(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeBase64Content(content) {
  const normalized = content.replace(/\n/g, "");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function normalizeRepoName(name) {
  return name
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function decodeHtmlEntities(input) {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}

function cleanSentence(input, maxLength = 160) {
  const compact = decodeHtmlEntities(
    input
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[`*_~]/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
  if (!compact) return "";
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

function extractField(markdown, fieldLabel) {
  const pattern = new RegExp(
    `^\\s*(?:[-*]\\s*)?(?:\\*\\*|__)?\\s*${escapeRegex(fieldLabel)}\\s*(?:\\*\\*|__)?\\s*:\\s*(.+?)\\s*$`,
    "im",
  );
  const match = markdown.match(pattern);
  return match ? cleanSentence(match[1]) : "";
}

function firstMeaningfulLine(markdown) {
  const lines = markdown.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const normalizedLine = cleanSentence(line, 260);
    if (!line) continue;
    if (line.startsWith("#")) continue;
    if (line.startsWith(">")) continue;
    if (line.startsWith("```")) continue;
    if (line.startsWith("![")) continue;
    if (line.startsWith("[![")) continue;
    if (/^\s*[-*]\s*$/.test(line)) continue;
    if (/^\s*[-*]\s+/.test(line)) continue;
    if (/^\s*(project name|one liner|one-liner|stack|problem)\s*:/i.test(line)) {
      continue;
    }
    if (isUnhelpfulSummary(normalizedLine)) continue;
    return normalizedLine;
  }
  return "";
}

function isUnhelpfulSummary(text) {
  if (!text) return true;
  if (text.length < 12) return true;
  if (text.endsWith(":")) return true;

  const patterns = [
    /^\d+\.\s*overview$/i,
    /^overview$/i,
    /^last updated\s*:/i,
    /^this repo contains:?$/i,
    /^first,?\s*run the development server:?$/i,
    /^run the development server:?$/i,
    /^open https?:\/\/localhost:\d+/i,
    /^this is a .*project bootstrapped with/i,
    /^you can start editing the page by modifying app\/page\.tsx/i,
    /^this project uses next\/font/i,
    /^you can check out the next\.js github repository/i,
    /^learn more about next\.js/i,
    /^the easiest way to deploy your next\.js app/i,
    /^check out our next\.js deployment documentation/i,
    /^\d+\.\s+[a-z].*$/i,
    /^\d+\.\s*quick start$/i,
    /^getting started$/i,
    /^installation$/i,
    /^usage$/i,
    /^quick start$/i,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

function pickBestSummary(candidates) {
  for (const rawCandidate of candidates) {
    const candidate = cleanSentence(rawCandidate || "");
    if (!candidate) continue;
    if (isUnhelpfulSummary(candidate)) continue;
    return candidate;
  }
  return "";
}

function getRepos(owner, { visibility = "", limit = 200 } = {}) {
  const ghArgs = ["repo", "list", owner, "--limit", String(limit)];
  if (visibility) {
    ghArgs.push("--visibility", visibility);
  }
  ghArgs.push("--json", "name,description,url,pushedAt,isFork,isArchived");

  const output = runGh(ghArgs);
  return JSON.parse(output);
}

function getReadmeMarkdown(owner, repoName) {
  try {
    const output = runGh(["api", `repos/${owner}/${repoName}/readme`]);
    const payload = JSON.parse(output);
    if (payload.encoding !== "base64" || !payload.content) return "";
    return decodeBase64Content(payload.content);
  } catch {
    return "";
  }
}

function buildProjectLine(repo, readmeMarkdown) {
  const projectName = extractField(readmeMarkdown, "Project name");
  const oneLinerField =
    extractField(readmeMarkdown, "One liner") ||
    extractField(readmeMarkdown, "One-liner");
  const problemField = extractField(readmeMarkdown, "Problem");
  const oneLiner =
    pickBestSummary([
      oneLinerField,
      repo.description || "",
      problemField,
      firstMeaningfulLine(readmeMarkdown),
    ]) || `${normalizeRepoName(repo.name)} project`;

  const displayName = cleanSentence(projectName || repo.name, 80);
  return `- **[${displayName}](${repo.url})** - ${oneLiner}`;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "parkerrex-readme-updater/1.0",
      },
    });
    if (!response.ok) {
      throw new Error(`Request failed (${response.status}) for ${url}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchYoutubeVideosFromApi({ channelId, count, apiKey }) {
  const params = new URLSearchParams({
    key: apiKey,
    part: "snippet,id",
    channelId,
    order: "date",
    maxResults: String(count),
    type: "video",
  });

  const raw = await fetchText(
    `https://www.googleapis.com/youtube/v3/search?${params.toString()}`,
  );
  const payload = JSON.parse(raw);
  const items = Array.isArray(payload.items) ? payload.items : [];

  return items
    .map((item) => {
      const videoId = item?.id?.videoId;
      const title = item?.snippet?.title;
      if (!videoId || !title) return null;
      return {
        title: cleanSentence(title, 180),
        url: `https://www.youtube.com/watch?v=${videoId}`,
      };
    })
    .filter(Boolean)
    .slice(0, count);
}

async function fetchYoutubeVideosFromRss({ channelId, count }) {
  const xml = await fetchText(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
  );

  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  const videos = [];

  for (const entry of entries) {
    const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/i);
    const linkMatch = entry.match(
      /<link[^>]*rel="alternate"[^>]*href="([^"]+)"[^>]*\/?\s*>/i,
    );
    const videoIdMatch = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i);

    const title = titleMatch ? cleanSentence(titleMatch[1], 180) : "";
    const url =
      (linkMatch && linkMatch[1]) ||
      (videoIdMatch ? `https://www.youtube.com/watch?v=${videoIdMatch[1]}` : "");

    if (!title || !url) continue;
    videos.push({ title, url });

    if (videos.length >= count) break;
  }

  return videos;
}

async function getLatestYouTubeVideos({ channelId, count, apiKey }) {
  if (apiKey) {
    try {
      const apiVideos = await fetchYoutubeVideosFromApi({ channelId, count, apiKey });
      if (apiVideos.length > 0) return apiVideos;
      console.warn("YouTube API returned no videos. Falling back to RSS feed.");
    } catch (error) {
      console.warn(`YouTube API failed (${error.message}). Falling back to RSS feed.`);
    }
  }

  return fetchYoutubeVideosFromRss({ channelId, count });
}

function extractBlogPostsFromLdJson(html, blogUrl) {
  const scripts = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) || [];

  for (const scriptTag of scripts) {
    const jsonMatch = scriptTag.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i,
    );
    if (!jsonMatch) continue;

    try {
      const parsed = JSON.parse(jsonMatch[1]);
      const objects = Array.isArray(parsed) ? parsed : [parsed];

      for (const obj of objects) {
        if (!obj || typeof obj !== "object") continue;

        const blogPosts =
          obj["@type"] === "Blog" && Array.isArray(obj.blogPost)
            ? obj.blogPost
            : Array.isArray(obj["@graph"])
              ? obj["@graph"]
                  .filter((entry) => entry?.["@type"] === "BlogPosting")
                  .map((entry) => ({ headline: entry.headline, url: entry.url }))
              : null;

        if (!blogPosts || blogPosts.length === 0) continue;

        const normalizedPosts = blogPosts
          .map((post) => {
            const title = cleanSentence(post.headline || post.name || "", 180);
            if (!title || !post.url) return null;
            return {
              title,
              url: new URL(post.url, blogUrl).toString(),
            };
          })
          .filter(Boolean);

        if (normalizedPosts.length > 0) return normalizedPosts;
      }
    } catch {
      // Ignore malformed JSON-LD script blocks and continue searching.
    }
  }

  return [];
}

function extractBlogPostsFromHtmlLinks(html, blogUrl) {
  const linkRegex = /<a[^>]+href="(\/writing\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const dedupe = new Set();
  const posts = [];

  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const title = cleanSentence(match[2].replace(/<[^>]+>/g, ""), 180);
    if (!href || !title) continue;

    const key = `${href}|${title}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);

    posts.push({
      title,
      url: new URL(href, blogUrl).toString(),
    });
  }

  return posts;
}

async function getLatestBlogPosts({ blogUrl, count }) {
  const html = await fetchText(blogUrl);

  const fromLdJson = extractBlogPostsFromLdJson(html, blogUrl);
  if (fromLdJson.length > 0) {
    return fromLdJson.slice(0, count);
  }

  const fromLinks = extractBlogPostsFromHtmlLinks(html, blogUrl);
  return fromLinks.slice(0, count);
}

function formatLinkList(items) {
  if (!items || items.length === 0) {
    return "- No updates available.";
  }

  return items.map((item) => `- [${item.title}](${item.url})`).join("\n");
}

function replaceMarkerBlock(readme, startMarker, endMarker, sectionBody) {
  const startIndex = readme.indexOf(startMarker);
  const endIndex = readme.indexOf(endMarker);
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error(`README is missing valid markers: ${startMarker} ... ${endMarker}`);
  }

  const before = readme.slice(0, startIndex + startMarker.length);
  const after = readme.slice(endIndex);
  return `${before}\n${sectionBody}\n${after}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cutoff = Date.now() - args.days * 24 * 60 * 60 * 1000;
  const readmeAbsolutePath = path.resolve(process.cwd(), args.readmePath);

  if (args.requirePrivateAccess) {
    const privateRepos = getRepos(args.owner, { visibility: "private", limit: 1 });
    if (privateRepos.length === 0) {
      throw new Error(
        `No private repos are visible for ${args.owner}. Aborting to avoid removing private projects from README. Configure GH_TOKEN with private repo access, or rerun without --require-private-access.`,
      );
    }
  }

  const repos = getRepos(args.owner, { limit: 200 })
    .filter((repo) => !repo.isFork && !repo.isArchived)
    .filter((repo) => !args.excludes.has(repo.name.toLowerCase()))
    .filter((repo) => Date.parse(repo.pushedAt) >= cutoff)
    .sort((a, b) => Date.parse(b.pushedAt) - Date.parse(a.pushedAt));

  const projectLines = repos.map((repo) =>
    buildProjectLine(repo, getReadmeMarkdown(args.owner, repo.name)),
  );

  const projectsSectionBody =
    projectLines.length > 0
      ? projectLines.join("\n")
      : "- No project updates in the last 30 days.";

  const youtubeVideos = await getLatestYouTubeVideos({
    channelId: args.youtubeChannelId,
    count: args.youtubeCount,
    apiKey: args.youtubeApiKey,
  });

  const blogPosts = await getLatestBlogPosts({
    blogUrl: args.blogUrl,
    count: args.blogCount,
  });

  const currentReadme = fs.readFileSync(readmeAbsolutePath, "utf8");

  let nextReadme = replaceMarkerBlock(
    currentReadme,
    PROJECTS_START,
    PROJECTS_END,
    projectsSectionBody,
  );

  nextReadme = replaceMarkerBlock(
    nextReadme,
    YOUTUBE_START,
    YOUTUBE_END,
    formatLinkList(youtubeVideos),
  );

  nextReadme = replaceMarkerBlock(
    nextReadme,
    BLOG_START,
    BLOG_END,
    formatLinkList(blogPosts),
  );

  if (nextReadme !== currentReadme) {
    fs.writeFileSync(readmeAbsolutePath, nextReadme);
    console.log(
      `Updated ${args.readmePath}: ${projectLines.length} projects, ${youtubeVideos.length} videos, ${blogPosts.length} blog posts.`,
    );
    return;
  }

  console.log(`${args.readmePath} already up to date.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
