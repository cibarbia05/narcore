"use client";

import { ArrowDownIcon, ArrowUpIcon, SearchIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PLATFORMS } from "@/lib/types";
import type { PostsFilter, SortKey } from "@/lib/api-client";

type Item = { value: string; label: string };

const STATUS_ITEMS: Item[] = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const FLAGGED_ITEMS: Item[] = [
  { value: "all", label: "All posts" },
  { value: "true", label: "Flagged" },
  { value: "false", label: "Cleared" },
];

const PLATFORM_ITEMS: Item[] = [
  { value: "all", label: "All platforms" },
  ...PLATFORMS.map((p) => ({ value: p, label: p })),
];

const SORT_ITEMS: Array<{ value: SortKey; label: string }> = [
  { value: "riskScore", label: "Risk score" },
  { value: "postDate", label: "Post date" },
];

function FilterSelect({
  value,
  items,
  onValueChange,
  label,
  className,
}: {
  value: string;
  items: Item[];
  onValueChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      items={items}
    >
      <SelectTrigger size="sm" className={className} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function FiltersBar({
  value,
  onChange,
}: {
  value: PostsFilter;
  onChange: (next: PostsFilter) => void;
}) {
  const orderDesc = value.order === "desc";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 basis-56">
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={value.q}
          onChange={(e) => onChange({ ...value, q: e.target.value })}
          placeholder="Search captions, e.g. blue M30…"
          aria-label="Search captions"
          spellCheck={false}
          autoComplete="off"
          className="pl-8"
        />
      </div>

      <FilterSelect
        label="Filter by status"
        value={value.status}
        items={STATUS_ITEMS}
        onValueChange={(status) => onChange({ ...value, status })}
        className="w-[140px]"
      />
      <FilterSelect
        label="Filter by flag state"
        value={value.flagged}
        items={FLAGGED_ITEMS}
        onValueChange={(flagged) => onChange({ ...value, flagged })}
        className="w-[130px]"
      />
      <FilterSelect
        label="Filter by platform"
        value={value.platform}
        items={PLATFORM_ITEMS}
        onValueChange={(platform) => onChange({ ...value, platform })}
        className="w-[150px]"
      />

      <div className="flex items-center gap-1.5">
        <FilterSelect
          label="Sort by"
          value={value.sort}
          items={SORT_ITEMS}
          onValueChange={(sort) => onChange({ ...value, sort: sort as SortKey })}
          className="w-[140px]"
        />
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => onChange({ ...value, order: orderDesc ? "asc" : "desc" })}
          aria-label={`Sort order: ${orderDesc ? "descending" : "ascending"}. Toggle.`}
          title={orderDesc ? "Descending" : "Ascending"}
        >
          {orderDesc ? (
            <ArrowDownIcon aria-hidden="true" />
          ) : (
            <ArrowUpIcon aria-hidden="true" />
          )}
        </Button>
      </div>
    </div>
  );
}
