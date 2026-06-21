// Route-group layout for the dashboard. Mounts the sonner <Toaster /> here so toast
// is scoped to the dashboard surface without touching the shared root layout.
import { Toaster } from "@/components/ui/sonner";

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {children}
      <Toaster position="bottom-right" />
    </>
  );
}
