"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Post } from "@/lib/types";
import { ApproveSwitch } from "./approve-switch";
import { CodeWordChips } from "./code-word-chips";
import { EngageButton } from "./engage-button";
import { OutreachDialog } from "./outreach-dialog";
import { PostDetailDialog } from "./post-detail-dialog";
import { RiskBadge } from "./risk-badge";

const COLUMNS = ["Account", "Platform", "Caption", "Risk", "Approval", "Outreach", "Operative"] as const;

function HeadRow() {
  return (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        {COLUMNS.map((label) => (
          <TableHead key={label} className="text-xs tracking-wide text-muted-foreground uppercase">
            {label}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}

export function PostsTable({
  posts,
  onApprove,
  onEngaged,
  activePostId,
}: {
  posts: Post[];
  onApprove: (post: Post, nextApproved: boolean) => void;
  // Command Center: capture the inline-launched operation + highlight its row.
  onEngaged?: (operationId: string, post: Post) => void;
  activePostId?: string;
}) {
  return (
    // overflow-x-auto: if the full table ever exceeds a narrow container (e.g. the
    // Command Center pane), it scrolls WITHIN its own box rather than the whole page.
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <HeadRow />
        <TableBody>
          {posts.map((post) => (
            <TableRow
              key={post.id}
              // Below-threshold (cleared) posts are visually de-emphasized; the post with
              // a live operation is highlighted so the queue row ties to the war room.
              className={cn(
                "align-top",
                !post.flagged && "opacity-45",
                post.id === activePostId && "bg-primary/5 ring-1 ring-inset ring-primary/30",
              )}
            >
              <TableCell className="font-mono text-xs">{post.username}</TableCell>
              <TableCell>
                <Badge variant="outline" className="font-mono text-[10px] font-normal lowercase">
                  {post.platform}
                </Badge>
              </TableCell>
              <TableCell className="max-w-md whitespace-normal">
                <PostDetailDialog post={post} />
                <CodeWordChips terms={post.risk.detectedCodeWords} />
              </TableCell>
              <TableCell>
                <RiskBadge score={post.riskScore} />
              </TableCell>
              <TableCell>
                <ApproveSwitch post={post} onApprove={onApprove} />
              </TableCell>
              <TableCell>
                <OutreachDialog post={post} />
              </TableCell>
              <TableCell>
                <EngageButton post={post} onEngaged={onEngaged} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function PostsTableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border" aria-hidden="true">
      <Table>
        <HeadRow />
        <TableBody>
          {Array.from({ length: rows }, (_, i) => (
            <TableRow key={i} className="hover:bg-transparent">
              <TableCell><Skeleton className="h-4 w-24" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
              <TableCell><Skeleton className="h-4 w-full max-w-md" /></TableCell>
              <TableCell><Skeleton className="h-5 w-14 rounded-full" /></TableCell>
              <TableCell><Skeleton className="h-5 w-8 rounded-full" /></TableCell>
              <TableCell><Skeleton className="h-7 w-20" /></TableCell>
              <TableCell><Skeleton className="h-7 w-20" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
