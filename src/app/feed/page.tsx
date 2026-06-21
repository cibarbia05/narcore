import type { Metadata } from "next";
import { TriangleAlert } from "lucide-react";

import { loadFeed, type FeedPost } from "../../../scraper/feed";

export const metadata: Metadata = {
  title: "Synthetic Feed",
  description: "Synthetic, fictional social posts used to test Narcore's detection pipeline.",
};

// Hoisted, static — never re-created per render (server-hoist-static-io).
const PLATFORM_LABEL: Record<FeedPost["platform"], string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
  tiktok: "TikTok",
  telegram: "Telegram",
  snapchat: "Snapchat",
  unknown: "Unknown",
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC", // deterministic across server/client — no hydration drift
  timeZoneName: "short",
});

function initialOf(username: string): string {
  const ch = username.replace(/^@/, "").charAt(0);
  return ch ? ch.toUpperCase() : "?";
}

function PostCard({ post }: { post: FeedPost }) {
  return (
    <article
      data-post
      data-post-link={post.postLink}
      data-username={post.username}
      data-platform={post.platform}
      data-date={post.postDate}
      className="rounded-xl bg-card p-5 ring-1 ring-foreground/10"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-sm text-muted-foreground"
          >
            {initialOf(post.username)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-mono text-sm font-medium">{post.username}</p>
            <p className="font-mono text-xs text-muted-foreground">
              {PLATFORM_LABEL[post.platform]}
            </p>
          </div>
        </div>
        <a
          href={post.postLink}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`View original post by ${post.username} (synthetic link)`}
          className="shrink-0 rounded-sm font-mono text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          <time dateTime={post.postDate}>{dateFormatter.format(new Date(post.postDate))}</time>
        </a>
      </header>
      <p data-caption className="mt-3 text-sm text-pretty text-foreground/90">
        {post.caption}
      </p>
    </article>
  );
}

export default function FeedPage() {
  const posts = loadFeed();

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <header className="mb-8 space-y-4">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-2 font-mono text-xs text-muted-foreground">
          <TriangleAlert aria-hidden className="size-3.5 text-primary" />
          <span>
            <span className="text-foreground">Synthetic test data.</span> Fictional posts for
            pipeline testing — not real accounts, links, or activity.
          </span>
        </div>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">Synthetic Social Feed</h1>
          <p className="text-sm text-pretty text-muted-foreground">
            The scrape target for Narcore. A Browserbase session reads these{" "}
            <span className="font-mono">{posts.length}</span> posts and submits each to the
            detection pipeline.
          </p>
        </div>
      </header>

      <div role="feed" aria-label="Synthetic social posts" className="space-y-4">
        {posts.map((post) => (
          <PostCard key={post.postLink} post={post} />
        ))}
      </div>
    </main>
  );
}
