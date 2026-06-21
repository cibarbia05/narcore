"use client";

import { Switch } from "@/components/ui/switch";
import type { Post } from "@/lib/types";

// Approve toggle. `checked` is derived from the post's approvalStatus (the parent
// owns the optimistic mutation, so flipping the cached post re-renders this in place).
// On = approved (grows the corpus); off = rejected (the decision API is approved|rejected).
export function ApproveSwitch({
  post,
  onApprove,
  disabled,
}: {
  post: Post;
  onApprove: (post: Post, nextApproved: boolean) => void;
  disabled?: boolean;
}) {
  const checked = post.approvalStatus === "approved";
  return (
    <Switch
      checked={checked}
      disabled={disabled}
      onCheckedChange={(next) => onApprove(post, next)}
      aria-label={
        checked
          ? `Approved ${post.username}. Toggle to clear.`
          : `Approve ${post.username} as drug advertising`
      }
    />
  );
}
