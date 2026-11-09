"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try {
      await createClient()?.auth.signOut();
    } finally {
      router.replace("/");
      router.refresh();
    }
  }
  return (
    <button onClick={signOut} disabled={busy} className="inline-flex items-center gap-1.5 text-[13px] text-faint hover:text-ink" data-testid="signout">
      {busy ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />} Sign out
    </button>
  );
}
