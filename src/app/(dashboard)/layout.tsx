// Route-group layout for the dashboard. Mounts the sonner <Toaster /> here so toast
// is scoped to the dashboard surface without touching the shared root layout.
import { TopNav } from "@/components/top-nav";
import { Toaster } from "@/components/ui/sonner";

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <TopNav />
      {children}
      <Toaster position="bottom-right" />
    </>
  );
}
